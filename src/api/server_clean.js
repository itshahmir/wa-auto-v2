const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const { SessionManager } = require('../core/SessionManager');
const StatusOnlyAutomation = require('../core/StatusOnlyAutomation');
require('dotenv').config();

// ============================================
// Clean WhatsApp API Server - Status Only Browser
// Removed Baileys, optimized for browser-based status operations
// ============================================

class WhatsAppAPI {
    constructor() {
        this.app = express();
        this.server = null;
        this.sessionManager = new SessionManager();

        // Status-only automation handlers
        this.statusAutomations = new Map(); // userId -> StatusOnlyAutomation

        this.setupMiddleware();
        this.setupRoutes();
        this.startStatusMonitoring();
        this.restoreActiveSessions();
    }

    setupMiddleware() {
        // Trust proxy for SSL termination
        this.app.set('trust proxy', 1);

        // Enhanced CORS Headers for domain access
        this.app.use((req, res, next) => {
            const allowedOrigins = [
                'https://whatsapp.social-crm.co.il',
                'http://whatsapp.social-crm.co.il',
                'https://localhost:3000',
                'http://localhost:3000',
                '*'
            ];

            const origin = req.headers.origin;
            if (allowedOrigins.includes(origin)) {
                res.header('Access-Control-Allow-Origin', origin);
            } else {
                res.header('Access-Control-Allow-Origin', '*');
            }

            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Forwarded-For, X-Forwarded-Proto');
            res.header('Access-Control-Allow-Credentials', 'true');

            // Handle preflight requests
            if (req.method === 'OPTIONS') {
                res.sendStatus(200);
            } else {
                next();
            }
        });

        // Body parsing with larger limits for media uploads
        this.app.use(bodyParser.json({ limit: '100mb' }));
        this.app.use(bodyParser.urlencoded({ extended: true, limit: '100mb' }));

        // File uploads
        this.app.use(fileUpload({
            limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
            useTempFiles: true,
            tempFileDir: '/tmp/'
        }));

        // Session management
        this.app.use(session({
            secret: process.env.JWT_SECRET || 'wa-automation-secret-key',
            resave: false,
            saveUninitialized: true,
            cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
        }));
    }

    setupRoutes() {
        // ============================================
        // STATUS-ONLY BROWSER ENDPOINTS
        // ============================================

        // Create status-optimized browser session
        this.app.post('/status-browser/create/:userId', async (req, res) => {
            const { userId } = req.params;

            try {
                console.log(`[${userId}] Creating status-optimized browser session...`);

                // Check if already exists and is still valid
                if (this.statusAutomations.has(userId)) {
                    const existingAutomation = this.statusAutomations.get(userId);

                    // Check if the existing session is still valid
                    try {
                        // Try to access the page to see if browser is still alive
                        const isValid = await existingAutomation.page.evaluate(() => true);

                        if (isValid) {
                            console.log(`[${userId}] Existing valid session found, reusing...`);
                            return res.json({
                                success: true,
                                message: 'Status browser already exists for this user',
                                userId: userId,
                                status: 'existing'
                            });
                        }
                    } catch (error) {
                        console.log(`[${userId}] Existing session is invalid, cleaning up...`);
                        // Clean up invalid session
                        try {
                            await existingAutomation.close();
                        } catch (e) {
                            // Ignore cleanup errors
                        }
                        this.statusAutomations.delete(userId);
                    }
                }

                // Create new status automation
                const sessionPath = `/home/ubuntu/wa-auto-v2/sessions/${userId}`;
                const automation = new StatusOnlyAutomation(sessionPath, userId);

                // Initialize browser
                await automation.initialize();

                // Load WhatsApp for status operations
                await automation.loadWhatsAppForStatus();

                // Store automation
                this.statusAutomations.set(userId, automation);

                // Check authentication status
                const isAuth = await automation.isAuthenticated();
                let authData = null;

                if (!isAuth) {
                    // Get QR code
                    const qrResult = await automation.checkQRCode();
                    if (qrResult.hasQR) {
                        authData = {
                            type: 'qr_code',
                            qr: qrResult.qrData,
                            format: 'base64'
                        };
                    }
                }

                console.log(`[${userId}] Status browser created successfully`);

                res.json({
                    success: true,
                    message: 'Status browser created successfully',
                    userId: userId,
                    isAuthenticated: isAuth,
                    authData: authData,
                    status: isAuth ? 'authenticated' : 'pending_auth'
                });

            } catch (error) {
                console.error(`[${userId}] Status browser creation error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: `Failed to create status browser: ${error.message}`
                });
            }
        });

        // Get QR code from status browser
        this.app.get('/status-browser/:userId/qr', async (req, res) => {
            const { userId } = req.params;

            try {
                if (!this.statusAutomations.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Status browser not found for this user'
                    });
                }

                const automation = this.statusAutomations.get(userId);
                const qrResult = await automation.checkQRCode();

                if (qrResult.hasQR) {
                    res.json({
                        success: true,
                        qr: qrResult.qrData,
                        format: 'base64',
                        message: 'QR code retrieved successfully'
                    });
                } else {
                    res.json({
                        success: false,
                        message: qrResult.message || 'No QR code available'
                    });
                }

            } catch (error) {
                console.error(`[${userId}] QR retrieval error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Send text status via status browser
        this.app.post('/status-browser/:userId/status/text', async (req, res) => {
            const { userId } = req.params;
            const { content, options = {} } = req.body;

            try {
                if (!this.statusAutomations.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Status browser not found for this user'
                    });
                }

                const automation = this.statusAutomations.get(userId);

                // Check if authenticated
                const isAuth = await automation.isAuthenticated();
                if (!isAuth) {
                    return res.status(401).json({
                        success: false,
                        error: 'Not authenticated. Please scan QR code first.'
                    });
                }

                const result = await automation.sendTextStatus(content, options);

                res.json({
                    success: true,
                    message: 'Text status sent successfully',
                    method: 'status_browser',
                    result: result
                });

            } catch (error) {
                console.error(`[${userId}] Text status send error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ULTRA-FAST text status sending (15-30 seconds target)
        this.app.post('/status-browser/:userId/status/text/ultra-fast', async (req, res) => {
            const { userId } = req.params;
            const { content, options = {} } = req.body;

            const startTime = Date.now();
            console.log(`[${userId}] 🚀 ULTRA-FAST text status request: "${content?.substring(0, 50)}..."`);

            try {
                if (!this.statusAutomations.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Status browser not found for this user',
                        time: Date.now() - startTime
                    });
                }

                const automation = this.statusAutomations.get(userId);

                // Skip authentication check for ultra-fast mode - go straight to sending
                console.log(`[${userId}] ⚡ Bypassing auth check for ultra-fast mode...`);

                // Use the new ultra-fast method
                const result = await automation.ultraFastTextStatus(content, options);

                const totalTime = Date.now() - startTime;
                const performance = totalTime < 15000 ? '🔥 BLAZING' : totalTime < 30000 ? '⚡ FAST' : '🐌 SLOW';

                console.log(`[${userId}] 🚀 ULTRA-FAST status complete in ${totalTime}ms - ${performance}`);

                res.json({
                    success: true,
                    message: 'Ultra-fast text status sent',
                    method: 'ultra_fast',
                    result: result,
                    totalTime: totalTime,
                    performance: performance,
                    target: '15-30 seconds',
                    achieved: totalTime <= 30000 ? '✅ TARGET ACHIEVED' : '❌ TARGET MISSED'
                });

            } catch (error) {
                const totalTime = Date.now() - startTime;
                console.error(`[${userId}] ❌ Ultra-fast text status error in ${totalTime}ms:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message,
                    method: 'ultra_fast',
                    totalTime: totalTime,
                    performance: '❌ FAILED'
                });
            }
        });

        // DOM INSPECTOR: Find real WhatsApp status selectors
        this.app.get('/status-browser/:userId/inspect-selectors', async (req, res) => {
            const { userId } = req.params;

            try {
                if (!this.statusAutomations.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Status browser not found for this user'
                    });
                }

                const automation = this.statusAutomations.get(userId);

                console.log(`[${userId}] 🔍 DOM INSPECTOR: Analyzing WhatsApp Web selectors...`);

                const selectorAnalysis = await automation.page.evaluate(() => {
                    const analysis = {
                        timestamp: new Date().toISOString(),
                        url: window.location.href,
                        foundElements: {},
                        recommendations: {}
                    };

                    console.log('🔍 WHATSAPP SELECTOR INSPECTOR STARTING...');

                    // 1. NAVIGATION ANALYSIS
                    console.log('📱 Analyzing navigation elements...');
                    const navElements = [];

                    // Find all possible navigation items
                    const possibleNavs = document.querySelectorAll([
                        'div[role="button"]',
                        'button',
                        'div[data-tab]',
                        'div[aria-label]',
                        'span[data-icon]',
                        'nav *',
                        '[class*="nav"]',
                        '[class*="tab"]',
                        '[class*="menu"]'
                    ].join(','));

                    possibleNavs.forEach((el, index) => {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 20 && rect.height > 20) {
                            const info = {
                                index,
                                tagName: el.tagName,
                                classes: Array.from(el.classList),
                                attributes: {},
                                text: el.innerText?.trim().substring(0, 50),
                                ariaLabel: el.getAttribute('aria-label'),
                                dataIcon: el.querySelector('span[data-icon]')?.getAttribute('data-icon'),
                                position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                                isVisible: rect.width > 0 && rect.height > 0,
                                selector: null
                            };

                            // Get all attributes
                            for (const attr of el.attributes) {
                                info.attributes[attr.name] = attr.value;
                            }

                            // Try to create a unique selector
                            if (el.id) {
                                info.selector = `#${el.id}`;
                            } else if (el.getAttribute('data-tab')) {
                                info.selector = `div[data-tab="${el.getAttribute('data-tab')}"]`;
                            } else if (info.ariaLabel) {
                                info.selector = `[aria-label="${info.ariaLabel}"]`;
                            } else if (info.dataIcon) {
                                info.selector = `span[data-icon="${info.dataIcon}"]`;
                            }

                            // Check if it might be status-related
                            const statusKeywords = ['status', 'update', 'story', 'stories'];
                            const isStatusRelated = statusKeywords.some(keyword =>
                                (info.text && info.text.toLowerCase().includes(keyword)) ||
                                (info.ariaLabel && info.ariaLabel.toLowerCase().includes(keyword)) ||
                                (info.dataIcon && info.dataIcon.toLowerCase().includes(keyword))
                            );

                            if (isStatusRelated) {
                                info.statusRelevance = 'HIGH';
                                navElements.unshift(info); // Put status-related first
                            } else {
                                info.statusRelevance = 'LOW';
                                navElements.push(info);
                            }
                        }
                    });

                    analysis.foundElements.navigation = navElements.slice(0, 20); // Top 20

                    // 2. INPUT ELEMENTS ANALYSIS
                    console.log('⌨️ Analyzing input elements...');
                    const inputElements = [];

                    const possibleInputs = document.querySelectorAll([
                        'div[contenteditable="true"]',
                        'textarea',
                        'input[type="text"]',
                        'div[role="textbox"]',
                        'div[data-lexical-editor]',
                        'div[class*="input"]',
                        'div[class*="compose"]',
                        'div[class*="editor"]'
                    ].join(','));

                    possibleInputs.forEach((el, index) => {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 30 && rect.height > 15) {
                            const info = {
                                index,
                                tagName: el.tagName,
                                classes: Array.from(el.classList),
                                attributes: {},
                                placeholder: el.placeholder || el.getAttribute('placeholder'),
                                ariaLabel: el.getAttribute('aria-label'),
                                contentEditable: el.contentEditable,
                                position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                                isVisible: rect.width > 0 && rect.height > 0,
                                selector: null
                            };

                            // Get all attributes
                            for (const attr of el.attributes) {
                                info.attributes[attr.name] = attr.value;
                            }

                            // Create selector
                            if (el.id) {
                                info.selector = `#${el.id}`;
                            } else if (el.getAttribute('data-testid')) {
                                info.selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
                            } else if (el.getAttribute('data-lexical-editor')) {
                                info.selector = `div[data-lexical-editor="${el.getAttribute('data-lexical-editor')}"]`;
                            } else if (info.ariaLabel) {
                                info.selector = `[aria-label="${info.ariaLabel}"]`;
                            }

                            inputElements.push(info);
                        }
                    });

                    analysis.foundElements.inputs = inputElements;

                    // 3. BUTTON ANALYSIS
                    console.log('🔘 Analyzing buttons...');
                    const buttonElements = [];

                    const possibleButtons = document.querySelectorAll([
                        'button',
                        'div[role="button"]',
                        'span[role="button"]',
                        'div[class*="button"]',
                        'span[data-icon="send"]',
                        'span[data-icon="plus"]',
                        '[aria-label*="Send"]',
                        '[aria-label*="Add"]'
                    ].join(','));

                    possibleButtons.forEach((el, index) => {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 10 && rect.height > 10) {
                            const info = {
                                index,
                                tagName: el.tagName,
                                classes: Array.from(el.classList),
                                text: el.innerText?.trim().substring(0, 30),
                                ariaLabel: el.getAttribute('aria-label'),
                                dataIcon: el.querySelector('span[data-icon]')?.getAttribute('data-icon') || el.getAttribute('data-icon'),
                                position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                                isVisible: rect.width > 0 && rect.height > 0,
                                selector: null
                            };

                            // Create selector
                            if (el.id) {
                                info.selector = `#${el.id}`;
                            } else if (el.getAttribute('data-testid')) {
                                info.selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
                            } else if (info.ariaLabel) {
                                info.selector = `[aria-label="${info.ariaLabel}"]`;
                            } else if (info.dataIcon) {
                                info.selector = `span[data-icon="${info.dataIcon}"]`;
                            }

                            // Check relevance for status/send
                            const relevantKeywords = ['send', 'add', 'plus', 'status', 'post', 'share'];
                            const isRelevant = relevantKeywords.some(keyword =>
                                (info.text && info.text.toLowerCase().includes(keyword)) ||
                                (info.ariaLabel && info.ariaLabel.toLowerCase().includes(keyword)) ||
                                (info.dataIcon && info.dataIcon.toLowerCase().includes(keyword))
                            );

                            if (isRelevant) {
                                info.relevance = 'HIGH';
                                buttonElements.unshift(info);
                            } else {
                                info.relevance = 'LOW';
                                buttonElements.push(info);
                            }
                        }
                    });

                    analysis.foundElements.buttons = buttonElements.slice(0, 15);

                    // 4. GENERATE RECOMMENDATIONS
                    console.log('💡 Generating recommendations...');

                    // Find best status navigation
                    const statusNavs = analysis.foundElements.navigation.filter(el => el.statusRelevance === 'HIGH');
                    if (statusNavs.length > 0) {
                        analysis.recommendations.statusNavigation = statusNavs[0];
                    }

                    // Find best input
                    const visibleInputs = analysis.foundElements.inputs.filter(el => el.isVisible);
                    if (visibleInputs.length > 0) {
                        analysis.recommendations.textInput = visibleInputs[0];
                    }

                    // Find best send button
                    const sendButtons = analysis.foundElements.buttons.filter(el =>
                        el.relevance === 'HIGH' &&
                        (el.ariaLabel?.toLowerCase().includes('send') || el.dataIcon === 'send')
                    );
                    if (sendButtons.length > 0) {
                        analysis.recommendations.sendButton = sendButtons[0];
                    }

                    // Find add/plus button
                    const addButtons = analysis.foundElements.buttons.filter(el =>
                        el.relevance === 'HIGH' &&
                        (el.ariaLabel?.toLowerCase().includes('add') || el.dataIcon === 'plus')
                    );
                    if (addButtons.length > 0) {
                        analysis.recommendations.addButton = addButtons[0];
                    }

                    console.log('✅ DOM ANALYSIS COMPLETE!');

                    return analysis;
                });

