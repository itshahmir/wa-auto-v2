#!/bin/bash

echo "🚀 Installing WhatsApp Automation for Production"
echo "================================================"

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo "❌ Please don't run this script as root"
    exit 1
fi

# Stop any running API servers
echo "🛑 Stopping any running API servers..."
pkill -f "node index.js --api" || true

# Install Docker if not installed
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo "✅ Docker installed"
fi

# Install Docker Compose if not installed
if ! command -v docker-compose &> /dev/null; then
    echo "📦 Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.21.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo "✅ Docker Compose installed"
fi

# Create directories
echo "📁 Creating directories..."
mkdir -p sessions-1 sessions-2 sessions-3 sessions-4
mkdir -p data-1 data-2 data-3 data-4

# Set proper permissions
sudo chown -R $USER:$USER /home/ubuntu/wa-auto-v2
chmod 755 /home/ubuntu/wa-auto-v2/start-docker.sh

# Install systemd service
echo "⚙️ Installing systemd service..."
sudo cp whatsapp-automation.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable whatsapp-automation.service

# Build Docker images
echo "🔨 Building Docker images..."
docker-compose build

# Start the service
echo "🚀 Starting WhatsApp Automation service..."
sudo systemctl start whatsapp-automation.service

# Wait a bit for containers to start
echo "⏳ Waiting for containers to start..."
sleep 30

# Check status
echo "📊 Checking service status..."
sudo systemctl status whatsapp-automation.service
echo ""
docker-compose ps

echo ""
echo "✅ WhatsApp Automation is now running in production mode!"
echo ""
echo "🎯 Service Management Commands:"
echo "   Start:   sudo systemctl start whatsapp-automation"
echo "   Stop:    sudo systemctl stop whatsapp-automation"
echo "   Status:  sudo systemctl status whatsapp-automation"
echo "   Logs:    sudo journalctl -f -u whatsapp-automation"
echo ""
echo "🐳 Docker Commands:"
echo "   Logs:    docker-compose logs -f"
echo "   Status:  docker-compose ps"
echo "   Restart: docker-compose restart"
echo ""
echo "🌐 API Endpoints:"
echo "   Main Load Balancer: http://$(hostname -I | awk '{print $1}')"
echo "   Instance 1: http://$(hostname -I | awk '{print $1}'):3001"
echo "   Instance 2: http://$(hostname -I | awk '{print $1}'):3002"
echo "   Instance 3: http://$(hostname -I | awk '{print $1}'):3003"
echo "   Instance 4: http://$(hostname -I | awk '{print $1}'):3004"
echo ""
echo "💡 The service will automatically start on server reboot!"