class FastStatusHandler {
    constructor(page, sessionId) {
        this.page = page;
        this.sessionId = sessionId;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        console.log(`[${this.sessionId}] Initializing fast status handler...`);

        // Wait only for page to be loaded - no WA-JS dependency
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(2000);

        this.initialized = true;
        console.log(`[${this.sessionId}] Fast status handler ready`);
    }

    async sendTextStatus(content, options = {}) {
        console.log(`[${this.sessionId}] 🚀 FAST: Sending text status: "${content}"`);

        try {
            // Step 1: Navigate to Status section (multiple selectors for reliability)
            console.log(`[${this.sessionId}] 📍 Step 1: Navigating to Status...`);
            const statusNavFound = await this.page.evaluate(() => {
                // Try multiple selectors for status navigation
                const selectors = [
                    'span[data-icon="status"]',
                    '[aria-label*="Status"]',
                    '[data-tab="3"]',
                    'div[role="button"]:has(span[data-icon="status"])',
                    'div[data-testid="menu-bar-status"]'
                ];

                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                        console.log(`Found status nav with selector: ${selector}`);
                        element.click();
                        return true;
                    }
                }
                return false;
            });

            if (statusNavFound) {
                console.log(`[${this.sessionId}] ✅ Status navigation clicked`);
                await this.page.waitForTimeout(1000);
            } else {
                console.log(`[${this.sessionId}] ⚠️ Status navigation not found, continuing...`);
            }

