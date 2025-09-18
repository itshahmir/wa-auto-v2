// WhatsApp Status-Only Automation - Clean Implementation
// Optimized browser automation for status operations without Baileys

const path = require('path');
const express = require('express');

// Import clean status-only components
const StatusOnlyAutomation = require('./src/core/StatusOnlyAutomation');
const { WhatsAppAPI } = require('./src/api/server_clean');

// Export for modular usage
module.exports = {
    StatusOnlyAutomation,
    WhatsAppAPI
};

// Main entry point
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.includes('--api')) {
        startAPIServer();
    } else {
        console.log('WhatsApp Status-Only Automation');
        console.log('================================');
        console.log('Usage:');
        console.log('  node index_clean.js --api    Start API server');
        console.log('');
        console.log('Features:');
        console.log('  🎯 Status-only browser automation (no chat loading)');
        console.log('  📱 Optimized for users with many contacts');
        console.log('  🚀 Memory-efficient WhatsApp Web integration');
        console.log('  📊 Clean dashboard interface');
        console.log('');
        process.exit(0);
    }
}

async function startAPIServer() {
    try {
        console.log('🚀 Starting WhatsApp Status-Only Automation API...');
        console.log('===============================================');

        const port = process.env.PORT || 3000;
        const api = new WhatsAppAPI();

        // Add static file serving for dashboard
        const app = api.app;
        app.use(express.static(path.join(__dirname, 'public')));

        // Serve the clean dashboard
        app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index_clean.html'));
        });

        await api.start(port);

        console.log('✅ Status-Only Automation API is ready!');
        console.log(`📊 Dashboard: http://localhost:${port}`);
        console.log(`📡 API Docs: http://localhost:${port}/api-docs`);
        console.log('');
        console.log('🎯 Optimized Features:');
        console.log('  - Browser loads only status functionality');
        console.log('  - No chat/contact loading for better performance');
        console.log('  - Memory-efficient for users with many contacts');
        console.log('  - Clean, modern dashboard interface');

    } catch (error) {
        console.error('❌ Failed to start API server:', error.message);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});