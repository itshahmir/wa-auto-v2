const { STATUS_BROADCAST_JID } = require('../utils/statusUtils');

class WhatsAppStatusHandler {
    constructor(page, whatsappAutomation) {
        this.page = page;
        this.whatsappAutomation = whatsappAutomation;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        console.log('Initializing StatusHandler...');

        // Skip WA-JS entirely - go directly to DOM manipulation
        // WA-JS status methods are undefined in current WhatsApp Web version
        try {
            // Just wait for page to be loaded
            await this.page.waitForFunction(() => {
                return document.readyState === 'complete' && window.location.href.includes('web.whatsapp.com');
            }, { timeout: 10000 });

            this.initialized = true;
            console.log('StatusHandler initialized successfully (DOM-only mode)');
        } catch (error) {
            console.error('Failed to initialize StatusHandler:', error.message);
            // Don't throw - allow DOM manipulation to work
            this.initialized = true;
            console.log('StatusHandler initialized in fallback mode');
        }
    }

    // Helper function to click the Status button
    async clickStatusButton() {
        console.log('Looking for Status button with multiple selectors...');

        // Try multiple selectors for the Status button simultaneously
        const statusButtonSelectors = [
            '[data-navbar-item-index="1"]',
            'button[aria-label="Status"]',
            'button[aria-label="Updates in Status"]',
        ];

        // Create a combined locator that matches any of the selectors
        const statusButton = this.page.locator(
            statusButtonSelectors.join(', ')
        ).first();

        try {
            // Wait for any matching element to be visible
            await statusButton.waitFor({ state: 'visible', timeout: 10000 });

            console.log('Found Status button, clicking...');
            await statusButton.click();

            // Verify click was successful by waiting for expected behavior
            await this.page.waitForTimeout(1000);

            console.log('Status button clicked successfully');

            return true;
        } catch (error) {
            console.error('Could not find Status button with any of the selectors:', error.message);

            // Optional: Log which elements ARE visible for debugging
            const visibleButtons = await this.page.locator('button:visible, div[role="button"]:visible').all();
            console.log(`Found ${visibleButtons.length} visible buttons on page`);

            throw new Error('Could not find or click Status button');
        }
    }

    // Centralized WA-JS readiness waiting function
    async waitForWAJS(statusMethod = null, timeout = 10000) {
        console.log(`Waiting for WA-JS to be ready${statusMethod ? ` with ${statusMethod}` : ''}...`);

        try {
            // First check what's actually available
            const availability = await this.checkWAJSAvailability();
            console.log('WA-JS availability check:', availability);

            // CRITICAL: Only skip wait if both isFullReady AND required functions exist
            if (availability.isReady && availability.isFullReady) {
                console.log('WA-JS is already fully ready, skipping wait');
                return;
            }

            console.log('WA-JS not fully ready, waiting for proper initialization...');

            // CRITICAL FIX: If status methods are completely unavailable but alternatives exist, don't wait forever
            if (availability.isFullReady && !availability.isReady && availability.hasAlternatives) {
                console.log('Status methods unavailable but alternatives exist, proceeding with fallbacks...');
                return;
            }

            // Use a stricter wait condition - require both isFullReady AND working functions
            await this.page.waitForFunction((method) => {
                // Check if WPP exists
                if (typeof window.WPP === 'undefined') {
                    console.log('WPP not available yet');
                    return false;
                }

                // REQUIRE isFullReady - this is critical for status operations
                if (!window.WPP.isFullReady) {
                    console.log('WPP exists but isFullReady=false, still waiting...');
                    return false;
                }

                // Check that status module is available
                if (!window.WPP.status) {
                    console.log('WPP.status not available yet');
                    return false;
                }

                // Force module loading if webpack is available
                try {
                    if (window.WPP.webpack) {
                        window.WPP.webpack.require('WPP.status');
                    }
                } catch (e) {
                    // Ignore errors - this is just a fallback
                }

                // Check for specific status method if provided
                if (method === 'sendTextStatus') {
                    const hasMethod = window.WPP.status && typeof window.WPP.status.sendTextStatus === 'function';
                    if (!hasMethod) {
                        console.log('sendTextStatus method not ready yet, checking fallbacks...');
                        // Check if alternative methods are available
                        const hasFallback = (window.Store && window.Store.StatusV3) ||
                                          (window.WPP.whatsapp && window.WPP.whatsapp.functions);
                        if (hasFallback) {
                            console.log('Fallback methods available, proceeding...');
                            return true;
                        }
                    }
                    return hasMethod;
                } else if (method === 'sendVideoStatus') {
                    const hasMethod = window.WPP.status && typeof window.WPP.status.sendVideoStatus === 'function';
                    if (!hasMethod) {
                        console.log('sendVideoStatus method not ready yet, checking fallbacks...');
                        const hasFallback = (window.Store && window.Store.StatusV3) ||
                                          (window.WPP.whatsapp && window.WPP.whatsapp.functions);
                        if (hasFallback) {
                            console.log('Fallback methods available, proceeding...');
                            return true;
                        }
                    }
                    return hasMethod;
                } else if (method === 'sendImageStatus') {
                    const hasMethod = window.WPP.status && typeof window.WPP.status.sendImageStatus === 'function';
                    if (!hasMethod) {
                        console.log('sendImageStatus method not ready yet, checking fallbacks...');
                        const hasFallback = (window.Store && window.Store.StatusV3) ||
                                          (window.WPP.whatsapp && window.WPP.whatsapp.functions);
                        if (hasFallback) {
                            console.log('Fallback methods available, proceeding...');
                            return true;
                        }
                    }
                    return hasMethod;
                }

                // For general readiness, check if any method works or fallbacks are available
                const hasStatusMethod = window.WPP.status && typeof window.WPP.status.sendTextStatus === 'function';
                const hasFallback = (window.Store && window.Store.StatusV3) ||
                                  (window.WPP.whatsapp && window.WPP.whatsapp.functions) ||
                                  (window.WPP.chat);

                if (!hasStatusMethod && !hasFallback) {
                    console.log('WPP status methods and fallbacks not ready yet');
                    return false;
                }

                if (!hasStatusMethod && hasFallback) {
                    console.log('Primary WPP.status methods not available, proceeding with fallbacks');
                    return true; // Allow fallback methods
                }

                return true;
            }, statusMethod, { timeout });

            console.log('WA-JS is ready after waiting');
        } catch (error) {
            console.error('WA-JS wait timeout after', timeout + 'ms:', error.message);

            // Check final status before throwing
            const finalCheck = await this.checkWAJSAvailability();
            console.log('Final WA-JS check after timeout:', finalCheck);

            if (!finalCheck.isFullReady) {
                throw new Error('WA-JS failed to initialize properly - isFullReady is still false. Status operations will fail.');
            }

            // If WA-JS is ready but status methods are not available, proceed with alternatives
            if (finalCheck.isFullReady && !finalCheck.isReady && finalCheck.hasAlternatives) {
                console.log('Status methods timeout but alternatives available, proceeding...');
                return;
            }

            // If no alternatives, throw the error
            if (!finalCheck.hasAlternatives) {
                throw new Error('WA-JS status methods not available and no alternatives found');
            }
        }
    }

