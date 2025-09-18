#!/bin/bash

echo "🌐 Setting up WhatsApp Status Automation for domain: whatsapp.social-crm.co.il"
echo "=================================================================="

# Install nginx if not installed
if ! command -v nginx &> /dev/null; then
    echo "📦 Installing Nginx..."
    sudo apt update
    sudo apt install -y nginx
fi

# Install certbot if not installed
if ! command -v certbot &> /dev/null; then
    echo "🔐 Installing Certbot for SSL..."
    sudo apt install -y certbot python3-certbot-nginx
fi

# Stop nginx temporarily
sudo systemctl stop nginx

# Get SSL certificate from Let's Encrypt
echo "🔐 Getting SSL certificate for whatsapp.social-crm.co.il..."
sudo certbot certonly --standalone \
    --email admin@social-crm.co.il \
    --agree-tos \
    --no-eff-email \
    -d whatsapp.social-crm.co.il

# Update nginx configuration with correct SSL paths
echo "⚙️ Updating Nginx configuration..."
sudo cp nginx_domain.conf /etc/nginx/sites-available/whatsapp.social-crm.co.il

# Update SSL certificate paths in nginx config
sudo sed -i 's|/etc/ssl/certs/whatsapp.social-crm.co.il.crt|/etc/letsencrypt/live/whatsapp.social-crm.co.il/fullchain.pem|g' /etc/nginx/sites-available/whatsapp.social-crm.co.il
sudo sed -i 's|/etc/ssl/private/whatsapp.social-crm.co.il.key|/etc/letsencrypt/live/whatsapp.social-crm.co.il/privkey.pem|g' /etc/nginx/sites-available/whatsapp.social-crm.co.il

# Enable the site
sudo ln -sf /etc/nginx/sites-available/whatsapp.social-crm.co.il /etc/nginx/sites-enabled/

# Remove default nginx site if it exists
sudo rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration
echo "🧪 Testing Nginx configuration..."
sudo nginx -t

if [ $? -eq 0 ]; then
    echo "✅ Nginx configuration is valid"

    # Start nginx
    sudo systemctl start nginx
    sudo systemctl enable nginx

    echo "🚀 Starting WhatsApp Status Automation..."

    # Kill any existing node processes on port 3000
    sudo pkill -f "node.*3000" || true

    # Start the application in background
    cd /home/ubuntu/wa-auto-v2
    nohup node index_clean.js --api > /var/log/whatsapp-automation.log 2>&1 &

    echo "✅ Setup complete!"
    echo ""
    echo "🌐 Your WhatsApp Status Automation is now available at:"
    echo "   https://whatsapp.social-crm.co.il"
    echo ""
    echo "📊 Dashboard: https://whatsapp.social-crm.co.il"
    echo "📡 API Docs: https://whatsapp.social-crm.co.il/api-docs"
    echo "🏥 Health: https://whatsapp.social-crm.co.il/health"
    echo ""
    echo "📝 Logs: tail -f /var/log/whatsapp-automation.log"
    echo ""
    echo "🔄 SSL certificate will auto-renew via certbot"

    # Setup auto-renewal
    echo "⏰ Setting up SSL auto-renewal..."
    sudo systemctl enable certbot.timer
    sudo systemctl start certbot.timer

else
    echo "❌ Nginx configuration test failed"
    exit 1
fi