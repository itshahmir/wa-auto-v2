class SimpleStatusHandler {
    constructor(page, sessionId) {
        this.page = page;
        this.sessionId = sessionId;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        console.log(`[${this.sessionId}] 🎯 Initializing SIMPLE status handler...`);
        this.initialized = true;
        console.log(`[${this.sessionId}] ✅ SIMPLE status handler ready`);
    }

    async sendTextStatus(content, options = {}) {
        console.log(`[${this.sessionId}] 🎯 SIMPLE: Sending text status: "${content}"`);
        const startTime = Date.now();

        try {
            // Method 1: Try WPP.status first (if available)
            console.log(`[${this.sessionId}] 🔍 Trying WPP.status direct method...`);
            const wppResult = await this.page.evaluate(async (content) => {
                if (window.WPP && window.WPP.status && window.WPP.status.sendTextStatus) {
                    try {
                        console.log('Using WPP.status.sendTextStatus...');
                        const result = await window.WPP.status.sendTextStatus(content);
                        return { success: true, method: 'wpp_status', result };
                    } catch (error) {
                        console.log('WPP.status failed:', error.message);
                        return { success: false, error: error.message };
                    }
                }
                return { success: false, error: 'WPP.status not available' };
            }, content);

            if (wppResult.success) {
                const duration = Date.now() - startTime;
                console.log(`[${this.sessionId}] ⚡ SIMPLE: Status sent via WPP in ${duration}ms!`);
                return wppResult;
            }

            // Method 2: Minimal DOM approach
            console.log(`[${this.sessionId}] 🔍 Trying minimal DOM method...`);
            return await this.sendViaMinimalDOM(content, startTime);

        } catch (error) {
            console.error(`[${this.sessionId}] ❌ SIMPLE Error:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async sendViaMinimalDOM(content, startTime) {
        // Step 1: Go to status (wait longer to be sure)
        console.log(`[${this.sessionId}] 📍 Step 1: Going to Status tab...`);
        const statusClicked = await this.page.evaluate(() => {
            // Look for status tab - multiple methods
            const selectors = [
                'span[data-icon="status"]',
                '[aria-label*="Status"]',
                '[aria-label*="סטטוס"]'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && element.offsetParent !== null) {
                    console.log(`Clicking status tab: ${selector}`);
                    element.click();
                    return true;
                }
            }

            // Try by position (status is usually second tab)
            const buttons = Array.from(document.querySelectorAll('div[role="button"]')).filter(el => el.offsetParent !== null);
            if (buttons.length >= 2) {
                console.log('Clicking status by position');
                buttons[1].click();
                return true;
            }

            return false;
        });

        if (!statusClicked) {
            return { success: false, error: 'Could not find status tab' };
        }

        // Wait longer for page to load
        await this.page.waitForTimeout(3000);

        // Step 2: Click Add Status (wait longer)
        console.log(`[${this.sessionId}] 📍 Step 2: Clicking Add Status...`);
        const addStatusClicked = await this.page.evaluate(() => {
            const selectors = [
                '[aria-label*="Add status"]',
                '[aria-label*="הוסף סטטוס"]',
                'span[data-icon="plus"]',
                'div[data-testid="status-v3-my-status"]'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && element.offsetParent !== null) {
                    console.log(`Clicking add status: ${selector}`);
                    element.click();
                    return true;
                }
            }
            return false;
        });

        if (!addStatusClicked) {
            return { success: false, error: 'Could not find add status button' };
        }

        // Wait longer for status creation page
        await this.page.waitForTimeout(4000);

        // Step 3: Click Text option
        console.log(`[${this.sessionId}] 📍 Step 3: Clicking Text option...`);
        const textClicked = await this.page.evaluate(() => {
            const selectors = [
                '[aria-label*="Text"]',
                '[aria-label*="טקסט"]',
                'span[data-icon="text-status"]',
                'span[data-icon="compose"]'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && element.offsetParent !== null) {
                    console.log(`Clicking text option: ${selector}`);
                    element.click();
                    return true;
                }
            }

            // Fallback: look for "Aa" text
            const elements = Array.from(document.querySelectorAll('*')).filter(el =>
                el.textContent === 'Aa' && el.offsetParent !== null
            );
            if (elements.length > 0) {
                console.log('Clicking Aa text element');
                elements[0].click();
                return true;
            }

            return false;
        });

        if (!textClicked) {
            return { success: false, error: 'Could not find text option' };
        }

        // Wait for text composer
        await this.page.waitForTimeout(2000);

        // Step 4: Fill text (with verification)
        console.log(`[${this.sessionId}] 📍 Step 4: Filling text: "${content}"`);
        const textFilled = await this.page.evaluate((content) => {
            const selectors = [
                'div[contenteditable="true"]',
                'textarea',
                'input[type="text"]',
                'div[role="textbox"]'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && element.offsetParent !== null) {
                    console.log(`Found text input: ${selector}`);

                    // Focus first
                    element.focus();

                    // Clear any existing content
                    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
                        element.value = '';
                        element.value = content;
                        // Trigger events
                        element.dispatchEvent(new Event('input', { bubbles: true }));
                        element.dispatchEvent(new Event('change', { bubbles: true }));
                        element.dispatchEvent(new Event('keyup', { bubbles: true }));
                    } else {
                        // For contenteditable
                        element.innerHTML = '';
                        element.textContent = content;
                        // Trigger events
                        element.dispatchEvent(new Event('input', { bubbles: true }));
                        element.dispatchEvent(new Event('change', { bubbles: true }));
                        element.dispatchEvent(new Event('keyup', { bubbles: true }));
                    }

                    // Verify text was set
                    const actualText = element.tagName === 'TEXTAREA' || element.tagName === 'INPUT' ?
                        element.value : element.textContent;

                    console.log(`Text set. Expected: "${content}", Actual: "${actualText}"`);
                    return actualText === content;
                }
            }
            return false;
        }, content);

        if (!textFilled) {
            return { success: false, error: 'Could not fill text input' };
        }

        // Wait after text input
        await this.page.waitForTimeout(1000);

        // Step 5: Send (try multiple methods)
        console.log(`[${this.sessionId}] 📍 Step 5: Sending status...`);

        // Method A: Enter key
        const enterSent = await this.page.evaluate(() => {
            const input = document.querySelector('div[contenteditable="true"], textarea, input');
            if (input) {
                console.log('Trying Enter key...');
                input.focus();

                // Send multiple enter events to be sure
                const events = [
                    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }),
                    new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }),
                    new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })
                ];

                events.forEach(event => input.dispatchEvent(event));
                return true;
            }
            return false;
        });

        if (enterSent) {
            console.log(`[${this.sessionId}] ✅ Enter key sent`);
        } else {
            console.log(`[${this.sessionId}] ⚠️ Enter key failed, trying send button...`);

            // Method B: Send button
            const buttonSent = await this.page.evaluate(() => {
                const selectors = [
                    'span[data-icon="send"]',
                    'button[data-testid="send-status"]',
                    '[aria-label*="Send"]',
                    '[aria-label*="שלח"]'
                ];

                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element && element.offsetParent !== null) {
                        console.log(`Clicking send button: ${selector}`);
                        element.click();
                        return true;
                    }
                }
                return false;
            });

            if (!buttonSent) {
                return { success: false, error: 'Could not send status' };
            }
        }

        // Wait longer to ensure status is sent
        await this.page.waitForTimeout(5000);

        // Take screenshot to verify
        try {
            await this.page.screenshot({
                path: `/tmp/simple_status_result_${this.sessionId}_${Date.now()}.png`,
                fullPage: false
            });
            console.log(`[${this.sessionId}] 📸 Simple status screenshot taken`);
        } catch (e) {
            console.log(`[${this.sessionId}] Screenshot failed:`, e.message);
        }

        const duration = Date.now() - startTime;
        console.log(`[${this.sessionId}] ✅ SIMPLE: Status sent via DOM in ${duration}ms`);

        return {
            success: true,
            method: 'simple_dom',
            message: 'Text status sent via simple DOM method',
            content: content,
            duration: duration
        };
    }

    async sendImageStatus(imageBuffer, caption = '', options = {}) {
        console.log(`[${this.sessionId}] 🎯 SIMPLE: Image status not implemented yet`);
        return { success: false, error: 'Image status not implemented in simple handler' };
    }

    async sendVideoStatus(videoBuffer, caption = '', options = {}) {
        console.log(`[${this.sessionId}] 🎯 SIMPLE: Video status not implemented yet`);
        return { success: false, error: 'Video status not implemented in simple handler' };
    }

    async getMyStatus() {
        console.log(`[${this.sessionId}] 🎯 SIMPLE: Get status not implemented yet`);
        return { success: false, error: 'Get status not implemented in simple handler' };
    }

    async cleanup() {
        console.log(`[${this.sessionId}] Simple status handler cleanup`);
        this.initialized = false;
    }
}

module.exports = SimpleStatusHandler;