# UPC Product Lookup Service

A lightweight Flask-based microservice that provides product information using UPC (Universal Product Code) lookups.

## Features

- Fetch product details by UPC code
- Redis caching for improved performance
- Containerized with Docker for easy deployment
- Rate limiting (future implementation)
- Health check endpoint

## Prerequisites

- Python 3.9+
- Docker and Docker Compose (for containerized deployment)
- Redis (for caching)
- UPCItemDB API key (get one at [UPCItemDB](https://upcitemdb.com/api/explorer))

## Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd upc-product-lookup
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Create a `.env` file with your configuration:
   ```env
   UPCITEMDB_API_KEY=your_upcitemdb_api_key_here
   REDIS_URL=redis://localhost:6379/0
   CACHE_EXPIRY_DAYS=30
   ```

## Running the Application

### Development Mode

1. Start Redis:
   ```bash
   docker-compose up -d redis
   ```

2. Run the Flask application:
   ```bash
   flask run
   ```

### Production with Docker Compose

```bash
docker-compose up --build
```

The service will be available at `http://localhost:5000`

## API Documentation

### Base URL
All endpoints are relative to: `http://localhost:5000`

### 1. Get Product by UPC
Fetch product details for a specific UPC code.

```
GET /api/upc/<string:upc>
```

#### Parameters
- `upc` (required): The Universal Product Code (UPC) to look up

#### Example Request
```bash
curl -X GET "http://localhost:5000/api/upc/012993441012"
```

#### Success Response (200 OK)
```json
{
  "upc": "012993441012",
  "title": "Adidas Men's Running Shoes",
  "brand": "Adidas",
  "description": "High-quality running shoes",
  "images": [
    "/static/upc_images/012993441012/012993441012_1.jpg"
  ],
  "best_image": "/static/upc_images/012993441012/best_012993441012.jpg",
  "cached": false,
  "source": "upcitemdb"
}
```

#### Error Responses
- `400 Bad Request`: Invalid UPC format
- `404 Not Found`: Product not found
- `500 Internal Server Error`: Server error during processing

### 2. Process UPC (Background)
Queue a UPC for background processing and caching.

```
POST /api/process/upc/<string:upc>
```

#### Parameters
- `upc` (required): The UPC to process

#### Example Request
```bash
curl -X POST "http://localhost:5000/api/process/upc/012993441012"
```

#### Success Response (202 Accepted)
```json
{
  "status": "processing",
  "upc": "012993441012",
  "message": "UPC processing started in background"
}
```

### 3. Process Batch CSV
Process multiple UPCs from a CSV file.

```
POST /api/process/batch
```

#### Parameters
- `file` (required): CSV file containing 'upc' column

#### Example Request
```bash
curl -X POST -F "file=@upc_list.csv" "http://localhost:5000/api/process/batch"
```

#### Success Response (200 OK)
```json
{
  "status": "processing",
  "total": 5,
  "queued": 5,
  "already_processing": 0
}
```

### 4. Get All Cached UPCs
List all UPCs currently in the cache.

```
GET /api/upc
```

#### Example Request
```bash
curl -X GET "http://localhost:5000/api/upc"
```

#### Success Response (200 OK)
```json
[
  "012993441012",
  "123456789012",
  "987654321098"
]
```

### 5. Get Best Product Image
Get the best available product image for a UPC.

```
GET /api/upc/<string:upc>/image
```

#### Example Request
```bash
curl -X GET "http://localhost:5000/api/upc/012993441012/image"
```

#### Response
- Returns the image file directly
- `404 Not Found` if no image is available

### 6. Get All Product Images
Get all available product images for a UPC.

```
GET /api/upc/<string:upc>/images
```

#### Example Request
```bash
curl -X GET "http://localhost:5000/api/upc/012993441012/images"
```

#### Success Response (200 OK)
```json
{
  "upc": "012993441012",
  "images": [
    "/static/upc_images/012993441012/012993441012_1.jpg",
    "/static/upc_images/012993441012/012993441012_2.jpg"
  ]
}
```

### 7. Health Check
Check if the service is running.

```
GET /health
```

#### Example Request
```bash
curl -X GET "http://localhost:5000/health"
```

#### Success Response (200 OK)
```json
{
  "status": "healthy",
  "timestamp": "2025-11-24T21:30:00Z"
}
```

## Testing

Run the test suite:

```bash
pytest
```

## Frontend (Next.js client)

A lightweight Next.js UI lives in `next-client/` for queuing single UPCs, uploading CSV batches, and searching cached products.

```bash
cd next-client
npm install
cp env.local.example .env.local   # optional, defaults to http://localhost:5000
npm run dev
```

The client proxies browser calls through `/api/proxy/*` to avoid CORS issues. Override the following vars in `.env.local` when the API lives elsewhere:

- `API_BASE_URL` (used by the proxy route server-side)
- `NEXT_PUBLIC_API_BASE_URL` (purely for display inside the UI)

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `UPCITEMDB_API_KEY` | API key for UPCItemDB | Required |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379/0` |
| `CACHE_EXPIRY_DAYS` | Number of days to cache product data | `30` |

## License

MIT
