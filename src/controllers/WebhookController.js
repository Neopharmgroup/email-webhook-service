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
            
            // ספירה של התראות שעובדו בהצלחה (כולל כאלו שדולגו)
            const successfulResults = results.filter(r => r.success === true);
            const processedResults = results.filter(r => r.success === true && !r.skipped);
            const skippedResults = results.filter(r => r.success === true && r.skipped);
            
            console.log(`📬 עובד ${validation.notifications.length} התראות:`, {
                successful: successfulResults.length,
                processed: processedResults.length,
                skipped: skippedResults.length,
                failed: results.filter(r => r.success === false).length
            });

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

    // קבלת רשימת מיילים פעילים לאוטומציה - שינוי מ-static לinstance method
    async getAutomationEmails(req, res) {
        try {
            const emails = WebhookService.getAutomationEmails();
            res.json({
                success: true,
                emails: emails,
                count: emails.length
            });
        } catch (error) {
            console.error('Error getting automation emails:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get automation emails'
            });
        }
    }
    
    // הוספת מייל לרשימת האוטומציה - שינוי מ-static לinstance method
    async addEmailToAutomation(req, res) {
        try {
            const { email } = req.body;
            
            if (!email) {
                return res.status(400).json({
                    success: false,
                    error: 'Email is required'
                });
            }
            
            const added = WebhookService.addEmailToAutomation(email);
            
            res.json({
                success: true,
                message: added ? 'Email added successfully' : 'Email already exists',
                email: email,
                emails: WebhookService.getAutomationEmails()
            });
        } catch (error) {
            console.error('Error adding email to automation:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to add email to automation'
            });
        }
    }
    
    // הסרת מייל מרשימת האוטומציה - שינוי מ-static לinstance method
    async removeEmailFromAutomation(req, res) {
        try {
            const { email } = req.params;
            
            if (!email) {
                return res.status(400).json({
                    success: false,
                    error: 'Email is required'
                });
            }
            
            const removed = WebhookService.removeEmailFromAutomation(email);
            
            res.json({
                success: true,
                message: removed ? 'Email removed successfully' : 'Email not found',
                email: email,
                emails: WebhookService.getAutomationEmails()
            });
        } catch (error) {
            console.error('Error removing email from automation:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to remove email from automation'
            });
        }
    }

    // בדיקה מערכתית מלאה לדיבוג
    async systemDiagnosis(req, res) {
        try {
            console.log('🔍 מתחיל אבחון מערכתי מלא...');
            
            const diagnosis = {
                timestamp: new Date().toISOString(),
                service: {
                    running: true,
                    version: '1.1.0'
                },
                automationEmails: {
                    count: WebhookService.getAutomationEmails().length,
                    emails: WebhookService.getAutomationEmails(),
                    sampleChecks: []
                },
                subscriptions: null,
                notifications: null,
                monitoredEmails: null,
                recentActivity: null
            };

            // בדיקת מיילים לדוגמה
            const testEmails = [
                'michal.l@neopharmgroup.com',
                'cloudteamsdev@neopharmgroup.com',
                'noreply@fedex.com',
                'test@example.com'
            ];

            for (const email of testEmails) {
                const check = WebhookService.isEmailInAutomationList(email);
                diagnosis.automationEmails.sampleChecks.push({
                    email,
                    inList: check.inList,
                    matchType: check.matchType
                });
            }

            // בדיקת subscriptions
            try {
                const { Subscription } = require('../models');
                const subscriptions = await Subscription.findAll();
                diagnosis.subscriptions = {
                    count: subscriptions.length,
                    active: subscriptions.filter(s => s.status === 'active').length,
                    sample: subscriptions.slice(0, 3).map(s => ({
                        email: s.email,
                        status: s.status,
                        subscriptionId: s.subscriptionId
                    }))
                };
            } catch (error) {
                diagnosis.subscriptions = { error: error.message };
            }

            // בדיקת notifications אחרונות
            try {
                const { EmailNotification } = require('../models');
                const notifications = await EmailNotification.findAll();
                
                diagnosis.notifications = {
                    count: notifications.length,
                    recent: notifications.map(n => ({
                        email: n.email,
                        processed: n.processed,
                        skipped: n.skipped,
                        reason: n.reason,
                        timestamp: n.timestamp
                    }))
                };
            } catch (error) {
                diagnosis.notifications = { error: error.message };
            }

            // בדיקת monitored emails
            try {
                const { MonitoredEmail } = require('../models');
                const monitoredEmails = await MonitoredEmail.findAll();
                diagnosis.monitoredEmails = {
                    count: monitoredEmails.length,
                    active: monitoredEmails.filter(e => e.status === 'active').length,
                    sample: monitoredEmails.slice(0, 3).map(e => ({
                        email: e.email,
                        status: e.status
                    }))
                };
            } catch (error) {
                diagnosis.monitoredEmails = { error: error.message };
            }

            console.log('✅ אבחון מערכתי הושלם');

            res.json({
                success: true,
                diagnosis: diagnosis,
                recommendations: WebhookController.generateRecommendations(diagnosis)
            });

        } catch (error) {
            console.error('❌ שגיאה באבחון מערכתי:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    static generateRecommendations(diagnosis) {
        const recommendations = [];

        if (diagnosis.automationEmails.count === 0) {
            recommendations.push('⚠️ אין מיילים ברשימת האוטומציה - הוסף מיילים');
        }

        if (diagnosis.subscriptions?.count === 0) {
            recommendations.push('⚠️ אין subscriptions פעילים - צור subscriptions למיילים');
        }

        if (diagnosis.notifications?.count === 0) {
            recommendations.push('⚠️ אין notifications - בדוק שהwebhooks מגיעים');
        }

        const hasActiveEmails = diagnosis.automationEmails.sampleChecks.some(c => c.inList);
        if (!hasActiveEmails) {
            recommendations.push('⚠️ המיילים שנבדקו לא ברשימת האוטומציה');
        }

        if (recommendations.length === 0) {
            recommendations.push('✅ המערכת נראית תקינה');
        }

        return recommendations;
    }

    // בדיקה מהירה של Microsoft Graph subscriptions
    async checkGraphSubscriptions(req, res) {
        try {
            console.log('🔍 בודק Microsoft Graph subscriptions...');
            
            const { Subscription } = require('../models');
            const AzureAuthService = require('../services/AzureAuthService');                // בדיקת subscriptions מהמסד נתונים
            const localSubscriptions = await Subscription.findAll();
            
            const result = {
                timestamp: new Date().toISOString(),
                localSubscriptions: {
                    total: localSubscriptions.length,
                    active: localSubscriptions.filter(s => s.status === 'active').length,
                    inactive: localSubscriptions.filter(s => s.status !== 'active').length,
                    recent: localSubscriptions.slice(0, 3).map(s => ({
                        email: s.email,
                        subscriptionId: s.subscriptionId,
                        status: s.status,
                        expirationDateTime: s.expirationDateTime,
                        createdAt: s.createdAt
                    }))
                },
                microsoftGraphCheck: null
            };

            // ניסיון לבדוק עם Microsoft Graph
            try {
                const token = await AzureAuthService.getServicePrincipalToken();
                
                if (token) {
                    console.log('✅ הצלחנו לקבל token מ-Microsoft Graph');
                    result.microsoftGraphCheck = {
                        tokenReceived: true,
                        message: 'Successfully connected to Microsoft Graph'
                    };
                } else {
                    console.log('❌ לא הצלחנו לקבל token מ-Microsoft Graph');
                    result.microsoftGraphCheck = {
                        tokenReceived: false,
                        message: 'Failed to get token from Microsoft Graph'
                    };
                }
            } catch (graphError) {
                console.error('❌ שגיאה בחיבור ל-Microsoft Graph:', graphError.message);
                result.microsoftGraphCheck = {
                    tokenReceived: false,
                    error: graphError.message,
                    message: 'Error connecting to Microsoft Graph'
                };
            }

            // המלצות
            const recommendations = [];
            
            if (result.localSubscriptions.total === 0) {
                recommendations.push('⚠️ אין subscriptions במסד הנתונים - צור subscriptions למיילים שברשימת המעקב');
            }
            
            if (result.localSubscriptions.active === 0) {
                recommendations.push('⚠️ אין subscriptions פעילים - ייתכן שפגו או שהם לא נוצרו כראוי');
            }
            
            if (!result.microsoftGraphCheck?.tokenReceived) {
                recommendations.push('❌ בעיה בחיבור ל-Microsoft Graph - בדוק הרשאות Azure AD');
            }
            
            if (recommendations.length === 0) {
                recommendations.push('✅ Subscriptions נראים תקינים');
            }

            result.recommendations = recommendations;

            res.json({
                success: true,
                result: result
            });

        } catch (error) {
            console.error('❌ שגיאה בבדיקת subscriptions:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    // שליחת webhook דוגמה לבדיקה
    async testWebhookManually(req, res) {
        try {
            console.log('🧪 מתחיל בדיקת webhook ידנית...');
            
            const testNotification = {
                subscriptionId: 'test-subscription-123',
                changeType: 'created',
                resource: 'Users/test@neopharmgroup.com/Messages/test-message-456',
                clientState: 'test-client-state',
                subscriptionExpirationDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            };

            // יצירת subscription דמה אם לא קיים
            const { Subscription } = require('../models');
            
            let testSubscription = await Subscription.findBySubscriptionId('test-subscription-123');
            
            if (!testSubscription) {
                console.log('📝 יוצר subscription דמה לבדיקה...');
                testSubscription = await Subscription.create({
                    email: 'test@neopharmgroup.com',
                    subscriptionId: 'test-subscription-123',
                    status: 'active',
                    expirationDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                    createdAt: new Date()
                });
            }

            // עיבוד הnotification
            console.log('📬 מעבד notification דמה...');
            const result = await WebhookService.processNotification(testNotification);

            res.json({
                success: true,
                message: 'Test webhook processed',
                testNotification: testNotification,
                processResult: result,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ שגיאה בבדיקת webhook ידנית:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    // עיבוד ידני של התראות לא מעובדות
    async processUnprocessedNotifications(req, res) {
        try {
            console.log('🔄 מתחיל עיבוד ידני של התראות לא מעובדות...');
            
            const result = await WebhookService.processUnprocessedNotifications();
            
            res.json({
                success: true,
                message: 'עיבוד התראות הושלם',
                results: result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בעיבוד ידני של התראות:', error);
            res.status(500).json({
                success: false,
                error: 'שגיאה בעיבוד התראות',
                details: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
}

module.exports = new WebhookController();