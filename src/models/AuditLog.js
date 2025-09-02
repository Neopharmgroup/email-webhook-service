const database = require('../database/connection');

class AuditLog {
    static get collection() {
        return database.getCollection('auditLogs');
    }

    static async create(logData) {
        const log = {
            action: logData.action,
            resourceType: logData.resourceType,
            resourceId: logData.resourceId,
            details: logData.details,
            performedBy: logData.performedBy,
            timestamp: new Date(),
            ipAddress: logData.ipAddress,
            userAgent: logData.userAgent,
            sessionId: logData.sessionId,
            severity: logData.severity || 'INFO'
        };

        return await this.collection.insertOne(log);
    }

    static async getRecentLogs(limit = 100) {
        return await this.collection
            .find()
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }

    static async getLogsByUser(performedBy, limit = 50) {
        return await this.collection
            .find({ performedBy })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }

    static async getLogsByAction(action, limit = 50) {
        return await this.collection
            .find({ action })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }

    static async getLogsByResource(resourceType, resourceId, limit = 50) {
        return await this.collection
            .find({ resourceType, resourceId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }

    static async getLogsByDateRange(startDate, endDate, limit = 1000) {
        return await this.collection
            .find({
                timestamp: {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate)
                }
            })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }

    static async getStatistics() {
        // Actions statistics
        const actionsPipeline = [
            {
                $group: {
                    _id: '$action',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ];

        // Users statistics
        const usersPipeline = [
            {
                $group: {
                    _id: '$performedBy',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ];

        const [actionStats, userStats] = await Promise.all([
            this.collection.aggregate(actionsPipeline).toArray(),
            this.collection.aggregate(usersPipeline).toArray()
        ]);

        const total = await this.collection.countDocuments();
        
        // Get logs from last 24 hours
        const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentCount = await this.collection.countDocuments({
            timestamp: { $gte: last24Hours }
        });

        return {
            total,
            recentCount,
            topActions: actionStats.slice(0, 10),
            topUsers: userStats.slice(0, 10)
        };
    }

    static async deleteOldLogs(daysToKeep = 90) {
        const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
        
        const result = await this.collection.deleteMany({
            timestamp: { $lt: cutoffDate }
        });

        return result.deletedCount;
    }

    // Security audit methods
    static async getSecurityEvents(limit = 100) {
        const securityActions = [
            'LOGIN_ATTEMPT',
            'LOGIN_SUCCESS',
            'LOGIN_FAILED',
            'PERMISSION_DENIED',
            'UNAUTHORIZED_ACCESS',
            'EMAIL_ADDED_FOR_MONITORING',
            'EMAIL_REMOVED_FROM_MONITORING',
            'SUBSCRIPTION_CREATED',
            'SUBSCRIPTION_DEACTIVATED'
        ];

        return await this.collection
            .find({ action: { $in: securityActions } })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }

    static async getFailedOperations(limit = 50) {
        return await this.collection
            .find({ 
                $or: [
                    { action: { $regex: /FAILED/i } },
                    { severity: 'ERROR' },
                    { 'details.error': { $exists: true } }
                ]
            })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }
}

module.exports = AuditLog;