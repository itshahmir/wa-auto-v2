/**
 * Getting the Currently Authenticated Phone Number in WA-JS
 *
 * This example demonstrates various methods to retrieve the phone number
 * of the authenticated WhatsApp account using WA-JS/WPPConnect
 */

// Method 1: Using WPP.conn.me (RECOMMENDED - Most Direct)
// Returns a Wid object with the phone number
async function getPhoneNumberMethod1(page) {
    return await page.evaluate(() => {
        if (window.WPP && window.WPP.conn && window.WPP.conn.me) {
            // Returns Wid object like: { user: "1234567890", server: "c.us" }
            const meWid = window.WPP.conn.me;

            return {
                fullWid: meWid.toString(),           // "1234567890@c.us"
                phoneNumber: meWid.user,             // "1234567890" (just the number)
                server: meWid.server,                // "c.us" (for regular accounts)
                serialized: meWid._serialized        // "1234567890@c.us" (full format)
            };
        }
        return null;
    });
}

// Method 2: Using WPP.whatsapp.UserPrefs.getMaybeMePnUser()
// Returns the user's Wid, useful when checking status operations
async function getPhoneNumberMethod2(page) {
    return await page.evaluate(() => {
        if (window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.UserPrefs) {
            // Returns Wid object for the current user
            const myWid = window.WPP.whatsapp.UserPrefs.getMaybeMePnUser();

            if (myWid) {
                return {
                    fullWid: myWid.toString(),
                    phoneNumber: myWid.user,
                    server: myWid.server,
                    serialized: myWid._serialized
                };
            }
        }
        return null;
    });
}

// Method 3: Using WPP.whatsapp.UserPrefs.getMeUser()
// Similar to getMaybeMePnUser but might throw if not authenticated
async function getPhoneNumberMethod3(page) {
    return await page.evaluate(() => {
        if (window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.UserPrefs) {
            try {
                const meUser = window.WPP.whatsapp.UserPrefs.getMeUser();
                if (meUser) {
                    return {
                        fullWid: meUser.toString(),
                        phoneNumber: meUser.user,
                        server: meUser.server,
                        serialized: meUser._serialized
                    };
                }
            } catch (error) {
                console.error('getMeUser error:', error);
            }
        }
        return null;
    });
}

// Method 4: Using Store.Conn.me (if Store is exposed)
async function getPhoneNumberMethod4(page) {
    return await page.evaluate(() => {
        if (window.Store && window.Store.Conn && window.Store.Conn.me) {
            const meWid = window.Store.Conn.me;

            return {
                fullWid: meWid.toString(),
                phoneNumber: meWid.user,
                server: meWid.server,
                serialized: meWid._serialized
            };
        }
        return null;
    });
}

// Method 5: Using WPP.profile.getMyProfilePicThumb() to indirectly confirm identity
// This gets the profile picture which contains the Wid
async function getPhoneNumberMethod5(page) {
    return await page.evaluate(async () => {
        if (window.WPP && window.WPP.profile) {
            try {
                const profilePic = await window.WPP.profile.getMyProfilePicThumb();
                // profilePic.wid contains the user's Wid
                if (profilePic && profilePic.wid) {
                    return {
                        fullWid: profilePic.wid.toString(),
                        phoneNumber: profilePic.wid.user,
                        server: profilePic.wid.server,
                        profilePicUrl: profilePic.imgFull
                    };
                }
            } catch (error) {
                console.error('getMyProfilePicThumb error:', error);
            }
        }
        return null;
    });
}

