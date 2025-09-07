const { Subscription, MonitoredEmail } = require('../models');
const { SubscriptionService } = require('../services');
const { validateEmail } = require('../utils/helpers');
const config = require('../config');

class SubscriptionController {
    // יצירת subscription למייל ספציפי
    async createSubscription(req, res) {
        try {
            const email = decodeURIComponent(req.params.email);
            const {
                createdBy,
                notificationUrl,
                changeType = 'created',
                expirationHours = 70
            } = req.body;

            // Validate required parameters
            if (!createdBy) {
                return res.status(400).json({
                    error: 'חסר פרמטר חובה: createdBy'
                });
            }

            // Use default notificationUrl from config if not provided or empty
            const finalNotificationUrl = notificationUrl && notificationUrl.trim() !== '' 
                ? notificationUrl 
                : config.webhook?.url;
            
            // Add validation for notificationUrl
            if (!finalNotificationUrl) {
                return res.status(400).json({
                    error: 'חסר פרמטר חובה: notificationUrl - יש להגדיר WEBHOOK_URL במשתני הסביבה או לשלוח URL בבקשה'
                });
            }

            // Validate notificationUrl format (basic URL validation)
            try {
                new URL(finalNotificationUrl);
            } catch (urlError) {
                return res.status(400).json({
                    error: 'notificationUrl חייב להיות URL תקין'
                });
            }

            // בדוק שהמייל קיים במעקב
            const monitoredEmail = await MonitoredEmail.findByEmail(email);
            if (!monitoredEmail) {
                return res.status(404).json({
                    error: `המייל ${email} לא נמצא ברשימת המעקב`
                });
            }

            if (!validateEmail(email)) {
                return res.status(400).json({ error: 'כתובת מייל לא תקינה' });
            }

            console.log(`🔄 יוצר subscription נוסף עבור ${email} על ידי ${createdBy}`);
            console.log(`📍 Notification URL: ${finalNotificationUrl}`);

            const result = await SubscriptionService.createSubscription({
                email,
                createdBy,
                notificationUrl: finalNotificationUrl,
                changeType,
                expirationHours
            });

            console.log(`✅ Subscription נוסף נוצר עבור ${email}: ${result.subscription.subscriptionId}`);

            res.status(201).json({
                message: 'Subscription נוסף נוצר בהצלחה',
                subscription: {
                    id: result.subscription.subscriptionId,
                    email: result.subscription.email,
                    resource: result.subscription.resource,
                    changeType: result.subscription.changeType,
                    createdAt: result.subscription.createdAt,
                    expirationDateTime: result.subscription.expirationDateTime,
                    createdBy: result.subscription.createdBy,
                    clientState: result.subscription.clientState,
                    notificationUrl: result.subscription.notificationUrl
                },
                microsoftResponse: result.microsoftResponse
            });

        } catch (error) {
            console.error(`❌ שגיאה ביצירת subscription עבור ${req.params.email}:`, error);

            if (error.message.includes('הרשאה')) {
                res.status(401).json({
                    error: 'אין הרשאות לגישה למייל זה',
                    details: error.message
                });
            } else if (error.message.includes('NotificationUrl')) {
                res.status(400).json({
                    error: 'שגיאה ב-NotificationUrl',
                    details: error.message
                });
            } else if (error.message.includes('403')) {
                res.status(403).json({
                    error: 'אין הרשאות לגישה למייל זה',
                    details: error.message
                });
            } else {
                res.status(500).json({
                    error: 'שגיאה ביצירת subscription',
                    details: error.message
                });
            }
        }
    }

    // חידוש subscription
    async renewSubscription(req, res) {
        try {
            const { subscriptionId } = req.params;
            const { renewedBy, expirationHours = 70 } = req.body;

            if (!renewedBy) {
                return res.status(400).json({
                    error: 'חסר פרמטר חובה: renewedBy'
                });
            }

            const result = await SubscriptionService.renewSubscription(subscriptionId, renewedBy, expirationHours);

            res.json({
                message: 'Subscription חודש בהצלחה',
                subscriptionId: subscriptionId,
                newExpirationDateTime: result.expirationDateTime,
                renewedBy: renewedBy,
                renewedAt: new Date().toISOString()
            });

        } catch (error) {
            console.error(`❌ שגיאה בחידוש subscription ${req.params.subscriptionId}:`, error);
            res.status(500).json({
                error: 'שגיאה בחידוש subscription',
                details: error.message
            });
        }
    }

    // מחיקת subscription
    async deleteSubscription(req, res) {
        try {
            const { subscriptionId } = req.params;
            const { deletedBy = 'SYSTEM' } = req.body;

            await SubscriptionService.deleteSubscription(subscriptionId, deletedBy);

            res.json({
                message: 'Subscription נמחק בהצלחה',
                subscriptionId: subscriptionId,
                deletedBy: deletedBy,
                deletedAt: new Date().toISOString()
            });

        } catch (error) {
            console.error(`❌ שגיאה במחיקת subscription ${req.params.subscriptionId}:`, error);
            res.status(500).json({
                error: 'שגיאה במחיקת subscription',
                details: error.message
            });
        }
    }

