/**
 * Comprehensive Test Suite for WhatsApp Automation v2
 * This script tests all major functionalities of the v2 implementation
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Test configuration
const API_PORT = 3000;
const API_BASE_URL = `http://localhost:${API_PORT}`;
const TEST_USER_ID = 'test-user-001';
const TEST_PHONE = '+923105054025'; // Replace with actual test phone if needed

// Test results collector
const testResults = {
    passed: [],
    failed: [],
    warnings: [],
    startTime: new Date(),
    architecture: {}
};

// Color codes for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

// Helper function for making HTTP requests
function makeRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            req.destroy();
            reject(new Error('Request timeout'));
        }, 10000); // 10 second timeout

        const req = http.request(options, (res) => {
            clearTimeout(timeout);
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    resolve({ statusCode: res.statusCode, data: parsedData });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: data });
                }
            });
            res.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });

        req.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });

        if (postData) {
            req.write(JSON.stringify(postData));
        }

        req.end();
    });
}

// Test suite functions
async function testArchitectureAnalysis() {
    console.log(`\n${colors.blue}[ARCHITECTURE ANALYSIS]${colors.reset}`);

    // Check v2 file structure
    const v2Structure = {
        mainFiles: [],
        srcFiles: [],
        configFiles: [],
        issues: []
    };

    // Check main entry point
    if (fs.existsSync(path.join(__dirname, 'index.js'))) {
        v2Structure.mainFiles.push('index.js');
        const indexContent = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

        // Check for import issues
        if (indexContent.includes("require('./session-manager')")) {
            const filePath = path.join(__dirname, 'session-manager.js');
            if (!fs.existsSync(filePath)) {
                v2Structure.issues.push('index.js references ./session-manager.js but file not found in v2 directory');
            }
        }
        if (indexContent.includes("require('./whatsapp-automation-core')")) {
            const filePath = path.join(__dirname, 'whatsapp-automation-core.js');
            if (!fs.existsSync(filePath)) {
                v2Structure.issues.push('index.js references ./whatsapp-automation-core.js but file not found in v2 directory');
            }
        }
        if (indexContent.includes("require('./whatsapp-api')")) {
            const filePath = path.join(__dirname, 'whatsapp-api.js');
            if (!fs.existsSync(filePath)) {
                v2Structure.issues.push('index.js references ./whatsapp-api.js but file not found in v2 directory');
            }
        }
    }

    // Check src directory structure
    const srcPath = path.join(__dirname, 'src');
    if (fs.existsSync(srcPath)) {
        const srcDirs = fs.readdirSync(srcPath).filter(f => fs.statSync(path.join(srcPath, f)).isDirectory());
        v2Structure.srcFiles = srcDirs;

        // Check core components
        const corePath = path.join(srcPath, 'core');
        if (fs.existsSync(corePath)) {
            const coreFiles = fs.readdirSync(corePath).filter(f => f.endsWith('.js'));
            v2Structure.coreComponents = coreFiles;
        }

        // Check API components
        const apiPath = path.join(srcPath, 'api');
        if (fs.existsSync(apiPath)) {
            const apiFiles = fs.readdirSync(apiPath).filter(f => f.endsWith('.js'));
            v2Structure.apiComponents = apiFiles;
        }

        // Check database components
        const dbPath = path.join(srcPath, 'database');
        if (fs.existsSync(dbPath)) {
            const dbFiles = fs.readdirSync(dbPath).filter(f => f.endsWith('.js'));
            v2Structure.databaseComponents = dbFiles;
        }
    }

    // Check for configuration files
    if (fs.existsSync(path.join(__dirname, '.env'))) {
        v2Structure.configFiles.push('.env');
    }
    if (fs.existsSync(path.join(__dirname, 'package.json'))) {
        v2Structure.configFiles.push('package.json');
    }

    testResults.architecture = v2Structure;

    // Report findings
    console.log(`✓ Main files found: ${v2Structure.mainFiles.join(', ')}`);
    console.log(`✓ Source directories: ${v2Structure.srcFiles.join(', ')}`);
    console.log(`✓ Config files: ${v2Structure.configFiles.join(', ')}`);

    if (v2Structure.coreComponents) {
        console.log(`✓ Core components: ${v2Structure.coreComponents.join(', ')}`);
    }
    if (v2Structure.apiComponents) {
        console.log(`✓ API components: ${v2Structure.apiComponents.join(', ')}`);
    }
    if (v2Structure.databaseComponents) {
        console.log(`✓ Database components: ${v2Structure.databaseComponents.join(', ')}`);
    }

    if (v2Structure.issues.length > 0) {
        console.log(`${colors.yellow}⚠ Architecture issues found:${colors.reset}`);
        v2Structure.issues.forEach(issue => {
            console.log(`  - ${issue}`);
            testResults.warnings.push(issue);
        });
    }

    return v2Structure;
}

async function testAPIServer() {
    console.log(`\n${colors.blue}[TEST: API Server]${colors.reset}`);

    try {
        // Test health endpoint
        const response = await makeRequest({
            hostname: 'localhost',
            port: API_PORT,
            path: '/health',
            method: 'GET'
        });

        if (response.statusCode === 200) {
            console.log(`${colors.green}✅ API Server - Health Check${colors.reset}`);
            console.log(`   Response: ${JSON.stringify(response.data)}`);
            testResults.passed.push('API Server - Health Check');
        } else {
            throw new Error(`Health check returned status ${response.statusCode}`);
        }

        return true;
    } catch (error) {
        console.log(`${colors.red}❌ API Server - Health Check${colors.reset}`);
        console.log(`   Error: ${error.message}`);
        testResults.failed.push({
            test: 'API Server - Health Check',
            error: error.message
        });
        return false;
    }
}

async function testSessionCreation(authMethod = 'qr') {
    console.log(`\n${colors.blue}[TEST: Session Creation - ${authMethod.toUpperCase()}]${colors.reset}`);

    try {
        const postData = {
            userId: TEST_USER_ID,
            authMethod: authMethod
        };

        if (authMethod === 'code') {
            postData.phoneNumber = TEST_PHONE;
        }

        const response = await makeRequest({
            hostname: 'localhost',
            port: API_PORT,
            path: '/sessions/create',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(JSON.stringify(postData))
            }
        }, postData);

        if (response.statusCode === 200 || response.statusCode === 201) {
            console.log(`${colors.green}✅ Session Creation - ${authMethod.toUpperCase()}${colors.reset}`);
            console.log(`   Session ID: ${response.data.sessionId}`);
            if (response.data.qrCode) {
                console.log(`   QR Code: ${response.data.qrCode.substring(0, 50)}...`);
            }
            if (response.data.pairingCode) {
                console.log(`   Pairing Code: ${response.data.pairingCode}`);
            }
            testResults.passed.push(`Session Creation - ${authMethod.toUpperCase()}`);
            return response.data.sessionId;
        } else {
            throw new Error(`Session creation returned status ${response.statusCode}: ${JSON.stringify(response.data)}`);
        }
    } catch (error) {
        console.log(`${colors.red}❌ Session Creation - ${authMethod.toUpperCase()}${colors.reset}`);
        console.log(`   Error: ${error.message}`);
        testResults.failed.push({
            test: `Session Creation - ${authMethod.toUpperCase()}`,
            error: error.message
        });
        return null;
    }
}

async function testSessionList() {
    console.log(`\n${colors.blue}[TEST: Session List]${colors.reset}`);

    try {
        const response = await makeRequest({
            hostname: 'localhost',
            port: API_PORT,
            path: '/sessions',
            method: 'GET'
        });

        if (response.statusCode === 200) {
            console.log(`${colors.green}✅ Session List${colors.reset}`);
            console.log(`   Active Sessions: ${response.data.sessions ? response.data.sessions.length : 0}`);
            testResults.passed.push('Session List');
            return response.data.sessions;
        } else {
            throw new Error(`Session list returned status ${response.statusCode}`);
        }
    } catch (error) {
        console.log(`${colors.red}❌ Session List${colors.reset}`);
        console.log(`   Error: ${error.message}`);
        testResults.failed.push({
            test: 'Session List',
            error: error.message
        });
        return [];
    }
}

async function testSessionRemoval(sessionId) {
    console.log(`\n${colors.blue}[TEST: Session Removal]${colors.reset}`);

    if (!sessionId) {
        console.log(`${colors.yellow}⚠ Skipping - No session ID provided${colors.reset}`);
        return;
    }

    try {
        const response = await makeRequest({
            hostname: 'localhost',
            port: API_PORT,
            path: `/sessions/${sessionId}`,
            method: 'DELETE'
        });

        if (response.statusCode === 200) {
            console.log(`${colors.green}✅ Session Removal${colors.reset}`);
            console.log(`   Session ${sessionId} removed successfully`);
            testResults.passed.push('Session Removal');
        } else {
            throw new Error(`Session removal returned status ${response.statusCode}`);
        }
    } catch (error) {
        console.log(`${colors.red}❌ Session Removal${colors.reset}`);
        console.log(`   Error: ${error.message}`);
        testResults.failed.push({
            test: 'Session Removal',
            error: error.message
        });
    }
}

async function testDatabaseIntegration() {
    console.log(`\n${colors.blue}[TEST: Database Integration]${colors.reset}`);

    const dbPath = path.join(__dirname, 'data', 'whatsapp.db.json');

    try {
        // Check if database file exists
        if (fs.existsSync(dbPath)) {
            const dbContent = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            console.log(`${colors.green}✅ Database File Exists${colors.reset}`);
            console.log(`   Collections: ${Object.keys(dbContent).join(', ')}`);

            if (dbContent.sessions) {
                console.log(`   Sessions in DB: ${dbContent.sessions.length}`);
            }
            if (dbContent.users) {
                console.log(`   Users in DB: ${dbContent.users.length}`);
            }

            testResults.passed.push('Database Integration - File Check');
        } else {
            console.log(`${colors.yellow}⚠ Database file not found at ${dbPath}${colors.reset}`);
            testResults.warnings.push('Database file not found');
        }
    } catch (error) {
        console.log(`${colors.red}❌ Database Integration${colors.reset}`);
        console.log(`   Error: ${error.message}`);
        testResults.failed.push({
            test: 'Database Integration',
            error: error.message
        });
    }
}

async function testStatusOperations(sessionId) {
    console.log(`\n${colors.blue}[TEST: Status Operations]${colors.reset}`);

    if (!sessionId) {
        console.log(`${colors.yellow}⚠ Skipping - No session ID provided${colors.reset}`);
        return;
    }

    // Test text status
    try {
        const response = await makeRequest({
            hostname: 'localhost',
            port: API_PORT,
            path: `/sessions/${sessionId}/status/text`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }, {
            content: 'Test status from v2 automation',
            options: {
                backgroundColor: '#000000',
                font: 1
            }
        });

        if (response.statusCode === 200) {
            console.log(`${colors.green}✅ Status Operations - Text Status${colors.reset}`);
            testResults.passed.push('Status Operations - Text Status');
        } else {
            throw new Error(`Text status returned status ${response.statusCode}`);
        }
    } catch (error) {
        console.log(`${colors.red}❌ Status Operations - Text Status${colors.reset}`);
        console.log(`   Error: ${error.message}`);
        testResults.failed.push({
            test: 'Status Operations - Text Status',
            error: error.message
        });
    }
}

async function runAllTests() {
    console.log(`${colors.bright}${'='.repeat(60)}${colors.reset}`);
    console.log(`${colors.bright}WhatsApp Automation v2 - Comprehensive Test Suite${colors.reset}`);
    console.log(`${colors.bright}${'='.repeat(60)}${colors.reset}`);
    console.log(`Started at: ${testResults.startTime.toISOString()}`);

    // 1. Architecture Analysis
    await testArchitectureAnalysis();

    // Check if we should attempt to start the API server
    let serverProcess = null;
    let serverStarted = false;

    console.log(`\n${colors.blue}[STARTING API SERVER]${colors.reset}`);

    // Try to start the server using the parent directory's multiuser file
    const multiuserPath = path.join(__dirname, '..', 'whatsapp-automation-multiuser.js');
    if (fs.existsSync(multiuserPath)) {
        console.log('Starting server from parent directory multiuser file...');
        serverProcess = spawn('node', [multiuserPath, '--api'], {
            cwd: path.dirname(multiuserPath),
            env: { ...process.env, PORT: API_PORT }
        });

        // Wait for server to start
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Check if server is running
        try {
            await makeRequest({
                hostname: 'localhost',
                port: API_PORT,
                path: '/health',
                method: 'GET'
            });
            serverStarted = true;
            console.log(`${colors.green}✓ API Server started successfully${colors.reset}`);
        } catch (error) {
            console.log(`${colors.red}✗ Failed to start API server${colors.reset}`);
            console.log(`  Error: ${error.message}`);
        }
    } else {
        console.log(`${colors.yellow}⚠ Parent multiuser file not found${colors.reset}`);
    }

    if (serverStarted) {
        // 2. API Server Tests
        await testAPIServer();

        // 3. Session Management Tests
        const qrSessionId = await testSessionCreation('qr');

        // 4. Session List
        await testSessionList();

        // 5. Database Integration
        await testDatabaseIntegration();

        // 6. Status Operations (only if session was created)
        if (qrSessionId) {
            await testStatusOperations(qrSessionId);

            // 7. Session Removal
            await testSessionRemoval(qrSessionId);
        }

        // Clean up server process
        if (serverProcess) {
            try {
                if (process.platform === 'win32') {
                    // Windows-specific termination
                    spawn('taskkill', ['/pid', serverProcess.pid, '/f', '/t']);
                } else {
                    serverProcess.kill('SIGTERM');
                }
                console.log(`\n${colors.blue}[SERVER STOPPED]${colors.reset}`);

                // Give it time to clean up
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (killError) {
                console.log(`\n${colors.yellow}[SERVER CLEANUP WARNING]${colors.reset}`);
                console.log(`   Could not kill server process: ${killError.message}`);
            }
        }
    }

    // Generate Report
    generateTestReport();
}

function generateTestReport() {
    const endTime = new Date();
    const duration = (endTime - testResults.startTime) / 1000;

    console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
    console.log(`${colors.bright}TEST REPORT${colors.reset}`);
    console.log(`${colors.bright}${'='.repeat(60)}${colors.reset}`);

    console.log(`\n${colors.blue}ARCHITECTURE FINDINGS:${colors.reset}`);
    if (testResults.architecture.issues && testResults.architecture.issues.length > 0) {
        console.log(`${colors.yellow}Issues Found:${colors.reset}`);
        testResults.architecture.issues.forEach(issue => {
            console.log(`  - ${issue}`);
        });
    }
    if (testResults.architecture.coreComponents) {
        console.log(`Core Components: ${testResults.architecture.coreComponents.join(', ')}`);
    }
    if (testResults.architecture.apiComponents) {
        console.log(`API Components: ${testResults.architecture.apiComponents.join(', ')}`);
    }

    console.log(`\n${colors.blue}TEST RESULTS:${colors.reset}`);
    console.log(`Total Tests Run: ${testResults.passed.length + testResults.failed.length}`);
    console.log(`${colors.green}Passed: ${testResults.passed.length}${colors.reset}`);
    console.log(`${colors.red}Failed: ${testResults.failed.length}${colors.reset}`);
    console.log(`${colors.yellow}Warnings: ${testResults.warnings.length}${colors.reset}`);

    if (testResults.passed.length > 0) {
        console.log(`\n${colors.green}PASSED TESTS:${colors.reset}`);
        testResults.passed.forEach(test => {
            console.log(`  ✅ ${test}`);
        });
    }

    if (testResults.failed.length > 0) {
        console.log(`\n${colors.red}FAILED TESTS:${colors.reset}`);
        testResults.failed.forEach(failure => {
            console.log(`  ❌ ${failure.test}`);
            console.log(`     Error: ${failure.error}`);
        });
    }

    if (testResults.warnings.length > 0) {
        console.log(`\n${colors.yellow}WARNINGS:${colors.reset}`);
        testResults.warnings.forEach(warning => {
            console.log(`  ⚠ ${warning}`);
        });
    }

    console.log(`\n${colors.blue}RECOMMENDATIONS:${colors.reset}`);

    // Generate recommendations based on findings
    const recommendations = [];

    if (testResults.architecture.issues && testResults.architecture.issues.length > 0) {
        recommendations.push('Fix import paths in index.js to reference correct file locations');
        recommendations.push('Consider moving required files to v2 directory or updating imports to use parent directory');
    }

    if (testResults.failed.find(f => f.test.includes('API Server'))) {
        recommendations.push('Ensure API server can start properly with correct dependencies');
        recommendations.push('Check that all required modules are properly installed');
    }

    if (testResults.failed.find(f => f.test.includes('Session Creation'))) {
        recommendations.push('Verify browser automation setup and Playwright installation');
        recommendations.push('Check that WA-JS library is properly integrated');
    }

    if (!fs.existsSync(path.join(__dirname, 'data', 'whatsapp.db.json'))) {
        recommendations.push('Initialize database before running the application');
        recommendations.push('Ensure data directory exists with proper permissions');
    }

    if (recommendations.length === 0) {
        recommendations.push('All tests passed successfully - system appears to be working correctly');
    }

    recommendations.forEach((rec, index) => {
        console.log(`  ${index + 1}. ${rec}`);
    });

    console.log(`\n${colors.blue}SUMMARY:${colors.reset}`);
    console.log(`Test Duration: ${duration.toFixed(2)} seconds`);
    console.log(`End Time: ${endTime.toISOString()}`);

    // Overall status
    const passRate = (testResults.passed.length / (testResults.passed.length + testResults.failed.length)) * 100;
    if (passRate === 100) {
        console.log(`${colors.green}✅ ALL TESTS PASSED${colors.reset}`);
    } else if (passRate >= 70) {
        console.log(`${colors.yellow}⚠ PARTIAL SUCCESS (${passRate.toFixed(0)}% pass rate)${colors.reset}`);
    } else {
        console.log(`${colors.red}❌ TESTING FAILED (${passRate.toFixed(0)}% pass rate)${colors.reset}`);
    }

    console.log(`\n${'='.repeat(60)}`);
}

// Run tests if executed directly
if (require.main === module) {
    runAllTests().catch(error => {
        console.error(`${colors.red}Fatal error during testing:${colors.reset}`, error);
        process.exit(1);
    }).finally(() => {
        // Ensure cleanup
        setTimeout(() => {
            process.exit(0);
        }, 1000);
    });
}

module.exports = {
    runAllTests,
    testAPIServer,
    testSessionCreation,
    testSessionList,
    testDatabaseIntegration,
    generateTestReport
};