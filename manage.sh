#!/bin/bash

# WhatsApp Automation Management Script
# ====================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load environment variables
if [ -f .env.docker ]; then
    source .env.docker
else
    echo "❌ .env.docker file not found!"
    exit 1
fi

show_help() {
    echo "🚀 WhatsApp Automation Management"
    echo "================================="
    echo ""
    echo "Commands:"
    echo "  start      - Start all containers"
    echo "  stop       - Stop all containers"
    echo "  restart    - Restart all containers"
    echo "  status     - Show container status"
    echo "  logs       - Show logs (all containers)"
    echo "  logs <num> - Show logs for specific instance (1-4)"
    echo "  update     - Update domain configuration"
    echo "  clean      - Stop and remove all containers"
    echo "  install    - Install for production (auto-start)"
    echo ""
    echo "Examples:"
    echo "  ./manage.sh start"
    echo "  ./manage.sh logs 1"
    echo "  ./manage.sh update yourdomain.com"
}

update_domain() {
    local new_domain="$1"
    if [ -z "$new_domain" ]; then
        echo "❌ Please provide a domain name"
        echo "Usage: ./manage.sh update yourdomain.com"
        exit 1
    fi

    echo "🔧 Updating domain to: $new_domain"

    # Update .env.docker
    sed -i "s/^DOMAIN=.*/DOMAIN=$new_domain/" .env.docker

    # Update nginx.conf if needed
    if [ -f nginx.conf ]; then
        sed -i "s/server_name .*/server_name $new_domain;/" nginx.conf
    fi

    echo "✅ Domain updated to: $new_domain"
    echo "💡 Run './manage.sh restart' to apply changes"
}

start_containers() {
    echo "🚀 Starting WhatsApp Automation containers..."
    docker-compose -f docker-compose.yml up -d
    echo "⏳ Waiting for containers to start..."
    sleep 10
    show_status
}

stop_containers() {
    echo "🛑 Stopping WhatsApp Automation containers..."
    docker-compose -f docker-compose.yml down
    echo "✅ All containers stopped"
}

restart_containers() {
    echo "🔄 Restarting WhatsApp Automation containers..."
    stop_containers
    sleep 5
    start_containers
}

show_status() {
    echo "📊 Container Status:"
    echo "==================="
    docker-compose ps
    echo ""
    echo "🌐 Access URLs:"
    echo "   Main Load Balancer: http://$DOMAIN"
    echo "   Instance 1 (Users $INSTANCE_1_USERS): http://$DOMAIN:$INSTANCE_1_PORT"
    echo "   Instance 2 (Users $INSTANCE_2_USERS): http://$DOMAIN:$INSTANCE_2_PORT"
    echo "   Instance 3 (Users $INSTANCE_3_USERS): http://$DOMAIN:$INSTANCE_3_PORT"
    echo "   Instance 4 (Users $INSTANCE_4_USERS): http://$DOMAIN:$INSTANCE_4_PORT"
}

show_logs() {
    local instance="$1"
    if [ -z "$instance" ]; then
        echo "📋 Showing logs for all containers:"
        docker-compose logs -f --tail=50
    else
        if [[ "$instance" =~ ^[1-4]$ ]]; then
            echo "📋 Showing logs for instance $instance:"
            docker-compose logs -f --tail=50 "wa-api-$instance"
        else
            echo "❌ Invalid instance number. Use 1, 2, 3, or 4"
            exit 1
        fi
    fi
}

clean_containers() {
    echo "🧹 Cleaning up all containers and volumes..."
    read -p "⚠️  This will remove all containers and data. Continue? (y/N): " confirm
    if [[ $confirm =~ ^[Yy]$ ]]; then
        docker-compose down -v --remove-orphans
        docker system prune -f
        echo "✅ Cleanup completed"
    else
        echo "❌ Cleanup cancelled"
    fi
}

install_production() {
    echo "⚙️ Installing for production..."

    # Make sure Docker is installed
    if ! command -v docker &> /dev/null; then
        echo "📦 Installing Docker..."
        curl -fsSL https://get.docker.com | sudo sh
        sudo usermod -aG docker $USER
    fi

    # Install Docker Compose if needed
    if ! command -v docker-compose &> /dev/null; then
        echo "📦 Installing Docker Compose..."
        sudo curl -L "https://github.com/docker/compose/releases/download/v2.21.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        sudo chmod +x /usr/local/bin/docker-compose
    fi

    # Create systemd service
    sudo tee /etc/systemd/system/whatsapp-automation.service > /dev/null <<EOF
[Unit]
Description=WhatsApp Automation Docker Containers
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
TimeoutStartSec=0
User=$USER
Group=docker

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable whatsapp-automation.service

    echo "✅ Production installation complete!"
    echo "💡 Service will auto-start on server reboot"
    echo "🎯 Manage with: sudo systemctl start/stop/status whatsapp-automation"
}

# Main script logic
case "$1" in
    start)
        start_containers
        ;;
    stop)
        stop_containers
        ;;
    restart)
        restart_containers
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$2"
        ;;
    update)
        update_domain "$2"
        ;;
    clean)
        clean_containers
        ;;
    install)
        install_production
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo "❌ Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac