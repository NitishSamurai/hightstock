# EC2 Setup Commands

This guide provides step-by-step commands to set up and run both repositories on an EC2 instance.

## Prerequisites

- EC2 instance running Ubuntu (or similar Linux distribution)
- SSH access to the instance
- Security groups configured to allow:
  - Port 22 (SSH)
  - Port 3000 (Next.js frontend)
  - Port 5000 (Flask backend)
  - Port 6379 (Redis - if exposed)

---

## 1. Initial System Setup

```bash
# Update system packages
sudo apt-get update
sudo apt-get upgrade -y

# Install essential build tools
sudo apt-get install -y build-essential curl git

# Install Node.js (v18 or later for Next.js 16)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify Node.js installation
node --version
npm --version

# Install Python 3.9+ and pip
sudo apt-get install -y python3 python3-pip python3-venv

# Install Redis
sudo apt-get install -y redis-server

# Install Docker and Docker Compose (optional, for containerized deployment)
sudo apt-get install -y docker.io docker-compose
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER  # Log out and back in for this to take effect

# Install PM2 for process management (recommended for production)
sudo npm install -g pm2
```

---

## 2. Clone/Upload Projects

```bash
# Navigate to home directory
cd ~

# If using git, clone your repositories
# git clone <your-repo-url> CascadeProjects
# cd CascadeProjects

# Or if uploading via SCP, create directory structure
mkdir -p CascadeProjects
cd CascadeProjects
```

---

## 3. Setup Python Backend (upc-product-lookup)

```bash
# Navigate to backend directory
cd ~/CascadeProjects/upc-product-lookup

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install Python dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Create .env file with required environment variables
nano .env
```

**Add the following to `.env` file:**
```env
REDIS_URL=redis://localhost:6379/0
UPCITEMDB_API_KEY=your_upcitemdb_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
CACHE_EXPIRY_DAYS=30
FLASK_APP=app.py
FLASK_ENV=production
PORT=5000
BASE_URL=http://your-ec2-public-ip:5000
```

**Save and exit (Ctrl+X, then Y, then Enter)**

```bash
# Start Redis service
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Verify Redis is running
redis-cli ping  # Should return "PONG"

# Test the Flask app (optional)
python app.py
# Press Ctrl+C to stop

# Deactivate virtual environment
deactivate
```

---

## 4. Setup Next.js Frontend (next-client)

```bash
# Navigate to frontend directory
cd ~/CascadeProjects/next-client

# Install Node.js dependencies
npm install

# Create .env.local file
nano .env.local
```

**Add the following to `.env.local` file:**
```env
NEXT_PUBLIC_API_BASE_URL=http://your-ec2-public-ip:5000
API_BASE_URL=http://your-ec2-public-ip:5000
```

**Replace `your-ec2-public-ip` with your actual EC2 public IP address**

**Save and exit (Ctrl+X, then Y, then Enter)**

```bash
# Build the Next.js application
npm run build

# Test the build (optional)
npm start
# Press Ctrl+C to stop
```

---

## 5. Running Applications in Production

### Option A: Using PM2 (Recommended for Production)

```bash
# Install PM2 globally (if not already installed)
sudo npm install -g pm2

# Start Flask backend with PM2
cd ~/CascadeProjects/upc-product-lookup
source venv/bin/activate
pm2 start app.py --name "upc-backend" --interpreter python3 -- \
  --bind 0.0.0.0:5000

# Or using gunicorn directly (better for production)
pm2 start gunicorn --name "upc-backend" -- \
  --bind 0.0.0.0:5000 \
  --workers 4 \
  --timeout 120 \
  app:app

# Start Next.js frontend with PM2
cd ~/CascadeProjects/next-client
pm2 start npm --name "next-frontend" -- start

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
# Follow the instructions shown by the command above

# Check status
pm2 status

# View logs
pm2 logs upc-backend
pm2 logs next-frontend
```

### Option B: Using Docker Compose (Alternative)

```bash
# Navigate to backend directory
cd ~/CascadeProjects/upc-product-lookup

# Create .env file (as shown in step 3)
# Then start services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

### Option C: Using systemd Services (Alternative)

**Create Flask service:**
```bash
sudo nano /etc/systemd/system/upc-backend.service
```

**Add the following:**
```ini
[Unit]
Description=UPC Product Lookup Flask App
After=network.target redis.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/CascadeProjects/upc-product-lookup
Environment="PATH=/home/ubuntu/CascadeProjects/upc-product-lookup/venv/bin"
ExecStart=/home/ubuntu/CascadeProjects/upc-product-lookup/venv/bin/gunicorn --bind 0.0.0.0:5000 --workers 4 app:app
Restart=always