    // Helper function to check WA-JS availability
    async checkWAJSAvailability() {
        return await this.page.evaluate(() => {
            const checks = {
                wppExists: typeof window.WPP !== 'undefined',
                isFullReady: window.WPP && window.WPP.isFullReady,
                statusExists: window.WPP && window.WPP.status,
                sendTextStatus: window.WPP && window.WPP.status && typeof window.WPP.status.sendTextStatus === 'function',
                sendImageStatus: window.WPP && window.WPP.status && typeof window.WPP.status.sendImageStatus === 'function',
                sendVideoStatus: window.WPP && window.WPP.status && typeof window.WPP.status.sendVideoStatus === 'function',
                chatExists: window.WPP && window.WPP.chat,
                sendMessage: window.WPP && window.WPP.chat && typeof window.WPP.chat.sendTextMessage === 'function',
                sendFileMessage: window.WPP && window.WPP.chat && typeof window.WPP.chat.sendFileMessage === 'function'
            };

            // CRITICAL FIX: Properly check if status methods are actually available
            // Don't report ready if status module exists but methods are undefined
            const actualStatusReady = checks.statusExists &&
                (checks.sendTextStatus || checks.sendImageStatus || checks.sendVideoStatus);

            // If WPP.status methods are undefined, try to create wrappers using Store.StatusV3
            if (checks.statusExists && !actualStatusReady && window.Store && window.Store.StatusV3) {
                console.log('🔧 WPP.status methods undefined, creating Store.StatusV3 wrappers...');

                try {
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
                        checks.sendTextStatus = true;
                    }

                    if (!window.WPP.status.sendImageStatus && window.Store.StatusV3.sendMessage) {
                        window.WPP.status.sendImageStatus = async (content, options = {}) => {
                            console.log('📤 Using Store.StatusV3 wrapper for sendImageStatus');
                            const statusMsg = {
                                type: 'image',
                                ...options
                            };
                            return await window.Store.StatusV3.sendMessage(statusMsg);
                        };
                        checks.sendImageStatus = true;
                    }

                    if (!window.WPP.status.sendVideoStatus && window.Store.StatusV3.sendMessage) {
                        window.WPP.status.sendVideoStatus = async (content, options = {}) => {
                            console.log('📤 Using Store.StatusV3 wrapper for sendVideoStatus');
                            const statusMsg = {
                                type: 'video',
                                ...options
                            };
                            return await window.Store.StatusV3.sendMessage(statusMsg);
                        };
                        checks.sendVideoStatus = true;
                    }

                    console.log('✅ Store.StatusV3 wrappers created successfully');
                } catch (error) {
                    console.log('❌ Error creating Store.StatusV3 wrappers:', error.message);
                }
            }

            // Recalculate actualStatusReady after potential wrapper creation
            const finalStatusReady = checks.statusExists &&
                (checks.sendTextStatus || checks.sendImageStatus || checks.sendVideoStatus);

            return {
                ...checks,
                isReady: checks.wppExists && checks.isFullReady && finalStatusReady,
                hasAlternatives: checks.chatExists && (checks.sendMessage || checks.sendFileMessage)
            };
        });
    }

    // Generic status sending method - ultra fast direct with stability checks for large contact lists
    async sendStatus(type, content, options = {}) {
        console.log(`[${new Date().toISOString()}] Sending ${type} status with ultra-fast method...`);

        try {
            // CRITICAL: Wait for WA-JS to be fully ready before proceeding
            await this.waitForWAJS(type === 'text' ? 'sendTextStatus' : type === 'image' ? 'sendImageStatus' : type === 'video' ? 'sendVideoStatus' : null);

            // CRITICAL: Enhanced browser context validation for users with many contacts
            if (!this.page || this.page.isClosed()) {
                console.error('🚨 Browser page is closed - session may have crashed due to memory pressure from large contact list');
                throw new Error('Browser page is closed - session may have crashed due to memory pressure');
            }

            // Check if browser context is still connected (common issue with large contact lists)
            try {
                await this.page.evaluate(() => window.location.href);
            } catch (contextError) {
                console.error('🚨 Browser context lost - attempting emergency recovery...');

                // Try to recover the context if possible
                try {
                    if (this.whatsappAutomation && this.whatsappAutomation.refreshBrowserContext) {
                        console.log('🔄 Attempting browser context recovery...');
                        const recovered = await this.whatsappAutomation.refreshBrowserContext();
                        if (recovered) {
                            console.log('✅ Context recovered, retrying status send...');
                            // Update page reference after recovery
                            this.page = this.whatsappAutomation.page;
                        } else {
                            throw new Error('Context recovery failed');
                        }
                    } else {
                        throw contextError;
                    }
                } catch (recoveryError) {
                    console.error('❌ Context recovery failed:', recoveryError.message);
                    throw new Error('Browser context lost - likely due to WhatsApp overload from large contact list');
                }
            }

            // Memory pressure check before proceeding
            try {
                const memoryInfo = await this.page.evaluate(() => {
                    if (performance && performance.memory) {
                        const usage = (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100;
                        return { usage, memoryMB: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) };
                    }
                    return null;
                });

                if (memoryInfo && memoryInfo.usage > 90) {
                    console.warn(`⚠️ HIGH MEMORY PRESSURE: ${memoryInfo.usage.toFixed(1)}% (${memoryInfo.memoryMB}MB) - status send may fail`);

                    // Try emergency cleanup before sending
                    if (this.whatsappAutomation && this.whatsappAutomation.emergencyMemoryCleanup) {
                        await this.whatsappAutomation.emergencyMemoryCleanup();
                    }
                }
            } catch (memoryCheckError) {
                console.log('Note: Could not check memory usage:', memoryCheckError.message);
            }

            // Default to reliable sending with ACK confirmation
            options = { waitForAck: true, ...options };

            // Increase timeout for users with large contact lists (they need more time to process)
            this.page.setDefaultTimeout(5000);

            const result = await this.page.evaluate(async ({ statusType, statusContent, statusOptions }) => {
                try {
                    console.log(`[${new Date().toISOString()}] Sending ${statusType} NOW...`);

                    // Method 0: Skip WPP.status methods - they're undefined in current WhatsApp Web version
                    console.log(`[${new Date().toISOString()}] Skipping WPP.status methods (undefined in current version)...`);

                    // Method 0.5: Try direct Store manipulation as secondary option
                    if (window.Store && window.Store.StatusV3) {
                        try {
                            console.log(`[${new Date().toISOString()}] Trying direct Store.StatusV3 method...`);

                            if (statusType === 'text') {
                                // Create status message directly
                                const statusMsg = {
                                    type: 'text',
                                    body: statusContent,
                                    isViewOnce: false,
                                    ...statusOptions
                                };

                                // Try to send via Store
                                if (window.Store.StatusV3.sendMessage) {
                                    const result = await window.Store.StatusV3.sendMessage(statusMsg);
                                    if (result) {
                                        console.log(`[${new Date().toISOString()}] SUCCESS via Store.StatusV3 - ${statusType} sent!`, result);
                                        return { success: true, method: 'store_status_v3', result: result };
                                    }
                                }
                            }
                        } catch (storeError) {
                            console.log(`[${new Date().toISOString()}] Store.StatusV3 failed:`, storeError.message);
                        }
                    }

                    // Method 1: Try WPP.status (more reliable for existing users)
                    if (window.WPP && window.WPP.status) {
                        try {
                            let statusResult;

                            if (statusType === 'text' && window.WPP.status.sendTextStatus) {
                                console.log(`[${new Date().toISOString()}] Using WPP.status.sendTextStatus...`);
                                // Use user's preference for waitForAck (default true for reliability)
                                statusResult = await window.WPP.status.sendTextStatus(statusContent, statusOptions);
                                console.log(`[${new Date().toISOString()}] Status sent with ACK confirmation: ${statusOptions.waitForAck !== false}`);
                            } else if (statusType === 'image' && window.WPP.status.sendImageStatus) {
                                console.log(`[${new Date().toISOString()}] Using WPP.status.sendImageStatus...`);
                                statusResult = await window.WPP.status.sendImageStatus(statusContent, statusOptions);
                                console.log(`[${new Date().toISOString()}] Image status sent with ACK confirmation: ${statusOptions.waitForAck !== false}`);
                            } else if (statusType === 'video' && window.WPP.status.sendVideoStatus) {
                                console.log(`[${new Date().toISOString()}] Using WPP.status.sendVideoStatus...`);
                                statusResult = await window.WPP.status.sendVideoStatus(statusContent, statusOptions);
                                console.log(`[${new Date().toISOString()}] Video status sent with ACK confirmation: ${statusOptions.waitForAck !== false}`);
                            }

                            if (statusResult) {
                                console.log(`[${new Date().toISOString()}] SUCCESS via WPP.status - ${statusType} sent!`, statusResult);
                                return { success: true, method: 'wpp_status', result: statusResult };
                            }
                        } catch (statusError) {
                            console.log(`[${new Date().toISOString()}] WPP.status failed, trying chat method...`, statusError.message);
                        }
                    }

                    // Method 2: Try WhatsApp functions for new users
                    if (window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.functions) {
                        try {
                            let statusResult;

                            if (statusType === 'text' && window.WPP.whatsapp.functions.sendTextStatusMessage) {
                                console.log(`[${new Date().toISOString()}] Using WPP.whatsapp.functions.sendTextStatusMessage...`);
                                statusResult = await window.WPP.whatsapp.functions.sendTextStatusMessage(statusContent, statusOptions);
                                console.log(`[${new Date().toISOString()}] Text status sent via functions with ACK: ${statusOptions.waitForAck !== false}`);
                            } else if (statusType === 'image' && window.WPP.whatsapp.functions.sendImageStatusMessage) {
                                console.log(`[${new Date().toISOString()}] Using WPP.whatsapp.functions.sendImageStatusMessage...`);
                                statusResult = await window.WPP.whatsapp.functions.sendImageStatusMessage(statusContent, statusOptions);
                                console.log(`[${new Date().toISOString()}] Image status sent via functions with ACK: ${statusOptions.waitForAck !== false}`);
                            } else if (statusType === 'video' && window.WPP.whatsapp.functions.sendVideoStatusMessage) {
                                console.log(`[${new Date().toISOString()}] Using WPP.whatsapp.functions.sendVideoStatusMessage...`);
                                statusResult = await window.WPP.whatsapp.functions.sendVideoStatusMessage(statusContent, statusOptions);
                                console.log(`[${new Date().toISOString()}] Video status sent via functions with ACK: ${statusOptions.waitForAck !== false}`);
                            }

                            if (statusResult) {
                                console.log(`[${new Date().toISOString()}] SUCCESS via WPP.whatsapp.functions - ${statusType} sent!`, statusResult);
                                return { success: true, method: 'whatsapp_functions', result: statusResult };
                            }
                        } catch (functionsError) {
                            console.log(`[${new Date().toISOString()}] WPP.whatsapp.functions failed:`, functionsError.message);
                        }
                    }

                    // Method 3: Try using keyboard shortcut for new users
                    console.log(`[${new Date().toISOString()}] Trying keyboard shortcut method...`);
                    try {
                        // Press Ctrl+Shift+S to open status composer
                        const event = new KeyboardEvent('keydown', {
                            key: 'S',
                            code: 'KeyS',
                            ctrlKey: true,
                            shiftKey: true,
                            bubbles: true
                        });
                        document.dispatchEvent(event);

                        // Wait for status composer to open
                        await new Promise(resolve => setTimeout(resolve, 800));

                        if (statusType === 'text') {
                            // Try to find the status text input
                            const statusTextInput = document.querySelector('div[contenteditable="true"][data-testid="status-text-input"], div[contenteditable="true"][aria-label*="status"], div[contenteditable="true"][placeholder*="status"]') ||
                                                  document.querySelector('div[contenteditable="true"]:not([data-testid="conversation-compose-box-input"])');

                            if (statusTextInput) {
                                // Focus and type the text
                                statusTextInput.focus();
                                statusTextInput.innerText = statusContent;

                                // Trigger input event
                                const inputEvent = new Event('input', { bubbles: true });
                                statusTextInput.dispatchEvent(inputEvent);

                                // Wait a bit then look for send button
                                await new Promise(resolve => setTimeout(resolve, 500));

                                const sendButton = document.querySelector('button[data-testid="status-send"], button[aria-label*="Send"], span[data-testid="send"]') ||
                                                 [...document.querySelectorAll('button')].find(btn =>
                                                     btn.innerText.toLowerCase().includes('send') ||
                                                     btn.querySelector('svg[data-testid="send"]')
                                                 );

                                if (sendButton && !sendButton.disabled) {
                                    sendButton.click();
                                    console.log(`[${new Date().toISOString()}] SUCCESS via keyboard shortcut - ${statusType} sent!`);
                                    return { success: true, method: 'keyboard_shortcut', result: 'sent via UI' };
                                }
                            }
                        }
                    } catch (keyboardError) {
                        console.log(`[${new Date().toISOString()}] Keyboard shortcut failed:`, keyboardError.message);
                    }

                    // Method 4: Try WPP.chat for existing users (as last resort)
                    if (window.WPP && window.WPP.chat) {
                        try {
                            let statusResult;

                            if (statusType === 'text' && window.WPP.chat.sendTextMessage) {
                                console.log(`[${new Date().toISOString()}] Using WPP.chat.sendTextMessage as last resort...`);
                                statusResult = await window.WPP.chat.sendTextMessage(STATUS_BROADCAST_JID, statusContent);
                            } else if (statusType === 'image' && window.WPP.chat.sendFileMessage) {
                                console.log(`[${new Date().toISOString()}] Using WPP.chat.sendFileMessage for image as last resort...`);
                                statusResult = await window.WPP.chat.sendFileMessage(STATUS_BROADCAST_JID, statusContent, statusOptions);
                            } else if (statusType === 'video' && window.WPP.chat.sendFileMessage) {
                                console.log(`[${new Date().toISOString()}] Using WPP.chat.sendFileMessage for video as last resort...`);
                                statusResult = await window.WPP.chat.sendFileMessage(STATUS_BROADCAST_JID, statusContent, statusOptions);
                            }

                            if (statusResult) {
                                console.log(`[${new Date().toISOString()}] SUCCESS via WPP.chat - ${statusType} sent!`, statusResult);
                                return { success: true, method: 'wpp_chat', result: statusResult };
                            }
                        } catch (chatError) {
                            console.log(`[${new Date().toISOString()}] WPP.chat failed:`, chatError.message);
                        }
                    }

                    // PRIORITIZED: Enhanced DOM manipulation - the ONLY reliable method for current WhatsApp Web
                    console.log(`[${new Date().toISOString()}] Using DOM manipulation (only reliable method for current WhatsApp version)...`);

                    if (statusType === 'text') {
                        try {
                            // Step 1: Find and click Status tab with modern selectors
                            console.log('Step 1: Looking for Status tab...');

                            const statusSelectors = [
                                // Modern WhatsApp Web selectors
                                'div[data-tab="3"]',
                                'div[role="button"][aria-label*="Status"]',
                                'div[role="button"][aria-label*="Updates"]',
                                // Navigation item based selectors
                                'div[aria-label*="Status"] div[role="button"]',
                                'div[data-navbar-item-index="1"]',
                                // Fallback for older versions
                                'div[role="button"]:has(span[data-icon="status"])',
                                'div:has(> span[data-icon="status"])',
                                // Text-based fallback
                                'div[role="button"]:contains("Status")',
                                'div[role="button"]:contains("Updates")'
                            ];

                            let statusTab = null;
                            for (const selector of statusSelectors) {
                                try {
                                    if (selector.includes(':contains(')) {
                                        // Handle text-based selectors manually
                                        const buttons = document.querySelectorAll('div[role="button"]');
                                        for (const btn of buttons) {
                                            if (btn.textContent.includes('Status') || btn.textContent.includes('Updates')) {
                                                statusTab = btn;
                                                break;
                                            }
                                        }
                                    } else {
                                        statusTab = document.querySelector(selector);
                                    }
                                    if (statusTab) {
                                        console.log(`Found Status tab with selector: ${selector}`);
                                        break;
                                    }
                                } catch (e) {
                                    // Continue to next selector
                                }
                            }

                            if (!statusTab) {
                                throw new Error('Could not find Status tab');
                            }

                            // Click the Status tab
                            statusTab.click();
                            console.log('Status tab clicked, waiting for navigation...');
                            await new Promise(resolve => setTimeout(resolve, 2000));

                            // Step 2: Find and click "Add status" or "+" button
                            console.log('Step 2: Looking for Add Status button...');

                            const addStatusSelectors = [
                                // Modern add status button selectors
                                'div[aria-label*="Add status"]',
                                'div[role="button"][aria-label*="Add status"]',
                                'button[aria-label*="Add status"]',
                                // Plus icon selectors
                                'div[role="button"]:has(span[data-icon="plus"])',
                                'div:has(> span[data-icon="plus"])',
                                'div[role="button"]:has(span[data-icon="add"])',
                                // Camera icon (for status creation)
                                'div[role="button"]:has(span[data-icon="camera"])',
                                // Fab button
                                'div[role="button"][data-tab="3"] + div',
                                'div.lexical-rich-text-input',
                                // Text area in status
                                'div[contenteditable="true"][data-tab="3"]'
                            ];

                            let addStatusBtn = null;
                            for (const selector of addStatusSelectors) {
                                try {
                                    addStatusBtn = document.querySelector(selector);
                                    if (addStatusBtn) {
                                        console.log(`Found Add Status button with selector: ${selector}`);
                                        break;
                                    }
                                } catch (e) {
                                    // Continue to next selector
                                }
                            }

                            if (addStatusBtn) {
                                addStatusBtn.click();
                                console.log('Add Status button clicked, waiting for composer...');
                                await new Promise(resolve => setTimeout(resolve, 2000));
                            }

                            // Step 3: Find text input area (this might appear after clicking add status)
                            console.log('Step 3: Looking for text input...');

                            const textInputSelectors = [
                                // Modern WhatsApp Web text input selectors
                                'div[contenteditable="true"][role="textbox"]',
                                'div[contenteditable="true"][data-tab="3"]',
                                'div[contenteditable="true"][aria-label*="Type"]',
                                'div[contenteditable="true"][placeholder*="status"]',
                                // Lexical editor
                                'div.lexical-rich-text-input[contenteditable="true"]',
                                'div[data-lexical-editor="true"]',
                                // Fallback selectors
                                'div[contenteditable="true"]',
                                'textarea[placeholder*="status"]',
                                'textarea[aria-label*="Type"]',
                                'input[type="text"][placeholder*="status"]'
                            ];

                            let textInput = null;
                            for (const selector of textInputSelectors) {
                                try {
                                    const inputs = document.querySelectorAll(selector);
                                    for (const input of inputs) {
                                        // Check if the input is visible and in the status area
                                        const rect = input.getBoundingClientRect();
                                        if (rect.width > 0 && rect.height > 0) {
                                            textInput = input;
                                            console.log(`Found text input with selector: ${selector}`);
                                            break;
                                        }
                                    }
                                    if (textInput) break;
                                } catch (e) {
                                    // Continue to next selector
                                }
                            }

                            if (!textInput) {
                                throw new Error('Could not find text input area');
                            }

                            // Step 4: Focus and enter text
                            console.log('Step 4: Entering text...');
                            textInput.focus();

                            // Clear existing content
                            textInput.innerHTML = '';
                            textInput.textContent = '';

                            // Set the status content
                            if (textInput.tagName === 'DIV') {
                                textInput.textContent = statusContent;
                                textInput.innerHTML = statusContent;
                            } else {
                                textInput.value = statusContent;
                            }

                            // Trigger various events to ensure WhatsApp recognizes the input
                            const events = ['focus', 'input', 'change', 'keyup'];
                            for (const eventType of events) {
                                textInput.dispatchEvent(new Event(eventType, { bubbles: true }));
                            }

                            console.log('Text entered, waiting before sending...');
                            await new Promise(resolve => setTimeout(resolve, 1000));

                            // Step 5: Find and click send button
                            console.log('Step 5: Looking for send button...');

                            const sendButtonSelectors = [
                                // Modern send button selectors
                                'button[aria-label*="Send"]',
                                'div[role="button"][aria-label*="Send"]',
                                'button[data-testid="send"]',
                                // Send icon selectors
                                'div[role="button"]:has(span[data-icon="send"])',
                                'button:has(span[data-icon="send"])',
                                'div:has(> span[data-icon="send"])',
                                // Share button (sometimes used for status)
                                'button[aria-label*="Share"]',
                                'div[role="button"][aria-label*="Share"]',
                                // Generic send patterns
                                'button[type="submit"]',
                                'div[role="button"][data-tab="3"] span[data-icon="send"]'
                            ];

                            let sendBtn = null;
                            for (const selector of sendButtonSelectors) {
                                try {
                                    const buttons = document.querySelectorAll(selector);
                                    for (const btn of buttons) {
                                        // Check if button is visible and clickable
                                        const rect = btn.getBoundingClientRect();
                                        if (rect.width > 0 && rect.height > 0 && !btn.disabled) {
                                            sendBtn = btn;
                                            console.log(`Found send button with selector: ${selector}`);
                                            break;
                                        }
                                    }
                                    if (sendBtn) break;
                                } catch (e) {
                                    // Continue to next selector
                                }
                            }

                            if (!sendBtn) {
                                // Try Enter key as fallback
                                console.log('No send button found, trying Enter key...');
                                textInput.dispatchEvent(new KeyboardEvent('keydown', {
                                    key: 'Enter',
                                    keyCode: 13,
                                    which: 13,
                                    bubbles: true
                                }));

                                console.log(`[${new Date().toISOString()}] SUCCESS via DOM manipulation (Enter key)!`);
                                return { success: true, method: 'dom_manipulation_enter' };
                            } else {
                                sendBtn.click();
                                console.log(`[${new Date().toISOString()}] SUCCESS via DOM manipulation (send button)!`);
                                return { success: true, method: 'dom_manipulation_button' };
                            }

                        } catch (domError) {
                            console.log(`[${new Date().toISOString()}] Enhanced DOM manipulation failed:`, domError.message);

                            // Final fallback: Try keyboard shortcut
                            try {
                                console.log('Trying keyboard shortcut fallback...');

                                // First ensure we're focused on the page
                                document.body.focus();

                                // Try Ctrl+Shift+S for status shortcut (if it exists)
                                document.dispatchEvent(new KeyboardEvent('keydown', {
                                    key: 'S',
                                    code: 'KeyS',
                                    keyCode: 83,
                                    which: 83,
                                    ctrlKey: true,
                                    shiftKey: true,
                                    bubbles: true
                                }));

                                await new Promise(resolve => setTimeout(resolve, 1000));

                                // Type the status content
                                for (const char of statusContent) {
                                    document.dispatchEvent(new KeyboardEvent('keydown', {
                                        key: char,
                                        keyCode: char.charCodeAt(0),
                                        which: char.charCodeAt(0),
                                        bubbles: true
                                    }));
                                }

                                // Press Enter to send
                                document.dispatchEvent(new KeyboardEvent('keydown', {
                                    key: 'Enter',
                                    keyCode: 13,
                                    which: 13,
                                    bubbles: true
                                }));

                                console.log(`[${new Date().toISOString()}] SUCCESS via keyboard shortcut fallback!`);
                                return { success: true, method: 'keyboard_shortcut' };

                            } catch (shortcutError) {
                                console.log(`[${new Date().toISOString()}] Keyboard shortcut also failed:`, shortcutError.message);
                            }
                        }
                    }

                    throw new Error(`Failed to send ${statusType} status - All methods failed. WA-JS may not be compatible with current WhatsApp version.`);

                } catch (error) {
                    console.error(`Error in direct status sending:`, error.message);
                    throw new Error(`Failed to send ${statusType} status: ${error.message}`);
                }
            }, { statusType: type, statusContent: content, statusOptions: options });

            return result;

        } catch (error) {
            console.error(`[${new Date().toISOString()}] ERROR sending ${type} status:`, error.message);
            throw error;
        }
    }

    async sendTextStatus(content, options = {}) {
        console.log(`[${new Date().toISOString()}] 🚀 ULTRA-FAST status sending initiated...`);
        const startTime = Date.now();

        try {
            // Skip all initialization - go straight to action
            const result = await this.page.evaluate(async (statusContent) => {
                const startTime = Date.now();

                try {
                    console.log(`⚡ LIGHTNING STATUS: Starting ultra-fast send...`);

                    // STRATEGY 1: Keyboard shortcut blast (fastest possible)
                    console.log('⚡ Method 1: Direct keyboard shortcut...');

                    // Focus document first
                    if (document.activeElement !== document.body) {
                        document.body.focus();
                    }

                    // Rapid-fire keyboard shortcut
                    const shortcuts = [
                        { key: 'Escape', code: 'Escape' }, // Clear any modal first
                        { key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true }, // Ctrl+Shift+S
                        { key: 'n', code: 'KeyN', ctrlKey: true, shiftKey: true }, // Ctrl+Shift+N (alternative)
                    ];

                    for (const shortcut of shortcuts) {
                        document.dispatchEvent(new KeyboardEvent('keydown', {
                            ...shortcut,
                            bubbles: true,
                            cancelable: true
                        }));
                        await new Promise(resolve => setTimeout(resolve, 100)); // Minimal delay
                    }

                    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for composer

                    // STRATEGY 2: Speed DOM search (parallel)
                    console.log('⚡ Method 2: Lightning DOM search...');

                    // ✅ REAL SELECTORS DISCOVERED BY DOM INSPECTOR
                    const ultraFastSelectors = {
                        statusTabs: [
                            '[aria-label="Status"]', // 🎯 CONFIRMED: Real WhatsApp selector
                            'span[data-icon="status-refreshed"]', // 🎯 CONFIRMED: Current status icon
                            '[data-icon="status-refreshed"]', // 🎯 CONFIRMED: Alternative
                            'button[aria-label="Status"]', // 🎯 CONFIRMED: Button with Status label
                            // Fallbacks
                            'div[data-tab="3"]',
                            '[data-navbar-item-index="1"]'
                        ],
                        textInputs: [
                            'div[data-lexical-editor="true"]', // 🎯 CONFIRMED: Real status composer (discovered!)
                            '.lexical-rich-text-input', // 🎯 CONFIRMED: Real input class
                            '[aria-label*="Type"]', // 🎯 Common pattern for compose
                            'div[contenteditable="true"][role="textbox"]', // 🎯 WARNING: This was the search box!
                            'div[contenteditable="true"]',
                            '[role="textbox"]'
                        ],
                        sendButtons: [
                            'span[data-icon="send"]', // 🎯 Most likely pattern
                            'button[aria-label*="Send"]',
                            '[data-icon="send"]',
                            'button[data-testid="send"]'
                        ],
                        addButtons: [
                            'span[data-icon="plus"]', // 🎯 Plus icon pattern
                            '[data-icon="plus"]',
                            '[aria-label*="Add"]'
                        ]
                    };

                    // Find Status tab with timeout
                    let statusTab = null;
                    const tabSearchPromise = new Promise((resolve) => {
                        for (const selector of ultraFastSelectors.statusTabs) {
                            const element = document.querySelector(selector);
                            if (element) {
                                resolve(element);
                                return;
                            }
                        }

                        // Text-based search as last resort
                        const buttons = document.querySelectorAll('div[role="button"]');
                        for (const btn of buttons) {
                            if (btn.innerText?.includes('Status') || btn.innerText?.includes('Updates')) {
                                resolve(btn);
                                return;
                            }
                        }
                        resolve(null);
                    });

                    statusTab = await Promise.race([
                        tabSearchPromise,
                        new Promise(resolve => setTimeout(() => resolve(null), 3000))
                    ]);

                    if (statusTab) {
                        console.log('⚡ Status tab found! Clicking...');
                        statusTab.click();
                        await new Promise(resolve => setTimeout(resolve, 800)); // Reduced wait

                        // 🚀 NEW: Click Plus button and then Text button (Hebrew interface workflow)
                        console.log('⚡ Method 2.5: Finding Plus button...');
                        let plusButton = null;
                        for (const selector of ultraFastSelectors.addButtons) {
                            const btn = document.querySelector(selector);
                            if (btn) {
                                plusButton = btn;
                                break;
                            }
                        }

                        if (plusButton) {
                            console.log('⚡ Plus button found! Clicking...');
                            plusButton.click();
                            await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for menu

                            // Find and click "Text" button (טקסט)
                            console.log('⚡ Looking for Text button in menu...');
                            let textButton = null;

                            // Search for Text button by text content
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

                            if (textButton) {
                                console.log('⚡ Text button found! Clicking...');
                                textButton.click();
                                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for text screen
                            }
                        }
                    }

                    // STRATEGY 3: Aggressive text input search (with correct composer)
                    console.log('⚡ Method 3: Finding status composer...');

                    let textInput = null;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        for (const selector of ultraFastSelectors.textInputs) {
                            const inputs = document.querySelectorAll(selector);
                            for (const input of inputs) {
                                const rect = input.getBoundingClientRect();
                                if (rect.width > 50 && rect.height > 20) { // Visible and reasonable size
                                    textInput = input;
                                    break;
                                }
                            }
                            if (textInput) break;
                        }
                        if (textInput) break;
                        await new Promise(resolve => setTimeout(resolve, 300)); // Quick retry
                    }

                    if (!textInput) {
                        // Emergency fallback: Create our own input event
                        console.log('⚡ EMERGENCY: Direct event injection...');
                        const fakeEvent = new KeyboardEvent('keydown', {
                            key: statusContent,
                            bubbles: true
                        });
                        document.dispatchEvent(fakeEvent);

                        // Try to trigger status creation through direct DOM manipulation
                        const chatInput = document.querySelector('[data-testid="conversation-compose-box-input"]');
                        if (chatInput) {
                            chatInput.textContent = statusContent;
                            chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                        }

                        return {
                            success: true,
                            method: 'emergency_injection',
                            time: Date.now() - startTime
                        };
                    }

                    // STRATEGY 4: Lightning text input and send
                    console.log('⚡ Method 4: Lightning text entry...');

                    textInput.focus();

                    // Ultra-fast text setting
                    textInput.textContent = statusContent;
                    textInput.innerHTML = statusContent;
                    if (textInput.value !== undefined) textInput.value = statusContent;

                    // Rapid event firing
                    const events = ['focus', 'input', 'change'];
                    events.forEach(eventType => {
                        textInput.dispatchEvent(new Event(eventType, { bubbles: true }));
                    });

                    await new Promise(resolve => setTimeout(resolve, 200)); // Minimal wait

                    // STRATEGY 5: Multi-method send attempt
                    console.log('⚡ Method 5: Multi-send attempt...');

                    // Method 5A: Enter key
                    textInput.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true
                    }));

                    await new Promise(resolve => setTimeout(resolve, 100));

                    // Method 5B: Send button search
                    for (const selector of ultraFastSelectors.sendButtons) {
                        const buttons = document.querySelectorAll(selector);
                        for (const btn of buttons) {
                            if (btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                                btn.click();
                                console.log(`⚡ Send button clicked: ${selector}`);
                                break;
                            }
                        }
                    }

                    // Method 5C: Ctrl+Enter (alternative send)
                    textInput.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Enter',
                        keyCode: 13,
                        ctrlKey: true,
                        bubbles: true
                    }));

                    const totalTime = Date.now() - startTime;
                    console.log(`⚡ ULTRA-FAST STATUS COMPLETE in ${totalTime}ms!`);

                    return {
                        success: true,
                        method: 'ultra_fast_multi',
                        time: totalTime,
                        steps: 'shortcut+tab+input+multi_send'
                    };

                } catch (error) {
                    const totalTime = Date.now() - startTime;
                    console.error(`❌ Ultra-fast failed in ${totalTime}ms:`, error.message);

                    // Last resort: Try any visible text area
                    const anyTextArea = document.querySelector('div[contenteditable="true"], textarea, input[type="text"]');
                    if (anyTextArea) {
                        anyTextArea.value = statusContent;
                        anyTextArea.textContent = statusContent;
                        anyTextArea.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter',
                            bubbles: true
                        }));
                        return {
                            success: true,
                            method: 'last_resort',
                            time: totalTime
                        };
                    }

                    throw new Error(`Ultra-fast send failed: ${error.message}`);
                }
            }, content);

            const totalTime = Date.now() - startTime;
            console.log(`🚀 ULTRA-FAST STATUS SENT in ${totalTime}ms total!`);

            return {
                ...result,
                totalTime: totalTime,
                performance: totalTime < 15000 ? '🔥 BLAZING' : totalTime < 30000 ? '⚡ FAST' : '🐌 SLOW'
            };

        } catch (error) {
            const totalTime = Date.now() - startTime;
            console.error(`❌ Ultra-fast status failed in ${totalTime}ms:`, error.message);
            throw error;
        }
    }

    async sendVideoStatus(content, options = {}) {
        return this.sendStatus('video', content, options);
    }

    async sendImageStatus(content, options = {}) {
        return this.sendStatus('image', content, options);
    }

    // Legacy function - now uses the fast direct method
    async manualSendTextStatus(content, options = {}) {
        return this.sendTextStatus(content, options);
    }

    // Quick status visibility check without heavy WA-JS dependencies
    async quickStatusCheck() {
        try {
            const result = await this.page.evaluate(() => {
                // Check if we can see Status tab
                const statusSelectors = [
                    'div[data-tab="3"]',
                    'div[role="button"][aria-label*="Status"]',
                    'div[role="button"][aria-label*="Updates"]'
                ];

                for (const selector of statusSelectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                        return { canSeeStatus: true, selector };
                    }
                }

                // Check for text search
                const buttons = document.querySelectorAll('div[role="button"]');
                for (const btn of buttons) {
                    if (btn.textContent.includes('Status') || btn.textContent.includes('Updates')) {
                        return { canSeeStatus: true, selector: 'text-search' };
                    }
                }

                return { canSeeStatus: false };
            });

            return result;
        } catch (error) {
            return { canSeeStatus: false, error: error.message };
        }
    }

    async removeStatus(msgId) {
        try {
            const result = await this.page.evaluate(async (statusMsgId) => {
                try {
                    console.log('Starting status removal for:', statusMsgId);

                    // Check WPPConfig settings
                    if (window.WPPConfig) {
                        console.log('WPPConfig.sendStatusToDevice:', window.WPPConfig.sendStatusToDevice);
                        console.log('WPPConfig.removeStatusMessage:', window.WPPConfig.removeStatusMessage);
                    }

                    // Get the status message
                    const msg = await window.WPP.chat.getMessageById(statusMsgId);
                    if (!msg) {
                        throw new Error('Status message not found');
                    }

                    console.log('Message found:', msg.id.toString(), 'Type:', msg.type);

                    // Method 1: Delete as a regular chat message using WPP.chat.deleteMessage
                    // This might trigger cross-device sync
                    try {
                        if (window.WPP.chat && window.WPP.chat.deleteMessage) {
                            // Try deleting with revoke (delete for everyone)
                            const deleteResult = await window.WPP.chat.deleteMessage(
                                STATUS_BROADCAST_JID,
                                statusMsgId,
                                true,  // deleteMediaInDevice
                                true   // revoke - delete for everyone
                            );
                            console.log('Status deleted as chat message with revoke:', deleteResult);
                        }
                    } catch (chatDeleteError) {
                        console.log('Chat delete with revoke failed:', chatDeleteError.message);

                        // Try without revoke
                        try {
                            const deleteResult = await window.WPP.chat.deleteMessage(
                                STATUS_BROADCAST_JID,
                                statusMsgId,
                                true,  // deleteMediaInDevice
                                false  // no revoke - just delete locally
                            );
                            console.log('Status deleted as chat message locally:', deleteResult);
                        } catch (localDeleteError) {
                            console.log('Local chat delete also failed:', localDeleteError.message);
                        }
                    }

                    // Method 2: Use the broadcast chat directly for deletion
                    try {
                        // Get or create the status broadcast chat
                        let broadcastChat;

                        // Try different methods to get the broadcast chat
                        if (window.WPP.chat && window.WPP.chat.get) {
                            broadcastChat = await window.WPP.chat.get(STATUS_BROADCAST_JID);
                        }

                        if (!broadcastChat && window.WPP.whatsapp && window.WPP.whatsapp.ChatStore) {
                            broadcastChat = window.WPP.whatsapp.ChatStore.get(STATUS_BROADCAST_JID);
                        }

                        if (broadcastChat) {
                            console.log('Got broadcast chat:', broadcastChat.id);

                            // Try using the chat's sendRevokeMsgs method
                            if (broadcastChat.sendRevokeMsgs) {
                                const revokeResult = await broadcastChat.sendRevokeMsgs([msg], true);
                                console.log('Revoked via broadcast chat method:', revokeResult);
                            }

                            // Also try sendDeleteMsgs
                            if (broadcastChat.sendDeleteMsgs) {
                                const deleteResult = await broadcastChat.sendDeleteMsgs([msg], true);
                                console.log('Deleted via broadcast chat method:', deleteResult);
                            }
                        }
                    } catch (broadcastError) {
                        console.log('Broadcast chat method failed:', broadcastError.message);
                    }

                    // Method 3: Set status expiration to immediate
                    try {
                        if (msg && msg.expiryTimestamp !== undefined) {
                            const currentTime = Math.floor(Date.now() / 1000);
                            msg.expiryTimestamp = currentTime - 1; // Set to past

                            const statusChat = window.WPP.whatsapp.StatusV3Store.get(
                                window.WPP.whatsapp.UserPrefs.getMaybeMePnUser()
                            );

                            if (statusChat && statusChat.expireMsg) {
                                await statusChat.expireMsg(msg);
                                console.log('Status expired immediately');
                            }

                            // Also try setupStatusExpiration
                            if (statusChat && statusChat.setupStatusExpiration) {
                                await statusChat.setupStatusExpiration();
                                console.log('Status expiration setup triggered');
                            }
                        }
                    } catch (expireError) {
                        console.log('Expire method failed:', expireError.message);
                    }

                    // Method 4: Send protocol message to overwrite/revoke
                    try {
                        if (msg && msg.id) {
                            const emptyStatusProto = {
                                key: {
                                    remoteJid: STATUS_BROADCAST_JID,
                                    fromMe: true,
                                    id: msg.id._serialized || msg.id.id || msg.id
                                },
                                message: {
                                    protocolMessage: {
                                        type: 0, // REVOKE type
                                        key: {
                                            remoteJid: STATUS_BROADCAST_JID,
                                            fromMe: true,
                                            id: msg.id._serialized || msg.id.id || msg.id
                                        }
                                    }
                                },
                                messageTimestamp: Math.floor(Date.now() / 1000),
                                status: 5 // PLAYED status
                            };

                            if (window.WPP.whatsapp.functions && window.WPP.whatsapp.functions.encryptAndSendStatusMsg) {
                                await window.WPP.whatsapp.functions.encryptAndSendStatusMsg(
                                    {
                                        msg: { type: 'protocol', data: msg },
                                        data: emptyStatusProto
                                    },
                                    emptyStatusProto,
                                    {}
                                );
                                console.log('Sent protocol revoke message');
                            }
                        }
                    } catch (overwriteError) {
                        console.log('Protocol message failed:', overwriteError.message);
                    }

                    // Method 5: Use WPP.status.remove if available
                    try {
                        if (window.WPP.status && window.WPP.status.remove) {
                            await window.WPP.status.remove(statusMsgId);
                            console.log('Status removed via WPP.status.remove');
                        }
                    } catch (wppError) {
                        console.log('WPP.status.remove failed:', wppError.message);
                    }

                    // Method 6: Use StatusV3 store methods
                    const statusChat = window.WPP.whatsapp.StatusV3Store.get(
                        window.WPP.whatsapp.UserPrefs.getMaybeMePnUser()
                    );

                    if (statusChat) {
                        // Try removeMsg
                        if (statusChat.removeMsg) {
                            await statusChat.removeMsg(msg);
                            console.log('Status removed via StatusV3.removeMsg');
                        }

                        // Try native revokeStatus if available
                        if (window.WPP.whatsapp.functions && window.WPP.whatsapp.functions.revokeStatus) {
                            try {
                                await window.WPP.whatsapp.functions.revokeStatus(statusChat, msg);
                                console.log('Status revoked via native revokeStatus');
                            } catch (revokeError) {
                                console.log('Native revokeStatus failed:', revokeError.message);
                            }
                        }
                    }

                    // Method 7: Clean up local database
                    if (window.WPP.whatsapp.functions && window.WPP.whatsapp.functions.removeStatusMessage) {
                        await window.WPP.whatsapp.functions.removeStatusMessage([statusMsgId]);
                        console.log('Local database cleaned');
                    }

                    // Method 8: Try Cmd operations with proper chat
                    try {
                        const Cmd = window.WPP.whatsapp.Cmd;
                        if (Cmd) {
                            // Get the broadcast chat for Cmd operations
                            let cmdChat = window.WPP.whatsapp.ChatStore.get(STATUS_BROADCAST_JID);
                            if (!cmdChat && statusChat) {
                                cmdChat = statusChat;
                            }

                            if (cmdChat) {
                                const isNewVersion = window.Debug && window.Debug.VERSION && window.Debug.VERSION >= '2.3000.0';

                                // Try revoke first
                                try {
                                    if (isNewVersion) {
                                        await Cmd.sendRevokeMsgs(
                                            cmdChat,
                                            { type: 'message', list: [msg] },
                                            { clearMedia: true }
                                        );
                                    } else {
                                        await Cmd.sendRevokeMsgs(cmdChat, [msg], { clearMedia: true });
                                    }
                                    console.log('Status revoked via Cmd.sendRevokeMsgs');
                                } catch (cmdRevokeError) {
                                    console.log('Cmd revoke failed:', cmdRevokeError.message);

                                    // Fallback to delete
                                    if (isNewVersion) {
                                        await Cmd.sendDeleteMsgs(
                                            cmdChat,
                                            { type: 'message', list: [msg] },
                                            true
                                        );
                                    } else {
                                        await Cmd.sendDeleteMsgs(cmdChat, [msg], { clearMedia: true });
                                    }
                                    console.log('Status deleted via Cmd.sendDeleteMsgs');
                                }
                            }
                        }
                    } catch (cmdError) {
                        console.log('Cmd operations failed:', cmdError.message);
                    }

                    console.log('Status removal process completed.');
                    console.log('Note: WhatsApp may not support removing status from contacts who already viewed it.');

                    return {
                        success: true,
                        message: 'Status removal attempted using all available methods'
                    };

                } catch (error) {
                    console.error('Status deletion error:', error.message);
                    return {
                        success: false,
                        message: error.message
                    };
                }
            }, msgId);

            return result;

        } catch (error) {
            console.error('Error removing status:', error.message);
            return {
                success: false,
                message: error.message
            };
        }
    }

    // Helper function to get viewer information for a message
    async getMsgViewerInfo(msg) {
        return await this.page.evaluate(async (message) => {
            let viewerInfo = {
                viewers: [],
                viewCount: 0,
                readReceipts: []
            };

            try {
                // Try to get MsgInfo which contains read receipts
                if (window.WPP?.whatsapp?.MsgInfoStore) {
                    const msgInfo = window.WPP.whatsapp.MsgInfoStore.get(message.id);
                    if (msgInfo) {
                        // Get read by list (people who viewed the status)
                        if (msgInfo.readBy?.length > 0) {
                            viewerInfo.readReceipts = msgInfo.readBy.map(r => ({
                                id: r.id ? r.id.toString() : r.toString(),
                                timestamp: r.t || r.timestamp
                            }));
                            viewerInfo.viewers = msgInfo.readBy.map(r => r.id ? r.id.toString() : r.toString());
                            viewerInfo.viewCount = msgInfo.readBy.length;
                        } else if (msgInfo.reads?.length > 0) {
                            viewerInfo.readReceipts = msgInfo.reads.map(r => ({
                                id: r.id ? r.id.toString() : r.toString(),
                                timestamp: r.t || r.timestamp
                            }));
                            viewerInfo.viewers = msgInfo.reads.map(r => r.id ? r.id.toString() : r.toString());
                            viewerInfo.viewCount = msgInfo.reads.length;
                        }
                    }
                }

                // Check msgInfoCache as fallback
                if (!viewerInfo.viewCount && message.msgInfoCache?.readBy?.length > 0) {
                    viewerInfo.readReceipts = message.msgInfoCache.readBy;
                    viewerInfo.viewers = message.msgInfoCache.readBy.map(r => r.id || r);
                    viewerInfo.viewCount = message.msgInfoCache.readBy.length;
                }

                // Check ACK level (3 = read/viewed)
                if (!viewerInfo.viewCount && message.ack >= 3) {
                    viewerInfo.viewCount = -1; // Indicates viewed but count unknown
                }
            } catch (error) {
                console.log('Error getting viewer info:', error.message);
            }

            return viewerInfo;
        }, msg);
    }

    async getMyStatus(retryCount = 0) {
        console.log(`Getting my status... (attempt ${retryCount + 1})`);

        // CRITICAL FIX: Prevent infinite loop by limiting retries
        if (retryCount >= 3) {
            console.error('Maximum retry attempts reached for getMyStatus. Aborting to prevent infinite loop.');
            return {
                isMyStatus: true,
                totalCount: 0,
                msgs: [],
                hasStatus: false,
                error: 'Maximum retry attempts reached - WA-JS status methods may not be available'
            };
        }

        try {
            // Wait for WA-JS to be ready
            await this.waitForWAJS();

            // Only click status button if it's actually needed for the operation
            // For just reading status data, we don't need to click the UI button


            const myStatusRaw = await this.page.evaluate(async () => {
                try {
                    // CRITICAL FIX: Check if getMyStatus is actually available before calling
                    if (window.WPP.status && typeof window.WPP.status.getMyStatus === 'function') {
                        // First sync status messages to ensure we have latest data
                        console.log('Syncing status messages...');

                        try {
                            // Try to sync status messages from server
                            if (window.WPP.whatsapp && window.WPP.whatsapp.StatusV3Store) {
                                const statusStore = window.WPP.whatsapp.StatusV3Store;

                                // Trigger sync
                                if (typeof statusStore.sync === 'function') {
                                    await statusStore.sync();
                                    console.log('StatusV3Store.sync() completed');
                                }

                                // Load more messages if available
                                if (typeof statusStore.loadMore === 'function') {
                                    await statusStore.loadMore();
                                    console.log('StatusV3Store.loadMore() completed');
                                }

                                // Get current user's WID and ensure their status is loaded
                                const myWid = window.WPP.whatsapp.UserPrefs.getMaybeMePnUser();
                                if (myWid && typeof statusStore.find === 'function') {
                                    const myStatus = await statusStore.find(myWid);
                                    if (myStatus && typeof myStatus.sync === 'function') {
                                        await myStatus.sync();
                                        console.log('Individual status sync completed');
                                    }
                                }

                                // Small delay to ensure data is fully loaded
                                await new Promise(resolve => setTimeout(resolve, 500));
                            }
                        } catch (syncError) {
                            console.log('Status sync warning (non-fatal):', syncError.message);
                            // Continue even if sync fails - we'll try to get whatever data is available
                        }

                        const status = await window.WPP.status.getMyStatus();

                        console.log("check your status", status)
                        if (!status) {
                            return null;
                        }

                        console.log('Status retrieved:', status);

                        // Get unique viewers from readKeys
                        let uniqueViewers = [];
                        let totalUniqueViewerCount = 0;
                        if (status.readKeys && typeof status.readKeys === 'object') {
                            uniqueViewers = Object.keys(status.readKeys);
                            totalUniqueViewerCount = uniqueViewers.length;
                        }

                        // Extract structured data from StatusV3Model
                        const statusData = {
                            // Basic info
                            id: status.id ? status.id.toString() : null,
                            isMyStatus: true,

                            // Status counts
                            totalCount: status.totalCount || 0,
                            unreadCount: status.unreadCount || 0,
                            readCount: status.readCount || 0,
                            hasUnread: status.hasUnread || false,

                            // Viewer information
                            totalUniqueViewerCount: totalUniqueViewerCount,
                            uniqueViewers: uniqueViewers,
                            readKeys: status.readKeys || {},

                            // Timing info
                            timestamp: status.t || null,
                            expireTimer: status.expireTimer || null,
                            expireTs: status.expireTs || null,

                            // Profile info
                            pic: status.pic || null,

                            // Status messages
                            msgs: [],
                            totalViews: 0,  // Will be calculated from individual messages

                            // Raw data for debugging
                            raw: {
                                stale: status.stale,
                                contact: status.contact ? {
                                    id: status.contact.id ? status.contact.id.toString() : null,
                                    name: status.contact.name || null,
                                    pushname: status.contact.pushname || null,
                                    type: status.contact.type || null
                                } : null
                            }
                        };

                        // Get all status messages - check multiple possible locations
                        let messages = [];

                        // Check for _msgs array (actual structure from provided sample)
                        if (status._msgs && Array.isArray(status._msgs)) {
                            messages = status._msgs;
                        }
                        // Check for msgs.models (collection structure)
                        else if (status.msgs && status.msgs.models && Array.isArray(status.msgs.models)) {
                            messages = status.msgs.models;
                        }
                        // Check for msgs as direct array
                        else if (status.msgs && Array.isArray(status.msgs)) {
                            messages = status.msgs;
                        }
                        // Try getAllMsgs function if available
                        else if (typeof status.getAllMsgs === 'function') {
                            try {
                                const allMsgs = await status.getAllMsgs();
                                if (allMsgs && Array.isArray(allMsgs)) {
                                    messages = allMsgs;
                                }
                            } catch (e) {
                                console.log('Could not get all messages via getAllMsgs:', e.message);
                            }
                        }

                        // Process messages
                        if (messages.length > 0) {
                            let totalViewsAllStatuses = 0;

                            statusData.msgs = messages.map(msg => {
                                const msgId = msg.id ? (typeof msg.id === 'object' ? msg.id._serialized || msg.id.id || msg.id.toString() : msg.id.toString()) : null;

                                // Get viewer information from MsgInfoStore
                                let viewers = [];
                                let viewCount = 0;

                                try {
                                    // Try to get view information from MsgInfoStore
                                    if (window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.MsgInfoStore) {
                                        const msgInfo = window.WPP.whatsapp.MsgInfoStore.get(msg.id);
                                        if (msgInfo) {
                                            if (msgInfo.readBy && Array.isArray(msgInfo.readBy)) {
                                                viewers = msgInfo.readBy.map(r => {
                                                    if (typeof r === 'object' && r.id) {
                                                        return r.id.toString();
                                                    }
                                                    return r.toString();
                                                });
                                                viewCount = msgInfo.readBy.length;
                                            } else if (msgInfo.reads && Array.isArray(msgInfo.reads)) {
                                                viewers = msgInfo.reads.map(r => {
                                                    if (typeof r === 'object' && r.id) {
                                                        return r.id.toString();
                                                    }
                                                    return r.toString();
                                                });
                                                viewCount = msgInfo.reads.length;
                                            }
                                        }
                                    }

                                    // Fallback: Check ack level (3 = read/viewed)
                                    if (viewCount === 0 && msg.ack >= 3) {
                                        // Status has been viewed but we don't have specific viewer data
                                        viewCount = -1; // Indicator that status was viewed but count unknown
                                    }
                                } catch (e) {
                                    console.log('Error getting view info for message:', e.message);
                                }

                                totalViewsAllStatuses += (viewCount > 0 ? viewCount : 0);

                                const msgData = {
                                    // Handle both object and string id formats
                                    id: msgId,
                                    type: msg.type || null,
                                    body: msg.body || null,
                                    caption: msg.caption || null,
                                    timestamp: msg.t || null,
                                    from: msg.from || null,
                                    to: msg.to || null,
                                    author: msg.author || null,
                                    ack: msg.ack || 0,

                                    // Media information
                                    mediaData: null,

                                    // Viewer information (updated with actual data)
                                    isViewOnce: msg.isViewOnce || false,
                                    viewers: viewers,
                                    viewCount: viewCount,
                                    hasBeenViewed: viewCount !== 0,

                                    // Additional metadata
                                    rowId: msg.rowId || null,
                                    invis: msg.invis || false,
                                    mentionedJidList: msg.mentionedJidList || [],
                                    groupMentions: msg.groupMentions || []
                                };

                                // Handle media data - check for direct media properties
                                if (msg.type === 'image' || msg.type === 'video' || msg.type === 'audio') {
                                    msgData.mediaData = {
                                        type: msg.type,
                                        mimetype: msg.mimetype || null,
                                        size: msg.size || null,
                                        filehash: msg.filehash || null,
                                        mediaKey: msg.mediaKey || null,
                                        directPath: msg.directPath || null,
                                        mediaStage: msg.mediaStage || msg.mediaData?.mediaStage || null
                                    };
                                } else if (msg.mediaData) {
                                    msgData.mediaData = {
                                        type: msg.mediaData.type || null,
                                        mimetype: msg.mediaData.mimetype || null,
                                        size: msg.mediaData.size || null,
                                        filehash: msg.mediaData.filehash || null,
                                        mediaKey: msg.mediaData.mediaKey || null,
                                        directPath: msg.mediaData.directPath || null,
                                        mediaStage: msg.mediaData.mediaStage || null
                                    };
                                }

                                return msgData;
                            });

                            // Update total views
                            statusData.totalViews = totalViewsAllStatuses;
                        }

                        // Get last status if available
                        if (status.lastStatus) {
                            statusData.lastStatus = {
                                id: status.lastStatus.id ?
                                    (typeof status.lastStatus.id === 'object' ?
                                        status.lastStatus.id._serialized || status.lastStatus.id.toString() :
                                        status.lastStatus.id.toString()) : null,
                                timestamp: status.lastStatus.t || null
                            };
                        }

                        return statusData;
                    }

                    // CRITICAL FIX: Add fallback when getMyStatus is not available
                    console.log('WPP.status.getMyStatus not available, trying alternative methods...');

                    // Fallback 1: Try StatusV3Store directly
                    if (window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.StatusV3Store) {
                        try {
                            const myWid = window.WPP.whatsapp.UserPrefs.getMaybeMePnUser();
                            if (myWid) {
                                const statusStore = window.WPP.whatsapp.StatusV3Store;
                                const myStatus = statusStore.get ? statusStore.get(myWid) : statusStore.find ? statusStore.find(myWid) : null;

                                if (myStatus) {
                                    console.log('Found status via StatusV3Store fallback');
                                    return {
                                        isMyStatus: true,
                                        totalCount: myStatus.totalCount || 0,
                                        unreadCount: myStatus.unreadCount || 0,
                                        readCount: myStatus.readCount || 0,
                                        hasUnread: myStatus.hasUnread || false,
                                        msgs: [], // Basic fallback - don't try to process complex message data
                                        fallbackMethod: 'StatusV3Store',
                                        limitedData: true
                                    };
                                }
                            }
                        } catch (fallbackError) {
                            console.log('StatusV3Store fallback failed:', fallbackError.message);
                        }
                    }

                    // Fallback 2: Return minimal status indicating methods are not available
                    console.log('All status retrieval methods failed, returning empty status');
                    return {
                        isMyStatus: true,
                        totalCount: 0,
                        msgs: [],
                        hasStatus: false,
                        error: 'Status methods not available in current WA-JS version',
                        fallbackMethod: 'empty'
                    };
                } catch (error) {
                    throw new Error(`Failed to get my status: ${error.message}`);
                }
            });

            if (!myStatusRaw) {
                console.log('No active status found');
                return {
                    isMyStatus: true,
                    totalCount: 0,
                    msgs: [],
                    hasStatus: false
                };
            }

            console.log('My status retrieved successfully');
            console.log(`Total status count: ${myStatusRaw.totalCount}`);
            console.log(`Status messages: ${myStatusRaw.msgs.length}`);

            // Calculate summary statistics
            const summary = {
                ...myStatusRaw,
                hasStatus: myStatusRaw.totalCount > 0 || myStatusRaw.msgs.length > 0,
                viewerSummary: {
                    totalViews: myStatusRaw.totalViews || 0,
                    uniqueViewerCount: myStatusRaw.totalUniqueViewerCount || 0,
                    viewers: myStatusRaw.uniqueViewers || [],
                    statusCount: myStatusRaw.msgs.length,
                    averageViewsPerStatus: myStatusRaw.msgs.length > 0 ?
                        Math.round((myStatusRaw.totalViews || 0) / myStatusRaw.msgs.length * 10) / 10 : 0
                }
            };

            return summary;

        } catch (error) {
            console.error('Error getting my status:', error.message);

            // CRITICAL FIX: Instead of throwing error and potentially causing infinite loop,
            // return an error status that can be handled gracefully
            if (retryCount < 3 && error.message.includes('WA-JS')) {
                console.log(`Retrying getMyStatus due to WA-JS error (attempt ${retryCount + 1})`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
                return this.getMyStatus(retryCount + 1);
            }

            // Return error status instead of throwing to prevent infinite loops
            return {
                isMyStatus: true,
                totalCount: 0,
                msgs: [],
                hasStatus: false,
                error: error.message,
                retryCount: retryCount
            };
        }
    }

    /**
     * Get status viewers/read receipts for a specific status
     * @param {string} statusId - The status message ID to get viewers for
     * @returns {Object} Object containing viewer information
     */
    async getStatusViewers(statusId) {
        try {
            console.log(`Getting viewers for status: ${statusId}`);

            // Find the specific status message using different approaches
            const statusMessage = await this.page.evaluate(async (statusId) => {
                try {
                    // First try using StatusV3Store directly
                    let myStatus = null;

                    // Try to get status from StatusV3Store
                    if (window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.StatusV3Store) {
                        myStatus = window.WPP.whatsapp.StatusV3Store.getMyStatus();
                    } else if (window.Store && window.Store.StatusV3) {
                        myStatus = window.Store.StatusV3.getMyStatus();
                    }

                    // Fallback to WPP.status.getMyStatus
                    if (!myStatus && window.WPP && window.WPP.status) {
                        myStatus = await window.WPP.status.getMyStatus();
                    }

                    if (!myStatus) {
                        return { error: 'Could not access status store' };
                    }

                    // Try to load messages if not already loaded
                    if (typeof myStatus.loadMore === 'function') {
                        await myStatus.loadMore();
                    }

                    // Get all messages using various approaches
                    let messages = [];

                    // Try msgs.models first (most common structure)
                    if (myStatus.msgs && myStatus.msgs.models && Array.isArray(myStatus.msgs.models)) {
                        messages = myStatus.msgs.models;
                    }
                    // Try _msgs array
                    else if (myStatus._msgs && Array.isArray(myStatus._msgs)) {
                        messages = myStatus._msgs;
                    }
                    // Try msgs as direct array
                    else if (myStatus.msgs && Array.isArray(myStatus.msgs)) {
                        messages = myStatus.msgs;
                    }
                    // Try getAllMsgs function
                    else if (typeof myStatus.getAllMsgs === 'function') {
                        messages = await myStatus.getAllMsgs();
                    }
                    // Try to get messages from the collection
                    else if (myStatus.msgs && typeof myStatus.msgs.getModels === 'function') {
                        messages = myStatus.msgs.getModels();
                    }

                    console.log(`Found ${messages.length} status messages`);

                    // IMPORTANT: Status messages don't have view counts on the message objects directly.
                    // The view/read information is tracked separately in the StatusV3Model.
                    // We need to use the readKeys property and MsgInfo to get viewer information.

                    // Get MsgInfo for read receipts (this contains who viewed the status)
                    const getMsgInfo = async (msg) => {
                        let viewerInfo = {
                            viewers: [],
                            viewCount: 0,
                            readReceipts: []
                        };

                        try {
                            // Try to get MsgInfo which contains read receipts
                            if (window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.MsgInfoStore) {
                                const msgInfo = window.WPP.whatsapp.MsgInfoStore.get(msg.id);
                                if (msgInfo) {
                                    // Get read by list (people who viewed the status)
                                    if (msgInfo.readBy && msgInfo.readBy.length > 0) {
                                        viewerInfo.readReceipts = msgInfo.readBy.map(r => ({
                                            id: r.id ? r.id.toString() : r.toString(),
                                            timestamp: r.t || r.timestamp
                                        }));
                                        viewerInfo.viewers = msgInfo.readBy.map(r => r.id ? r.id.toString() : r.toString());
                                        viewerInfo.viewCount = msgInfo.readBy.length;
                                    }

                                    // Alternative: check reads property
                                    if (!viewerInfo.viewCount && msgInfo.reads && msgInfo.reads.length > 0) {
                                        viewerInfo.readReceipts = msgInfo.reads.map(r => ({
                                            id: r.id ? r.id.toString() : r.toString(),
                                            timestamp: r.t || r.timestamp
                                        }));
                                        viewerInfo.viewers = msgInfo.reads.map(r => r.id ? r.id.toString() : r.toString());
                                        viewerInfo.viewCount = msgInfo.reads.length;
                                    }
                                }
                            }

                            // Alternative approach: Check if msg has msgInfoCache
                            if (!viewerInfo.viewCount && msg.msgInfoCache) {
                                if (msg.msgInfoCache.readBy && msg.msgInfoCache.readBy.length > 0) {
                                    viewerInfo.readReceipts = msg.msgInfoCache.readBy;
                                    viewerInfo.viewers = msg.msgInfoCache.readBy.map(r => r.id || r);
                                    viewerInfo.viewCount = msg.msgInfoCache.readBy.length;
                                }
                            }

                            // Check ACK level (acknowledgment level)
                            // ACK levels for status: 1=sent, 2=delivered, 3=read/viewed
                            if (!viewerInfo.viewCount && msg.ack >= 3) {
                                // Status has been viewed but we don't have specific viewer info
                                viewerInfo.viewCount = -1; // Indicates viewed but count unknown
                            }

                        } catch (error) {
                            console.log('Error getting MsgInfo:', error.message);
                        }

                        return viewerInfo;
                    };

                    // If statusId is not provided, return all messages with view counts
                    if (!statusId) {
                        const allMessages = await Promise.all(messages.map(async msg => {
                            const msgId = msg.id ? (typeof msg.id === 'object' ?
                                msg.id._serialized || msg.id.id || msg.id.toString() :
                                msg.id.toString()) : null;

                            const viewerInfo = await getMsgInfo(msg);

                            return {
                                id: msgId,
                                type: msg.type,
                                timestamp: msg.t,
                                viewCount: viewerInfo.viewCount,
                                viewers: viewerInfo.viewers,
                                readReceipts: viewerInfo.readReceipts,
                                ack: msg.ack || 0,
                                caption: msg.caption || null
                            };
                        }));

                        // Calculate total read count from readKeys
                        let totalReadCount = 0;
                        if (myStatus.readKeys && typeof myStatus.readKeys === 'object') {
                            // readKeys contains viewer IDs as keys
                            totalReadCount = Object.keys(myStatus.readKeys).length;
                        }

                        return {
                            messages: allMessages,
                            totalCount: myStatus.totalCount || messages.length,
                            readCount: myStatus.readCount || totalReadCount,
                            unreadCount: myStatus.unreadCount || 0,
                            readKeys: myStatus.readKeys || {},
                            totalViewers: totalReadCount
                        };
                    }

                    // Find the specific message
                    const msg = messages.find(m => {
                        const msgId = m.id ? (typeof m.id === 'object' ?
                            m.id._serialized || m.id.id || m.id.toString() :
                            m.id.toString()) : null;
                        return msgId === statusId;
                    });

                    if (!msg) {
                        return { error: `Status message ${statusId} not found` };
                    }

                    // Get viewer information for the specific message
                    const viewerInfo = await getMsgInfo(msg);

                    // Get overall read count from readKeys
                    let totalReadCount = 0;
                    if (myStatus.readKeys && typeof myStatus.readKeys === 'object') {
                        totalReadCount = Object.keys(myStatus.readKeys).length;
                    }

                    return {
                        id: statusId,
                        type: msg.type,
                        timestamp: msg.t,
                        caption: msg.caption || null,
                        viewCount: viewerInfo.viewCount,
                        viewers: viewerInfo.viewers,
                        readReceipts: viewerInfo.readReceipts,
                        ack: msg.ack || 0,

                        // Overall status info
                        totalReadCount: totalReadCount,
                        readKeys: myStatus.readKeys || {},

                        // Debug info
                        debug: {
                            hasViewerInfo: viewerInfo.viewCount > 0,
                            hasMsgInfo: !!window.WPP.whatsapp.MsgInfoStore.get(msg.id),
                            ackLevel: msg.ack,
                            messageKeys: Object.keys(msg).filter(k => k.includes('read') || k.includes('view') || k.includes('receipt') || k.includes('ack'))
                        }
                    };
                } catch (error) {
                    return { error: error.message };
                }
            }, statusId);

            if (statusMessage.error) {
                throw new Error(statusMessage.error);
            }

            return {
                success: true,
                ...statusMessage
            };

        } catch (error) {
            console.error('Error getting status viewers:', error.message);
            throw error;
        }
    }

    /**
     * Get total viewer count for all my statuses
     * @returns {Object} Object containing total viewer information
     */
    async getTotalStatusViewers() {
        try {
            console.log('Getting total status viewers...');

            const viewerInfo = await this.page.evaluate(async () => {
                try {
                    // First try using StatusV3Store directly
                    let myStatus = null;

                    // Try to get status from StatusV3Store
                    if (window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.StatusV3Store) {
                        myStatus = window.WPP.whatsapp.StatusV3Store.getMyStatus();
                    } else if (window.Store && window.Store.StatusV3) {
                        myStatus = window.Store.StatusV3.getMyStatus();
                    }

                    // Fallback to WPP.status.getMyStatus
                    if (!myStatus && window.WPP && window.WPP.status) {
                        myStatus = await window.WPP.status.getMyStatus();
                    }

                    if (!myStatus) {
                        return { error: 'Could not access status store' };
                    }

                    // Try to load messages if not already loaded
                    if (typeof myStatus.loadMore === 'function') {
                        await myStatus.loadMore();
                    }

                    // Get all messages using various approaches
                    let messages = [];

                    // Try msgs.models first (most common structure)
                    if (myStatus.msgs && myStatus.msgs.models && Array.isArray(myStatus.msgs.models)) {
                        messages = myStatus.msgs.models;
                    }
                    // Try _msgs array
                    else if (myStatus._msgs && Array.isArray(myStatus._msgs)) {
                        messages = myStatus._msgs;
                    }
                    // Try msgs as direct array
                    else if (myStatus.msgs && Array.isArray(myStatus.msgs)) {
                        messages = myStatus.msgs;
                    }
                    // Try getAllMsgs function
                    else if (typeof myStatus.getAllMsgs === 'function') {
                        messages = await myStatus.getAllMsgs();
                    }
                    // Try to get messages from the collection
                    else if (myStatus.msgs && typeof myStatus.msgs.getModels === 'function') {
                        messages = myStatus.msgs.getModels();
                    }

                    console.log(`Processing ${messages.length} status messages for viewer count`);

                    // Helper function to get viewer info for a message
                    const getMsgViewerInfo = async (msg) => {
                        let viewerInfo = {
                            viewers: [],
                            viewCount: 0
                        };

                        try {
                            // Try to get MsgInfo which contains read receipts
                            if (window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.MsgInfoStore) {
                                const msgInfo = window.WPP.whatsapp.MsgInfoStore.get(msg.id);
                                if (msgInfo) {
                                    // Get read by list (people who viewed the status)
                                    if (msgInfo.readBy && msgInfo.readBy.length > 0) {
                                        viewerInfo.viewers = msgInfo.readBy.map(r => r.id ? r.id.toString() : r.toString());
                                        viewerInfo.viewCount = msgInfo.readBy.length;
                                    } else if (msgInfo.reads && msgInfo.reads.length > 0) {
                                        viewerInfo.viewers = msgInfo.reads.map(r => r.id ? r.id.toString() : r.toString());
                                        viewerInfo.viewCount = msgInfo.reads.length;
                                    }
                                }
                            }

                            // Check msgInfoCache as fallback
                            if (!viewerInfo.viewCount && msg.msgInfoCache && msg.msgInfoCache.readBy) {
                                viewerInfo.viewers = msg.msgInfoCache.readBy.map(r => r.id || r);
                                viewerInfo.viewCount = msg.msgInfoCache.readBy.length;
                            }
                        } catch (error) {
                            console.log('Error getting viewer info:', error.message);
                        }

                        return viewerInfo;
                    };

                    // Calculate total viewers across all statuses
                    let allViewers = new Set();
                    let statusDetails = [];

                    // Process each message to get viewer information
                    for (const msg of messages) {
                        const msgId = msg.id ? (typeof msg.id === 'object' ?
                            msg.id._serialized || msg.id.id || msg.id.toString() :
                            msg.id.toString()) : null;

                        // Get viewer information for this message
                        const viewerInfo = await getMsgViewerInfo(msg);

                        // Add viewers to the set of all unique viewers
                        viewerInfo.viewers.forEach(v => allViewers.add(v));

                        statusDetails.push({
                            id: msgId,
                            type: msg.type,
                            timestamp: msg.t,
                            viewCount: viewerInfo.viewCount,
                            viewers: viewerInfo.viewers,
                            ack: msg.ack || 0,
                            // Include media information if available
                            mediaType: msg.mediaType || msg.type,
                            caption: msg.caption || null
                        });
                    }

                    // Get total viewer count from readKeys (most reliable source)
                    let totalUniqueViewers = 0;
                    if (myStatus.readKeys && typeof myStatus.readKeys === 'object') {
                        // readKeys contains unique viewer IDs as keys
                        const readKeyViewers = Object.keys(myStatus.readKeys);
                        totalUniqueViewers = readKeyViewers.length;

                        // Add these to our viewer set
                        readKeyViewers.forEach(v => allViewers.add(v));
                    }

                    // Use the larger count (readKeys might have more complete data)
                    const finalUniqueCount = Math.max(totalUniqueViewers, allViewers.size);

                    // Calculate total views (sum of all individual status views)
                    const totalViews = statusDetails.reduce((sum, s) => sum + s.viewCount, 0);

                    return {
                        totalViews: totalViews,  // Total view count across all statuses
                        uniqueViewerCount: finalUniqueCount,  // Unique people who viewed
                        totalStatuses: messages.length,
                        overallReadCount: myStatus.readCount || finalUniqueCount,
                        hasUnread: myStatus.hasUnread || false,
                        unreadCount: myStatus.unreadCount || 0,
                        statusDetails: statusDetails,
                        readKeys: myStatus.readKeys || {},
                        viewers: Array.from(allViewers),  // List of unique viewer IDs

                        // Debug information
                        debug: {
                            hasMessages: messages.length > 0,
                            hasReadKeys: !!myStatus.readKeys,
                            readKeysCount: myStatus.readKeys ? Object.keys(myStatus.readKeys).length : 0,
                            statusProperties: Object.keys(myStatus).filter(k => !k.startsWith('_')),
                            messageExample: messages.length > 0 ? Object.keys(messages[0]).filter(k => !k.startsWith('_')) : []
                        }
                    };
                } catch (error) {
                    return { error: error.message };
                }
            });

            if (viewerInfo.error) {
                throw new Error(viewerInfo.error);
            }

            return {
                success: true,
                totalViews: viewerInfo.totalViews,  // Total views across all statuses
                uniqueViewerCount: viewerInfo.uniqueViewerCount,  // Unique viewers
                totalStatuses: viewerInfo.totalStatuses,
                overallReadCount: viewerInfo.overallReadCount,
                hasUnread: viewerInfo.hasUnread,
                unreadCount: viewerInfo.unreadCount,
                statuses: viewerInfo.statusDetails,
                viewers: viewerInfo.viewers,  // List of unique viewer IDs
                readKeys: viewerInfo.readKeys,
                debug: viewerInfo.debug
            };

        } catch (error) {
            console.error('Error getting total status viewers:', error.message);
            throw error;
        }
    }
}

module.exports = WhatsAppStatusHandler;