// Method 6: Complete implementation with all user info
async function getCompleteUserInfo(page) {
    return await page.evaluate(async () => {
        const userInfo = {};

        // Get basic phone number info
        if (window.WPP && window.WPP.conn && window.WPP.conn.me) {
            const meWid = window.WPP.conn.me;
            userInfo.phoneNumber = meWid.user;
            userInfo.fullWid = meWid.toString();
            userInfo.server = meWid.server;
        }

        // Get authentication status
        if (window.WPP && window.WPP.conn) {
            userInfo.isAuthenticated = window.WPP.conn.isAuthenticated();
            userInfo.isRegistered = window.WPP.conn.isRegistered();
            userInfo.isMainReady = window.WPP.conn.isMainReady();
            userInfo.isMultiDevice = window.WPP.conn.isMultiDevice();
        }

        // Get profile info
        if (window.WPP && window.WPP.profile) {
            try {
                // Get profile name
                const myProfile = await window.WPP.profile.getMyStatus();
                if (myProfile) {
                    userInfo.statusText = myProfile.status;
                }

                // Get pushname (display name)
                if (window.WPP.profile.getPushname) {
                    userInfo.pushname = await window.WPP.profile.getPushname();
                }

                // Get profile picture
                const profilePic = await window.WPP.profile.getMyProfilePicThumb();
                if (profilePic) {
                    userInfo.profilePicUrl = profilePic.imgFull;
                }
            } catch (error) {
                console.error('Profile info error:', error);
            }
        }

        // Get device info
        if (window.WPP && window.WPP.conn) {
            try {
                // Get platform (e.g., "android", "iphone", "web")
                if (window.WPP.conn.getPlatform) {
                    userInfo.platform = window.WPP.conn.getPlatform();
                }

                // Get WhatsApp version
                if (window.WPP.version) {
                    userInfo.waVersion = window.WPP.version;
                }
            } catch (error) {
                console.error('Device info error:', error);
            }
        }

        return userInfo;
    });
}

// Integration with WhatsAppAutomation class
class PhoneNumberHelper {
    constructor(page) {
        this.page = page;
    }

    /**
     * Gets the authenticated phone number
     * @returns {Promise<string|null>} The phone number or null if not authenticated
     */
    async getPhoneNumber() {
        try {
            const result = await this.page.evaluate(() => {
                // Primary method - most reliable
                if (window.WPP && window.WPP.conn && window.WPP.conn.me) {
                    return window.WPP.conn.me.user;
                }

                // Fallback method
                if (window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.UserPrefs) {
                    const myWid = window.WPP.whatsapp.UserPrefs.getMaybeMePnUser();
                    if (myWid) {
                        return myWid.user;
                    }
                }

                return null;
            });

            return result;
        } catch (error) {
            console.error('Error getting phone number:', error);
            return null;
        }
    }

    /**
     * Gets the full Wid (WhatsApp ID) including server
     * @returns {Promise<string|null>} The full Wid (e.g., "1234567890@c.us")
     */
    async getFullWid() {
        try {
            const result = await this.page.evaluate(() => {
                if (window.WPP && window.WPP.conn && window.WPP.conn.me) {
                    return window.WPP.conn.me.toString();
                }
                return null;
            });

            return result;
        } catch (error) {
            console.error('Error getting full Wid:', error);
            return null;
        }
    }

    /**
     * Waits for authentication and returns the phone number
     * @param {number} timeout - Maximum time to wait in milliseconds
     * @returns {Promise<string|null>} The phone number once authenticated
     */
    async waitForPhoneNumber(timeout = 60000) {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            // Check if authenticated
            const isAuth = await this.page.evaluate(() => {
                return window.WPP && window.WPP.conn && window.WPP.conn.isAuthenticated();
            });

            if (isAuth) {
                const phoneNumber = await this.getPhoneNumber();
                if (phoneNumber) {
                    return phoneNumber;
                }
            }

            // Wait a bit before checking again
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return null;
    }
}

// Example usage in WhatsAppAutomation
async function exampleUsage(page) {
    // Wait for WA-JS to be ready
    await page.waitForFunction(
        () => window.WPP && window.WPP.conn && window.WPP.conn.isMainReady(),
        { timeout: 60000 }
    );

    // Create helper instance
    const phoneHelper = new PhoneNumberHelper(page);

    // Get phone number
    const phoneNumber = await phoneHelper.getPhoneNumber();
    console.log('Authenticated phone number:', phoneNumber);

    // Get full Wid
    const fullWid = await phoneHelper.getFullWid();
    console.log('Full WhatsApp ID:', fullWid);

    // Get complete user info
    const userInfo = await getCompleteUserInfo(page);
    console.log('Complete user info:', userInfo);
}

// Export for use in other modules
module.exports = {
    PhoneNumberHelper,
    getPhoneNumberMethod1,
    getPhoneNumberMethod2,
    getPhoneNumberMethod3,
    getPhoneNumberMethod4,
    getPhoneNumberMethod5,
    getCompleteUserInfo,
    exampleUsage
};