const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const JsonDB = require('../database/JsonDB');
const WhatsAppStatusHandler = require('./StatusHandler');
const ProxyManager = require('./ProxyManager');

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

        // Initialize proxy manager
        this.proxyManager = new ProxyManager(this.db);

        // Load existing sessions from database
        this.loadSessionsFromDB();

        // Fix invalid proxy assignments on startup
        this.fixInvalidProxyAssignments();

        // Schedule periodic session restart for proxy rotations
        this.startSessionRestartScheduler();
    }

    loadSessionsFromDB() {
        // Load all sessions from database into memory
        const dbSessions = this.sessionsCollection.find({ status: { $ne: 'terminated' } });
        dbSessions.forEach(session => {
            this.sessionMetadata.set(session.id, session);
        });
    }

    async createSession(userId, phoneNumber = null) {
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

        // Assign proxy to user (creates proxy assignment if not exists)
        let proxyAssignment = null;
        try {
            const proxyResult = this.proxyManager.assignProxyToUser(userId, sessionId);
            proxyAssignment = proxyResult;
            console.log(`[${sessionId}] Assigned proxy: ${proxyResult.proxy.host}:${proxyResult.proxy.port}`);
        } catch (error) {
            console.warn(`[${sessionId}] No proxy assigned: ${error.message}`);

            // Try to assign any available proxy from the pool
            try {
                console.log(`[${sessionId}] Attempting to assign any available proxy from pool...`);
                proxyAssignment = this.assignAvailableProxy(userId, sessionId);
                if (proxyAssignment) {
                    console.log(`[${sessionId}] Successfully assigned available proxy: ${proxyAssignment.proxy.host}:${proxyAssignment.proxy.port}`);
                }
            } catch (fallbackError) {
                console.warn(`[${sessionId}] No available proxies to assign: ${fallbackError.message}`);
            }
        }

        // Import WhatsAppAutomation class here to avoid circular dependency
        const { WhatsAppAutomation } = require('./WhatsAppAutomation');
        const automation = new WhatsAppAutomation(sessionPath, sessionId, proxyAssignment?.proxy);
        this.sessions.set(sessionId, automation);

        // Create session metadata
        const sessionData = {
            id: sessionId,
            userId,
            phoneNumber,
            createdAt: new Date(),
            status: 'initializing',
            lastActivity: new Date(),
            sessionPath,
            proxyId: proxyAssignment?.proxy?.id || null,
            proxyInfo: proxyAssignment?.proxy ? {
                host: proxyAssignment.proxy.host,
                port: proxyAssignment.proxy.port,
                status: proxyAssignment.proxy.status
            } : null
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
            await automation.cleanup(true); // Force close browser
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
        const metadata = this.sessionMetadata.get(sessionId);

        if (automation) {
            await automation.cleanup(true); // Force close browser during removal
            this.sessions.delete(sessionId);
        }

        // Deactivate proxy assignment if exists
        if (metadata && metadata.userId) {
            try {
                const assignment = this.proxyManager.assignmentsCollection.findOne({
                    userId: metadata.userId,
                    sessionId: sessionId,
                    status: 'active'
                });
                if (assignment) {
                    this.proxyManager.deactivateAssignment(assignment.id);
                    console.log(`[${sessionId}] Deactivated proxy assignment for user ${metadata.userId}`);
                }
            } catch (error) {
                console.warn(`[${sessionId}] Error deactivating proxy assignment: ${error.message}`);
            }
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

            // Only remove sessions that are inactive AND not authenticated
            if (inactiveMinutes > maxInactiveMinutes) {
                const automation = this.sessions.get(sessionId);
                let shouldRemove = true;

                if (automation) {
                    try {
                        // Check if session is authenticated before removing
                        const isAuthenticated = await automation.isAuthenticated();
                        if (isAuthenticated) {
                            console.log(`[${sessionId}] Skipping cleanup - session is authenticated despite inactivity`);
                            shouldRemove = false;
                            // Update last activity to prevent repeated checks
                            metadata.lastActivity = now;
                        }
                    } catch (error) {
                        console.log(`[${sessionId}] Error checking auth status during cleanup, will remove:`, error.message);
                    }
                }

                if (shouldRemove) {
                    toRemove.push(sessionId);
                }
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

        // Don't close if session is authenticated (unless forced)
        if (!forceClose) {
            try {
                const isAuthenticated = await automation.isAuthenticated();
                if (isAuthenticated) {
                    console.log(`[${sessionId}] Keeping browser open - session is authenticated`);
                    return false;
                }
            } catch (error) {
                console.log(`[${sessionId}] Error checking auth status, proceeding with browser close:`, error.message);
            }
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

    // Proxy management methods
    getUserProxy(userId) {
        return this.proxyManager.getUserProxy(userId);
    }

    /**
     * Assign any available proxy from the pool when no proxy exists
     */
    assignAvailableProxy(userId, sessionId) {
        try {
            // Get all available proxies (healthy, degraded, or unchecked)
            const availableProxies = this.proxyManager.proxiesCollection.find({
                status: { $in: ['healthy', 'degraded', 'unchecked'] }
            });

            if (availableProxies.length === 0) {
                throw new Error('No proxies available in the pool');
            }

            // Sort by current assignments (least used first)
            availableProxies.sort((a, b) => {
                const aAssignments = a.usage?.currentAssignments || 0;
                const bAssignments = b.usage?.currentAssignments || 0;
                return aAssignments - bAssignments;
            });

            const selectedProxy = availableProxies[0];

            // Create assignment directly
            const assignment = this.proxyManager.assignmentsCollection.insert({
                userId,
                sessionId,
                proxyId: selectedProxy.id,
                status: 'active',
                assignedAt: new Date(),
                lastRotation: new Date(),
                rotationCount: 0
            });

            // Update proxy usage
            this.proxyManager.proxiesCollection.updateById(selectedProxy.id, {
                'usage.currentAssignments': (selectedProxy.usage?.currentAssignments || 0) + 1,
                'usage.totalAssignments': (selectedProxy.usage?.totalAssignments || 0) + 1,
                'usage.lastUsed': new Date(),
                updatedAt: new Date()
            });

            console.log(`[SessionManager] Manually assigned proxy ${selectedProxy.host}:${selectedProxy.port} to user ${userId}`);

            return {
                assignment,
                proxy: selectedProxy
            };

        } catch (error) {
            console.error('[SessionManager] Error in assignAvailableProxy:', error.message);
            throw error;
        }
    }

    rotateUserProxy(userId) {
        try {
            const result = this.proxyManager.rotateUserProxy(userId);

            // Update session metadata if there's an active session
            const userSessions = this.sessionsCollection.find({
                userId,
                status: { $ne: 'terminated' }
            });

            userSessions.forEach(session => {
                const metadata = this.sessionMetadata.get(session.id);
                if (metadata && result.proxy) {
                    metadata.proxyId = result.proxy.id;
                    metadata.proxyInfo = {
                        host: result.proxy.host,
                        port: result.proxy.port,
                        status: result.proxy.status
                    };

                    // Update in database
                    this.sessionsCollection.updateById(session.id, {
                        proxyId: result.proxy.id,
                        proxyInfo: metadata.proxyInfo,
                        lastActivity: new Date()
                    });

                    // Update existing session with new proxy (requires restart)
                    const automation = this.sessions.get(session.id);
                    if (automation) {
                        console.log(`[SessionManager] Proxy rotated for session ${session.id}, restart recommended for new proxy to take effect`);
                        // Note: Existing browser contexts can't change proxy mid-session
                        // The new proxy will be used when the session is next restarted
                        metadata.proxyRotationPending = true;
                    }
                }
            });

            return result;
        } catch (error) {
            console.error(`[SessionManager] Error rotating proxy for user ${userId}:`, error.message);
            throw error;
        }
    }

    // Statistics methods
    getStatistics() {
        const totalUsers = this.usersCollection.count();
        const totalSessions = this.sessionsCollection.count();
        const activeSessions = this.sessionsCollection.count({ status: { $ne: 'terminated' } });
        const readySessions = this.sessionsCollection.count({ status: 'ready' });

        // Get proxy statistics
        const proxyStats = this.proxyManager.getStatistics();

        return {
            totalUsers,
            totalSessions,
            activeSessions,
            readySessions,
            memoryActiveSessions: this.sessions.size,
            proxies: proxyStats
        };
    }

    /**
     * Restart sessions that have pending proxy rotations
     */
    async restartSessionsWithPendingProxyRotation() {
        try {
            const sessionsWithPendingRotation = Array.from(this.sessionMetadata.entries())
                .filter(([_, metadata]) => metadata.proxyRotationPending && this.sessions.has(metadata.id))
                .map(([sessionId, _]) => sessionId);

            if (sessionsWithPendingRotation.length === 0) {
                return;
            }

            console.log(`[SessionManager] Restarting ${sessionsWithPendingRotation.length} sessions with pending proxy rotations`);

            for (const sessionId of sessionsWithPendingRotation) {
                try {
                    const metadata = this.sessionMetadata.get(sessionId);
                    if (!metadata) continue;

                    console.log(`[SessionManager] Restarting session ${sessionId} for proxy rotation`);

                    // Close existing session
                    const automation = this.sessions.get(sessionId);
                    if (automation) {
                        await automation.cleanup(false); // Don't force, allow graceful shutdown
                        this.sessions.delete(sessionId);
                    }

                    // Get new proxy assignment
                    const proxyResult = this.proxyManager.assignProxyToUser(metadata.userId, sessionId);

                    // Create new automation instance with new proxy
                    const { WhatsAppAutomation } = require('./WhatsAppAutomation');
                    const newAutomation = new WhatsAppAutomation(metadata.sessionPath, sessionId, proxyResult?.proxy);
                    this.sessions.set(sessionId, newAutomation);

                    // Update metadata
                    metadata.proxyRotationPending = false;
                    if (proxyResult?.proxy) {
                        metadata.proxyId = proxyResult.proxy.id;
                        metadata.proxyInfo = {
                            host: proxyResult.proxy.host,
                            port: proxyResult.proxy.port,
                            status: proxyResult.proxy.status
                        };
                    }

                    // Update in database
                    this.sessionsCollection.updateById(sessionId, {
                        proxyId: metadata.proxyId,
                        proxyInfo: metadata.proxyInfo,
                        lastActivity: new Date(),
                        status: 'initializing' // Reset status as session is restarting
                    });

                    console.log(`[SessionManager] Session ${sessionId} restarted with new proxy: ${metadata.proxyInfo?.host}:${metadata.proxyInfo?.port}`);

                    // Small delay between restarts
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (error) {
                    console.error(`[SessionManager] Error restarting session ${sessionId}:`, error.message);
                }
            }
        } catch (error) {
            console.error('[SessionManager] Error in restartSessionsWithPendingProxyRotation:', error.message);
        }
    }

    /**
     * Fix sessions that have invalid or non-existent proxy assignments
     */
    fixInvalidProxyAssignments() {
        try {
            console.log('[SessionManager] Checking for sessions with invalid proxy assignments...');

            const activeSessions = this.sessionsCollection.find({
                status: { $ne: 'terminated' }
            });

            let fixedCount = 0;

            activeSessions.forEach(session => {
                let needsFix = false;

                if (!session.proxyId) {
                    console.log(`[SessionManager] Session ${session.id} has no proxy assigned`);
                    needsFix = true;
                } else {
                    // Check if the proxy still exists
                    const proxy = this.proxyManager.proxiesCollection.findById(session.proxyId);
                    if (!proxy) {
                        console.log(`[SessionManager] Session ${session.id} has invalid proxy ID: ${session.proxyId}`);
                        needsFix = true;
                    }
                }

                if (needsFix) {
                    try {
                        // Assign a new proxy
                        const proxyResult = this.assignAvailableProxy(session.userId, session.id);

                        if (proxyResult) {
                            // Update session in database
                            this.sessionsCollection.updateById(session.id, {
                                proxyId: proxyResult.proxy.id,
                                proxyInfo: {
                                    host: proxyResult.proxy.host,
                                    port: proxyResult.proxy.port,
                                    status: proxyResult.proxy.status
                                },
                                lastActivity: new Date()
                            });

                            // Update in-memory metadata if session is loaded
                            const metadata = this.sessionMetadata.get(session.id);
                            if (metadata) {
                                metadata.proxyId = proxyResult.proxy.id;
                                metadata.proxyInfo = {
                                    host: proxyResult.proxy.host,
                                    port: proxyResult.proxy.port,
                                    status: proxyResult.proxy.status
                                };
                            }

                            console.log(`[SessionManager] Fixed proxy assignment for session ${session.id}: ${proxyResult.proxy.host}:${proxyResult.proxy.port}`);
                            fixedCount++;
                        }
                    } catch (assignError) {
                        console.error(`[SessionManager] Failed to fix proxy for session ${session.id}: ${assignError.message}`);
                    }
                }
            });

            if (fixedCount > 0) {
                console.log(`[SessionManager] Fixed proxy assignments for ${fixedCount} sessions`);
            } else {
                console.log('[SessionManager] All active sessions have valid proxy assignments');
            }

        } catch (error) {
            console.error('[SessionManager] Error in fixInvalidProxyAssignments:', error.message);
        }
    }

    /**
     * Start scheduler for session restarts when proxy rotation is needed
     */
    startSessionRestartScheduler() {
        // Check every 5 minutes for sessions needing proxy rotation restart
        this.sessionRestartTimer = setInterval(() => {
            this.restartSessionsWithPendingProxyRotation();
        }, 5 * 60 * 1000);

        console.log('[SessionManager] Started session restart scheduler for proxy rotations (checks every 5 minutes)');
    }

}

module.exports = { SessionManager };