const { EmailConfiguration } = require('../models');
const { validateEmail } = require('../utils/helpers');

class EmailConfigurationController {
    // הוספת הגדרת מייל חדשה
    async addConfiguration(req, res) {
        try {
            const {
                email,
                displayName,
                supplier,
                serviceType,
                serviceUrl,
                isActive,
                priority,
                processAttachments,
                sendToAutomation,
                customHeaders,
                webhookSettings,
                addedBy
            } = req.body;

            // ולידציה
            if (!email || !addedBy) {
                return res.status(400).json({
                    error: 'חסרים פרמטרים חובה',
                    required: ['email', 'addedBy']
                });
            }

            if (!validateEmail(email)) {
                return res.status(400).json({
                    error: 'כתובת מייל לא תקינה'
                });
            }

            // ולידציה של ספק
            const validSuppliers = ['UPS', 'FEDEX', 'DHL', 'UNKNOWN', 'CUSTOM'];
            if (supplier && !validSuppliers.includes(supplier)) {
                return res.status(400).json({
                    error: 'ספק לא תקין',
                    validSuppliers
                });
            }

            // ולידציה של סוג שירות
            const validServiceTypes = ['automation', 'priority', 'custom'];
            if (serviceType && !validServiceTypes.includes(serviceType)) {
                return res.status(400).json({
                    error: 'סוג שירות לא תקין',
                    validServiceTypes
                });
            }

            const configData = {
                email,
                displayName,
                supplier,
                serviceType,
                serviceUrl,
                isActive,
                priority,
                processAttachments,
                sendToAutomation,
                customHeaders,
                webhookSettings,
                addedBy,
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent')
            };

            const emailConfig = await EmailConfiguration.add(configData);

            // רענן את WebhookService עם ההגדרות החדשות
            await this.refreshWebhookService();

            console.log(`📧 הגדרת מייל חדשה נוספה: ${email} על ידי ${addedBy}`);

            res.status(201).json({
                message: 'הגדרת מייל נוספה בהצלחה',
                configuration: emailConfig
            });

        } catch (error) {
            console.error('❌ שגיאה בהוספת הגדרת מייל:', error);
            res.status(500).json({
                error: 'שגיאה בהוספת הגדרת מייל',
                details: error.message
            });
        }
    }

