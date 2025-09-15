const { SessionManager } = require('./session-manager');
const { WhatsAppAPI } = require('./whatsapp-api');
const DatabaseInitializer = require('./database-init');

async function testDatabaseIntegration() {
    console.log('🧪 Testing Database Integration...\n');

    // Initialize database first
    const dbInit = new DatabaseInitializer('./data/test.db.json');
    await dbInit.initialize();

    // Create SessionManager with test database
    const sessionManager = new SessionManager('./data/test.db.json');

    console.log('📋 Initial Statistics:');
    console.log(sessionManager.getStatistics());

    // Test user creation
    console.log('\n👤 Testing User Management:');
    const sessionId1 = sessionManager.createSession('user123', '+1234567890');
    console.log(`Created session for user123: ${sessionId1}`);

    const sessionId2 = sessionManager.createSession('user456', '+9876543210');
    console.log(`Created session for user456: ${sessionId2}`);

    // Check users
    const allUsers = sessionManager.getAllUsers();
    console.log(`Total users: ${allUsers.length}`);
    allUsers.forEach(user => {
        console.log(`  - ${user.userId}: ${user.totalSessions} sessions`);
    });

    // Test session status updates
    console.log('\n📱 Testing Session Status Updates:');
    sessionManager.updateSessionStatus(sessionId1, 'authenticating');
    console.log(`Updated ${sessionId1} to authenticating`);

    sessionManager.updateSessionStatus(sessionId1, 'ready');
    console.log(`Updated ${sessionId1} to ready`);

    sessionManager.updateSessionStatus(sessionId2, 'failed');
    console.log(`Updated ${sessionId2} to failed`);

    // Get user sessions
    console.log('\n📂 User Sessions:');
    const user123Sessions = sessionManager.getUserSessions('user123');
    console.log(`user123 has ${user123Sessions.length} sessions:`);
    user123Sessions.forEach(session => {
        console.log(`  - ${session.id}: ${session.status}`);
    });

    // Test session removal
    console.log('\n🗑️ Testing Session Removal:');
    await sessionManager.removeSession(sessionId2);
    console.log(`Removed session ${sessionId2}`);

    // Final statistics
    console.log('\n📊 Final Statistics:');
    console.log(sessionManager.getStatistics());

    // Test database backup
    console.log('\n💾 Testing Backup:');
    const backupPath = sessionManager.backupDatabase('./backups/test-backup.json');
    console.log(`Backup created: ${backupPath}`);

    // Validate database
    console.log('\n✅ Validating Database:');
    const validation = dbInit.validateDatabase();
    console.log(`Database valid: ${validation.valid}`);
    if (validation.warnings.length > 0) {
        console.log('Warnings:', validation.warnings);
    }

    console.log('\n✨ All tests completed successfully!');
}

// Run tests
testDatabaseIntegration().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
});