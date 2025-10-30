const { MonitoredEmail } = require('../models');
const { SubscriptionService } = require('../services');
const { validateEmail, getNextSteps } = require('../utils/helpers');

class MonitoredEmailController {
    // הוספת מייל לניטור
    async addEmail(req, res) {
        try {
            const { 
                email, 
                displayName, 
                department, 
                monitoringReason, 
                addedBy, 
                priority, 
                notes,
                preApproved,           
                autoCreateSubscription 
            } = req.body;
            
            if (!email || !monitoringReason || !addedBy) {
                return res.status(400).json({ 
                    error: 'חסרים פרמטרים חובה',
                    required: ['email', 'monitoringReason', 'addedBy']
                });
            }

            if (!validateEmail(email)) {
                return res.status(400).json({ error: 'כתובת מייל לא תקינה' });
            }

            const initialStatus = preApproved === true ? 'ACTIVE' : 'WAITING_FOR_AZURE_SETUP';

            console.log(`📝 מוסיף מייל ${email} עם סטטוס: ${initialStatus}, preApproved: ${preApproved}, autoCreate: ${autoCreateSubscription}`);

            const monitoredEmail = await MonitoredEmail.add({
                email,
                displayName: displayName || email.split('@')[0],
                department: department || 'לא צוין',
                monitoringReason,
                addedBy,
                priority: priority || 'NORMAL',
                notes: notes || '',
                preApproved: preApproved === true,
                initialStatus,
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent')
            });

            let subscriptionResult = null;
            let subscriptionError = null;

            // רק אם יש אישור מראש במפורש ובקשה ליצור subscription
            if (preApproved === true && autoCreateSubscription === true) {
                try {
                    console.log(`🔄 יוצר subscription אוטומטי עבור ${email}...`);
                    const result = await SubscriptionService.createSubscription({
                        email,
                        createdBy: addedBy
                    });
                    subscriptionResult = result.subscription;
                    console.log(`✅ Subscription נוצר אוטומטית עבור ${email}: ${subscriptionResult.subscriptionId}`);
                } catch (error) {
                    subscriptionError = error.message;
                    console.error(`⚠️ שגיאה ביצירת subscription אוטומטי עבור ${email}:`, error.message);
                    
                    // אם נכשלה יצירת subscription, החזר את המייל לסטטוס המתנה
                    await MonitoredEmail.updateStatus(
                        email, 
                        'WAITING_FOR_AZURE_SETUP', 
                        'SYSTEM', 
                        `כשל ביצירת subscription אוטומטי: ${error.message}`
                    );
                }
            }

            console.log(`📝 מייל ${email} נוסף לניטור על ידי ${addedBy} (סטטוס: ${initialStatus})`);

            const response = {
                message: 'מייל נוסף לניטור בהצלחה',
                status: subscriptionResult ? 'ACTIVE' : initialStatus,
                monitoredEmail: {
                    id: monitoredEmail._id,
                    email: monitoredEmail.email,
                    status: subscriptionResult ? 'ACTIVE' : monitoredEmail.status,
                    addedAt: monitoredEmail.addedAt,
                    preApproved: monitoredEmail.preApproved
                }
            };

            if (subscriptionResult) {
                response.subscription = {
                    id: subscriptionResult.subscriptionId,
                    createdAt: subscriptionResult.createdAt,
                    expiresAt: subscriptionResult.expirationDateTime,
                    status: 'active'
                };
                response.message = 'מייל נוסף לניטור בהצלחה וSubscription נוצר אוטומטית';
                response.instruction = 'המייל פעיל ומנוטר - ניטור התחיל מיידית';
            } else if (subscriptionError) {
                response.warning = `Subscription לא נוצר: ${subscriptionError}`;
                response.instruction = 'המייל נוסף לניטור אך יש לטפל בבעיית ה-subscription באופן ידני';
            } else if (preApproved === true) {
                response.instruction = 'המייל מאושר ופעיל - ניתן ליצור subscription באופן ידני דרך הממשק';
            } else {
                response.instruction = 'המייל ממתין לאישור - מנהל אבטחת המידע צריך לאשר ולהגדיר הרשאות Azure AD';
            }

            response.nextSteps = getNextSteps(preApproved, autoCreateSubscription, subscriptionResult, subscriptionError);

            res.status(201).json(response);

        } catch (error) {
            console.error('❌ שגיאה בהוספת מייל לניטור:', error);
            
            let errorDetails = error.message;
            if (error.message.includes('כבר במעקב')) {
                errorDetails = `המייל ${req.body.email} כבר קיים במערכת הניטור`;
            }
            
            res.status(500).json({ 
                error: 'שגיאה בהוספת מייל לניטור',
                details: errorDetails,
                timestamp: new Date().toISOString()
            });
        }
    }

