const express = require('express');
const path = require('path');
const { WhatsAppAPI } = require('./src/api/server');

// Create API server
const apiServer = new WhatsAppAPI(3000);

// Serve static files from public directory
apiServer.app.use(express.static(path.join(__dirname, 'public')));

// Catch-all route to serve index.html for any unmatched routes
apiServer.app.get('*', (req, res) => {
    // Skip API routes
    if (req.path.startsWith('/sessions') || req.path.startsWith('/health')) {
        return;
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
apiServer.start();

console.log('🌐 UI available at: http://localhost:3000');
console.log('📡 API available at: http://localhost:3000');
console.log('✨ WhatsApp Automation Server with UI is running!');