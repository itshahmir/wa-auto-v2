class WhatsAppStatusHandler {
    constructor(page, whatsappAutomation) {
        this.page = page;
        this.whatsappAutomation = whatsappAutomation;
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
    async waitForWAJS(statusMethod = null, timeout = 20000) {
        console.log(`Waiting for WA-JS to be ready${statusMethod ? ` with ${statusMethod}` : ''}...`);

        await this.page.waitForFunction((method) => {
            if (typeof window.WPP === 'undefined' || !window.WPP.isFullReady) {
                return false;
            }

            if (!method) return true;

            // Check for specific status method if provided
            if (method === 'sendTextStatus') {
                return window.WPP.status && typeof window.WPP.status.sendTextStatus === 'function';
            } else if (method === 'sendVideoStatus') {
                return window.WPP.status && typeof window.WPP.status.sendVideoStatus === 'function';
            } else if (method === 'sendImageStatus') {
                return window.WPP.status && typeof window.WPP.status.sendImageStatus === 'function';
            }

            return window.WPP.status !== undefined;
        }, statusMethod, { timeout });

        console.log('WA-JS is fully ready');
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

            return {
                ...checks,
                isReady: checks.wppExists && checks.isFullReady && checks.sendTextStatus,
                hasAlternatives: checks.chatExists && (checks.sendMessage || checks.sendFileMessage)
            };
        });
    }

    // Generic status sending method - ultra fast direct
    async sendStatus(type, content, options = {}) {
        console.log(`[${new Date().toISOString()}] Sending ${type} status with ultra-fast method...`);

        try {
            // Set timeout for page operations including keyboard shortcuts
            this.page.setDefaultTimeout(6000);

            const result = await this.page.evaluate(async ({ statusType, statusContent, statusOptions }) => {
                try {
                    console.log(`[${new Date().toISOString()}] Sending ${statusType} NOW...`);

                    // Method 0: Try direct Store manipulation first (fastest for new users)
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
                                statusResult = await window.WPP.status.sendTextStatus(statusContent, statusOptions);
                            } else if (statusType === 'image' && window.WPP.status.sendImageStatus) {
                                console.log(`[${new Date().toISOString()}] Using WPP.status.sendImageStatus...`);
                                statusResult = await window.WPP.status.sendImageStatus(statusContent, statusOptions);
                            } else if (statusType === 'video' && window.WPP.status.sendVideoStatus) {
                                console.log(`[${new Date().toISOString()}] Using WPP.status.sendVideoStatus...`);
                                statusResult = await window.WPP.status.sendVideoStatus(statusContent, statusOptions);
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
                                statusResult = await window.WPP.whatsapp.functions.sendTextStatusMessage(statusContent, statusOptions || {});
                            } else if (statusType === 'image' && window.WPP.whatsapp.functions.sendImageStatusMessage) {
                                console.log(`[${new Date().toISOString()}] Using WPP.whatsapp.functions.sendImageStatusMessage...`);
                                statusResult = await window.WPP.whatsapp.functions.sendImageStatusMessage(statusContent, statusOptions || {});
                            } else if (statusType === 'video' && window.WPP.whatsapp.functions.sendVideoStatusMessage) {
                                console.log(`[${new Date().toISOString()}] Using WPP.whatsapp.functions.sendVideoStatusMessage...`);
                                statusResult = await window.WPP.whatsapp.functions.sendVideoStatusMessage(statusContent, statusOptions || {});
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
                                statusResult = await window.WPP.chat.sendTextMessage('status@broadcast', statusContent);
                            } else if (statusType === 'image' && window.WPP.chat.sendFileMessage) {
                                console.log(`[${new Date().toISOString()}] Using WPP.chat.sendFileMessage for image as last resort...`);
                                statusResult = await window.WPP.chat.sendFileMessage('status@broadcast', statusContent, statusOptions);
                            } else if (statusType === 'video' && window.WPP.chat.sendFileMessage) {
                                console.log(`[${new Date().toISOString()}] Using WPP.chat.sendFileMessage for video as last resort...`);
                                statusResult = await window.WPP.chat.sendFileMessage('status@broadcast', statusContent, statusOptions);
                            }

                            if (statusResult) {
                                console.log(`[${new Date().toISOString()}] SUCCESS via WPP.chat - ${statusType} sent!`, statusResult);
                                return { success: true, method: 'wpp_chat', result: statusResult };
                            }
                        } catch (chatError) {
                            console.log(`[${new Date().toISOString()}] WPP.chat failed:`, chatError.message);
                        }
                    }

                    // Ultra-fast fallback - minimal options
                    console.log(`[${new Date().toISOString()}] Trying ultra-fast fallback...`);
                    throw new Error(`Failed to send ${statusType} status - WPP.chat not available`);

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
        return this.sendStatus('text', content, options);
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
                                'status@broadcast',
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
                                'status@broadcast',
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
                            broadcastChat = await window.WPP.chat.get('status@broadcast');
                        }

                        if (!broadcastChat && window.WPP.whatsapp && window.WPP.whatsapp.ChatStore) {
                            broadcastChat = window.WPP.whatsapp.ChatStore.get('status@broadcast');
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
                                    remoteJid: 'status@broadcast',
                                    fromMe: true,
                                    id: msg.id._serialized || msg.id.id || msg.id
                                },
                                message: {
                                    protocolMessage: {
                                        type: 0, // REVOKE type
                                        key: {
                                            remoteJid: 'status@broadcast',
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
                            let cmdChat = window.WPP.whatsapp.ChatStore.get('status@broadcast');
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

    async getMyStatus() {
        console.log('Getting my status...');

        try {
            // Wait for WA-JS to be ready
            await this.waitForWAJS();

            // Only click status button if it's actually needed for the operation
            // For just reading status data, we don't need to click the UI button


            const myStatusRaw = await this.page.evaluate(async () => {
                try {
                    if (window.WPP.status && window.WPP.status.getMyStatus) {
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
                    throw new Error('getMyStatus function not available');
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
            throw error;
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