const fs = require('fs');
const path = require('path');
const JsonDB = require('./json-db');

/**
 * Database initialization and migration script
 * Ensures database structure is properly set up
 */
class DatabaseInitializer {
    constructor(dbPath = './data/whatsapp.db.json') {
        this.dbPath = dbPath;
        this.db = null;
    }

    /**
     * Initialize database with proper structure
     */
    async initialize() {
        console.log('🔧 Initializing database...');

        // Ensure data directory exists
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            console.log(`✅ Created data directory: ${dataDir}`);
        }

        // Initialize database
        this.db = new JsonDB(this.dbPath, { autoSave: true, prettify: true });

        // Initialize collections
        this.initializeCollections();

        // Run migrations if needed
        await this.runMigrations();

        console.log('✅ Database initialization complete');
        return this.db;
    }

    /**
     * Initialize required collections
     */
    initializeCollections() {
        // Sessions collection
        if (!this.db.has('sessions')) {
            this.db.set('sessions', []);
            console.log('✅ Created sessions collection');
        }

        // Users collection
        if (!this.db.has('users')) {
            this.db.set('users', []);
            console.log('✅ Created users collection');
        }

        // Messages collection
        if (!this.db.has('messages')) {
            this.db.set('messages', []);
            console.log('✅ Created messages collection');
        }

        // System metadata
        if (!this.db.has('_metadata')) {
            this.db.set('_metadata', {
                version: '1.0.0',
                createdAt: new Date(),
                lastMigration: null
            });
            console.log('✅ Created metadata');
        }
    }

    /**
     * Run database migrations
     */
    async runMigrations() {
        const metadata = this.db.get('_metadata');
        const currentVersion = metadata.version;

        console.log(`📊 Current database version: ${currentVersion}`);

        // Migration from version 1.0.0 to 1.1.0
        if (currentVersion === '1.0.0') {
            await this.migrateTo_1_1_0();
        }

        // Add more migrations as needed
    }

    /**
     * Example migration to version 1.1.0
     */
    async migrateTo_1_1_0() {
        console.log('🔄 Migrating to version 1.1.0...');

        const sessionsCollection = this.db.collection('sessions');
        const sessions = sessionsCollection.find();

        // Add new fields to existing sessions
        sessions.forEach(session => {
            if (!session.sessionPath) {
                session.sessionPath = path.join(__dirname, 'sessions', session.id);
            }
            if (!session.terminatedAt && session.status === 'terminated') {
                session.terminatedAt = session.lastActivity || new Date();
            }
        });

        // Update metadata
        this.db.set('_metadata', {
            ...this.db.get('_metadata'),
            version: '1.1.0',
            lastMigration: new Date()
        });

        this.db.save();
        console.log('✅ Migration to 1.1.0 complete');
    }

    /**
     * Clean up old terminated sessions
     */
    cleanupOldSessions(daysToKeep = 30) {
        const sessionsCollection = this.db.collection('sessions');
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        const oldSessions = sessionsCollection.find({
            status: 'terminated',
            terminatedAt: { $lt: cutoffDate }
        });

        oldSessions.forEach(session => {
            // Remove session directory if exists
            const sessionPath = session.sessionPath || path.join(__dirname, 'sessions', session.id);
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }

            // Remove from database
            sessionsCollection.deleteById(session.id);
        });

        console.log(`🧹 Cleaned up ${oldSessions.length} old sessions`);
        return oldSessions.length;
    }

    /**
     * Create database backup
     */
    createBackup(backupName = null) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = backupName || `./backups/whatsapp.db.${timestamp}.json`;

        // Ensure backup directory exists
        const backupDir = path.dirname(backupPath);
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const result = this.db.backup(backupPath);
        if (result) {
            console.log(`💾 Backup created: ${result}`);
        }
        return result;
    }

    /**
     * Validate database integrity
     */
    validateDatabase() {
        const errors = [];
        const warnings = [];

        // Check collections exist
        if (!this.db.has('sessions')) {
            errors.push('Sessions collection missing');
        }
        if (!this.db.has('users')) {
            errors.push('Users collection missing');
        }
        if (!this.db.has('messages')) {
            errors.push('Messages collection missing');
        }
        if (!this.db.has('_metadata')) {
            warnings.push('Metadata missing');
        }

        // Validate session data
        const sessionsCollection = this.db.collection('sessions');
        const sessions = sessionsCollection.find();

        sessions.forEach(session => {
            if (!session.id) {
                errors.push(`Session without ID found`);
            }
            if (!session.userId) {
                warnings.push(`Session ${session.id} has no userId`);
            }
            if (!session.status) {
                errors.push(`Session ${session.id} has no status`);
            }
        });

        // Validate user data
        const usersCollection = this.db.collection('users');
        const users = usersCollection.find();

        users.forEach(user => {
            if (!user.userId) {
                errors.push('User without userId found');
            }
        });

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Get database statistics
     */
    getStatistics() {
        const sessionsCollection = this.db.collection('sessions');
        const usersCollection = this.db.collection('users');

        return {
            database: {
                path: this.dbPath,
                size: fs.existsSync(this.dbPath) ? fs.statSync(this.dbPath).size : 0,
                version: this.db.get('_metadata')?.version || 'unknown'
            },
            sessions: {
                total: sessionsCollection.count(),
                active: sessionsCollection.count({ status: { $ne: 'terminated' } }),
                ready: sessionsCollection.count({ status: 'ready' }),
                terminated: sessionsCollection.count({ status: 'terminated' })
            },
            users: {
                total: usersCollection.count(),
                active: usersCollection.count({
                    lastActivity: {
                        $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Active in last 7 days
                    }
                })
            },
            messages: {
                total: this.db.collection('messages').count()
            }
        };
    }
}

// Export for use in other modules
module.exports = DatabaseInitializer;

// Run if called directly
if (require.main === module) {
    const initializer = new DatabaseInitializer();

    initializer.initialize().then(() => {
        // Validate database
        const validation = initializer.validateDatabase();
        console.log('\n📋 Database Validation:');
        console.log(`Valid: ${validation.valid ? '✅' : '❌'}`);
        if (validation.errors.length > 0) {
            console.log('Errors:', validation.errors);
        }
        if (validation.warnings.length > 0) {
            console.log('Warnings:', validation.warnings);
        }

        // Show statistics
        const stats = initializer.getStatistics();
        console.log('\n📊 Database Statistics:');
        console.log(JSON.stringify(stats, null, 2));

        // Create backup
        const backupPath = initializer.createBackup();
        console.log(`\n💾 Backup created at: ${backupPath}`);
    }).catch(error => {
        console.error('❌ Database initialization failed:', error);
        process.exit(1);
    });
}