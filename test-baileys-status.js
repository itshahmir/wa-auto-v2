/**
 * Test script for Baileys Status Handler
 * This will create a Baileys session and test status sending
 */

const BaileysStatusHandler = require('./src/core/BaileysStatusHandler');

async function testBaileysStatus() {
    const userId = 'test-baileys-user';
    console.log('🧪 Starting Baileys Status Handler test...\n');

    // Create new Baileys handler
    const handler = new BaileysStatusHandler(userId);

    // Set up event handlers
    handler.setEventHandlers({
        onQRCode: (qr) => {
            console.log('\n📱 QR Code for authentication:');
            console.log('QR Code data:', qr);
            console.log('Scan this QR code with your WhatsApp mobile app');
            console.log('Waiting for QR scan...\n');
        },
        onConnected: async () => {
            console.log('✅ Baileys connected and authenticated!\n');

            // Test sending text status
            try {
                console.log('🧪 Testing text status...');
                const result = await handler.sendTextStatus('Hello from Baileys! 🚀', {
                    backgroundColor: '#FF5733',
                    textColor: 0xFFFFFFFF
                });
                console.log('✅ Text status sent:', result);

                // Wait a bit before disconnecting
                setTimeout(async () => {
                    console.log('\n🔚 Test completed, disconnecting...');
                    await handler.disconnect();
                    process.exit(0);
                }, 5000);

            } catch (error) {
                console.error('❌ Error sending status:', error.message);
                process.exit(1);
            }
        },
        onDisconnected: () => {
            console.log('❌ Baileys disconnected');
            process.exit(1);
        }
    });

    // Start connection
    console.log('🔄 Connecting to WhatsApp via Baileys WebSocket...\n');
    const connected = await handler.connect();

    if (!connected) {
        console.error('❌ Failed to initialize Baileys connection');
        process.exit(1);
    }

    // Keep process alive
    process.on('SIGINT', async () => {
        console.log('\n🛑 Received SIGINT, disconnecting...');
        await handler.disconnect();
        process.exit(0);
    });
}

// Run the test
testBaileysStatus().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
});