#!/bin/bash

echo "🚀 Starting WhatsApp Automation with Docker"
echo "============================================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    echo "✅ Docker installed. Please logout and login again, then run this script again."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Installing..."
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.21.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo "✅ Docker Compose installed"
fi

# Create required directories
echo "📁 Creating directories..."
mkdir -p sessions-1 sessions-2 sessions-3 sessions-4
mkdir -p data-1 data-2 data-3 data-4

# Stop any existing containers
echo "🛑 Stopping existing containers..."
docker-compose down

# Build and start containers
echo "🔨 Building Docker images..."
docker-compose build

echo "🚀 Starting containers..."
docker-compose up -d

# Wait for services to start
echo "⏳ Waiting for services to start..."
sleep 30

# Check status
echo "📊 Checking container status..."
docker-compose ps

echo ""
echo "✅ WhatsApp Automation is running!"
echo ""
echo "🌐 Access points:"
echo "   Main Load Balancer: http://localhost"
echo "   Instance 1 (Users 1-50): http://localhost:3001"
echo "   Instance 2 (Users 51-100): http://localhost:3002"
echo "   Instance 3 (Users 101-150): http://localhost:3003"
echo "   Instance 4 (Users 151-200): http://localhost:3004"
echo ""
echo "📝 Each instance has its own IP and handles different users automatically!"
echo ""
echo "🔍 View logs: docker-compose logs -f"
echo "🛑 Stop all: docker-compose down"