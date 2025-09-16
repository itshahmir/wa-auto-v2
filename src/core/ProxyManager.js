const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { HttpsProxyAgent } = require('https-proxy-agent');

// ============================================
// Proxy Manager with Health Checks and Rotation
// ============================================
class ProxyManager {
    constructor(dbInstance) {
        this.db = dbInstance;
        this.proxiesCollection = this.db.collection('proxies');
        this.assignmentsCollection = this.db.collection('proxyAssignments');

        // Health check configuration
        this.healthCheckInterval = 2 * 60 * 1000; // 2 minutes
        this.rotationInterval = 20 * 60 * 1000; // 20 minutes
        this.rotationCheckInterval = 60 * 1000; // Check every minute for rotations needed
        this.healthCheckTimeout = 10000; // 10 seconds

        // Initialize health checks and rotation
        this.startHealthChecks();
        this.startRotationScheduler();

        console.log('[ProxyManager] Initialized with health checks and rotation');
    }

    // ============================================
    // Proxy Management
    // ============================================

    /**
     * Parse proxy string from format: username:password@host:port
     */
    parseProxyString(proxyString) {
        const cleanProxy = proxyString.trim();
        const atIndex = cleanProxy.lastIndexOf('@');

        if (atIndex === -1) {
            throw new Error(`Invalid proxy format: ${proxyString}`);
        }

        const authPart = cleanProxy.substring(0, atIndex);
        const hostPart = cleanProxy.substring(atIndex + 1);

        const [username, password] = authPart.split(':');
        const [host, port] = hostPart.split(':');

        if (!username || !password || !host || !port) {
            throw new Error(`Invalid proxy format: ${proxyString}`);
        }

        return {
            host,
            port: parseInt(port),
            username,
            password,
            protocol: 'http' // Assuming HTTP proxies
        };
    }

    /**
     * Add a single proxy to the system
     */
    async addProxy(proxyString, tags = []) {
        try {
            const proxyConfig = this.parseProxyString(proxyString);

            // Check if proxy already exists
            const existing = this.proxiesCollection.findOne({
                host: proxyConfig.host,
                port: proxyConfig.port,
                username: proxyConfig.username
            });

            if (existing) {
                console.log(`[ProxyManager] Proxy already exists: ${proxyConfig.host}:${proxyConfig.port}`);
                return existing;
            }

            const proxyData = {
                ...proxyConfig,
                tags,
                status: 'unchecked',
                health: {
                    lastChecked: null,
                    responseTime: null,
                    failureCount: 0,
                    lastError: null
                },
                usage: {
                    totalAssignments: 0,
                    currentAssignments: 0,
                    lastUsed: null
                },
                createdAt: new Date(),
                updatedAt: new Date()
            };

            const saved = this.proxiesCollection.insert(proxyData);
            console.log(`[ProxyManager] Added proxy: ${proxyConfig.host}:${proxyConfig.port}`);

            // Perform initial health check
            this.checkProxyHealth(saved.id).catch(err =>
                console.log(`[ProxyManager] Initial health check failed for ${saved.id}:`, err.message)
            );

            return saved;
        } catch (error) {
            console.error('[ProxyManager] Error adding proxy:', error.message);
            throw error;
        }
    }

    /**
     * Bulk import proxies from array of proxy strings
     */
    async importProxies(proxyStrings, tags = []) {
        const results = {
            added: 0,
            skipped: 0,
            errors: []
        };

        for (const proxyString of proxyStrings) {
            try {
                await this.addProxy(proxyString, tags);
                results.added++;
            } catch (error) {
                results.errors.push(`${proxyString}: ${error.message}`);
            }
        }

        console.log(`[ProxyManager] Import complete: ${results.added} added, ${results.skipped} skipped, ${results.errors.length} errors`);
        return results;
    }

