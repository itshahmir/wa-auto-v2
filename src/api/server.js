const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { SessionManager } = require('../core/SessionManager');
const WhatsAppStatusHandler = require('../core/StatusHandler');
require('dotenv').config();

// ============================================
// Express API Server
// ============================================
class WhatsAppAPI {
    constructor(port = 3000) {
        this.app = express();
        this.port = port;
        this.sessionManager = new SessionManager();
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

                const sessionId = this.sessionManager.createSession(userId, phoneNumber);
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
                            window.WPPConfig.syncAllStatus = true;
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
                    automation.statusHandler = new WhatsAppStatusHandler(automation.page, automation);

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

                                automation.statusHandler = new WhatsAppStatusHandler(automation.page, automation);
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
            res.json({ sessions: this.sessionManager.getAllSessions() });
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

                // Wait for status handler to be initialized if session was just started
                // Try up to 15 times with 1 second delays
                let attempts = 0;
                while (!automation.statusHandler && attempts < 15) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    attempts++;

                    // Re-check the automation instance
                    automation = this.sessionManager.getSession(req.params.sessionId);

                    // Also check if WhatsApp is ready
                    if (automation?.page) {
                        try {
                            const isReady = await automation.page.evaluate(() => {
                                return window.WPP && window.WPP.isReady && window.WPP.isReady();
                            });

                            if (isReady && !automation.statusHandler) {
                                const StatusHandler = require('../core/StatusHandler');
                                automation.statusHandler = new StatusHandler(automation.page, automation);
                            }
                        } catch (e) {
                            // Page might not be ready yet
                        }
                    }
                }

                // Final check
                if (!automation.statusHandler) {
                    return res.status(503).json({
                        error: 'Session is starting up, please try again in a few seconds',
                        status: this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status
                    });
                }

                const { content, options } = req.body;
                const statusResult = await automation.statusHandler.sendTextStatus(content, options || {});

                this.sessionManager.updateSessionStatus(req.params.sessionId, 'active');
                res.json({ success: true, result: statusResult });

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

                // Wait for status handler to be initialized if session was just started
                // Try up to 15 times with 1 second delays
                let attempts = 0;
                while (!automation.statusHandler && attempts < 15) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    attempts++;

                    // Re-check the automation instance
                    automation = this.sessionManager.getSession(req.params.sessionId);

                    // Also check if WhatsApp is ready
                    if (automation?.page) {
                        try {
                            const isReady = await automation.page.evaluate(() => {
                                return window.WPP && window.WPP.isReady && window.WPP.isReady();
                            });

                            if (isReady && !automation.statusHandler) {
                                const StatusHandler = require('../core/StatusHandler');
                                automation.statusHandler = new StatusHandler(automation.page, automation);
                            }
                        } catch (e) {
                            // Page might not be ready yet
                        }
                    }
                }

                // Final check
                if (!automation.statusHandler) {
                    return res.status(503).json({
                        error: 'Session is starting up, please try again in a few seconds',
                        status: this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status
                    });
                }

                const { content, options } = req.body;
                const imageResult = await automation.statusHandler.sendImageStatus(content, options || {});

                this.sessionManager.updateSessionStatus(req.params.sessionId, 'active');
                res.json({ success: true, result: imageResult });

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

                // Wait for status handler to be initialized if session was just started
                // Try up to 15 times with 1 second delays
                let attempts = 0;
                while (!automation.statusHandler && attempts < 15) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    attempts++;

                    // Re-check the automation instance
                    automation = this.sessionManager.getSession(req.params.sessionId);

                    // Also check if WhatsApp is ready
                    if (automation?.page) {
                        try {
                            const isReady = await automation.page.evaluate(() => {
                                return window.WPP && window.WPP.isReady && window.WPP.isReady();
                            });

                            if (isReady && !automation.statusHandler) {
                                const StatusHandler = require('../core/StatusHandler');
                                automation.statusHandler = new StatusHandler(automation.page, automation);
                            }
                        } catch (e) {
                            // Page might not be ready yet
                        }
                    }
                }

                // Final check
                if (!automation.statusHandler) {
                    return res.status(503).json({
                        error: 'Session is starting up, please try again in a few seconds',
                        status: this.sessionManager.sessionMetadata.get(req.params.sessionId)?.status
                    });
                }

                const { content, options } = req.body;
                const videoResult = await automation.statusHandler.sendVideoStatus(content, options || {});

                this.sessionManager.updateSessionStatus(req.params.sessionId, 'active');
                res.json({ success: true, result: videoResult });

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
            console.log(`\n💾 Database Management:`);
            console.log(`  POST   /database/backup         - Create database backup`);
            console.log(`  POST   /database/restore        - Restore from backup`);
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