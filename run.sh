#!/bin/bash

echo "🚀 WhatsApp Automation Management"
echo "================================="
echo ""

case "$1" in
    start)
        echo "🚀 Starting WhatsApp Automation..."
        # Stop current API servers first
        pkill -f "node index.js --api" || true
        # Start Docker containers
        docker-compose up -d
        sleep 10
        echo "📊 Status:"
        docker-compose ps
        echo ""
        echo "✅ Started! Access at:"
        echo "   🌐 https://whatsapp.social-crm.co.il"
        echo "   📊 Instance 1: https://whatsapp.social-crm.co.il:3001"
        echo "   📊 Instance 2: https://whatsapp.social-crm.co.il:3002"
        echo "   📊 Instance 3: https://whatsapp.social-crm.co.il:3003"
        echo "   📊 Instance 4: https://whatsapp.social-crm.co.il:3004"
        ;;

    stop)
        echo "🛑 Stopping WhatsApp Automation..."
        docker-compose down
        pkill -f "node index.js --api" || true
        echo "✅ Stopped!"
        ;;

    restart)
        echo "🔄 Restarting WhatsApp Automation..."
        $0 stop
        sleep 5
        $0 start
        ;;

    status)
        echo "📊 Current Status:"
        docker-compose ps
        ;;

    logs)
        if [ -z "$2" ]; then
            echo "📋 All logs:"
            docker-compose logs --tail=50
        else
            echo "📋 Instance $2 logs:"
            docker-compose logs --tail=50 "wa-api-$2"
        fi
        ;;

    build)
        echo "🔨 Building containers..."
        docker-compose build
        echo "✅ Build complete!"
        ;;

    *)
        echo "Commands:"
        echo "  start    - Start all containers"
        echo "  stop     - Stop all containers"
        echo "  restart  - Restart all containers"
        echo "  status   - Show status"
        echo "  logs     - Show all logs"
        echo "  logs 1   - Show instance 1 logs"
        echo "  build    - Build containers"
        echo ""
        echo "Example: ./run.sh start"
        ;;
esac