/**
 * Integration Example: Adding Phone Number Retrieval to WhatsAppAutomation
 *
 * This shows how to integrate phone number retrieval into your existing
 * WhatsApp automation workflow
 */

const { WhatsAppAutomation } = require('../index');

class EnhancedWhatsAppAutomation extends WhatsAppAutomation {
    constructor(sessionId, options = {}) {
        super(sessionId, options);
        this.authenticatedPhoneNumber = null;
    }

    /**
     * Override setupAuthenticationEvents to capture phone number on authentication
     */
    async setupAuthenticationEvents() {
        await super.setupAuthenticationEvents();

        // Add event listener for authentication
        await this.page.evaluate(() => {
            if (window.WPP && window.WPP.conn) {
                window.WPP.conn.on('authenticated', async () => {
                    // Emit custom event with phone number
                    if (window.WPP.conn.me) {
                        window.dispatchEvent(new CustomEvent('wa-phone-authenticated', {
                            detail: {
                                phoneNumber: window.WPP.conn.me.user,
                                fullWid: window.WPP.conn.me.toString(),
                                timestamp: Date.now()
                            }
                        }));
                    }
                });
            }
        });

        // Listen for the custom event in Node.js context
        await this.page.exposeFunction('onPhoneAuthenticated', (data) => {
            this.authenticatedPhoneNumber = data.phoneNumber;
            console.log(`[${this.sessionId}] ✅ Authenticated with phone: ${data.phoneNumber}`);
            this.emit('phoneAuthenticated', data);
        });

        await this.page.evaluate(() => {
            window.addEventListener('wa-phone-authenticated', (event) => {
                window.onPhoneAuthenticated(event.detail);
            });
        });
    }

    /**
     * Get the authenticated phone number
     * @returns {Promise<string|null>}
     */
    async getAuthenticatedPhoneNumber() {
        // Try cached value first
        if (this.authenticatedPhoneNumber) {
            return this.authenticatedPhoneNumber;
        }

        // Fetch from WA-JS if not cached
        try {
            const phoneData = await this.page.evaluate(() => {
                // Method 1: Try WPP.conn.me first (most reliable)
                if (window.WPP && window.WPP.conn && window.WPP.conn.me) {
                    return {
                        phoneNumber: window.WPP.conn.me.user,
                        fullWid: window.WPP.conn.me.toString(),
                        server: window.WPP.conn.me.server
                    };
                }

                // Method 2: Fallback to UserPrefs
                if (window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.UserPrefs) {
                    const myWid = window.WPP.whatsapp.UserPrefs.getMaybeMePnUser();
                    if (myWid) {
                        return {
                            phoneNumber: myWid.user,
                            fullWid: myWid.toString(),
                            server: myWid.server
                        };
                    }
                }

                return null;
            });

            if (phoneData) {
                this.authenticatedPhoneNumber = phoneData.phoneNumber;
                return phoneData.phoneNumber;
            }
        } catch (error) {
            console.error(`[${this.sessionId}] Error getting phone number:`, error);
        }

        return null;
    }