    // קבלת מידע על subscription
    async getSubscriptionInfo(req, res) {
        try {
            const { subscriptionId } = req.params;

            const [dbSubscription, microsoftInfo] = await Promise.all([
                Subscription.findBySubscriptionId(subscriptionId),
                SubscriptionService.getSubscriptionInfo(subscriptionId).catch(() => null)
            ]);

            if (!dbSubscription) {
                return res.status(404).json({
                    error: 'Subscription לא נמצא במסד הנתונים'
                });
            }

            res.json({
                database: dbSubscription,
                microsoft: microsoftInfo,
                synchronized: microsoftInfo !== null
            });

        } catch (error) {
            console.error(`❌ שגיאה בקבלת מידע על subscription ${req.params.subscriptionId}:`, error);
            res.status(500).json({
                error: 'שגיאה בקבלת מידע על subscription',
                details: error.message
            });
        }
    }

    // רשימת subscriptions פעילים
    async getActiveSubscriptions(req, res) {
        try {
            const subscriptions = await Subscription.getAllActive();

            res.json({
                total: subscriptions.length,
                subscriptions
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת subscriptions פעילים:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת subscriptions פעילים',
                details: error.message
            });
        }
    }

    // subscriptions שפגים בקרוב
    async getExpiringSoon(req, res) {
        try {
            const hoursThreshold = parseInt(req.query.hours) || 24;
            const subscriptions = await Subscription.getExpiringSoon(hoursThreshold);

            res.json({
                hoursThreshold,
                total: subscriptions.length,
                subscriptions
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת subscriptions שפגים:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת subscriptions שפגים',
                details: error.message
            });
        }
    }

    // חידוש אוטומטי של subscriptions שפגים
    async renewExpiringSoon(req, res) {
        try {
            const hoursThreshold = parseInt(req.query.hours) || 24;
            const results = await SubscriptionService.renewExpiringSoon(hoursThreshold);

            res.json({
                message: 'חידוש אוטומטי הושלם',
                hoursThreshold,
                processed: results.length,
                results
            });
        } catch (error) {
            console.error('❌ שגיאה בחידוש אוטומטי:', error);
            res.status(500).json({
                error: 'שגיאה בחידוש אוטומטי',
                details: error.message
            });
        }
    }

    // אימות כל ה-subscriptions
    async validateAllSubscriptions(req, res) {
        try {
            const results = await SubscriptionService.validateAllSubscriptions();

            const summary = {
                total: results.length,
                valid: results.filter(r => r.status === 'valid').length,
                notFound: results.filter(r => r.status === 'not_found').length,
                errors: results.filter(r => r.status === 'error').length
            };

            res.json({
                message: 'אימות subscriptions הושלם',
                summary,
                results
            });
        } catch (error) {
            console.error('❌ שגיאה באימות subscriptions:', error);
            res.status(500).json({
                error: 'שגיאה באימות subscriptions',
                details: error.message
            });
        }
    }

    // סטטוס subscription למייל ספציפי
    async getEmailSubscriptionStatus(req, res) {
        try {
            const email = decodeURIComponent(req.params.email);

            const monitoredEmail = await MonitoredEmail.findByEmail(email);
            if (!monitoredEmail) {
                return res.status(404).json({
                    error: `המייל ${email} לא נמצא ברשימת המעקב`
                });
            }

            const subscriptions = await Subscription.findAllByEmail(email);
            const stats = await Subscription.getEmailSubscriptionStats(email);

            res.json({
                email: email,
                monitored: true,
                monitoredStatus: monitoredEmail.status,
                hasSubscriptions: subscriptions.length > 0,
                subscriptionsCount: subscriptions.length,
                statistics: stats,
                subscriptions: subscriptions.map(sub => ({
                    id: sub.subscriptionId,
                    status: sub.isActive ? 'active' : 'inactive',
                    changeType: sub.changeType,
                    createdAt: sub.createdAt,
                    expirationDateTime: sub.expirationDateTime,
                    renewalCount: sub.renewalCount,
                    createdBy: sub.createdBy
                }))
            });

        } catch (error) {
            console.error(`❌ שגיאה בקבלת סטטוס subscription עבור ${req.params.email}:`, error);
            res.status(500).json({
                error: 'שגיאה בקבלת סטטוס subscription',
                details: error.message
            });
        }
    }

