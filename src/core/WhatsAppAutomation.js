const fs = require('fs');
const path = require('path');
const playwright = require('playwright-chromium');
const WhatsAppStatusHandler = require('./StatusHandler');

// ============================================
// Enhanced WhatsApp Automation with Multi-User Support
// ============================================
class WhatsAppAutomation {
    constructor(sessionPath = null, sessionId = null) {
        this.browser = null;
        this.page = null;
        this.sessionPath = sessionPath || path.join(__dirname, 'session');
        this.sessionId = sessionId || 'default';
        this.currentQRUrl = null;
        this.statusHandler = null;
        this.cdpSession = null;
        this.eventCallbacks = new Map(); // For API event subscriptions
        this.eventsSetup = false; // Track if events are already setup
    }

    async initialize() {
        await this.ensureSessionDirectory();

        const { browser, page } = await this.createBrowserWithWAJS();

        this.browser = browser;
        this.page = page;

        // Setup CDP session for CSP bypass
        this.cdpSession = await this.page.context().newCDPSession(this.page);
        await this.cdpSession.send('Page.setBypassCSP', { enabled: true });
    }

    async createBrowserWithWAJS() {
        // Create browser context with persistent session
        // Note: WhatsApp Web doesn't work reliably in headless mode
        const isHeadless = process.env.HEADLESS === 'true';
        if (isHeadless) {
            console.log(`[${this.sessionId}] WARNING: Running in headless mode. WhatsApp may not work properly.`);
        }

        const browser = await playwright.chromium.launchPersistentContext(
            this.sessionPath,
            {
                headless: isHeadless || false, // Default to non-headless for WhatsApp compatibility
                viewport: { width: 1920, height: 1080 },
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--window-size=1920,1080',
                    '--start-maximized',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                ]
            }
        );

        const page = browser.pages().length ? browser.pages()[0] : await browser.newPage();

        // Set up page with wa-js preparation similar to wa-js browser.ts
        await this.preparePage(page);

        // Navigate to WhatsApp Web
        setTimeout(async () => {
            await page.goto('https://web.whatsapp.com', {
                waitUntil: 'domcontentloaded',
                timeout: 120000
            });

            await page.waitForFunction(
                () => window.Debug?.VERSION,
                {},
                { timeout: 120000 }
            ).catch(() => null);

            const version = await page.evaluate(() => window.Debug?.VERSION).catch(() => null);
            console.log(`[${this.sessionId}] WhatsApp Version:`, version);
        }, 1000);

