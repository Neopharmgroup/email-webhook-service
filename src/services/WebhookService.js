const axios = require('axios');
const config = require('../config');
const { EmailNotification, Subscription } = require('../models');

class WebhookService {
    constructor() {
        this.webhookSiteUrl = config.webhook.siteUrl;
    }

    async processNotifications(notifications = []) {
        const results = [];

        console.log(`📬 מעבד ${notifications.length} התראות`);

        for (const notification of notifications) {
            try {
                const result = await this.processNotification(notification);
                results.push(result);
            } catch (error) {
                console.error('❌ שגיאה בעיבוד התראה:', error);
                results.push({
                    subscriptionId: notification.subscriptionId,
                    status: 'error',
                    error: error.message
                });
            }
        }

        return results;
    }

    async processNotification(notification) {
        try {
            // Find the subscription
            const subscription = await Subscription.findBySubscriptionId(notification.subscriptionId);
            if (!subscription) {
                console.warn(`⚠️ לא נמצא subscription: ${notification.subscriptionId}`);
                return {
                    subscriptionId: notification.subscriptionId,
                    status: 'subscription_not_found'
                };
            }

            // Save notification to database
            const savedNotification = await EmailNotification.create({
                email: subscription.email,
                subscriptionId: notification.subscriptionId,
                resource: notification.resource,
                changeType: notification.changeType,
                clientState: notification.clientState
            });

            console.log(`📧 מייל חדש עבור ${subscription.email}: ${savedNotification.messageId}`);

            // Forward to external webhook if configured
            if (this.webhookSiteUrl) {
                await this.forwardToExternalWebhook({
                    type: 'email_notification',
                    email: subscription.email,
                    notification: savedNotification,
                    timestamp: new Date().toISOString()
                });
            }

            // Mark as processed
            await EmailNotification.markAsProcessed(savedNotification._id);

            return {
                subscriptionId: notification.subscriptionId,
                email: subscription.email,
                messageId: savedNotification.messageId,
                status: 'processed'
            };

        } catch (error) {
            console.error('❌ שגיאה בעיבוד התראה:', error);
            throw error;
        }
    }

    async forwardToExternalWebhook(data) {
        try {
            await axios.post(this.webhookSiteUrl, data, {
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Email-Webhook-Service/1.0'
                }
            });
            
            console.log(`📤 התראה הועברה ל-${this.webhookSiteUrl}`);
        } catch (error) {
            console.error(`❌ שגיאה בהעברת התראה ל-${this.webhookSiteUrl}:`, error.message);
            // Don't throw error - external webhook failure shouldn't break our processing
        }
    }

    validateWebhookRequest(req) {
        const { validationToken } = req.query;
        
        if (validationToken) {
            return {
                isValidation: true,
                token: validationToken
            };
        }

        const notifications = req.body?.value;
        if (!notifications || !Array.isArray(notifications)) {
            throw new Error('Invalid webhook request format');
        }

        return {
            isValidation: false,
            notifications
        };
    }

    async handleValidation(validationToken) {
        console.log('✅ מאמת webhook token');
        return validationToken;
    }

    async getWebhookStatistics() {
        try {
            const notificationStats = await EmailNotification.getStatistics();
            const subscriptionStats = await Subscription.getStatistics();

            return {
                notifications: notificationStats,
                subscriptions: subscriptionStats,
                webhookUrl: config.webhook.url,
                externalWebhookUrl: this.webhookSiteUrl,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('❌ שגיאה בקבלת סטטיסטיקות webhook:', error);
            throw error;
        }
    }

    async cleanupOldNotifications(daysToKeep = 30) {
        try {
            const deletedCount = await EmailNotification.deleteOldNotifications(daysToKeep);
            console.log(`🧹 נמחקו ${deletedCount} התראות ישנות (מעל ${daysToKeep} ימים)`);
            return deletedCount;
        } catch (error) {
            console.error('❌ שגיאה בניקוי התראות ישנות:', error);
            throw error;
        }
    }

    async testWebhook() {
        try {
            const testData = {
                type: 'webhook_test',
                message: 'Test webhook connection',
                timestamp: new Date().toISOString(),
                service: 'email-webhook-service'
            };

            if (this.webhookSiteUrl) {
                await this.forwardToExternalWebhook(testData);
                return { status: 'success', message: 'Test webhook sent successfully' };
            } else {
                return { status: 'warning', message: 'No external webhook URL configured' };
            }
        } catch (error) {
            return { status: 'error', message: error.message };
        }
    }

    async processUnprocessedNotifications() {
        try {
            const unprocessed = await EmailNotification.getUnprocessedNotifications(100);
            const results = [];

            for (const notification of unprocessed) {
                try {
                    // Re-process the notification
                    await this.forwardToExternalWebhook({
                        type: 'email_notification_retry',
                        email: notification.email,
                        notification: notification,
                        timestamp: new Date().toISOString()
                    });

                    await EmailNotification.markAsProcessed(notification._id);
                    results.push({
                        id: notification._id,
                        email: notification.email,
                        status: 'reprocessed'
                    });
                } catch (error) {
                    results.push({
                        id: notification._id,
                        email: notification.email,
                        status: 'failed',
                        error: error.message
                    });
                }
            }

            console.log(`🔄 עובד מחדש ${results.length} התראות לא מעובדות`);
            return results;
        } catch (error) {
            console.error('❌ שגיאה בעיבוד מחדש של התראות:', error);
            throw error;
        }
    }
}

module.exports = new WebhookService();