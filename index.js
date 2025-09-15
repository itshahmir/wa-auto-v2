// Import the separated classes from src directory
const { SessionManager } = require('./src/core/SessionManager');
const { WhatsAppAutomation } = require('./src/core/WhatsAppAutomation');
const { WhatsAppAPI } = require('./src/api/server');

// Export the imported classes for backward compatibility
module.exports = { WhatsAppAutomation, SessionManager, WhatsAppAPI };

// If run directly, start the API server
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.includes('--api')) {
        // Start API server
        const port = process.env.PORT || 3000;
        const api = new WhatsAppAPI(port);
        api.start();
    } else {
        // Legacy single-user mode for backward compatibility
        const automation = new WhatsAppAutomation();

        let authMethod = 'auto';
        let phoneNumber = null;

        if (args.includes('--code') || args.includes('-c')) {
            authMethod = 'code';
            const phoneIndex = args.findIndex(arg => arg === '--phone' || arg === '-p');
            if (phoneIndex !== -1 && args[phoneIndex + 1]) {
                phoneNumber = args[phoneIndex + 1];
            } else {
                console.error('❌ Error: Phone number required for code authentication');
                console.log('Usage: node whatsapp-automation-multiuser.js --code --phone +1234567890');
                process.exit(1);
            }
        } else if (args.includes('--qr') || args.includes('-q')) {
            authMethod = 'qr';
        }

        console.log('='.repeat(50));
        console.log('🚀 Starting WhatsApp Automation (Single User Mode)');
        console.log('='.repeat(50));
        console.log(`Authentication Method: ${authMethod.toUpperCase()}`);
        if (phoneNumber) {
            console.log(`Phone Number: ${phoneNumber}`);
        }
        console.log('Tip: Use --api flag to start in API server mode');
        console.log('='.repeat(50));

        automation.run(authMethod, phoneNumber).then(async result => {
            if (!result.success) {
                process.exit(1);
            }

            console.log('\n✅ WhatsApp automation ready!');
            console.log('Browser will remain open for manual interaction...');
            console.log('Press Ctrl+C to exit');
        });
    }
}