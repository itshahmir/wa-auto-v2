const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// ============================================
// Dynamic Container Manager
// Creates/Destroys containers per user
// ============================================
class ContainerManager {
    constructor() {
        this.baseSubnet = '172.20';
        this.startIP = 100; // Start from 172.20.0.100
        this.containers = new Map(); // userId -> containerInfo
        this.ipAssignments = new Map(); // userId -> IP
        this.nextAvailableIP = this.startIP;

        // Load existing containers on startup
        this.loadExistingContainers();
    }

    // Load existing containers from Docker
    async loadExistingContainers() {
        try {
            console.log('[ContainerManager] Loading existing containers...');

            // Get all containers with our naming pattern
            const cmd = 'docker ps --format "{{.Names}}\t{{.Ports}}" --filter "name=wa-user-"';
            const result = await this.execCommand(cmd);

            const lines = result.trim().split('\n').filter(line => line);

            for (const line of lines) {
                const [name, ports] = line.split('\t');

                // Extract userId from container name
                const userId = name.replace('wa-user-', '');

                // Extract port from ports string (format: "0.0.0.0:3101->3000/tcp")
                const portMatch = ports.match(/0\.0\.0\.0:(\d+)->/);
                const port = portMatch ? parseInt(portMatch[1]) : null;

                if (port) {
                    // Calculate IP from port
                    const ipSuffix = port - 3100 + this.startIP;
                    const ip = `${this.baseSubnet}.0.${ipSuffix}`;

                    // Get container ID
                    const containerIdCmd = `docker ps --format "{{.ID}}" --filter "name=${name}"`;
                    const containerId = (await this.execCommand(containerIdCmd)).trim();

                    const containerInfo = {
                        containerId,
                        containerName: name,
                        userId,
                        ip,
                        port,
                        createdAt: new Date(),
                        dataDir: path.join(__dirname, '..', '..', 'user-data', userId),
                        sessionDir: path.join(__dirname, '..', '..', 'user-sessions', userId)
                    };

                    this.containers.set(userId, containerInfo);
                    this.ipAssignments.set(userId, ip);

                    // Update next available IP
                    const nextIP = ipSuffix + 1;
                    if (nextIP > this.nextAvailableIP) {
                        this.nextAvailableIP = nextIP;
                    }

                    console.log(`[ContainerManager] Loaded existing container: ${userId} -> ${ip}:${port}`);
                }
            }

            console.log(`[ContainerManager] Loaded ${this.containers.size} existing containers. Next IP: ${this.nextAvailableIP}`);

        } catch (error) {
            console.error('[ContainerManager] Error loading existing containers:', error);
        }
    }

    // Get next available IP address
    getNextIP() {
        const ip = `${this.baseSubnet}.0.${this.nextAvailableIP}`;
        this.nextAvailableIP++;

        // If we reach 254, move to next subnet
        if (this.nextAvailableIP > 254) {
            this.nextAvailableIP = 100;
            const currentSubnet = parseInt(this.baseSubnet.split('.')[1]);
            this.baseSubnet = `172.${currentSubnet + 1}`;
        }

        return ip;
    }