    /**
     * Import proxies from file (like proxies.txt)
     */
    async importProxiesFromFile(filePath, tags = []) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));

            return await this.importProxies(lines, tags);
        } catch (error) {
            console.error('[ProxyManager] Error importing from file:', error.message);
            throw error;
        }
    }

    /**
     * Remove proxy from system
     */
    removeProxy(proxyId) {
        try {
            // Remove any assignments for this proxy
            this.assignmentsCollection.delete({ proxyId });

            // Remove the proxy itself
            const deleted = this.proxiesCollection.deleteById(proxyId);

            if (deleted > 0) {
                console.log(`[ProxyManager] Removed proxy: ${proxyId}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error('[ProxyManager] Error removing proxy:', error.message);
            throw error;
        }
    }

    // ============================================
    // Proxy Assignment
    // ============================================

    /**
     * Assign a healthy proxy to a user
     */
    assignProxyToUser(userId, sessionId = null) {
        try {
            // Check if user already has an active assignment
            const existingAssignment = this.assignmentsCollection.findOne({
                userId,
                status: 'active'
            });

            if (existingAssignment) {
                const proxy = this.proxiesCollection.findById(existingAssignment.proxyId);
                if (proxy && proxy.status === 'healthy') {
                    console.log(`[ProxyManager] User ${userId} already has active proxy: ${proxy.host}:${proxy.port}`);
                    return {
                        assignment: existingAssignment,
                        proxy
                    };
                } else {
                    // Current proxy is unhealthy, deactivate assignment
                    this.deactivateAssignment(existingAssignment.id);
                }
            }

            // Find a healthy proxy with lowest current assignments
            const healthyProxies = this.proxiesCollection.find({ status: 'healthy' });

            if (healthyProxies.length === 0) {
                // Try to find any available proxy (not just healthy ones)
                const availableProxies = this.proxiesCollection.find({
                    status: { $in: ['healthy', 'degraded', 'unchecked'] }
                });
                if (availableProxies.length === 0) {
                    throw new Error('No proxies available');
                } else {
                    // Use available proxy but log warning
                    console.warn(`[ProxyManager] No healthy proxies, using available proxy with status: ${availableProxies[0].status}`);
                    healthyProxies.push(...availableProxies);
                }
            }

            // Sort by current assignments (ascending) to distribute load evenly
            healthyProxies.sort((a, b) => {
                const aAssignments = a.usage?.currentAssignments || 0;
                const bAssignments = b.usage?.currentAssignments || 0;
                return aAssignments - bAssignments;
            });

            // Select the proxy with least assignments
            const selectedProxy = healthyProxies[0];

            // Create assignment
            const assignment = this.assignmentsCollection.insert({
                userId,
                sessionId,
                proxyId: selectedProxy.id,
                status: 'active',
                assignedAt: new Date(),
                lastRotation: new Date(),
                rotationCount: 0
            });

            // Update proxy usage
            this.proxiesCollection.updateById(selectedProxy.id, {
                'usage.currentAssignments': selectedProxy.usage.currentAssignments + 1,
                'usage.totalAssignments': selectedProxy.usage.totalAssignments + 1,
                'usage.lastUsed': new Date(),
                updatedAt: new Date()
            });

            console.log(`[ProxyManager] Assigned proxy ${selectedProxy.host}:${selectedProxy.port} to user ${userId}`);

            return {
                assignment,
                proxy: this.proxiesCollection.findById(selectedProxy.id)
            };

        } catch (error) {
            console.error('[ProxyManager] Error assigning proxy:', error.message);
            throw error;
        }
    }

    /**
     * Get proxy assignment for user
     */
    getUserProxy(userId) {
        const assignment = this.assignmentsCollection.findOne({
            userId,
            status: 'active'
        });

        if (!assignment) {
            return null;
        }

        const proxy = this.proxiesCollection.findById(assignment.proxyId);
        return { assignment, proxy };
    }

    /**
     * Rotate proxy for user
     */
    rotateUserProxy(userId) {
        try {
            const currentAssignment = this.assignmentsCollection.findOne({
                userId,
                status: 'active'
            });

            if (!currentAssignment) {
                return this.assignProxyToUser(userId);
            }

            // Deactivate current assignment
            this.deactivateAssignment(currentAssignment.id);

            // Assign new proxy
            const result = this.assignProxyToUser(userId);

            // Update rotation count
            this.assignmentsCollection.updateById(result.assignment.id, {
                rotationCount: currentAssignment.rotationCount + 1,
                lastRotation: new Date()
            });

            console.log(`[ProxyManager] Rotated proxy for user ${userId}`);
            return result;

        } catch (error) {
            console.error('[ProxyManager] Error rotating proxy:', error.message);
            throw error;
        }
    }

    /**
     * Deactivate proxy assignment
     */
    deactivateAssignment(assignmentId) {
        const assignment = this.assignmentsCollection.findById(assignmentId);
        if (!assignment) return false;

        // Update assignment status
        this.assignmentsCollection.updateById(assignmentId, {
            status: 'inactive',
            deactivatedAt: new Date()
        });

        // Decrease proxy usage count
        const proxy = this.proxiesCollection.findById(assignment.proxyId);
        if (proxy) {
            this.proxiesCollection.updateById(proxy.id, {
                'usage.currentAssignments': Math.max(0, proxy.usage.currentAssignments - 1),
                updatedAt: new Date()
            });
        }

        return true;
    }

    // ============================================
    // Health Checks
    // ============================================

    /**
     * Check health of a specific proxy
     */
    async checkProxyHealth(proxyId) {
        const proxy = this.proxiesCollection.findById(proxyId);
        if (!proxy) return false;

        const startTime = Date.now();

        try {
            const proxyUrl = `${proxy.protocol}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
            const agent = new HttpsProxyAgent(proxyUrl);

            // Test connectivity by making a request to a reliable endpoint
            const testUrl = 'https://httpbin.org/ip';

            const response = await new Promise((resolve, reject) => {
                const req = https.request(testUrl, {
                    agent,
                    timeout: this.healthCheckTimeout
                }, resolve);

                req.on('error', reject);
                req.on('timeout', () => reject(new Error('Request timeout')));
                req.end();
            });

            const responseTime = Date.now() - startTime;

            // Update proxy health
            this.proxiesCollection.updateById(proxyId, {
                status: 'healthy',
                'health.lastChecked': new Date(),
                'health.responseTime': responseTime,
                'health.failureCount': 0,
                'health.lastError': null,
                updatedAt: new Date()
            });

            console.log(`[ProxyManager] Health check passed for ${proxy.host}:${proxy.port} (${responseTime}ms)`);
            return true;

        } catch (error) {
            const updatedProxy = this.proxiesCollection.findById(proxyId);
            const failureCount = (updatedProxy?.health?.failureCount || 0) + 1;

            // Mark as unhealthy after 3 consecutive failures
            const status = failureCount >= 3 ? 'unhealthy' : 'degraded';

            this.proxiesCollection.updateById(proxyId, {
                status,
                'health.lastChecked': new Date(),
                'health.failureCount': failureCount,
                'health.lastError': error.message,
                updatedAt: new Date()
            });

            console.log(`[ProxyManager] Health check failed for ${proxy.host}:${proxy.port}: ${error.message} (failures: ${failureCount})`);

            // If proxy becomes unhealthy, rotate users away from it
            if (status === 'unhealthy') {
                this.rotateUsersFromUnhealthyProxy(proxyId);
            }

            return false;
        }
    }

    /**
     * Run health checks for all proxies
     */
    async runHealthChecks() {
        const proxies = this.proxiesCollection.find();
        const results = {
            healthy: 0,
            degraded: 0,
            unhealthy: 0,
            errors: 0
        };

        console.log(`[ProxyManager] Running health checks for ${proxies.length} proxies...`);

        // Run checks in batches to avoid overwhelming the system
        const batchSize = 5;
        for (let i = 0; i < proxies.length; i += batchSize) {
            const batch = proxies.slice(i, i + batchSize);
            const promises = batch.map(proxy => this.checkProxyHealth(proxy.id));

            try {
                await Promise.allSettled(promises);
            } catch (error) {
                console.error('[ProxyManager] Batch health check error:', error.message);
                results.errors++;
            }

            // Small delay between batches
            if (i + batchSize < proxies.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Count results
        const updatedProxies = this.proxiesCollection.find();
        updatedProxies.forEach(proxy => {
            if (proxy.status === 'healthy') results.healthy++;
            else if (proxy.status === 'degraded') results.degraded++;
            else if (proxy.status === 'unhealthy') results.unhealthy++;
        });

        console.log(`[ProxyManager] Health check complete: ${results.healthy} healthy, ${results.degraded} degraded, ${results.unhealthy} unhealthy`);
        return results;
    }

    /**
     * Start periodic health checks
     */
    startHealthChecks() {
        // Run initial health check after 30 seconds
        setTimeout(() => {
            this.runHealthChecks();
        }, 30000);

        // Schedule periodic health checks
        this.healthCheckTimer = setInterval(() => {
            this.runHealthChecks();
        }, this.healthCheckInterval);

        console.log(`[ProxyManager] Scheduled health checks every ${this.healthCheckInterval / 1000} seconds`);
    }

    /**
     * Rotate users away from unhealthy proxy
     */
    async rotateUsersFromUnhealthyProxy(proxyId) {
        const activeAssignments = this.assignmentsCollection.find({
            proxyId,
            status: 'active'
        });

        if (activeAssignments.length === 0) return;

        console.log(`[ProxyManager] Rotating ${activeAssignments.length} users away from unhealthy proxy ${proxyId}`);

        for (const assignment of activeAssignments) {
            try {
                this.rotateUserProxy(assignment.userId);
            } catch (error) {
                console.error(`[ProxyManager] Error rotating user ${assignment.userId}:`, error.message);
            }
        }
    }

    // ============================================
    // Rotation Scheduler
    // ============================================

    /**
     * Start automatic proxy rotation scheduler
     */
    startRotationScheduler() {
        // Check for rotations needed every minute
        this.rotationTimer = setInterval(() => {
            this.performScheduledRotations();
        }, this.rotationCheckInterval);

        console.log(`[ProxyManager] Checking for rotations every ${this.rotationCheckInterval / 1000} seconds (rotate after ${this.rotationInterval / 1000 / 60} minutes)`);
    }

    /**
     * Perform scheduled proxy rotations
     */
    async performScheduledRotations() {
        try {
            // Add randomness to rotation time (18-22 minutes)
            const minRotationTime = 18 * 60 * 1000;
            const maxRotationTime = 22 * 60 * 1000;

            const activeAssignments = this.assignmentsCollection.find({ status: 'active' });

            const assignmentsToRotate = activeAssignments.filter(assignment => {
                const lastRotationTime = new Date(assignment.lastRotation).getTime();
                const now = Date.now();
                const timeSinceRotation = now - lastRotationTime;

                // Each assignment gets a slightly different rotation interval for randomness
                const assignmentHash = this.hashUserId(assignment.userId);
                const rotationVariance = (assignmentHash % 4000) - 2000; // -2 to +2 seconds
                const targetRotationTime = this.rotationInterval + rotationVariance;

                return timeSinceRotation >= Math.max(minRotationTime, Math.min(maxRotationTime, targetRotationTime));
            });

            if (assignmentsToRotate.length === 0) {
                // Only log occasionally to avoid spam
                if (Math.random() < 0.1) { // 10% chance to log
                    console.log(`[ProxyManager] No assignments need rotation (${activeAssignments.length} active assignments checked)`);
                }
                return;
            }

            console.log(`[ProxyManager] Performing scheduled rotation for ${assignmentsToRotate.length} assignments out of ${activeAssignments.length} total`);

            // Rotate in random order to distribute load
            const shuffledAssignments = this.shuffleArray([...assignmentsToRotate]);

            for (const assignment of shuffledAssignments) {
                try {
                    await this.rotateUserProxy(assignment.userId);

                    // Random delay between rotations (1-5 seconds)
                    const delay = 1000 + Math.random() * 4000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                } catch (error) {
                    console.error(`[ProxyManager] Error rotating user ${assignment.userId}:`, error.message);
                    // Continue with other rotations even if one fails
                }
            }

            console.log('[ProxyManager] Scheduled rotation complete');
        } catch (error) {
            console.error('[ProxyManager] Error in performScheduledRotations:', error.message);
        }
    }

    /**
     * Simple hash function for userId to create deterministic variance
     */
    hashUserId(userId) {
        let hash = 0;
        for (let i = 0; i < userId.length; i++) {
            const char = userId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }

    /**
     * Shuffle array using Fisher-Yates algorithm
     */
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    // ============================================
    // Utility Methods
    // ============================================

    /**
     * Get proxy statistics
     */
    getStatistics() {
        const proxies = this.proxiesCollection.find();
        const assignments = this.assignmentsCollection.find();

        const stats = {
            proxies: {
                total: proxies.length,
                healthy: proxies.filter(p => p.status === 'healthy').length,
                degraded: proxies.filter(p => p.status === 'degraded').length,
                unhealthy: proxies.filter(p => p.status === 'unhealthy').length,
                unchecked: proxies.filter(p => p.status === 'unchecked').length
            },
            assignments: {
                total: assignments.length,
                active: assignments.filter(a => a.status === 'active').length,
                inactive: assignments.filter(a => a.status === 'inactive').length
            },
            usage: {
                totalAssignments: proxies.reduce((sum, p) => sum + (p.usage?.totalAssignments || 0), 0),
                averageAssignmentsPerProxy: proxies.length > 0
                    ? Math.round(proxies.reduce((sum, p) => sum + (p.usage?.totalAssignments || 0), 0) / proxies.length * 100) / 100
                    : 0
            }
        };

        return stats;
    }

    /**
     * Get all proxies with their status
     */
    getAllProxies() {
        return this.proxiesCollection.find().map(proxy => ({
            ...proxy,
            // Hide sensitive credentials in listings
            username: proxy.username ? '***' : null,
            password: proxy.password ? '***' : null
        }));
    }

    /**
     * Get proxy by ID with full details (for admin use)
     */
    getProxyById(proxyId, includeCreds = false) {
        const proxy = this.proxiesCollection.findById(proxyId);
        if (!proxy) return null;

        if (!includeCreds) {
            return {
                ...proxy,
                username: proxy.username ? '***' : null,
                password: proxy.password ? '***' : null
            };
        }

        return proxy;
    }

    /**
     * Get proxy configuration for browser usage
     */
    getProxyConfigForBrowser(userId) {
        const result = this.getUserProxy(userId);
        if (!result || !result.proxy) return null;

        const { proxy } = result;
        return {
            server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
            username: proxy.username,
            password: proxy.password
        };
    }

    /**
     * Cleanup - stop timers
     */
    cleanup() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }

        if (this.rotationTimer) {
            clearInterval(this.rotationTimer);
            this.rotationTimer = null;
        }

        console.log('[ProxyManager] Cleanup complete');
    }
}

module.exports = ProxyManager;