[Install]
WantedBy=multi-user.target
```

**Create Next.js service:**
```bash
sudo nano /etc/systemd/system/next-frontend.service
```

**Add the following:**
```ini
[Unit]
Description=Next.js Frontend
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/CascadeProjects/next-client
Environment="NODE_ENV=production"
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target
```

**Enable and start services:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable upc-backend
sudo systemctl enable next-frontend
sudo systemctl start upc-backend
sudo systemctl start next-frontend

# Check status
sudo systemctl status upc-backend
sudo systemctl status next-frontend
```

---

## 6. Using Nginx as Reverse Proxy (Recommended)

```bash
# Install Nginx
sudo apt-get install -y nginx

# Create Nginx configuration
sudo nano /etc/nginx/sites-available/cascade-projects
```

**Add the following configuration:**
```nginx
server {
    listen 80;
    server_name your-domain.com;  # Replace with your domain or EC2 IP

    # Frontend (Next.js)
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Enable and start Nginx:**
```bash
sudo ln -s /etc/nginx/sites-available/cascade-projects /etc/nginx/sites-enabled/
sudo nginx -t  # Test configuration
sudo systemctl restart nginx
sudo systemctl enable nginx
```

---

## 7. Firewall Configuration

```bash
# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow SSH
sudo ufw allow 22/tcp

# If not using Nginx, allow direct access
sudo ufw allow 3000/tcp
sudo ufw allow 5000/tcp

# Enable firewall
sudo ufw enable
sudo ufw status
```

---

## 8. Useful Management Commands

### PM2 Commands
```bash
# View all processes
pm2 list

# Restart a process
pm2 restart upc-backend
pm2 restart next-frontend

# Stop a process
pm2 stop upc-backend

# Delete a process
pm2 delete upc-backend

# View logs
pm2 logs
pm2 logs upc-backend --lines 100

# Monitor resources
pm2 monit
```

### Systemd Commands
```bash
# Restart services
sudo systemctl restart upc-backend
sudo systemctl restart next-frontend

# View logs
sudo journalctl -u upc-backend -f
sudo journalctl -u next-frontend -f

# Check status
sudo systemctl status upc-backend
```

### Docker Compose Commands
```bash
# Stop services
docker-compose down

# Restart services
docker-compose restart

# View logs
docker-compose logs -f web
```

---

## 9. Quick Start Summary

For a quick setup, run these commands in order:

```bash
# 1. System setup
sudo apt-get update && sudo apt-get install -y build-essential curl git python3 python3-pip python3-venv redis-server nodejs npm docker.io docker-compose
sudo npm install -g pm2

# 2. Backend setup
cd ~/CascadeProjects/upc-product-lookup
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
# Create .env file with your API keys
sudo systemctl start redis-server

# 3. Frontend setup
cd ~/CascadeProjects/next-client
npm install
# Create .env.local file with backend URL
npm run build

# 4. Start with PM2
cd ~/CascadeProjects/upc-product-lookup
source venv/bin/activate
pm2 start gunicorn --name "upc-backend" -- --bind 0.0.0.0:5000 --workers 4 app:app
cd ~/CascadeProjects/next-client
pm2 start npm --name "next-frontend" -- start
pm2 save
pm2 startup
```

---

## 10. Troubleshooting

```bash
# Check if ports are in use
sudo netstat -tulpn | grep :5000
sudo netstat -tulpn | grep :3000

# Check Redis connection
redis-cli ping

# Check Python virtual environment
which python3
source venv/bin/activate
which python

# Check Node.js version
node --version  # Should be 18+

# View application logs
tail -f ~/CascadeProjects/upc-product-lookup/logs/app.log
pm2 logs
```

---

## Notes

- Replace `your-ec2-public-ip` with your actual EC2 instance public IP address
- Replace `your-domain.com` with your actual domain name (if using)
- Make sure to set up your API keys in the `.env` file for the backend
- For production, consider using HTTPS with Let's Encrypt
- Adjust the number of Gunicorn workers based on your EC2 instance size
- Consider using a process manager like PM2 or systemd for automatic restarts