    // רשימת כל המיילים המנוטרים
    async getEmails(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 100;
            const status = req.query.status;

            let emails;
            if (status) {
                emails = await MonitoredEmail.getEmailsByStatus(status);
            } else {
                emails = await MonitoredEmail.getAllEmails(limit);
            }

            res.json({
                total: emails.length,
                emails: emails
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת רשימת מיילים:', error);
            res.status(500).json({ 
                error: 'שגיאה בקבלת רשימת מיילים',
                details: error.message 
            });
        }
    }

    // עדכון סטטוס מייל
    async updateEmailStatus(req, res) {
        try {
            const { email } = req.params; // Already decoded by middleware
            const { status, updatedBy, notes } = req.body;

            if (!status || !updatedBy) {
                return res.status(400).json({
                    error: 'חסרים פרמטרים חובה',
                    required: ['status', 'updatedBy']
                });
            }

            const validStatuses = ['WAITING_FOR_AZURE_SETUP', 'ACTIVE', 'INACTIVE'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    error: 'סטטוס לא תקין',
                    validStatuses
                });
            }

            const updated = await MonitoredEmail.updateStatus(email, status, updatedBy, notes || '');

            if (!updated) {
                return res.status(404).json({ error: 'מייל לא נמצא' });
            }

            console.log(`🔄 סטטוס ${email} עודכן ל-${status} על ידי ${updatedBy}`);

            res.json({
                message: 'סטטוס עודכן בהצלחה',
                email: email,
                status,
                updatedBy,
                updatedAt: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ שגיאה בעדכון סטטוס:', error);
            res.status(500).json({
                error: 'שגיאה בעדכון סטטוס',
                details: error.message
            });
        }
    }

    // הסרת מייל מניטור
    async removeEmail(req, res) {
        try {
            const { email } = req.params; // Already decoded by middleware
            const { removedBy, reason } = req.body;

            if (!removedBy || !reason) {
                return res.status(400).json({
                    error: 'חסרים פרמטרים חובה',
                    required: ['removedBy', 'reason']
                });
            }

            const removed = await MonitoredEmail.remove(email, removedBy, reason);

            if (!removed) {
                return res.status(404).json({ error: 'מייל לא נמצא' });
            }

            console.log(`🗑️ מייל ${email} הוסר מניטור על ידי ${removedBy}`);

            res.json({
                message: 'מייל הוסר מניטור בהצלחה',
                email: email,
                removedBy,
                reason
            });

        } catch (error) {
            console.error('❌ שגיאה בהסרת מייל:', error);
            res.status(500).json({
                error: 'שגיאה בהסרת מייל',
                details: error.message
            });
        }
    }

    // קבלת פרטי מייל ספציפי
    async getEmailDetails(req, res) {
        try {
            const { email } = req.params; // Already decoded by middleware
            // Extra decode removed - middleware handles it

            const monitoredEmail = await MonitoredEmail.findByEmail(email);
            if (!monitoredEmail) {
                return res.status(404).json({ 
                    error: `המייל ${email} לא נמצא ברשימת המעקב` 
                });
            }

            res.json(monitoredEmail);
        } catch (error) {
            console.error('❌ שגיאה בקבלת פרטי מייל:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת פרטי מייל',
                details: error.message
            });
        }
    }

