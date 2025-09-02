const database = require('../database/connection');
const AuditLog = require('./AuditLog');
const MonitoredEmail = require('./MonitoredEmail');

class Subscription {
    static get collection() {
        return database.getCollection('subscriptions');
    }

    static async create(subscriptionData) {
        const subscription = {
            email: subscriptionData.email,
            subscriptionId: subscriptionData.subscriptionId,
            resource: subscriptionData.resource,
            expirationDateTime: new Date(subscriptionData.expirationDateTime),
            createdAt: new Date(),
            createdBy: subscriptionData.createdBy || 'SYSTEM',
            changeType: subscriptionData.changeType || 'created',
            isActive: true,
            renewalCount: 0,
            clientState: subscriptionData.clientState
        };
        
        try {
            const result = await this.collection.insertOne(subscription);
            
            // עדכן סטטוס המייל המנוטר
            await MonitoredEmail.updateStatus(
                subscriptionData.email, 
                'ACTIVE', 
                subscriptionData.createdBy || 'SYSTEM', 
                `Subscription נוצר: ${subscription.subscriptionId}`
            );
            
            await AuditLog.create({
                action: 'SUBSCRIPTION_CREATED',
                resourceType: 'Subscription',
                resourceId: result.insertedId.toString(),
                details: {
                    email: subscription.email,
                    subscriptionId: subscription.subscriptionId,
                    expiresAt: subscription.expirationDateTime,
                    createdBy: subscription.createdBy,
                    changeType: subscription.changeType,
                    clientState: subscription.clientState
                },
                performedBy: subscription.createdBy || 'SYSTEM'
            });
            
            console.log(`✅ Subscription נוצר במסד הנתונים עבור ${subscription.email} על ידי ${subscription.createdBy}`);
            
            return await this.collection.findOne({ _id: result.insertedId });
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`כבר קיים subscription פעיל למייל ${subscriptionData.email}`);
            }
            console.error(`❌ שגיאה ביצירת subscription במסד הנתונים:`, error);
            throw error;
        }
    }

    static async findBySubscriptionId(subscriptionId) {
        return await this.collection.findOne({ subscriptionId });
    }

    static async findAllByEmail(email) {
        return await this.collection.find({ email, isActive: true }).sort({ createdAt: -1 }).toArray();
    }
    
    static async findByEmail(email) {
        return await this.collection.findOne({ email, isActive: true });
    }

    static async findAllSubscriptionsByEmail(email) {
        return await this.collection.find({ email }).sort({ createdAt: -1 }).toArray();
    }

    static async getAllActive() {
        return await this.collection.find({ isActive: true }).sort({ createdAt: -1 }).toArray();
    }

    static async deactivate(subscriptionId, deactivatedBy = 'SYSTEM') {
        const result = await this.collection.updateOne(
            { subscriptionId },
            { 
                $set: { 
                    isActive: false, 
                    deactivatedAt: new Date(),
                    deactivatedBy
                } 
            }
        );
        
        if (result.modifiedCount > 0) {
            await AuditLog.create({
                action: 'SUBSCRIPTION_DEACTIVATED',
                resourceType: 'Subscription',
                resourceId: subscriptionId,
                details: { subscriptionId, deactivatedBy },
                performedBy: deactivatedBy
            });
        }
        
        return result.modifiedCount > 0;
    }

    static async updateExpiration(subscriptionId, newExpirationDateTime, renewedBy) {
        const result = await this.collection.updateOne(
            { subscriptionId },
            { 
                $set: { 
                    expirationDateTime: new Date(newExpirationDateTime),
                    lastRenewed: new Date(),
                    renewedBy: renewedBy
                },
                $inc: { renewalCount: 1 }
            }
        );
        
        if (result.modifiedCount > 0) {
            await AuditLog.create({
                action: 'SUBSCRIPTION_RENEWED',
                resourceType: 'Subscription',
                resourceId: subscriptionId,
                details: {
                    subscriptionId,
                    newExpirationDateTime,
                    renewedBy
                },
                performedBy: renewedBy
            });
        }
        
        return result.modifiedCount > 0;
    }

    static async getExpiringSoon(hoursThreshold = 24) {
        const thresholdDate = new Date(Date.now() + (hoursThreshold * 60 * 60 * 1000));
        
        return await this.collection.find({
            isActive: true,
            expirationDateTime: { $lte: thresholdDate }
        }).sort({ expirationDateTime: 1 }).toArray();
    }

    static async getEmailSubscriptionStats(email) {
        const allSubscriptions = await this.collection.find({ email }).toArray();
        const activeSubscriptions = allSubscriptions.filter(sub => sub.isActive);
        const expiredSubscriptions = allSubscriptions.filter(sub => !sub.isActive);
        
        return {
            total: allSubscriptions.length,
            active: activeSubscriptions.length,
            expired: expiredSubscriptions.length,
            totalRenewals: allSubscriptions.reduce((sum, sub) => sum + (sub.renewalCount || 0), 0),
            oldestActive: activeSubscriptions.length > 0 ? 
                activeSubscriptions.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0] : null,
            newestActive: activeSubscriptions.length > 0 ? 
                activeSubscriptions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] : null
        };
    }

    static async getStatistics() {
        const total = await this.collection.countDocuments();
        const active = await this.collection.countDocuments({ isActive: true });
        const expired = await this.collection.countDocuments({ isActive: false });
        const expiringSoon = await this.getExpiringSoon(24);
        
        return {
            total,
            active,
            expired,
            expiringSoon: expiringSoon.length
        };
    }
}

module.exports = Subscription;