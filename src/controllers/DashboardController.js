const { MonitoredEmail, Subscription, EmailNotification, AuditLog } = require('../models');
const database = require('../database/connection');

class DashboardController {
    // סטטיסטיקות כלליות
    async getStatistics(req, res) {
        try {
            const [
                monitoredEmailStats,
                subscriptionStats,
                notificationStats,
                auditStats
            ] = await Promise.all([
                MonitoredEmail.getStatistics(),
                Subscription.getStatistics(),
                EmailNotification.getStatistics(),
                AuditLog.getStatistics()
            ]);

            res.json({
                monitoredEmails: monitoredEmailStats,
                subscriptions: subscriptionStats,
                notifications: notificationStats,
                auditLogs: auditStats,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת סטטיסטיקות דשבורד:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת סטטיסטיקות דשבורד',
                details: error.message
            });
        }
    }

    // בריאות המערכת
    async getHealthCheck(req, res) {
        try {
            const [
                databaseHealth,
                recentErrors,
                expiringSubs
            ] = await Promise.all([
                database.healthCheck(),
                AuditLog.getFailedOperations(10),
                Subscription.getExpiringSoon(24)
            ]);

            const health = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                components: {
                    database: databaseHealth,
                    recentErrors: {
                        count: recentErrors.length,
                        errors: recentErrors
                    },
                    expiringSubs: {
                        count: expiringSubs.length,
                        subscriptions: expiringSubs
                    }
                }
            };

            // קבע את הסטטוס הכללי
            if (databaseHealth.status !== 'healthy' || recentErrors.length > 5) {
                health.status = 'degraded';
            }

            if (databaseHealth.status !== 'healthy') {
                health.status = 'unhealthy';
            }

            const statusCode = health.status === 'healthy' ? 200 : 
                             health.status === 'degraded' ? 200 : 503;

            res.status(statusCode).json(health);
        } catch (error) {
            console.error('❌ שגיאה בבדיקת בריאות המערכת:', error);
            res.status(503).json({
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // סקירה כללית
    async getOverview(req, res) {
        try {
            const [
                totalEmails,
                activeEmails,
                waitingEmails,
                inactiveEmails,
                activeSubscriptions,
                recentNotifications,
                todayAuditLogs
            ] = await Promise.all([
                MonitoredEmail.collection.countDocuments(),
                MonitoredEmail.collection.countDocuments({ status: 'ACTIVE' }),
                MonitoredEmail.collection.countDocuments({ status: 'WAITING_FOR_AZURE_SETUP' }),
                MonitoredEmail.collection.countDocuments({ status: 'INACTIVE' }),
                Subscription.collection.countDocuments({ isActive: true }),
                EmailNotification.getRecentNotifications(10),
                AuditLog.getLogsByDateRange(
                    new Date(new Date().setHours(0, 0, 0, 0)),
                    new Date(),
                    50
                )
            ]);

            res.json({
                summary: {
                    monitoredEmails: {
                        total: totalEmails,
                        active: activeEmails,
                        waiting: waitingEmails,
                        inactive: inactiveEmails
                    },
                    subscriptions: {
                        active: activeSubscriptions
                    },
                    notifications: {
                        recent: recentNotifications.length
                    },
                    auditLogs: {
                        today: todayAuditLogs.length
                    }
                },
                recentActivity: {
                    notifications: recentNotifications.slice(0, 5),
                    auditLogs: todayAuditLogs.slice(0, 5)
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת סקירה כללית:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת סקירה כללית',
                details: error.message
            });
        }
    }

    // התראות מערכת
    async getSystemAlerts(req, res) {
        try {
            const [
                expiringSubs,
                failedOperations,
                unprocessedNotifications
            ] = await Promise.all([
                Subscription.getExpiringSoon(24),
                AuditLog.getFailedOperations(20),
                EmailNotification.getUnprocessedNotifications(50)
            ]);

            const alerts = [];

            // Subscriptions שפגים
            if (expiringSubs.length > 0) {
                alerts.push({
                    type: 'warning',
                    title: `${expiringSubs.length} Subscriptions פגים ב-24 השעות הקרובות`,
                    description: 'יש לחדש את ה-subscriptions כדי לשמור על ניטור רציף',
                    count: expiringSubs.length,
                    action: 'renew_subscriptions'
                });
            }

            // פעולות כושלות
            if (failedOperations.length > 10) {
                alerts.push({
                    type: 'error',
                    title: `${failedOperations.length} פעולות כושלות`,
                    description: 'מספר גבוה של פעולות כושלות זוהה במערכת',
                    count: failedOperations.length,
                    action: 'review_errors'
                });
            }

            // התראות לא מעובדות
            if (unprocessedNotifications.length > 20) {
                alerts.push({
                    type: 'warning',
                    title: `${unprocessedNotifications.length} התראות לא מעובדות`,
                    description: 'יש התראות שלא עובדו - יתכן שיש בעיה בעיבוד',
                    count: unprocessedNotifications.length,
                    action: 'process_notifications'
                });
            }

            res.json({
                alerts,
                alertsCount: alerts.length,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת התראות מערכת:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת התראות מערכת',
                details: error.message
            });
        }
    }

    // ביצועי מערכת
    async getPerformanceMetrics(req, res) {
        try {
            const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

            const [
                todayNotifications,
                weekNotifications,
                todayAudits,
                weekAudits,
                avgProcessingTime
            ] = await Promise.all([
                EmailNotification.collection.countDocuments({
                    timestamp: { $gte: last24Hours }
                }),
                EmailNotification.collection.countDocuments({
                    timestamp: { $gte: lastWeek }
                }),
                AuditLog.collection.countDocuments({
                    timestamp: { $gte: last24Hours }
                }),
                AuditLog.collection.countDocuments({
                    timestamp: { $gte: lastWeek }
                }),
                this._calculateAverageProcessingTime()
            ]);

            res.json({
                notifications: {
                    today: todayNotifications,
                    thisWeek: weekNotifications,
                    dailyAverage: Math.round(weekNotifications / 7)
                },
                auditLogs: {
                    today: todayAudits,
                    thisWeek: weekAudits,
                    dailyAverage: Math.round(weekAudits / 7)
                },
                performance: {
                    averageProcessingTime: avgProcessingTime
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת מדדי ביצועים:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת מדדי ביצועים',
                details: error.message
            });
        }
    }

    // פעולות תחזוקה
    async performMaintenance(req, res) {
        try {
            const { action, options = {} } = req.body;

            let result = {};

            switch (action) {
                case 'cleanup_old_notifications':
                    const daysToKeep = options.daysToKeep || 30;
                    const deletedNotifications = await EmailNotification.deleteOldNotifications(daysToKeep);
                    result = { deletedNotifications, daysToKeep };
                    break;

                case 'cleanup_old_audits':
                    const auditDaysToKeep = options.daysToKeep || 90;
                    const deletedAudits = await AuditLog.deleteOldLogs(auditDaysToKeep);
                    result = { deletedAudits, daysToKeep: auditDaysToKeep };
                    break;

                case 'renew_expiring_subscriptions':
                    const { SubscriptionService } = require('../services');
                    const renewResults = await SubscriptionService.renewExpiringSoon(24);
                    result = { renewResults };
                    break;

                default:
                    return res.status(400).json({
                        error: 'פעולת תחזוקה לא מוכרת',
                        validActions: ['cleanup_old_notifications', 'cleanup_old_audits', 'renew_expiring_subscriptions']
                    });
            }

            res.json({
                message: 'פעולת תחזוקה הושלמה',
                action,
                result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בביצוע תחזוקה:', error);
            res.status(500).json({
                error: 'שגיאה בביצוע תחזוקה',
                details: error.message
            });
        }
    }

    // פונקציה עזר לחישוב זמן עיבוד ממוצע
    async _calculateAverageProcessingTime() {
        try {
            // זו דוגמה פשוטה - ניתן לשפר על ידי מדידה אמיתית של זמני עיבוד
            const recentNotifications = await EmailNotification.getRecentNotifications(100);
            const processedNotifications = recentNotifications.filter(n => n.processed && n.processedAt);
            
            if (processedNotifications.length === 0) {
                return 0;
            }

            const totalProcessingTime = processedNotifications.reduce((sum, notification) => {
                const processingTime = new Date(notification.processedAt) - new Date(notification.timestamp);
                return sum + processingTime;
            }, 0);

            return Math.round(totalProcessingTime / processedNotifications.length / 1000); // בשניות
        } catch (error) {
            console.error('❌ שגיאה בחישוב זמן עיבוד ממוצע:', error);
            return 0;
        }
    }
}

module.exports = new DashboardController();