/**
 * Enhanced WhatsApp Status Handler using direct WebSocket methods
 * This implementation bypasses browser UI and DOM manipulation for better reliability
 */
const { STATUS_BROADCAST_JID } = require('../utils/statusUtils');

class WebSocketStatusHandler {
    constructor(page, whatsappAutomation) {
        this.page = page;
        this.whatsappAutomation = whatsappAutomation;
        this.maxRetries = 3;
        this.retryDelay = 1000; // Start with 1 second
    }

    /**
     * Wait for WA-JS to be fully ready with enhanced checks
     */
    async waitForWAJS(timeout = 15000) {
        console.log('Waiting for WA-JS WebSocket readiness...');

        try {
            await this.page.waitForFunction(() => {
                // Check basic WPP availability
                if (typeof window.WPP === 'undefined') {
                    console.log('WPP not available yet');
                    return false;
                }

                // Critical: Must be fully ready
                if (!window.WPP.isFullReady) {
                    console.log('WPP not fully ready yet');
                    return false;
                }

                // Check for WebSocket-based functions
                if (window.WPP.whatsapp && window.WPP.whatsapp.functions) {
                    if (typeof window.WPP.whatsapp.functions.encryptAndSendStatusMsg === 'function') {
                        console.log('Direct WebSocket method available');
                        return true;
                    }
                }

                // Check for Store.StatusV3
                if (window.Store && window.Store.StatusV3 && window.Store.StatusV3.sendMessage) {
                    console.log('Store.StatusV3 method available');
                    return true;
                }

                // Check for WPP.status as fallback
                if (window.WPP.status && window.WPP.status.sendTextStatus) {
                    console.log('WPP.status methods available');
                    return true;
                }

                console.log('No suitable status methods found yet');
                return false;
            }, {}, { timeout });

            console.log('WA-JS is ready for WebSocket operations');
        } catch (error) {
            console.error('WA-JS readiness timeout:', error.message);
            throw new Error('WA-JS failed to initialize properly for WebSocket operations');
        }
    }

    /**
     * Enhanced status sending using direct WebSocket methods
     */
    async sendStatus(type, content, options = {}) {
        console.log(`[${new Date().toISOString()}] Sending ${type} status via WebSocket methods...`);

        // Ensure WA-JS is ready
        await this.waitForWAJS();

        // Validate browser context
        if (!this.page || this.page.isClosed()) {
            throw new Error('Browser page is closed');
        }

        // Set default options
        options = {
            waitForAck: true,
            createChat: true,
            ...options
        };

        let lastError;

        // Method 1: Direct WebSocket encryption and send (most reliable)
        try {
            const result = await this.sendViaDirectWebSocket(type, content, options);
            if (result.success) {
                console.log(`✅ Status sent via direct WebSocket: ${type}`);
                return result;
            }
        } catch (error) {
            console.log(`❌ Direct WebSocket failed: ${error.message}`);
            lastError = error;
        }

        // Method 2: Enhanced Store.StatusV3 with retry logic
        try {
            const result = await this.sendViaStatusV3Store(type, content, options);
            if (result.success) {
                console.log(`✅ Status sent via StatusV3 Store: ${type}`);
                return result;
            }
        } catch (error) {
            console.log(`❌ StatusV3 Store failed: ${error.message}`);
            lastError = error;
        }

        // Method 3: Direct protocol message construction
        try {
            const result = await this.sendViaProtocolMessage(type, content, options);
            if (result.success) {
                console.log(`✅ Status sent via protocol message: ${type}`);
                return result;
            }
        } catch (error) {
            console.log(`❌ Protocol message failed: ${error.message}`);
            lastError = error;
        }

        // Method 4: Enhanced WPP.status with better error handling
        try {
            const result = await this.sendViaWPPStatus(type, content, options);
            if (result.success) {
                console.log(`✅ Status sent via WPP.status: ${type}`);
                return result;
            }
        } catch (error) {
            console.log(`❌ WPP.status failed: ${error.message}`);
            lastError = error;
        }

        // All methods failed
        throw new Error(`Failed to send ${type} status after trying all WebSocket methods. Last error: ${lastError.message}`);
    }