                console.log(`[${userId}] ✅ DOM analysis complete`);

                res.json({
                    success: true,
                    analysis: selectorAnalysis,
                    summary: {
                        navigationElements: selectorAnalysis.foundElements.navigation.length,
                        inputElements: selectorAnalysis.foundElements.inputs.length,
                        buttonElements: selectorAnalysis.foundElements.buttons.length,
                        hasStatusNavigation: !!selectorAnalysis.recommendations.statusNavigation,
                        hasTextInput: !!selectorAnalysis.recommendations.textInput,
                        hasSendButton: !!selectorAnalysis.recommendations.sendButton,
                        hasAddButton: !!selectorAnalysis.recommendations.addButton
                    }
                });

            } catch (error) {
                console.error(`[${userId}] DOM analysis error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ADVANCED DOM INSPECTOR: Find selectors with simulation
        this.app.get('/status-browser/:userId/find-status-selectors', async (req, res) => {
            const { userId } = req.params;

            try {
                if (!this.statusAutomations.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Status browser not found for this user'
                    });
                }

                const automation = this.statusAutomations.get(userId);

                console.log(`[${userId}] 🔍 ADVANCED STATUS SELECTOR FINDER...`);

                const statusSelectors = await automation.page.evaluate(() => {
                    console.log('🔍 STATUS SELECTOR FINDER STARTING...');

                    const results = {
                        url: window.location.href,
                        timestamp: new Date().toISOString(),
                        foundSelectors: {
                            statusNavigation: [],
                            textInputs: [],
                            sendButtons: [],
                            addButtons: []
                        },
                        bestSelectors: {},
                        allElements: []
                    };

                    // Helper function to get element info
                    const getElementInfo = (el, purpose) => {
                        const rect = el.getBoundingClientRect();
                        const computedStyle = window.getComputedStyle(el);

                        const info = {
                            tagName: el.tagName,
                            id: el.id,
                            className: el.className,
                            classList: Array.from(el.classList),
                            text: el.innerText?.trim().substring(0, 100),
                            ariaLabel: el.getAttribute('aria-label'),
                            role: el.getAttribute('role'),
                            dataTestId: el.getAttribute('data-testid'),
                            dataIcon: el.querySelector('span[data-icon]')?.getAttribute('data-icon') || el.getAttribute('data-icon'),
                            position: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
                            isVisible: rect.width > 0 && rect.height > 0 && computedStyle.visibility !== 'hidden' && computedStyle.display !== 'none',
                            zIndex: computedStyle.zIndex,
                            purpose: purpose,
                            selectors: []
                        };

                        // Generate possible selectors
                        if (info.id) {
                            info.selectors.push(`#${info.id}`);
                        }
                        if (info.dataTestId) {
                            info.selectors.push(`[data-testid="${info.dataTestId}"]`);
                        }
                        if (info.ariaLabel) {
                            info.selectors.push(`[aria-label="${info.ariaLabel}"]`);
                        }
                        if (info.dataIcon) {
                            info.selectors.push(`span[data-icon="${info.dataIcon}"]`);
                            info.selectors.push(`[data-icon="${info.dataIcon}"]`);
                        }
                        if (info.role) {
                            info.selectors.push(`[role="${info.role}"]`);
                        }

                        // Class-based selectors for the most unique classes
                        const uniqueClasses = info.classList.filter(cls =>
                            cls.length > 6 && !cls.startsWith('x') && document.querySelectorAll(`.${cls}`).length < 10
                        );
                        uniqueClasses.forEach(cls => {
                            info.selectors.push(`.${cls}`);
                        });

                        // Combined selectors
                        if (info.tagName && info.role) {
                            info.selectors.push(`${info.tagName.toLowerCase()}[role="${info.role}"]`);
                        }

                        return info;
                    };

                    // 1. FIND STATUS NAVIGATION
                    console.log('🔍 Searching for status navigation...');

                    // Try different approaches to find status navigation
                    const statusNavCandidates = [
                        // Look for common patterns
                        ...document.querySelectorAll('div[role="button"]'),
                        ...document.querySelectorAll('button'),
                        ...document.querySelectorAll('[aria-label*="Status"]'),
                        ...document.querySelectorAll('[aria-label*="Updates"]'),
                        ...document.querySelectorAll('span[data-icon="status"]'),
                        ...document.querySelectorAll('div[data-tab]'),
                        // Look for text content
                        ...Array.from(document.querySelectorAll('div, button, span')).filter(el =>
                            el.innerText && (
                                el.innerText.toLowerCase().includes('status') ||
                                el.innerText.toLowerCase().includes('updates') ||
                                el.innerText.toLowerCase().includes('stories')
                            )
                        )
                    ];

                    statusNavCandidates.forEach(el => {
                        const info = getElementInfo(el, 'statusNavigation');
                        if (info.isVisible && (info.position.width > 30 && info.position.height > 20)) {
                            // Score based on relevance
                            let score = 0;
                            if (info.text && info.text.toLowerCase().includes('status')) score += 10;
                            if (info.ariaLabel && info.ariaLabel.toLowerCase().includes('status')) score += 15;
                            if (info.dataIcon === 'status') score += 20;
                            if (info.text && info.text.toLowerCase().includes('updates')) score += 8;

                            info.relevanceScore = score;
                            results.foundSelectors.statusNavigation.push(info);
                        }
                    });

                    // 2. FIND TEXT INPUTS
                    console.log('🔍 Searching for text inputs...');

                    const inputCandidates = [
                        ...document.querySelectorAll('div[contenteditable="true"]'),
                        ...document.querySelectorAll('textarea'),
                        ...document.querySelectorAll('input[type="text"]'),
                        ...document.querySelectorAll('[role="textbox"]'),
                        ...document.querySelectorAll('[data-lexical-editor]'),
                        ...document.querySelectorAll('.lexical-rich-text-input')
                    ];

                    inputCandidates.forEach(el => {
                        const info = getElementInfo(el, 'textInput');
                        if (info.isVisible && (info.position.width > 50 && info.position.height > 20)) {
                            let score = 0;
                            if (el.contentEditable === 'true') score += 10;
                            if (info.role === 'textbox') score += 8;
                            if (info.ariaLabel && info.ariaLabel.toLowerCase().includes('type')) score += 5;

                            info.relevanceScore = score;
                            results.foundSelectors.textInputs.push(info);
                        }
                    });

                    // 3. FIND SEND BUTTONS
                    console.log('🔍 Searching for send buttons...');

                    const sendCandidates = [
                        ...document.querySelectorAll('button'),
                        ...document.querySelectorAll('[role="button"]'),
                        ...document.querySelectorAll('span[data-icon="send"]'),
                        ...document.querySelectorAll('[aria-label*="Send"]'),
                        ...Array.from(document.querySelectorAll('button, div[role="button"]')).filter(el =>
                            el.innerText && el.innerText.toLowerCase().includes('send')
                        )
                    ];

                    sendCandidates.forEach(el => {
                        const info = getElementInfo(el, 'sendButton');
                        if (info.isVisible && (info.position.width > 20 && info.position.height > 20)) {
                            let score = 0;
                            if (info.dataIcon === 'send') score += 20;
                            if (info.ariaLabel && info.ariaLabel.toLowerCase().includes('send')) score += 15;
                            if (info.text && info.text.toLowerCase().includes('send')) score += 10;

                            info.relevanceScore = score;
                            results.foundSelectors.sendButtons.push(info);
                        }
                    });

                    // 4. FIND ADD/PLUS BUTTONS
                    console.log('🔍 Searching for add/plus buttons...');

                    const addCandidates = [
                        ...document.querySelectorAll('span[data-icon="plus"]'),
                        ...document.querySelectorAll('span[data-icon="add"]'),
                        ...document.querySelectorAll('[aria-label*="Add"]'),
                        ...Array.from(document.querySelectorAll('button, div[role="button"]')).filter(el =>
                            el.innerText && (el.innerText.includes('+') || el.innerText.toLowerCase().includes('add'))
                        )
                    ];

                    addCandidates.forEach(el => {
                        const info = getElementInfo(el, 'addButton');
                        if (info.isVisible && (info.position.width > 15 && info.position.height > 15)) {
                            let score = 0;
                            if (info.dataIcon === 'plus') score += 20;
                            if (info.dataIcon === 'add') score += 18;
                            if (info.ariaLabel && info.ariaLabel.toLowerCase().includes('add')) score += 15;
                            if (info.text && info.text.includes('+')) score += 10;

                            info.relevanceScore = score;
                            results.foundSelectors.addButtons.push(info);
                        }
                    });

                    // Sort by relevance score and get best ones
                    Object.keys(results.foundSelectors).forEach(key => {
                        results.foundSelectors[key].sort((a, b) => b.relevanceScore - a.relevanceScore);
                        if (results.foundSelectors[key].length > 0) {
                            results.bestSelectors[key] = results.foundSelectors[key][0];
                        }
                    });

                    // Compile all unique elements
                    const allFound = [
                        ...results.foundSelectors.statusNavigation,
                        ...results.foundSelectors.textInputs,
                        ...results.foundSelectors.sendButtons,
                        ...results.foundSelectors.addButtons
                    ];

                    results.allElements = allFound.slice(0, 50); // Limit to top 50

                    console.log(`✅ Found ${allFound.length} total elements`);
                    console.log('📊 Best selectors:', results.bestSelectors);

                    return results;
                });

                console.log(`[${userId}] ✅ Advanced status selector analysis complete`);

                res.json({
                    success: true,
                    results: statusSelectors,
                    recommendations: {
                        statusNavigation: statusSelectors.bestSelectors.statusNavigation?.selectors || [],
                        textInput: statusSelectors.bestSelectors.textInputs?.selectors || [],
                        sendButton: statusSelectors.bestSelectors.sendButtons?.selectors || [],
                        addButton: statusSelectors.bestSelectors.addButtons?.selectors || []
                    },
                    summary: {
                        foundStatusNav: statusSelectors.foundSelectors.statusNavigation.length,
                        foundTextInputs: statusSelectors.foundSelectors.textInputs.length,
                        foundSendButtons: statusSelectors.foundSelectors.sendButtons.length,
                        foundAddButtons: statusSelectors.foundSelectors.addButtons.length,
                        hasBestRecommendations: Object.keys(statusSelectors.bestSelectors).length > 0
                    }
                });

            } catch (error) {
                console.error(`[${userId}] Advanced DOM analysis error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // DEBUG STATUS SENDING: Real-time analysis
        this.app.post('/status-browser/:userId/debug-status-send', async (req, res) => {
            const { userId } = req.params;
            const { content } = req.body;

            try {
                if (!this.statusAutomations.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Status browser not found for this user'
                    });
                }

                const automation = this.statusAutomations.get(userId);

                console.log(`[${userId}] 🔍 DEBUG: Analyzing status sending step by step...`);

                const debugResults = await automation.page.evaluate(async (statusContent) => {
                    const debug = {
                        timestamp: new Date().toISOString(),
                        steps: [],
                        findings: {},
                        finalResult: null
                    };

                    const log = (step, result, details = {}) => {
                        debug.steps.push({ step, result, details, timestamp: new Date().toISOString() });
                        console.log(`🔍 DEBUG STEP: ${step} - ${result}`, details);
                    };

                    try {
                        // Step 1: Check current page state
                        log('Check page state', 'checking');
                        debug.findings.url = window.location.href;
                        debug.findings.pageTitle = document.title;
                        debug.findings.isWhatsAppPage = window.location.href.includes('web.whatsapp.com');

                        // Step 2: Look for Status button with detailed analysis
                        log('Looking for Status button', 'searching');
                        const statusSelectors = [
                            '[aria-label="Status"]',
                            'span[data-icon="status-refreshed"]',
                            'button[aria-label="Status"]',
                            '[data-icon="status-refreshed"]'
                        ];

                        let statusButton = null;
                        const statusFindings = [];

                        for (const selector of statusSelectors) {
                            const elements = document.querySelectorAll(selector);
                            statusFindings.push({
                                selector: selector,
                                found: elements.length,
                                elements: Array.from(elements).map(el => ({
                                    tagName: el.tagName,
                                    visible: el.offsetWidth > 0 && el.offsetHeight > 0,
                                    rect: el.getBoundingClientRect(),
                                    ariaLabel: el.getAttribute('aria-label'),
                                    dataIcon: el.getAttribute('data-icon') || el.querySelector('span[data-icon]')?.getAttribute('data-icon'),
                                    text: el.innerText?.trim().substring(0, 50)
                                }))
                            });

                            if (elements.length > 0) {
                                statusButton = elements[0];
                                break;
                            }
                        }

                        debug.findings.statusButton = statusFindings;

                        if (statusButton) {
                            log('Status button found', 'success', { selector: statusSelectors[0] });

                            // Step 3: Try to click status button
                            log('Clicking status button', 'attempting');
                            statusButton.click();

                            // Wait for navigation
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            log('Waited after status click', 'completed');

                        } else {
                            log('Status button not found', 'failed');
                            debug.findings.availableButtons = Array.from(document.querySelectorAll('button, div[role="button"]')).slice(0, 10).map(btn => ({
                                tagName: btn.tagName,
                                ariaLabel: btn.getAttribute('aria-label'),
                                text: btn.innerText?.trim().substring(0, 50),
                                visible: btn.offsetWidth > 0 && btn.offsetHeight > 0
                            }));
                        }

                        // Step 4: Look for text input areas
                        log('Looking for text inputs', 'searching');
                        const inputSelectors = [
                            '.lexical-rich-text-input',
                            'div[contenteditable="true"][role="textbox"]',
                            '[aria-label*="Type"]',
                            'div[contenteditable="true"]'
                        ];

                        let textInput = null;
                        const inputFindings = [];

                        for (const selector of inputSelectors) {
                            const elements = document.querySelectorAll(selector);
                            inputFindings.push({
                                selector: selector,
                                found: elements.length,
                                elements: Array.from(elements).map(el => ({
                                    tagName: el.tagName,
                                    visible: el.offsetWidth > 0 && el.offsetHeight > 0,
                                    rect: el.getBoundingClientRect(),
                                    ariaLabel: el.getAttribute('aria-label'),
                                    contentEditable: el.contentEditable,
                                    placeholder: el.placeholder
                                }))
                            });

                            const visibleElements = Array.from(elements).filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);
                            if (visibleElements.length > 0) {
                                textInput = visibleElements[0];
                                break;
                            }
                        }

                        debug.findings.textInputs = inputFindings;

                        if (textInput) {
                            log('Text input found', 'success');

                            // Step 5: Try to enter text
                            log('Entering text', 'attempting');
                            textInput.focus();
                            textInput.textContent = statusContent;
                            textInput.innerHTML = statusContent;

                            // Fire events
                            ['focus', 'input', 'change', 'keyup'].forEach(eventType => {
                                textInput.dispatchEvent(new Event(eventType, { bubbles: true }));
                            });

                            log('Text entered and events fired', 'completed');

                            // Step 6: Try to send
                            log('Looking for send method', 'searching');

                            // Try Enter key
                            textInput.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'Enter',
                                keyCode: 13,
                                bubbles: true
                            }));
                            log('Enter key sent', 'completed');

                            // Try Ctrl+Enter
                            textInput.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'Enter',
                                keyCode: 13,
                                ctrlKey: true,
                                bubbles: true
                            }));
                            log('Ctrl+Enter sent', 'completed');

                            debug.finalResult = { success: true, method: 'keyboard_entry' };

                        } else {
                            log('Text input not found', 'failed');
                            debug.finalResult = { success: false, reason: 'no_text_input' };
                        }

                        return debug;

                    } catch (error) {
                        log('ERROR', 'failed', { error: error.message });
                        debug.finalResult = { success: false, reason: 'exception', error: error.message };
                        return debug;
                    }
                }, content);

                console.log(`[${userId}] ✅ Debug analysis complete`);

                res.json({
                    success: true,
                    debug: debugResults,
                    summary: {
                        stepsCompleted: debugResults.steps.length,
                        finalSuccess: debugResults.finalResult?.success || false,
                        statusButtonFound: debugResults.findings.statusButton?.some(s => s.found > 0) || false,
                        textInputFound: debugResults.findings.textInputs?.some(i => i.found > 0) || false
                    }
                });

            } catch (error) {
                console.error(`[${userId}] Debug analysis error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // FULL STATUS VERIFICATION: Complete send and verify it appears
        this.app.post('/status-browser/:userId/verify-status-send', async (req, res) => {
            const { userId } = req.params;
            const { content = "Test Message" } = req.body;

            try {
                if (!this.statusAutomations.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Status browser not found for this user'
                    });
                }

                const automation = this.statusAutomations.get(userId);

                console.log(`[${userId}] 🔍 VERIFY: Complete status verification...`);

                const verifyResults = await automation.page.evaluate(async (testContent) => {
                    const results = {
                        timestamp: new Date().toISOString(),
                        phases: [],
                        success: false,
                        foundElements: [],
                        currentUrl: window.location.href,
                        pageTitle: document.title
                    };

                    const log = (phase, status, details = {}) => {
                        const entry = { phase, status, details, timestamp: new Date().toISOString() };
                        results.phases.push(entry);
                        console.log(`🔍 VERIFY: ${phase} - ${status}`, details);
                    };

                    try {
                        // PHASE 1: Check current page state
                        log('Checking current page', 'analyzing');

                        // Get all visible buttons to understand current state
                        const allButtons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                        const visibleButtons = allButtons.filter(btn => btn.offsetWidth > 0 && btn.offsetHeight > 0);

                        results.foundElements = visibleButtons.slice(0, 10).map(btn => ({
                            tag: btn.tagName,
                            text: btn.innerText?.trim().substring(0, 50) || '',
                            ariaLabel: btn.getAttribute('aria-label') || '',
                            classes: Array.from(btn.classList).slice(0, 3),
                            rect: btn.getBoundingClientRect()
                        }));

                        log('Page analyzed', 'completed', { buttonsFound: visibleButtons.length });

                        // PHASE 2: Navigate to status creation step by step
                        log('Looking for Status navigation', 'searching');

                        // Try to find status button first
                        let statusBtn = document.querySelector('[aria-label="Status"]') ||
                                      document.querySelector('button[aria-label*="Status"]') ||
                                      document.querySelector('[aria-label*="סטטוס"]');

                        if (statusBtn) {
                            log('Status button found, clicking', 'success');
                            statusBtn.click();
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        } else {
                            log('Status button not found, might be already on status page', 'info');
                        }

                        // PHASE 3: Look for Add Status / Plus button
                        log('Looking for Add Status button', 'searching');

                        let addBtn = document.querySelector('button[aria-label*="Add Status"]') ||
                                   document.querySelector('[aria-label*="Add Status"]') ||
                                   document.querySelector('[aria-label*="הוסף"]') ||
                                   document.querySelector('span[data-icon="plus"]')?.parentElement;

                        if (!addBtn) {
                            // Search by text
                            const allBtns = document.querySelectorAll('button, div[role="button"]');
                            for (const btn of allBtns) {
                                const text = btn.innerText || '';
                                const label = btn.getAttribute('aria-label') || '';
                                if ((text.includes('Add') || text.includes('הוסף') ||
                                     label.includes('Add') || label.includes('הוסף')) &&
                                    btn.offsetWidth > 0) {
                                    addBtn = btn;
                                    break;
                                }
                            }
                        }

                        if (!addBtn) {
                            throw new Error('Add Status button not found');
                        }

                        log('Add Status button found, clicking', 'success');
                        addBtn.click();
                        await new Promise(resolve => setTimeout(resolve, 4000)); // Longer wait for menu

                        // PHASE 4: Look for Text option in floating menu
                        log('Looking for Text option', 'searching');

                        let textBtn = null;
                        const menuBtns = document.querySelectorAll('button, div[role="button"], div, span');
                        for (const btn of menuBtns) {
                            const text = btn.innerText?.trim() || '';
                            const label = btn.getAttribute('aria-label') || '';

                            if ((text.includes('טקסט') || text.includes('Text') ||
                                 label.includes('טקסט') || label.includes('Text')) &&
                                btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                                textBtn = btn;
                                break;
                            }
                        }

                        if (!textBtn) {
                            throw new Error('Text button not found in menu');
                        }

                        log('Text button found, clicking', 'success');
                        textBtn.click();
                        await new Promise(resolve => setTimeout(resolve, 5000)); // Even longer wait for text screen to load

                        // PHASE 5: Find text composer and enter text
                        log('Looking for text composer', 'searching');

                        const composer = document.querySelector('div[contenteditable="true"]') ||
                                       document.querySelector('textarea') ||
                                       document.querySelector('input[type="text"]');

                        if (!composer) {
                            throw new Error('Text composer not found');
                        }

                        log('Text composer found, entering text', 'success');

                        // Clear and enter text
                        composer.focus();
                        composer.textContent = '';
                        composer.innerHTML = '';

                        // Type text character by character for better compatibility
                        for (let i = 0; i < testContent.length; i++) {
                            composer.textContent += testContent[i];
                            composer.dispatchEvent(new Event('input', { bubbles: true }));
                            await new Promise(resolve => setTimeout(resolve, 10));
                        }

                        // Fire additional events
                        ['focus', 'change', 'keyup'].forEach(eventType => {
                            composer.dispatchEvent(new Event(eventType, { bubbles: true }));
                        });

                        await new Promise(resolve => setTimeout(resolve, 1000));

                        // PHASE 6: Find and click send button
                        log('Looking for send button', 'searching');

                        let sendBtn = null;
                        const sendSelectors = [
                            'span[data-icon="send"]',
                            '[data-icon="send"]',
                            'button[aria-label*="שלח"]',
                            'button[aria-label*="Send"]',
                            '[aria-label*="שלח"]',
                            '[aria-label*="Send"]'
                        ];

                        for (const selector of sendSelectors) {
                            const btn = document.querySelector(selector);
                            if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                                sendBtn = btn;
                                break;
                            }
                        }

                        // If no send button found, try text search
                        if (!sendBtn) {
                            const allBtns = document.querySelectorAll('button, div[role="button"], span');
                            for (const btn of allBtns) {
                                const text = btn.innerText?.trim() || '';
                                const label = btn.getAttribute('aria-label') || '';

                                if ((text.includes('שלח') || text.includes('Send') ||
                                     label.includes('שלח') || label.includes('Send')) &&
                                    btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                                    sendBtn = btn;
                                    break;
                                }
                            }
                        }

                        if (sendBtn) {
                            log('Send button found, clicking', 'success');
                            sendBtn.click();
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        } else {
                            log('Send button not found, trying keyboard', 'warning');
                            composer.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'Enter', keyCode: 13, bubbles: true
                            }));
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }

                        // PHASE 7: Wait much longer for status to be processed and sent to server
                        log('Waiting for status to be processed and sent', 'waiting');
                        await new Promise(resolve => setTimeout(resolve, 8000)); // Much longer wait for WhatsApp to process

                        // PHASE 8: Check if we're back to status list or see confirmation
                        log('Checking if status was sent', 'verifying');

                        const currentUrl = window.location.href;
                        const pageContent = document.body.innerText;

                        // Look for signs that status was sent
                        const statusSent = pageContent.includes(testContent.substring(0, 20)) ||
                                         currentUrl.includes('status') ||
                                         document.querySelector('[aria-label*="My status"]') ||
                                         document.querySelector('[aria-label*="הסטטוס שלי"]');

                        if (statusSent) {
                            log('Status appears to be sent successfully', 'success');
                            results.success = true;
                        } else {
                            log('Status send unclear - needs manual verification', 'warning');
                            results.success = false;
                        }

                        return results;

                    } catch (error) {
                        log('Error occurred', 'failed', { error: error.message });
                        results.success = false;
                        results.error = error.message;
                        return results;
                    }
                }, content);

                console.log(`[${userId}] 🔍 VERIFY status complete:`, verifyResults.success);

                res.json({
                    success: verifyResults.success,
                    results: verifyResults,
                    summary: {
                        phases: verifyResults.phases.length,
                        success: verifyResults.success,
                        method: 'full_verification',
                        currentUrl: verifyResults.currentUrl,
                        pageTitle: verifyResults.pageTitle
                    }
                });

            } catch (error) {
                console.error(`[${userId}] Verify status error:`, error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // DIRECT STATUS SENDER: Start from Add Status button (when already on status page)
        this.app.post('/status-browser/:userId/direct-status-send', async (req, res) => {
            const { userId } = req.params;
            const { content = "Test Message" } = req.body;

            try {
                if (!this.statusAutomations.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Status browser not found for this user'
                    });
                }

                const automation = this.statusAutomations.get(userId);

                console.log(`[${userId}] 🚀 DIRECT: Starting from Add Status button...`);

                const directResults = await automation.page.evaluate(async (testContent) => {
                    const results = {
                        timestamp: new Date().toISOString(),
                        phases: [],
                        success: false
                    };

                    const log = (phase, status, details = {}) => {
                        const entry = { phase, status, details, timestamp: new Date().toISOString() };
                        results.phases.push(entry);
                        console.log(`🚀 DIRECT: ${phase} - ${status}`, details);
                    };

                    try {
                        // PHASE 1: Look for Add Status button (we're already on status page)
                        log('Looking for Add Status button', 'searching');

                        let addStatusBtn = null;

                        // Search by exact aria-label
                        const exactSelectors = [
                            'button[aria-label="Add Status"]',
                            'button[aria-label*="Add Status"]',
                            '[aria-label="Add Status"]',
                            '[aria-label*="הוסף"]',
                            '[aria-label*="Add"]'
                        ];

                        for (const selector of exactSelectors) {
                            const btn = document.querySelector(selector);
                            if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                                addStatusBtn = btn;
                                break;
                            }
                        }

                        // If not found, search by text content
                        if (!addStatusBtn) {
                            const allButtons = document.querySelectorAll('button, div[role="button"]');
                            for (const btn of allButtons) {
                                const ariaLabel = btn.getAttribute('aria-label') || '';
                                const text = btn.innerText?.trim() || '';

                                if ((ariaLabel.includes('Add Status') || ariaLabel.includes('הוסף') ||
                                     text.includes('Add Status') || text.includes('הוסף')) &&
                                    btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                                    addStatusBtn = btn;
                                    break;
                                }
                            }
                        }

                        if (!addStatusBtn) {
                            throw new Error('Add Status button not found');
                        }

                        log('Add Status button found', 'success');
                        addStatusBtn.click();
                        await new Promise(resolve => setTimeout(resolve, 1500));

                        // PHASE 2: Look for Text button in the floating menu
                        log('Looking for Text button', 'searching');

                        let textButton = null;
                        const allButtons = document.querySelectorAll('div[role="button"], button, div, span');
                        for (const btn of allButtons) {
                            const text = btn.innerText?.trim() || '';
                            const ariaLabel = btn.getAttribute('aria-label') || '';

                            if ((text.includes('טקסט') || text.includes('Text') ||
                                 ariaLabel.includes('טקסט') || ariaLabel.includes('Text')) &&
                                btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                                textButton = btn;
                                break;
                            }
                        }

                        if (!textButton) {
                            throw new Error('Text button not found in menu');
                        }

                        log('Text button found', 'success');
                        textButton.click();
                        await new Promise(resolve => setTimeout(resolve, 2000));

                        // PHASE 3: Find the text composer in the full text screen
                        log('Looking for text composer', 'searching');

                        const composer = document.querySelector('div[contenteditable="true"]') ||
                                       document.querySelector('textarea') ||
                                       document.querySelector('input[type="text"]');

                        if (!composer) {
                            throw new Error('Text composer not found');
                        }

                        log('Text composer found', 'success');

                        // PHASE 4: Enter text and send
                        log('Entering text', 'attempting');
                        composer.focus();
                        composer.textContent = testContent;
                        composer.innerHTML = testContent;

                        // Fire events
                        ['focus', 'input', 'change', 'keyup'].forEach(eventType => {
                            composer.dispatchEvent(new Event(eventType, { bubbles: true }));
                        });

                        await new Promise(resolve => setTimeout(resolve, 500));

                        // PHASE 5: Send the status
                        log('Sending status', 'attempting');

                        // Try multiple send methods
                        let sent = false;

                        // Method 1: Look for send button
                        const sendSelectors = [
                            'span[data-icon="send"]',
                            '[data-icon="send"]',
                            'button[aria-label*="שלח"]',
                            'button[aria-label*="Send"]',
                            '[aria-label*="שלח"]',
                            '[aria-label*="Send"]'
                        ];

                        for (const selector of sendSelectors) {
                            const sendBtn = document.querySelector(selector);
                            if (sendBtn && sendBtn.offsetWidth > 0 && sendBtn.offsetHeight > 0) {
                                sendBtn.click();
                                sent = true;
                                log('Status sent via button', 'success');
                                break;
                            }
                        }

                        // Method 2: Keyboard shortcuts
                        if (!sent) {
                            composer.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'Enter', keyCode: 13, bubbles: true
                            }));
                            composer.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'Enter', keyCode: 13, ctrlKey: true, bubbles: true
                            }));
                            log('Status sent via keyboard', 'completed');
                        }

                        results.success = true;
                        log('Status sending completed', 'success');

                        return results;

                    } catch (error) {
                        log('Error occurred', 'failed', { error: error.message });
                        results.success = false;
                        results.error = error.message;
                        return results;
                    }
                }, content);

                console.log(`[${userId}] 🚀 DIRECT status complete:`, directResults.success);

                res.json({
                    success: directResults.success,
                    results: directResults,
                    summary: {
                        phases: directResults.phases.length,
                        success: directResults.success,
                        method: 'direct_add_status'
                    }
                });

            } catch (error) {
                console.error(`[${userId}] Direct status error:`, error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ADVANCED STATUS COMPOSER FINDER: Navigate to status and find real composer
        this.app.post('/status-browser/:userId/find-status-composer', async (req, res) => {
            const { userId } = req.params;
            const { content = "Test Message" } = req.body;

            try {
                if (!this.statusAutomations.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Status browser not found for this user'
                    });
                }

                const automation = this.statusAutomations.get(userId);

                console.log(`[${userId}] 🔍 ADVANCED: Finding Status composer step by step...`);

                const composerResults = await automation.page.evaluate(async (testContent) => {
                    const results = {
                        timestamp: new Date().toISOString(),
                        phases: [],
                        elements: {},
                        finalResult: null
                    };

                    const log = (phase, status, details = {}) => {
                        const entry = { phase, status, details, timestamp: new Date().toISOString() };
                        results.phases.push(entry);
                        console.log(`🔍 PHASE: ${phase} - ${status}`, details);
                    };

                    try {
                        // PHASE 1: Click Status tab and analyze page change
                        log('Click Status tab', 'attempting');

                        const statusButton = document.querySelector('[aria-label="Status"]') ||
                                           (document.querySelector('span[data-icon="status-refreshed"]')?.parentElement);

                        if (!statusButton) {
                            throw new Error('Status button not found');
                        }

                        statusButton.click();
                        log('Status tab clicked', 'success');

                        // Wait for page to change
                        await new Promise(resolve => setTimeout(resolve, 2000));

                        // PHASE 2: Analyze what's on the status page now
                        log('Analyzing status page content', 'checking');

                        const allVisibleElements = Array.from(document.querySelectorAll('*')).filter(el => {
                            const rect = el.getBoundingClientRect();
                            return rect.width > 20 && rect.height > 20 &&
                                   el.offsetWidth > 0 && el.offsetHeight > 0;
                        });

                        // Look for status-specific elements
                        const statusPageElements = allVisibleElements.filter(el => {
                            const text = el.innerText?.toLowerCase() || '';
                            const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
                            const dataIcon = el.getAttribute('data-icon') ||
                                           el.querySelector('span[data-icon]')?.getAttribute('data-icon') || '';

                            return text.includes('status') ||
                                   text.includes('add') ||
                                   text.includes('story') ||
                                   ariaLabel.includes('add') ||
                                   ariaLabel.includes('status') ||
                                   dataIcon.includes('plus') ||
                                   dataIcon.includes('add') ||
                                   dataIcon.includes('camera');
                        });

                        results.elements.statusPageElements = statusPageElements.slice(0, 10).map(el => ({
                            tagName: el.tagName,
                            text: el.innerText?.trim().substring(0, 100),
                            ariaLabel: el.getAttribute('aria-label'),
                            dataIcon: el.getAttribute('data-icon') || el.querySelector('span[data-icon]')?.getAttribute('data-icon'),
                            rect: el.getBoundingClientRect(),
                            classes: Array.from(el.classList),
                            role: el.getAttribute('role')
                        }));

                        log('Status page analyzed', 'completed', { foundElements: statusPageElements.length });

                        // PHASE 3: Look for Plus (+) button at the top
                        log('Looking for Plus button at top', 'searching');

                        const plusButtonSelectors = [
                            // Look for plus button at the top
                            'span[data-icon="plus"]',
                            'span[data-icon="add"]',
                            'button[aria-label*="הוסף"]', // Hebrew "Add"
                            'button[aria-label*="Add"]',
                            '[data-icon="plus"]',
                            '[data-icon="add"]',
                            'div[role="button"]:has(span[data-icon="plus"])',
                            'div[role="button"]:has(span[data-icon="add"])'
                        ];

                        let addButton = null;
                        const addButtonFindings = [];

                        for (const selector of plusButtonSelectors) {
                            const elements = document.querySelectorAll(selector);
                            const elementInfo = Array.from(elements).map(el => ({
                                selector: selector,
                                tagName: el.tagName,
                                visible: el.offsetWidth > 0 && el.offsetHeight > 0,
                                rect: el.getBoundingClientRect(),
                                ariaLabel: el.getAttribute('aria-label'),
                                dataIcon: el.getAttribute('data-icon') || el.querySelector('span[data-icon]')?.getAttribute('data-icon'),
                                text: el.innerText?.trim().substring(0, 50)
                            }));

                            addButtonFindings.push({
                                selector,
                                found: elements.length,
                                elements: elementInfo
                            });

                            const visibleElements = Array.from(elements).filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);
                            if (visibleElements.length > 0) {
                                addButton = visibleElements[0];
                                log('Add button found', 'success', { selector, element: elementInfo[0] });
                                break;
                            }
                        }

                        // If no button found with selectors, try text-based search (Hebrew)
                        if (!addButton) {
                            const allButtons = document.querySelectorAll('div[role="button"], button');
                            for (const btn of allButtons) {
                                const text = btn.innerText?.trim() || '';
                                const ariaLabel = btn.getAttribute('aria-label') || '';

                                if ((text.includes('טקסט') || text.includes('הוסף') ||
                                     ariaLabel.includes('טקסט') || ariaLabel.includes('הוסף') ||
                                     text.includes('Text') || ariaLabel.includes('Text')) &&
                                    btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                                    addButton = btn;
                                    log('Add button found via text search', 'success', {
                                        text: text,
                                        ariaLabel: ariaLabel
                                    });
                                    break;
                                }
                            }
                        }

                        results.elements.addButtonSearch = addButtonFindings;

                        if (addButton) {
                            // PHASE 4: Click Plus button to open floating menu
                            log('Clicking Plus button', 'attempting');
                            addButton.click();

                            // Wait for floating menu to appear
                            await new Promise(resolve => setTimeout(resolve, 1500));
                            log('Plus button clicked, waiting for menu', 'completed');

                            // PHASE 4.5: Look for "טקסט" (Text) button in floating menu
                            log('Looking for Text button in menu', 'searching');

                            const textButtonSelectors = [
                                '*[aria-label*="טקסט"]', // Hebrew "Text"
                                'div[role="button"]:has(*:contains("טקסט"))',
                                'button:contains("טקסט")',
                                '*:contains("טקסט")',
                                'span[data-icon="text"]',
                                '*[aria-label*="Text"]', // English fallback
                                'button:contains("Text")'
                            ];

                            let textButton = null;
                            for (const selector of textButtonSelectors) {
                                try {
                                    const elements = document.querySelectorAll(selector);
                                    const visibleElements = Array.from(elements).filter(el =>
                                        el.offsetWidth > 0 && el.offsetHeight > 0);
                                    if (visibleElements.length > 0) {
                                        textButton = visibleElements[0];
                                        log('Text button found', 'success', { selector });
                                        break;
                                    }
                                } catch (e) {
                                    // Ignore CSS selector errors
                                }
                            }

                            // Manual text search for "טקסט"
                            if (!textButton) {
                                const allButtons = document.querySelectorAll('div[role="button"], button, div, span');
                                for (const btn of allButtons) {
                                    const text = btn.innerText?.trim() || '';
                                    const ariaLabel = btn.getAttribute('aria-label') || '';

                                    if ((text.includes('טקסט') || text.includes('Text') ||
                                         ariaLabel.includes('טקסט') || ariaLabel.includes('Text')) &&
                                        btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                                        textButton = btn;
                                        log('Text button found via text search', 'success', {
                                            text: text,
                                            ariaLabel: ariaLabel
                                        });
                                        break;
                                    }
                                }
                            }

                            if (textButton) {
                                // PHASE 4.6: Click Text button
                                log('Clicking Text button', 'attempting');
                                textButton.click();

                                // Wait for text status screen to load
                                await new Promise(resolve => setTimeout(resolve, 2000));
                                log('Text button clicked, waiting for text screen', 'completed');
                            } else {
                                log('Text button not found', 'failed');
                            }

                            // PHASE 5: Look for the status composer
                            log('Looking for status composer', 'searching');

                            const composerSelectors = [
                                // Full text status screen - look for main text area
                                'div[contenteditable="true"]',
                                'textarea',
                                'input[type="text"]',
                                '[contenteditable="true"]',
                                'div[role="textbox"]',
                                'div[data-lexical-editor="true"]',
                                // Specific status selectors
                                'div[contenteditable="true"][data-testid*="status"]',
                                'div[contenteditable="true"][aria-label*="Type"]',
                                'div[contenteditable="true"][placeholder*="status"]',
                                'textarea[placeholder*="status"]'
                            ];

                            let composer = null;
                            const composerFindings = [];

                            for (const selector of composerSelectors) {
                                const elements = document.querySelectorAll(selector);
                                const elementInfo = Array.from(elements).map(el => ({
                                    selector: selector,
                                    tagName: el.tagName,
                                    visible: el.offsetWidth > 0 && el.offsetHeight > 0,
                                    rect: el.getBoundingClientRect(),
                                    ariaLabel: el.getAttribute('aria-label'),
                                    placeholder: el.placeholder,
                                    contentEditable: el.contentEditable,
                                    dataTestId: el.getAttribute('data-testid')
                                }));

                                composerFindings.push({
                                    selector,
                                    found: elements.length,
                                    elements: elementInfo
                                });

                                const visibleElements = Array.from(elements).filter(el =>
                                    el.offsetWidth > 50 && el.offsetHeight > 20 &&
                                    el.offsetWidth > 0 && el.offsetHeight > 0
                                );
                                if (visibleElements.length > 0) {
                                    // Find the largest visible element (most likely to be the main composer)
                                    composer = visibleElements.sort((a, b) =>
                                        (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight)
                                    )[0];
                                    log('Status composer found', 'success', {
                                        selector,
                                        rect: composer.getBoundingClientRect()
                                    });
                                    break;
                                }
                            }

                            results.elements.composerSearch = composerFindings;

                            if (composer) {
                                // PHASE 6: Try to send status
                                log('Testing status composer', 'attempting');

                                composer.focus();
                                composer.textContent = testContent;
                                composer.innerHTML = testContent;

                                // Fire events
                                ['focus', 'input', 'change', 'keyup'].forEach(eventType => {
                                    composer.dispatchEvent(new Event(eventType, { bubbles: true }));
                                });

                                await new Promise(resolve => setTimeout(resolve, 500));

                                // Try multiple send methods
                                const sendMethods = [
                                    () => {
                                        composer.dispatchEvent(new KeyboardEvent('keydown', {
                                            key: 'Enter', keyCode: 13, bubbles: true
                                        }));
                                    },
                                    () => {
                                        composer.dispatchEvent(new KeyboardEvent('keydown', {
                                            key: 'Enter', keyCode: 13, ctrlKey: true, bubbles: true
                                        }));
                                    },
                                    () => {
                                        // Look for send button (Hebrew "שלח" and English "Send")
                                        const sendSelectors = [
                                            'span[data-icon="send"]',
                                            '[data-icon="send"]',
                                            'button[aria-label*="שלח"]', // Hebrew "Send"
                                            'button[aria-label*="Send"]',
                                            '[aria-label*="שלח"]',
                                            '[aria-label*="Send"]',
                                            'div[role="button"]:has(span[data-icon="send"])'
                                        ];

                                        let sendBtn = null;
                                        for (const selector of sendSelectors) {
                                            const btn = document.querySelector(selector);
                                            if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                                                sendBtn = btn;
                                                break;
                                            }
                                        }

                                        // Text-based search for send button
                                        if (!sendBtn) {
                                            const allButtons = document.querySelectorAll('button, div[role="button"], span');
                                            for (const btn of allButtons) {
                                                const text = btn.innerText?.trim() || '';
                                                const ariaLabel = btn.getAttribute('aria-label') || '';

                                                if ((text.includes('שלח') || text.includes('Send') ||
                                                     ariaLabel.includes('שלח') || ariaLabel.includes('Send')) &&
                                                    btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                                                    sendBtn = btn;
                                                    break;
                                                }
                                            }
                                        }

                                        if (sendBtn) {
                                            sendBtn.click();
                                        }
                                    }
                                ];

                                sendMethods.forEach((method, i) => {
                                    setTimeout(method, i * 100);
                                });

                                log('Status send attempted', 'completed');

                                results.finalResult = {
                                    success: true,
                                    method: 'status_composer',
                                    composer: {
                                        selector: composerFindings.find(f => f.elements.some(e => e.visible))?.selector,
                                        rect: composer.getBoundingClientRect()
                                    }
                                };

                            } else {
                                log('Status composer not found', 'failed');
                                results.finalResult = { success: false, reason: 'no_composer' };
                            }

                        } else {
                            log('Add Status button not found', 'failed');
                            results.finalResult = { success: false, reason: 'no_add_button' };
                        }

                        return results;

                    } catch (error) {
                        log('ERROR', 'failed', { error: error.message });
                        results.finalResult = { success: false, reason: 'exception', error: error.message };
                        return results;
                    }
                }, content);

                console.log(`[${userId}] ✅ Status composer analysis complete`);

                res.json({
                    success: true,
                    results: composerResults,
                    summary: {
                        phases: composerResults.phases.length,
                        success: composerResults.finalResult?.success || false,
                        foundAddButton: composerResults.elements.addButtonSearch?.some(s => s.found > 0) || false,
                        foundComposer: composerResults.elements.composerSearch?.some(s => s.found > 0) || false,
                        method: composerResults.finalResult?.method
                    }
                });

            } catch (error) {
                console.error(`[${userId}] Status composer analysis error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Send image status via status browser
        this.app.post('/status-browser/:userId/status/image', async (req, res) => {
            const { userId } = req.params;
            const { caption = '', options = {} } = req.body;

            try {
                if (!this.statusAutomations.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Status browser not found for this user'
                    });
                }

                const automation = this.statusAutomations.get(userId);

                // Check if authenticated
                const isAuth = await automation.isAuthenticated();
                if (!isAuth) {
                    return res.status(401).json({
                        success: false,
                        error: 'Not authenticated. Please scan QR code first.'
                    });
                }

                // Handle image upload
                if (!req.files || !req.files.image) {
                    return res.status(400).json({
                        success: false,
                        error: 'No image file uploaded'
                    });
                }

                const imageBuffer = req.files.image.data;
                const result = await automation.sendImageStatus(imageBuffer, caption, options);

                res.json({
                    success: true,
                    message: 'Image status sent successfully',
                    method: 'status_browser',
                    result: result
                });

            } catch (error) {
                console.error(`[${userId}] Image status send error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Send video status via status browser
        this.app.post('/status-browser/:userId/status/video', async (req, res) => {
            const { userId } = req.params;
            const { caption = '', options = {} } = req.body;

            try {
                if (!this.statusAutomations.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Status browser not found for this user'
                    });
                }

                const automation = this.statusAutomations.get(userId);

                // Check if authenticated
                const isAuth = await automation.isAuthenticated();
                if (!isAuth) {
                    return res.status(401).json({
                        success: false,
                        error: 'Not authenticated. Please scan QR code first.'
                    });
                }

                // Handle video upload
                if (!req.files || !req.files.video) {
                    return res.status(400).json({
                        success: false,
                        error: 'No video file uploaded'
                    });
                }

                const videoBuffer = req.files.video.data;
                const result = await automation.sendVideoStatus(videoBuffer, caption, options);

                res.json({
                    success: true,
                    message: 'Video status sent successfully',
                    method: 'status_browser',
                    result: result
                });

            } catch (error) {
                console.error(`[${userId}] Video status send error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get status browser connection status
        this.app.get('/status-browser/:userId/status', async (req, res) => {
            const { userId } = req.params;

            try {
                if (!this.statusAutomations.has(userId)) {
                    return res.json({
                        success: false,
                        connected: false,
                        authenticated: false,
                        message: 'Status browser not found for this user'
                    });
                }

                const automation = this.statusAutomations.get(userId);
                const isAuth = await automation.isAuthenticated();

                res.json({
                    success: true,
                    connected: true,
                    authenticated: isAuth,
                    userId: userId,
                    statusReady: automation.isStatusReady
                });

            } catch (error) {
                console.error(`[${userId}] Status check error:`, error.message);
                res.json({
                    success: false,
                    connected: false,
                    authenticated: false,
                    error: error.message
                });
            }
        });

        // Force recheck status readiness
        this.app.post('/status-browser/:userId/recheck', async (req, res) => {
            const { userId } = req.params;
            try {
                if (!this.statusAutomations.has(userId)) {
                    return res.status(404).json({
                        success: false,
                        error: 'Status browser not found for this user'
                    });
                }

                const automation = this.statusAutomations.get(userId);
                const isReady = await automation.recheckStatusReady();

                res.json({
                    success: true,
                    message: 'Status recheck completed',
                    userId: userId,
                    statusReady: isReady
                });
            } catch (error) {
                console.error(`[${userId}] Status recheck error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Close status browser session
        this.app.delete('/status-browser/:userId', async (req, res) => {
            const { userId } = req.params;

            try {
                if (this.statusAutomations.has(userId)) {
                    const automation = this.statusAutomations.get(userId);
                    await automation.close();
                    this.statusAutomations.delete(userId);
                }

                res.json({
                    success: true,
                    message: 'Status browser closed successfully',
                    userId: userId
                });

            } catch (error) {
                console.error(`[${userId}] Close error:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ============================================
        // SYSTEM ENDPOINTS
        // ============================================

        // Health check
        this.app.get('/health', (req, res) => {
            const activeBrowsers = this.statusAutomations.size;

            res.json({
                status: 'ok',
                activeBrowsers: activeBrowsers,
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                version: '2.0.0-status-only'
            });
        });

        // List all active status browsers
        this.app.get('/sessions', async (req, res) => {
            const sessions = [];

            for (const [userId, automation] of this.statusAutomations.entries()) {
                try {
                    // Check authentication status
                    const isAuthenticated = await automation.isAuthenticated();

                    sessions.push({
                        sessionId: `status-browser-${userId}`,
                        userId: userId,
                        type: 'status_browser',
                        isStatusReady: automation.isStatusReady && isAuthenticated,
                        isAuthenticated: isAuthenticated,
                        needsQR: !isAuthenticated,
                        createdAt: new Date().toISOString(),
                        method: 'browser_automation'
                    });
                } catch (error) {
                    console.error(`[${userId}] Error checking session status:`, error.message);
                    sessions.push({
                        sessionId: `status-browser-${userId}`,
                        userId: userId,
                        type: 'status_browser',
                        isStatusReady: false,
                        isAuthenticated: false,
                        needsQR: true,
                        createdAt: new Date().toISOString(),
                        method: 'browser_automation',
                        error: error.message
                    });
                }
            }

            res.json({
                sessions: sessions,
                total: sessions.length
            });
        });

        // 📋 Check Status List - בדיקה אם יש סטטוסים ברשימה
        this.app.get('/status-browser/:userId/check-status-list', async (req, res) => {
            console.log('📋 Checking status list for user:', req.params.userId);

            try {
                const { userId } = req.params;
                const automation = this.statusAutomations.get(userId);

                if (!automation) {
                    return res.status(404).json({
                        success: false,
                        error: 'User session not found. Please create session first.',
                        hasStatuses: false
                    });
                }

                const results = await automation.page.evaluate(async () => {
                    const results = {
                        timestamp: new Date().toISOString(),
                        phases: [],
                        statusElements: [],
                        myStatusElements: [],
                        statusButtonFound: false,
                        currentUrl: window.location.href,
                        pageTitle: document.title
                    };

                    const log = (phase, status, details = {}) => {
                        const entry = { phase, status, details, timestamp: new Date().toISOString() };
                        results.phases.push(entry);
                        console.log(`📋 CHECK: ${phase} - ${status}`, details);
                    };

                    try {
                        // PHASE 1: Check if we're on the right page
                        log('Checking current page', 'analyzing');

                        // PHASE 2: Look for Status button to ensure we can navigate
                        log('Looking for Status navigation', 'searching');

                        let statusBtn = null;
                        const statusSelectors = [
                            'button[aria-label*="Status"]',
                            'button[aria-label*="סטטוס"]',
                            '[aria-label*="Updates in Status"]',
                            'span[data-icon="status-refreshed"]',
                            'div[title*="Status"]'
                        ];

                        for (const selector of statusSelectors) {
                            const btn = document.querySelector(selector);
                            if (btn) {
                                statusBtn = btn.closest('button') || btn;
                                if (statusBtn && statusBtn.offsetWidth > 0 && statusBtn.offsetHeight > 0) {
                                    results.statusButtonFound = true;
                                    break;
                                }
                            }
                        }

                        if (statusBtn) {
                            log('Status button found, clicking to view statuses', 'success');
                            statusBtn.click();
                            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for status page to load
                        } else {
                            log('Status button not found, checking current page', 'warning');
                        }

                        // PHASE 3: Look for status elements
                        log('Scanning for status elements', 'searching');

                        // Look for individual status items
                        const statusItemSelectors = [
                            '[data-testid*="status"]',
                            'div[role="button"][tabindex="0"]',
                            '.status-item',
                            '[aria-label*="Status"]',
                            '[aria-label*="סטטוס"]'
                        ];

                        for (const selector of statusItemSelectors) {
                            const elements = document.querySelectorAll(selector);
                            for (const element of elements) {
                                if (element.offsetWidth > 0 && element.offsetHeight > 0) {
                                    const rect = element.getBoundingClientRect();
                                    const ariaLabel = element.getAttribute('aria-label') || '';
                                    const text = element.innerText?.trim().substring(0, 100) || '';

                                    results.statusElements.push({
                                        selector,
                                        ariaLabel,
                                        text,
                                        rect: {
                                            x: Math.round(rect.x),
                                            y: Math.round(rect.y),
                                            width: Math.round(rect.width),
                                            height: Math.round(rect.height)
                                        }
                                    });
                                }
                            }
                        }

                        log(`Found ${results.statusElements.length} potential status elements`, 'info');

                        // PHASE 4: Look specifically for "My Status" or own status
                        log('Looking for My Status section', 'searching');

                        // Custom contains selector since querySelectorAll doesn't support :contains
                        const allDivs = document.querySelectorAll('div, span, button');
                        for (const element of allDivs) {
                            const text = element.innerText?.trim() || '';
                            const ariaLabel = element.getAttribute('aria-label') || '';

                            if ((text.includes('My status') || text.includes('הסטטוס שלי') ||
                                 ariaLabel.includes('My status') || ariaLabel.includes('הסטטוס שלי')) &&
                                element.offsetWidth > 0 && element.offsetHeight > 0) {

                                const rect = element.getBoundingClientRect();
                                results.myStatusElements.push({
                                    tag: element.tagName,
                                    text,
                                    ariaLabel,
                                    rect: {
                                        x: Math.round(rect.x),
                                        y: Math.round(rect.y),
                                        width: Math.round(rect.width),
                                        height: Math.round(rect.height)
                                    }
                                });
                            }
                        }

                        log(`Found ${results.myStatusElements.length} My Status elements`, 'info');

                        // PHASE 5: Final summary
                        const hasStatuses = results.statusElements.length > 0 || results.myStatusElements.length > 0;
                        log('Status check completed', hasStatuses ? 'success' : 'warning', {
                            totalStatusElements: results.statusElements.length,
                            myStatusElements: results.myStatusElements.length,
                            hasStatuses
                        });

                        results.hasStatuses = hasStatuses;
                        results.success = true;

                    } catch (error) {
                        log('Error during status check', 'error', { error: error.message });
                        results.success = false;
                        results.error = error.message;
                    }

                    return results;
                });

                const summary = {
                    hasStatuses: results.hasStatuses || false,
                    totalStatusElements: results.statusElements?.length || 0,
                    myStatusElements: results.myStatusElements?.length || 0,
                    statusButtonFound: results.statusButtonFound || false,
                    phases: results.phases?.length || 0,
                    success: results.success || false,
                    currentUrl: results.currentUrl,
                    pageTitle: results.pageTitle
                };

                console.log('📋 Status check completed:', summary);
                res.json({ success: true, results, summary });

            } catch (error) {
                console.error('❌ Check status list error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message,
                    hasStatuses: false,
                    summary: {
                        success: false,
                        error: error.message
                    }
                });
            }
        });

        // 🚀 WA-JS Status Send - השליחה הנכונה דרך WA-JS API
        this.app.post('/status-browser/:userId/send-wajs-status', async (req, res) => {
            console.log('🚀 Sending status via WA-JS API for user:', req.params.userId);

            try {
                const { userId } = req.params;
                const { content = "Test Message via WA-JS" } = req.body;
                const automation = this.statusAutomations.get(userId);

                if (!automation) {
                    return res.status(404).json({
                        success: false,
                        error: 'User session not found. Please create session first.'
                    });
                }

                const results = await automation.page.evaluate(async (statusContent) => {
                    const results = {
                        timestamp: new Date().toISOString(),
                        phases: [],
                        success: false,
                        currentUrl: window.location.href,
                        pageTitle: document.title
                    };

                    const log = (phase, status, details = {}) => {
                        const entry = { phase, status, details, timestamp: new Date().toISOString() };
                        results.phases.push(entry);
                        console.log(`🚀 WA-JS: ${phase} - ${status}`, details);
                    };

                    try {
                        // PHASE 1: Check if WA-JS is loaded
                        log('Checking WA-JS availability', 'analyzing');

                        if (typeof window.WPP === 'undefined') {
                            throw new Error('WA-JS (WPP) is not loaded');
                        }

                        if (!window.WPP.isFullReady) {
                            throw new Error('WA-JS is not fully ready');
                        }

                        log('WA-JS is ready', 'success');

                        // PHASE 2: Check if status module is available
                        log('Checking status module', 'analyzing');

                        if (!window.WPP.status) {
                            throw new Error('WA-JS status module is not available');
                        }

                        if (!window.WPP.status.sendTextStatus) {
                            throw new Error('WA-JS sendTextStatus function is not available');
                        }

                        log('Status module is available', 'success');

                        // PHASE 3: Navigate to Status tab first
                        log('Navigating to Status tab', 'navigating');

                        // Find Status button
                        const statusSelectors = [
                            '[data-navbar-item-index="1"]',
                            'button[aria-label*="Status"]',
                            'button[aria-label*="סטטוס"]',
                            '[aria-label*="Updates in Status"]',
                            'span[data-icon="status-refreshed"]'
                        ];

                        let statusBtn = null;
                        for (const selector of statusSelectors) {
                            const btn = document.querySelector(selector);
                            if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                                statusBtn = btn.closest('button') || btn;
                                break;
                            }
                        }

                        if (statusBtn) {
                            log('Status button found, clicking', 'success');
                            statusBtn.click();
                            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for status page to load
                        } else {
                            log('Status button not found, continuing anyway', 'warning');
                        }

                        // PHASE 4: Send status using WA-JS API
                        log('Sending status via WA-JS API', 'sending');

                        const statusOptions = {
                            backgroundColor: '#25D366', // WhatsApp green
                            font: 1, // Default font
                            textColor: '#FFFFFF' // White text
                        };

                        const waResult = await window.WPP.status.sendTextStatus(statusContent, statusOptions);

                        log('Status sent successfully via WA-JS', 'success', {
                            messageId: waResult?.id || 'unknown',
                            result: waResult
                        });

                        results.success = true;
                        results.waResult = waResult;

                    } catch (error) {
                        log('Error occurred', 'error', { error: error.message });
                        results.success = false;
                        results.error = error.message;
                    }

                    return results;
                }, content);

                const summary = {
                    success: results.success || false,
                    phases: results.phases?.length || 0,
                    method: 'wa-js-api',
                    currentUrl: results.currentUrl,
                    pageTitle: results.pageTitle,
                    messageId: results.waResult?.id || null
                };

                if (results.success) {
                    console.log('🚀 WA-JS status sent successfully:', summary);
                    res.json({ success: true, results, summary });
                } else {
                    console.log('❌ WA-JS status failed:', results.error);
                    res.status(500).json({
                        success: false,
                        error: results.error,
                        results,
                        summary
                    });
                }

            } catch (error) {
                console.error('❌ WA-JS status send error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message,
                    method: 'wa-js-api'
                });
            }
        });

        // 📝 Send Text Status - WA-JS API
        this.app.post('/api/v1/status/text/:userId', async (req, res) => {
            console.log('📝 Sending text status for user:', req.params.userId);

            try {
                const { userId } = req.params;
                const { content, options = {} } = req.body;
                const automation = this.statusAutomations.get(userId);

                if (!automation) {
                    return res.status(404).json({
                        success: false,
                        error: 'User session not found. Please create session first.'
                    });
                }

                if (!content) {
                    return res.status(400).json({
                        success: false,
                        error: 'Content is required for text status'
                    });
                }

                const result = await automation.page.evaluate(async (params) => {
                    try {
                        if (typeof window.WPP === 'undefined' || !window.WPP.isFullReady) {
                            throw new Error('WA-JS is not ready');
                        }

                        const defaultOptions = {
                            backgroundColor: '#25D366',
                            font: 1,
                            textColor: '#FFFFFF'
                        };

                        const finalOptions = { ...defaultOptions, ...params.options };
                        const waResult = await window.WPP.status.sendTextStatus(params.content, finalOptions);

                        return {
                            success: true,
                            messageId: waResult?.id,
                            result: waResult
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: error.message
                        };
                    }
                }, { content, options });

                if (result.success) {
                    res.json({
                        success: true,
                        type: 'text',
                        messageId: result.messageId,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: result.error,
                        type: 'text'
                    });
                }

            } catch (error) {
                console.error('❌ Text status error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message,
                    type: 'text'
                });
            }
        });

        // 🖼️ Send Image Status - WA-JS API
        this.app.post('/api/v1/status/image/:userId', async (req, res) => {
            console.log('🖼️ Sending image status for user:', req.params.userId);

            try {
                const { userId } = req.params;
                const { content, caption = '', options = {} } = req.body;
                const automation = this.statusAutomations.get(userId);

                if (!automation) {
                    return res.status(404).json({
                        success: false,
                        error: 'User session not found. Please create session first.'
                    });
                }

                if (!content) {
                    return res.status(400).json({
                        success: false,
                        error: 'Image content (base64 or URL) is required'
                    });
                }

                const result = await automation.page.evaluate(async (params) => {
                    try {
                        if (typeof window.WPP === 'undefined' || !window.WPP.isFullReady) {
                            throw new Error('WA-JS is not ready');
                        }

                        const finalOptions = {
                            caption: params.caption,
                            ...params.options
                        };

                        const waResult = await window.WPP.status.sendImageStatus(params.content, finalOptions);

                        return {
                            success: true,
                            messageId: waResult?.id,
                            result: waResult
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: error.message
                        };
                    }
                }, { content, caption, options });

                if (result.success) {
                    res.json({
                        success: true,
                        type: 'image',
                        messageId: result.messageId,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: result.error,
                        type: 'image'
                    });
                }

            } catch (error) {
                console.error('❌ Image status error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message,
                    type: 'image'
                });
            }
        });

        // 🎥 Send Video Status - WA-JS API
        this.app.post('/api/v1/status/video/:userId', async (req, res) => {
            console.log('🎥 Sending video status for user:', req.params.userId);

            try {
                const { userId } = req.params;
                const { content, caption = '', options = {} } = req.body;
                const automation = this.statusAutomations.get(userId);

                if (!automation) {
                    return res.status(404).json({
                        success: false,
                        error: 'User session not found. Please create session first.'
                    });
                }

                if (!content) {
                    return res.status(400).json({
                        success: false,
                        error: 'Video content (base64 or URL) is required'
                    });
                }

                const result = await automation.page.evaluate(async (params) => {
                    try {
                        if (typeof window.WPP === 'undefined' || !window.WPP.isFullReady) {
                            throw new Error('WA-JS is not ready');
                        }

                        const finalOptions = {
                            caption: params.caption,
                            ...params.options
                        };

                        const waResult = await window.WPP.status.sendVideoStatus(params.content, finalOptions);

                        return {
                            success: true,
                            messageId: waResult?.id,
                            result: waResult
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: error.message
                        };
                    }
                }, { content, caption, options });

                if (result.success) {
                    res.json({
                        success: true,
                        type: 'video',
                        messageId: result.messageId,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: result.error,
                        type: 'video'
                    });
                }

            } catch (error) {
                console.error('❌ Video status error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message,
                    type: 'video'
                });
            }
        });

        // 📊 Status API Info - Documentation
        this.app.get('/api/v1/status/info', (req, res) => {
            res.json({
                name: 'WhatsApp Status API',
                version: '1.0',
                endpoints: {
                    text: {
                        method: 'POST',
                        url: '/api/v1/status/text/:userId',
                        description: 'Send text status',
                        body: {
                            content: 'string (required) - Status text content',
                            options: {
                                backgroundColor: 'string (optional) - Hex color code',
                                font: 'number (optional) - Font type (1-9)',
                                textColor: 'string (optional) - Hex color code'
                            }
                        },
                        example: {
                            content: 'Hello World!',
                            options: {
                                backgroundColor: '#25D366',
                                font: 1,
                                textColor: '#FFFFFF'
                            }
                        }
                    },
                    image: {
                        method: 'POST',
                        url: '/api/v1/status/image/:userId',
                        description: 'Send image status',
                        body: {
                            content: 'string (required) - Base64 image data or image URL',
                            caption: 'string (optional) - Image caption',
                            options: 'object (optional) - Additional options'
                        },
                        example: {
                            content: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...',
                            caption: 'My awesome image!'
                        }
                    },
                    video: {
                        method: 'POST',
                        url: '/api/v1/status/video/:userId',
                        description: 'Send video status',
                        body: {
                            content: 'string (required) - Base64 video data or video URL',
                            caption: 'string (optional) - Video caption',
                            options: 'object (optional) - Additional options'
                        },
                        example: {
                            content: 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21...',
                            caption: 'Check out this video!'
                        }
                    }
                },
                notes: [
                    'All endpoints require a valid userId parameter',
                    'User session must be created and authenticated first',
                    'Content for images/videos can be base64 data or URLs',
                    'Status will be sent using WA-JS API for maximum reliability'
                ]
            });
        });

        // 💓 Keep-Alive Endpoint - שמירה על חיבור פעיל
        this.app.post('/api/v1/keep-alive/:userId', async (req, res) => {
            try {
                const { userId } = req.params;
                const automation = this.statusAutomations.get(userId);

                if (!automation) {
                    return res.status(404).json({
                        success: false,
                        error: 'User session not found'
                    });
                }

                // שלח פעילות קטנה לווטסאפ כדי לשמור על החיבור
                const result = await automation.page.evaluate(async () => {
                    try {
                        if (typeof window.WPP === 'undefined' || !window.WPP.isFullReady) {
                            return {
                                success: false,
                                error: 'WA-JS is not ready'
                            };
                        }

                        // פעילות קטנה - בדיקת סטטוס החיבור
                        const connectionState = window.WPP.conn.state;
                        const isConnected = connectionState === 'CONNECTED';

                        // אם מנותק, נסה להתחבר מחדש
                        if (!isConnected) {
                            console.log('🔄 Connection lost, attempting to reconnect...');
                            // אפשר להוסיף כאן לוגיקה להתחברות מחדש
                        }

                        return {
                            success: true,
                            connectionState,
                            isConnected,
                            timestamp: new Date().toISOString()
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: error.message
                        };
                    }
                });

                res.json({
                    success: true,
                    keepAlive: true,
                    userId,
                    ...result,
                    serverTime: new Date().toISOString()
                });

            } catch (error) {
                console.error('❌ Keep-alive error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message,
                    keepAlive: false
                });
            }
        });

        // 🔄 Auto Keep-Alive - פעילות אוטומטית בכל 5 דקות
        this.startAutoKeepAlive();

        // API Documentation endpoint
        this.app.get('/api-docs', (req, res) => {
            console.log('WhatsApp Status-Only Automation API');
            console.log('====================================');
            console.log('Clean implementation without Baileys - Browser-based status operations only');
            console.log('');

            console.log('🎯 Status-Only Browser Operations:');
            console.log('  POST   /status-browser/create/:userId     - Create status-optimized browser');
            console.log('  GET    /status-browser/:userId/qr        - Get QR code');
            console.log('  POST   /status-browser/:userId/status/text  - Send text status');
            console.log('  POST   /status-browser/:userId/status/text/ultra-fast - 🚀 Ultra-fast text status (15-30s target)');
            console.log('  GET    /status-browser/:userId/inspect-selectors - 🔍 DOM Inspector (find real selectors)');
            console.log('  POST   /status-browser/:userId/status/image - Send image status');
            console.log('  POST   /status-browser/:userId/status/video - Send video status');
            console.log('  GET    /status-browser/:userId/status     - Get connection status');
            console.log('  DELETE /status-browser/:userId           - Close browser session');
            console.log('');

            console.log('📊 System:');
            console.log('  GET    /health                           - Health check');
            console.log('  GET    /sessions                         - List active sessions');

            res.json({
                name: 'WhatsApp Status-Only Automation API',
                version: '2.0.0-status-only',
                description: 'Optimized browser automation for WhatsApp status operations',
                endpoints: {
                    status_browser: {
                        create: 'POST /status-browser/create/:userId',
                        qr: 'GET /status-browser/:userId/qr',
                        send_text: 'POST /status-browser/:userId/status/text',
                        send_image: 'POST /status-browser/:userId/status/image',
                        send_video: 'POST /status-browser/:userId/status/video',
                        status: 'GET /status-browser/:userId/status',
                        close: 'DELETE /status-browser/:userId'
                    },
                    system: {
                        health: 'GET /health',
                        sessions: 'GET /sessions'
                    }
                }
            });
        });
    }

    async start(port = 3000) {
        return new Promise((resolve) => {
            this.server = this.app.listen(port, () => {
                console.log(`🚀 WhatsApp Status-Only Automation API running on port ${port}`);
                console.log(`📱 Optimized for browser-based status operations without chat loading`);
                console.log(`🎯 Access dashboard at http://localhost:${port}`);
                resolve();
            });
        });
    }

    async restoreActiveSessions() {
        console.log('🔄 Restoring active status browser sessions...');

        try {
            // Check for existing browser sessions in filesystem
            const fs = require('fs');
            const path = require('path');
            const sessionsDir = '/home/ubuntu/wa-auto-v2/sessions';

            if (!fs.existsSync(sessionsDir)) {
                console.log('No sessions directory found, skipping restore');
                return;
            }

            const sessionDirs = fs.readdirSync(sessionsDir);
            let restored = 0;

            // Restore sessions sequentially to avoid resource conflicts
            for (const userId of sessionDirs) {
                const sessionPath = path.join(sessionsDir, userId);

                // Check if it's a directory and has browser data
                if (fs.statSync(sessionPath).isDirectory()) {
                    // Skip test users and old sessions for now to avoid conflicts
                    if (userId.includes('test-') || userId.includes('-turbo') || userId.includes('-old')) {
                        console.log(`⏭️ Skipping restoration of test/old session: ${userId}`);
                        continue;
                    }

                    try {
                        console.log(`🔄 Attempting to restore session for user: ${userId}`);

                        const StatusOnlyAutomation = require('../core/StatusOnlyAutomation');
                        const automation = new StatusOnlyAutomation(sessionPath, userId);

                        // Initialize but don't load WhatsApp yet
                        await automation.initialize();

                        // Load WhatsApp and check if already authenticated
                        await automation.loadWhatsAppForStatus();

                        // Keep all sessions but mark authentication status
                        const isAuth = await automation.isAuthenticated();
                        this.statusAutomations.set(userId, automation);

                        if (isAuth) {
                            console.log(`✅ Restored authenticated session for user: ${userId}`);
                            restored++;
                        } else {
                            console.log(`🔄 Restored session for ${userId} (waiting for authentication)`);
                        }

                        // Add small delay between restorations to avoid resource conflicts
                        await new Promise(resolve => setTimeout(resolve, 1000));

                    } catch (error) {
                        console.error(`❌ Failed to restore session for ${userId}:`, error.message);
                    }
                }
            }

            console.log(`✅ Restored ${restored} active sessions`);

        } catch (error) {
            console.error('Error restoring sessions:', error.message);
        }
    }

    startStatusMonitoring() {
        // Monitor status readiness every 10 seconds
        setInterval(async () => {
            for (const [userId, automation] of this.statusAutomations.entries()) {
                try {
                    if (!automation.isStatusReady) {
                        const isAuth = await automation.isAuthenticated();
                        if (isAuth) {
                            console.log(`[${userId}] Auto-checking status readiness...`);
                            await automation.recheckStatusReady();
                        }
                    }
                } catch (error) {
                    // Ignore errors in monitoring
                }
            }
        }, 10000); // Every 10 seconds
    }

    startAutoKeepAlive() {
        console.log('🔄 Starting enhanced auto keep-alive every 10 seconds...');

        // Keep-alive כל 10 שניות - פעילות מתמדת
        setInterval(async () => {
            for (const [userId, automation] of this.statusAutomations.entries()) {
                try {
                    console.log(`💓 Auto keep-alive for user ${userId}...`);

                    const result = await automation.page.evaluate(async () => {
                        try {
                            // תמיד נסה לשמור פעילות גם אם WA-JS לא מוכן לחלוטין
                            const strongKeepAlive = () => {
                                // פעילות חזקה כל 10 שניות
                                document.body.scrollTop = 0;
                                window.lastKeepAlive = Date.now();

                                // הזז את העכבר באופן אקטיווי
                                document.dispatchEvent(new MouseEvent('mousemove', {
                                    clientX: Math.random() * 300 + 100,
                                    clientY: Math.random() * 300 + 100,
                                    bubbles: true
                                }));

                                // אירועי מקלדת לשמירת חיבור
                                document.dispatchEvent(new KeyboardEvent('keydown', {
                                    key: 'Tab',
                                    bubbles: true
                                }));

                                // אירועי focus/blur
                                if (document.activeElement) {
                                    document.activeElement.blur();
                                    setTimeout(() => document.body.focus(), 50);
                                }

                                // click events לשמירת פעילות
                                document.body.click();

                                return {
                                    success: true,
                                    strong: true,
                                    connectionState: 'strong_keep_alive',
                                    isConnected: false,
                                    timestamp: new Date().toISOString()
                                };
                            };

                            if (typeof window.WPP === 'undefined' || !window.WPP.isFullReady) {
                                console.log('WA-JS not ready, doing strong keep-alive');
                                return strongKeepAlive();
                            }

                            // אם WA-JS מוכן, נעשה keep-alive מתקדם
                            const connectionState = window.WPP.conn.state;
                            const isConnected = connectionState === 'CONNECTED';

                            // פעילות keep-alive מתקדמת כל 10 שניות
                            strongKeepAlive(); // תמיד רוץ פעילות חזקה

                            if (isConnected && window.WPP.conn.canSend) {
                                // משתמש מחובר - שלח presence available
                                try {
                                    await window.WPP.conn.sendPresence('available');
                                    console.log('✅ Sent presence available');
                                } catch (e) {
                                    console.log('❌ Failed to send presence:', e.message);
                                }
                            } else if (window.WPP.conn) {
                                // לא מחובר - בדוק אם צריך reconnection
                                try {
                                    console.log('Checking connection state for potential reconnection');

                                    // אם המצב לא תקין, נסה reset
                                    if (connectionState === 'UNPAIRED' || connectionState === 'TIMEOUT') {
                                        console.log('🔄 Connection lost, attempting to reset state...');
                                        // ננסה לרענן את החיבור
                                        if (window.WPP.conn.genQR) {
                                            window.WPP.conn.genQR().catch(() => {});
                                        }
                                    }

                                    // שמור על הסשן פעיל
                                    window.WPP.conn.state;
                                } catch (e) {
                                    console.log('WPP session maintenance failed, doing basic');
                                    return basicKeepAlive();
                                }
                            }

                            return {
                                success: true,
                                connectionState,
                                isConnected,
                                timestamp: new Date().toISOString()
                            };
                        } catch (error) {
                            console.log('Keep-alive error, falling back to basic:', error.message);
                            // גם אם יש שגיאה, נעשה keep-alive בסיסי
                            document.body.scrollTop = 0;
                            window.lastKeepAlive = Date.now();
                            return {
                                success: true,
                                fallback: true,
                                connectionState: 'fallback_session',
                                error: error.message,
                                timestamp: new Date().toISOString()
                            };
                        }
                    });

                    if (result.success) {
                        if (result.isConnected) {
                            console.log(`✅ Keep-alive successful for ${userId} - ${result.connectionState}`);
                        } else if (result.basic || result.fallback) {
                            console.log(`🔄 Basic keep-alive for ${userId} - maintaining browser session`);
                        } else {
                            console.log(`⚠️ Keep-alive maintaining session for ${userId} - ${result.connectionState || 'not connected'}`);
                        }
                    } else {
                        console.log(`⚠️ Keep-alive issue for ${userId}: ${result.error || 'Unknown error'}`);
                    }

                } catch (error) {
                    console.error(`❌ Auto keep-alive error for ${userId}:`, error.message);

                    // If automation session is broken, remove it
                    if (error.message.includes('Protocol error') ||
                        error.message.includes('Target closed') ||
                        error.message.includes('Session closed')) {
                        console.log(`🧹 Removing broken session for ${userId} from keep-alive monitoring`);
                        this.statusAutomations.delete(userId);
                    }
                }
            }
        }, 10 * 1000); // Every 10 seconds

        // בדיקת חיבור מתקדמת כל דקה
        setInterval(async () => {
            for (const [userId, automation] of this.statusAutomations.entries()) {
                try {
                    const connectionCheck = await automation.page.evaluate(async () => {
                        try {
                            if (typeof window.WPP === 'undefined' || !window.WPP.isFullReady) {
                                return { needsReset: false, reason: 'WA-JS not ready' };
                            }

                            const state = window.WPP.conn.state;

                            // בדוק אם צריך reset
                            if (state === 'UNPAIRED' || state === 'TIMEOUT' || state === 'UNLAUNCHED') {
                                console.log('🔄 Connection needs reset:', state);
                                return { needsReset: true, state, reason: 'Connection lost' };
                            }

                            return { needsReset: false, state, reason: 'Connection OK' };
                        } catch (error) {
                            return { needsReset: false, error: error.message };
                        }
                    });

                    if (connectionCheck.needsReset) {
                        console.log(`🔄 Resetting connection for ${userId}: ${connectionCheck.reason}`);
                        // כאן אפשר להוסיף לוגיקה לרענון החיבור
                    }
                } catch (error) {
                    console.error(`❌ Connection check error for ${userId}:`, error.message);
                }
            }
        }, 60 * 1000); // Every minute
    }

    stop() {
        if (this.server) {
            // Close all active automations
            for (const [userId, automation] of this.statusAutomations.entries()) {
                automation.close().catch(console.error);
            }
            this.statusAutomations.clear();

            this.server.close();
        }
    }
}

module.exports = { WhatsAppAPI };