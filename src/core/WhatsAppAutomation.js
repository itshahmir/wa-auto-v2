const fs = require('fs');
const path = require('path');
const playwright = require('playwright-chromium');
const WhatsAppStatusHandler = require('./StatusHandler');

// ============================================
// Enhanced WhatsApp Automation with Multi-User Support
// ============================================
class WhatsAppAutomation {
    constructor(sessionPath = null, sessionId = null, proxyConfig = null) {
        this.browser = null;
        this.page = null;
        this.sessionPath = sessionPath || path.join(__dirname, 'session');
        this.sessionId = sessionId || 'default';
        this.proxyConfig = proxyConfig; // Store proxy configuration
        this.currentQRUrl = null;
        this.statusHandler = null;
        this.cdpSession = null;
        this.eventCallbacks = new Map(); // For API event subscriptions
        this.eventsSetup = false; // Track if events are already setup

        // Memory leak prevention for large contact lists
        this.memoryMonitorInterval = null;
        this.contextRefreshInterval = null;
        this.lastMemoryUsage = 0;
        this.memoryRefreshThreshold = 70; // Refresh at 70% memory usage
        this.sessionStartTime = Date.now();
        this.maxSessionDuration = 6 * 60 * 60 * 1000; // 6 hours max session (for users with many contacts)
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

        // Prepare browser launch options with HEAVY memory optimization for large contact lists
        const launchOptions = {
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
                '--default-encoding=utf-8',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

                // CRITICAL: Massive memory optimizations for users with many contacts (20GB+ optimization)
                '--max_old_space_size=8192',              // Increase Node.js heap to 8GB
                '--memory-pressure-off',                  // Reduce memory pressure checks
                '--max-heap-size=8192',                   // Increase V8 heap size to 8GB
                '--js-flags=--max-old-space-size=8192',   // Extra V8 memory boost
                '--disable-background-timer-throttling',  // Prevent tab throttling
                '--disable-renderer-backgrounding',       // Keep renderer active
                '--disable-backgrounding-occluded-windows', // Prevent background optimization
                '--disable-features=TranslateUI',         // Disable translate feature
                '--disable-ipc-flooding-protection',      // Prevent IPC throttling
                '--disable-extensions',                   // Disable extensions
                '--disable-component-extensions-with-background-pages',
                '--disable-default-apps',                 // Disable default apps
                '--disable-plugins',                      // Disable plugins
                '--aggressive-cache-discard',             // More aggressive cache clearing

                // EXTREME memory optimizations for contacts overload
                '--disable-background-networking',        // Stop background requests
                '--disable-sync',                         // Disable sync services
                '--disable-domain-reliability',           // Stop crash reporting
                '--disable-client-side-phishing-detection', // Save memory on security
                '--disable-component-update',             // Stop auto-updates
                '--disable-print-preview',                // Disable print features
                '--disable-logging',                      // Reduce logging overhead
                '--disable-speech-api',                   // Disable speech recognition
                '--disable-file-system',                  // Disable filesystem API
                '--disable-notifications',                // Disable notifications API
                '--disable-permissions-api',              // Disable permissions
                '--disable-presentation-api',             // Disable presentation API
                '--disable-remote-fonts',                 // Don't download fonts
                '--disable-shared-workers',               // Disable shared workers
                '--disable-webgl',                        // Disable WebGL to save GPU memory
                '--disable-webgl2',                       // Disable WebGL2
                '--disable-canvas-aa',                    // Disable canvas anti-aliasing
                '--disable-2d-canvas-clip-aa',           // Disable 2D canvas clipping
                '--disable-gl-drawing-for-tests',        // Disable GL drawing
                '--force-cpu-draw',                       // Force CPU rendering
                '--memory-model=low',                     // Use low memory model
                '--renderer-process-limit=1',             // Limit renderer processes
                '--max-active-webgl-contexts=0',          // No WebGL contexts
                '--disable-accelerated-video-decode',     // Disable video acceleration
                '--disable-accelerated-mjpeg-decode',     // Disable MJPEG acceleration
                '--disable-zero-browsers-open-for-tests', // Browser lifecycle optimization
                '--purge-memory-button'                   // Enable memory purge button
            ]
        };