            // Step 2: Click "My Status" or "Add Status" button
            console.log(`[${this.sessionId}] 📍 Step 2: Looking for Add Status button...`);
            const addStatusFound = await this.page.evaluate(() => {
                const selectors = [
                    'div[data-testid="status-v3-my-status"]',
                    'div[aria-label*="Add status"]',
                    'div[role="button"]:has(span[data-icon="plus"])',
                    'button[aria-label="My status"]',
                    'div[data-testid="my-status"]',
                    'div:has(span[data-icon="plus-status"])',
                    // Generic selectors for plus icons
                    'span[data-icon="plus"]',
                    'div[role="button"]:has(svg[data-icon="plus"])'
                ];

                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                        console.log(`Found add status with selector: ${selector}`);
                        element.click();
                        return true;
                    }
                }
                return false;
            });

            if (addStatusFound) {
                console.log(`[${this.sessionId}] ✅ Add Status clicked`);
                await this.page.waitForTimeout(1500);
            } else {
                console.log(`[${this.sessionId}] ❌ Add Status button not found`);
                return { success: false, error: 'Add Status button not found' };
            }

            // Step 3: Click on Text option (📝 or Aa icon)
            console.log(`[${this.sessionId}] 📍 Step 3: Looking for Text option...`);
            const textOptionFound = await this.page.evaluate(() => {
                const selectors = [
                    'div[data-testid="text-status-composer"]',
                    'div[aria-label*="Text"]',
                    'span[data-icon="text-status"]',
                    'div:has(span[data-icon="text-status"])',
                    'button[aria-label="Text"]',
                    // Look for "Aa" text
                    'div:contains("Aa")',
                    'span:contains("Aa")',
                    // Generic text/compose selectors
                    'div[role="button"]:has(svg[data-icon="compose"])',
                    'span[data-icon="compose"]'
                ];

                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                        console.log(`Found text option with selector: ${selector}`);
                        element.click();
                        return true;
                    }
                }

                // Fallback: look for any clickable text-related element
                const textElements = Array.from(document.querySelectorAll('div, span, button'))
                    .filter(el => el.textContent.includes('Text') || el.textContent.includes('Aa'));

                if (textElements.length > 0) {
                    console.log(`Found text option via content search`);
                    textElements[0].click();
                    return true;
                }

                return false;
            });

            if (textOptionFound) {
                console.log(`[${this.sessionId}] ✅ Text option clicked`);
                await this.page.waitForTimeout(1000);
            } else {
                console.log(`[${this.sessionId}] ❌ Text option not found`);
                return { success: false, error: 'Text option not found' };
            }

            // Step 4: Find and fill the text input
            console.log(`[${this.sessionId}] 📍 Step 4: Finding text input...`);
            const textInputFound = await this.page.evaluate((content) => {
                const selectors = [
                    'div[data-testid="status-text-input"]',
                    'div[contenteditable="true"]',
                    'textarea',
                    'input[type="text"]',
                    'div[role="textbox"]',
                    'div[data-tab="10"]', // WhatsApp's text composer
                    'div.selectable-text[contenteditable="true"]'
                ];

                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                        console.log(`Found text input with selector: ${selector}`);
                        element.focus();

                        // Clear existing content
                        if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
                            element.value = content;
                            element.dispatchEvent(new Event('input', { bubbles: true }));
                        } else {
                            // For contenteditable divs
                            element.textContent = content;
                            element.dispatchEvent(new Event('input', { bubbles: true }));
                        }

                        console.log(`Text set to: "${content}"`);
                        return true;
                    }
                }
                return false;
            }, content);

            if (textInputFound) {
                console.log(`[${this.sessionId}] ✅ Text input filled`);
                await this.page.waitForTimeout(500);
            } else {
                console.log(`[${this.sessionId}] ❌ Text input not found`);
                return { success: false, error: 'Text input not found' };
            }

            // Step 5: Send the status
            console.log(`[${this.sessionId}] 📍 Step 5: Sending status...`);
            const sendButtonFound = await this.page.evaluate(() => {
                const selectors = [
                    'button[data-testid="send-status"]',
                    'span[data-icon="send"]',
                    'div[role="button"]:has(span[data-icon="send"])',
                    'button[aria-label="Send"]',
                    'div[data-testid="compose-btn-send"]',
                    // Look for send/paper plane icons
                    'span[data-icon="send-light"]',
                    'svg[data-icon="send"]'
                ];

                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                        console.log(`Found send button with selector: ${selector}`);
                        element.click();
                        return true;
                    }
                }

                // Fallback: try Enter key
                const input = document.querySelector('div[contenteditable="true"]');
                if (input) {
                    console.log('Trying Enter key as fallback');
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
                    return true;
                }

                return false;
            });

            if (sendButtonFound) {
                console.log(`[${this.sessionId}] ✅ Send button clicked`);
                await this.page.waitForTimeout(2000);
            } else {
                console.log(`[${this.sessionId}] ❌ Send button not found`);
                return { success: false, error: 'Send button not found' };
            }

            console.log(`[${this.sessionId}] 🎉 Text status sent successfully!`);
            return {
                success: true,
                message: 'Text status sent via fast DOM manipulation',
                content: content
            };

        } catch (error) {
            console.error(`[${this.sessionId}] ❌ Error sending text status:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async sendImageStatus(imageBuffer, caption = '', options = {}) {
        console.log(`[${this.sessionId}] 🚀 FAST: Sending image status with caption: "${caption}"`);

        // For now, return not implemented - we can add this later
        return {
            success: false,
            error: 'Image status not implemented yet in fast handler'
        };
    }

    async sendVideoStatus(videoBuffer, caption = '', options = {}) {
        console.log(`[${this.sessionId}] 🚀 FAST: Sending video status with caption: "${caption}"`);

        // For now, return not implemented - we can add this later
        return {
            success: false,
            error: 'Video status not implemented yet in fast handler'
        };
    }

    async getMyStatus() {
        console.log(`[${this.sessionId}] 🚀 FAST: Getting my status`);

        // For now, return not implemented
        return {
            success: false,
            error: 'Get status not implemented yet in fast handler'
        };
    }

    async cleanup() {
        console.log(`[${this.sessionId}] Fast status handler cleanup`);
        this.initialized = false;
    }
}

module.exports = FastStatusHandler;