    // יצירת subscription למייל ספציפי
    async createSubscription(req, res) {
        try {
            const email = decodeURIComponent(req.params.email);
            const {
                createdBy,
                notificationUrl,
                changeType = 'created',
                expirationHours = 70
            } = req.body;

            // Validate required parameters
            if (!createdBy) {
                return res.status(400).json({
                    error: 'חסר פרמטר חובה: createdBy'
                });
            }

            // Use default notificationUrl from config if not provided or empty
            const finalNotificationUrl = notificationUrl && notificationUrl.trim() !== '' 
                ? notificationUrl 
                : config.webhook?.url;
            
            // Add validation for notificationUrl
            if (!finalNotificationUrl) {
                return res.status(400).json({
                    error: 'חסר פרמטר חובה: notificationUrl - יש להגדיר WEBHOOK_URL במשתני הסביבה או לשלוח URL בבקשה'
                });
            }

            // Validate notificationUrl format (basic URL validation)
            try {
                new URL(finalNotificationUrl);
            } catch (urlError) {
                return res.status(400).json({
                    error: 'notificationUrl חייב להיות URL תקין'
                });
            }

            // בדוק שהמייל קיים במעקב
            const monitoredEmail = await MonitoredEmail.findByEmail(email);
            if (!monitoredEmail) {
                return res.status(404).json({
                    error: `המייל ${email} לא נמצא ברשימת המעקב`
                });
            }

            if (!validateEmail(email)) {
                return res.status(400).json({ error: 'כתובת מייל לא תקינה' });
            }

            console.log(`🔄 יוצר subscription נוסף עבור ${email} על ידי ${createdBy}`);
            console.log(`📍 Notification URL: ${finalNotificationUrl}`);

            const result = await SubscriptionService.createSubscription({
                email,
                createdBy,
                notificationUrl: finalNotificationUrl,
                changeType,
                expirationHours
            });

            console.log(`✅ Subscription נוסף נוצר עבור ${email}: ${result.subscription.subscriptionId}`);

            res.status(201).json({
                message: 'Subscription נוסף נוצר בהצלחה',
                subscription: {
                    id: result.subscription.subscriptionId,
                    email: result.subscription.email,
                    resource: result.subscription.resource,
                    changeType: result.subscription.changeType,
                    createdAt: result.subscription.createdAt,
                    expirationDateTime: result.subscription.expirationDateTime,
                    createdBy: result.subscription.createdBy,
                    clientState: result.subscription.clientState,
                    notificationUrl: result.subscription.notificationUrl
                },
                microsoftResponse: result.microsoftResponse
            });

        } catch (error) {
            console.error(`❌ שגיאה ביצירת subscription עבור ${req.params.email}:`, error);

            if (error.message.includes('הרשאה')) {
                res.status(401).json({
                    error: 'אין הרשאות לגישה למייל זה',
                    details: error.message
                });
            } else if (error.message.includes('NotificationUrl')) {
                res.status(400).json({
                    error: 'שגיאה ב-NotificationUrl',
                    details: error.message
                });
            } else if (error.message.includes('403')) {
                res.status(403).json({
                    error: 'אין הרשאות לגישה למייל זה',
                    details: error.message
                });
            } else {
                res.status(500).json({
                    error: 'שגיאה ביצירת subscription',
                    details: error.message
                });
            }
        }
    }

    // סטטיסטיקות subscriptions
    async getStatistics(req, res) {
        try {
            const stats = await Subscription.getStatistics();
            res.json({
                subscriptions: stats,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת סטטיסטיקות subscription:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת סטטיסטיקות subscription',
                details: error.message
            });
        }
    }

    // יצירת subscriptions למיילים הממתינים
    async createSubscriptionsForWaiting(req, res) {
        try {
            const { createdBy, notificationUrl, changeType = 'created', expirationHours = 70 } = req.body;

            if (!createdBy) {
                return res.status(400).json({
                    error: 'חסר פרמטר חובה: createdBy'
                });
            }

            if (!notificationUrl) {
                return res.status(400).json({
                    error: 'חסר פרמטר חובה: notificationUrl'
                });
            }

            // Get all monitored emails that are waiting for subscriptions
            const waitingEmails = await MonitoredEmail.findWaiting();

            if (waitingEmails.length === 0) {
                return res.json({
                    message: 'אין מיילים הממתינים ליצירת subscriptions',
                    created: 0,
                    results: []
                });
            }

            const results = [];
            let successCount = 0;

            for (const email of waitingEmails) {
                try {
                    const result = await SubscriptionService.createSubscription({
                        email: email.email,
                        createdBy,
                        notificationUrl,
                        changeType,
                        expirationHours
                    });

                    results.push({
                        email: email.email,
                        status: 'success',
                        subscriptionId: result.subscription.subscriptionId
                    });
                    successCount++;

                    console.log(`✅ Subscription נוצר עבור מייל ממתין: ${email.email}`);

                } catch (error) {
                    console.error(`❌ שגיאה ביצירת subscription עבור ${email.email}:`, error);
                    results.push({
                        email: email.email,
                        status: 'error',
                        error: error.message
                    });
                }
            }

            res.json({
                message: `נוצרו ${successCount} subscriptions מתוך ${waitingEmails.length} מיילים ממתינים`,
                total: waitingEmails.length,
                created: successCount,
                failed: waitingEmails.length - successCount,
                results
            });

        } catch (error) {
            console.error('❌ שגיאה ביצירת subscriptions למיילים ממתינים:', error);
            res.status(500).json({
                error: 'שגיאה ביצירת subscriptions למיילים ממתינים',
                details: error.message
            });
        }
    }
}

module.exports = new SubscriptionController();