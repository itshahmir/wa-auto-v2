class SmartStatusHandler {
    constructor(page, sessionId) {
        this.page = page;
        this.sessionId = sessionId;
        this.initialized = false;
        this.cachedElements = {};
    }

    async initialize() {
        if (this.initialized) return;
        console.log(`[${this.sessionId}] Initializing smart status handler...`);

        // Wait for WhatsApp to be loaded
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(3000);

        // Try to access WhatsApp's internal Store API
        const hasStore = await this.page.evaluate(() => {
            return typeof window.Store !== 'undefined' && window.Store.StatusV3;
        });

        if (hasStore) {
            console.log(`[${this.sessionId}] ✅ WhatsApp Store API available`);
        } else {
            console.log(`[${this.sessionId}] ⚠️ Store API not found, will use DOM fallback`);
        }

        this.initialized = true;
        console.log(`[${this.sessionId}] Smart status handler ready`);
    }

    async sendTextStatus(content, options = {}) {
        console.log(`[${this.sessionId}] 🧠 SMART: Sending text status: "${content}"`);

        try {
            // Method 1: Try WhatsApp's internal Store API first (fastest and most reliable)
            console.log(`[${this.sessionId}] 🔍 Trying Store API method...`);
            const storeResult = await this.page.evaluate(async (content) => {
                if (window.Store && window.Store.StatusV3) {
                    try {
                        console.log('Using Store.StatusV3 for status sending...');

                        // Try different Store methods
                        if (window.Store.StatusV3.sendTextStatus) {
                            const result = await window.Store.StatusV3.sendTextStatus(content);
                            return { success: true, method: 'StatusV3.sendTextStatus', result };
                        }

                        if (window.Store.StatusV3.sendMessage) {
                            const statusMsg = {
                                type: 'text',
                                body: content,
                                isViewOnce: false
                            };
                            const result = await window.Store.StatusV3.sendMessage(statusMsg);
                            return { success: true, method: 'StatusV3.sendMessage', result };
                        }

                        // Try Chat API with status JID
                        if (window.Store.Chat && window.Store.Chat.sendMessage) {
                            const statusJid = 'status@broadcast';
                            const message = {
                                body: content,
                                type: 'chat',
                                isViewOnce: false
                            };
                            const result = await window.Store.Chat.sendMessage(statusJid, message);
                            return { success: true, method: 'Chat.sendMessage', result };
                        }

                        return { success: false, error: 'No suitable Store methods found' };
                    } catch (error) {
                        return { success: false, error: error.message };
                    }
                }
                return { success: false, error: 'Store API not available' };
            }, content);

            if (storeResult.success) {
                console.log(`[${this.sessionId}] ✅ Status sent via Store API (${storeResult.method})`);
                return storeResult;
            } else {
                console.log(`[${this.sessionId}] ⚠️ Store API failed: ${storeResult.error}`);
            }

            // Method 2: Enhanced DOM manipulation with Hebrew support
            console.log(`[${this.sessionId}] 🔍 Trying enhanced DOM method...`);
            return await this.sendTextStatusViaDOM(content);

        } catch (error) {
            console.error(`[${this.sessionId}] ❌ Error in smart status sending:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async sendTextStatusViaDOM(content) {
        console.log(`[${this.sessionId}] 🎯 Enhanced DOM method with Hebrew support...`);

        try {
            // Step 1: Navigate to Status (cached or search)
            const statusNavSuccess = await this.findAndClickElement('statusNav', [
                // Icon-based selectors (language independent)
                'span[data-icon="status"]',
                'svg[data-icon="status"]',
                '[aria-label*="Status"]',
                '[aria-label*="סטטוס"]', // Hebrew
                'div[data-tab="3"]',
                // Skip :has() - div[role="button"]:has(span[data-icon="status"])
                'div[data-testid="menu-bar-status"]',
                // Position-based (second menu item)
                'div[data-navbar-item-index="1"]',
                'header div[role="button"]:nth-child(2)'
            ]);

            if (!statusNavSuccess) {
                return { success: false, error: 'Status navigation not found' };
            }

            await this.page.waitForTimeout(1500);

            // Step 2: Find Add Status button
            const addStatusSuccess = await this.findAndClickElement('addStatus', [
                // Icon-based
                'div[data-testid="status-v3-my-status"]',
                'span[data-icon="plus"]',
                'span[data-icon="add"]',
                'svg[data-icon="plus"]',
                // Skip :has() - div[role="button"]:has(span[data-icon="plus"])
                // Text-based (multiple languages)
                '[aria-label*="Add status"]',
                '[aria-label*="הוסף סטטוס"]', // Hebrew
                '[aria-label*="My status"]',
                '[aria-label*="הסטטוס שלי"]', // Hebrew
                'button[aria-label="My status"]',
                'div[data-testid="my-status"]',
                // Fallback: look for green circular button (typical "add" button)
                'div[style*="background-color: rgb(0, 150, 136)"]', // WhatsApp green
                'div[style*="border-radius: 50%"]:has(span[data-icon="plus"])'
            ]);

            if (!addStatusSuccess) {
                return { success: false, error: 'Add Status button not found' };
            }

            await this.page.waitForTimeout(2000);

            // Step 3: Find Text option (icon-based, language independent)
            const textOptionSuccess = await this.findAndClickElement('textOption', [
                // Icon-based selectors
                'span[data-icon="text-status"]',
                'span[data-icon="compose"]',
                'svg[data-icon="text-status"]',
                'svg[data-icon="compose"]',
                'div[data-testid="text-status-composer"]',
                // Skip :has() selectors for now - not supported everywhere
                // Look for "Aa" symbol - will be handled in custom logic
                'AA_CUSTOM_SEARCH',
                // Text-based (multiple languages)
                '[aria-label*="Text"]',
                '[aria-label*="טקסט"]', // Hebrew
                'button[aria-label="Text"]',
                // Fallback: first option in status composer
                'div[data-testid="status-composer"] > div:first-child',
                'div[role="button"]:first-child'
            ], true); // Use custom logic for Aa

            if (!textOptionSuccess) {
                return { success: false, error: 'Text option not found' };
            }

            await this.page.waitForTimeout(1000);

            // Step 4: Find and fill text input
            console.log(`[${this.sessionId}] 📍 Step 4: Finding and filling text input...`);
            let textInputSuccess = false;

            try {
                textInputSuccess = await this.page.evaluate((content) => {
                    console.log(`Searching for text input field to enter: "${content}"`);
                    const selectors = [
                    'div[data-testid="status-text-input"]',
                    'div[contenteditable="true"]',
                    'textarea[placeholder*="Type"]',
                    'textarea[placeholder*="הקלד"]', // Hebrew
                    'input[type="text"]',
                    'div[role="textbox"]',
                    'div[data-tab="10"]',
                    'div.selectable-text[contenteditable="true"]',
                    // Fallback: any contenteditable in the current view
                    'div[contenteditable="true"]:not([style*="display: none"])'
                ];

                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element && element.offsetParent !== null) { // visible element
                        console.log(`Found text input with selector: ${selector}`);
                        element.focus();

                        // Clear and set content
                        if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
                            element.value = content;
                            element.dispatchEvent(new Event('input', { bubbles: true }));
                            element.dispatchEvent(new Event('change', { bubbles: true }));
                        } else {
                            // For contenteditable
                            element.innerHTML = content;
                            element.textContent = content;
                            element.dispatchEvent(new Event('input', { bubbles: true }));
                            element.dispatchEvent(new Event('change', { bubbles: true }));
                        }

                        console.log(`Text set successfully: "${content}"`);
                        return true;
                    }
                }
                return false;
                }, content);

            } catch (error) {
                console.error(`[${this.sessionId}] ❌ Error in text input evaluation:`, error.message);
                textInputSuccess = false;
            }

            if (textInputSuccess) {
                console.log(`[${this.sessionId}] ✅ Text input filled successfully`);

                // Take screenshot to verify text was filled
                try {
                    await this.page.screenshot({
                        path: `/tmp/status_after_text_${this.sessionId}_${Date.now()}.png`,
                        fullPage: false
                    });
                    console.log(`[${this.sessionId}] 📸 Screenshot taken after text input`);
                } catch (e) {
                    console.log(`[${this.sessionId}] Screenshot failed:`, e.message);
                }
            } else {
                console.log(`[${this.sessionId}] ❌ Text input filling failed`);
                return { success: false, error: 'Text input field not found' };
            }

            // Wait longer for WhatsApp to process the text input
            await this.page.waitForTimeout(2000);

            // Step 5: Send the status - try multiple methods
            console.log(`[${this.sessionId}] 📍 Step 5: Attempting to send status...`);

            // First try keyboard shortcut (Enter)
            console.log(`[${this.sessionId}] 🔑 Trying Enter key first...`);
            const enterSuccess = await this.page.evaluate(() => {
                const input = document.querySelector('div[contenteditable="true"]');
                if (input) {
                    console.log('Found input, sending Enter key...');
                    input.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        bubbles: true
                    }));
                    return true;
                }
                return false;
            });

            let sendSuccess = false;

            if (enterSuccess) {
                console.log(`[${this.sessionId}] ✅ Enter key sent`);
                sendSuccess = true;
                await this.page.waitForTimeout(1000);
            } else {
                console.log(`[${this.sessionId}] ⚠️ Enter key failed, trying send button...`);

                sendSuccess = await this.findAndClickElement('sendButton', [
                    // Icon-based
                    'span[data-icon="send"]',
                    'span[data-icon="send-light"]',
                    'svg[data-icon="send"]',
                    'button[data-testid="send-status"]',
                    'div[data-testid="compose-btn-send"]',
                    // Text-based
                    'button[aria-label="Send"]',
                    'button[aria-label="שלח"]', // Hebrew
                    '[aria-label*="Send"]',
                    '[aria-label*="שלח"]' // Hebrew
                ]);

                if (!sendSuccess) {
                    console.log(`[${this.sessionId}] ❌ Send button not found`);
                    return { success: false, error: 'Send button not found' };
                }
            }

            // Wait longer to ensure status is fully sent and processed
            await this.page.waitForTimeout(5000);

            // Take final screenshot to confirm status was sent
            try {
                await this.page.screenshot({
                    path: `/tmp/status_final_result_${this.sessionId}_${Date.now()}.png`,
                    fullPage: false
                });
                console.log(`[${this.sessionId}] 📸 Final result screenshot taken`);
            } catch (e) {
                console.log(`[${this.sessionId}] Final screenshot failed:`, e.message);
            }

            // Check if we're back to the status list (success indicator)
            const backToList = await this.page.evaluate(() => {
                // Look for status list indicators
                const indicators = [
                    'Share status updates',
                    'שתף עדכוני סטטוס',
                    '[data-testid="status-list"]',
                    'div:contains("Recent")',
                    'div:contains("אחרונים")'
                ];

                for (const indicator of indicators) {
                    if (indicator.startsWith('[') || indicator.startsWith('div:')) {
                        // CSS selector
                        if (document.querySelector(indicator.replace('div:contains(', '').replace('("', '').replace('")', ''))) {
                            return true;
                        }
                    } else {
                        // Text content search
                        if (document.body.textContent.includes(indicator)) {
                            return true;
                        }
                    }
                }
                return false;
            });

            if (backToList) {
                console.log(`[${this.sessionId}] ✅ Confirmed: Back to status list - Status sent successfully!`);
            } else {
                console.log(`[${this.sessionId}] ⚠️ Warning: Not sure if status was sent - still in composer view`);
            }

            console.log(`[${this.sessionId}] ✅ Status sent via enhanced DOM method`);
            return {
                success: true,
                method: 'enhanced_dom',
                message: 'Text status sent successfully',
                content: content
            };

        } catch (error) {
            console.error(`[${this.sessionId}] Error in DOM method:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async findAndClickElement(cacheKey, selectors, useCustomLogic = false) {
        console.log(`[${this.sessionId}] 🔍 Finding ${cacheKey}...`);

        // Check cache first
        if (this.cachedElements[cacheKey]) {
            console.log(`[${this.sessionId}] 📋 Using cached selector for ${cacheKey}`);
            const success = await this.page.evaluate((selector) => {
                const element = document.querySelector(selector);
                if (element && element.offsetParent !== null) {
                    element.click();
                    return true;
                }
                return false;
            }, this.cachedElements[cacheKey]);

            if (success) {
                console.log(`[${this.sessionId}] ✅ Cached ${cacheKey} clicked`);
                return true;
            } else {
                console.log(`[${this.sessionId}] 🗑️ Cached selector failed, clearing cache`);
                delete this.cachedElements[cacheKey];
            }
        }

        // Debug: log page content when statusNav not found
        if (cacheKey === 'statusNav') {
            console.log(`[${this.sessionId}] 🔍 Debugging: Looking for status navigation elements...`);
            const debugInfo = await this.page.evaluate(() => {
                return {
                    url: window.location.href,
                    title: document.title,
                    hasWhatsApp: !!document.querySelector('#app'),
                    visibleButtons: Array.from(document.querySelectorAll('div[role="button"]')).length,
                    hasChats: !!document.querySelector('[data-testid="chat-list"]'),
                    mainElements: Array.from(document.querySelectorAll('header, nav, main')).map(el => el.tagName)
                };
            });
            console.log(`[${this.sessionId}] 📱 Page debug:`, JSON.stringify(debugInfo, null, 2));
        }

        // Search for element
        const result = await this.page.evaluate(({selectors, useCustomLogic}) => {
            for (const selector of selectors) {
                if (selector === 'ENTER_KEY') {
                    // Special case: simulate Enter key
                    const input = document.querySelector('div[contenteditable="true"]');
                    if (input) {
                        console.log('Sending Enter key');
                        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                        return { success: true, selector: 'ENTER_KEY' };
                    }
                    continue;
                }

                let element = document.querySelector(selector);

                // Custom logic for Aa text and other special cases
                if (!element && useCustomLogic) {
                    if (selector === 'AA_CUSTOM_SEARCH') {
                        console.log('Searching for Aa text element...');
                        const elements = Array.from(document.querySelectorAll('div, span, button'));
                        element = elements.find(el => {
                            const text = el.textContent?.trim();
                            const label = el.getAttribute('aria-label');
                            return text === 'Aa' ||
                                   text?.includes('Aa') ||
                                   label?.includes('Text') ||
                                   label?.includes('טקסט') ||
                                   label?.includes('text');
                        });
                        if (element) {
                            console.log('Found Aa element via custom search');
                        }
                    }
                }

                if (element && element.offsetParent !== null) {
                    console.log(`Found element with selector: ${selector}`);
                    element.click();
                    return { success: true, selector: selector };
                }
            }
            return { success: false };
        }, {selectors, useCustomLogic});

        if (result.success) {
            console.log(`[${this.sessionId}] ✅ ${cacheKey} found and clicked`);
            // Cache successful selector
            this.cachedElements[cacheKey] = result.selector;
            return true;
        } else {
            console.log(`[${this.sessionId}] ❌ ${cacheKey} not found`);
            return false;
        }
    }

    async sendImageStatus(imageBuffer, caption = '', options = {}) {
        console.log(`[${this.sessionId}] 🧠 SMART: Image status not implemented yet`);
        return { success: false, error: 'Image status not implemented in smart handler' };
    }

    async sendVideoStatus(videoBuffer, caption = '', options = {}) {
        console.log(`[${this.sessionId}] 🧠 SMART: Video status not implemented yet`);
        return { success: false, error: 'Video status not implemented in smart handler' };
    }

    async getMyStatus() {
        console.log(`[${this.sessionId}] 🧠 SMART: Get status not implemented yet`);
        return { success: false, error: 'Get status not implemented in smart handler' };
    }

    async cleanup() {
        console.log(`[${this.sessionId}] Smart status handler cleanup`);
        this.cachedElements = {};
        this.initialized = false;
    }
}

module.exports = SmartStatusHandler;