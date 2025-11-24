import os
import json
import logging
import logging.handlers
import requests
import shutil
import sys
import asyncio
from urllib.parse import urlparse, urljoin
from datetime import datetime, timedelta
from pathlib import Path
import redis
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image, UnidentifiedImageError
import io
from threading import Thread
import pandas as pd

# UPDATED: Import the new official SDK
from google import genai

# Load environment variables
load_dotenv()

def setup_logging():
    """Configure application logging"""
    log_dir = Path('logs')
    log_dir.mkdir(exist_ok=True)
    
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    file_handler = logging.handlers.TimedRotatingFileHandler(
        log_dir / 'app.log',
        when='midnight',
        interval=1,
        backupCount=7,
        encoding='utf-8'
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.INFO)
    
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(logging.INFO)
    
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes
logger = setup_logging()

# Configuration
app.config.update(
    REDIS_URL=os.getenv('REDIS_URL', 'redis://localhost:6379/0'),
    UPCITEMDB_API_KEY=os.getenv('UPCITEMDB_API_KEY'),
    CACHE_EXPIRY_DAYS=int(os.getenv('CACHE_EXPIRY_DAYS', 30)),
    GEMINI_API_KEY=os.getenv('GEMINI_API_KEY')
)

# Initialize Redis
redis_client = redis.Redis.from_url(app.config['REDIS_URL'])

def get_product_from_upcitemdb(upc):
    """Fetch product data from UPCItemDB API"""
    logger.info(f"Fetching product data for UPC: {upc}")
    
    if not app.config['UPCITEMDB_API_KEY']:
        error_msg = "UPCItemDB API key not configured"
        logger.error(error_msg)
        # raise ValueError(error_msg) # Optional: prevent crash if key missing
    
    headers = {
        'Accept': 'application/json'
    }
    
    try:
        logger.debug(f"Making API request to UPCItemDB for UPC: {upc}")
        response = requests.get(
            f'https://api.upcitemdb.com/prod/trial/lookup?upc={upc}',
            headers=headers,
            timeout=10
        )
        response.raise_for_status()
        
        data = response.json()
        
        if 'items' in data and data['items']:
            logger.info(f"Successfully retrieved data for UPC: {upc}")
        else:
            logger.warning(f"No items found in response for UPC: {upc}")
            
        return data
        
    except requests.exceptions.RequestException as e:
        error_msg = f"Error fetching from UPCItemDB: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return None
    except json.JSONDecodeError as e:
        error_msg = f"Error decoding JSON response: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return None

def save_product_images(upc, image_urls):
    """Save product images to a directory named after the UPC."""
    logger.info(f"Starting to save images for UPC: {upc}")
    
    if not image_urls:
        return []
        
    base_dir = Path('static') / 'upc_images'
    base_dir.mkdir(exist_ok=True, parents=True)
    # --------------------------------------------------------
    
    upc_dir = base_dir / upc
    upc_dir.mkdir(exist_ok=True)
    
    saved_paths = []
        
    for i, url in enumerate(image_urls, 1):
        try:
            parsed_url = urlparse(url)
            ext = os.path.splitext(parsed_url.path)[1] or '.jpg'
            filename = f"{upc}_{i}{ext}"
            filepath = upc_dir / filename

            # If file exists and has content, skip download
            if filepath.exists() and os.path.getsize(filepath) > 0:
                logger.debug(f"File already exists, skipping: {filepath}")
                saved_paths.append(str(filepath))
                continue

            logger.debug(f"Downloading image from: {url}")
            response = requests.get(url, timeout=10)
            response.raise_for_status()

            image_content = response.content
            
            # Verify image validity before saving
            try:
                image = Image.open(io.BytesIO(image_content))
                image.verify()
                
                # Re-open to save (verify consumes the file pointer)
                with open(filepath, 'wb') as out_file:
                    out_file.write(image_content)
                
                saved_paths.append(str(filepath))
                
            except UnidentifiedImageError:
                logger.warning(f"Downloaded file from {url} is not a valid image. Skipping.")

        except Exception as e:
            logger.error(f"Error downloading/saving image {url}: {str(e)}")

    return saved_paths

