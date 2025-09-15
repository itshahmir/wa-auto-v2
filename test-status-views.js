/**
 * Test script for enhanced /status/my endpoint with view counts
 */

const axios = require('axios');

const API_URL = 'http://localhost:3000';
let sessionId = null;

async function testStatusViews() {
    console.log('========================================');
    console.log('Testing Enhanced /status/my Endpoint');
    console.log('========================================\n');

    try {
        // Step 1: Check API health
        console.log('1. Checking API health...');
        const healthCheck = await axios.get(`${API_URL}/health`);
        console.log('   ✓ API is running:', healthCheck.data);
        console.log('');

        // Step 2: Get existing sessions
        console.log('2. Getting existing sessions...');
        const sessionsResponse = await axios.get(`${API_URL}/sessions`);
        const sessions = sessionsResponse.data.sessions;

        if (sessions && sessions.length > 0) {
            // Use first authenticated session
            const authenticatedSession = sessions.find(s => s.status === 'authenticated');
            if (authenticatedSession) {
                sessionId = authenticatedSession.id;
                console.log(`   ✓ Using existing session: ${sessionId}`);
            } else {
                console.log('   ! No authenticated sessions found');
                console.log('   Creating new session...');
                const createResponse = await axios.post(`${API_URL}/sessions`, {
                    authMethod: 'qr'
                });
                sessionId = createResponse.data.sessionId;
                console.log(`   ✓ Created new session: ${sessionId}`);
                console.log('   ⚠ Please scan QR code to authenticate first');
                return;
            }
        } else {
            console.log('   No existing sessions, creating new one...');
            const createResponse = await axios.post(`${API_URL}/sessions`, {
                authMethod: 'qr'
            });
            sessionId = createResponse.data.sessionId;
            console.log(`   ✓ Created new session: ${sessionId}`);
            console.log('   ⚠ Please scan QR code to authenticate first');
            return;
        }
        console.log('');

        // Step 3: Test /status/my endpoint
        console.log('3. Testing /status/my endpoint with view counts...');
        const statusResponse = await axios.get(`${API_URL}/sessions/${sessionId}/status/my`);
        const statusData = statusResponse.data.status;

        if (statusData) {
            console.log('   ✓ Status data retrieved successfully\n');

            // Display summary
            console.log('   === STATUS SUMMARY ===');
            console.log(`   Has Active Status: ${statusData.hasStatus}`);
            console.log(`   Total Status Count: ${statusData.totalCount || 0}`);
            console.log(`   Number of Status Messages: ${statusData.msgs ? statusData.msgs.length : 0}`);
            console.log('');

            // Display viewer summary
            if (statusData.viewerSummary) {
                console.log('   === VIEWER SUMMARY ===');
                console.log(`   Total Views (all statuses): ${statusData.viewerSummary.totalViews}`);
                console.log(`   Unique Viewer Count: ${statusData.viewerSummary.uniqueViewerCount}`);
                console.log(`   Average Views per Status: ${statusData.viewerSummary.averageViewsPerStatus}`);

                if (statusData.viewerSummary.viewers && statusData.viewerSummary.viewers.length > 0) {
                    console.log(`   Viewer IDs: ${statusData.viewerSummary.viewers.slice(0, 5).join(', ')}${statusData.viewerSummary.viewers.length > 5 ? '...' : ''}`);
                }
                console.log('');
            }

            // Display individual status details
            if (statusData.msgs && statusData.msgs.length > 0) {
                console.log('   === INDIVIDUAL STATUS DETAILS ===');
                statusData.msgs.forEach((msg, index) => {
                    console.log(`   \n   Status ${index + 1}:`);
                    console.log(`   - ID: ${msg.id}`);
                    console.log(`   - Type: ${msg.type}`);
                    console.log(`   - Timestamp: ${new Date(msg.timestamp * 1000).toLocaleString()}`);
                    console.log(`   - View Count: ${msg.viewCount > 0 ? msg.viewCount : (msg.viewCount === -1 ? 'Viewed (count unknown)' : 'Not viewed')}`);
                    console.log(`   - Has Been Viewed: ${msg.hasBeenViewed}`);
                    console.log(`   - ACK Level: ${msg.ack} ${msg.ack >= 3 ? '(Viewed)' : ''}`);

                    if (msg.viewers && msg.viewers.length > 0) {
                        console.log(`   - Viewers: ${msg.viewers.slice(0, 3).join(', ')}${msg.viewers.length > 3 ? '...' : ''}`);
                    }

                    if (msg.caption) {
                        console.log(`   - Caption: ${msg.caption.substring(0, 50)}${msg.caption.length > 50 ? '...' : ''}`);
                    }
                });
                console.log('');
            }

            // Display debug information
            if (statusData.readKeys) {
                console.log('   === DEBUG INFO ===');
                console.log(`   readKeys present: ${Object.keys(statusData.readKeys).length > 0 ? 'Yes' : 'No'}`);
                console.log(`   readKeys count: ${Object.keys(statusData.readKeys).length}`);
            }

        } else {
            console.log('   ! No status data returned');
        }

        console.log('\n========================================');
        console.log('Test completed successfully!');
        console.log('========================================');

    } catch (error) {
        console.error('\n❌ Test failed:', error.response?.data || error.message);

        if (error.response?.status === 404) {
            console.log('\n💡 Tip: Make sure the session exists and is authenticated');
        } else if (error.response?.status === 503) {
            console.log('\n💡 Tip: Session is starting up, please wait a moment and try again');
        }
    }
}

// Run the test
console.log('Starting Status View Test...\n');
testStatusViews();