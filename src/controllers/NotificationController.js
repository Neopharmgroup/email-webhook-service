const { EmailNotification } = require('../models');
const { EmailService } = require('../services');

class NotificationController {
    // קבלת התראות אחרונות
    async getRecentNotifications(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 50;
            const email = req.query.email;

            let notifications;
            if (email) {
                notifications = await EmailNotification.getNotificationsByEmail(email, limit);
            } else {
                notifications = await EmailNotification.getRecentNotifications(limit);
            }

            res.json({
                total: notifications.length,
                notifications
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת התראות:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת התראות',
                details: error.message
            });
        }
    }

    // קבלת התראות לפי subscription
    async getNotificationsBySubscription(req, res) {
        try {
            const { subscriptionId } = req.params;
            const limit = parseInt(req.query.limit) || 20;

            const notifications = await EmailNotification.getNotificationsBySubscription(subscriptionId, limit);

            res.json({
                subscriptionId,
                total: notifications.length,
                notifications
            });
        } catch (error) {
            console.error(`❌ שגיאה בקבלת התראות עבור subscription ${req.params.subscriptionId}:`, error);
            res.status(500).json({
                error: 'שגיאה בקבלת התראות לפי subscription',
                details: error.message
            });
        }
    }

    // סימון התראה כמעובדת
    async markAsProcessed(req, res) {
        try {
            const { notificationId } = req.params;

            const result = await EmailNotification.markAsProcessed(notificationId);

            if (result.modifiedCount === 0) {
                return res.status(404).json({
                    error: 'התראה לא נמצאה'
                });
            }

            res.json({
                message: 'התראה סומנה כמעובדת',
                notificationId,
                processedAt: new Date().toISOString()
            });
        } catch (error) {
            console.error(`❌ שגיאה בסימון התראה ${req.params.notificationId}:`, error);
            res.status(500).json({
                error: 'שגיאה בסימון התראה כמעובדת',
                details: error.message
            });
        }
    }

    // קבלת התראות לא מעובדות
    async getUnprocessedNotifications(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 100;
            const notifications = await EmailNotification.getUnprocessedNotifications(limit);

            res.json({
                total: notifications.length,
                notifications
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת התראות לא מעובדות:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת התראות לא מעובדות',
                details: error.message
            });
        }
    }

    // קבלת תוכן מייל מהתראה
    async getEmailContentFromNotification(req, res) {
        try {
            const { notificationId } = req.params;

            // מצא את ההתראה
            const notification = await EmailNotification.collection.findOne({ 
                _id: new require('mongodb').ObjectId(notificationId) 
            });

            if (!notification) {
                return res.status(404).json({
                    error: 'התראה לא נמצאה'
                });
            }

            // קבל את תוכן המייל
            const emailContent = await EmailService.getEmailContent(
                notification.email,
                notification.messageId
            );

            res.json({
                notification: {
                    id: notification._id,
                    email: notification.email,
                    messageId: notification.messageId,
                    timestamp: notification.timestamp
                },
                emailContent: {
                    subject: emailContent.subject,
                    from: emailContent.from,
                    toRecipients: emailContent.toRecipients,
                    receivedDateTime: emailContent.receivedDateTime,
                    bodyPreview: emailContent.bodyPreview,
                    body: emailContent.body,
                    hasAttachments: emailContent.hasAttachments,
                    importance: emailContent.importance,
                    isRead: emailContent.isRead
                }
            });
        } catch (error) {
            console.error(`❌ שגיאה בקבלת תוכן מייל מהתראה ${req.params.notificationId}:`, error);
            res.status(500).json({
                error: 'שגיאה בקבלת תוכן מייל מהתראה',
                details: error.message
            });
        }
    }

    // סטטיסטיקות התראות
    async getStatistics(req, res) {
        try {
            const stats = await EmailNotification.getStatistics();
            res.json({
                notifications: stats,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת סטטיסטיקות התראות:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת סטטיסטיקות התראות',
                details: error.message
            });
        }
    }

    // מחיקת התראות ישנות
    async deleteOldNotifications(req, res) {
        try {
            const daysToKeep = parseInt(req.query.days) || 30;
            const deletedCount = await EmailNotification.deleteOldNotifications(daysToKeep);

            res.json({
                message: 'התראות ישנות נמחקו',
                daysToKeep,
                deletedCount
            });
        } catch (error) {
            console.error('❌ שגיאה במחיקת התראות ישנות:', error);
            res.status(500).json({
                error: 'שגיאה במחיקת התראות ישנות',
                details: error.message
            });
        }
    }
}

module.exports = new NotificationController();