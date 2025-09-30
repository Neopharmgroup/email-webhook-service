const { ObjectId } = require('mongodb');

class ImportLogsController {
    
    // Helper method to get collection safely
    static async waitForDatabase(maxRetries = 10, delayMs = 500) {
        const database = require('../database/connection');
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                if (database && database.db && typeof database.getCollection === 'function') {
                    return database;
                }
            } catch (error) {
                console.log(`⏳ Attempt ${i + 1}/${maxRetries}: Database not ready, waiting...`);
            }
            
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        
        throw new Error('Database not available after maximum retries');
    }

    /**
     * Get import logs with advanced filtering
     */
    static async getImportLogs(req, res) {
        try {
            const database = await ImportLogsController.waitForDatabase();
            
            const {
                page = 0,
                limit = 25,
                status,
                supplier,
                trackingNumber,
                poNumber,
                hasErrors,
                startDate,
                endDate,
                search
            } = req.query;

            const skip = page * limit;
            const query = {};

            // Build query filters
            if (status) query.status = status;
            if (supplier) query['supplierInfo.supplier'] = supplier;
            if (trackingNumber) query.trackingNumber = new RegExp(trackingNumber, 'i');
            if (poNumber === 'missing') {
                query.$or = [
                    { 'extractedData.poNumber': null },
                    { 'extractedData.poNumber': '' },
                    { 'extractedData.poNumber': { $exists: false } }
                ];
            } else if (poNumber) {
                query['extractedData.poNumber'] = new RegExp(poNumber, 'i');
            }
            if (hasErrors === 'true') query.hasErrors = true;
            if (hasErrors === 'false') query.hasErrors = { $ne: true };
            
            // Date range filter
            if (startDate || endDate) {
                query.createdAt = {};
                if (startDate) query.createdAt.$gte = new Date(startDate);
                if (endDate) query.createdAt.$lte = new Date(endDate);
            }

            // Search across multiple fields
            if (search) {
                query.$or = [
                    { trackingNumber: new RegExp(search, 'i') },
                    { 'extractedData.poNumber': new RegExp(search, 'i') },
                    { 'extractedData.supplierName': new RegExp(search, 'i') },
                    { 'supplierInfo.supplier': new RegExp(search, 'i') },
                    { 'emailInfo.fromEmail': new RegExp(search, 'i') }
                ];
            }

            // Get multiple collections
            const emailNotifications = database.getCollection('emailNotifications');
            const auditLogs = database.getCollection('auditLogs');

            // Get email notifications with automation results
            const emailLogs = await emailNotifications.find(query)
                .sort({ createdAt: -1 })
                .skip(parseInt(skip))
                .limit(parseInt(limit))
                .toArray();

            // Get total count
            const totalCount = await emailNotifications.countDocuments(query);

            // Enrich with automation results from audit logs
            const enrichedLogs = await Promise.all(emailLogs.map(async (log) => {
                // Find related automation processing logs
                const automationLogs = await auditLogs.find({
                    resourceType: 'automation_processing',
                    'details.trackingNumber': log.trackingNumber || log.messageId,
                    timestamp: {
                        $gte: new Date(log.createdAt.getTime() - 60000), // 1 minute before
                        $lte: new Date(log.createdAt.getTime() + 300000)  // 5 minutes after
                    }
                }).toArray();

                return {
                    ...log,
                    automationResults: automationLogs,
                    hasAutomationData: automationLogs.length > 0
                };
            }));

            res.json({
                success: true,
                data: enrichedLogs,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalCount,
                    pages: Math.ceil(totalCount / limit)
                },
                filters: {
                    status,
                    supplier,
                    trackingNumber,
                    poNumber,
                    hasErrors,
                    startDate,
                    endDate,
                    search
                }
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת import logs:', error);
            res.status(500).json({
                success: false,
                error: 'שגיאה בקבלת לוגי ייבוא',
                details: error.message
            });
        }
    }

    /**
     * Get import statistics
     */
    static async getImportStatistics(req, res) {
        try {
            const database = await ImportLogsController.waitForDatabase();
            const emailNotifications = database.getCollection('emailNotifications');
            const monitoringRules = database.getCollection('monitoringRules');

            const { startDate, endDate } = req.query;
            const dateFilter = {};
            if (startDate || endDate) {
                dateFilter.createdAt = {};
                if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
                if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
            }

            // Basic stats
            const totalEmails = await emailNotifications.countDocuments(dateFilter);
            const processedEmails = await emailNotifications.countDocuments({
                ...dateFilter,
                processed: true
            });
            const skippedEmails = await emailNotifications.countDocuments({
                ...dateFilter,
                skipped: true
            });
            const errorEmails = await emailNotifications.countDocuments({
                ...dateFilter,
                hasErrors: true
            });

            // Supplier breakdown
            const supplierStats = await emailNotifications.aggregate([
                { $match: { ...dateFilter, processed: true } },
                { $group: {
                    _id: '$supplierInfo.supplier',
                    count: { $sum: 1 },
                    totalWeight: { $sum: '$extractedData.weight' },
                    avgConfidence: { $avg: '$extractedData.confidence' }
                }},
                { $sort: { count: -1 } }
            ]).toArray();

            // PO Number stats
            const poStats = await emailNotifications.aggregate([
                { $match: { ...dateFilter, processed: true } },
                {
                    $group: {
                        _id: null,
                        withPO: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $ne: ['$extractedData.poNumber', null] },
                                            { $ne: ['$extractedData.poNumber', ''] },
                                            { $ne: ['$extractedData.poNumber', 'null'] }
                                        ]
                                    },
                                    1,
                                    0
                                ]
                            }
                        },
                        withoutPO: {
                            $sum: {
                                $cond: [
                                    {
                                        $or: [
                                            { $eq: ['$extractedData.poNumber', null] },
                                            { $eq: ['$extractedData.poNumber', ''] },
                                            { $eq: ['$extractedData.poNumber', 'null'] }
                                        ]
                                    },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                }
            ]).toArray();

            // Monitoring rules stats
            const rulesStats = await monitoringRules.aggregate([
                { $match: { active: true } },
                {
                    $group: {
                        _id: null,
                        totalRules: { $sum: 1 },
                        totalMatches: { $sum: '$totalMatches' },
                        totalForwards: { $sum: '$successfulForwards' },
                        avgMatchRate: { $avg: { $divide: ['$successfulForwards', { $max: ['$totalMatches', 1] }] } }
                    }
                }
            ]).toArray();

            // Target service breakdown
            const targetServiceStats = await monitoringRules.aggregate([
                { $match: { active: true } },
                { $group: {
                    _id: '$targetService',
                    count: { $sum: 1 },
                    totalMatches: { $sum: '$totalMatches' }
                }},
                { $sort: { count: -1 } }
            ]).toArray();

            // Daily processing trend (last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            
            const dailyTrend = await emailNotifications.aggregate([
                { $match: { 
                    createdAt: { $gte: thirtyDaysAgo },
                    processed: true
                }},
                {
                    $group: {
                        _id: {
                            $dateToString: {
                                format: '%Y-%m-%d',
                                date: '$createdAt'
                            }
                        },
                        count: { $sum: 1 },
                        withPO: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $ne: ['$extractedData.poNumber', null] },
                                            { $ne: ['$extractedData.poNumber', ''] },
                                            { $ne: ['$extractedData.poNumber', 'null'] }
                                        ]
                                    },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                },
                { $sort: { _id: 1 } }
            ]).toArray();

            res.json({
                success: true,
                statistics: {
                    overview: {
                        totalEmails,
                        processedEmails,
                        skippedEmails,
                        errorEmails,
                        processingRate: totalEmails > 0 ? (processedEmails / totalEmails * 100).toFixed(1) : 0
                    },
                    suppliers: supplierStats,
                    poNumbers: poStats[0] || { withPO: 0, withoutPO: 0 },
                    monitoringRules: rulesStats[0] || { totalRules: 0, totalMatches: 0, totalForwards: 0, avgMatchRate: 0 },
                    targetServices: targetServiceStats,
                    dailyTrend
                },
                dateRange: { startDate, endDate }
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת סטטיסטיקות:', error);
            res.status(500).json({
                success: false,
                error: 'שגיאה בקבלת סטטיסטיקות ייבוא',
                details: error.message
            });
        }
    }

    /**
     * Get failed imports
     */
    static async getFailedImports(req, res) {
        try {
            const database = await ImportLogsController.waitForDatabase();
            const emailNotifications = database.getCollection('emailNotifications');
            
            const { page = 0, limit = 25 } = req.query;
            const skip = page * limit;

            const failedImports = await emailNotifications.find({
                $or: [
                    { hasErrors: true },
                    { processed: false, skipped: false },
                    { 'extractedData.confidence': { $lt: 0.7 } }
                ]
            })
            .sort({ createdAt: -1 })
            .skip(parseInt(skip))
            .limit(parseInt(limit))
            .toArray();

            const totalCount = await emailNotifications.countDocuments({
                $or: [
                    { hasErrors: true },
                    { processed: false, skipped: false },
                    { 'extractedData.confidence': { $lt: 0.7 } }
                ]
            });

            res.json({
                success: true,
                data: failedImports,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalCount,
                    pages: Math.ceil(totalCount / limit)
                }
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת failed imports:', error);
            res.status(500).json({
                success: false,
                error: 'שגיאה בקבלת ייבואים כושלים',
                details: error.message
            });
        }
    }

    /**
     * Get imports without PO numbers
     */
    static async getImportsWithoutPO(req, res) {
        try {
            const database = await ImportLogsController.waitForDatabase();
            const emailNotifications = database.getCollection('emailNotifications');
            
            const { page = 0, limit = 25 } = req.query;
            const skip = page * limit;

            const importsWithoutPO = await emailNotifications.find({
                processed: true,
                $or: [
                    { 'extractedData.poNumber': null },
                    { 'extractedData.poNumber': '' },
                    { 'extractedData.poNumber': 'null' },
                    { 'extractedData.poNumber': { $exists: false } }
                ]
            })
            .sort({ createdAt: -1 })
            .skip(parseInt(skip))
            .limit(parseInt(limit))
            .toArray();

            const totalCount = await emailNotifications.countDocuments({
                processed: true,
                $or: [
                    { 'extractedData.poNumber': null },
                    { 'extractedData.poNumber': '' },
                    { 'extractedData.poNumber': 'null' },
                    { 'extractedData.poNumber': { $exists: false } }
                ]
            });

            res.json({
                success: true,
                data: importsWithoutPO,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalCount,
                    pages: Math.ceil(totalCount / limit)
                }
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת imports without PO:', error);
            res.status(500).json({
                success: false,
                error: 'שגיאה בקבלת ייבואים ללא PO',
                details: error.message
            });
        }
    }

    /**
     * Get import details by ID
     */
    static async getImportDetails(req, res) {
        try {
            const database = await ImportLogsController.waitForDatabase();
            const emailNotifications = database.getCollection('emailNotifications');
            const auditLogs = database.getCollection('auditLogs');
            
            const { id } = req.params;

            const importRecord = await emailNotifications.findOne({
                _id: new ObjectId(id)
            });

            if (!importRecord) {
                return res.status(404).json({
                    success: false,
                    error: 'רשומת ייבוא לא נמצאה'
                });
            }

            // Get related audit logs
            const relatedLogs = await auditLogs.find({
                $or: [
                    { 'details.messageId': importRecord.messageId },
                    { 'details.trackingNumber': importRecord.trackingNumber },
                    { resourceId: id }
                ]
            }).sort({ timestamp: 1 }).toArray();

            res.json({
                success: true,
                data: {
                    ...importRecord,
                    auditTrail: relatedLogs
                }
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת פרטי ייבוא:', error);
            res.status(500).json({
                success: false,
                error: 'שגיאה בקבלת פרטי ייבוא',
                details: error.message
            });
        }
    }

    /**
     * Get processing summary for specific tracking number
     */
    static async getProcessingSummary(req, res) {
        try {
            const database = await ImportLogsController.waitForDatabase();
            const emailNotifications = database.getCollection('emailNotifications');
            const auditLogs = database.getCollection('auditLogs');
            
            const { trackingNumber } = req.params;

            const relatedRecords = await emailNotifications.find({
                $or: [
                    { trackingNumber: trackingNumber },
                    { 'extractedData.trackingNumber': trackingNumber }
                ]
            }).sort({ createdAt: 1 }).toArray();

            const relatedAudits = await auditLogs.find({
                'details.trackingNumber': trackingNumber
            }).sort({ timestamp: 1 }).toArray();

            res.json({
                success: true,
                data: {
                    trackingNumber,
                    emailRecords: relatedRecords,
                    auditTrail: relatedAudits,
                    summary: {
                        totalEmails: relatedRecords.length,
                        processedCount: relatedRecords.filter(r => r.processed).length,
                        errorCount: relatedRecords.filter(r => r.hasErrors).length,
                        firstSeen: relatedRecords[0]?.createdAt,
                        lastSeen: relatedRecords[relatedRecords.length - 1]?.createdAt
                    }
                }
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת סיכום עיבוד:', error);
            res.status(500).json({
                success: false,
                error: 'שגיאה בקבלת סיכום עיבוד',
                details: error.message
            });
        }
    }

    /**
     * Get monitoring statistics
     */
    static async getMonitoringStatistics(req, res) {
        try {
            const database = await ImportLogsController.waitForDatabase();
            const monitoringRules = database.getCollection('monitoringRules');

            const rulesWithStats = await monitoringRules.find({ active: true })
                .sort({ totalMatches: -1 })
                .toArray();

            const totalRules = rulesWithStats.length;
            const totalMatches = rulesWithStats.reduce((sum, rule) => sum + (rule.totalMatches || 0), 0);
            const totalForwards = rulesWithStats.reduce((sum, rule) => sum + (rule.successfulForwards || 0), 0);

            res.json({
                success: true,
                data: {
                    overview: {
                        totalRules,
                        totalMatches,
                        totalForwards,
                        successRate: totalMatches > 0 ? (totalForwards / totalMatches * 100).toFixed(1) : 0
                    },
                    rules: rulesWithStats,
                    targetServiceBreakdown: rulesWithStats.reduce((acc, rule) => {
                        const service = rule.targetService || 'automation';
                        if (!acc[service]) acc[service] = { count: 0, matches: 0 };
                        acc[service].count++;
                        acc[service].matches += rule.totalMatches || 0;
                        return acc;
                    }, {})
                }
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת סטטיסטיקות מוניטורינג:', error);
            res.status(500).json({
                success: false,
                error: 'שגיאה בקבלת סטטיסטיקות מוניטורינג',
                details: error.message
            });
        }
    }

    /**
     * Get supplier statistics
     */
    static async getSupplierStatistics(req, res) {
        try {
            const database = await ImportLogsController.waitForDatabase();
            const emailNotifications = database.getCollection('emailNotifications');

            const supplierStats = await emailNotifications.aggregate([
                { $match: { processed: true } },
                {
                    $group: {
                        _id: '$supplierInfo.supplier',
                        totalEmails: { $sum: 1 },
                        totalWeight: { $sum: '$extractedData.weight' },
                        avgConfidence: { $avg: '$extractedData.confidence' },
                        withPO: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $ne: ['$extractedData.poNumber', null] },
                                            { $ne: ['$extractedData.poNumber', ''] },
                                            { $ne: ['$extractedData.poNumber', 'null'] }
                                        ]
                                    },
                                    1,
                                    0
                                ]
                            }
                        },
                        errorCount: { $sum: { $cond: ['$hasErrors', 1, 0] } },
                        lastActivity: { $max: '$createdAt' }
                    }
                },
                { $sort: { totalEmails: -1 } }
            ]).toArray();

            res.json({
                success: true,
                data: supplierStats.map(stat => ({
                    ...stat,
                    supplier: stat._id || 'UNKNOWN',
                    poRate: stat.totalEmails > 0 ? (stat.withPO / stat.totalEmails * 100).toFixed(1) : 0,
                    errorRate: stat.totalEmails > 0 ? (stat.errorCount / stat.totalEmails * 100).toFixed(1) : 0
                }))
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת סטטיסטיקות ספקים:', error);
            res.status(500).json({
                success: false,
                error: 'שגיאה בקבלת סטטיסטיקות ספקים',
                details: error.message
            });
        }
    }
}

module.exports = ImportLogsController;