// Main Application Logic
let currentSession = null;
let sessions = [];
let qrCheckInterval = null;
let statusPollInterval = null;
let currentPollingSessionId = null;

// Add logout functionality
document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            if (confirm('Are you sure you want to logout?')) {
                try {
                    const response = await fetch('/logout', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });

                    if (response.ok) {
                        window.location.href = '/login.html';
                    }
                } catch (error) {
                    console.error('Logout error:', error);
                    alert('Failed to logout. Please try again.');
                }
            }
        });
    }
});

// Helper functions for loading states
function setButtonLoading(button, loading = true, loadingText = 'Loading...') {
    if (loading) {
        button.classList.add('btn-loading');
        button.disabled = true;
        const textSpan = button.querySelector('.btn-text');
        if (textSpan) {
            textSpan.dataset.originalText = textSpan.textContent;
            textSpan.textContent = loadingText;
        }
    } else {
        button.classList.remove('btn-loading');
        button.disabled = false;
        const textSpan = button.querySelector('.btn-text');
        if (textSpan && textSpan.dataset.originalText) {
            textSpan.textContent = textSpan.dataset.originalText;
        }
    }
}

function showGlobalLoader(text = 'Loading...') {
    const loader = document.getElementById('globalLoader');
    const loaderText = document.getElementById('globalLoaderText');
    if (loader && loaderText) {
        loaderText.textContent = text;
        loader.classList.remove('hidden');
    }
}

function hideGlobalLoader() {
    const loader = document.getElementById('globalLoader');
    if (loader) {
        loader.classList.add('hidden');
    }
}

// Helper function to handle authentication required responses
function handleAuthRequired(response) {
    if (response.needsAuth && response.authData) {
        // Show QR code modal with the auth data
        if (response.authData.type === 'qr' && response.authData.qr) {
            showQRCode(response.authData.qr);
            showToast('Please scan the QR code to authenticate', 'info');
            // Start polling for authentication status
            if (currentSession) {
                pollSessionStatus(currentSession.sessionId, 'qr');
            }
            return true;
        } else if (response.authData.type === 'code' && response.authData.code) {
            showPairingCode(response.authData.code);
            showToast('Please enter the pairing code in WhatsApp', 'info');
            // Start polling for authentication status
            if (currentSession) {
                pollSessionStatus(currentSession.sessionId, 'code');
            }
            return true;
        }
    }
    return false;
}

