const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const { SessionManager } = require('../core/SessionManager');
const WebSocketStatusHandler = require('../core/WebSocketStatusHandler');
require('dotenv').config();

// ============================================
// Express API Server
// ============================================
class WhatsAppAPI {
    constructor(port = 3000) {
        this.app = express();
        this.port = port;
        this.sessionManager = new SessionManager('./data/whatsapp.db.json');

        // Baileys status handlers for direct WebSocket (separate from main system)
        this.baileysHandlers = new Map();
        this.baileysQRCodes = new Map();

        this.setupMiddleware();
        this.setupRoutes();

        // Clean up inactive sessions every 30 minutes
        setInterval(() => {
            this.sessionManager.cleanupInactiveSessions(60);
        }, 30 * 60 * 1000);
    }

    setupMiddleware() {
        const path = require('path');

        // Session middleware for dashboard authentication
        this.app.use(session({
            secret: process.env.SESSION_SECRET || 'default-secret-key',
            resave: false,
            saveUninitialized: false,
            cookie: {
                maxAge: 24 * 60 * 60 * 1000 // 24 hours
            }
        }));

        // Authentication middleware for dashboard routes only
        const authMiddleware = (req, res, next) => {
            // Only check auth for the main dashboard page
            if (req.path === '/' || req.path === '/index.html') {
                if (!req.session.authenticated) {
                    return res.sendFile(path.join(__dirname, '..', '..', 'public', 'login.html'));
                }
            }
            next();
        };

        this.app.use(authMiddleware);

        // Serve static files
        this.app.use(express.static(path.join(__dirname, '..', '..', 'public')));

        // Increase limit to 100MB for video/image uploads
        // Use express built-in middleware with higher limits
        this.app.use(express.json({ limit: '100mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '100mb' }));
        this.app.use(bodyParser.json({ limit: '100mb' }));
        this.app.use(bodyParser.urlencoded({ extended: true, limit: '100mb', parameterLimit: 50000 }));

        // File upload middleware
        this.app.use(fileUpload({
            limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
            useTempFiles: false,
            tempFileDir: '/tmp/'
        }));

        // CORS
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            next();
        });
    }

    // Helper function to wait for re-authentication
    async waitForReAuthentication(sessionId, timeout = 60) {
        console.log(`[${sessionId}] Waiting for re-authentication...`);

        let attempts = 0;
        while (attempts < timeout) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;

            const currentStatus = this.sessionManager.sessionMetadata.get(sessionId)?.status;

            if (currentStatus === 'ready') {
                console.log(`[${sessionId}] Re-authentication successful after ${attempts} seconds`);
                return { success: true, status: currentStatus };
            } else if (currentStatus === 'failed') {
                return { success: false, status: currentStatus, error: 'Re-authentication failed' };
            }

            // Log progress every 5 seconds
            if (attempts % 5 === 0) {
                console.log(`[${sessionId}] Still waiting for re-authentication... (${attempts}s)`);
            }
        }

        return {
            success: false,
            status: this.sessionManager.sessionMetadata.get(sessionId)?.status,
            error: 'Re-authentication timeout'
        };
    }

