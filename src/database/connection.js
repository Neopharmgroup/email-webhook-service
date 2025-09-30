const { MongoClient } = require('mongodb');
const config = require('../config');

class DatabaseConnection {
    constructor() {
        this.client = null;
        this.db = null;
        this.collections = {};
    }

    async connect() {
        try {
            console.log('🔄 מתחבר ל-MongoDB...');
            
            this.client = new MongoClient(config.database.uri, config.database.options);
            await this.client.connect();
            
            this.db = this.client.db(config.database.name);
            
            // Initialize collections
            this.collections = {
                monitoredEmails: this.db.collection('monitored_emails'),
                subscriptions: this.db.collection('subscriptions'),
                notifications: this.db.collection('notifications'),
                auditLogs: this.db.collection('audit_logs'),
                emailConfigurations: this.db.collection('email_configurations'),
                monitoringRules: this.db.collection('monitoring_rules')
            };

            // Create indexes
            await this.createIndexes();
            
            console.log('✅ התחברות ל-MongoDB הושלמה');
            return this.db;
        } catch (error) {
            console.error('❌ שגיאה בהתחברות ל-MongoDB:', error);
            process.exit(1);
        }
    }

    async createIndexes() {
        try {
            // Monitored Emails indexes
            await this.collections.monitoredEmails.createIndex({ email: 1 }, { unique: true });
            await this.collections.monitoredEmails.createIndex({ status: 1 });
            await this.collections.monitoredEmails.createIndex({ addedAt: -1 });
            
            // Subscriptions indexes
            await this.collections.subscriptions.createIndex({ email: 1 });
            await this.collections.subscriptions.createIndex({ subscriptionId: 1 }, { unique: true });
            await this.collections.subscriptions.createIndex({ isActive: 1 });
            await this.collections.subscriptions.createIndex({ expirationDateTime: 1 });
            
            // Notifications indexes
            await this.collections.notifications.createIndex({ email: 1 });
            await this.collections.notifications.createIndex({ timestamp: -1 });
            await this.collections.notifications.createIndex({ subscriptionId: 1 });
            
            // Audit Logs indexes
            await this.collections.auditLogs.createIndex({ timestamp: -1 });
            await this.collections.auditLogs.createIndex({ performedBy: 1 });
            await this.collections.auditLogs.createIndex({ action: 1 });
            
            // Email Configurations indexes
            await this.collections.emailConfigurations.createIndex({ email: 1 }, { unique: true });
            await this.collections.emailConfigurations.createIndex({ isActive: 1 });
            await this.collections.emailConfigurations.createIndex({ supplier: 1 });
            await this.collections.emailConfigurations.createIndex({ addedAt: -1 });
            
            // Monitoring Rules indexes
            await this.collections.monitoringRules.createIndex({ emailAddress: 1 });
            await this.collections.monitoringRules.createIndex({ active: 1 });
            await this.collections.monitoringRules.createIndex({ emailAddress: 1, active: 1 });
            await this.collections.monitoringRules.createIndex({ createdAt: -1 });
            
            console.log('✅ אינדקסים נוצרו בהצלחה');
        } catch (error) {
            console.error('❌ שגיאה ביצירת אינדקסים:', error);
        }
    }

    getCollection(name) {
        if (!this.db) {
            throw new Error('Database not connected yet. Call connect() first.');
        }
        
        if (!this.collections[name]) {
            // אם הקולקציה לא מוגדרת מראש, צור אותה דינמית
            console.log(`⚠️ יוצר קולקציה חדשה: ${name}`);
            this.collections[name] = this.db.collection(name);
        }
        return this.collections[name];
    }

    async disconnect() {
        if (this.client) {
            await this.client.close();
            console.log('🔌 קישור ל-MongoDB נסגר');
        }
    }

    async healthCheck() {
        try {
            await this.db.admin().ping();
            return { status: 'healthy', timestamp: new Date() };
        } catch (error) {
            return { status: 'unhealthy', error: error.message, timestamp: new Date() };
        }
    }
}

module.exports = new DatabaseConnection();