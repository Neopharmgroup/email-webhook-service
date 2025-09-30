const database = require('../database/connection');
const mongoose = require('mongoose');

const emailNotificationSchema = new mongoose.Schema({
    email: { type: String, required: true },
    subscriptionId: { type: String, required: true },
    resource: { type: String, required: true },
    changeType: { type: String, required: true },
    clientState: { type: String },
    messageId: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    processed: { type: Boolean, default: false },
    
    // שדות חדשים למעקב אחר מיילים שדולגו
    skipped: { type: Boolean, default: false },
    reason: { type: String },
    hasErrors: { type: Boolean, default: false },
    
    // מידע על יעד השליחה
    targetService: { type: String, enum: ['automation', 'archive', 'custom'], default: 'automation' },
    customServiceUrl: { type: String },
    
    // מידע מועשר על הספק והמסמך
    supplierInfo: {
        supplier: String,
        documentType: String,
        trackingNumber: String,
        poNumber: String,
        weight: Number,
        weightUnit: String,
        confidence: Number,
        supplierName: String
    },
    
    // נתונים שחולצו מהמסמך
    extractedData: {
        trackingNumber: String,
        poNumber: String,
        weight: Number,
        weightUnit: String,
        confidence: Number,
        supplierName: String,
        documentType: String,
        billOfLadingNumber: String,
        packageCount: Number,
        value: Number,
        currency: String
    },
    
    // מידע על המייל
    emailInfo: {
        fromEmail: String,
        subject: String,
        hasAttachments: Boolean,
        attachmentCount: Number
    },
    
    // מידע על כללי מוניטורינג
    monitoringInfo: {
        matchingRules: [{
            id: String,
            name: String,
            priority: String
        }],
        topRule: {
            id: String,
            name: String,
            priority: String
        }
    },
    
    metadata: {
        userAgent: String,
        ipAddress: String
    }
}, {
    timestamps: true
});

class EmailNotification {
    static get collection() {
        return database.getCollection('notifications');
    }

    static async create(notificationData) {
        const notification = {
            email: notificationData.email,
            subscriptionId: notificationData.subscriptionId,
            resource: notificationData.resource,
            changeType: notificationData.changeType,
            clientState: notificationData.clientState,
            messageId: notificationData.resource?.split('/Messages/')[1] || 'unknown',
            timestamp: new Date(),
            processed: false,
            metadata: {
                userAgent: notificationData.userAgent,
                ipAddress: notificationData.ipAddress
            }
        };

        const result = await this.collection.insertOne(notification);
        return await this.collection.findOne({ _id: result.insertedId });
    }

    static async getRecentNotifications(limit = 50) {
        return await this.collection
            .find()
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }

    static async getNotificationsByEmail(email, limit = 20) {
        return await this.collection
            .find({ email })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }

    static async getNotificationsBySubscription(subscriptionId, limit = 20) {
        return await this.collection
            .find({ subscriptionId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }

    static async markAsProcessed(notificationId) {
        return await this.collection.updateOne(
            { _id: notificationId },
            { 
                $set: { 
                    processed: true, 
                    processedAt: new Date() 
                } 
            }
        );
    }

    static async getUnprocessedNotifications(limit = 100) {
        return await this.collection
            .find({ processed: false })
            .sort({ timestamp: 1 })
            .limit(limit)
            .toArray();
    }

    static async getStatistics() {
        const total = await this.collection.countDocuments();
        const processed = await this.collection.countDocuments({ processed: true });
        const unprocessed = await this.collection.countDocuments({ processed: false });
        
        // Get notifications from last 24 hours
        const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recent = await this.collection.countDocuments({
            timestamp: { $gte: last24Hours }
        });

        return {
            total,
            processed,
            unprocessed,
            recentCount: recent
        };
    }

    static async deleteOldNotifications(daysToKeep = 30) {
        const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
        
        const result = await this.collection.deleteMany({
            timestamp: { $lt: cutoffDate },
            processed: true
        });

        return result.deletedCount;
    }
}

module.exports = EmailNotification;