async def get_best_image_with_gemini(image_paths, title=None, brand=None):
    """
    Analyze images with Gemini 1.5 Flash and return the best one.
    Uses the new google-genai SDK.
    """
    api_key = app.config['GEMINI_API_KEY']
    if not api_key or not image_paths:
        return None

    logger.info(f"Analyzing {len(image_paths)} images with Gemini...")
    
    try:
        # Initialize the client with the new SDK
        client = genai.Client(api_key=api_key)
        
        image_parts = []
        valid_paths = []
        
        # Prepare images
        for path in image_paths:
            try:
                # The new SDK accepts PIL images directly
                img = Image.open(path)
                image_parts.append(img)
                valid_paths.append(path)
            except Exception as e:
                logger.warning(f"Could not open image {path}: {e}")
                continue

        if not image_parts:
            return None

        title_clause = (
            f"The product title is '{title}'. Treat this title as the primary matching criteria. "
            if title
            else ""
        )
        brand_clause = (
            f"The brand is '{brand}'. Only choose an image that clearly matches this brand. "
            if brand
            else ""
        )
        prompt = (
            "Analyze the following product images. Determine which one is the best "
            "candidate for an e-commerce main product photo. The title and brand accuracy are more important than lighting or framing. "
            "Only select an image if it clearly depicts the exact product title and matches the specified brand. "
            f"{title_clause}{brand_clause}"
            "If no image fully matches the title and brand, respond with 0 (zero). "
            "Otherwise respond with ONLY the single digit number representing the index of the best image (1 for the first image, 2 for the second, etc)."
        )

        # Generate content
        # NOTE: Using 'gemini-1.5-flash' as 2.5 is not a valid public model name
        response = client.models.generate_content(
            model='gemini-2.5-flash',  # <--- Use the latest stable model
            contents=[prompt, *image_parts]
        )
        
        if not response.text:
            logger.warning("Gemini returned an empty response.")
            return None

        # clean response (remove markdown or whitespace)
        result_text = response.text.strip()
        logger.debug(f"Gemini Raw Response: {result_text}")

        try:
            best_image_choice = int(result_text)
            if best_image_choice == 0:
                logger.info("Gemini did not find a suitable image that matches title/brand.")
                return None

            best_image_index = best_image_choice - 1

            if 0 <= best_image_index < len(valid_paths):
                best_image_path = valid_paths[best_image_index]
                logger.info(f"Gemini selected image #{best_image_choice}: {best_image_path}")
                return best_image_path
            else:
                logger.warning(f"Gemini returned index out of bounds: {best_image_index + 1}")
                return None
        except ValueError:
            logger.error(f"Could not parse Gemini response as integer: {result_text}")
            return None
            
    except Exception as e:
        logger.error(f"Error using Gemini API: {str(e)}", exc_info=True)
        return None

async def format_product_data(upc, data, from_cache=False):
    """Format the product data into a consistent format"""
    if not data or 'items' not in data or not data['items']:
        return None
    
    item = data['items'][0]
    image_urls = item.get('images', [])
    
    best_image_path = None
    
    # Get base URL from environment variables
    base_url = os.getenv('BASE_URL', 'http://localhost:5000')
    
    # Only process images if we just fetched fresh data (not from cache)
    # OR if you want to re-verify images even on cached data, remove "not from_cache"
    if not from_cache and image_urls:
        saved_paths = save_product_images(upc, image_urls)
        if saved_paths:
            # Convert saved paths to full URLs
            item['images'] = [urljoin(base_url, str(path).replace('\\', '/')) for path in saved_paths]
            best_image_disk_path = await get_best_image_with_gemini(
                saved_paths,
                item.get('title'),
                item.get('brand'),
            )
            if best_image_disk_path:
                # Create full URL for the best image
                best_image_path = urljoin(base_url, str(best_image_disk_path).replace('\\', '/'))
    
    return {
        'upc': upc,
        'title': item.get('title', ''),
        'brand': item.get('brand', ''),
        'description': item.get('description', ''),
        'images': item.get('images', []),
        'best_image': best_image_path,
        'cached': from_cache
    }

@app.route('/api/product/<upc>', methods=['GET'])
def get_product(upc):
    """Get product information by UPC from cache only"""
    if not upc or not upc.isdigit():
        return jsonify({'error': 'Invalid UPC format'}), 400
    
    cache_key = f'upc:{upc}'
    cached_data = redis_client.get(cache_key)
    
    if not cached_data:
        return jsonify({'error': 'Product not found in cache'}), 404
    
    try:
        product_data = json.loads(cached_data)
        return jsonify(product_data)
    except json.JSONDecodeError:
        redis_client.delete(cache_key)
        return jsonify({'error': 'Invalid cache data'}), 500