        return { browser, page };
    }

    async preparePage(page) {
        // Add WA-JS script injection using addScriptTag
        page.on('load', async (page) => {
            try {
                // Set WPPConfig before injecting WA-JS
                await page.evaluate(() => {
                    window.WPPConfig = {
                        sendStatusToDevice: true,
                        syncAllStatus: true,
                    };
                    console.log('WPPConfig pre-configured with sendStatusToDevice and removeStatusMessage');
                });

                // Inject WA-JS using addScriptTag
                const waJsPath = path.resolve("E:/Projects/Fiverr/Elyua/custom-wa-automation/wa-automation-v2/wa-js/dist/wppconnect-wa.js");

                await page.addScriptTag({
                    origin: "https://web.whatsapp.com/",
                    path: waJsPath
                });

                console.log(`[${this.sessionId}] WA-JS script injected via addScriptTag`);

                // Wait a bit for WA-JS to initialize
                await new Promise(resolve => setTimeout(resolve, 3000));

            } catch (error) {
                console.log(`[${this.sessionId}] WA-JS injection failed:`, error.message);
                console.log(`[${this.sessionId}] Proceeding without WA-JS...`);
            }
        });

        // Remove service workers and set up error handling
        await page.addInitScript(() => {
            // Remove existent service worker
            navigator.serviceWorker
                .getRegistrations()
                .then((registrations) => {
                    for (const registration of registrations) {
                        registration.unregister();
                    }
                })
                .catch(() => null);

            // Disable service worker registration
            navigator.serviceWorker.register = () => new Promise(() => {});

            setInterval(() => {
                window.onerror = console.error;
                window.onunhandledrejection = console.error;
            }, 500);
        });
    }

    async ensureSessionDirectory() {
        if (!fs.existsSync(this.sessionPath)) {
            fs.mkdirSync(this.sessionPath, { recursive: true });
        }
    }

    // Event subscription for API
    on(event, callback) {
        if (!this.eventCallbacks.has(event)) {
            this.eventCallbacks.set(event, []);
        }
        this.eventCallbacks.get(event).push(callback);
    }

    emit(event, data) {
        const callbacks = this.eventCallbacks.get(event) || [];
        callbacks.forEach(cb => cb(data));
    }

    async setupAuthenticationEvents() {
        // Check if events are already setup
        if (this.eventsSetup) {
            console.log(`[${this.sessionId}] Authentication events already setup, skipping...`);
            return true;
        }

        console.log(`[${this.sessionId}] Setting up WA-JS authentication event listeners...`);

        try {
            await this.page.exposeFunction('onAuthenticated', () => {
                console.log(`[${this.sessionId}] ✅ User authenticated successfully via WA-JS`);
                this.emit('authenticated', { sessionId: this.sessionId });
            });
        } catch (error) {
            if (error.message.includes('has been already registered')) {
                console.log(`[${this.sessionId}] onAuthenticated already registered`);
            } else {
                throw error;
            }
        }

        try {
            await this.page.exposeFunction('onAuthCodeChange', (authCode) => {
                if (authCode) {
                    console.log(`[${this.sessionId}] 📱 QR Code updated:`, authCode.fullCode ? authCode.fullCode.substring(0, 50) + '...' : 'No code');
                    this.currentQRUrl = authCode.fullCode;
                    this.emit('qr', { sessionId: this.sessionId, qr: authCode.fullCode });
                }
            });
        } catch (error) {
            if (!error.message.includes('has been already registered')) throw error;
        }

        try {
            await this.page.exposeFunction('onRequireAuth', () => {
                console.log(`[${this.sessionId}] 🔐 Authentication required - please choose authentication method...`);
                this.emit('requireAuth', { sessionId: this.sessionId });
            });
        } catch (error) {
            if (!error.message.includes('has been already registered')) throw error;
        }

        try {
            await this.page.exposeFunction('onLogout', () => {
                console.log(`[${this.sessionId}] 👋 User logged out`);
                this.emit('logout', { sessionId: this.sessionId });
            });
        } catch (error) {
            if (!error.message.includes('has been already registered')) throw error;
        }

        try {
            await this.page.exposeFunction('onMainReady', () => {
                console.log(`[${this.sessionId}] ✨ WhatsApp interface fully loaded and ready`);
                this.emit('ready', { sessionId: this.sessionId });
            });
        } catch (error) {
            if (!error.message.includes('has been already registered')) throw error;
        }

        try {
            await this.page.exposeFunction('onPairingCodeRequested', () => {
                console.log(`[${this.sessionId}] 📲 Pairing code authentication initiated`);
                this.emit('pairingCode', { sessionId: this.sessionId });
            });
        } catch (error) {
            if (!error.message.includes('has been already registered')) throw error;
        }

        return this.page.evaluate(() => {
            if (typeof window.WPP === 'undefined') {
                console.log('WA-JS not available for event setup');
                return false;
            }

            // Set up authentication event listeners
            window.WPP.on('conn.authenticated', () => {
                window.onAuthenticated();
            });

            window.WPP.on('conn.auth_code_change', (authCode) => {
                try {
                    window.onAuthCodeChange(authCode);
                } catch (error) {
                    console.error('Error in onAuthCodeChange:', error);
                }
            });

            window.WPP.on('conn.require_auth', () => {
                window.onRequireAuth();
            });

            window.WPP.on('conn.logout', () => {
                window.onLogout();
            });

            window.WPP.on('conn.main_ready', () => {
                window.onMainReady();
            });

            // Listen for pairing code events
            window.WPP.on('conn.paring_code_requested', () => {
                window.onPairingCodeRequested();
            });

            console.log('WA-JS authentication events configured successfully');
            return true;
        });

        this.eventsSetup = true;
        return true;
    }

    async checkLoginStatus() {
        try {
            // First check if WA-JS is available
            const hasWAJS = await this.page.evaluate(() => typeof window.WPP !== 'undefined');

            if (hasWAJS) {
                // Use WA-JS authentication check with error handling
                const authStatus = await this.page.evaluate(() => {
                    try {
                        return {
                            isAuthenticated: window.WPP.conn.isAuthenticated(),
                            isMainReady: window.WPP.conn.isMainReady()
                        };
                    } catch (error) {
                        console.log('Error checking auth status:', error.message);
                        return {
                            isAuthenticated: false,
                            isMainReady: false
                        };
                    }
                });

                const isAuthenticated = authStatus.isAuthenticated;
                const isMainReady = authStatus.isMainReady;

                if (isAuthenticated && isMainReady) {
                    console.log(`[${this.sessionId}] ✅ Successfully authenticated (via WA-JS)`);
                    return true;
                } else if (isAuthenticated && !isMainReady) {
                    console.log(`[${this.sessionId}] ⏳ Authenticated but interface still loading...`);
                    // Wait for main_ready event
                    await this.page.waitForFunction(
                        () => window.WPP.conn.isMainReady(),
                        {},
                        { timeout: 30000 }
                    );
                    console.log(`[${this.sessionId}] ✅ Interface ready`);
                    return true;
                } else {
                    console.log(`[${this.sessionId}] ❌ Not authenticated`);
                    return false;
                }
            } else {
                // Fallback to DOM check if WA-JS not available
                await this.page.waitForSelector('[aria-label="Chat list"]', { timeout: 5000 });
                console.log(`[${this.sessionId}] Successfully logged in to WhatsApp Web (DOM check)`);
                return true;
            }
        } catch (error) {
            return false;
        }
    }

    async requestPairingCode(phoneNumber) {
        console.log(`[${this.sessionId}] 📲 Requesting pairing code for phone: ${phoneNumber}`);

        // Validate phone number
        if (!phoneNumber || typeof phoneNumber !== 'string') {
            console.error(`[${this.sessionId}] ❌ Phone number is required and must be a string`);
            return null;
        }

        try {
            // First check what methods are available
            const availableMethods = await this.page.evaluate(() => {
                const methods = [];
                if (window.WPP && window.WPP.conn) {
                    // Check for different possible method names
                    if (typeof window.WPP.conn.requestPairingCode === 'function') methods.push('requestPairingCode');
                    if (typeof window.WPP.conn.genLinkDeviceCodeForPhoneNumber === 'function') methods.push('genLinkDeviceCodeForPhoneNumber');
                    if (typeof window.WPP.conn.genLinkCodeForPhoneNumber === 'function') methods.push('genLinkCodeForPhoneNumber');
                    if (typeof window.WPP.conn.linkWithPhoneNumber === 'function') methods.push('linkWithPhoneNumber');

                    // List all conn methods for debugging
                    const allMethods = Object.getOwnPropertyNames(window.WPP.conn)
                        .filter(prop => typeof window.WPP.conn[prop] === 'function');

                    return {
                        available: methods,
                        all: allMethods
                    };
                }
                return { available: [], all: [] };
            });

            console.log(`[${this.sessionId}] Available pairing methods:`, availableMethods.available);

            if (availableMethods.available.length === 0) {
                console.log(`[${this.sessionId}] ⚠️ No pairing code methods available`);
                console.log(`[${this.sessionId}] Note: Pairing code may not be available in your WhatsApp version or region`);
                return null;
            }

            // First check if we're in the right state for pairing code
            const authState = await this.page.evaluate(() => {
                return {
                    isAuthenticated: window.WPP.conn.isAuthenticated(),
                    isRegistered: window.WPP.conn.isRegistered(),
                    isMainReady: window.WPP.conn.isMainReady(),
                    needsUpdate: window.WPP.conn.needsUpdate(),
                    isMultiDevice: window.WPP.conn.isMultiDevice()
                };
            });

            console.log(`[${this.sessionId}] Auth state before pairing:`, authState);

            if (authState.isAuthenticated) {
                console.log(`[${this.sessionId}] ⚠️ Already authenticated. Attempting to logout first...`);

                // Try to logout first
                try {
                    await this.page.evaluate(() => {
                        if (window.WPP && window.WPP.conn && window.WPP.conn.logout) {
                            window.WPP.conn.logout();
                        }
                    });
                    console.log(`[${this.sessionId}] Logged out successfully. Please refresh and try again.`);
                } catch (logoutError) {
                    console.log(`[${this.sessionId}] Could not logout:`, logoutError.message);
                }

                return null;
            }

            // Format phone number correctly (remove + and spaces)
            const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
            console.log(`[${this.sessionId}] Cleaned phone number:`, cleanPhone);

            const result = await this.page.evaluate(async (phone) => {
                if (!window.WPP || !window.WPP.conn) {
                    throw new Error('WA-JS conn module not available');
                }

                try {
                    // No UI checks - just use WPP directly
                    console.log('Calling genLinkDeviceCodeForPhoneNumber with:', phone);

                    // This method generates an 8-character pairing code
                    // Second parameter is for push notification (default: true)
                    const code = await window.WPP.conn.genLinkDeviceCodeForPhoneNumber(phone, true);

                    console.log('Generated code response:', code);

                    // The code might be returned as an object or string
                    if (typeof code === 'object' && code.code) {
                        return code.code;
                    }

                    return code;
                } catch (error) {
                    console.error('Error in page context:', error);
                    console.error('Error string:', error.toString());
                    console.error('Error message:', error.message);

                    // Handle specific WA-JS errors
                    if (error.message && error.message.includes('send_the_phone_number_to_connect')) {
                        throw new Error('Invalid phone number format. Please provide phone number without special characters.');
                    }

                    if (error.message && error.message.includes('cannot_get_code_for_already_authenticated')) {
                        throw new Error('Cannot generate pairing code: User is already authenticated. Please logout first.');
                    }

                    // Try to get more info about the error
                    if (error.message && error.message.includes('Minified invariant')) {
                        throw new Error('WhatsApp Web is not in the correct state for pairing code. Make sure you are on the QR code screen and not already logged in.');
                    }

                    // Check for minified errors (usually single letters like 'b')
                    if (error.toString().length <= 2) {
                        throw new Error(`WhatsApp internal error (${error.toString()}). This usually means the pairing code feature is not available or WhatsApp is not ready. Try QR code instead.`);
                    }

                    throw error;
                }
            }, cleanPhone);

            console.log(`[${this.sessionId}] ✅ Pairing code generated:`, result);
            this.emit('pairingCodeGenerated', { sessionId: this.sessionId, code: result, phoneNumber });
            return result;
        } catch (error) {
            console.error(`[${this.sessionId}] ❌ Failed to generate pairing code:`, error.message);
            return null;
        }
    }

    async handleLogin(authMethod = 'auto', phoneNumber = null) {
        console.log(`[${this.sessionId}] 🔄 Handling login process with WA-JS...`);
        console.log(`[${this.sessionId}]    Authentication method: ${authMethod}`);

        // Check if already logged in
        const isLoggedIn = await this.checkLoginStatus();

        if (isLoggedIn) {
            console.log(`[${this.sessionId}] ✅ Already logged in - proceeding`);
            return true;
        }

        console.log(`[${this.sessionId}] 📱 Not logged in, setting up authentication flow...`);

        // Set up authentication event listeners
        const eventsSetup = await this.setupAuthenticationEvents();

        if (!eventsSetup) {
            console.log(`[${this.sessionId}] ⚠️ WA-JS events not available, falling back to basic login check`);
            // Simple fallback - just wait for login
            try {
                await this.page.waitForSelector('[aria-label="Chat list"]', {
                    timeout: 120000
                });
                console.log(`[${this.sessionId}] ✅ Login successful (fallback method)`);
                return true;
            } catch (error) {
                console.error(`[${this.sessionId}] ❌ Login timeout or failed`);
                return false;
            }
        }

        // Handle different authentication methods
        if (authMethod === 'code' && phoneNumber) {
            // Use pairing code authentication
            console.log(`[${this.sessionId}] 📲 Using pairing code authentication method...`);

            // Wait for QR code screen to be ready
            console.log(`[${this.sessionId}] Waiting for QR code screen...`);
            try {
                await this.page.waitForSelector('[data-testid="qrcode"], canvas[aria-label*="scan"], .landing-main', {
                    timeout: 15000
                });
                console.log(`[${this.sessionId}] QR code screen detected`);

                // Wait a bit more to ensure everything is initialized
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.log(`[${this.sessionId}] QR code screen not detected, proceeding anyway...`);
            }

            const pairingCode = await this.requestPairingCode(phoneNumber);

            if (pairingCode) {
                console.log('='.repeat(50));
                console.log(`[${this.sessionId}] 🔐 PAIRING CODE GENERATED`);
                console.log('='.repeat(50));
                console.log(`📱 Phone Number: ${phoneNumber}`);
                console.log(`🔑 Pairing Code: ${pairingCode}`);
                console.log('='.repeat(50));
            } else {
                console.log(`[${this.sessionId}] ⚠️ Failed to generate pairing code, falling back to QR code`);
                authMethod = 'qr';
            }
        }

        if (authMethod === 'qr' || authMethod === 'auto') {
            // Use QR code authentication (default)
            console.log(`[${this.sessionId}] 📱 Using QR code authentication method...`);

            // Wait a bit for WhatsApp to initialize its crypto
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Get initial auth code if available - with error handling
            try {
                const authCode = await this.page.evaluate(() => {
                    if (window.WPP && window.WPP.conn && window.WPP.conn.getAuthCode) {
                        try {
                            return window.WPP.conn.getAuthCode();
                        } catch (error) {
                            console.log('Error getting auth code:', error.message);
                            return null;
                        }
                    }
                    return null;
                });

                if (authCode && authCode.fullCode) {
                    console.log('='.repeat(50));
                    console.log(`[${this.sessionId}] 📱 QR CODE AVAILABLE FOR SCANNING`);
                    console.log('='.repeat(50));
                    this.emit('qr', { sessionId: this.sessionId, qr: authCode.fullCode });
                }
            } catch (error) {
                console.log(`[${this.sessionId}] Could not get initial QR code:`, error.message);
                // Not critical - QR will be captured by event listeners
            }
        }

        console.log(`[${this.sessionId}] ⏳ Waiting for authentication (90 second timeout)...`);

        // Wait for authentication using WA-JS with 90 second timeout
        try {
            await this.page.waitForFunction(
                () => {
                    if (window.WPP && window.WPP.conn) {
                        try {
                            return window.WPP.conn.isAuthenticated();
                        } catch (error) {
                            return false;
                        }
                    }
                    return false;
                },
                {},
                { timeout: 90000 }  // 90 seconds timeout
            );

            console.log(`[${this.sessionId}] ✅ Authenticated! Waiting for interface to be ready...`);

            // Wait for main interface to be ready
            await this.page.waitForFunction(
                () => {
                    if (window.WPP && window.WPP.conn) {
                        try {
                            return window.WPP.conn.isMainReady();
                        } catch (error) {
                            return false;
                        }
                    }
                    return false;
                },
                {},
                { timeout: 30000 }
            );

            console.log(`[${this.sessionId}] ✅ WhatsApp interface fully loaded and ready!`);

            // Get and emit the authenticated phone number
            const phoneNumber = await this.getAuthenticatedPhoneNumber();
            if (phoneNumber) {
                console.log(`[${this.sessionId}] 📱 Connected phone number: ${phoneNumber}`);
                this.emit('phoneNumberCaptured', { sessionId: this.sessionId, phoneNumber });
            }

            return true;

        } catch (error) {
            console.error(`[${this.sessionId}] ❌ Authentication timeout after 90 seconds:`, error.message);

            // Terminate the session after timeout
            try {
                console.log(`[${this.sessionId}] 🔴 Terminating session due to authentication timeout...`);

                // Close the browser
                if (this.browser) {
                    await this.browser.close();
                    this.browser = null;
                    this.page = null;
                }

                // Emit failure event
                this.emit('authenticationFailed', { sessionId: this.sessionId, reason: 'timeout' });

                console.log(`[${this.sessionId}] 🔴 Session terminated due to authentication timeout`);
            } catch (terminateError) {
                console.error(`[${this.sessionId}] Failed to terminate session:`, terminateError.message);
            }

            return false;
        }
    }

    async getAuthenticatedPhoneNumber() {
        try {
            const phoneNumber = await this.page.evaluate(() => {
                if (window.WPP && window.WPP.conn && window.WPP.conn.me) {
                    return window.WPP.conn.me.user;
                }
                return null;
            });
            return phoneNumber;
        } catch (error) {
            console.error(`[${this.sessionId}] Error getting phone number:`, error.message);
            return null;
        }
    }

    async run(authMethod = 'auto', phoneNumber = null) {
        try {
            await this.initialize();

            // Wait for WA-JS to be ready
            try {
                console.log(`[${this.sessionId}] Waiting for WA-JS to initialize...`);
                await this.page.waitForFunction(
                    () => typeof window.WPP !== 'undefined' && window.WPP.isReady,
                    {},
                    { timeout: 30000 }
                );
                console.log(`[${this.sessionId}] WA-JS initialized successfully`);

                // Configure WPP to send status to device and enable removeStatusMessage
                await this.page.evaluate(() => {
                    if (window.WPPConfig) {
                        window.WPPConfig.sendStatusToDevice = true;
                        window.WPPConfig.syncAllStatus = true;
                        console.log('WPPConfig.sendStatusToDevice set to true');
                        console.log('WPPConfig.removeStatusMessage set to true');
                    }
                });

            } catch (waJsError) {
                console.log(`[${this.sessionId}] WA-JS initialization failed:`, waJsError.message);
                console.log(`[${this.sessionId}] Proceeding with basic automation...`);
            }

            const loginSuccess = await this.handleLogin(authMethod, phoneNumber);

            if (loginSuccess) {
                console.log(`[${this.sessionId}] WhatsApp automation ready!`);

                this.statusHandler = new WhatsAppStatusHandler(this.page, this);

                return {
                    success: true,
                    sessionId: this.sessionId,
                    browser: this.browser,
                    page: this.page,
                    statusHandler: this.statusHandler
                };
            } else {
                console.log(`[${this.sessionId}] Login failed`);
                await this.cleanup();
                return { success: false, sessionId: this.sessionId };
            }

        } catch (error) {
            console.error(`[${this.sessionId}] Automation error:`, error.message);
            await this.cleanup();
            return { success: false, sessionId: this.sessionId, error: error.message };
        }
    }

    async cleanup() {
        if (this.cdpSession) {
            await this.cdpSession.detach();
        }
        if (this.browser) {
            await this.browser.close();
        }
    }
}

module.exports = { WhatsAppAutomation };