const { WebhookService } = require('../services');

class WebhookController {
    // Webhook endpoint עיקרי
    async handleWebhook(req, res) {
        try {
            const validation = WebhookService.validateWebhookRequest(req);

            if (validation.isValidation) {
                // Validation request
                const token = await WebhookService.handleValidation(validation.token);
                return res.status(200).type('text/plain').send(token);
            }

            // Notification request
            const results = await WebhookService.processNotifications(validation.notifications);
            
            console.log(`📬 עובד ${validation.notifications.length} התראות, ${results.filter(r => r.status === 'processed').length} הצליחו`);

            res.status(202).send('OK');
        } catch (error) {
            console.error('❌ שגיאה בטיפול ב-webhook:', error);
            res.status(500).json({
                error: 'שגיאה בטיפול ב-webhook',
                details: error.message
            });
        }
    }

    // GET endpoint לvalidation
    async handleWebhookGet(req, res) {
        try {
            const { validationToken } = req.query;

            if (validationToken) {
                console.log('✅ מאמת webhook (GET)');
                return res.status(200).type('text/plain').send(validationToken);
            }

            res.json({
                message: 'Webhook endpoint פועל',
                timestamp: new Date().toISOString(),
                method: 'GET'
            });
        } catch (error) {
            console.error('❌ שגיאה ב-webhook GET:', error);
            res.status(500).json({
                error: 'שגיאה ב-webhook GET',
                details: error.message
            });
        }
    }

    // סטטיסטיקות webhook
    async getStatistics(req, res) {
        try {
            const stats = await WebhookService.getWebhookStatistics();
            res.json(stats);
        } catch (error) {
            console.error('❌ שגיאה בקבלת סטטיסטיקות webhook:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת סטטיסטיקות webhook',
                details: error.message
            });
        }
    }

    // בדיקת webhook
    async testWebhook(req, res) {
        try {
            const result = await WebhookService.testWebhook();
            res.json(result);
        } catch (error) {
            console.error('❌ שגיאה בבדיקת webhook:', error);
            res.status(500).json({
                error: 'שגיאה בבדיקת webhook',
                details: error.message
            });
        }
    }

    // ניקוי התראות ישנות
    async cleanupOldNotifications(req, res) {
        try {
            const daysToKeep = parseInt(req.query.days) || 30;
            const deletedCount = await WebhookService.cleanupOldNotifications(daysToKeep);
            
            res.json({
                message: 'ניקוי התראות ישנות הושלם',
                daysToKeep,
                deletedCount
            });
        } catch (error) {
            console.error('❌ שגיאה בניקוי התראות:', error);
            res.status(500).json({
                error: 'שגיאה בניקוי התראות',
                details: error.message
            });
        }
    }

    // עיבוד מחדש של התראות לא מעובדות
    async reprocessUnprocessedNotifications(req, res) {
        try {
            const results = await WebhookService.processUnprocessedNotifications();
            
            res.json({
                message: 'עיבוד מחדש של התראות הושלם',
                processed: results.length,
                successful: results.filter(r => r.status === 'reprocessed').length,
                failed: results.filter(r => r.status === 'failed').length,
                results
            });
        } catch (error) {
            console.error('❌ שגיאה בעיבוד מחדש של התראות:', error);
            res.status(500).json({
                error: 'שגיאה בעיבוד מחדש של התראות',
                details: error.message
            });
        }
    }
}

module.exports = new WebhookController();