# Simple in-memory set to track processing UPCs
processing_upcs = set()

def process_upc_background(upc):
    """Process UPC in the background and update cache"""
    try:
        product_data = get_product_from_upcitemdb(upc)
        if product_data and 'items' in product_data and product_data['items']:
            formatted = asyncio.run(
                format_product_data(upc, product_data, from_cache=False)
            )
            if formatted:
                cache_key = f'upc:{upc}'
                # This now saves the actual result dictionary, not the coroutine object
                redis_client.setex( 
                    cache_key,
                    timedelta(days=app.config['CACHE_EXPIRY_DAYS']),
                    json.dumps(formatted)
                )
    except Exception as e:
        logger.error(f"Error processing {upc}: {str(e)}")
    finally:
        if upc in processing_upcs:
            processing_upcs.remove(upc)

@app.route('/api/process/<upc>', methods=['POST'])
def process_upc(upc):
    """Start processing a UPC - returns 202 immediately"""
    if not upc or not upc.isdigit():
        return jsonify({'error': 'Invalid UPC'}), 400
    
    cache_key = f'upc:{upc}'
    if redis_client.get(cache_key):
        return jsonify({'status': 'already_cached', 'upc': upc}), 200
    
    if upc in processing_upcs:
        return jsonify({'status': 'processing', 'upc': upc}), 202
    
    processing_upcs.add(upc)
    Thread(target=process_upc_background, args=(upc,), daemon=True).start()
    
    return jsonify({
        'status': 'processing_started',
        'upc': upc,
        'check_at': f'/product/{upc}'
    }), 202


@app.route('/api/process/batch', methods=['POST'])
def process_batch():
    """
    Takes a CSV file, checks for a 'upc' column, and queues
    new UPCs for background processing.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file part in the request'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected for uploading'}), 400

    if not file.filename.endswith('.csv'):
        return jsonify({'error': 'File must be a CSV (.csv)'}), 400

    try:
        # Read the CSV file content directly into pandas
        df = pd.read_csv(file)
        
        if 'upc' not in df.columns:
            return jsonify({'error': 'CSV must contain a column named "upc"'}), 400

        upcs_to_process = []
        
        # 1. Filter out duplicates in the file and ensure they are digits
        unique_upcs = df['upc'].astype(str).unique()
        
        for upc in unique_upcs:
            # 2. Check if already processed (cached) or currently processing
            cache_key = f'upc:{upc}'
            is_cached = redis_client.exists(cache_key)
            is_processing = upc in processing_upcs
            
            if not is_cached and not is_processing and upc.isdigit():
                upcs_to_process.append(upc)
                
    except Exception as e:
        logger.error(f"Error reading or processing CSV: {str(e)}", exc_info=True)
        return jsonify({'error': f'Internal error processing file: {str(e)}'}), 500

    # 3. Queue all unique, new UPCs for background processing
    for upc in upcs_to_process:
        processing_upcs.add(upc)
        # Use a background thread for each UPC, similar to the existing /process/<upc> endpoint
        Thread(target=process_upc_background, args=(upc,), daemon=True).start()

    logger.info(f"Batch processing initiated. Total unique UPCs in file: {len(unique_upcs)}. Queued for processing: {len(upcs_to_process)}.")

    return jsonify({
        'status': 'batch_processing_queued',
        'total_upcs_in_file': len(unique_upcs),
        'upcs_queued': len(upcs_to_process),
        'upcs_ignored_cached': len(unique_upcs) - len(upcs_to_process),
        'message': 'Processing started in the background. Check /product/<upc> for results later.'
    }), 202



@app.route('/api/health')
def health_check():
    return jsonify({'status': 'healthy'}), 200

@app.before_request
def log_request_info():
    logger.info(f"Request: {request.method} {request.path}")

@app.after_request
def log_response(response):
    logger.info(f"Response: {response.status}")
    return response

if __name__ == '__main__':
    try:
        port = int(os.environ.get('PORT', 5000))
        logger.info(f"Starting application on port {port}")
        app.run(host='0.0.0.0', port=port, debug=True)
    except Exception as e:
        logger.critical(f"Failed to start application: {str(e)}", exc_info=True)
        raise