// Toast notification system
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast bg-card border border-border rounded-lg px-4 py-3 shadow-lg max-w-sm`;

    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    const iconColor = type === 'success' ? 'text-green-500' : type === 'error' ? 'text-red-500' : 'text-blue-500';

    toast.innerHTML = `
        <div class="flex items-center gap-3">
            <span class="${iconColor} text-xl">${icon}</span>
            <span class="text-sm">${message}</span>
        </div>
    `;

    const container = document.getElementById('toastContainer');
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Server status check
async function checkServerStatus() {
    const statusEl = document.getElementById('serverStatus');
    const health = await api.checkHealth();

    if (health.status === 'ok') {
        statusEl.innerHTML = `
            <span class="w-2 h-2 bg-green-500 rounded-full"></span>
            Connected (${health.sessions || 0} sessions)
        `;
    } else {
        statusEl.innerHTML = `
            <span class="w-2 h-2 bg-red-500 rounded-full"></span>
            Disconnected
        `;
    }
}

// Session management
async function loadSessions() {
    const sessionsList = document.getElementById('sessionsList');

    // Show loading state only if list is empty
    if (sessionsList && sessions.length === 0) {
        sessionsList.innerHTML = `
            <div class="text-center py-4">
                <div class="inline-block animate-spin rounded-full h-6 w-6 border-2 border-primary border-r-transparent"></div>
                <p class="text-sm text-muted-foreground mt-2">Loading sessions...</p>
            </div>
        `;
    }

    sessions = await api.getSessions();
    renderSessionsList();

    // Check if any session needs authentication
    const sessionsNeedingAuth = sessions.filter(s =>
        s.status === 'waiting_for_authentication' || s.status === 'pending'
    );

    // If there's a session needing auth and no current session selected, auto-select it
    if (sessionsNeedingAuth.length > 0 && !currentSession) {
        // Auto-select the first session that needs authentication
        await selectSession(sessionsNeedingAuth[0].sessionId);
    } else if (currentSession && sessionsNeedingAuth.some(s => s.sessionId === currentSession.sessionId)) {
        // If current session needs auth, refresh its QR
        const needsAuth = sessionsNeedingAuth.find(s => s.sessionId === currentSession.sessionId);
        if (needsAuth && !document.getElementById('qrModal').classList.contains('hidden')) {
            // QR modal is already open, just update the QR
            try {
                const qrResponse = await api.getQRCode(currentSession.sessionId);
                if (qrResponse.qr) {
                    updateQRCodeDisplay(qrResponse.qr);
                }
            } catch (error) {
                console.error('Failed to refresh QR code:', error);
            }
        }
    }
}

function renderSessionsList() {
    const container = document.getElementById('sessionsList');

    if (sessions.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-muted-foreground">
                No active sessions
            </div>
        `;
        return;
    }

    container.innerHTML = sessions.map(session => {
        const statusColor = session.status === 'ready' ? 'bg-green-500' :
                          session.status === 'authenticated' ? 'bg-blue-500' :
                          session.status === 'waiting_for_authentication' ? 'bg-yellow-500' :
                          'bg-gray-500';

        return `
            <div class="session-item p-3 rounded-lg border border-border hover:bg-secondary/50 cursor-pointer transition-colors ${currentSession?.sessionId === session.sessionId ? 'bg-secondary' : ''}"
                 data-session-id="${session.sessionId}">
                <div class="flex items-center justify-between">
                    <div>
                        <div class="font-medium text-sm">${session.userId}</div>
                        <div class="text-xs text-muted-foreground">${session.sessionId.substring(0, 8)}...</div>
                        ${session.phoneNumber ? `<div class="text-xs text-muted-foreground">📱 ${session.phoneNumber}</div>` : ''}
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 ${statusColor} rounded-full"></span>
                        <button class="delete-session text-destructive hover:text-destructive/80" data-session-id="${session.sessionId}">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Add click handlers
    container.querySelectorAll('.session-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (!e.target.closest('.delete-session')) {
                selectSession(item.dataset.sessionId);
            }
        });
    });

    container.querySelectorAll('.delete-session').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await deleteSession(btn.dataset.sessionId);
        });
    });
}

async function selectSession(sessionId) {
    let session = sessions.find(s => s.sessionId === sessionId);
    if (!session) return;

    // Show loading indicator
    showGlobalLoader('Loading session...');
    showToast('Checking session status...', 'info');

    // First, try to start the session if it's not ready
    // The backend's autoStartSession will handle starting it if needed
    try {
        // Get fresh status from backend (this will auto-start if needed)
        const freshStatus = await api.getSessionStatus(sessionId);

        // Update our local session data with fresh status
        session.status = freshStatus.status;

        // Update sessions array
        const sessionIndex = sessions.findIndex(s => s.sessionId === sessionId);
        if (sessionIndex !== -1) {
            sessions[sessionIndex].status = freshStatus.status;
        }
    } catch (error) {
        console.error('Failed to check session status:', error);
    }

    currentSession = session;

    // Update UI
    document.getElementById('welcomeState').classList.add('hidden');
    document.getElementById('sessionDetails').classList.remove('hidden');

    // Update session details
    document.getElementById('sessionId').textContent = session.sessionId;
    document.getElementById('userId').textContent = session.userId;
    document.getElementById('phoneNumber').textContent = session.phoneNumber || '-';
    document.getElementById('createdAt').textContent = new Date(session.createdAt).toLocaleString();

    const statusEl = document.getElementById('sessionStatus');
    statusEl.textContent = session.status.replace('_', ' ');
    statusEl.className = `px-2 py-1 text-xs rounded-full ${
        session.status === 'ready' ? 'bg-green-500/20 text-green-500' :
        session.status === 'authenticated' ? 'bg-blue-500/20 text-blue-500' :
        session.status === 'waiting_for_authentication' ? 'bg-yellow-500/20 text-yellow-500' :
        'bg-gray-500/20 text-gray-500'
    }`;

    renderSessionsList();

    // Check if session needs authentication or is not ready
    if (session.status === 'waiting_for_authentication' || session.status === 'pending' || session.status === 'starting') {
        // Show re-auth section
        document.getElementById('reAuthSection').classList.remove('hidden');

        // Only show authentication message if not already authenticated
        if (session.status !== 'ready' && session.status !== 'authenticated') {
            showToast('Session requires authentication', 'info');

            // Automatically fetch and display QR code
            try {
                const qrResponse = await api.getQRCode(sessionId);
                if (qrResponse.qr) {
                    showQRCode(qrResponse.qr);
                    // Start polling for authentication status
                    pollSessionStatus(sessionId, 'qr');
                } else if (qrResponse.status === 'authenticated' || qrResponse.status === 'ready') {
                    // Session is already authenticated
                    showToast('Session is ready!', 'success');
                    document.getElementById('reAuthSection').classList.add('hidden');
                    // Reload sessions to get updated status
                    await loadSessions();
                }
            } catch (error) {
                console.error('Failed to get QR code:', error);
                // Don't show error if session is actually ready
                if (session.status !== 'ready' && session.status !== 'authenticated') {
                    showToast('Session is initializing, please wait...', 'info');
                    // Retry after a delay
                    setTimeout(async () => {
                        try {
                            const qrResponse = await api.getQRCode(sessionId);
                            if (qrResponse.qr) {
                                showQRCode(qrResponse.qr);
                                pollSessionStatus(sessionId, 'qr');
                            }
                        } catch (err) {
                            console.error('Retry failed:', err);
                        }
                    }, 3000);
                }
            }
        }
    } else if (session.status === 'ready' || session.status === 'authenticated') {
        // Hide re-auth section if session is authenticated
        document.getElementById('reAuthSection').classList.add('hidden');
        showToast('Session is ready!', 'success');
    } else {
        // For other statuses, hide re-auth section
        document.getElementById('reAuthSection').classList.add('hidden');
    }

    hideGlobalLoader();
}

async function deleteSession(sessionId) {
    if (confirm('Delete this session?')) {
        showGlobalLoader('Deleting session...');
        await api.deleteSession(sessionId);
        hideGlobalLoader();
        showToast('Session deleted', 'success');

        if (currentSession?.sessionId === sessionId) {
            currentSession = null;
            document.getElementById('welcomeState').classList.remove('hidden');
            document.getElementById('sessionDetails').classList.add('hidden');
        }

        await loadSessions();
    }
}

// Create session modal
function showCreateSessionModal() {
    document.getElementById('createSessionModal').classList.remove('hidden');
    document.getElementById('newUserId').value = `user_${Date.now()}`;
}

function hideCreateSessionModal() {
    document.getElementById('createSessionModal').classList.add('hidden');
    document.getElementById('phoneNumberField').classList.add('hidden');
}

// Authentication method selection
document.querySelectorAll('.auth-method').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.auth-method').forEach(b => {
            b.classList.remove('bg-secondary', 'text-secondary-foreground');
        });
        btn.classList.add('bg-secondary', 'text-secondary-foreground');

        if (btn.dataset.method === 'code') {
            document.getElementById('phoneNumberField').classList.remove('hidden');
        } else {
            document.getElementById('phoneNumberField').classList.add('hidden');
        }
    });
});

// Create session
document.getElementById('createSessionConfirm').addEventListener('click', async () => {
    const userIdElement = document.getElementById('newUserId');
    const userId = userIdElement ? userIdElement.value.trim() : '';
    if (!userId) {
        showToast('User ID is required', 'error');
        return;
    }

    const authMethod = document.querySelector('.auth-method.bg-secondary')?.dataset.method || 'qr';
    const phoneNumberElement = document.getElementById('phoneNumberInput');
    const phoneNumber = phoneNumberElement ? phoneNumberElement.value.trim() : null;

    if (authMethod === 'code' && !phoneNumber) {
        showToast('Phone number is required for pairing code', 'error');
        return;
    }

    try {
        showToast('Creating session...', 'info');
        const result = await api.createSession(userId, authMethod, phoneNumber);

        if (result.success) {
            hideCreateSessionModal();

            if (result.authData) {
                if (result.authData.type === 'qr_code' && result.authData.qr) {
                    showQRCode(result.authData.qr);
                } else if (result.authData.type === 'pairing_code' && result.authData.code) {
                    showPairingCode(result.authData.code, result.authData.phoneNumber);
                }
            }

            showToast('Session created successfully', 'success');

            // Start polling for session status
            pollSessionStatus(result.sessionId, authMethod);

            setTimeout(() => loadSessions(), 2000);
        } else {
            showToast(result.error || 'Failed to create session', 'error');
        }
    } catch (error) {
        showToast('Failed to create session', 'error');
    }
});

document.getElementById('createSessionCancel').addEventListener('click', hideCreateSessionModal);

// QR Code display
function showQRCode(qrData) {
    const modal = document.getElementById('qrModal');

    // Update QR code display using helper function
    updateQRCodeDisplay(qrData);

    // Show the modal
    modal.classList.remove('hidden');
}

function showPairingCode(code, phoneNumber) {
    const modal = document.getElementById('pairingModal');
    document.getElementById('pairingCode').textContent = code;
    modal.classList.remove('hidden');
}

document.getElementById('closeQrModal').addEventListener('click', () => {
    document.getElementById('qrModal').classList.add('hidden');
    // Stop polling when modal is closed
    if (statusPollInterval) {
        clearInterval(statusPollInterval);
        statusPollInterval = null;
        console.log('Stopped QR polling - modal closed');
    }
});

document.getElementById('closePairingModal').addEventListener('click', () => {
    document.getElementById('pairingModal').classList.add('hidden');
    // Stop polling when modal is closed
    if (statusPollInterval) {
        clearInterval(statusPollInterval);
        statusPollInterval = null;
        console.log('Stopped pairing polling - modal closed');
    }
});

// Poll session status and QR code updates
async function pollSessionStatus(sessionId, authMethod = 'qr') {
    let attempts = 0;
    const maxAttempts = 90; // 3 minutes
    let lastQRCode = null;

    // Store current polling session ID for manual refresh
    currentPollingSessionId = sessionId;

    // Clear any existing polling interval
    if (statusPollInterval) {
        clearInterval(statusPollInterval);
    }

    // Start polling
    statusPollInterval = setInterval(async () => {
        attempts++;

        try {
            // Always check session status
            const status = await api.getSessionStatus(sessionId);
            console.log('Session status:', status);

            if (status.status === 'ready' || status.status === 'authenticated') {
                clearInterval(statusPollInterval);
                statusPollInterval = null;
                currentPollingSessionId = null;
                showToast('Session authenticated successfully!', 'success');
                document.getElementById('qrModal').classList.add('hidden');
                document.getElementById('pairingModal').classList.add('hidden');
                document.getElementById('reAuthSection').classList.add('hidden');
                await loadSessions();
                return;
            }

            // Check if we've exceeded max attempts
            if (attempts >= maxAttempts) {
                clearInterval(statusPollInterval);
                statusPollInterval = null;
                currentPollingSessionId = null;
                showToast('Authentication timed out. Please try again.', 'error');
                document.getElementById('qrModal').classList.add('hidden');
                document.getElementById('pairingModal').classList.add('hidden');
                return;
            }

            // If waiting for authentication and using QR method
            if (status.status === 'waiting_for_authentication' && authMethod === 'qr') {
                // Only fetch QR if modal is open
                if (!document.getElementById('qrModal').classList.contains('hidden')) {
                    try {
                        const qrResponse = await api.getQRCode(sessionId);
                        console.log('QR Response:', qrResponse);

                        // Update QR code if it has changed or if this is the first fetch
                        if (qrResponse.qr && (qrResponse.qr !== lastQRCode || !lastQRCode)) {
                            lastQRCode = qrResponse.qr;
                            updateQRCodeDisplay(qrResponse.qr);
                        }
                    } catch (error) {
                        console.error('Failed to get QR code:', error);
                    }
                }
            }

            // Handle failed status
            if (status.status === 'failed') {
                clearInterval(statusPollInterval);
                statusPollInterval = null;
                currentPollingSessionId = null;
                showToast('Authentication failed. Please try again.', 'error');
                document.getElementById('qrModal').classList.add('hidden');
                document.getElementById('pairingModal').classList.add('hidden');
            }
        } catch (error) {
            console.error('Status poll error:', error);
        }
    }, 2000); // Poll every 2 seconds
}

// Helper function to update QR code display
function updateQRCodeDisplay(qrData) {
    const container = document.getElementById('qrContainer');
    container.innerHTML = '<div id="qrcode"></div>';

    if (qrData.startsWith('data:')) {
        container.innerHTML = `<img src="${qrData}" alt="QR Code" class="w-full max-w-[256px]">`;
    } else {
        try {
            new QRCode(document.getElementById("qrcode"), {
                text: qrData,
                width: 256,
                height: 256,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        } catch (error) {
            console.error('Error updating QR code:', error);
            container.innerHTML = `
                <div class="text-center p-4">
                    <p class="text-sm text-red-500">Failed to generate QR code</p>
                    <p class="text-xs font-mono break-all mt-2">${qrData}</p>
                </div>
            `;
        }
    }
}

// Status tabs
document.querySelectorAll('.status-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.status-tab').forEach(t => {
            t.classList.remove('bg-secondary', 'text-secondary-foreground');
        });
        tab.classList.add('bg-secondary', 'text-secondary-foreground');

        document.querySelectorAll('.status-form').forEach(form => {
            form.classList.add('hidden');
        });

        const formId = tab.dataset.type + 'StatusForm';
        document.getElementById(formId).classList.remove('hidden');
    });
});

// Status operations
document.getElementById('sendTextStatus').addEventListener('click', async (e) => {
    const button = e.currentTarget;

    if (!currentSession) {
        showToast('Please select a session first', 'error');
        return;
    }

    const content = document.getElementById('statusText').value.trim();
    if (!content) {
        showToast('Please enter status text', 'error');
        return;
    }

    // Get advanced options
    const font = parseInt(document.getElementById('textFont').value);
    const backgroundColor = document.getElementById('textBgColorHex').value;

    const options = {
        font: font,
        backgroundColor: backgroundColor
    };

    // Set button to loading state
    setButtonLoading(button, true, 'Posting...');

    try {
        const result = await api.sendTextStatus(currentSession.sessionId, content, options);

        // Check if authentication is required
        if (handleAuthRequired(result)) {
            return;
        }

        if (result.success) {
            showToast('Status posted successfully', 'success');
            document.getElementById('statusText').value = '';
        } else {
            showToast(result.error || 'Failed to post status', 'error');
        }
    } catch (error) {
        showToast('Failed to post status', 'error');
    } finally {
        setButtonLoading(button, false);
    }
});

// Removed getMyStatus button - functionality moved to View My Status tab

// Image status
document.getElementById('statusImage').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        // Show preview
        const preview = document.getElementById('imagePreview');
        const previewImg = document.getElementById('imagePreviewImg');
        const label = e.target.nextElementSibling;

        previewImg.src = URL.createObjectURL(file);
        preview.classList.remove('hidden');

        // Update label
        label.innerHTML = `
            <svg class="w-8 h-8 mx-auto mb-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span class="text-muted-foreground">${file.name}</span>
            <div class="text-xs text-muted-foreground mt-1">Click to change image</div>
        `;
    }
});

// Remove image button
document.getElementById('removeImage').addEventListener('click', () => {
    document.getElementById('statusImage').value = '';
    document.getElementById('imagePreview').classList.add('hidden');

    const label = document.querySelector('label[for="statusImage"]');
    label.innerHTML = `
        <svg class="w-8 h-8 mx-auto mb-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
        </svg>
        <span class="text-muted-foreground">Click to upload image</span>
        <div class="text-xs text-muted-foreground mt-1">Supported: JPG, PNG, GIF</div>
    `;
});

// Caption character counter
document.getElementById('imageCaption').addEventListener('input', (e) => {
    document.getElementById('imageCaptionCount').textContent = e.target.value.length;
});

document.getElementById('sendImageStatus').addEventListener('click', async (e) => {
    const button = e.currentTarget;

    if (!currentSession) {
        showToast('Please select a session first', 'error');
        return;
    }

    const file = document.getElementById('statusImage').files[0];
    if (!file) {
        showToast('Please select an image', 'error');
        return;
    }

    // Set button to loading state
    setButtonLoading(button, true, 'Uploading...');
    showToast('Uploading image...', 'info');

    try {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const imageData = e.target.result;
            const caption = document.getElementById('imageCaption').value.trim();

            const result = await api.sendImageStatus(currentSession.sessionId, imageData, caption);

            // Check if authentication is required
            if (handleAuthRequired(result)) {
                return;
            }

            if (result.success) {
                showToast('Image status posted successfully', 'success');
                document.getElementById('statusImage').value = '';
                document.getElementById('imageCaption').value = '';
                document.getElementById('imageCaptionCount').textContent = '0';
                document.getElementById('imagePreview').classList.add('hidden');
                document.querySelector('label[for="statusImage"]').innerHTML = `
                    <svg class="w-8 h-8 mx-auto mb-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                    </svg>
                    <span class="text-muted-foreground">Click to upload image</span>
                    <div class="text-xs text-muted-foreground mt-1">Supported: JPG, PNG, GIF</div>
                `;
            } else {
                showToast(result.error || 'Failed to post image status', 'error');
            }
            setButtonLoading(button, false);
        };
        reader.onerror = () => {
            showToast('Failed to read image file', 'error');
            setButtonLoading(button, false);
        };
        reader.readAsDataURL(file);
    } catch (error) {
        showToast('Failed to post image status', 'error');
        setButtonLoading(button, false);
    }
});

// Video status
document.getElementById('statusVideo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        // Show preview
        const preview = document.getElementById('videoPreview');
        const previewPlayer = document.getElementById('videoPreviewPlayer');
        const label = e.target.nextElementSibling;

        // Create URL for video preview
        const videoURL = URL.createObjectURL(file);
        previewPlayer.src = videoURL;
        preview.classList.remove('hidden');

        // Get video duration
        previewPlayer.addEventListener('loadedmetadata', () => {
            const duration = Math.round(previewPlayer.duration);
            document.getElementById('videoDuration').textContent = duration;

            if (duration > 30) {
                showToast('Video must be 30 seconds or less', 'error');
            }
        });

        // Update label
        label.innerHTML = `
            <svg class="w-8 h-8 mx-auto mb-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span class="text-muted-foreground">${file.name}</span>
            <div class="text-xs text-muted-foreground mt-1">Click to change video</div>
        `;
    }
});

// Remove video button
document.getElementById('removeVideo').addEventListener('click', () => {
    document.getElementById('statusVideo').value = '';
    document.getElementById('videoPreview').classList.add('hidden');
    document.getElementById('videoPreviewPlayer').src = '';

    const label = document.querySelector('label[for="statusVideo"]');
    label.innerHTML = `
        <svg class="w-8 h-8 mx-auto mb-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
        </svg>
        <span class="text-muted-foreground">Click to upload video</span>
        <div class="text-xs text-muted-foreground mt-1">Supported: MP4, AVI, MOV (Max 30 seconds)</div>
    `;
});

// Video caption character counter
document.getElementById('videoCaption').addEventListener('input', (e) => {
    document.getElementById('videoCaptionCount').textContent = e.target.value.length;
});

document.getElementById('sendVideoStatus').addEventListener('click', async (e) => {
    const button = e.currentTarget;

    if (!currentSession) {
        showToast('Please select a session first', 'error');
        return;
    }

    const file = document.getElementById('statusVideo').files[0];
    if (!file) {
        showToast('Please select a video', 'error');
        return;
    }

    // Set button to loading state
    setButtonLoading(button, true, 'Uploading...');
    showToast('Uploading video...', 'info');

    try {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const videoData = e.target.result;
            const caption = document.getElementById('videoCaption').value.trim();

            const result = await api.sendVideoStatus(currentSession.sessionId, videoData, caption);

            // Check if authentication is required
            if (handleAuthRequired(result)) {
                return;
            }

            if (result.success) {
                showToast('Video status posted successfully', 'success');
                // Clear form
                document.getElementById('statusVideo').value = '';
                document.getElementById('videoCaption').value = '';
                document.getElementById('videoCaptionCount').textContent = '0';
                document.getElementById('videoPreview').classList.add('hidden');
                document.getElementById('videoPreviewPlayer').src = '';
                document.querySelector('label[for="statusVideo"]').innerHTML = `
                    <svg class="w-8 h-8 mx-auto mb-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                    </svg>
                    <span class="text-muted-foreground">Click to upload video</span>
                    <div class="text-xs text-muted-foreground mt-1">Supported: MP4, AVI, MOV (Max 30 seconds)</div>
                `;
            } else {
                showToast(result.error || 'Failed to post video status', 'error');
            }
            setButtonLoading(button, false);
        };
        reader.onerror = () => {
            showToast('Failed to read video file', 'error');
            setButtonLoading(button, false);
        };
        reader.readAsDataURL(file);
    } catch (error) {
        showToast('Failed to post video status', 'error');
        setButtonLoading(button, false);
    }
});

// Event listeners
document.getElementById('newSessionBtn').addEventListener('click', showCreateSessionModal);

// Re-authenticate button
document.getElementById('reAuthBtn').addEventListener('click', async () => {
    if (!currentSession) return;

    showToast('Fetching QR code...', 'info');
    try {
        const qrResponse = await api.getQRCode(currentSession.sessionId);
        if (qrResponse.qr) {
            showQRCode(qrResponse.qr);
            // Start polling for authentication status
            pollSessionStatus(currentSession.sessionId, 'qr');
        } else {
            showToast('No QR code available. Session may already be authenticated.', 'info');
        }
    } catch (error) {
        console.error('Failed to get QR code:', error);
        showToast('Failed to retrieve QR code', 'error');
    }
});

// Manual QR refresh
async function refreshQRCode() {
    if (!currentPollingSessionId) return;

    try {
        showToast('Refreshing QR code...', 'info');
        const qrResponse = await api.getQRCode(currentPollingSessionId);

        if (qrResponse.qr) {
            updateQRCodeDisplay(qrResponse.qr);
            showToast('QR code refreshed', 'success');
        } else {
            showToast('Failed to refresh QR code', 'error');
        }
    } catch (error) {
        console.error('Failed to refresh QR code:', error);
        showToast('Failed to refresh QR code', 'error');
    }
}

// Add refresh button listener
document.getElementById('refreshQrBtn').addEventListener('click', refreshQRCode);

// Add QR container click listener for refresh
document.getElementById('qrContainer').addEventListener('click', refreshQRCode);

// Color picker synchronization
document.getElementById('textBgColor').addEventListener('input', (e) => {
    document.getElementById('textBgColorHex').value = e.target.value;
});

document.getElementById('textBgColorHex').addEventListener('input', (e) => {
    const hex = e.target.value;
    if (/^#[0-9A-F]{6}$/i.test(hex)) {
        document.getElementById('textBgColor').value = hex;
    }
});

// Preset color buttons
document.querySelectorAll('.color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        document.getElementById('textBgColor').value = color;
        document.getElementById('textBgColorHex').value = color;

        // Add visual feedback
        btn.style.transform = 'scale(0.9)';
        setTimeout(() => {
            btn.style.transform = 'scale(1)';
        }, 100);
    });
});

// Main status tab switching
document.querySelectorAll('.main-status-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
        // Update tab styling
        document.querySelectorAll('.main-status-tab').forEach(t => {
            t.classList.remove('border-primary');
            t.classList.add('border-transparent', 'hover:border-muted');
        });
        tab.classList.remove('border-transparent', 'hover:border-muted');
        tab.classList.add('border-primary');

        // Show/hide sections
        const action = tab.dataset.action;
        if (action === 'post') {
            document.getElementById('postStatusSection').classList.remove('hidden');
            document.getElementById('viewStatusSection').classList.add('hidden');
        } else if (action === 'view') {
            document.getElementById('postStatusSection').classList.add('hidden');
            document.getElementById('viewStatusSection').classList.remove('hidden');

            // Load status when switching to view tab
            if (currentSession) {
                await loadMyStatus();
            }
        }
    });
});

// Load and display my status with retry logic
async function loadMyStatus(retryCount = 0) {
    if (!currentSession) {
        showToast('Please select a session first', 'error');
        return;
    }

    // Show loading state
    document.getElementById('statusLoadingState').classList.remove('hidden');
    document.getElementById('statusContent').classList.add('hidden');
    document.getElementById('noStatusMessage').classList.add('hidden');

    try {
        const result = await api.getMyStatus(currentSession.sessionId);

        // Check if session needs authentication
        if (result.needsAuth) {
            document.getElementById('statusLoadingState').classList.add('hidden');
            document.getElementById('noStatusMessage').classList.remove('hidden');

            // Check if we have auth data to display
            if (handleAuthRequired(result)) {
                // Auth modal shown, just update status display
                const statusEl = document.getElementById('sessionStatus');
                statusEl.textContent = 'Requires Authentication';
                statusEl.className = 'px-2 py-1 text-xs rounded-full bg-yellow-500/20 text-yellow-500';
            } else {
                // No auth data available, show error
                showToast('Please log in to WhatsApp first', 'error');

                // Update session status display
                const statusEl = document.getElementById('sessionStatus');
                statusEl.textContent = 'Requires Authentication';
                statusEl.className = 'px-2 py-1 text-xs rounded-full bg-yellow-500/20 text-yellow-500';
            }
            return;
        }

        // Check if we got a 503 error (session starting up)
        if (result.error && result.error.includes('starting up') && retryCount < 5) {
            showToast('Session is starting, please wait...', 'info');
            // Retry after a delay
            setTimeout(() => {
                loadMyStatus(retryCount + 1);
            }, 3000); // Wait 3 seconds before retry
            return;
        }

        // Hide loading state
        document.getElementById('statusLoadingState').classList.add('hidden');

        // Debug logging to understand API response structure
        console.log('Status API Response:', result);

        // Check for both possible response structures
        // The API returns either:
        // 1. Direct object with success:true and msgs array
        // 2. Wrapped in status object
        const statusMessages = result.status?.msgs || result.msgs || result.status;
        console.log('Extracted status messages:', statusMessages);

        if (statusMessages && Array.isArray(statusMessages)) {
            if (statusMessages.length > 0) {
                // Display status items
                const statusContent = document.getElementById('statusContent');
                statusContent.innerHTML = statusMessages.map(item => {
                    const time = item.timestamp ? new Date(item.timestamp * 1000).toLocaleString() : 'Unknown time';
                    let content = '';

                    // Handle message body/content
                    const messageText = item.body || item.content || '';

                    if (item.type === 'text' || item.type === 'chat') {
                        content = `<p class="text-sm">${messageText || 'No content'}</p>`;
                    } else if (item.type === 'image') {
                        content = `
                            <img src="${item.content}" class="max-w-full rounded-lg mb-2" alt="Status image" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2VlZSIvPjx0ZXh0IHRleHQtYW5jaG9yPSJtaWRkbGUiIHg9IjIwMCIgeT0iMTUwIiBzdHlsZT0iZmlsbDojYWFhO2ZvbnQtd2VpZ2h0OmJvbGQ7Zm9udC1zaXplOjE5cHg7Zm9udC1mYW1pbHk6QXJpYWwsSGVsdmV0aWNhLHNhbnMtc2VyaWY7ZG9taW5hbnQtYmFzZWxpbmU6Y2VudHJhbCI+SW1hZ2UgTm90IEF2YWlsYWJsZTwvdGV4dD48L3N2Zz4='">
                            ${item.caption ? `<p class="text-sm">${item.caption}</p>` : ''}
                        `;
                    } else if (item.type === 'video') {
                        content = `
                            <video controls class="max-w-full rounded-lg mb-2">
                                <source src="${item.content}" type="video/mp4">
                                Your browser does not support the video tag.
                            </video>
                            ${item.caption ? `<p class="text-sm">${item.caption}</p>` : ''}
                        `;
                    }

                    return `
                        <div class="border border-border rounded-lg p-4 mb-3">
                            <div class="flex justify-between items-start mb-2">
                                <div>
                                    <span class="text-xs text-muted-foreground">${time}</span>
                                    <span class="ml-2 text-xs text-muted-foreground">${item.type || 'unknown'}</span>
                                </div>
                                <button class="delete-status text-destructive hover:text-destructive/80 p-1" data-msg-id="${item.id}" title="Delete status">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                    </svg>
                                </button>
                            </div>
                            ${content}
                        </div>
                    `;
                }).join('');

                statusContent.classList.remove('hidden');

                // Add delete handlers
                statusContent.querySelectorAll('.delete-status').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        if (confirm('Delete this status?')) {
                            btn.disabled = true;
                            btn.innerHTML = '<div class="animate-spin h-4 w-4 border-2 border-destructive border-t-transparent rounded-full"></div>';

                            try {
                                const result = await api.removeStatus(currentSession.sessionId, btn.dataset.msgId);
                                if (result.success !== false) {
                                    showToast('Status deleted successfully', 'success');
                                    await loadMyStatus(); // Reload status
                                } else {
                                    showToast(result.error || 'Failed to delete status', 'error');
                                    btn.disabled = false;
                                    btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                    </svg>`;
                                }
                            } catch (error) {
                                showToast('Failed to delete status', 'error');
                                btn.disabled = false;
                                btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                </svg>`;
                            }
                        }
                    });
                });

                showToast(`Loaded ${statusMessages.length} status update${statusMessages.length > 1 ? 's' : ''}`, 'success');
            } else {
                // Show no status message
                document.getElementById('noStatusMessage').classList.remove('hidden');
            }
        } else if (result.error) {
            // Show error message
            document.getElementById('noStatusMessage').classList.remove('hidden');
            showToast(result.error, 'error');
        } else {
            // Show no status message
            document.getElementById('noStatusMessage').classList.remove('hidden');
        }
    } catch (error) {
        console.error('Failed to load status:', error);
        document.getElementById('statusLoadingState').classList.add('hidden');

        // If it's a network error and we haven't retried too much, retry
        if (retryCount < 3) {
            showToast('Connection error, retrying...', 'info');
            setTimeout(() => {
                loadMyStatus(retryCount + 1);
            }, 2000);
        } else {
            document.getElementById('noStatusMessage').classList.remove('hidden');
            showToast('Failed to load status. Please check your connection.', 'error');
        }
    }
}

// Refresh status button
document.getElementById('refreshStatusBtn').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    setButtonLoading(button, true, 'Refreshing...');
    await loadMyStatus();
    setButtonLoading(button, false);
});

// ============================================
// Tab Navigation
// ============================================

// Tab switching functionality
document.addEventListener('DOMContentLoaded', () => {
    // Handle tab switching
    const navTabs = document.querySelectorAll('.nav-tab');
    const tabContents = document.querySelectorAll('.tab-content');

    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;

            // Update nav tabs
            navTabs.forEach(t => {
                t.classList.remove('border-primary', 'text-foreground');
                t.classList.add('border-transparent', 'text-muted-foreground');
            });
            tab.classList.remove('border-transparent', 'text-muted-foreground');
            tab.classList.add('border-primary', 'text-foreground');

            // Update tab content
            tabContents.forEach(content => {
                content.classList.add('hidden');
            });
            document.getElementById(`${targetTab}Tab`).classList.remove('hidden');

            // Load data for specific tabs
            if (targetTab === 'proxies') {
                loadProxies();
                loadProxyStatistics();
                loadProxyAssignments();
            } else if (targetTab === 'system') {
                loadSystemStats();
            }
        });
    });
});

// ============================================
// Proxy Management
// ============================================

let proxies = [];
let filteredProxies = [];

// Load proxy statistics
async function loadProxyStatistics() {
    try {
        const response = await fetch('/proxies/statistics');
        const stats = await response.json();

        // Check if elements exist before updating
        const totalProxiesEl = document.getElementById('totalProxies');
        const healthyProxiesEl = document.getElementById('healthyProxies');
        const degradedProxiesEl = document.getElementById('degradedProxies');
        const unhealthyProxiesEl = document.getElementById('unhealthyProxies');

        if (totalProxiesEl) totalProxiesEl.textContent = stats.proxies.total || 0;
        if (healthyProxiesEl) healthyProxiesEl.textContent = stats.proxies.healthy || 0;
        if (degradedProxiesEl) degradedProxiesEl.textContent = stats.proxies.degraded || 0;
        if (unhealthyProxiesEl) unhealthyProxiesEl.textContent = stats.proxies.unhealthy || 0;
    } catch (error) {
        console.error('Failed to load proxy statistics:', error);
    }
}

// Load proxies
async function loadProxies() {
    try {
        const response = await fetch('/proxies');
        const result = await response.json();
        proxies = result.proxies || [];

        // Apply current filter
        applyProxyFilters();
        renderProxies();

        const proxyCountEl = document.getElementById('proxyCount');
        if (proxyCountEl) {
            proxyCountEl.textContent = `${filteredProxies.length} proxies`;
        }
    } catch (error) {
        console.error('Failed to load proxies:', error);
        showToast('Failed to load proxies', 'error');
    }
}

// Apply filters to proxies
function applyProxyFilters() {
    const statusFilterEl = document.getElementById('proxyStatusFilter');
    const searchInputEl = document.getElementById('proxySearchInput');

    const statusFilter = statusFilterEl ? statusFilterEl.value : '';
    const searchTerm = searchInputEl ? searchInputEl.value.toLowerCase() : '';

    filteredProxies = proxies.filter(proxy => {
        const matchesStatus = !statusFilter || proxy.status === statusFilter;
        const matchesSearch = !searchTerm ||
            `${proxy.host}:${proxy.port}`.toLowerCase().includes(searchTerm) ||
            (proxy.tags && proxy.tags.some(tag => tag.toLowerCase().includes(searchTerm)));

        return matchesStatus && matchesSearch;
    });
}

// Render proxies table
function renderProxies() {
    const tbody = document.getElementById('proxiesTableBody');
    tbody.innerHTML = '';

    if (filteredProxies.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-8 text-muted-foreground">
                    No proxies found
                </td>
            </tr>
        `;
        return;
    }

    filteredProxies.forEach(proxy => {
        const row = document.createElement('tr');
        row.className = 'border-b border-border hover:bg-muted/50';

        const statusColor = {
            healthy: 'bg-green-500',
            degraded: 'bg-yellow-500',
            unhealthy: 'bg-red-500',
            unchecked: 'bg-gray-500'
        }[proxy.status] || 'bg-gray-500';

        const lastCheck = proxy.health?.lastChecked ?
            new Date(proxy.health.lastChecked).toLocaleString() : 'Never';

        const responseTime = proxy.health?.responseTime ?
            `${proxy.health.responseTime}ms` : 'N/A';

        row.innerHTML = `
            <td class="py-3 text-sm">
                <div class="font-mono">${proxy.host}:${proxy.port}</div>
                ${proxy.tags && proxy.tags.length > 0 ?
                    `<div class="text-xs text-muted-foreground">${proxy.tags.join(', ')}</div>` : ''}
            </td>
            <td class="py-3">
                <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full ${statusColor}"></span>
                    <span class="text-sm capitalize">${proxy.status}</span>
                </div>
            </td>
            <td class="py-3 text-sm">${responseTime}</td>
            <td class="py-3 text-sm">${proxy.usage?.currentAssignments || 0}</td>
            <td class="py-3 text-sm text-muted-foreground">${lastCheck}</td>
            <td class="py-3">
                <div class="flex gap-2">
                    <button onclick="checkProxyHealth('${proxy.id}')"
                            class="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors">
                        Check
                    </button>
                    <button onclick="removeProxy('${proxy.id}')"
                            class="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors">
                        Remove
                    </button>
                </div>
            </td>
        `;

        tbody.appendChild(row);
    });
}

