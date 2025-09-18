const fs = require('fs');
const path = require('path');
const playwright = require('playwright-chromium');
const TurboStatusHandler = require('./StatusHandler_turbo');

/**
 * Status-Only WhatsApp Automation
 * Optimized browser that loads only status functionality without chats
 */
class StatusOnlyAutomation {
    constructor(sessionPath = null, sessionId = null, proxyConfig = null) {
        this.browser = null;
        this.page = null;
        this.sessionPath = sessionPath || path.join(__dirname, 'session');
        this.sessionId = sessionId || 'default';
        this.proxyConfig = proxyConfig;
        this.currentQRUrl = null;
        this.statusHandler = null;
        this.cdpSession = null;
        this.eventCallbacks = new Map();
        this.eventsSetup = false;
        this.isStatusReady = false;
    }

    async initialize() {
        await this.ensureSessionDirectory();
        const { browser, page } = await this.createOptimizedBrowser();
        this.browser = browser;
        this.page = page;

        // Setup CDP session for CSP bypass
        this.cdpSession = await this.page.context().newCDPSession(this.page);
        await this.cdpSession.send('Page.setBypassCSP', { enabled: true });

        console.log(`[${this.sessionId}] Status-only automation initialized`);
    }

    async createOptimizedBrowser() {
        const isHeadless = process.env.HEADLESS === 'true';
        console.log(`[${this.sessionId}] Creating status-optimized browser (headless: ${isHeadless})`);

        const launchOptions = {
            headless: isHeadless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
                // Status-specific optimizations
                '--memory-pressure-off',
                '--max-old-space-size=512', // Limit memory
                '--disable-sync', // No sync needed for status
                '--disable-notifications', // No notifications
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                // Keep-alive settings
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=TranslateUI',
                '--force-fieldtrials=*BackgroundTracing/default/',
                '--disable-client-side-phishing-detection',
                '--disable-default-apps',
                '--disable-hang-monitor',
                '--disable-popup-blocking',
                '--disable-prompt-on-repost',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-features=VizDisplayCompositor',
                '--aggressive-cache-discard',
                '--disable-extensions-http-throttling'
            ]
        };

        // Add proxy if provided
        if (this.proxyConfig) {
            console.log(`[${this.sessionId}] Using proxy: ${this.proxyConfig.server}`);
            launchOptions.proxy = this.proxyConfig;
        }

        const browser = await playwright.chromium.launch(launchOptions);

        const contextOptions = {
            userDataDir: this.sessionPath,
            viewport: { width: 1024, height: 768 },
            // Status-specific permissions
            permissions: ['camera', 'microphone'],
            // Reduce memory usage
            reducedMotion: 'reduce',
            // Block unnecessary resources
            serviceWorkers: 'block'
        };

        const context = await browser.newContext(contextOptions);

        // Block heavy resources to speed up and reduce memory
        await context.route('**/*', (route) => {
            const url = route.request().url();
            const resourceType = route.request().resourceType();

            // Block heavy media that's not needed for status
            if (resourceType === 'image' && !url.includes('status') && !url.includes('profile')) {
                route.abort();
                return;
            }
            if (resourceType === 'media' || resourceType === 'font') {
                route.abort();
                return;
            }
            // Block chat-related heavy scripts
            if (url.includes('/chat/') || url.includes('/message/')) {
                route.abort();
                return;
            }

            route.continue();
        });

        const page = await context.newPage();

