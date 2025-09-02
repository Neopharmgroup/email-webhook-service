const { AuditLog } = require('../models');

class AuditController {
    // קבלת היסטוריית audit
    async getAuditLogs(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 100;
            const action = req.query.action;
            const performedBy = req.query.performedBy;
            const resourceType = req.query.resourceType;
            const resourceId = req.query.resourceId;
            const startDate = req.query.startDate;
            const endDate = req.query.endDate;

            let logs;

            if (startDate && endDate) {
                logs = await AuditLog.getLogsByDateRange(startDate, endDate, limit);
            } else if (performedBy) {
                logs = await AuditLog.getLogsByUser(performedBy, limit);
            } else if (action) {
                logs = await AuditLog.getLogsByAction(action, limit);
            } else if (resourceType && resourceId) {
                logs = await AuditLog.getLogsByResource(resourceType, resourceId, limit);
            } else {
                logs = await AuditLog.getRecentLogs(limit);
            }

            res.json({
                total: logs.length,
                filters: {
                    action,
                    performedBy,
                    resourceType,
                    resourceId,
                    startDate,
                    endDate
                },
                logs
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת audit logs:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת היסטוריית audit',
                details: error.message
            });
        }
    }

    // סטטיסטיקות audit
    async getAuditStatistics(req, res) {
        try {
            const stats = await AuditLog.getStatistics();
            res.json({
                auditLogs: stats,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת סטטיסטיקות audit:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת סטטיסטיקות audit',
                details: error.message
            });
        }
    }

    // אירועי אבטחה
    async getSecurityEvents(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 100;
            const securityEvents = await AuditLog.getSecurityEvents(limit);

            res.json({
                total: securityEvents.length,
                securityEvents
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת אירועי אבטחה:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת אירועי אבטחה',
                details: error.message
            });
        }
    }

    // פעולות כושלות
    async getFailedOperations(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 50;
            const failedOps = await AuditLog.getFailedOperations(limit);

            res.json({
                total: failedOps.length,
                failedOperations: failedOps
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת פעולות כושלות:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת פעולות כושלות',
                details: error.message
            });
        }
    }

    // מחיקת audit logs ישנים
    async deleteOldLogs(req, res) {
        try {
            const daysToKeep = parseInt(req.query.days) || 90;
            const deletedCount = await AuditLog.deleteOldLogs(daysToKeep);

            res.json({
                message: 'Audit logs ישנים נמחקו',
                daysToKeep,
                deletedCount
            });
        } catch (error) {
            console.error('❌ שגיאה במחיקת audit logs ישנים:', error);
            res.status(500).json({
                error: 'שגיאה במחיקת audit logs ישנים',
                details: error.message
            });
        }
    }

    // יצירת audit log ידני
    async createManualLog(req, res) {
        try {
            const {
                action,
                resourceType,
                resourceId,
                details,
                performedBy,
                severity = 'INFO'
            } = req.body;

            if (!action || !performedBy) {
                return res.status(400).json({
                    error: 'חסרים פרמטרים חובה',
                    required: ['action', 'performedBy']
                });
            }

            await AuditLog.create({
                action,
                resourceType,
                resourceId,
                details,
                performedBy,
                severity,
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent')
            });

            res.status(201).json({
                message: 'Audit log נוצר בהצלחה',
                action,
                performedBy,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה ביצירת audit log ידני:', error);
            res.status(500).json({
                error: 'שגיאה ביצירת audit log ידני',
                details: error.message
            });
        }
    }

    // דוח audit מפורט
    async generateAuditReport(req, res) {
        try {
            const {
                startDate,
                endDate,
                performedBy,
                action,
                resourceType
            } = req.query;

            if (!startDate || !endDate) {
                return res.status(400).json({
                    error: 'חסרים תאריכי התחלה וסיום לדוח'
                });
            }

            // בניית filters
            const filters = {};
            if (performedBy) filters.performedBy = performedBy;
            if (action) filters.action = action;
            if (resourceType) filters.resourceType = resourceType;

            // קבלת נתונים
            const logs = await AuditLog.getLogsByDateRange(startDate, endDate, 10000);
            
            // סינון נוסף
            const filteredLogs = logs.filter(log => {
                return Object.keys(filters).every(key => 
                    log[key] === filters[key]
                );
            });

            // סטטיסטיקות הדוח
            const stats = {
                totalLogs: filteredLogs.length,
                dateRange: { startDate, endDate },
                uniqueUsers: [...new Set(filteredLogs.map(l => l.performedBy))].length,
                uniqueActions: [...new Set(filteredLogs.map(l => l.action))].length,
                actionBreakdown: this._getActionBreakdown(filteredLogs),
                userBreakdown: this._getUserBreakdown(filteredLogs),
                dailyActivity: this._getDailyActivity(filteredLogs, startDate, endDate)
            };

            res.json({
                reportMetadata: {
                    generatedAt: new Date().toISOString(),
                    filters,
                    period: { startDate, endDate }
                },
                statistics: stats,
                logs: filteredLogs.slice(0, 1000) // מגביל ל-1000 לוגים בדוח
            });
        } catch (error) {
            console.error('❌ שגיאה ביצירת דוח audit:', error);
            res.status(500).json({
                error: 'שגיאה ביצירת דוח audit',
                details: error.message
            });
        }
    }

    // פונקציות עזר לדוח
    _getActionBreakdown(logs) {
        const breakdown = {};
        logs.forEach(log => {
            breakdown[log.action] = (breakdown[log.action] || 0) + 1;
        });
        return Object.entries(breakdown)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10);
    }

    _getUserBreakdown(logs) {
        const breakdown = {};
        logs.forEach(log => {
            breakdown[log.performedBy] = (breakdown[log.performedBy] || 0) + 1;
        });
        return Object.entries(breakdown)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10);
    }

    _getDailyActivity(logs, startDate, endDate) {
        const daily = {};
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        // Initialize all days with 0
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateKey = d.toISOString().split('T')[0];
            daily[dateKey] = 0;
        }
        
        // Count logs per day
        logs.forEach(log => {
            const dateKey = new Date(log.timestamp).toISOString().split('T')[0];
            if (daily.hasOwnProperty(dateKey)) {
                daily[dateKey]++;
            }
        });
        
        return Object.entries(daily).map(([date, count]) => ({ date, count }));
    }
}

module.exports = new AuditController();