// Load proxy assignments
async function loadProxyAssignments() {
    try {
        const response = await fetch('/proxy-assignments');
        const result = await response.json();
        const assignments = result.assignments || [];

        renderAssignments(assignments);
    } catch (error) {
        console.error('Failed to load proxy assignments:', error);
    }
}

// Render proxy assignments table
function renderAssignments(assignments) {
    const tbody = document.getElementById('assignmentsTableBody');
    tbody.innerHTML = '';

    const activeAssignments = assignments.filter(a => a.status === 'active');

    if (activeAssignments.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-8 text-muted-foreground">
                    No active assignments
                </td>
            </tr>
        `;
        return;
    }

    activeAssignments.forEach(assignment => {
        const proxy = proxies.find(p => p.id === assignment.proxyId);
        const proxyDisplay = proxy ? `${proxy.host}:${proxy.port}` : 'Unknown';

        const row = document.createElement('tr');
        row.className = 'border-b border-border hover:bg-muted/50';

        row.innerHTML = `
            <td class="py-3 text-sm font-mono">${assignment.userId}</td>
            <td class="py-3 text-sm font-mono">${proxyDisplay}</td>
            <td class="py-3 text-sm text-muted-foreground">
                ${new Date(assignment.assignedAt).toLocaleString()}
            </td>
            <td class="py-3 text-sm text-muted-foreground">
                ${new Date(assignment.lastRotation).toLocaleString()}
            </td>
            <td class="py-3">
                <button onclick="rotateUserProxy('${assignment.userId}')"
                        class="px-2 py-1 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded transition-colors">
                    Rotate
                </button>
            </td>
        `;

        tbody.appendChild(row);
    });
}

// Check specific proxy health
async function checkProxyHealth(proxyId) {
    try {
        showToast('Checking proxy health...', 'info');
        const response = await fetch(`/proxies/${proxyId}/health-check`, {
            method: 'POST'
        });
        const result = await response.json();

        if (result.success) {
            showToast('Health check passed', 'success');
        } else {
            showToast('Health check failed', 'warning');
        }

        // Refresh proxies and stats
        await loadProxies();
        await loadProxyStatistics();
    } catch (error) {
        console.error('Failed to check proxy health:', error);
        showToast('Failed to check proxy health', 'error');
    }
}

// Remove proxy
async function removeProxy(proxyId) {
    if (!confirm('Are you sure you want to remove this proxy?')) {
        return;
    }

    try {
        const response = await fetch(`/proxies/${proxyId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showToast('Proxy removed successfully', 'success');
            await loadProxies();
            await loadProxyStatistics();
            await loadProxyAssignments();
        } else {
            showToast('Failed to remove proxy', 'error');
        }
    } catch (error) {
        console.error('Failed to remove proxy:', error);
        showToast('Failed to remove proxy', 'error');
    }
}