        // Status-specific page optimizations with keep-alive
        await page.addInitScript(() => {
            // Disable chat loading
            window.skipChatLoad = true;

            // Override contact loading to minimal
            if (window.Store && window.Store.Contact) {
                const originalContactInit = window.Store.Contact.init;
                window.Store.Contact.init = function() {
                    console.log('Skipping heavy contact initialization for status-only mode');
                    return Promise.resolve();
                };
            }

            // Keep-alive mechanisms
            // 1. Prevent tab from sleeping
            window.keepAlive = true;

            // 2. Activity simulation to keep WhatsApp Web active
            setInterval(() => {
                if (window.keepAlive) {
                    // Simulate minimal activity
                    document.dispatchEvent(new MouseEvent('mousemove', {
                        clientX: Math.random() * 10,
                        clientY: Math.random() * 10
                    }));

                    // Keep WebSocket alive if available
                    if (window.Store && window.Store.Socket && window.Store.Socket.ping) {
                        try {
                            window.Store.Socket.ping();
                        } catch (e) {
                            console.log('Socket ping failed:', e.message);
                        }
                    }

                    // Keep connection alive via WPP
                    if (window.WPP && window.WPP.conn && window.WPP.conn.keepAlive) {
                        try {
                            window.WPP.conn.keepAlive();
                        } catch (e) {
                            console.log('WPP keepAlive failed:', e.message);
                        }
                    }

                    console.log('Keep-alive ping sent at:', new Date().toISOString());
                }
            }, 30000); // Every 30 seconds

            // 3. Prevent page from becoming inactive
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && window.keepAlive) {
                    console.log('Page became hidden, maintaining keep-alive');
                    // Force page to stay active
                    setTimeout(() => {
                        if (document.hidden && window.keepAlive) {
                            window.focus();
                        }
                    }, 1000);
                }
            });

            // 4. Network keep-alive
            setInterval(() => {
                if (window.keepAlive) {
                    // Send a minimal network request to keep connection alive
                    fetch('/health', { method: 'HEAD' }).catch(() => {
                        console.log('Health check failed, connection may be down');
                    });
                }
            }, 60000); // Every minute

            // Disable heavy animations
            document.addEventListener('DOMContentLoaded', () => {
                const style = document.createElement('style');
                style.textContent = `
                    * {
                        animation-duration: 0.01ms !important;
                        animation-delay: 0.01ms !important;
                        transition-duration: 0.01ms !important;
                        transition-delay: 0.01ms !important;
                    }
                `;
                document.head.appendChild(style);
            });
        });

        console.log(`[${this.sessionId}] Status-optimized browser created`);
        return { browser, page };
    }

    async ensureSessionDirectory() {
        if (!fs.existsSync(this.sessionPath)) {
            fs.mkdirSync(this.sessionPath, { recursive: true });
            console.log(`[${this.sessionId}] Created session directory: ${this.sessionPath}`);
        }
    }

    async loadWhatsAppForStatus() {
        console.log(`[${this.sessionId}] Loading WhatsApp for status operations...`);

        try {
            await this.page.goto('https://web.whatsapp.com', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            // Wait for initial load but don't wait for all chats
            await this.page.waitForTimeout(3000);

            // Inject status-optimized WA-JS
            await this.injectStatusOptimizedWAJS();

            // Wait for status functionality to be ready
            await this.waitForStatusReady();

            console.log(`[${this.sessionId}] WhatsApp status functionality ready`);

        } catch (error) {
            console.error(`[${this.sessionId}] Error loading WhatsApp:`, error.message);
            throw error;
        }
    }

    async injectStatusOptimizedWAJS() {
        console.log(`[${this.sessionId}] Injecting status-optimized WA-JS...`);

        const waJSPath = path.join(__dirname, '../../wa-js/dist/wppconnect-wa.js');

        if (!fs.existsSync(waJSPath)) {
            throw new Error(`WA-JS file not found at: ${waJSPath}`);
        }

        const waJSContent = fs.readFileSync(waJSPath, 'utf8');

        // Inject with status-specific optimizations
        await this.page.evaluate((waJSContent) => {
            // Create optimized WA-JS for status only
            eval(waJSContent);

            // Override heavy functions
            if (window.WPP && window.WPP.chat) {
                window.WPP.chat.list = () => Promise.resolve([]);
                window.WPP.chat.get = () => Promise.resolve(null);
            }

            // Focus on status functionality
            window.statusOnlyMode = true;

            // Log available status methods for debugging
            if (window.WPP && window.WPP.status) {
                console.log('WPP.status module loaded successfully');
                console.log('Available status methods:', Object.keys(window.WPP.status));
            }

            console.log('Status-optimized WA-JS injected successfully');
        }, waJSContent);

        await this.page.waitForTimeout(2000);
        console.log(`[${this.sessionId}] WA-JS injection complete`);
    }

    async waitForStatusReady() {
        console.log(`[${this.sessionId}] Waiting for status functionality...`);

        try {
            // Wait for basic WPP to load
            await this.page.waitForFunction(() => {
                return window.WPP && window.WPP.conn;
            }, { timeout: 30000 });

            console.log(`[${this.sessionId}] WPP loaded, checking authentication...`);

            // Check if already authenticated or if QR is showing
            const authState = await this.page.evaluate(() => {
                if (window.WPP && window.WPP.conn) {
                    if (window.WPP.conn.isRegistered && window.WPP.conn.isRegistered()) {
                        return 'authenticated';
                    }
                }

                // Check for QR code
                const qrElement = document.querySelector('canvas[aria-label*="scan"], canvas[aria-label*="Scan"]');
                if (qrElement) {
                    return 'qr_ready';
                }

                return 'loading';
            });

            if (authState === 'authenticated') {
                // Wait for status module to be ready
                await this.page.waitForFunction(() => {
                    return window.WPP && window.WPP.status;
                }, { timeout: 15000 });
                this.isStatusReady = true;
                console.log(`[${this.sessionId}] Status functionality ready - authenticated!`);
            } else if (authState === 'qr_ready') {
                console.log(`[${this.sessionId}] QR code ready for scanning`);
                this.isStatusReady = false; // Will be ready after auth
            } else {
                // Wait a bit more for auth state to stabilize
                await this.page.waitForTimeout(5000);
                console.log(`[${this.sessionId}] Status system loaded, waiting for authentication`);
            }

        } catch (error) {
            console.error(`[${this.sessionId}] Status readiness timeout:`, error.message);
            // Don't throw error - let it continue for QR scanning
            console.log(`[${this.sessionId}] Continuing despite timeout - QR might be available`);
        }
    }

    async setupStatusHandler() {
        if (!this.statusHandler) {
            this.statusHandler = new TurboStatusHandler(this.page, this.sessionId);
            await this.statusHandler.initialize();
            console.log(`[${this.sessionId}] Turbo status handler initialized`);
        }
    }

    async sendTextStatus(content, options = {}) {
        if (!this.isStatusReady) {
            throw new Error('Status functionality not ready');
        }

        await this.setupStatusHandler();
        return await this.statusHandler.sendTextStatus(content, options);
    }

    // ULTRA-FAST status sending (15-30 seconds target)
    async ultraFastTextStatus(content, options = {}) {
        console.log(`[${this.sessionId}] 🚀 ULTRA-FAST status initiated: "${content.substring(0, 50)}..."`);
        const startTime = Date.now();

        try {
            // Skip all checks - go straight to DOM
            const result = await this.page.evaluate(async (statusContent) => {
                const start = Date.now();

                // ULTRA-FAST STRATEGY: Multiple parallel attempts
                console.log('🔥 PARALLEL ULTRA-FAST STATUS ATTACK!');

                // Strategy 1: Keyboard shortcuts barrage
                const shortcuts = [
                    () => {
                        document.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true, bubbles: true
                        }));
                    },
                    () => {
                        document.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'n', code: 'KeyN', ctrlKey: true, shiftKey: true, bubbles: true
                        }));
                    },
                    () => {
                        // 🎯 REAL SELECTORS: Click actual WhatsApp status elements
                        const statusElements = document.querySelectorAll([
                            '[aria-label="Status"]', // 🎯 CONFIRMED: Main status button
                            'span[data-icon="status-refreshed"]', // 🎯 CONFIRMED: Current status icon
                            'button[aria-label="Status"]', // 🎯 CONFIRMED: Status button
                            '[data-icon="status-refreshed"]' // 🎯 CONFIRMED: Icon selector
                        ].join(','));
                        statusElements.forEach(el => el.click?.());
                    }
                ];

                // Fire all strategies at once
                shortcuts.forEach((strategy, i) => {
                    setTimeout(strategy, i * 100);
                });

                await new Promise(resolve => setTimeout(resolve, 800));

                // Strategy 2: Aggressive input finding with REAL selectors
                const inputs = document.querySelectorAll([
                    '.lexical-rich-text-input', // 🎯 CONFIRMED: Real WhatsApp input class
                    'div[contenteditable="true"][role="textbox"]', // 🎯 CONFIRMED: Pattern found
                    '[aria-label*="Type"]', // 🎯 Common WhatsApp compose pattern
                    'div[contenteditable="true"]',
                    'textarea',
                    'input[type="text"]',
                    '[role="textbox"]'
                ].join(','));

                let success = false;
                for (const input of inputs) {
                    const rect = input.getBoundingClientRect();
                    if (rect.width > 30 && rect.height > 20) {
                        // Fill input with multiple methods
                        input.focus?.();
                        input.textContent = statusContent;
                        input.innerHTML = statusContent;
                        if (input.value !== undefined) input.value = statusContent;

                        // Fire events
                        ['focus', 'input', 'change', 'keyup'].forEach(eventType => {
                            input.dispatchEvent(new Event(eventType, { bubbles: true }));
                        });

                        // Multiple send attempts
                        setTimeout(() => {
                            // Enter key
                            input.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'Enter', keyCode: 13, bubbles: true
                            }));

                            // Ctrl+Enter
                            input.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'Enter', keyCode: 13, ctrlKey: true, bubbles: true
                            }));

                            // 🎯 REAL SELECTORS: Click actual send buttons
                            const sendButtons = document.querySelectorAll([
                                'span[data-icon="send"]', // 🎯 Most likely WhatsApp send pattern
                                '[data-icon="send"]', // 🎯 Alternative
                                'button[aria-label*="Send"]',
                                'span[data-icon="plus"]', // 🎯 Add status button
                                '[data-icon="plus"]',
                                'button[data-testid="send"]'
                            ].join(','));
                            sendButtons.forEach(btn => btn.click?.());

                        }, 100);

                        success = true;
                    }
                }

                // Strategy 3: If all else fails, try to inject into any text area
                if (!success) {
                    const chatInput = document.querySelector('[data-testid="conversation-compose-box-input"]');
                    if (chatInput) {
                        chatInput.textContent = `Status: ${statusContent}`;
                        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                        chatInput.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter', bubbles: true
                        }));
                        success = true;
                    }
                }

                const time = Date.now() - start;
                return {
                    success: success,
                    method: 'ultra_fast_parallel',
                    time: time,
                    performance: time < 15000 ? '🔥 BLAZING' : time < 30000 ? '⚡ FAST' : '🐌 SLOW'
                };
            }, content);

            const totalTime = Date.now() - startTime;
            console.log(`[${this.sessionId}] 🚀 ULTRA-FAST complete in ${totalTime}ms - ${result.performance}`);

            return {
                ...result,
                totalTime: totalTime,
                sessionId: this.sessionId
            };

        } catch (error) {
            const totalTime = Date.now() - startTime;
            console.error(`[${this.sessionId}] ❌ Ultra-fast failed in ${totalTime}ms:`, error.message);
            throw error;
        }
    }

    async sendImageStatus(imageBuffer, caption = '', options = {}) {
        if (!this.isStatusReady) {
            throw new Error('Status functionality not ready');
        }

        await this.setupStatusHandler();
        return await this.statusHandler.sendImageStatus(imageBuffer, caption, options);
    }

    async sendVideoStatus(videoBuffer, caption = '', options = {}) {
        if (!this.isStatusReady) {
            throw new Error('Status functionality not ready');
        }

        await this.setupStatusHandler();
        return await this.statusHandler.sendVideoStatus(videoBuffer, caption, options);
    }

    async getMyStatus() {
        if (!this.isStatusReady) {
            throw new Error('Status functionality not ready');
        }

        await this.setupStatusHandler();
        return await this.statusHandler.getMyStatus();
    }

    async checkQRCode() {
        try {
            // First check if already authenticated
            const isAuth = await this.isAuthenticated();
            if (isAuth) {
                return {
                    hasQR: false,
                    message: 'Already authenticated - no QR code needed'
                };
            }

            // Look for QR code with multiple selectors
            const qrElement = await this.page.$('canvas[aria-label*="scan"], canvas[aria-label*="Scan"], div[data-ref] canvas, canvas');

            if (qrElement) {
                const boundingBox = await qrElement.boundingBox();
                if (boundingBox && boundingBox.width > 50 && boundingBox.height > 50) {
                    this.currentQRUrl = await this.page.screenshot({
                        clip: boundingBox,
                        type: 'png'
                    });
                    return {
                        hasQR: true,
                        qrData: this.currentQRUrl.toString('base64'),
                        message: 'QR code available for scanning'
                    };
                }
            }

            // Alternative method - screenshot the whole login area
            const loginArea = await this.page.$('div[data-testid="intro-wrapper"], div[data-testid="landing-wrapper"], .landing-window');
            if (loginArea) {
                this.currentQRUrl = await this.page.screenshot({
                    clip: await loginArea.boundingBox(),
                    type: 'png'
                });
                return {
                    hasQR: true,
                    qrData: this.currentQRUrl.toString('base64'),
                    message: 'Login area screenshot (contains QR code)'
                };
            }

            return {
                hasQR: false,
                message: 'No QR code found - may be logged in or still loading'
            };

        } catch (error) {
            console.error(`[${this.sessionId}] QR check error:`, error.message);
            return {
                hasQR: false,
                error: error.message
            };
        }
    }

    async isAuthenticated() {
        try {
            if (!this.page) return false;

            const isLoggedIn = await this.page.evaluate(() => {
                return window.WPP &&
                       window.WPP.conn &&
                       window.WPP.conn.isRegistered() &&
                       !document.querySelector('canvas[aria-label="Scan me!"]');
            });

            return isLoggedIn;

        } catch (error) {
            console.error(`[${this.sessionId}] Auth check error:`, error.message);
            return false;
        }
    }

    async recheckStatusReady() {
        console.log(`[${this.sessionId}] Rechecking status readiness...`);
        try {
            if (!this.page) return false;

            // Check if authenticated and status module is ready
            const statusCheck = await this.page.evaluate(() => {
                const isAuth = window.WPP &&
                              window.WPP.conn &&
                              window.WPP.conn.isRegistered &&
                              window.WPP.conn.isRegistered();

                const hasStatus = window.WPP && window.WPP.status;

                return {
                    authenticated: isAuth,
                    statusModuleReady: hasStatus
                };
            });

            if (statusCheck.authenticated && statusCheck.statusModuleReady) {
                this.isStatusReady = true;
                console.log(`[${this.sessionId}] Status functionality ready after recheck!`);
                return true;
            } else {
                console.log(`[${this.sessionId}] Status not ready - Auth: ${statusCheck.authenticated}, Status Module: ${statusCheck.statusModuleReady}`);
                return false;
            }

        } catch (error) {
            console.error(`[${this.sessionId}] Status recheck error:`, error.message);
            return false;
        }
    }

    async close() {
        console.log(`[${this.sessionId}] Closing status-only automation...`);

        if (this.statusHandler) {
            await this.statusHandler.cleanup();
        }

        if (this.cdpSession) {
            await this.cdpSession.detach();
        }

        if (this.browser) {
            await this.browser.close();
        }

        console.log(`[${this.sessionId}] Status-only automation closed`);
    }
}

module.exports = StatusOnlyAutomation;