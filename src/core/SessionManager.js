const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const JsonDB = require('../database/JsonDB');
const WhatsAppStatusHandler = require('./StatusHandler');

// ============================================
// Multi-User Session Manager with Database Persistence
// ============================================
class SessionManager {
    constructor(dbPath = './data/whatsapp.db.json') {
        this.sessions = new Map(); // sessionId -> WhatsAppAutomation instance
        this.sessionMetadata = new Map(); // sessionId -> metadata

        // Initialize database
        this.db = new JsonDB(dbPath, { autoSave: true, prettify: true });
        this.sessionsCollection = this.db.collection('sessions');
        this.usersCollection = this.db.collection('users');

        // Load existing sessions from database
        this.loadSessionsFromDB();
    }

    loadSessionsFromDB() {
        // Load all sessions from database into memory
        const dbSessions = this.sessionsCollection.find({ status: { $ne: 'terminated' } });
        dbSessions.forEach(session => {
            this.sessionMetadata.set(session.id, session);
        });
    }

    createSession(userId, phoneNumber = null) {
        const sessionId = uuidv4();
        const sessionPath = path.join(__dirname, 'sessions', sessionId);

        // Check if user exists, create if not
        let user = this.usersCollection.findOne({ userId });
        if (!user) {
            user = this.usersCollection.insert({
                userId,
                createdAt: new Date(),
                lastActivity: new Date(),
                totalSessions: 0
            });
        }

        // Import WhatsAppAutomation class here to avoid circular dependency
        const { WhatsAppAutomation } = require('./WhatsAppAutomation');
        const automation = new WhatsAppAutomation(sessionPath, sessionId);
        this.sessions.set(sessionId, automation);

        // Create session metadata
        const sessionData = {
            id: sessionId,
            userId,
            phoneNumber,
            createdAt: new Date(),
            status: 'initializing',
            lastActivity: new Date(),
            sessionPath
        };

        // Save to database
        this.sessionsCollection.insert(sessionData);
        this.sessionMetadata.set(sessionId, sessionData);

        // Update user session count
        this.usersCollection.update(
            { userId },
            {
                lastActivity: new Date(),
                totalSessions: (user.totalSessions || 0) + 1
            }
        );

        return sessionId;
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    getAllSessions() {
        const result = [];
        for (const [sessionId, metadata] of this.sessionMetadata.entries()) {
            result.push({
                sessionId,
                ...metadata,
                isActive: this.sessions.has(sessionId)
            });
        }
        return result;
    }

    updateSessionStatus(sessionId, status) {
        const metadata = this.sessionMetadata.get(sessionId);
        if (metadata) {
            metadata.status = status;
            metadata.lastActivity = new Date();

            // Update in database
            this.sessionsCollection.updateById(sessionId, {
                status,
                lastActivity: metadata.lastActivity
            });

            // Also update user's last activity
            if (metadata.userId) {
                this.usersCollection.update(
                    { userId: metadata.userId },
                    { lastActivity: new Date() }
                );
            }
        }
    }

    updateSessionPhoneNumber(sessionId, phoneNumber) {
        const metadata = this.sessionMetadata.get(sessionId);
        if (metadata) {
            metadata.phoneNumber = phoneNumber;
            metadata.lastActivity = new Date();

            // Update in database
            this.sessionsCollection.updateById(sessionId, {
                phoneNumber,
                lastActivity: metadata.lastActivity
            });
        }
    }

    async closeBrowserOnly(sessionId) {
        // Close browser but keep session data for future use
        const automation = this.sessions.get(sessionId);
        if (automation) {
            await automation.cleanup();
            this.sessions.delete(sessionId);
        }

        // Update status in database but don't terminate
        this.sessionsCollection.updateById(sessionId, {
            status: 'authenticated',
            lastActivity: new Date(),
            browserClosed: true
        });

        // Keep metadata for session list display
        const metadata = this.sessionMetadata.get(sessionId);
        if (metadata) {
            metadata.status = 'authenticated';
            metadata.browserClosed = true;
        }
    }

    async removeSession(sessionId) {
        const automation = this.sessions.get(sessionId);
        if (automation) {
            await automation.cleanup();
            this.sessions.delete(sessionId);
        }

        // Mark session as terminated in database
        this.sessionsCollection.updateById(sessionId, {
            status: 'terminated',
            terminatedAt: new Date()
        });

        this.sessionMetadata.delete(sessionId);

        // Clean up session directory
        const sessionPath = path.join(__dirname, 'sessions', sessionId);
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
    }

    async cleanupInactiveSessions(maxInactiveMinutes = 60) {
        const now = new Date();
        const toRemove = [];

        for (const [sessionId, metadata] of this.sessionMetadata.entries()) {
            const inactiveMinutes = (now - metadata.lastActivity) / 1000 / 60;
            if (inactiveMinutes > maxInactiveMinutes) {
                toRemove.push(sessionId);
            }
        }

        for (const sessionId of toRemove) {
            await this.removeSession(sessionId);
        }

        return toRemove.length;
    }

    // User management methods
    getUser(userId) {
        return this.usersCollection.findOne({ userId });
    }

    getAllUsers() {
        return this.usersCollection.find();
    }

    getUserSessions(userId) {
        return this.sessionsCollection.find({ userId });
    }

    getActiveUserSessions(userId) {
        return this.sessionsCollection.find({
            userId,
            status: { $ne: 'terminated' }
        });
    }

    // Session recovery methods
    async recoverSession(sessionId) {
        const sessionData = this.sessionsCollection.findById(sessionId);
        if (sessionData && sessionData.status !== 'terminated') {
            // Import WhatsAppAutomation class here
            const { WhatsAppAutomation } = require('./WhatsAppAutomation');
            const automation = new WhatsAppAutomation(sessionData.sessionPath, sessionId);
            this.sessions.set(sessionId, automation);
            this.sessionMetadata.set(sessionId, sessionData);
            return automation;
        }
        return null;
    }

    // Auto-start session if it exists but isn't running
    async autoStartSession(sessionId) {
        // First check if session is already in memory and running
        let automation = this.sessions.get(sessionId);
        if (automation && automation.page) {
            // Check if session has auth data stored
            const metadata = this.sessionMetadata.get(sessionId);
            if (metadata && metadata.status === 'requires_auth' && metadata.authData) {
                return { automation, authData: metadata.authData };
            }
            return automation;
        }

        // Check if session exists in database
        const sessionData = this.sessionsCollection.findById(sessionId);
        if (!sessionData || sessionData.status === 'terminated') {
            return null;
        }

        // Session exists in DB but not in memory - recover and start it
        console.log(`[${sessionId}] Auto-starting session from database`);

        // Import required classes
        const { WhatsAppAutomation } = require('./WhatsAppAutomation');

        // Create new automation instance
        automation = new WhatsAppAutomation(sessionData.sessionPath, sessionId);
        this.sessions.set(sessionId, automation);

        try {
            // Initialize the browser and page
            await automation.initialize();

            // Wait for WA-JS to be ready
            await automation.page.waitForFunction(
                () => typeof window.WPP !== 'undefined' && window.WPP.isReady,
                {},
                { timeout: 30000 }
            );

            // Configure WPP settings
            await automation.page.evaluate(() => {
                if (window.WPPConfig) {
                    window.WPPConfig.sendStatusToDevice = true;
                    window.WPPConfig.syncAllStatus = true;
                }
            });

            // Check if already authenticated by looking for saved session
            const isAuthenticated = await automation.page.evaluate(() => {
                return window.WPP && window.WPP.conn && window.WPP.conn.isAuthenticated();
            }).catch(() => false);

            if (isAuthenticated) {
                // Session is authenticated, set up status handler
                automation.statusHandler = new WhatsAppStatusHandler(automation.page, automation);
                this.updateSessionStatus(sessionId, 'ready');
                console.log(`[${sessionId}] Session auto-started and authenticated`);

                // Mark that this session should NOT auto-close after operations
                automation.keepAlive = false;

                return automation;
            } else {
                // Session needs re-authentication
                this.updateSessionStatus(sessionId, 'requires_auth');
                console.log(`[${sessionId}] Session auto-started but requires authentication`);

                // Store authentication data in session metadata
                const metadata = this.sessionMetadata.get(sessionId);
                if (metadata) {
                    metadata.authData = null; // Will be populated by event listeners
                    metadata.authMethod = sessionData.authMethod || 'qr';
                }

                // Set up event listeners to capture auth data
                automation.on('qr', (data) => {
                    console.log(`[${sessionId}] QR Code captured for re-authentication`);
                    const meta = this.sessionMetadata.get(sessionId);
                    if (meta) {
                        meta.authData = { type: 'qr', qr: data.qr };
                    }
                });

                automation.on('pairingCodeGenerated', (data) => {
                    console.log(`[${sessionId}] Pairing code captured for re-authentication`);
                    const meta = this.sessionMetadata.get(sessionId);
                    if (meta) {
                        meta.authData = { type: 'code', code: data.code };
                    }
                });

                // Start authentication with stored method
                const authMethod = sessionData.authMethod || 'qr';
                const phoneNumber = sessionData.phoneNumber;
                automation.handleLogin(authMethod, phoneNumber).then(async (loginSuccess) => {
                    if (loginSuccess) {
                        automation.statusHandler = new WhatsAppStatusHandler(automation.page, automation);
                        this.updateSessionStatus(sessionId, 'ready');
                        console.log(`[${sessionId}] Re-authentication successful`);

                        // Don't auto-close after re-authentication - let it stay open for the operation
                        automation.keepAlive = false;
                    } else {
                        this.updateSessionStatus(sessionId, 'failed');
                        console.log(`[${sessionId}] Re-authentication failed`);
                    }
                }).catch(error => {
                    console.error(`[${sessionId}] Re-authentication error:`, error);
                    this.updateSessionStatus(sessionId, 'failed');
                });

                return automation;
            }
        } catch (error) {
            console.error(`[${sessionId}] Auto-start failed:`, error);
            this.sessions.delete(sessionId);
            this.updateSessionStatus(sessionId, 'failed');
            return null;
        }
    }

    // Database management
    backupDatabase(backupPath) {
        return this.db.backup(backupPath);
    }

    restoreDatabase(backupPath) {
        return this.db.restore(backupPath);
    }

    // Gracefully close browser after job completion (unless awaiting auth)
    async closeBrowserIfNotAwaitingAuth(sessionId, forceClose = false) {
        const metadata = this.sessionMetadata.get(sessionId);
        const automation = this.sessions.get(sessionId);

        if (!metadata || !automation) {
            return false;
        }

        // Don't close if marked as keepAlive (for sessions that were just auto-started)
        if (automation.keepAlive) {
            console.log(`[${sessionId}] Keeping browser open - session marked as keepAlive`);
            // Reset the flag for next time
            automation.keepAlive = false;
            return false;
        }

        // Don't close if session is awaiting authentication (unless forced)
        const authStatuses = ['pending', 'requires_auth', 'waiting_for_authentication'];
        if (!forceClose && authStatuses.includes(metadata.status)) {
            console.log(`[${sessionId}] Keeping browser open - awaiting authentication`);
            return false;
        }

        // Close the browser gracefully
        try {
            console.log(`[${sessionId}] Closing browser after job completion`);
            if (automation.browser) {
                await automation.browser.close();
                automation.browser = null;
                automation.page = null;
                automation.context = null;
            }

            // Keep session in database but remove from active memory
            this.sessions.delete(sessionId);

            // Update status to indicate browser is closed but session persists
            this.updateSessionStatus(sessionId, 'idle');

            return true;
        } catch (error) {
            console.error(`[${sessionId}] Error closing browser:`, error);
            return false;
        }
    }

    // Statistics methods
    getStatistics() {
        const totalUsers = this.usersCollection.count();
        const totalSessions = this.sessionsCollection.count();
        const activeSessions = this.sessionsCollection.count({ status: { $ne: 'terminated' } });
        const readySessions = this.sessionsCollection.count({ status: 'ready' });

        return {
            totalUsers,
            totalSessions,
            activeSessions,
            readySessions,
            memoryActiveSessions: this.sessions.size
        };
    }
}

module.exports = { SessionManager };