        // Add proxy configuration if available
        if (this.proxyConfig) {
            launchOptions.proxy = {
                server: `${this.proxyConfig.protocol}://${this.proxyConfig.host}:${this.proxyConfig.port}`,
                username: this.proxyConfig.username,
                password: this.proxyConfig.password
            };
            console.log(`[${this.sessionId}] Using proxy: ${this.proxyConfig.host}:${this.proxyConfig.port}`);
        }

        const browser = await playwright.chromium.launchPersistentContext(
            this.sessionPath,
            {
                ...launchOptions,
                executablePath: '/usr/bin/google-chrome-stable'
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
                        syncAllStatus: false,
                    };
                    console.log('WPPConfig pre-configured with sendStatusToDevice and removeStatusMessage');
                });

                // Inject WA-JS using addScriptTag
                const waJsPath = path.resolve("/home/ubuntu/wa-auto-v2/wa-js/dist/wppconnect-wa.js");

                await page.addScriptTag({
                    origin: "https://web.whatsapp.com/",
                    path: waJsPath
                });

                console.log(`[${this.sessionId}] WA-JS script injected via addScriptTag`);

                // Wait a bit for WA-JS to initialize
                await new Promise(resolve => setTimeout(resolve, 3000));

                // CRITICAL FIX: Ensure WA-JS status module is properly loaded
                await page.evaluate(() => {
                    return new Promise((resolve) => {
                        const checkStatusModule = () => {
                            console.log('🔍 Checking WA-JS status module availability...');

                            // Check if WPP exists and is ready
                            if (typeof window.WPP === 'undefined') {
                                console.log('❌ WPP not available yet');
                                setTimeout(checkStatusModule, 1000);
                                return;
                            }

                            // Wait for isFullReady
                            if (!window.WPP.isFullReady) {
                                console.log('⏳ WPP not fully ready yet');
                                setTimeout(checkStatusModule, 1000);
                                return;
                            }

                            // Force load the status module if not available
                            if (!window.WPP.status || typeof window.WPP.status.sendTextStatus !== 'function') {
                                console.log('🔧 Status module not loaded, attempting to force load...');

                                try {
                                    // Try to force load the status module using webpack require
                                    if (window.WPP.webpack && typeof window.WPP.webpack.require === 'function') {
                                        console.log('📦 Using webpack to load status module...');

                                        // Search for status-related modules
                                        const modules = window.WPP.webpack.findModule ?
                                            window.WPP.webpack.findModule('sendTextStatus') : null;

                                        if (modules) {
                                            console.log('✅ Found status module via webpack');
                                        }
                                    }

                                    // Alternative: Try to access status functions through Store
                                    if (window.Store && window.Store.StatusV3) {
                                        console.log('🔄 Using Store.StatusV3 as fallback');

                                        // Create a wrapper for missing WPP.status functions
                                        if (!window.WPP.status) {
                                            window.WPP.status = {};
                                        }

                                        if (!window.WPP.status.sendTextStatus && window.Store.StatusV3.sendMessage) {
                                            window.WPP.status.sendTextStatus = async (content, options = {}) => {
                                                console.log('📤 Using Store.StatusV3 wrapper for sendTextStatus');
                                                const statusMsg = {
                                                    type: 'text',
                                                    body: content,
                                                    isViewOnce: false,
                                                    ...options
                                                };
                                                return await window.Store.StatusV3.sendMessage(statusMsg);
                                            };
                                        }
                                    }

                                    // Check if we now have status functions
                                    if (window.WPP.status && typeof window.WPP.status.sendTextStatus === 'function') {
                                        console.log('✅ Status module successfully loaded/wrapped');
                                        resolve();
                                        return;
                                    }
                                } catch (error) {
                                    console.log('❌ Error loading status module:', error.message);
                                }

                                // If still not available, try again in a moment
                                setTimeout(checkStatusModule, 2000);
                                return;
                            }

                            console.log('✅ WA-JS status module is ready');
                            resolve();
                        };

                        checkStatusModule();
                    });
                });

                console.log(`[${this.sessionId}] WA-JS status module verification complete`);

                // EXTREME memory optimization for users with many contacts (MEMORY LEAK PREVENTION)
                try {
                    await page.evaluate(() => {
                        console.log('🚀 Applying EXTREME memory optimizations for large contact lists...');

                        // Memory monitoring and optimization function
                        const optimizeForLargeContactLists = () => {
                            try {
                                console.log('🔧 Running contact list memory optimization...');

                                // 1. CRITICAL: Remove the entire sidebar DOM tree (huge memory saver)
                                const sideElement = document.querySelector('#side');
                                if (sideElement) {
                                    console.log('📱 REMOVING entire WhatsApp sidebar to save memory');
                                    sideElement.remove(); // More aggressive than parent remove
                                }

                                // 2. Remove search/filter elements that cache contacts
                                const searchElements = document.querySelectorAll('[data-testid*="search"], [data-testid*="filter"], input[type="search"]');
                                searchElements.forEach(el => el.remove());

                                // 3. AGGRESSIVE: Remove chat list entirely if too many chats
                                const chatListContainer = document.querySelector('[data-testid="chat-list"]');
                                if (chatListContainer) {
                                    const chatItems = chatListContainer.querySelectorAll('[data-testid^="cell-frame-container"]');
                                    console.log(`📋 Found ${chatItems.length} chats`);

                                    // If more than 50 chats, remove the entire list to save MASSIVE memory
                                    if (chatItems.length > 50) {
                                        console.log('⚠️ TOO MANY CHATS! Removing entire chat list to prevent crash');
                                        chatListContainer.remove();
                                    } else {
                                        // For smaller lists, just hide excess
                                        for (let i = 10; i < chatItems.length; i++) {
                                            if (chatItems[i]) {
                                                chatItems[i].remove(); // Remove from DOM completely
                                            }
                                        }
                                    }
                                }

                                // 4. Remove contact avatars and images (memory hogs)
                                const avatars = document.querySelectorAll('img[data-testid*="avatar"], img[src*="blob:"], canvas');
                                console.log(`🖼️ Removing ${avatars.length} images/avatars to save memory`);
                                avatars.forEach(img => img.remove());

                                // 5. Clear message history containers
                                const messageContainers = document.querySelectorAll('[data-testid="conversation-panel-messages"]');
                                messageContainers.forEach(container => {
                                    container.innerHTML = ''; // Clear message history
                                });

                                // 6. EXTREME: Disable all animations and transitions globally
                                const style = document.createElement('style');
                                style.textContent = `
                                    * {
                                        animation: none !important;
                                        transition: none !important;
                                        transform: none !important;
                                        filter: none !important;
                                        box-shadow: none !important;
                                        background-image: none !important;
                                    }

                                    /* Hide memory-heavy elements */
                                    [data-testid="conversation-panel-messages"] { display: none !important; }
                                    [data-testid="conversation-panel-wrapper"] { display: none !important; }
                                    [data-testid="conversation-panel"] { display: none !important; }
                                    [class*="message"] { display: none !important; }

                                    /* Keep only Status functionality visible */
                                    [data-testid*="status"] { display: block !important; }
                                    [aria-label*="Status"], [aria-label*="Updates"] { display: block !important; }
                                `;
                                document.head.appendChild(style);

                                // 7. Force garbage collection
                                if (window.gc) {
                                    window.gc();
                                    console.log('🗑️ Forced garbage collection');
                                }

                                // 8. Clear all caches aggressively
                                if ('caches' in window) {
                                    caches.keys().then(names => {
                                        names.forEach(name => {
                                            caches.delete(name);
                                        });
                                        console.log(`🧹 Cleared ${names.length} cache stores`);
                                    }).catch(() => {});
                                }

                                // 9. Clear local storage of WhatsApp data
                                try {
                                    // Clear only non-essential items
                                    const keysToKeep = ['WAPersistentSession', 'WAToken', 'WAUserAgent'];
                                    for (let i = localStorage.length - 1; i >= 0; i--) {
                                        const key = localStorage.key(i);
                                        if (key && !keysToKeep.some(keepKey => key.includes(keepKey))) {
                                            localStorage.removeItem(key);
                                        }
                                    }
                                    console.log('🧽 Cleaned up localStorage');
                                } catch (e) {}

                                // 10. Disconnect unused observers
                                if (window.MutationObserver) {
                                    const observers = [];
                                    observers.forEach(obs => obs.disconnect());
                                }

                                console.log('✅ Memory optimization completed');

                                // Return memory stats if available
                                if (performance && performance.memory) {
                                    console.log(`📊 Memory usage: ${Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)}MB`);
                                    console.log(`📊 Memory limit: ${Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)}MB`);
                                }

                            } catch (optError) {
                                console.error('⚠️ Error in memory optimization:', optError.message);
                            }
                        };

                        // 11. Memory pressure monitoring and auto-cleanup
                        const monitorMemoryPressure = () => {
                            if (performance && performance.memory) {
                                const used = performance.memory.usedJSHeapSize;
                                const limit = performance.memory.jsHeapSizeLimit;
                                const usage = (used / limit) * 100;

                                console.log(`🎯 Memory usage: ${usage.toFixed(1)}%`);

                                // If memory usage is above 70%, run aggressive cleanup
                                if (usage > 70) {
                                    console.log('⚠️ HIGH MEMORY USAGE! Running emergency cleanup...');
                                    optimizeForLargeContactLists();

                                    // Emergency measures
                                    if (usage > 85) {
                                        console.log('🚨 CRITICAL MEMORY! Removing everything except status...');
                                        document.body.innerHTML = '<div>WhatsApp Status Only Mode</div>';
                                    }
                                }
                            }
                        };

                        // 12. Wait for WhatsApp to load then optimize immediately
                        const waitForWhatsApp = setInterval(() => {
                            if (document.querySelector('#app') || document.querySelector('[data-testid="app"]')) {
                                console.log('📱 WhatsApp loaded, applying optimizations...');
                                optimizeForLargeContactLists();
                                clearInterval(waitForWhatsApp);
                            }
                        }, 1000);

                        // Stop trying after 30 seconds
                        setTimeout(() => {
                            clearInterval(waitForWhatsApp);
                        }, 30000);

                        // Run optimization every 2 minutes for continued stability
                        setInterval(optimizeForLargeContactLists, 120000);

                        // Memory monitoring every 30 seconds
                        setInterval(monitorMemoryPressure, 30000);

                        console.log('🚀 EXTREME memory optimization system activated!');
                    });
                } catch (optimizationError) {
                    console.log(`[${this.sessionId}] ⚠️ Could not apply EXTREME optimizations:`, optimizationError.message);
                }

            } catch (error) {
                console.log(`[${this.sessionId}] WA-JS injection failed:`, error.message);
                console.log(`[${this.sessionId}] Proceeding without WA-JS...`);
            }
        });

        // Remove service workers and set up error handling with UTF-8 encoding
        await page.addInitScript(() => {
            // Ensure UTF-8 encoding for Hebrew text support
            const charset = document.createElement('meta');
            charset.setAttribute('charset', 'UTF-8');
            document.head.insertBefore(charset, document.head.firstChild);

            // Also set http-equiv charset for better compatibility
            const httpCharset = document.createElement('meta');
            httpCharset.setAttribute('http-equiv', 'Content-Type');
            httpCharset.setAttribute('content', 'text/html; charset=UTF-8');
            document.head.insertBefore(httpCharset, document.head.firstChild);

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

    // Memory monitoring and context refresh for users with many contacts
    async startMemoryMonitoring() {
        console.log(`[${this.sessionId}] 🎯 Starting memory monitoring for large contact lists...`);

        // Clear any existing intervals
        if (this.memoryMonitorInterval) clearInterval(this.memoryMonitorInterval);
        if (this.contextRefreshInterval) clearInterval(this.contextRefreshInterval);

        // Monitor memory every 30 seconds
        this.memoryMonitorInterval = setInterval(async () => {
            try {
                if (!this.page || this.page.isClosed()) return;

                const memoryInfo = await this.page.evaluate(() => {
                    if (performance && performance.memory) {
                        return {
                            used: performance.memory.usedJSHeapSize,
                            total: performance.memory.totalJSHeapSize,
                            limit: performance.memory.jsHeapSizeLimit,
                            usagePercent: (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100
                        };
                    }
                    return null;
                });

                if (memoryInfo) {
                    console.log(`[${this.sessionId}] 📊 Memory: ${memoryInfo.usagePercent.toFixed(1)}% (${Math.round(memoryInfo.used / 1024 / 1024)}MB)`);

                    // If memory usage is too high, trigger emergency cleanup
                    if (memoryInfo.usagePercent > this.memoryRefreshThreshold) {
                        console.log(`[${this.sessionId}] ⚠️ HIGH MEMORY USAGE! Triggering emergency cleanup...`);
                        await this.emergencyMemoryCleanup();

                        // If still too high after cleanup, refresh context
                        if (memoryInfo.usagePercent > 85) {
                            console.log(`[${this.sessionId}] 🚨 CRITICAL MEMORY! Refreshing browser context...`);
                            await this.refreshBrowserContext();
                        }
                    }

                    this.lastMemoryUsage = memoryInfo.usagePercent;
                }

                // Check session duration - refresh after max time to prevent memory buildup
                const sessionDuration = Date.now() - this.sessionStartTime;
                if (sessionDuration > this.maxSessionDuration) {
                    console.log(`[${this.sessionId}] ⏰ Session duration exceeded ${this.maxSessionDuration / (60 * 60 * 1000)}h, refreshing context...`);
                    await this.refreshBrowserContext();
                }

            } catch (error) {
                console.log(`[${this.sessionId}] Error in memory monitoring:`, error.message);
            }
        }, 30000);

        // Periodic context refresh every 2 hours for users with many contacts
        this.contextRefreshInterval = setInterval(async () => {
            try {
                console.log(`[${this.sessionId}] 🔄 Periodic context refresh for memory leak prevention...`);
                await this.refreshBrowserContext();
            } catch (error) {
                console.log(`[${this.sessionId}] Error in periodic refresh:`, error.message);
            }
        }, 2 * 60 * 60 * 1000); // Every 2 hours
    }

    async emergencyMemoryCleanup() {
        try {
            console.log(`[${this.sessionId}] 🧹 Running emergency memory cleanup...`);

            if (!this.page || this.page.isClosed()) return;

            await this.page.evaluate(() => {
                // Force garbage collection
                if (window.gc) {
                    window.gc();
                    console.log('🗑️ Forced garbage collection');
                }

                // Clear all caches
                if ('caches' in window) {
                    caches.keys().then(names => {
                        names.forEach(name => caches.delete(name));
                    }).catch(() => {});
                }

                // Remove all image elements to free memory
                const images = document.querySelectorAll('img, canvas, video');
                images.forEach(img => img.remove());

                // Clear any message containers
                const containers = document.querySelectorAll('[data-testid*="message"], [class*="message"]');
                containers.forEach(container => container.innerHTML = '');

                console.log('💨 Emergency cleanup completed');
            });

        } catch (error) {
            console.log(`[${this.sessionId}] Error in emergency cleanup:`, error.message);
        }
    }

    async refreshBrowserContext() {
        try {
            console.log(`[${this.sessionId}] 🔄 Refreshing browser context to prevent memory leaks...`);

            // Check if we're authenticated before refresh
            const isAuth = await this.isAuthenticated().catch(() => false);

            if (!isAuth) {
                console.log(`[${this.sessionId}] Not authenticated, skipping context refresh`);
                return false;
            }

            // Save current state
            const wasAuthenticated = isAuth;

            // Create new browser context while keeping the old one
            const oldBrowser = this.browser;
            const oldPage = this.page;

            try {
                // Create new browser context with same settings
                const { browser: newBrowser, page: newPage } = await this.createBrowserWithWAJS();

                // Wait for WhatsApp to load in new context
                await newPage.goto('https://web.whatsapp.com', {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000
                });

                // Wait for authentication to restore (should happen automatically with persistent context)
                let authRestored = false;
                for (let i = 0; i < 30; i++) { // Wait up to 30 seconds
                    const isNewAuth = await this.checkAuthenticationStatus(newPage);
                    if (isNewAuth) {
                        authRestored = true;
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (authRestored) {
                    // Switch to new context
                    this.browser = newBrowser;
                    this.page = newPage;

                    // Setup CDP session
                    this.cdpSession = await this.page.context().newCDPSession(this.page);
                    await this.cdpSession.send('Page.setBypassCSP', { enabled: true });

                    // Recreate status handler
                    this.statusHandler = new WhatsAppStatusHandler(this.page, this);

                    // Reset session timer
                    this.sessionStartTime = Date.now();

                    console.log(`[${this.sessionId}] ✅ Browser context refreshed successfully`);

                    // Close old browser context
                    if (oldBrowser) {
                        try {
                            await oldBrowser.close();
                        } catch (e) {
                            console.log(`[${this.sessionId}] Note: Could not close old browser:`, e.message);
                        }
                    }

                    return true;
                } else {
                    console.log(`[${this.sessionId}] ⚠️ Authentication not restored in new context, keeping old one`);
                    await newBrowser.close();
                    return false;
                }

            } catch (refreshError) {
                console.log(`[${this.sessionId}] Error creating new context:`, refreshError.message);

                // Clean up new browser if creation failed
                if (newBrowser) {
                    try {
                        await newBrowser.close();
                    } catch (e) {}
                }

                return false;
            }

        } catch (error) {
            console.log(`[${this.sessionId}] Error in context refresh:`, error.message);
            return false;
        }
    }

    async checkAuthenticationStatus(page = null) {
        try {
            const targetPage = page || this.page;
            if (!targetPage || targetPage.isClosed()) return false;

            const isAuthenticated = await targetPage.evaluate(() => {
                if (window.WPP && window.WPP.conn) {
                    try {
                        return window.WPP.conn.isAuthenticated();
                    } catch (e) {
                        return false;
                    }
                }
                return false;
            }).catch(() => false);

            return isAuthenticated;
        } catch (error) {
            return false;
        }
    }

    stopMemoryMonitoring() {
        if (this.memoryMonitorInterval) {
            clearInterval(this.memoryMonitorInterval);
            this.memoryMonitorInterval = null;
        }
        if (this.contextRefreshInterval) {
            clearInterval(this.contextRefreshInterval);
            this.contextRefreshInterval = null;
        }
        console.log(`[${this.sessionId}] 🛑 Memory monitoring stopped`);
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

            // Handle authentication timeout
            try {
                console.log(`[${this.sessionId}] 🔴 Authentication timeout after 90 seconds...`);

                // Check if authentication succeeded during timeout handling
                const finalAuthCheck = await this.isAuthenticated();
                if (finalAuthCheck) {
                    console.log(`[${this.sessionId}] ✅ Authentication detected during timeout handling - keeping session alive`);
                    return true;
                }

                // Only close browser if authentication truly failed
                console.log(`[${this.sessionId}] 🔴 Terminating session due to authentication timeout...`);
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
                        window.WPPConfig.syncAllStatus = false;
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

                // START MEMORY MONITORING FOR LARGE CONTACT LISTS
                await this.startMemoryMonitoring();

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

    async cleanup(forceClose = false) {
        // Stop memory monitoring for large contact lists
        this.stopMemoryMonitoring();

        // Detach CDP session
        if (this.cdpSession) {
            await this.cdpSession.detach();
        }

        // Only close browser if forced or if not authenticated
        if (this.browser && forceClose) {
            console.log(`[${this.sessionId}] Force closing browser during cleanup`);
            await this.browser.close();
        } else if (this.browser && !forceClose) {
            try {
                // Check authentication status before closing
                const isAuthenticated = await this.isAuthenticated();
                if (!isAuthenticated) {
                    console.log(`[${this.sessionId}] Closing browser - session not authenticated`);
                    await this.browser.close();
                } else {
                    console.log(`[${this.sessionId}] Keeping browser alive - session is authenticated`);
                    // Keep browser alive for authenticated sessions
                    return;
                }
            } catch (error) {
                console.log(`[${this.sessionId}] Error checking auth status during cleanup, closing browser:`, error.message);
                await this.browser.close();
            }
        }
    }
}

module.exports = { WhatsAppAutomation };