// Rotate user proxy
async function rotateUserProxy(userId) {
    try {
        showToast('Rotating proxy...', 'info');
        const response = await fetch(`/users/${userId}/proxy/rotate`, {
            method: 'POST'
        });

        if (response.ok) {
            showToast('Proxy rotated successfully', 'success');
            await loadProxyAssignments();
        } else {
            showToast('Failed to rotate proxy', 'error');
        }
    } catch (error) {
        console.error('Failed to rotate proxy:', error);
        showToast('Failed to rotate proxy', 'error');
    }
}

// Load system statistics
async function loadSystemStats() {
    try {
        const response = await fetch('/health');
        const stats = await response.json();

        const systemStatsDiv = document.getElementById('systemStats');
        systemStatsDiv.innerHTML = `
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <div class="text-sm text-muted-foreground">Total Users</div>
                    <div class="text-xl font-bold">${stats.totalUsers || 0}</div>
                </div>
                <div>
                    <div class="text-sm text-muted-foreground">Active Sessions</div>
                    <div class="text-xl font-bold">${stats.activeSessions || 0}</div>
                </div>
                <div>
                    <div class="text-sm text-muted-foreground">Total Sessions</div>
                    <div class="text-xl font-bold">${stats.totalSessions || 0}</div>
                </div>
                <div>
                    <div class="text-sm text-muted-foreground">Uptime</div>
                    <div class="text-xl font-bold">${Math.floor((stats.uptime || 0) / 60)} min</div>
                </div>
                ${stats.proxies ? `
                    <div>
                        <div class="text-sm text-muted-foreground">Total Proxies</div>
                        <div class="text-xl font-bold">${stats.proxies.total || 0}</div>
                    </div>
                    <div>
                        <div class="text-sm text-muted-foreground">Healthy Proxies</div>
                        <div class="text-xl font-bold text-green-500">${stats.proxies.healthy || 0}</div>
                    </div>
                ` : ''}
            </div>
        `;
    } catch (error) {
        console.error('Failed to load system stats:', error);
    }
}

