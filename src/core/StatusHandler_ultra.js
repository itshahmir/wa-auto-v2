class UltraStatusHandler {
    constructor(page, sessionId) {
        this.page = page;
        this.sessionId = sessionId;
        this.initialized = false;
        this.debugMode = true;
    }

    async initialize() {
        if (this.initialized) return;
        console.log(`[${this.sessionId}] 🚀 Initializing ULTRA status handler...`);

        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(3000);

        this.initialized = true;
        console.log(`[${this.sessionId}] ✅ ULTRA status handler ready`);
    }

    async debugScreenshot(step) {
        if (this.debugMode) {
            try {
                await this.page.screenshot({
                    path: `/tmp/debug_${step}_${this.sessionId}_${Date.now()}.png`,
                    fullPage: false
                });
                console.log(`[${this.sessionId}] 📸 Debug screenshot: ${step}`);
            } catch (e) {
                console.log(`[${this.sessionId}] Screenshot failed for ${step}:`, e.message);
            }
        }
    }

    async sendTextStatus(content, options = {}) {
        console.log(`[${this.sessionId}] 🚀 ULTRA: Sending text status: "${content}"`);

        try {
            await this.debugScreenshot('01_start');

            // Step 1: Ensure we're on WhatsApp Web main page
            const currentUrl = await this.page.url();
            if (!currentUrl.includes('web.whatsapp.com')) {
                console.log(`[${this.sessionId}] Not on WhatsApp Web, navigating...`);
                await this.page.goto('https://web.whatsapp.com');
                await this.page.waitForTimeout(3000);
            }

            await this.debugScreenshot('02_on_whatsapp');

            // Step 2: Navigate to Status tab with multiple attempts
            console.log(`[${this.sessionId}] 📍 Step 2: Finding Status tab...`);
            let statusTabFound = false;

            // Method 1: Try icon-based selectors
            statusTabFound = await this.page.evaluate(() => {
                const iconSelectors = [
                    'span[data-icon="status"]',
                    'svg[data-icon="status"]',
                    '[data-testid="status-tab"]',
                    '[data-tab="3"]'
                ];

                for (const selector of iconSelectors) {
                    const element = document.querySelector(selector);
                    if (element && element.offsetParent !== null) {
                        console.log(`Found status tab with: ${selector}`);
                        element.scrollIntoView();
                        element.click();
                        return true;
                    }
                }
                return false;
            });

            if (!statusTabFound) {
                // Method 2: Try by position (usually 2nd tab)
                statusTabFound = await this.page.evaluate(() => {
                    const tabs = Array.from(document.querySelectorAll('div[role="button"]'))
                        .filter(el => el.offsetParent !== null);

                    if (tabs.length >= 3) {
                        console.log('Trying status tab by position (2nd)');
                        tabs[1].click(); // Status is usually 2nd tab
                        return true;
                    }
                    return false;
                });
            }

            if (!statusTabFound) {
                return { success: false, error: 'Status tab not found' };
            }

            console.log(`[${this.sessionId}] ✅ Status tab clicked`);
            await this.page.waitForTimeout(2000);
            await this.debugScreenshot('03_status_tab_clicked');

            // Step 3: Look for and click the "+" or "Add Status" button
            console.log(`[${this.sessionId}] 📍 Step 3: Finding Add Status button...`);

            let addStatusFound = false;
            const addStatusSelectors = [
                // Hebrew interface
                '[aria-label*="הוסף סטטוס"]',
                '[aria-label*="הסטטוס שלי"]',
                // English interface
                '[aria-label*="Add status"]',
                '[aria-label*="My status"]',
                // Icon-based
                'span[data-icon="plus"]',
                'svg[data-icon="plus"]',
                'span[data-icon="add"]',
                // Generic selectors
                'div[data-testid="status-v3-my-status"]',
                'div[data-testid="my-status"]',
                'button[aria-label="My status"]'
            ];

            for (const selector of addStatusSelectors) {
                addStatusFound = await this.page.evaluate((sel) => {
                    const element = document.querySelector(sel);
                    if (element && element.offsetParent !== null) {
                        console.log(`Found add status button with: ${sel}`);
                        element.scrollIntoView();
                        element.click();
                        return true;
                    }
                    return false;
                }, selector);

                if (addStatusFound) break;
                await this.page.waitForTimeout(500);
            }

            // Fallback: Look for any button with green background (WhatsApp's add button color)
            if (!addStatusFound) {
                addStatusFound = await this.page.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('div, button'))
                        .filter(el => {
                            const style = window.getComputedStyle(el);
                            return style.backgroundColor.includes('0, 150, 136') || // WhatsApp green
                                   style.backgroundColor.includes('0, 168, 132') ||
                                   el.getAttribute('aria-label')?.includes('status') ||
                                   el.getAttribute('aria-label')?.includes('סטטוס');
                        });

                    if (elements.length > 0) {
                        console.log('Found status button by color/aria-label');
                        elements[0].click();
                        return true;
                    }
                    return false;
                });
            }

            if (!addStatusFound) {
                await this.debugScreenshot('04_add_status_not_found');
                return { success: false, error: 'Add Status button not found' };
            }

            console.log(`[${this.sessionId}] ✅ Add Status button clicked`);
            await this.page.waitForTimeout(3000);
            await this.debugScreenshot('05_after_add_status');

            // Step 4: Look for text option (Aa or text icon)
            console.log(`[${this.sessionId}] 📍 Step 4: Finding Text option...`);

            let textOptionFound = false;
            const textSelectors = [
                // Hebrew interface
                '[aria-label*="טקסט"]',
                // English interface
                '[aria-label*="Text"]',
                // Icon-based
                'span[data-icon="text-status"]',
                'span[data-icon="compose"]',
                'svg[data-icon="text-status"]',
                'svg[data-icon="compose"]',
                // Test IDs
                'div[data-testid="text-status-composer"]'
            ];

            for (const selector of textSelectors) {
                textOptionFound = await this.page.evaluate((sel) => {
                    const element = document.querySelector(sel);
                    if (element && element.offsetParent !== null) {
                        console.log(`Found text option with: ${sel}`);
                        element.scrollIntoView();
                        element.click();
                        return true;
                    }
                    return false;
                }, selector);

                if (textOptionFound) break;
                await this.page.waitForTimeout(500);
            }

            // Fallback: Look for "Aa" text or first clickable option
            if (!textOptionFound) {
                textOptionFound = await this.page.evaluate(() => {
                    // Look for "Aa" text specifically
                    const elements = Array.from(document.querySelectorAll('*'))
                        .filter(el => {
                            const text = el.textContent?.trim();
                            return text === 'Aa' || text === 'Text' || text === 'טקסט';
                        });

                    if (elements.length > 0) {
                        console.log('Found text option by content search');
                        elements[0].click();
                        return true;
                    }

                    // Fallback: click first button/div after status creation
                    const buttons = Array.from(document.querySelectorAll('div[role="button"], button'))
                        .filter(el => el.offsetParent !== null);

                    if (buttons.length > 0) {
                        console.log('Clicking first available button as text option');
                        buttons[0].click();
                        return true;
                    }

                    return false;
                });
            }

            if (!textOptionFound) {
                await this.debugScreenshot('06_text_option_not_found');
                return { success: false, error: 'Text option not found' };
            }

            console.log(`[${this.sessionId}] ✅ Text option clicked`);
            await this.page.waitForTimeout(2000);
            await this.debugScreenshot('07_text_option_clicked');

            // Step 5: Find text input and enter content
            console.log(`[${this.sessionId}] 📍 Step 5: Finding text input...`);

            const textInputFound = await this.page.evaluate((content) => {
                const inputSelectors = [
                    'div[data-testid="status-text-input"]',
                    'div[contenteditable="true"]',
                    'textarea[placeholder*="Type"]',
                    'textarea[placeholder*="הקלד"]',
                    'input[type="text"]',
                    'div[role="textbox"]',
                    'div[data-tab="10"]',
                    'div.selectable-text[contenteditable="true"]'
                ];

                for (const selector of inputSelectors) {
                    const element = document.querySelector(selector);
                    if (element && element.offsetParent !== null) {
                        console.log(`Found text input with: ${selector}`);

                        // Focus and clear
                        element.focus();
                        element.scrollIntoView();

                        // Set content based on element type
                        if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
                            element.value = '';
                            element.value = content;
                            element.dispatchEvent(new Event('input', { bubbles: true }));
                            element.dispatchEvent(new Event('change', { bubbles: true }));
                        } else {
                            // For contenteditable
                            element.innerHTML = '';
                            element.textContent = content;
                            element.dispatchEvent(new Event('input', { bubbles: true }));
                            element.dispatchEvent(new Event('change', { bubbles: true }));
                        }

                        console.log(`Text set to: "${content}"`);
                        return true;
                    }
                }
                return false;
            }, content);

            if (!textInputFound) {
                await this.debugScreenshot('08_text_input_not_found');
                return { success: false, error: 'Text input field not found' };
            }

            console.log(`[${this.sessionId}] ✅ Text input filled with: "${content}"`);
            await this.page.waitForTimeout(2000);
            await this.debugScreenshot('09_text_filled');

            // Step 6: Send the status
            console.log(`[${this.sessionId}] 📍 Step 6: Sending status...`);

            // Method 1: Try Enter key first
            let sendSuccess = await this.page.evaluate(() => {
                const input = document.querySelector('div[contenteditable="true"], textarea, input[type="text"]');
                if (input) {
                    console.log('Sending Enter key...');
                    input.focus();

                    // Try multiple Enter key events
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

            if (sendSuccess) {
                console.log(`[${this.sessionId}] ✅ Enter key sent`);
                await this.page.waitForTimeout(2000);
            } else {
                // Method 2: Look for send button
                console.log(`[${this.sessionId}] Trying send button...`);

                const sendSelectors = [
                    // Hebrew
                    'button[aria-label="שלח"]',
                    '[aria-label*="שלח"]',
                    // English
                    'button[aria-label="Send"]',
                    '[aria-label*="Send"]',
                    // Icons
                    'span[data-icon="send"]',
                    'span[data-icon="send-light"]',
                    'svg[data-icon="send"]',
                    // Test IDs
                    'button[data-testid="send-status"]',
                    'div[data-testid="compose-btn-send"]'
                ];

                for (const selector of sendSelectors) {
                    sendSuccess = await this.page.evaluate((sel) => {
                        const element = document.querySelector(sel);
                        if (element && element.offsetParent !== null) {
                            console.log(`Found send button with: ${sel}`);
                            element.click();
                            return true;
                        }
                        return false;
                    }, selector);

                    if (sendSuccess) break;
                    await this.page.waitForTimeout(500);
                }
            }

            if (!sendSuccess) {
                await this.debugScreenshot('10_send_failed');
                return { success: false, error: 'Could not send status' };
            }

            // Wait and take final screenshot
            await this.page.waitForTimeout(3000);
            await this.debugScreenshot('11_final_result');

            console.log(`[${this.sessionId}] 🎉 ULTRA: Status sent successfully!`);
            return {
                success: true,
                method: 'ultra_dom',
                message: `Text status "${content}" sent successfully`,
                content: content
            };

        } catch (error) {
            console.error(`[${this.sessionId}] ❌ ULTRA Error:`, error.message);
            await this.debugScreenshot('99_error');
            return { success: false, error: error.message };
        }
    }

    async sendImageStatus(imageBuffer, caption = '', options = {}) {
        console.log(`[${this.sessionId}] 🚀 ULTRA: Image status not implemented yet`);
        return { success: false, error: 'Image status not implemented in ultra handler' };
    }

    async sendVideoStatus(videoBuffer, caption = '', options = {}) {
        console.log(`[${this.sessionId}] 🚀 ULTRA: Video status not implemented yet`);
        return { success: false, error: 'Video status not implemented in ultra handler' };
    }

    async getMyStatus() {
        console.log(`[${this.sessionId}] 🚀 ULTRA: Get status not implemented yet`);
        return { success: false, error: 'Get status not implemented in ultra handler' };
    }

    async cleanup() {
        console.log(`[${this.sessionId}] ULTRA status handler cleanup`);
        this.initialized = false;
    }
}

module.exports = UltraStatusHandler;