    setupRoutes() {
        // Authentication routes for dashboard only
        this.app.post('/login', (req, res) => {
            const { password } = req.body;
            const adminPassword = process.env.DASHBOARD_PASSWORD || 'admin123';

            if (password === adminPassword) {
                req.session.authenticated = true;
                res.json({ success: true });
            } else {
                res.status(401).json({ success: false, error: 'Invalid password' });
            }
        });

        this.app.post('/logout', (req, res) => {
            req.session.destroy();
            res.json({ success: true });
        });

        this.app.get('/check-auth', (req, res) => {
            res.json({ authenticated: !!req.session.authenticated });
        });

        // ============================================
        // BAILEYS DIRECT WEBSOCKET ENDPOINTS (NO BROWSER)
        // ============================================

        // Connect Baileys for user
        this.app.post('/baileys/connect/:userId', async (req, res) => {
            const { userId } = req.params;

            try {
                // Check if already connected
                if (this.baileysHandlers.has(userId)) {
                    const handler = this.baileysHandlers.get(userId);
                    const status = handler.getStatus();
                    return res.json({
                        success: true,
                        message: 'Already connected',
                        status: status
                    });
                }

                // TODO: Baileys handler functionality temporarily disabled
                /*
                // Create new Baileys handler
                const handler = new BaileysStatusHandler(userId);

                // Set event handlers
                handler.setEventHandlers({
                    onQRCode: (qr) => {
                        this.baileysQRCodes.set(userId, qr);
                        console.log(`[Baileys-${userId}] QR Code ready for scanning`);
                    },
                    onConnected: () => {
                        console.log(`[Baileys-${userId}] Successfully connected via WebSocket`);
                    },
                    onDisconnected: () => {
                        console.log(`[Baileys-${userId}] Disconnected`);
                        this.baileysHandlers.delete(userId);
                        this.baileysQRCodes.delete(userId);
                    }
                });

                // Store handler
                this.baileysHandlers.set(userId, handler);

                // Start connection
                const connected = await handler.connect();

                if (connected) {
                    res.json({
                        success: true,
                        message: 'Baileys connection initiated',
                        userId: userId,
                        needsAuth: !handler.isAuthenticated
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: 'Failed to initiate Baileys connection'
                    });
                }
                */

                // Temporary response while Baileys is disabled
                res.status(501).json({
                    success: false,
                    error: 'Baileys functionality temporarily disabled'
                });

            } catch (error) {
                console.error(`[Baileys-${userId}] Connection error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: `Baileys connection failed: ${error.message}`
                });
            }
        });

        // Get QR code for Baileys authentication
        this.app.get('/baileys/qr/:userId', (req, res) => {
            const { userId } = req.params;

            if (this.baileysQRCodes.has(userId)) {
                const qr = this.baileysQRCodes.get(userId);
                res.json({
                    success: true,
                    qr: qr,
                    userId: userId
                });
            } else {
                res.status(404).json({
                    success: false,
                    error: 'QR code not available. Please connect first.'
                });
            }
        });

        // Send text status via Baileys WebSocket
        this.app.post('/baileys/status/text/:userId', async (req, res) => {
            const { userId } = req.params;
            const { content, options = {} } = req.body;

            try {
                if (!this.baileysHandlers.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Baileys not connected for this user. Please connect first.'
                    });
                }

                const handler = this.baileysHandlers.get(userId);
                const result = await handler.sendTextStatus(content, options);

                res.json({
                    success: true,
                    message: 'Status sent successfully via Baileys WebSocket',
                    method: result.method,
                    messageId: result.messageId,
                    timestamp: result.timestamp
                });

            } catch (error) {
                console.error(`[Baileys-${userId}] Status send error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Send image status via Baileys WebSocket
        this.app.post('/baileys/status/image/:userId', async (req, res) => {
            const { userId } = req.params;
            const { caption, options = {} } = req.body;

            try {
                if (!this.baileysHandlers.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Baileys not connected for this user. Please connect first.'
                    });
                }

                if (!req.files || !req.files.image) {
                    return res.status(400).json({
                        success: false,
                        error: 'Image file is required'
                    });
                }

                const handler = this.baileysHandlers.get(userId);
                const imageBuffer = req.files.image.data;
                const result = await handler.sendImageStatus(imageBuffer, caption, options);

                res.json({
                    success: true,
                    message: 'Image status sent successfully via Baileys WebSocket',
                    method: result.method,
                    messageId: result.messageId,
                    timestamp: result.timestamp
                });

            } catch (error) {
                console.error(`[Baileys-${userId}] Image status send error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Send video status via Baileys WebSocket
        this.app.post('/baileys/status/video/:userId', async (req, res) => {
            const { userId } = req.params;
            const { caption, options = {} } = req.body;

            try {
                if (!this.baileysHandlers.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Baileys not connected for this user. Please connect first.'
                    });
                }

                if (!req.files || !req.files.video) {
                    return res.status(400).json({
                        success: false,
                        error: 'Video file is required'
                    });
                }

                const handler = this.baileysHandlers.get(userId);
                const videoBuffer = req.files.video.data;
                const result = await handler.sendVideoStatus(videoBuffer, caption, options);

                res.json({
                    success: true,
                    message: 'Video status sent successfully via Baileys WebSocket',
                    method: result.method,
                    messageId: result.messageId,
                    timestamp: result.timestamp
                });

            } catch (error) {
                console.error(`[Baileys-${userId}] Video status send error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get Baileys connection status
        this.app.get('/baileys/status/:userId', (req, res) => {
            const { userId } = req.params;

            if (this.baileysHandlers.has(userId)) {
                const handler = this.baileysHandlers.get(userId);
                const status = handler.getStatus();
                res.json({
                    success: true,
                    ...status
                });
            } else {
                res.json({
                    success: false,
                    connected: false,
                    authenticated: false,
                    message: 'Baileys not connected for this user'
                });
            }
        });

        // Disconnect Baileys
        this.app.delete('/baileys/disconnect/:userId', async (req, res) => {
            const { userId } = req.params;

            try {
                if (this.baileysHandlers.has(userId)) {
                    const handler = this.baileysHandlers.get(userId);
                    await handler.disconnect();
                    this.baileysHandlers.delete(userId);
                    this.baileysQRCodes.delete(userId);
                }

                res.json({
                    success: true,
                    message: 'Baileys disconnected successfully',
                    userId: userId
                });

            } catch (error) {
                console.error(`[Baileys-${userId}] Disconnect error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Health check with statistics
        this.app.get('/health', (req, res) => {
            const stats = this.sessionManager.getStatistics();
            res.json({
                status: 'ok',
                ...stats,
                uptime: process.uptime()
            });
        });

        // Session management
        this.app.post('/sessions/create', async (req, res) => {
            try {
                const { userId, phoneNumber, authMethod = 'qr' } = req.body;

                if (!userId) {
                    return res.status(400).json({ error: 'userId is required' });
                }

                if (authMethod === 'code' && !phoneNumber) {
                    return res.status(400).json({ error: 'phoneNumber is required for pairing code authentication' });
                }

                const sessionId = await this.sessionManager.createSession(userId, phoneNumber);
                const automation = this.sessionManager.getSession(sessionId);

                let qrCode = null;
                let pairingCode = null;
                let authData = null;

                // Set up event listeners for this session BEFORE initializing
                let qrPromiseResolve = null;
                const qrPromise = new Promise(resolve => {
                    qrPromiseResolve = resolve;
                });

                automation.on('qr', (data) => {
                    console.log(`QR Code generated for session ${data.sessionId}`);
                    qrCode = data.qr;
                    if (qrPromiseResolve) {
                        qrPromiseResolve(data.qr);
                        qrPromiseResolve = null;
                    }
                });

                automation.on('pairingCodeGenerated', (data) => {
                    console.log(`Pairing code generated for session ${data.sessionId}`);
                    pairingCode = data.code;
                });

                automation.on('authenticated', (data) => {
                    this.sessionManager.updateSessionStatus(data.sessionId, 'authenticated');
                });

                automation.on('ready', (data) => {
                    this.sessionManager.updateSessionStatus(data.sessionId, 'ready');
                });

                automation.on('authenticationFailed', (data) => {
                    console.log(`[${data.sessionId}] Authentication failed: ${data.reason}`);
                    this.sessionManager.updateSessionStatus(data.sessionId, 'failed');
                });

                // Initialize and wait for QR/code generation
                await automation.initialize();

                // Wait for WA-JS to be ready
                try {
                    console.log(`[${sessionId}] Waiting for WA-JS to initialize...`);
                    await automation.page.waitForFunction(
                        () => typeof window.WPP !== 'undefined' && window.WPP.isReady,
                        {},
                        { timeout: 30000 }
                    );
                    console.log(`[${sessionId}] WA-JS initialized successfully`);

                    // Configure WPP
                    await automation.page.evaluate(() => {
                        if (window.WPPConfig) {
                            window.WPPConfig.sendStatusToDevice = true;
                            window.WPPConfig.syncAllStatus = false;
                        }
                    });
                } catch (waJsError) {
                    console.log(`[${sessionId}] WA-JS initialization failed:`, waJsError.message);
                }

                // Check if already logged in
                const isLoggedIn = await automation.checkLoginStatus();

                if (isLoggedIn) {
                    // Already authenticated
                    this.sessionManager.updateSessionStatus(sessionId, 'ready');
                    // Use WebSocket-based handler exclusively
                    automation.statusHandler = new WebSocketStatusHandler(automation.page, automation);

                    // Get and store the phone number for already authenticated sessions
                    const connectedPhoneNumber = await automation.getAuthenticatedPhoneNumber();
                    if (connectedPhoneNumber) {
                        console.log(`[${sessionId}] Already authenticated with phone: ${connectedPhoneNumber}`);
                        this.sessionManager.updateSessionPhoneNumber(sessionId, connectedPhoneNumber);
                    }

                    res.json({
                        success: true,
                        sessionId,
                        status: 'ready',
                        message: 'Session already authenticated and ready',
                        phoneNumber: connectedPhoneNumber
                    });
                } else {
                    // Need authentication - setup events first
                    await automation.setupAuthenticationEvents();

                    if (authMethod === 'code' && phoneNumber) {
                        console.log(`[${sessionId}] Waiting for authentication required state...`);

                        // Wait for the "Authentication required" event which means WPP is ready
                        let authRequiredFired = false;
                        const authRequiredPromise = new Promise((resolve) => {
                            automation.on('requireAuth', () => {
                                authRequiredFired = true;
                                resolve();
                            });
                            // Timeout after 10 seconds if event doesn't fire
                            setTimeout(() => resolve(), 10000);
                        });

                        await authRequiredPromise;

                        if (!authRequiredFired) {
                            console.log(`[${sessionId}] Auth required event didn't fire, but proceeding...`);
                        }

                        // Now WPP should be ready for pairing code generation
                        console.log(`[${sessionId}] Generating pairing code...`);
                        const code = await automation.requestPairingCode(phoneNumber);

                        if (code) {
                            authData = {
                                type: 'pairing_code',
                                code: code,
                                phoneNumber: phoneNumber
                            };
                        } else {
                            return res.status(500).json({
                                error: 'Failed to generate pairing code',
                                sessionId
                            });
                        }
                    } else {
                        // QR Code authentication
                        // Wait for event listener to capture QR or try to get it directly
                        const qrTimeout = new Promise((resolve) => setTimeout(() => resolve(null), 10000));

                        // Race between event listener and timeout
                        const capturedQR = await Promise.race([qrPromise, qrTimeout]);

                        if (capturedQR) {
                            qrCode = capturedQR;
                            console.log(`[${sessionId}] QR captured from event listener`);
                        } else {
                            // Try direct capture as fallback
                            console.log(`[${sessionId}] Attempting direct QR capture...`);

                            // Wait for QR element
                            try {
                                await automation.page.waitForSelector('[data-testid="qrcode"], canvas[aria-label*="scan"], .landing-main', {
                                    timeout: 5000
                                });
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            } catch (error) {
                                console.log(`[${sessionId}] QR element wait timeout`);
                            }

                            // Try to get QR code directly
                            for (let i = 0; i < 5; i++) {
                                try {
                                    const authCode = await automation.page.evaluate(() => {
                                        if (window.WPP && window.WPP.conn && window.WPP.conn.getAuthCode) {
                                            return window.WPP.conn.getAuthCode();
                                        }
                                        return null;
                                    });

                                    if (authCode && authCode.fullCode) {
                                        qrCode = authCode.fullCode;
                                        console.log(`[${sessionId}] QR captured directly on attempt ${i + 1}`);
                                        break;
                                    }
                                } catch (error) {
                                    console.log(`[${sessionId}] Direct capture attempt ${i + 1} failed`);
                                }
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        }

                        if (qrCode) {
                            authData = {
                                type: 'qr_code',
                                qr: qrCode
                            };
                            console.log(`[${sessionId}] QR code ready for response`);
                        }

                        if (!qrCode) {
                            // Don't remove session yet - it might still work
                            console.error(`[${sessionId}] Failed to capture QR code after multiple attempts`);
                            // Try one more time with a different approach
                            try {
                                const qrData = await automation.page.evaluate(() => {
                                    // Try to get QR from canvas element
                                    const canvas = document.querySelector('canvas[aria-label*="scan"]');
                                    if (canvas) {
                                        return canvas.toDataURL();
                                    }
                                    return null;
                                });

                                if (qrData) {
                                    authData = {
                                        type: 'qr_code',
                                        qr: qrData,
                                        format: 'data_url'
                                    };
                                    console.log(`[${sessionId}] QR code captured from canvas`);
                                } else {
                                    // Still return success but without QR - user can get it from /sessions/:id/qr
                                    authData = {
                                        type: 'qr_code',
                                        qr: null,
                                        message: 'QR code is displayed in browser. Use GET /sessions/:id/qr to retrieve it.'
                                    };
                                }
                            } catch (canvasError) {
                                console.log(`[${sessionId}] Canvas QR extraction failed:`, canvasError.message);
                                authData = {
                                    type: 'qr_code',
                                    qr: null,
                                    message: 'QR code is displayed in browser. Use GET /sessions/:id/qr to retrieve it.'
                                };
                            }
                        }
                    }

                    // Listen for phone number capture event
                    automation.on('phoneNumberCaptured', (data) => {
                        console.log(`[${sessionId}] Phone number captured: ${data.phoneNumber}`);
                        this.sessionManager.updateSessionPhoneNumber(sessionId, data.phoneNumber);
                    });

                    // Start authentication monitoring in background - DO NOT await
                    // This keeps the browser alive while waiting for authentication
                    automation.handleLogin(authMethod, phoneNumber).then(async (loginSuccess) => {
                        if (loginSuccess) {
                            console.log(`[${sessionId}] Authentication successful, waiting for WPP.isFullReady...`);

                            // Wait for WPP to be fully ready before marking session as ready
                            try {
                                await automation.page.waitForFunction(() => {
                                    return typeof window.WPP !== 'undefined' && window.WPP.isFullReady;
                                }, { timeout: 30000 });

                                // Use WebSocket-based handler exclusively
                    automation.statusHandler = new WebSocketStatusHandler(automation.page, automation);
                                this.sessionManager.updateSessionStatus(sessionId, 'ready');
                                console.log(`[${sessionId}] Session fully ready with WPP.isFullReady confirmed`);

                                // Keep browser alive for status operations
                                console.log(`[${sessionId}] Keeping browser alive for status operations`);
                            } catch (error) {
                                console.error(`[${sessionId}] WPP.isFullReady timeout:`, error.message);
                                this.sessionManager.updateSessionStatus(sessionId, 'failed');
                                await this.sessionManager.removeSession(sessionId);
                            }
                        } else {
                            this.sessionManager.updateSessionStatus(sessionId, 'failed');
                            console.log(`[${sessionId}] Authentication failed, cleaning up session`);
                            await this.sessionManager.removeSession(sessionId);
                        }
                    }).catch(async (error) => {
                        console.error(`Session ${sessionId} login error:`, error);
                        this.sessionManager.updateSessionStatus(sessionId, 'failed');
                        await this.sessionManager.removeSession(sessionId);
                    });

                    // Return authentication data immediately
                    res.json({
                        success: true,
                        sessionId,
                        status: 'waiting_for_authentication',
                        authData,
                        message: authMethod === 'code'
                            ? 'Pairing code generated. Enter this code in WhatsApp on your phone.'
                            : 'QR code generated. Scan with WhatsApp to authenticate.'
                    });
                }
            } catch (error) {
                console.error('Session creation error:', error);
                res.status(500).json({ error: error.message });
            }
        });

        this.app.get('/sessions', (req, res) => {
            const regularSessions = this.sessionManager.getAllSessions();

            // Add Baileys sessions
            const baileysSessions = [];
            for (const [userId, handler] of this.baileysHandlers.entries()) {
                const status = handler.getStatus();
                baileysSessions.push({
                    sessionId: `baileys-${userId}`,
                    userId: userId,
                    type: 'baileys',
                    status: status.authenticated ? 'authenticated' : (status.connected ? 'connecting' : 'pending'),
                    createdAt: new Date().toISOString(), // We don't track creation time for Baileys
                    lastActivity: new Date().toISOString(),
                    method: 'baileys_websocket',
                    isConnected: status.connected,
                    isAuthenticated: status.authenticated,
                    retryCount: status.retryCount
                });
            }

            res.json({
                sessions: [...regularSessions, ...baileysSessions],
                baileysSessions: baileysSessions.length,
                regularSessions: regularSessions.length
            });
        });

        this.app.get('/sessions/:sessionId/status', (req, res) => {
            const metadata = this.sessionManager.sessionMetadata.get(req.params.sessionId);
            if (!metadata) {
                return res.status(404).json({ error: 'Session not found' });
            }
            res.json(metadata);
        });

        this.app.get('/sessions/:sessionId/qr', async (req, res) => {
            // Auto-start session if it exists but not running
            const result = await this.sessionManager.autoStartSession(req.params.sessionId);
            if (!result) {
                return res.status(404).json({ error: 'Session not found' });
            }

            // Check if result contains auth data
            const automation = result.automation || result;
            const metadata = this.sessionManager.sessionMetadata.get(req.params.sessionId);

            // If session needs auth and we have auth data, return it
            if (metadata && metadata.status === 'requires_auth' && metadata.authData) {
                return res.json({
                    sessionId: req.params.sessionId,
                    status: metadata.status,
                    authData: metadata.authData
                });
            }

            // Get current QR code
            try {
                const sessionStatus = this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status;

                if (sessionStatus === 'ready' || sessionStatus === 'authenticated') {
                    return res.json({
                        qr: null,
                        status: sessionStatus,
                        message: 'Session already authenticated'
                    });
                }

                const authCode = await automation.page.evaluate(() => {
                    if (window.WPP && window.WPP.conn && window.WPP.conn.getAuthCode) {
                        return window.WPP.conn.getAuthCode();
                    }
                    return null;
                });

                if (authCode && authCode.fullCode) {
                    res.json({
                        qr: authCode.fullCode,
                        status: sessionStatus
                    });
                } else {
                    // Try to get QR from canvas
                    const qrData = await automation.page.evaluate(() => {
                        const canvas = document.querySelector('canvas[aria-label*="scan"]');
                        if (canvas) {
                            return canvas.toDataURL();
                        }
                        return null;
                    });

                    res.json({
                        qr: qrData || automation.currentQRUrl,
                        status: sessionStatus,
                        format: qrData ? 'data_url' : 'text'
                    });
                }
            } catch (error) {
                console.error('Error getting QR:', error);
                res.json({
                    qr: automation.currentQRUrl,
                    status: this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status,
                    error: error.message
                });
            }
        });

        this.app.delete('/sessions/:sessionId', async (req, res) => {
            try {
                await this.sessionManager.removeSession(req.params.sessionId);
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Status operations
        this.app.post('/sessions/:sessionId/status/text', async (req, res) => {
            try {
                // Check session status first
                const sessionStatus = this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status;

                // Don't attempt to start session if it's waiting for authentication
                if (sessionStatus === 'requires_auth' || sessionStatus === 'waiting_for_authentication') {
                    const metadata = this.sessionManager.sessionMetadata.get(req.params.sessionId);
                    return res.status(503).json({
                        error: 'Session requires authentication. Please log in first.',
                        status: sessionStatus,
                        needsAuth: true,
                        authData: metadata?.authData || null
                    });
                }

                // Auto-start session if it exists but not running
                let result = await this.sessionManager.autoStartSession(req.params.sessionId);

                if (!result) {
                    return res.status(404).json({ error: 'Session not found' });
                }

                // Handle auth data if returned
                let automation = result.automation || result;
                const metadata = this.sessionManager.sessionMetadata.get(req.params.sessionId);

                // If session needs re-auth and we have auth data, return it
                if (metadata && metadata.status === 'requires_auth' && metadata.authData) {
                    return res.status(401).json({
                        error: 'Session requires re-authentication',
                        status: metadata.status,
                        needsAuth: true,
                        authData: metadata.authData
                    });
                }

                // Initialize status handler immediately for ultra-fast response
                if (!automation.statusHandler && automation?.page) {
                    try {
                        const StatusHandler = require('../core/StatusHandler');
                        automation.statusHandler = new StatusHandler(automation.page, automation);
                        console.log(`[${req.params.sessionId}] StatusHandler initialized immediately for fast response`);
                    } catch (e) {
                        console.log(`[${req.params.sessionId}] StatusHandler initialization failed:`, e.message);
                    }
                }

                // If still no status handler, return error immediately - no waiting
                if (!automation.statusHandler) {
                    return res.status(503).json({
                        error: 'Status handler not available - session may not be ready',
                        status: this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status
                    });
                }

                const { content, options } = req.body;

                // Actually wait for the status to be sent and get the real result
                try {
                    const result = await automation.statusHandler.sendTextStatus(content, options || {});

                    this.sessionManager.updateSessionStatus(req.params.sessionId, 'active');

                    if (result && result.success) {
                        res.json({
                            success: true,
                            message: 'Text status sent successfully',
                            method: result.method,
                            result: result.result
                        });
                    } else {
                        res.status(500).json({
                            success: false,
                            error: 'Status send failed - no result returned',
                            details: result
                        });
                    }
                } catch (statusError) {
                    console.error(`[${req.params.sessionId}] Text status send error:`, statusError.message);
                    res.status(500).json({
                        success: false,
                        error: `Failed to send status: ${statusError.message}`,
                        needsAuth: statusError.message.includes('authentication') || statusError.message.includes('not ready')
                    });
                }

                // Don't close browser - keep it open for subsequent operations
                // await this.sessionManager.closeBrowserIfNotAwaitingAuth(req.params.sessionId);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/sessions/:sessionId/status/image', async (req, res) => {
            try {
                // Check session status first
                const sessionStatus = this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status;

                // Don't attempt to start session if it's waiting for authentication
                if (sessionStatus === 'requires_auth' || sessionStatus === 'waiting_for_authentication') {
                    const metadata = this.sessionManager.sessionMetadata.get(req.params.sessionId);
                    return res.status(503).json({
                        error: 'Session requires authentication. Please log in first.',
                        status: sessionStatus,
                        needsAuth: true,
                        authData: metadata?.authData || null
                    });
                }

                // Auto-start session if it exists but not running
                let result = await this.sessionManager.autoStartSession(req.params.sessionId);

                if (!result) {
                    return res.status(404).json({ error: 'Session not found' });
                }

                // Handle auth data if returned
                let automation = result.automation || result;
                const metadata = this.sessionManager.sessionMetadata.get(req.params.sessionId);

                // If session needs re-auth and we have auth data, return it
                if (metadata && metadata.status === 'requires_auth' && metadata.authData) {
                    return res.status(401).json({
                        error: 'Session requires re-authentication',
                        status: metadata.status,
                        needsAuth: true,
                        authData: metadata.authData
                    });
                }

                // Initialize status handler immediately for ultra-fast response
                if (!automation.statusHandler && automation?.page) {
                    try {
                        const StatusHandler = require('../core/StatusHandler');
                        automation.statusHandler = new StatusHandler(automation.page, automation);
                        console.log(`[${req.params.sessionId}] StatusHandler initialized immediately for fast response`);
                    } catch (e) {
                        console.log(`[${req.params.sessionId}] StatusHandler initialization failed:`, e.message);
                    }
                }

                // If still no status handler, return error immediately - no waiting
                if (!automation.statusHandler) {
                    return res.status(503).json({
                        error: 'Status handler not available - session may not be ready',
                        status: this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status
                    });
                }

                const { content, options } = req.body;
                // Send status without waiting for the result to prevent delays and double sends
                automation.statusHandler.sendImageStatus(content, options || {}).catch(error => {
                    console.error(`[${req.params.sessionId}] Image status send error:`, error);
                });

                this.sessionManager.updateSessionStatus(req.params.sessionId, 'active');
                res.json({ success: true, message: 'Image status sent successfully' });

                // Don't close browser - keep it open for subsequent operations
                // await this.sessionManager.closeBrowserIfNotAwaitingAuth(req.params.sessionId);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/sessions/:sessionId/status/video', async (req, res) => {
            try {
                // Check session status first
                const sessionStatus = this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status;

                // Don't attempt to start session if it's waiting for authentication
                if (sessionStatus === 'requires_auth' || sessionStatus === 'waiting_for_authentication') {
                    const metadata = this.sessionManager.sessionMetadata.get(req.params.sessionId);
                    return res.status(503).json({
                        error: 'Session requires authentication. Please log in first.',
                        status: sessionStatus,
                        needsAuth: true,
                        authData: metadata?.authData || null
                    });
                }

                // Auto-start session if it exists but not running
                let result = await this.sessionManager.autoStartSession(req.params.sessionId);

                if (!result) {
                    return res.status(404).json({ error: 'Session not found' });
                }

                // Handle auth data if returned
                let automation = result.automation || result;
                const metadata = this.sessionManager.sessionMetadata.get(req.params.sessionId);

                // If session needs re-auth and we have auth data, return it
                if (metadata && metadata.status === 'requires_auth' && metadata.authData) {
                    return res.status(401).json({
                        error: 'Session requires re-authentication',
                        status: metadata.status,
                        needsAuth: true,
                        authData: metadata.authData
                    });
                }

                // Initialize status handler immediately for ultra-fast response
                if (!automation.statusHandler && automation?.page) {
                    try {
                        const StatusHandler = require('../core/StatusHandler');
                        automation.statusHandler = new StatusHandler(automation.page, automation);
                        console.log(`[${req.params.sessionId}] StatusHandler initialized immediately for fast response`);
                    } catch (e) {
                        console.log(`[${req.params.sessionId}] StatusHandler initialization failed:`, e.message);
                    }
                }

                // If still no status handler, return error immediately - no waiting
                if (!automation.statusHandler) {
                    return res.status(503).json({
                        error: 'Status handler not available - session may not be ready',
                        status: this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status
                    });
                }

                const { content, options } = req.body;
                // Send status without waiting for the result to prevent delays and double sends
                automation.statusHandler.sendVideoStatus(content, options || {}).catch(error => {
                    console.error(`[${req.params.sessionId}] Video status send error:`, error);
                });

                this.sessionManager.updateSessionStatus(req.params.sessionId, 'active');
                res.json({ success: true, message: 'Video status sent successfully' });

                // Don't close browser - keep it open for subsequent operations
                // await this.sessionManager.closeBrowserIfNotAwaitingAuth(req.params.sessionId);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.get('/sessions/:sessionId/status/my', async (req, res) => {
            try {
                // Check session status first
                let sessionStatus = this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status;

                // Don't attempt to start session if it's waiting for initial authentication
                if (sessionStatus === 'waiting_for_authentication') {
                    return res.status(503).json({
                        error: 'Session requires authentication. Please log in first.',
                        status: sessionStatus,
                        needsAuth: true
                    });
                }

                // Auto-start session if it exists but not running
                let result = await this.sessionManager.autoStartSession(req.params.sessionId);

                if (!result) {
                    return res.status(404).json({ error: 'Session not found' });
                }

                // Check if result contains auth data (for re-authentication scenarios)
                let automation = result.automation || result;
                const authData = result.authData;

                // Check if session needs re-authentication
                sessionStatus = this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status;
                const metadata = this.sessionManager.sessionMetadata.get(req.params.sessionId);

                if (sessionStatus === 'requires_auth') {
                    // Return auth data immediately if available
                    if (metadata && metadata.authData) {
                        return res.status(401).json({
                            error: 'Session requires re-authentication',
                            status: sessionStatus,
                            needsAuth: true,
                            authData: metadata.authData
                        });
                    }

                    // Wait a bit for auth data to be generated
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    // Check again for auth data
                    const updatedMetadata = this.sessionManager.sessionMetadata.get(req.params.sessionId);
                    if (updatedMetadata && updatedMetadata.authData) {
                        return res.status(401).json({
                            error: 'Session requires re-authentication',
                            status: sessionStatus,
                            needsAuth: true,
                            authData: updatedMetadata.authData
                        });
                    }

                    const authResult = await this.waitForReAuthentication(req.params.sessionId);

                    if (!authResult.success) {
                        return res.status(503).json({
                            error: authResult.error === 'Re-authentication timeout'
                                ? 'Re-authentication timeout. Please check WhatsApp and scan the QR code.'
                                : 'Re-authentication failed. Please try again.',
                            status: authResult.status,
                            needsAuth: true
                        });
                    }

                    // Re-get the automation instance as it might have been updated
                    automation = this.sessionManager.getSession(req.params.sessionId);
                }

                // Wait for status handler to be initialized if session was just started
                // Try up to 20 times with 1 second delays (20 seconds total)
                let attempts = 0;
                while (!automation.statusHandler && attempts < 20) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    attempts++;

                    // Re-check the automation instance
                    automation = this.sessionManager.getSession(req.params.sessionId);

                    // Also check if WhatsApp is ready
                    if (automation?.page) {
                        try {
                            // Check if WA is loaded and authenticated
                            const isReady = await automation.page.evaluate(() => {
                                return window.WPP && window.WPP.isReady && window.WPP.isReady() &&
                                       window.WPP.conn && window.WPP.conn.isAuthenticated();
                            });

                            if (isReady && !automation.statusHandler) {
                                // Initialize status handler if WA is ready but handler is missing
                                const StatusHandler = require('../core/StatusHandler');
                                automation.statusHandler = new StatusHandler(automation.page, automation);
                                console.log(`[${req.params.sessionId}] StatusHandler initialized after ${attempts} attempts`);
                            }
                        } catch (e) {
                            // Page might not be ready yet
                        }
                    }

                    // Check if status changed to ready
                    if (this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status === 'ready') {
                        // Give it a bit more time for handler initialization
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                // Final check
                if (!automation.statusHandler) {
                    return res.status(503).json({
                        error: 'Session is starting up, please try again in a few seconds',
                        status: this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status
                    });
                }

                // console.log("Get My Status Fired");
                const status = await automation.statusHandler.getMyStatus();
                this.sessionManager.updateSessionStatus(req.params.sessionId, 'active');
                res.json({ status, success: true });

                // Don't close browser - keep it open for subsequent operations
                // await this.sessionManager.closeBrowserIfNotAwaitingAuth(req.params.sessionId);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.delete('/sessions/:sessionId/status/:msgId', async (req, res) => {
            try {
                // Auto-start session if it exists but not running
                let result = await this.sessionManager.autoStartSession(req.params.sessionId);

                if (!result) {
                    return res.status(404).json({ error: 'Session not found' });
                }

                // Handle auth data if returned
                let automation = result.automation || result;
                const metadata = this.sessionManager.sessionMetadata.get(req.params.sessionId);

                // If session needs re-auth and we have auth data, return it
                if (metadata && metadata.status === 'requires_auth' && metadata.authData) {
                    return res.status(401).json({
                        error: 'Session requires re-authentication',
                        status: metadata.status,
                        needsAuth: true,
                        authData: metadata.authData
                    });
                }

                // Wait for status handler to be initialized if session was just started
                // Try up to 10 times with 1 second delays (10 seconds total)
                let attempts = 0;
                while (!automation.statusHandler && attempts < 10) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    attempts++;

                    // Re-check the automation instance
                    automation = this.sessionManager.getSession(req.params.sessionId);
                }

                // Final check
                if (!automation.statusHandler) {
                    return res.status(503).json({
                        error: 'Session is starting up, please try again in a few seconds',
                        status: this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status
                    });
                }

                const deleteResult = await automation.statusHandler.removeStatus(req.params.msgId);
                this.sessionManager.updateSessionStatus(req.params.sessionId, 'active');

                // Handle the response properly - result might be undefined or have different structure
                if (deleteResult && typeof deleteResult === 'object') {
                    res.json({ ...deleteResult, success: true });
                } else {
                    res.json({ success: true, message: 'Status deleted successfully' });
                }

                // Don't close browser - keep it open for subsequent operations
                // await this.sessionManager.closeBrowserIfNotAwaitingAuth(req.params.sessionId);
            } catch (error) {
                res.status(500).json({ error: error.message, success: false });
            }
        });

        // Get viewers for a specific status
        this.app.get('/sessions/:sessionId/status/:msgId/viewers', async (req, res) => {
            try {
                // Auto-start session if it exists but not running
                let result = await this.sessionManager.autoStartSession(req.params.sessionId);

                if (!result) {
                    return res.status(404).json({ error: 'Session not found' });
                }

                // Handle auth data if returned
                let automation = result.automation || result;
                const metadata = this.sessionManager.sessionMetadata.get(req.params.sessionId);

                // If session needs re-auth and we have auth data, return it
                if (metadata && metadata.status === 'requires_auth' && metadata.authData) {
                    return res.status(401).json({
                        error: 'Session requires re-authentication',
                        status: metadata.status,
                        needsAuth: true,
                        authData: metadata.authData
                    });
                }

                // Wait a bit for status handler to be initialized if session was just started
                if (!automation.statusHandler) {
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    // Check again
                    if (!automation.statusHandler) {
                        return res.status(503).json({
                            error: 'Session is starting up, please try again in a few seconds',
                            status: this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status
                        });
                    }
                }

                const viewers = await automation.statusHandler.getStatusViewers(req.params.msgId);
                this.sessionManager.updateSessionStatus(req.params.sessionId, 'active');
                res.json(viewers);

                // Don't close browser - keep it open for subsequent operations
                // await this.sessionManager.closeBrowserIfNotAwaitingAuth(req.params.sessionId);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Get total viewers for all statuses
        this.app.get('/sessions/:sessionId/status/viewers/total', async (req, res) => {
            try {
                // Auto-start session if it exists but not running
                let result = await this.sessionManager.autoStartSession(req.params.sessionId);

                if (!result) {
                    return res.status(404).json({ error: 'Session not found' });
                }

                // Handle auth data if returned
                let automation = result.automation || result;
                const metadata = this.sessionManager.sessionMetadata.get(req.params.sessionId);

                // If session needs re-auth and we have auth data, return it
                if (metadata && metadata.status === 'requires_auth' && metadata.authData) {
                    return res.status(401).json({
                        error: 'Session requires re-authentication',
                        status: metadata.status,
                        needsAuth: true,
                        authData: metadata.authData
                    });
                }

                // Wait a bit for status handler to be initialized if session was just started
                if (!automation.statusHandler) {
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    // Check again
                    if (!automation.statusHandler) {
                        return res.status(503).json({
                            error: 'Session is starting up, please try again in a few seconds',
                            status: this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status
                        });
                    }
                }

                const totalViewers = await automation.statusHandler.getTotalStatusViewers();
                this.sessionManager.updateSessionStatus(req.params.sessionId, 'active');
                res.json(totalViewers);

                // Don't close browser - keep it open for subsequent operations
                // await this.sessionManager.closeBrowserIfNotAwaitingAuth(req.params.sessionId);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // User management routes
        this.app.get('/users', (req, res) => {
            const users = this.sessionManager.getAllUsers();
            res.json({ users });
        });

        this.app.get('/users/:userId', (req, res) => {
            const user = this.sessionManager.getUser(req.params.userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            res.json(user);
        });

        this.app.get('/users/:userId/sessions', (req, res) => {
            const sessions = this.sessionManager.getUserSessions(req.params.userId);
            res.json({ sessions });
        });

        this.app.get('/users/:userId/sessions/active', (req, res) => {
            const sessions = this.sessionManager.getActiveUserSessions(req.params.userId);
            res.json({ sessions });
        });

        this.app.delete('/users/:userId', async (req, res) => {
            try {
                const userId = req.params.userId;

                // Check if user exists
                const user = this.sessionManager.getUser(userId);
                if (!user) {
                    return res.status(404).json({ error: 'User not found' });
                }

                // Delete user and their container
                await this.sessionManager.deleteUser(userId);

                res.json({
                    success: true,
                    message: `User ${userId} and their container have been deleted`,
                    userId
                });
            } catch (error) {
                console.error('[API] Error deleting user:', error);
                res.status(500).json({
                    error: 'Failed to delete user',
                    details: error.message
                });
            }
        });

        // Database management routes
        this.app.post('/database/backup', (req, res) => {
            const { path: backupPath } = req.body;
            const result = this.sessionManager.backupDatabase(backupPath);
            if (result) {
                res.json({ success: true, backupPath: result });
            } else {
                res.status(500).json({ error: 'Backup failed' });
            }
        });

        this.app.post('/database/restore', (req, res) => {
            const { path: backupPath } = req.body;
            if (!backupPath) {
                return res.status(400).json({ error: 'Backup path is required' });
            }
            const result = this.sessionManager.restoreDatabase(backupPath);
            if (result) {
                res.json({ success: true });
            } else {
                res.status(500).json({ error: 'Restore failed' });
            }
        });

        // Session recovery route
        this.app.post('/sessions/:sessionId/recover', async (req, res) => {
            try {
                const automation = await this.sessionManager.recoverSession(req.params.sessionId);
                if (automation) {
                    res.json({ success: true, sessionId: req.params.sessionId });
                } else {
                    res.status(404).json({ error: 'Session not found or terminated' });
                }
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // ============================================
        // Proxy Management Routes
        // ============================================

        // Get all proxies
        this.app.get('/proxies', (req, res) => {
            try {
                const proxies = this.sessionManager.proxyManager.getAllProxies();
                res.json({ proxies });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Get proxy by ID
        this.app.get('/proxies/:proxyId', (req, res) => {
            try {
                const proxy = this.sessionManager.proxyManager.getProxyById(req.params.proxyId);
                if (!proxy) {
                    return res.status(404).json({ error: 'Proxy not found' });
                }
                res.json(proxy);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Add single proxy
        this.app.post('/proxies', async (req, res) => {
            try {
                const { proxy, tags = [] } = req.body;

                if (!proxy) {
                    return res.status(400).json({ error: 'Proxy string is required' });
                }

                const result = await this.sessionManager.proxyManager.addProxy(proxy, tags);
                res.json({ success: true, proxy: result });
            } catch (error) {
                res.status(400).json({ error: error.message });
            }
        });

        // Bulk import proxies
        this.app.post('/proxies/import', async (req, res) => {
            try {
                const { proxies, tags = [] } = req.body;

                if (!proxies || !Array.isArray(proxies)) {
                    return res.status(400).json({ error: 'Proxies array is required' });
                }

                const result = await this.sessionManager.proxyManager.importProxies(proxies, tags);
                res.json({ success: true, result });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Import proxies from uploaded file
        this.app.post('/proxies/import/file', async (req, res) => {
            try {
                const { filePath, tags = [] } = req.body;

                if (!filePath) {
                    return res.status(400).json({ error: 'File path is required' });
                }

                const result = await this.sessionManager.proxyManager.importProxiesFromFile(filePath, tags);
                res.json({ success: true, result });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Remove proxy
        this.app.delete('/proxies/:proxyId', (req, res) => {
            try {
                const removed = this.sessionManager.proxyManager.removeProxy(req.params.proxyId);
                if (removed) {
                    res.json({ success: true });
                } else {
                    res.status(404).json({ error: 'Proxy not found' });
                }
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Check proxy health manually
        this.app.post('/proxies/:proxyId/health-check', async (req, res) => {
            try {
                const result = await this.sessionManager.proxyManager.checkProxyHealth(req.params.proxyId);
                const proxy = this.sessionManager.proxyManager.getProxyById(req.params.proxyId);

                res.json({
                    success: result,
                    proxy: proxy,
                    message: result ? 'Health check passed' : 'Health check failed'
                });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Run health checks for all proxies
        this.app.post('/proxies/health-check', async (req, res) => {
            try {
                const results = await this.sessionManager.proxyManager.runHealthChecks();
                res.json({ success: true, results });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Get proxy statistics
        this.app.get('/proxies/statistics', (req, res) => {
            try {
                const stats = this.sessionManager.proxyManager.getStatistics();
                res.json(stats);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Get user's proxy assignment
        this.app.get('/users/:userId/proxy', (req, res) => {
            try {
                const result = this.sessionManager.getUserProxy(req.params.userId);
                if (!result) {
                    return res.status(404).json({ error: 'No proxy assigned to user' });
                }
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Rotate user's proxy
        this.app.post('/users/:userId/proxy/rotate', (req, res) => {
            try {
                const result = this.sessionManager.rotateUserProxy(req.params.userId);
                res.json({ success: true, result });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Get all proxy assignments
        this.app.get('/proxy-assignments', (req, res) => {
            try {
                const assignments = this.sessionManager.proxyManager.assignmentsCollection.find();
                res.json({ assignments });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // ============================================
        // Logs Management
        // ============================================

        // Store logs in memory (with limit)
        this.logs = [];
        this.maxLogs = 1000;

        // Log capture method
        this.addLog = (level, message, source = 'system') => {
            const logEntry = {
                id: Date.now().toString(),
                timestamp: new Date().toISOString(),
                level: level,
                message: message,
                source: source
            };

            this.logs.unshift(logEntry); // Add to beginning

            // Keep only last maxLogs entries
            if (this.logs.length > this.maxLogs) {
                this.logs = this.logs.slice(0, this.maxLogs);
            }
        };

        // Override console methods to capture logs
        const originalConsoleLog = console.log;
        const originalConsoleError = console.error;
        const originalConsoleWarn = console.warn;

        console.log = (...args) => {
            const message = args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' ');
            this.addLog('info', message);
            originalConsoleLog.apply(console, args);
        };

        console.error = (...args) => {
            const message = args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' ');
            this.addLog('error', message);
            originalConsoleError.apply(console, args);
        };

        console.warn = (...args) => {
            const message = args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' ');
            this.addLog('warn', message);
            originalConsoleWarn.apply(console, args);
        };

        // Get logs endpoint
        this.app.get('/logs', (req, res) => {
            try {
                const { level, limit = 100, source } = req.query;

                let filteredLogs = this.logs;

                // Filter by level if specified
                if (level) {
                    filteredLogs = filteredLogs.filter(log => log.level === level);
                }

                // Filter by source if specified
                if (source) {
                    filteredLogs = filteredLogs.filter(log => log.source === source);
                }

                // Limit results
                const limitedLogs = filteredLogs.slice(0, parseInt(limit));

                res.json({
                    success: true,
                    logs: limitedLogs,
                    totalCount: this.logs.length,
                    filteredCount: filteredLogs.length
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to fetch logs: ' + error.message
                });
            }
        });

        // Clear logs endpoint
        this.app.delete('/logs', (req, res) => {
            try {
                this.logs = [];
                res.json({
                    success: true,
                    message: 'Logs cleared successfully'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to clear logs: ' + error.message
                });
            }
        });

        // Add manual log entry
        this.app.post('/logs', (req, res) => {
            try {
                const { level = 'info', message, source = 'api' } = req.body;

                if (!message) {
                    return res.status(400).json({
                        success: false,
                        error: 'Message is required'
                    });
                }

                this.addLog(level, message, source);

                res.json({
                    success: true,
                    message: 'Log entry added successfully'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to add log entry: ' + error.message
                });
            }
        });

    }

    start() {
        this.server = this.app.listen(this.port, () => {
            console.log(`WhatsApp API Server running on port ${this.port}`);
            console.log(`API Documentation:`);
            console.log(`\n📱 Session Management:`);
            console.log(`  POST   /sessions/create         - Create new WhatsApp session`);
            console.log(`  GET    /sessions                - List all sessions`);
            console.log(`  GET    /sessions/:id/status     - Get session status`);
            console.log(`  GET    /sessions/:id/qr         - Get QR code for session`);
            console.log(`  DELETE /sessions/:id            - Remove session`);
            console.log(`  POST   /sessions/:id/recover    - Recover existing session`);
            console.log(`\n📢 Status Operations:`);
            console.log(`  POST   /sessions/:id/status/text   - Send text status`);
            console.log(`  POST   /sessions/:id/status/image  - Send image status`);
            console.log(`  POST   /sessions/:id/status/video  - Send video status`);
            console.log(`  GET    /sessions/:id/status/my     - Get my status`);
            console.log(`  DELETE /sessions/:id/status/:msgId - Remove status`);
            console.log(`  GET    /sessions/:id/status/:msgId/viewers - Get viewers for specific status`);
            console.log(`  GET    /sessions/:id/status/viewers/total  - Get total viewers for all statuses`);
            console.log(`\n👥 User Management:`);
            console.log(`  GET    /users                   - List all users`);
            console.log(`  GET    /users/:id               - Get user details`);
            console.log(`  GET    /users/:id/sessions      - Get user's sessions`);
            console.log(`  GET    /users/:id/sessions/active - Get user's active sessions`);
            console.log(`  DELETE /users/:id               - Delete user and their container`);
            console.log(`\n💾 Database Management:`);
            console.log(`  POST   /database/backup         - Create database backup`);
            console.log(`  POST   /database/restore        - Restore from backup`);

            console.log(`\n🌐 Proxy Management:`);
            console.log(`  GET    /proxies                 - List all proxies`);
            console.log(`  GET    /proxies/:id             - Get proxy details`);
            console.log(`  POST   /proxies                 - Add single proxy`);
            console.log(`  POST   /proxies/import          - Import proxies array`);
            console.log(`  POST   /proxies/import/file     - Import proxies from file`);
            console.log(`  DELETE /proxies/:id             - Remove proxy`);
            console.log(`  POST   /proxies/:id/health-check - Check proxy health`);
            console.log(`  POST   /proxies/health-check    - Check all proxies health`);
            console.log(`  GET    /proxies/statistics      - Get proxy statistics`);
            console.log(`  GET    /users/:id/proxy         - Get user's proxy assignment`);
            console.log(`  POST   /users/:id/proxy/rotate  - Rotate user's proxy`);
            console.log(`  GET    /proxy-assignments       - List all proxy assignments`);

            console.log(`\n🚀 Baileys Direct Status (No Browser):`);
            console.log(`  POST   /baileys/connect/:userId - Connect Baileys for user`);
            console.log(`  GET    /baileys/qr/:userId      - Get Baileys QR code`);
            console.log(`  POST   /baileys/status/text/:userId - Send text status via Baileys WebSocket`);
            console.log(`  POST   /baileys/status/image/:userId - Send image status via Baileys WebSocket`);
            console.log(`  POST   /baileys/status/video/:userId - Send video status via Baileys WebSocket`);
            console.log(`  GET    /baileys/status/:userId  - Get Baileys connection status`);
            console.log(`  DELETE /baileys/disconnect/:userId - Disconnect Baileys`);

            console.log(`\n📊 System:`);
            console.log(`  GET    /health                  - Health check with statistics`);
        });
    }

    stop() {
        if (this.server) {
            this.server.close();
        }
    }
}

module.exports = { WhatsAppAPI };