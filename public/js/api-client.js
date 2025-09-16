// API Client for WhatsApp Automation
class WhatsAppAPI {
    constructor(baseURL = 'http://98.88.152.87:3000') {
        this.baseURL = baseURL;
        this.currentSessionId = null;
    }

    // Health check
    async checkHealth() {
        try {
            const response = await fetch(`${this.baseURL}/health`);
            return await response.json();
        } catch (error) {
            console.error('Health check failed:', error);
            return { status: 'error', message: error.message };
        }
    }

    // Session Management
    async createSession(userId, authMethod = 'qr', phoneNumber = null) {
        try {
            const body = { userId, authMethod };
            if (phoneNumber) body.phoneNumber = phoneNumber;

            const response = await fetch(`${this.baseURL}/sessions/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await response.json();
            if (data.sessionId) {
                this.currentSessionId = data.sessionId;
            }
            return data;
        } catch (error) {
            console.error('Create session failed:', error);
            throw error;
        }
    }

    async getSessions() {
        try {
            const response = await fetch(`${this.baseURL}/sessions`);
            const data = await response.json();
            return data.sessions || [];
        } catch (error) {
            console.error('Get sessions failed:', error);
            return [];
        }
    }

    async getSessionStatus(sessionId) {
        try {
            const response = await fetch(`${this.baseURL}/sessions/${sessionId}/status`);
            return await response.json();
        } catch (error) {
            console.error('Get session status failed:', error);
            throw error;
        }
    }

    async getQRCode(sessionId) {
        try {
            const response = await fetch(`${this.baseURL}/sessions/${sessionId}/qr`);
            return await response.json();
        } catch (error) {
            console.error('Get QR code failed:', error);
            throw error;
        }
    }

    async deleteSession(sessionId) {
        try {
            const response = await fetch(`${this.baseURL}/sessions/${sessionId}`, {
                method: 'DELETE'
            });
            return await response.json();
        } catch (error) {
            console.error('Delete session failed:', error);
            throw error;
        }
    }

    // Status Operations
    async sendTextStatus(sessionId, content, options = {}) {
        try {
            const response = await fetch(`${this.baseURL}/sessions/${sessionId}/status/text`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, options })
            });
            return await response.json();
        } catch (error) {
            console.error('Send text status failed:', error);
            throw error;
        }
    }

    async sendImageStatus(sessionId, imageData, caption = '', options = {}) {
        try {
            const response = await fetch(`${this.baseURL}/sessions/${sessionId}/status/image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: imageData,
                    options: { ...options, caption }
                })
            });
            return await response.json();
        } catch (error) {
            console.error('Send image status failed:', error);
            throw error;
        }
    }

    async sendVideoStatus(sessionId, videoData, caption = '', options = {}) {
        try {
            const response = await fetch(`${this.baseURL}/sessions/${sessionId}/status/video`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: videoData,
                    options: { ...options, caption }
                })
            });
            return await response.json();
        } catch (error) {
            console.error('Send video status failed:', error);
            throw error;
        }
    }

    async getMyStatus(sessionId) {
        try {
            const response = await fetch(`${this.baseURL}/sessions/${sessionId}/status/my`);
            return await response.json();
        } catch (error) {
            console.error('Get my status failed:', error);
            throw error;
        }
    }

    async removeStatus(sessionId, msgId) {
        try {
            const response = await fetch(`${this.baseURL}/sessions/${sessionId}/status/${msgId}`, {
                method: 'DELETE'
            });
            return await response.json();
        } catch (error) {
            console.error('Remove status failed:', error);
            throw error;
        }
    }
}

// Create global API instance
const api = new WhatsAppAPI();