    // Create container for specific user
    async createUserContainer(userId) {
        console.log(`[ContainerManager] Creating container for user: ${userId}`);

        try {
            // Get IP for this user
            let userIP = this.ipAssignments.get(userId);
            if (!userIP) {
                userIP = this.getNextIP();
                this.ipAssignments.set(userId, userIP);
            }

            const containerName = `wa-user-${userId}`;
            // Calculate port based on IP suffix (IP .100 -> port 3101, IP .101 -> port 3102, etc.)
            const ipSuffix = parseInt(userIP.split('.')[3]);
            const port = 3100 + (ipSuffix - this.startIP + 1);

            // Create user-specific directories
            const userDataDir = path.join(__dirname, '..', '..', 'user-data', userId);
            const userSessionDir = path.join(__dirname, '..', '..', 'user-sessions', userId);

            if (!fs.existsSync(userDataDir)) {
                fs.mkdirSync(userDataDir, { recursive: true });
            }
            if (!fs.existsSync(userSessionDir)) {
                fs.mkdirSync(userSessionDir, { recursive: true });
            }

            // Docker run command
            const dockerCmd = [
                'docker', 'run', '-d',
                '--name', containerName,
                '--network', 'wa-auto-v2_wa_network',
                '--ip', userIP,
                '-p', `${port}:3000`,
                '-e', `PORT=3000`,
                '-e', `NODE_ENV=production`,
                '-e', `HEADLESS=true`,
                '-e', `USER_ID=${userId}`,
                '-v', `${userSessionDir}:/app/sessions`,
                '-v', `${userDataDir}:/app/data`,
                '-v', `/var/run/docker.sock:/var/run/docker.sock`,
                '--restart', 'unless-stopped',
                '--memory', '1g',
                '--cpus', '0.5',
                'wa-auto-v2-wa-api-1' // Use the built image
            ].join(' ');

            console.log(`[ContainerManager] Running: ${dockerCmd}`);

            return new Promise((resolve, reject) => {
                exec(dockerCmd, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`[ContainerManager] Error creating container for ${userId}:`, error);
                        reject(error);
                        return;
                    }

                    const containerId = stdout.trim();

                    const containerInfo = {
                        containerId,
                        containerName,
                        userId,
                        ip: userIP,
                        port,
                        createdAt: new Date(),
                        dataDir: userDataDir,
                        sessionDir: userSessionDir
                    };

                    this.containers.set(userId, containerInfo);

                    console.log(`[ContainerManager] Container created for ${userId}:`, containerInfo);
                    resolve(containerInfo);
                });
            });

        } catch (error) {
            console.error(`[ContainerManager] Failed to create container for ${userId}:`, error);
            throw error;
        }
    }

    // Destroy container for specific user
    async destroyUserContainer(userId) {
        console.log(`[ContainerManager] Destroying container for user: ${userId}`);

        try {
            const containerInfo = this.containers.get(userId);

            if (!containerInfo) {
                console.log(`[ContainerManager] No container found for user: ${userId}`);
                return false;
            }

            // Stop and remove container
            const stopCmd = `docker stop ${containerInfo.containerName}`;
            const removeCmd = `docker rm ${containerInfo.containerName}`;

            await this.execCommand(stopCmd);
            await this.execCommand(removeCmd);

            // Clean up user directories (optional - keep data for now)
            // fs.rmSync(containerInfo.dataDir, { recursive: true, force: true });
            // fs.rmSync(containerInfo.sessionDir, { recursive: true, force: true });

            // Remove from tracking
            this.containers.delete(userId);
            this.ipAssignments.delete(userId);

            console.log(`[ContainerManager] Container destroyed for ${userId}`);
            return true;

        } catch (error) {
            console.error(`[ContainerManager] Failed to destroy container for ${userId}:`, error);
            throw error;
        }
    }

    // Get container info for user
    getUserContainer(userId) {
        return this.containers.get(userId);
    }

    // List all user containers
    getAllContainers() {
        return Array.from(this.containers.values());
    }

    // Check if container is running
    async isContainerRunning(userId) {
        const containerInfo = this.containers.get(userId);
        if (!containerInfo) return false;

        try {
            const checkCmd = `docker ps --filter "name=${containerInfo.containerName}" --format "{{.Names}}"`;
            const result = await this.execCommand(checkCmd);
            return result.trim() === containerInfo.containerName;
        } catch (error) {
            return false;
        }
    }

    // Execute command helper
    execCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
        });
    }

    // Get user's API endpoint
    getUserEndpoint(userId) {
        const containerInfo = this.containers.get(userId);
        if (!containerInfo) return null;

        return `http://localhost:${containerInfo.port}`;
    }

    // Auto-cleanup stopped containers
    async cleanupStoppedContainers() {
        console.log(`[ContainerManager] Running cleanup for stopped containers...`);

        for (const [userId, containerInfo] of this.containers.entries()) {
            const isRunning = await this.isContainerRunning(userId);

            if (!isRunning) {
                console.log(`[ContainerManager] Container for ${userId} is not running, cleaning up...`);

                try {
                    // Try to remove the container
                    await this.execCommand(`docker rm ${containerInfo.containerName}`);
                    this.containers.delete(userId);
                    this.ipAssignments.delete(userId);
                } catch (error) {
                    console.error(`[ContainerManager] Failed to cleanup container for ${userId}:`, error);
                }
            }
        }
    }

    // Start cleanup interval
    startCleanupInterval() {
        // Run cleanup every 5 minutes
        setInterval(() => {
            this.cleanupStoppedContainers();
        }, 5 * 60 * 1000);

        console.log(`[ContainerManager] Cleanup interval started (every 5 minutes)`);
    }
}

module.exports = ContainerManager;