    /**
     * Method 1: Direct WebSocket encryption and sending
     */
    async sendViaDirectWebSocket(type, content, options) {
        return await this.page.evaluate(async ({ statusType, statusContent, statusOptions }) => {
            try {
                // Check if direct WebSocket function is available
                if (!window.WPP.whatsapp || !window.WPP.whatsapp.functions || !window.WPP.whatsapp.functions.encryptAndSendStatusMsg) {
                    throw new Error('encryptAndSendStatusMsg not available');
                }

                console.log('Using direct WebSocket encryption method...');

                // Generate unique message ID
                const messageId = window.WPP.whatsapp.functions.generateId ?
                    window.WPP.whatsapp.functions.generateId() :
                    Math.random().toString(36).substr(2, 16);

                let statusMessage;

                if (statusType === 'text') {
                    // Create text status message
                    statusMessage = {
                        key: {
                            remoteJid: STATUS_BROADCAST_JID,
                            fromMe: true,
                            id: messageId
                        },
                        message: {
                            extendedTextMessage: {
                                text: statusContent,
                                previewType: 0
                            }
                        },
                        messageTimestamp: Math.floor(Date.now() / 1000),
                        status: 1 // PENDING
                    };
                } else if (statusType === 'image') {
                    // Handle image status
                    statusMessage = {
                        key: {
                            remoteJid: STATUS_BROADCAST_JID,
                            fromMe: true,
                            id: messageId
                        },
                        message: {
                            imageMessage: {
                                // Image data would be processed here
                                caption: statusOptions.caption || '',
                                jpegThumbnail: statusContent // Assuming base64 content
                            }
                        },
                        messageTimestamp: Math.floor(Date.now() / 1000),
                        status: 1
                    };
                } else if (statusType === 'video') {
                    // Handle video status
                    statusMessage = {
                        key: {
                            remoteJid: STATUS_BROADCAST_JID,
                            fromMe: true,
                            id: messageId
                        },
                        message: {
                            videoMessage: {
                                caption: statusOptions.caption || '',
                                // Video data would be processed here
                            }
                        },
                        messageTimestamp: Math.floor(Date.now() / 1000),
                        status: 1
                    };
                }

                // Send via direct WebSocket encryption
                const result = await window.WPP.whatsapp.functions.encryptAndSendStatusMsg(
                    statusMessage,
                    {
                        messageId,
                        waitForAck: statusOptions.waitForAck
                    }
                );

                return {
                    success: true,
                    method: 'direct_websocket',
                    messageId: messageId,
                    result: result
                };

            } catch (error) {
                console.error('Direct WebSocket method failed:', error);
                throw error;
            }
        }, { statusType: type, statusContent: content, statusOptions: options });
    }