    /**
     * Get detailed user information
     * @returns {Promise<Object>}
     */
    async getUserInfo() {
        try {
            return await this.page.evaluate(async () => {
                const info = {
                    phone: null,
                    wid: null,
                    pushname: null,
                    platform: null,
                    isMultiDevice: false,
                    profilePic: null,
                    status: null,
                    about: null
                };

                // Get phone number and WID
                if (window.WPP && window.WPP.conn && window.WPP.conn.me) {
                    info.phone = window.WPP.conn.me.user;
                    info.wid = window.WPP.conn.me.toString();
                }

                // Get connection info
                if (window.WPP && window.WPP.conn) {
                    info.isMultiDevice = window.WPP.conn.isMultiDevice();
                    if (window.WPP.conn.getPlatform) {
                        info.platform = window.WPP.conn.getPlatform();
                    }
                }

                // Get profile info
                if (window.WPP && window.WPP.profile) {
                    try {
                        // Get pushname (display name)
                        if (window.WPP.profile.getPushname) {
                            info.pushname = await window.WPP.profile.getPushname();
                        }

                        // Get status/about
                        const myStatus = await window.WPP.profile.getMyStatus();
                        if (myStatus) {
                            info.status = myStatus.status;
                        }

                        // Get profile picture
                        const profilePic = await window.WPP.profile.getMyProfilePicThumb();
                        if (profilePic && profilePic.imgFull) {
                            info.profilePic = profilePic.imgFull;
                        }
                    } catch (error) {
                        console.error('Error getting profile info:', error);
                    }
                }

                // Get about/bio if available
                if (window.WPP && window.WPP.profile && window.WPP.profile.getMyAbout) {
                    try {
                        info.about = await window.WPP.profile.getMyAbout();
                    } catch (error) {
                        // About might not be available
                    }
                }

                return info;
            });
        } catch (error) {
            console.error(`[${this.sessionId}] Error getting user info:`, error);
            return null;
        }
    }

    /**
     * Wait for authentication and return phone number
     * @param {number} timeout
     * @returns {Promise<string|null>}
     */
    async waitForAuthentication(timeout = 60000) {
        console.log(`[${this.sessionId}] Waiting for authentication...`);
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const isAuth = await this.isAuthenticated();

            if (isAuth) {
                const phone = await this.getAuthenticatedPhoneNumber();
                if (phone) {
                    console.log(`[${this.sessionId}] ✅ Authenticated as: ${phone}`);
                    return phone;
                }
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`[${this.sessionId}] ⏱️ Authentication timeout`);
        return null;
    }

    /**
     * Enhanced run method that captures phone number
     */
    async run(authMethod = 'auto', phoneNumberForPairing = null) {
        const result = await super.run(authMethod, phoneNumberForPairing);

        if (result.success) {
            // Get and store the authenticated phone number
            const authenticatedPhone = await this.getAuthenticatedPhoneNumber();
            if (authenticatedPhone) {
                result.phoneNumber = authenticatedPhone;
                result.userInfo = await this.getUserInfo();
                console.log(`[${this.sessionId}] Session info:`, {
                    phoneNumber: result.phoneNumber,
                    pushname: result.userInfo?.pushname,
                    platform: result.userInfo?.platform,
                    isMultiDevice: result.userInfo?.isMultiDevice
                });
            }
        }

        return result;
    }
}

// Usage example
async function main() {
    const sessionId = 'enhanced-session-' + Date.now();
    const automation = new EnhancedWhatsAppAutomation(sessionId, {
        headless: false
    });

    try {
        // Listen for phone authentication event
        automation.on('phoneAuthenticated', (data) => {
            console.log('📱 Phone authenticated event:', data);
        });

        // Run automation
        const result = await automation.run('qr');

        if (result.success) {
            console.log('\n✅ Successfully authenticated!');
            console.log('Phone Number:', result.phoneNumber);
            console.log('User Info:', result.userInfo);

            // You can now use the phone number for session tracking
            // For example, update your database with the phone number
            await updateDatabase(sessionId, result.phoneNumber, result.userInfo);

            // Test getting phone number again
            const phone = await automation.getAuthenticatedPhoneNumber();
            console.log('Verified phone number:', phone);

            // Get fresh user info
            const userInfo = await automation.getUserInfo();
            console.log('Fresh user info:', userInfo);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// Mock database update function
async function updateDatabase(sessionId, phoneNumber, userInfo) {
    console.log('Updating database with session info:', {
        sessionId,
        phoneNumber,
        pushname: userInfo?.pushname,
        platform: userInfo?.platform
    });
    // Your actual database update logic here
}

// Export the enhanced class
module.exports = {
    EnhancedWhatsAppAutomation
};

// Run if executed directly
if (require.main === module) {
    main().catch(console.error);
}