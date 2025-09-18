#!/usr/bin/env node

/**
 * Test script for the new WebSocket-based status handler
 * This script tests the improved status posting functionality
 */

const { WhatsAppAutomation } = require('./index.js');
const WebSocketStatusHandler = require('./src/core/WebSocketStatusHandler');

class StatusTester {
    constructor() {
        this.automation = null;
        this.statusHandler = null;
    }

    async initialize() {
        console.log('🚀 Initializing WhatsApp automation for status testing...');

        this.automation = new WhatsAppAutomation();

        // Start automation with QR code
        await this.automation.initialize({
            headless: false,
            authMethod: 'auto'
        });

        // Wait for authentication
        console.log('📱 Please scan the QR code to authenticate...');
        await this.automation.waitForAuth();

        console.log('✅ Authentication successful!');

        // Initialize WebSocket status handler
        this.statusHandler = new WebSocketStatusHandler(this.automation.page, this.automation);

        console.log('🔌 WebSocket Status Handler initialized');

        // Wait for full WA-JS readiness
        await this.statusHandler.waitForWAJS();

        console.log('✅ WA-JS is ready for WebSocket operations');
    }

    async testTextStatus() {
        console.log('\n📝 Testing text status posting...');

        try {
            const testMessage = `🧪 WebSocket Status Test - ${new Date().toLocaleTimeString()}`;

            const result = await this.statusHandler.sendTextStatus(testMessage, {
                waitForAck: true
            });

            console.log('✅ Text status posted successfully!');
            console.log('📊 Result:', {
                method: result.method,
                messageId: result.messageId || 'N/A',
                success: result.success
            });

            return true;
        } catch (error) {
            console.error('❌ Text status failed:', error.message);
            return false;
        }
    }

    async testImageStatus() {
        console.log('\n🖼️ Testing image status posting...');

        try {
            // Create a simple test image (base64 encoded 1x1 pixel)
            const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

            const result = await this.statusHandler.sendImageStatus(testImage, {
                caption: '🧪 WebSocket Image Status Test',
                waitForAck: true
            });

            console.log('✅ Image status posted successfully!');
            console.log('📊 Result:', {
                method: result.method,
                messageId: result.messageId || 'N/A',
                success: result.success
            });

            return true;
        } catch (error) {
            console.error('❌ Image status failed:', error.message);
            return false;
        }
    }

    async testStatusRetrieval() {
        console.log('\n📋 Testing status retrieval...');

        try {
            const myStatus = await this.statusHandler.getMyStatus();

            if (myStatus) {
                console.log('✅ Status retrieved successfully!');
                console.log('📊 Status info:', {
                    totalCount: myStatus.totalCount || 0,
                    hasStatus: myStatus.hasStatus || false,
                    msgs: myStatus.msgs ? myStatus.msgs.length : 0
                });
                return true;
            } else {
                console.log('ℹ️ No active status found');
                return true;
            }
        } catch (error) {
            console.error('❌ Status retrieval failed:', error.message);
            return false;
        }
    }

    async testConnectionHealth() {
        console.log('\n🔍 Testing connection health...');

        try {
            const isHealthy = await this.automation.page.evaluate(() => {
                return {
                    wppExists: typeof window.WPP !== 'undefined',
                    isFullReady: window.WPP && window.WPP.isFullReady,
                    hasWebSocket: window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.functions,
                    hasStore: typeof window.Store !== 'undefined' && window.Store.StatusV3,
                    connectionState: window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.Stream ? 'connected' : 'unknown'
                };
            });

            console.log('✅ Connection health check completed');
            console.log('🔧 Health details:', isHealthy);

            return isHealthy.wppExists && isHealthy.isFullReady;
        } catch (error) {
            console.error('❌ Health check failed:', error.message);
            return false;
        }
    }

    async runComprehensiveTest() {
        console.log('🧪 Starting comprehensive WebSocket status testing...\n');

        const results = {
            initialization: false,
            connectionHealth: false,
            textStatus: false,
            imageStatus: false,
            statusRetrieval: false
        };

        try {
            // Initialize
            await this.initialize();
            results.initialization = true;

            // Test connection health
            results.connectionHealth = await this.testConnectionHealth();

            // Test text status
            results.textStatus = await this.testTextStatus();

            // Wait a bit between tests
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Test image status
            results.imageStatus = await this.testImageStatus();

            // Wait a bit before status retrieval
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Test status retrieval
            results.statusRetrieval = await this.testStatusRetrieval();

        } catch (error) {
            console.error('💥 Test suite error:', error.message);
        }

        // Print final results
        console.log('\n📋 Test Results Summary:');
        console.log('========================');

        Object.entries(results).forEach(([test, passed]) => {
            const status = passed ? '✅ PASS' : '❌ FAIL';
            console.log(`${test.padEnd(20)}: ${status}`);
        });

        const passedTests = Object.values(results).filter(Boolean).length;
        const totalTests = Object.keys(results).length;

        console.log(`\n📊 Overall Score: ${passedTests}/${totalTests} tests passed`);

        if (passedTests === totalTests) {
            console.log('🎉 All tests passed! WebSocket status handler is working correctly.');
        } else {
            console.log('⚠️ Some tests failed. Check the output above for details.');
        }

        return results;
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up...');

        if (this.automation) {
            await this.automation.terminate();
        }

        console.log('✅ Cleanup completed');
    }
}

// Main execution
async function main() {
    const tester = new StatusTester();

    try {
        const results = await tester.runComprehensiveTest();

        // Exit with appropriate code
        const allPassed = Object.values(results).every(Boolean);
        process.exit(allPassed ? 0 : 1);

    } catch (error) {
        console.error('💥 Fatal error:', error.message);
        process.exit(1);
    } finally {
        await tester.cleanup();
    }
}

// Handle process termination
process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, cleaning up...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, cleaning up...');
    process.exit(0);
});

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = StatusTester;