    // קבלת כל ההגדרות
    async getAllConfigurations(req, res) {
        try {
            const { activeOnly, supplier, serviceType, limit } = req.query;

            let configurations;
            
            if (activeOnly === 'true') {
                configurations = await EmailConfiguration.getActiveConfigurations();
            } else if (supplier) {
                configurations = await EmailConfiguration.getConfigurationsBySupplier(supplier);
            } else if (serviceType) {
                configurations = await EmailConfiguration.getConfigurationsByServiceType(serviceType);
            } else {
                configurations = await EmailConfiguration.getAllConfigurations(
                    limit ? parseInt(limit) : 100
                );
            }

            res.json({
                total: configurations.length,
                configurations
            });

        } catch (error) {
            console.error('❌ שגיאה בקבלת הגדרות מיילים:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת הגדרות מיילים',
                details: error.message
            });
        }
    }

    // קבלת הגדרה ספציפית
    async getConfiguration(req, res) {
        try {
            const { email } = req.params;
            const decodedEmail = decodeURIComponent(email);

            const configuration = await EmailConfiguration.findByEmail(decodedEmail);
            
            if (!configuration) {
                return res.status(404).json({
                    error: `הגדרת מייל עבור ${decodedEmail} לא נמצאה`
                });
            }

            res.json(configuration);

        } catch (error) {
            console.error('❌ שגיאה בקבלת הגדרת מייל:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת הגדרת מייל',
                details: error.message
            });
        }
    }

    // עדכון הגדרת מייל
    async updateConfiguration(req, res) {
        try {
            const { email } = req.params;
            const decodedEmail = decodeURIComponent(email);
            const { updatedBy, ...updateData } = req.body;

            if (!updatedBy) {
                return res.status(400).json({
                    error: 'חסר פרמטר חובה: updatedBy'
                });
            }

            // בדיקה שההגדרה קיימת
            const existingConfig = await EmailConfiguration.findByEmail(decodedEmail);
            if (!existingConfig) {
                return res.status(404).json({
                    error: `הגדרת מייל עבור ${decodedEmail} לא נמצאה`
                });
            }

            // ולידציות
            if (updateData.email && !validateEmail(updateData.email)) {
                return res.status(400).json({
                    error: 'כתובת מייל חדשה לא תקינה'
                });
            }

            const updated = await EmailConfiguration.updateConfiguration(
                decodedEmail, 
                updateData, 
                updatedBy
            );

            if (!updated) {
                return res.status(404).json({
                    error: 'הגדרת מייל לא נמצאה או לא עודכנה'
                });
            }

            // רענן את WebhookService עם ההגדרות החדשות
            await this.refreshWebhookService();

            console.log(`🔄 הגדרת מייל עודכנה: ${decodedEmail} על ידי ${updatedBy}`);

            res.json({
                message: 'הגדרת מייל עודכנה בהצלחה',
                email: decodedEmail,
                updatedBy,
                updatedAt: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ שגיאה בעדכון הגדרת מייל:', error);
            res.status(500).json({
                error: 'שגיאה בעדכון הגדרת מייל',
                details: error.message
            });
        }
    }

    // הפעלה/השבתה של הגדרת מייל
    async toggleActive(req, res) {
        try {
            const { email } = req.params;
            const decodedEmail = decodeURIComponent(email);
            const { isActive, updatedBy } = req.body;

            if (typeof isActive !== 'boolean' || !updatedBy) {
                return res.status(400).json({
                    error: 'חסרים פרמטרים חובה',
                    required: ['isActive (boolean)', 'updatedBy']
                });
            }

            const updated = await EmailConfiguration.toggleActive(
                decodedEmail, 
                isActive, 
                updatedBy
            );

            if (!updated) {
                return res.status(404).json({
                    error: 'הגדרת מייל לא נמצאה'
                });
            }

            // רענן את WebhookService עם ההגדרות החדשות
            await this.refreshWebhookService();

            console.log(`🔄 הגדרת מייל ${isActive ? 'הופעלה' : 'הושבתה'}: ${decodedEmail} על ידי ${updatedBy}`);

            res.json({
                message: `הגדרת מייל ${isActive ? 'הופעלה' : 'הושבתה'} בהצלחה`,
                email: decodedEmail,
                isActive,
                updatedBy,
                updatedAt: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ שגיאה בשינוי סטטוס הגדרת מייל:', error);
            res.status(500).json({
                error: 'שגיאה בשינוי סטטוס הגדרת מייל',
                details: error.message
            });
        }
    }

    // מחיקת הגדרת מייל
    async removeConfiguration(req, res) {
        try {
            const { email } = req.params;
            const decodedEmail = decodeURIComponent(email);
            const { removedBy, reason } = req.body;

            if (!removedBy || !reason) {
                return res.status(400).json({
                    error: 'חסרים פרמטרים חובה',
                    required: ['removedBy', 'reason']
                });
            }

            const removed = await EmailConfiguration.remove(
                decodedEmail, 
                removedBy, 
                reason
            );

            if (!removed) {
                return res.status(404).json({
                    error: 'הגדרת מייל לא נמצאה'
                });
            }

            // רענן את WebhookService עם ההגדרות החדשות
            await this.refreshWebhookService();

            console.log(`🗑️ הגדרת מייל הוסרה: ${decodedEmail} על ידי ${removedBy}`);

            res.json({
                message: 'הגדרת מייל הוסרה בהצלחה',
                email: decodedEmail,
                removedBy,
                reason
            });

        } catch (error) {
            console.error('❌ שגיאה בהסרת הגדרת מייל:', error);
            res.status(500).json({
                error: 'שגיאה בהסרת הגדרת מייל',
                details: error.message
            });
        }
    }

    // קבלת סטטיסטיקות
    async getStatistics(req, res) {
        try {
            const stats = await EmailConfiguration.getStatistics();
            
            res.json({
                emailConfigurations: stats,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ שגיאה בקבלת סטטיסטיקות הגדרות מיילים:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת סטטיסטיקות הגדרות מיילים',
                details: error.message
            });
        }
    }

    // רענון WebhookService עם ההגדרות החדשות
    async refreshWebhookService() {
        try {
            const { WebhookService } = require('../services');
            const emailData = await EmailConfiguration.getEmailsForWebhookService();
            
            // עדכון רשימת המיילים ב-WebhookService
            WebhookService.updateAutomationEmails(emailData.emails);
            WebhookService.updateSupplierMapping(emailData.supplierMapping);
            
            console.log(`🔄 WebhookService עודכן עם ${emailData.emails.length} הגדרות מייל`);
            
            return true;
        } catch (error) {
            console.error('❌ שגיאה ברענון WebhookService:', error);
            return false;
        }
    }

    // רענון ידני של WebhookService
    async refreshWebhookServiceManual(req, res) {
        try {
            const refreshed = await this.refreshWebhookService();
            
            if (refreshed) {
                res.json({
                    message: 'WebhookService עודכן בהצלחה עם ההגדרות החדשות',
                    timestamp: new Date().toISOString()
                });
            } else {
                res.status(500).json({
                    error: 'שגיאה ברענון WebhookService'
                });
            }

        } catch (error) {
            console.error('❌ שגיאה ברענון ידני:', error);
            res.status(500).json({
                error: 'שגיאה ברענון ידני',
                details: error.message
            });
        }
    }

    // ייבוא הגדרות מיילים מקובץ
    async importConfigurations(req, res) {
        try {
            const { configurations, importedBy } = req.body;

            if (!Array.isArray(configurations) || !importedBy) {
                return res.status(400).json({
                    error: 'חסרים פרמטרים חובה',
                    required: ['configurations (array)', 'importedBy']
                });
            }

            const results = {
                total: configurations.length,
                added: [],
                skipped: [],
                errors: []
            };

            for (const config of configurations) {
                try {
                    config.addedBy = importedBy;
                    config.ipAddress = req.ip || req.connection.remoteAddress;
                    config.userAgent = req.get('User-Agent');

                    const emailConfig = await EmailConfiguration.add(config);
                    results.added.push({
                        email: config.email,
                        id: emailConfig._id
                    });

                } catch (error) {
                    if (error.message.includes('כבר קיימת')) {
                        results.skipped.push({
                            email: config.email,
                            reason: 'כבר קיים'
                        });
                    } else {
                        results.errors.push({
                            email: config.email,
                            error: error.message
                        });
                    }
                }
            }

            // רענן את WebhookService אם נוספו הגדרות חדשות
            if (results.added.length > 0) {
                await this.refreshWebhookService();
            }

            console.log(`📥 ייבוא הושלם: ${results.added.length} נוספו, ${results.skipped.length} דולגו, ${results.errors.length} שגיאות`);

            res.json({
                message: 'ייבוא הגדרות הושלם',
                results
            });

        } catch (error) {
            console.error('❌ שגיאה בייבוא הגדרות:', error);
            res.status(500).json({
                error: 'שגיאה בייבוא הגדרות',
                details: error.message
            });
        }
    }

    // ייצוא הגדרות מיילים
    async exportConfigurations(req, res) {
        try {
            const configurations = await EmailConfiguration.getAllConfigurations();
            
            const exportData = {
                exportedAt: new Date().toISOString(),
                totalConfigurations: configurations.length,
                configurations: configurations.map(config => ({
                    email: config.email,
                    displayName: config.displayName,
                    supplier: config.supplier,
                    serviceType: config.serviceType,
                    serviceUrl: config.serviceUrl,
                    isActive: config.isActive,
                    priority: config.priority,
                    settings: config.settings
                }))
            };

            res.json(exportData);

        } catch (error) {
            console.error('❌ שגיאה בייצוא הגדרות:', error);
            res.status(500).json({
                error: 'שגיאה בייצוא הגדרות',
                details: error.message
            });
        }
    }
}

module.exports = new EmailConfigurationController();