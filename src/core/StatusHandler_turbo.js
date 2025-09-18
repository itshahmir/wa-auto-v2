class TurboStatusHandler {
    constructor(page, sessionId) {
        this.page = page;
        this.sessionId = sessionId;
        this.initialized = false;
        this.cachedSelectors = new Map();
    }

    async initialize() {
        if (this.initialized) return;
        console.log(`[${this.sessionId}] 🚀 Initializing TURBO status handler...`);

        // Pre-cache all selectors for maximum speed
        await this.cacheSelectors();

        this.initialized = true;
        console.log(`[${this.sessionId}] ⚡ TURBO status handler ready`);
    }

    async cacheSelectors() {
        // Cache all possible selectors for instant access
        this.cachedSelectors.set('statusTab', [
            'span[data-icon="status"]',
            'svg[data-icon="status"]',
            '[data-tab="3"]',
            '[aria-label*="סטטוס"]',
            '[aria-label*="Status"]'
        ]);

        this.cachedSelectors.set('addStatus', [
            'div[data-testid="status-v3-my-status"]',
            '[aria-label*="הוסף סטטוס"]',
            '[aria-label*="Add status"]',
            'span[data-icon="plus"]'
        ]);

        this.cachedSelectors.set('textOption', [
            '[aria-label*="טקסט"]',
            '[aria-label*="Text"]',
            'span[data-icon="text-status"]',
            'span[data-icon="compose"]'
        ]);

        this.cachedSelectors.set('textInput', [
            'div[data-testid="status-text-input"]',
            'div[contenteditable="true"]',
            'div[role="textbox"]',
            'textarea'
        ]);

        this.cachedSelectors.set('sendButton', [
            '[aria-label*="שלח"]',
            '[aria-label*="Send"]',
            'span[data-icon="send"]',
            'button[data-testid="send-status"]'
        ]);
    }

    async sendTextStatus(content, options = {}) {
        console.log(`[${this.sessionId}] ⚡ TURBO: Sending text status: "${content}"`);
        const startTime = Date.now();

        try {
            // Method 1: Try direct WhatsApp API injection (fastest)
            const directApiResult = await this.tryDirectAPI(content);
            if (directApiResult.success) {
                const duration = Date.now() - startTime;
                console.log(`[${this.sessionId}] ⚡ TURBO: Status sent via Direct API in ${duration}ms!`);
                return directApiResult;
            }

            // Method 2: Optimized DOM with cached selectors (fast)
            const domResult = await this.tryOptimizedDOM(content);
            const duration = Date.now() - startTime;
            console.log(`[${this.sessionId}] ⚡ TURBO: Status sent via Optimized DOM in ${duration}ms!`);
            return domResult;

        } catch (error) {
            console.error(`[${this.sessionId}] ❌ TURBO Error:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async tryDirectAPI(content) {
        console.log(`[${this.sessionId}] 🔥 Trying direct DOM manipulation with real selectors...`);

        const result = await this.page.evaluate(async (content) => {
            // Simple, direct DOM approach with exact selectors from user

            // Step 1: Click Status Tab (the exact button user provided)
            const statusTab = document.querySelector('button[aria-label="עדכונים בלשונית \'סטטוס\'"]') ||
                              document.querySelector('button[aria-pressed="true"][data-navbar-item="true"][data-navbar-item-selected="true"]') ||
                              document.querySelector('button[data-navbar-item-index="1"]');
            if (statusTab) {
                statusTab.click();
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                return { success: false, error: 'Status tab not found' };
            }

            // Step 1.5: Navigate to Status List (if not already there)
            // Sometimes we need to click on "My Status" or status area first
            const myStatus = document.querySelector('[data-testid="status-v3-my-status"]') ||
                            document.querySelector('div[role="button"]').querySelector('span[data-icon="status-filled-refreshed"]')?.closest('div[role="button"]');
            if (myStatus) {
                myStatus.click();
                await new Promise(resolve => setTimeout(resolve, 800));
            }

            // Step 2: Click Add Status button (try multiple approaches)
            // First, wait a bit more after clicking status tab
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Try to find the button with different selectors (including expanded state)
            let addStatusBtn = document.querySelector('button[data-tab="2"][aria-expanded="true"][title="Add Status"][aria-label="Add Status"]') ||
                               document.querySelector('button[data-tab="2"][title="Add Status"][aria-label="Add Status"]') ||
                               document.querySelector('button[aria-expanded="true"][aria-label="Add Status"]') ||
                               document.querySelector('button[aria-label="Add Status"]') ||
                               document.querySelector('button[title="Add Status"]') ||
                               document.querySelector('button[data-tab="2"]') ||
                               document.querySelector('span[data-icon="new-round-refreshed"]')?.closest('button') ||
                               document.querySelector('svg[title="new-round-refreshed"]')?.closest('button');

            // If still not found, try to look for any plus icon or status-related button
            if (!addStatusBtn) {
                const allButtons = document.querySelectorAll('button');
                for (const btn of allButtons) {
                    const text = btn.textContent?.toLowerCase() || '';
                    const aria = btn.getAttribute('aria-label')?.toLowerCase() || '';
                    const title = btn.getAttribute('title')?.toLowerCase() || '';

                    if (text.includes('status') || aria.includes('status') || title.includes('status') ||
                        aria.includes('add') || title.includes('add') ||
                        btn.querySelector('svg[title="new-round-refreshed"]')) {
                        addStatusBtn = btn;
                        break;
                    }
                }
            }

            if (addStatusBtn) {
                addStatusBtn.click();
                await new Promise(resolve => setTimeout(resolve, 800));
            } else {
                // Debug info
                const allButtons = Array.from(document.querySelectorAll('button')).map(btn => ({
                    aria: btn.getAttribute('aria-label'),
                    title: btn.getAttribute('title'),
                    dataTab: btn.getAttribute('data-tab'),
                    hasIcon: !!btn.querySelector('span[data-icon], svg')
                }));
                return { success: false, error: 'Add Status button not found', debug: allButtons.slice(0, 10) };
            }

            // Step 3: Look for Text option and click it (if needed)
            const textOption = document.querySelector('div span[aria-hidden="true"][data-icon="pencil-refreshed"]');
            if (textOption && textOption.parentElement && textOption.parentElement.parentElement) {
                textOption.parentElement.parentElement.click();
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Step 4: Find text input and type content
            const textInput = document.querySelector('p.selectable-text.copyable-text[dir="auto"]');
            if (textInput) {
                textInput.focus();
                textInput.innerHTML = content;
                textInput.textContent = content;

                // Trigger input events
                const inputEvent = new Event('input', { bubbles: true });
                textInput.dispatchEvent(inputEvent);

                await new Promise(resolve => setTimeout(resolve, 300));
            } else {
                return { success: false, error: 'Text input not found' };
            }

            // Step 5: Click send button (the exact button user provided)
            const sendBtn = document.querySelector('div[aria-label="שליחה"][role="button"]');
            if (sendBtn && !sendBtn.getAttribute('aria-disabled') || sendBtn.getAttribute('aria-disabled') === 'false') {
                sendBtn.click();
                return { success: true, method: 'direct_dom', message: 'Status sent via DOM' };
            } else {
                return { success: false, error: 'Send button not found or disabled' };
            }
        }, content);

        return result;
    }

    async tryOptimizedDOM(content) {
        console.log(`[${this.sessionId}] ⚡ Using optimized DOM with cached selectors...`);

        // Step 1: Navigate to Status (with timeout)
        const statusNav = await this.quickFind('statusTab', 2000);
        if (!statusNav) {
            return { success: false, error: 'Status navigation not found' };
        }
        await this.page.waitForTimeout(500);

        // Step 2: Click Add Status
        const addStatus = await this.quickFind('addStatus', 2000);
        if (!addStatus) {
            return { success: false, error: 'Add Status button not found' };
        }
        await this.page.waitForTimeout(800);

        // Step 3: Click Text Option
        const textOption = await this.quickFind('textOption', 2000);
        if (!textOption) {
            return { success: false, error: 'Text option not found' };
        }
        await this.page.waitForTimeout(500);

        // Step 4: Fill Text Input (optimized)
        const textFilled = await this.page.evaluate((content) => {
            const selectors = [
                'div[contenteditable="true"]',
                'div[data-testid="status-text-input"]',
                'textarea',
                'div[role="textbox"]'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && element.offsetParent !== null) {
                    element.focus();

                    // Fast text insertion
                    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
                        element.value = content;
                        element.dispatchEvent(new Event('input', { bubbles: true }));
                    } else {
                        element.textContent = content;
                        element.dispatchEvent(new Event('input', { bubbles: true }));
                    }

                    // Trigger React state update if needed
                    const reactKey = Object.keys(element).find(key => key.startsWith('__reactInternalInstance'));
                    if (reactKey) {
                        element[reactKey].memoizedProps.onChange?.({ target: { value: content } });
                    }

                    return true;
                }
            }
            return false;
        }, content);

        if (!textFilled) {
            return { success: false, error: 'Text input not found' };
        }

        await this.page.waitForTimeout(300);

        // Step 5: Send (multiple fast methods)
        const sent = await this.page.evaluate(() => {
            // Method 1: Enter key (fastest)
            const input = document.querySelector('div[contenteditable="true"], textarea');
            if (input) {
                input.focus();
                const enterEvent = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true
                });
                input.dispatchEvent(enterEvent);
                return true;
            }

            // Method 2: Send button
            const sendSelectors = [
                'span[data-icon="send"]',
                'button[data-testid="send-status"]',
                '[aria-label*="שלח"]',
                '[aria-label*="Send"]'
            ];

            for (const selector of sendSelectors) {
                const button = document.querySelector(selector);
                if (button && button.offsetParent !== null) {
                    button.click();
                    return true;
                }
            }

            return false;
        });

        if (!sent) {
            return { success: false, error: 'Could not send status' };
        }

        // Quick verification (optional)
        await this.page.waitForTimeout(1000);

        return {
            success: true,
            method: 'optimized_dom',
            message: 'Text status sent via optimized DOM',
            content: content
        };
    }

    async quickFind(selectorKey, timeout = 3000) {
        const selectors = this.cachedSelectors.get(selectorKey) || [];
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const found = await this.page.evaluate((selectors) => {
                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element && element.offsetParent !== null) {
                        element.scrollIntoView({ behavior: 'instant' });
                        element.click();
                        return true;
                    }
                }
                return false;
            }, selectors);

            if (found) {
                console.log(`[${this.sessionId}] ⚡ Found ${selectorKey} quickly`);
                return true;
            }

            await this.page.waitForTimeout(100); // Short wait before retry
        }

        console.log(`[${this.sessionId}] ❌ Could not find ${selectorKey} within ${timeout}ms`);
        return false;
    }

    async sendImageStatus(imageBuffer, caption = '', options = {}) {
        console.log(`[${this.sessionId}] ⚡ TURBO: Sending image status with caption: "${caption}"`);
        const startTime = Date.now();

        try {
            // Method 1: Try direct WhatsApp API injection for images
            const directApiResult = await this.tryDirectImageAPI(imageBuffer, caption);
            if (directApiResult.success) {
                const duration = Date.now() - startTime;
                console.log(`[${this.sessionId}] ⚡ TURBO: Image status sent via Direct API in ${duration}ms!`);
                return directApiResult;
            }

            // Method 2: Optimized DOM with file upload
            const domResult = await this.tryOptimizedImageDOM(imageBuffer, caption);
            const duration = Date.now() - startTime;
            console.log(`[${this.sessionId}] ⚡ TURBO: Image status sent via Optimized DOM in ${duration}ms!`);
            return domResult;

        } catch (error) {
            console.error(`[${this.sessionId}] ❌ TURBO Image Error:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async sendVideoStatus(videoBuffer, caption = '', options = {}) {
        console.log(`[${this.sessionId}] ⚡ TURBO: Video status not implemented yet`);
        return { success: false, error: 'Video status not implemented in turbo handler' };
    }

    async getMyStatus() {
        console.log(`[${this.sessionId}] ⚡ TURBO: Get status not implemented yet`);
        return { success: false, error: 'Get status not implemented in turbo handler' };
    }

    async tryDirectImageAPI(imageBuffer, caption) {
        console.log(`[${this.sessionId}] 🔥 Trying direct WhatsApp image API injection...`);

        const result = await this.page.evaluate(async (params) => {
            const { imageDataUrl, caption } = params;

            // Wait for full readiness
            const waitForReady = async () => {
                let attempts = 0;
                while (!window.WPP?.isFullReady && attempts < 30) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }
                return window.WPP?.isFullReady;
            };

            await waitForReady();

            // Try multiple WhatsApp internal methods for images
            const methods = [
                // Method 1: Store.StatusV3 with image (Most reliable)
                async () => {
                    if (window.Store?.StatusV3?.sendMessage) {
                        const statusMsg = {
                            type: 'image',
                            body: caption || '',
                            media: imageDataUrl,
                            isViewOnce: false
                        };
                        return await window.Store.StatusV3.sendMessage(statusMsg);
                    }
                },

                // Method 2: WPP.status.sendImageStatus (wa-js)
                async () => {
                    if (window.WPP?.status?.sendImageStatus) {
                        return await window.WPP.status.sendImageStatus(imageDataUrl, {
                            caption: caption || '',
                            waitForAck: true
                        });
                    }
                },

                // Method 3: WPP.chat.sendImageMessage
                async () => {
                    if (window.WPP?.chat?.sendImageMessage) {
                        return await window.WPP.chat.sendImageMessage('status@broadcast', imageDataUrl, {
                            caption: caption || ''
                        });
                    }
                },

                // Method 4: Store.Chat fallback
                async () => {
                    if (window.Store?.Chat?.sendMessage) {
                        return await window.Store.Chat.sendMessage('status@broadcast', {
                            body: caption || '',
                            type: 'image',
                            media: imageDataUrl
                        });
                    }
                }
            ];

            for (let i = 0; i < methods.length; i++) {
                try {
                    console.log(`Trying direct image API method ${i + 1}...`);
                    const result = await methods[i]();
                    if (result) {
                        console.log(`✅ Direct image API method ${i + 1} succeeded!`);
                        return {
                            success: true,
                            method: `direct_image_api_${i + 1}`,
                            result: result
                        };
                    }
                } catch (error) {
                    console.log(`❌ Direct image API method ${i + 1} failed:`, error.message);
                }
            }

            return { success: false, error: 'All direct image API methods failed' };
        }, {
            imageDataUrl: `data:image/png;base64,${imageBuffer.toString('base64')}`,
            caption: caption
        });

        return result;
    }

    async tryOptimizedImageDOM(imageBuffer, caption) {
        console.log(`[${this.sessionId}] ⚡ Using optimized DOM for image upload...`);

        // Step 1: Navigate to Status
        const statusNav = await this.quickFind('statusTab', 2000);
        if (!statusNav) {
            return { success: false, error: 'Status navigation not found' };
        }
        await this.page.waitForTimeout(500);

        // Step 2: Click Add Status
        const addStatus = await this.quickFind('addStatus', 2000);
        if (!addStatus) {
            return { success: false, error: 'Add Status button not found' };
        }
        await this.page.waitForTimeout(800);

        // Step 3: Upload image file
        const uploaded = await this.page.evaluate(async (params) => {
            const { imageDataUrl, caption } = params;
            // Look for file input or photo option
            const photoSelectors = [
                'input[type="file"]',
                '[aria-label*="צילום"]',
                '[aria-label*="Photo"]',
                'span[data-icon="camera"]',
                'span[data-icon="image"]'
            ];

            for (const selector of photoSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    if (element.tagName === 'INPUT' && element.type === 'file') {
                        // Convert data URL to file
                        const response = await fetch(imageDataUrl);
                        const blob = await response.blob();
                        const file = new File([blob], 'status_image.png', { type: 'image/png' });

                        const dt = new DataTransfer();
                        dt.items.add(file);
                        element.files = dt.files;
                        element.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    } else {
                        element.click();
                        return true;
                    }
                }
            }
            return false;
        }, {
            imageDataUrl: `data:image/png;base64,${imageBuffer.toString('base64')}`,
            caption: caption
        });

        if (!uploaded) {
            return { success: false, error: 'Could not upload image' };
        }

        await this.page.waitForTimeout(2000);

        // Step 4: Add caption if provided
        if (caption) {
            await this.page.evaluate((caption) => {
                const captionSelectors = [
                    'div[contenteditable="true"]',
                    'textarea[placeholder*="כתוב"]',
                    'textarea[placeholder*="caption"]',
                    'div[data-testid="media-caption-input"]'
                ];

                for (const selector of captionSelectors) {
                    const element = document.querySelector(selector);
                    if (element && element.offsetParent !== null) {
                        element.focus();
                        if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
                            element.value = caption;
                        } else {
                            element.textContent = caption;
                        }
                        element.dispatchEvent(new Event('input', { bubbles: true }));
                        return true;
                    }
                }
                return false;
            }, caption);
        }

        await this.page.waitForTimeout(500);

        // Step 5: Send
        const sent = await this.page.evaluate(() => {
            const sendSelectors = [
                'span[data-icon="send"]',
                'button[data-testid="send"]',
                '[aria-label*="שלח"]',
                '[aria-label*="Send"]'
            ];

            for (const selector of sendSelectors) {
                const button = document.querySelector(selector);
                if (button && button.offsetParent !== null) {
                    button.click();
                    return true;
                }
            }
            return false;
        });

        if (!sent) {
            return { success: false, error: 'Could not send image status' };
        }

        await this.page.waitForTimeout(1000);

        return {
            success: true,
            method: 'optimized_image_dom',
            message: 'Image status sent via optimized DOM',
            caption: caption
        };
    }

    async cleanup() {
        console.log(`[${this.sessionId}] TURBO status handler cleanup`);
        this.cachedSelectors.clear();
        this.initialized = false;
    }
}

module.exports = TurboStatusHandler;