// ============================================
// Proxy Management Event Handlers
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // Proxy filter handlers - add after a delay to ensure elements exist
    setTimeout(() => {
        const statusFilter = document.getElementById('proxyStatusFilter');
        const searchInput = document.getElementById('proxySearchInput');

        if (statusFilter) {
            statusFilter.addEventListener('change', () => {
                applyProxyFilters();
                renderProxies();
                const proxyCountEl = document.getElementById('proxyCount');
                if (proxyCountEl) {
                    proxyCountEl.textContent = `${filteredProxies.length} proxies`;
                }
            });
        }

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                applyProxyFilters();
                renderProxies();
                const proxyCountEl = document.getElementById('proxyCount');
                if (proxyCountEl) {
                    proxyCountEl.textContent = `${filteredProxies.length} proxies`;
                }
            });
        }
    }, 100);

    // Add proxy button
    setTimeout(() => {
        const addProxyBtn = document.getElementById('addProxyBtn');
        const closeAddProxyModal = document.getElementById('closeAddProxyModal');
        const addProxyModal = document.getElementById('addProxyModal');
        const addProxyForm = document.getElementById('addProxyForm');

        if (addProxyBtn && addProxyModal) {
            addProxyBtn.addEventListener('click', () => {
                addProxyModal.classList.remove('hidden');
            });
        }

        if (closeAddProxyModal && addProxyModal && addProxyForm) {
            closeAddProxyModal.addEventListener('click', () => {
                addProxyModal.classList.add('hidden');
                addProxyForm.reset();
            });
        }
    }, 100);

    // Add proxy form submit - with delay to ensure element exists
    setTimeout(() => {
        const addProxyForm = document.getElementById('addProxyForm');
        if (addProxyForm) {
            addProxyForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const button = e.target.querySelector('button[type="submit"]');
                setButtonLoading(button, true, 'Adding...');

                const proxyString = document.getElementById('proxyString').value;
                const tags = document.getElementById('proxyTags').value
                    .split(',')
                    .map(t => t.trim())
                    .filter(t => t);

                try {
                    const response = await fetch('/proxies', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ proxy: proxyString, tags })
                    });

                    if (response.ok) {
                        showToast('Proxy added successfully', 'success');
                        const modal = document.getElementById('addProxyModal');
                        const form = document.getElementById('addProxyForm');
                        if (modal) modal.classList.add('hidden');
                        if (form) form.reset();
                        await loadProxies();
                        await loadProxyStatistics();
                    } else {
                        const error = await response.json();
                        showToast(error.error || 'Failed to add proxy', 'error');
                    }
                } catch (error) {
                    console.error('Failed to add proxy:', error);
                    showToast('Failed to add proxy', 'error');
                }

                setButtonLoading(button, false);
            });
        }
    }, 100);

    // Bulk import button
    document.getElementById('bulkImportBtn').addEventListener('click', () => {
        document.getElementById('bulkImportModal').classList.remove('hidden');
    });

    // Close bulk import modal
    document.getElementById('closeBulkImportModal').addEventListener('click', () => {
        document.getElementById('bulkImportModal').classList.add('hidden');
        document.getElementById('bulkImportForm').reset();
    });

    // Bulk import form submit
    document.getElementById('bulkImportForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const button = e.target.querySelector('button[type="submit"]');
        setButtonLoading(button, true, 'Importing...');

        const proxyList = document.getElementById('proxyList').value
            .split('\n')
            .map(line => line.trim())
            .filter(line => line);

        const tags = document.getElementById('bulkProxyTags').value
            .split(',')
            .map(t => t.trim())
            .filter(t => t);

        try {
            const response = await fetch('/proxies/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proxies: proxyList, tags })
            });

            if (response.ok) {
                const result = await response.json();
                showToast(`Import complete: ${result.result.added} added, ${result.result.errors.length} errors`, 'success');
                document.getElementById('bulkImportModal').classList.add('hidden');
                document.getElementById('bulkImportForm').reset();
                await loadProxies();
                await loadProxyStatistics();
            } else {
                const error = await response.json();
                showToast(error.error || 'Failed to import proxies', 'error');
            }
        } catch (error) {
            console.error('Failed to import proxies:', error);
            showToast('Failed to import proxies', 'error');
        }

        setButtonLoading(button, false);
    });

    // Import from file button
    document.getElementById('importFromFileBtn').addEventListener('click', async () => {
        const button = document.getElementById('importFromFileBtn');
        setButtonLoading(button, true, 'Importing...');

        try {
            const response = await fetch('/proxies/import/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: '/home/ubuntu/wa-auto-v2/proxies.txt' })
            });

            if (response.ok) {
                const result = await response.json();
                showToast(`Import complete: ${result.result.added} added, ${result.result.errors.length} errors`, 'success');
                await loadProxies();
                await loadProxyStatistics();
            } else {
                const error = await response.json();
                showToast(error.error || 'Failed to import from file', 'error');
            }
        } catch (error) {
            console.error('Failed to import from file:', error);
            showToast('Failed to import from file', 'error');
        }

        setButtonLoading(button, false);
    });

    // Health check all button
    document.getElementById('healthCheckAllBtn').addEventListener('click', async () => {
        const button = document.getElementById('healthCheckAllBtn');
        setButtonLoading(button, true, 'Checking...');

        try {
            const response = await fetch('/proxies/health-check', { method: 'POST' });
            if (response.ok) {
                const result = await response.json();
                showToast(`Health check complete: ${result.results.healthy} healthy, ${result.results.unhealthy} unhealthy`, 'success');
                await loadProxies();
                await loadProxyStatistics();
            } else {
                showToast('Failed to run health checks', 'error');
            }
        } catch (error) {
            console.error('Failed to run health checks:', error);
            showToast('Failed to run health checks', 'error');
        }

        setButtonLoading(button, false);
    });

    // Refresh proxies button
    document.getElementById('refreshProxiesBtn').addEventListener('click', async () => {
        const button = document.getElementById('refreshProxiesBtn');
        setButtonLoading(button, true, 'Refreshing...');

        await loadProxies();
        await loadProxyStatistics();
        await loadProxyAssignments();

        setButtonLoading(button, false);
    });
});

// Initialize
async function init() {
    await checkServerStatus();
    await loadSessions();

    // Check server status every 10 seconds
    setInterval(checkServerStatus, 10000);

    // Refresh sessions every 5 seconds
    setInterval(loadSessions, 5000);
}

// Start the app
init();