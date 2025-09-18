// API Client for WhatsApp Automation
class WhatsAppAPI {
    constructor(baseURL = 'https://whatsapp.social-crm.co.il') {
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
            // Try Baileys endpoint first (if the session has a Baileys handler)
            // We'll try both endpoints and handle gracefully
            const formData = new FormData();

            // Convert base64 data URL to blob if needed
            let blob;
            if (typeof imageData === 'string' && imageData.startsWith('data:')) {
                const response = await fetch(imageData);
                blob = await response.blob();
            } else if (imageData instanceof File) {
                blob = imageData;
            } else {
                throw new Error('Invalid image data format');
            }

            formData.append('image', blob);
            formData.append('caption', caption);
            formData.append('options', JSON.stringify(options));

            // First try Baileys endpoint
            try {
                const response = await fetch(`${this.baseURL}/baileys/status/image/${sessionId}`, {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    return await response.json();
                }

                // If Baileys endpoint returns 404, try regular endpoint
                if (response.status === 404) {
                    throw new Error('Session not found in Baileys handlers');
                }

                const errorData = await response.json();
                throw new Error(errorData.error || `Baileys endpoint error: ${response.status}`);
            } catch (baileysError) {
                // If Baileys handler is not available, try regular WA-JS endpoint
                console.log('Baileys endpoint failed, trying regular endpoint:', baileysError.message);

                // Convert file to base64 for regular endpoint
                let imageDataForRegular;
                if (imageData instanceof File) {
                    imageDataForRegular = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target.result);
                        reader.onerror = (e) => reject(new Error('Failed to read file'));
                        reader.readAsDataURL(imageData);
                    });
                } else {
                    imageDataForRegular = imageData;
                }

                const response = await fetch(`${this.baseURL}/sessions/${sessionId}/status/image`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: imageDataForRegular,
                        options: { ...options, caption }
                    })
                });
                return await response.json();
            }
        } catch (error) {
            console.error('Send image status failed:', error);
            throw error;
        }
    }

    async sendVideoStatus(sessionId, videoData, caption = '', options = {}) {
        try {
            // Try Baileys endpoint first (if the session has a Baileys handler)
            // We'll try both endpoints and handle gracefully
            const formData = new FormData();

            // Convert base64 data URL to blob if needed
            let blob;
            if (typeof videoData === 'string' && videoData.startsWith('data:')) {
                const response = await fetch(videoData);
                blob = await response.blob();
            } else if (videoData instanceof File) {
                blob = videoData;
            } else {
                throw new Error('Invalid video data format');
            }

            formData.append('video', blob);
            formData.append('caption', caption);
            formData.append('options', JSON.stringify(options));

            // First try Baileys endpoint
            try {
                const response = await fetch(`${this.baseURL}/baileys/status/video/${sessionId}`, {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    return await response.json();
                }

                // If Baileys endpoint returns 404, try regular endpoint
                if (response.status === 404) {
                    throw new Error('Session not found in Baileys handlers');
                }

                const errorData = await response.json();
                throw new Error(errorData.error || `Baileys endpoint error: ${response.status}`);
            } catch (baileysError) {
                // If Baileys handler is not available, try regular WA-JS endpoint
                console.log('Baileys endpoint failed, trying regular endpoint:', baileysError.message);

                // Convert file to base64 for regular endpoint
                let videoDataForRegular;
                if (videoData instanceof File) {
                    videoDataForRegular = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target.result);
                        reader.onerror = (e) => reject(new Error('Failed to read file'));
                        reader.readAsDataURL(videoData);
                    });
                } else {
                    videoDataForRegular = videoData;
                }

                const response = await fetch(`${this.baseURL}/sessions/${sessionId}/status/video`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: videoDataForRegular,
                        options: { ...options, caption }
                    })
                });
                return await response.json();
            }
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

    // Baileys API Methods
    async createBaileysSession(userId) {
        try {
            const response = await fetch(`${this.baseURL}/baileys/connect/${userId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            return await response.json();
        } catch (error) {
            console.error('Create Baileys session failed:', error);
            throw error;
        }
    }

    async getBaileysQRCode(userId) {
        try {
            const response = await fetch(`${this.baseURL}/baileys/qr/${userId}`);
            return await response.json();
        } catch (error) {
            console.error('Get Baileys QR code failed:', error);
            throw error;
        }
    }

    async getBaileysStatus(userId) {
        try {
            const response = await fetch(`${this.baseURL}/baileys/status/${userId}`);
            return await response.json();
        } catch (error) {
            console.error('Get Baileys status failed:', error);
            throw error;
        }
    }

    async sendBaileysTextStatus(userId, content, options = {}) {
        try {
            const response = await fetch(`${this.baseURL}/baileys/status/text/${userId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, options })
            });
            return await response.json();
        } catch (error) {
            console.error('Send Baileys text status failed:', error);
            throw error;
        }
    }

    async disconnectBaileys(userId) {
        try {
            const response = await fetch(`${this.baseURL}/baileys/disconnect/${userId}`, {
                method: 'DELETE'
            });
            return await response.json();
        } catch (error) {
            console.error('Disconnect Baileys failed:', error);
            throw error;
        }
    }
}

// Create global API instance
const api = new WhatsAppAPI();