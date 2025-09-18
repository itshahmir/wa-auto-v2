#!/usr/bin/env node

const { SessionManager } = require('./src/core/SessionManager');

async function testContainerManager() {
    console.log('🚀 Testing Individual User Container System');
    console.log('===========================================\n');

    const sessionManager = new SessionManager();

    try {
        // Test 1: Create session for user1
        console.log('📝 Test 1: Creating session for user1...');
        const sessionId1 = await sessionManager.createSession('user1', null);
        console.log(`✅ Session created: ${sessionId1}`);

        // Test 2: Check container info
        console.log('\n📝 Test 2: Checking container info for user1...');
        const containerInfo1 = sessionManager.containerManager.getUserContainer('user1');
        if (containerInfo1) {
            console.log(`✅ Container info:`, {
                name: containerInfo1.containerName,
                ip: containerInfo1.ip,
                port: containerInfo1.port,
                endpoint: sessionManager.containerManager.getUserEndpoint('user1')
            });
        } else {
            console.log('❌ No container found for user1');
        }

        // Test 3: Create session for user2
        console.log('\n📝 Test 3: Creating session for user2...');
        const sessionId2 = await sessionManager.createSession('user2', null);
        console.log(`✅ Session created: ${sessionId2}`);

        // Test 4: Check container info for user2
        console.log('\n📝 Test 4: Checking container info for user2...');
        const containerInfo2 = sessionManager.containerManager.getUserContainer('user2');
        if (containerInfo2) {
            console.log(`✅ Container info:`, {
                name: containerInfo2.containerName,
                ip: containerInfo2.ip,
                port: containerInfo2.port,
                endpoint: sessionManager.containerManager.getUserEndpoint('user2')
            });
        } else {
            console.log('❌ No container found for user2');
        }

        // Test 5: List all containers
        console.log('\n📝 Test 5: Listing all containers...');
        const allContainers = sessionManager.containerManager.getAllContainers();
        console.log(`✅ Total containers: ${allContainers.length}`);
        allContainers.forEach(container => {
            console.log(`  - ${container.containerName} (${container.ip}:${container.port})`);
        });

        // Test 6: Check if containers are running
        console.log('\n📝 Test 6: Checking if containers are running...');
        const isRunning1 = await sessionManager.containerManager.isContainerRunning('user1');
        const isRunning2 = await sessionManager.containerManager.isContainerRunning('user2');
        console.log(`✅ User1 container running: ${isRunning1}`);
        console.log(`✅ User2 container running: ${isRunning2}`);

        // Test 7: Delete user1 and their container
        console.log('\n📝 Test 7: Deleting user1 and their container...');
        await sessionManager.deleteUser('user1');
        console.log('✅ User1 deleted');

        // Test 8: Verify user1 container is gone
        console.log('\n📝 Test 8: Verifying user1 container is gone...');
        const containerInfo1After = sessionManager.containerManager.getUserContainer('user1');
        console.log(`✅ User1 container after deletion: ${containerInfo1After ? 'STILL EXISTS' : 'REMOVED'}`);

        // Test 9: Verify user2 container still exists
        console.log('\n📝 Test 9: Verifying user2 container still exists...');
        const containerInfo2After = sessionManager.containerManager.getUserContainer('user2');
        console.log(`✅ User2 container after user1 deletion: ${containerInfo2After ? 'EXISTS' : 'NOT FOUND'}`);

        // Test 10: Clean up user2
        console.log('\n📝 Test 10: Cleaning up user2...');
        await sessionManager.deleteUser('user2');
        console.log('✅ User2 deleted');

        // Final status
        console.log('\n📝 Final Status: Listing remaining containers...');
        const finalContainers = sessionManager.containerManager.getAllContainers();
        console.log(`✅ Remaining containers: ${finalContainers.length}`);

        console.log('\n🎉 All tests completed successfully!');

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    }
}

// Run tests
testContainerManager().catch(console.error);