    // סטטיסטיקות מיילים מנוטרים
    async getStatistics(req, res) {
        try {
            const stats = await MonitoredEmail.getStatistics();
            res.json({
                monitoredEmails: stats,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת סטטיסטיקות:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת סטטיסטיקות',
                details: error.message
            });
        }
    }

    // הוספת מייל לאוטומציה (פונקציה מהירה)
    async addForAutomation(req, res) {
        try {
            const { email, addedBy, department, displayName } = req.body;
            
            if (!email || !addedBy) {
                return res.status(400).json({ 
                    error: 'חסרים פרמטרים חובה',
                    required: ['email', 'addedBy']
                });
            }

            if (!validateEmail(email)) {
                return res.status(400).json({ error: 'כתובת מייל לא תקינה' });
            }

            // בדוק אם המייל כבר קיים
            const existingEmail = await MonitoredEmail.findByEmail(email);
            if (existingEmail) {
                // אם המייל כבר קיים, עדכן אותו לאוטומציה
                const updated = await MonitoredEmail.updateStatus(
                    email, 
                    'ACTIVE', 
                    addedBy, 
                    'עודכן לניטור אוטומציה - עיבוד מסמכים'
                );
                
                if (updated) {
                    console.log(`📧 מייל ${email} עודכן לאוטומציה על ידי ${addedBy}`);
                    return res.json({
                        success: true,
                        message: `מייל ${email} עודכן לניטור אוטומציה`,
                        status: 'updated',
                        email
                    });
                }
            }

            // הוסף מייל חדש לאוטומציה
            const monitoredEmail = await MonitoredEmail.add({
                email,
                displayName: displayName || email.split('@')[0],
                department: department || 'ספק',
                monitoringReason: 'import_automation',
                addedBy,
                priority: 'HIGH',
                notes: 'מייל לאוטומציה - עיבוד מסמכים ויבוא אוטומטי',
                preApproved: true,
                initialStatus: 'ACTIVE',
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent')
            });

            console.log(`🚀 מייל ${email} נוסף לאוטומציה על ידי ${addedBy}`);

            res.status(201).json({
                success: true,
                message: `מייל ${email} נוסף לניטור אוטומציה בהצלחה`,
                status: 'added',
                monitoredEmail: {
                    id: monitoredEmail._id,
                    email: monitoredEmail.email,
                    status: monitoredEmail.status,
                    monitoringReason: monitoredEmail.monitoringReason,
                    addedAt: monitoredEmail.addedAt
                },
                instruction: 'המייל כעת מנוטר לאוטומציה - מסמכים יעובדו אוטומטית'
            });

        } catch (error) {
            console.error('❌ שגיאה בהוספת מייל לאוטומציה:', error);
            res.status(500).json({
                success: false,
                error: 'שגיאה בהוספת מייל לאוטומציה',
                details: error.message
            });
        }
    }

    // קבלת רשימת מיילים לאוטומציה
    async getAutomationEmails(req, res) {
        try {
            const automationEmails = await MonitoredEmail.getEmailsByStatus('ACTIVE');
            const filteredEmails = automationEmails.filter(email => 
                email.monitoringReason === 'import_automation' || 
                email.monitoringReason === 'document_processing' ||
                email.monitoringReason === 'automation'
            );

            res.json({
                success: true,
                total: filteredEmails.length,
                emails: filteredEmails.map(email => ({
                    email: email.email,
                    displayName: email.displayName,
                    department: email.department,
                    addedBy: email.addedBy,
                    addedAt: email.addedAt,
                    status: email.status,
                    notes: email.notes
                }))
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת מיילים לאוטומציה:', error);
            res.status(500).json({
                success: false,
                error: 'שגיאה בקבלת מיילים לאוטומציה',
                details: error.message
            });
        }
    }
}

module.exports = new MonitoredEmailController();