    /**
     * Method 2: Enhanced Store.StatusV3 with retry logic
     */
    async sendViaStatusV3Store(type, content, options) {
        return await this.retryWithExponentialBackoff(async () => {
            return await this.page.evaluate(async ({ statusType, statusContent, statusOptions }) => {
                try {
                    // Check Store.StatusV3 availability
                    if (!window.Store || !window.Store.StatusV3 || !window.Store.StatusV3.sendMessage) {
                        throw new Error('Store.StatusV3.sendMessage not available');
                    }

                    console.log('Using enhanced Store.StatusV3 method...');

                    let statusMsg;

                    if (statusType === 'text') {
                        statusMsg = {
                            type: 'text',
                            body: statusContent,
                            isViewOnce: false,
                            ...statusOptions
                        };
                    } else if (statusType === 'image') {
                        statusMsg = {
                            type: 'image',
                            body: statusContent,
                            caption: statusOptions.caption || '',
                            isViewOnce: false,
                            ...statusOptions
                        };
                    } else if (statusType === 'video') {
                        statusMsg = {
                            type: 'video',
                            body: statusContent,
                            caption: statusOptions.caption || '',
                            isViewOnce: false,
                            ...statusOptions
                        };
                    }

                    // Send with timeout protection
                    const sendPromise = window.Store.StatusV3.sendMessage(statusMsg);
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('StatusV3 send timeout')), 10000)
                    );

                    const result = await Promise.race([sendPromise, timeoutPromise]);

                    return {
                        success: true,
                        method: 'store_status_v3_enhanced',
                        result: result
                    };

                } catch (error) {
                    console.error('Enhanced Store.StatusV3 failed:', error);
                    throw error;
                }
            }, { statusType: type, statusContent: content, statusOptions: options });
        });
    }

    /**
     * Method 3: Direct protocol message construction
     */
    async sendViaProtocolMessage(type, content, options) {
        return await this.page.evaluate(async ({ statusType, statusContent, statusOptions }) => {
            try {
                console.log('Using direct protocol message construction...');

                // Get WebSocket connection
                if (!window.WPP.whatsapp.Stream || !window.WPP.whatsapp.Stream.sendNode) {
                    throw new Error('WebSocket Stream not available');
                }

                // Generate message ID
                const msgId = Math.random().toString(36).substr(2, 16);

                // Construct protocol buffer message
                const protocolMsg = {
                    tag: 'message',
                    attrs: {
                        id: msgId,
                        type: 'chat',
                        to: STATUS_BROADCAST_JID
                    },
                    content: []
                };

                if (statusType === 'text') {
                    protocolMsg.content.push({
                        tag: 'body',
                        content: statusContent
                    });
                }

                // Send directly via WebSocket
                await window.WPP.whatsapp.Stream.sendNode(protocolMsg);

                return {
                    success: true,
                    method: 'direct_protocol',
                    messageId: msgId
                };

            } catch (error) {
                console.error('Direct protocol method failed:', error);
                throw error;
            }
        }, { statusType: type, statusContent: content, statusOptions: options });
    }

    /**
     * Method 4: Enhanced WPP.status with better error handling
     */
    async sendViaWPPStatus(type, content, options) {
        return await this.retryWithExponentialBackoff(async () => {
            return await this.page.evaluate(async ({ statusType, statusContent, statusOptions }) => {
                try {
                    if (!window.WPP.status) {
                        throw new Error('WPP.status not available');
                    }

                    console.log('Using enhanced WPP.status method...');

                    let result;
                    const timeout = 8000;

                    if (statusType === 'text' && window.WPP.status.sendTextStatus) {
                        const sendPromise = window.WPP.status.sendTextStatus(statusContent, statusOptions);
                        const timeoutPromise = new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('sendTextStatus timeout')), timeout)
                        );
                        result = await Promise.race([sendPromise, timeoutPromise]);
                    } else if (statusType === 'image' && window.WPP.status.sendImageStatus) {
                        const sendPromise = window.WPP.status.sendImageStatus(statusContent, statusOptions);
                        const timeoutPromise = new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('sendImageStatus timeout')), timeout)
                        );
                        result = await Promise.race([sendPromise, timeoutPromise]);
                    } else if (statusType === 'video' && window.WPP.status.sendVideoStatus) {
                        const sendPromise = window.WPP.status.sendVideoStatus(statusContent, statusOptions);
                        const timeoutPromise = new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('sendVideoStatus timeout')), timeout)
                        );
                        result = await Promise.race([sendPromise, timeoutPromise]);
                    } else {
                        throw new Error(`WPP.status method for ${statusType} not available`);
                    }

                    return {
                        success: true,
                        method: 'wpp_status_enhanced',
                        result: result
                    };

                } catch (error) {
                    console.error('Enhanced WPP.status failed:', error);
                    throw error;
                }
            }, { statusType: type, statusContent: content, statusOptions: options });
        });
    }

    /**
     * Retry mechanism with exponential backoff
     */
    async retryWithExponentialBackoff(operation, maxRetries = this.maxRetries) {
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Attempt ${attempt}/${maxRetries}`);
                const result = await operation();
                return result;
            } catch (error) {
                lastError = error;
                console.log(`Attempt ${attempt} failed: ${error.message}`);

                if (attempt < maxRetries) {
                    const delay = this.retryDelay * Math.pow(2, attempt - 1);
                    console.log(`Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    }

    /**
     * Public API methods
     */
    async sendTextStatus(content, options = {}) {
        return this.sendStatus('text', content, options);
    }

    async sendImageStatus(content, options = {}) {
        return this.sendStatus('image', content, options);
    }

    async sendVideoStatus(content, options = {}) {
        return this.sendStatus('video', content, options);
    }

    /**
     * Get status information (reuse existing method from old handler)
     */
    async getMyStatus() {
        await this.waitForWAJS();

        return await this.page.evaluate(async () => {
            try {
                if (window.WPP.status && window.WPP.status.getMyStatus) {
                    return await window.WPP.status.getMyStatus();
                }

                // Fallback to Store
                if (window.Store && window.Store.StatusV3) {
                    const myWid = window.WPP.whatsapp.UserPrefs.getMaybeMePnUser();
                    if (myWid) {
                        return window.Store.StatusV3.get(myWid);
                    }
                }

                return null;
            } catch (error) {
                console.error('Error getting status:', error);
                throw error;
            }
        });
    }
}

module.exports = WebSocketStatusHandler;