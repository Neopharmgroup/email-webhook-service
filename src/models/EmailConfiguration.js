const { ObjectId } = require('mongodb');
const database = require('../database/connection');
const AuditLog = require('./AuditLog');

class EmailConfiguration {
    static get collection() {
        return database.getCollection('emailConfigurations');
    }

    // הוספת הגדרת מייל חדשה
    static async add(configData) {
        const emailConfig = {
            email: configData.email.toLowerCase(),
            displayName: configData.displayName || configData.email.split('@')[0],
            supplier: configData.supplier || 'UNKNOWN',
            serviceType: configData.serviceType || 'automation', // automation, priority, custom
            serviceUrl: configData.serviceUrl || process.env.AUTOMATION_SERVICE_URL,
            isActive: configData.isActive !== false,
            priority: configData.priority || 'NORMAL',
            settings: {
                processAttachments: configData.processAttachments !== false,
                sendToAutomation: configData.sendToAutomation !== false,
                customHeaders: configData.customHeaders || {},
                webhookSettings: configData.webhookSettings || {}
            },
            addedBy: configData.addedBy,
            addedAt: new Date(),
            updatedAt: new Date(),
            metadata: {
                ipAddress: configData.ipAddress,
                userAgent: configData.userAgent
            }
        };

        try {
            const result = await this.collection.insertOne(emailConfig);

            // רשום ב-audit log
            await AuditLog.create({
                action: 'EMAIL_CONFIG_ADDED',
                resourceType: 'EmailConfiguration',
                resourceId: result.insertedId.toString(),
                details: {
                    email: emailConfig.email,
                    supplier: emailConfig.supplier,
                    serviceType: emailConfig.serviceType,
                    addedBy: emailConfig.addedBy
                },
                performedBy: emailConfig.addedBy
            });

            return await this.collection.findOne({ _id: result.insertedId });
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`הגדרת מייל עבור ${configData.email} כבר קיימת`);
            }
            throw error;
        }
    }

    // קבלת כל ההגדרות הפעילות
    static async getActiveConfigurations() {
        return await this.collection
            .find({ isActive: true })
            .sort({ email: 1 })
            .toArray();
    }

    // קבלת כל ההגדרות (כולל לא פעילות)
    static async getAllConfigurations(limit = 100) {
        return await this.collection
            .find()
            .sort({ addedAt: -1 })
            .limit(limit)
            .toArray();
    }

    // קבלת הגדרות לפי ספק
    static async getConfigurationsBySupplier(supplier) {
        return await this.collection
            .find({ supplier: supplier, isActive: true })
            .sort({ email: 1 })
            .toArray();
    }

    // קבלת הגדרות לפי סוג שירות
    static async getConfigurationsByServiceType(serviceType) {
        return await this.collection
            .find({ serviceType: serviceType, isActive: true })
            .sort({ email: 1 })
            .toArray();
    }

    // חיפוש הגדרה לפי מייל
    static async findByEmail(email) {
        return await this.collection.findOne({ 
            email: email.toLowerCase(),
            isActive: true 
        });
    }

    // עדכון הגדרת מייל
    static async updateConfiguration(email, updateData, updatedBy) {
        const oldConfig = await this.findByEmail(email);
        
        const updateFields = {
            ...updateData,
            updatedAt: new Date(),
            updatedBy
        };

        // אם יש email חדש, ודא שהוא באותיות קטנות
        if (updateFields.email) {
            updateFields.email = updateFields.email.toLowerCase();
        }

        const result = await this.collection.updateOne(
            { email: email.toLowerCase() },
            { $set: updateFields }
        );

        if (result.modifiedCount > 0) {
            await AuditLog.create({
                action: 'EMAIL_CONFIG_UPDATED',
                resourceType: 'EmailConfiguration',
                resourceId: email,
                details: {
                    email,
                    oldConfig: oldConfig,
                    newConfig: updateFields,
                    updatedBy
                },
                performedBy: updatedBy
            });
        }

        return result.modifiedCount > 0;
    }

    // הפעלה/השבתה של הגדרת מייל
    static async toggleActive(email, isActive, updatedBy) {
        const result = await this.collection.updateOne(
            { email: email.toLowerCase() },
            {
                $set: {
                    isActive,
                    updatedAt: new Date(),
                    updatedBy
                }
            }
        );

        if (result.modifiedCount > 0) {
            await AuditLog.create({
                action: 'EMAIL_CONFIG_STATUS_CHANGED',
                resourceType: 'EmailConfiguration',
                resourceId: email,
                details: {
                    email,
                    isActive,
                    updatedBy
                },
                performedBy: updatedBy
            });
        }

        return result.modifiedCount > 0;
    }

    // מחיקת הגדרת מייל
    static async remove(email, removedBy, reason) {
        const configDoc = await this.findByEmail(email);
        if (!configDoc) {
            throw new Error('הגדרת מייל לא נמצאה');
        }

        const result = await this.collection.deleteOne({ 
            email: email.toLowerCase() 
        });

        if (result.deletedCount > 0) {
            await AuditLog.create({
                action: 'EMAIL_CONFIG_REMOVED',
                resourceType: 'EmailConfiguration',
                resourceId: email,
                details: {
                    email,
                    removedBy,
                    reason,
                    originalData: configDoc
                },
                performedBy: removedBy
            });
        }

        return result.deletedCount > 0;
    }

    // קבלת סטטיסטיקות
    static async getStatistics() {
        const pipeline = [
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: { $sum: { $cond: ['$isActive', 1, 0] } },
                    inactive: { $sum: { $cond: ['$isActive', 0, 1] } }
                }
            }
        ];

        const supplierPipeline = [
            { $match: { isActive: true } },
            {
                $group: {
                    _id: '$supplier',
                    count: { $sum: 1 }
                }
            }
        ];

        const serviceTypePipeline = [
            { $match: { isActive: true } },
            {
                $group: {
                    _id: '$serviceType',
                    count: { $sum: 1 }
                }
            }
        ];

        const [generalStats, supplierStats, serviceTypeStats] = await Promise.all([
            this.collection.aggregate(pipeline).toArray(),
            this.collection.aggregate(supplierPipeline).toArray(),
            this.collection.aggregate(serviceTypePipeline).toArray()
        ]);

        return {
            general: generalStats[0] || { total: 0, active: 0, inactive: 0 },
            bySupplier: supplierStats.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {}),
            byServiceType: serviceTypeStats.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {})
        };
    }

    // רענון רשימת המיילים ל-WebhookService
    static async getEmailsForWebhookService() {
        const activeConfigs = await this.getActiveConfigurations();
        
        // מיפוי למבנה שה-WebhookService מצפה לו
        const emailList = activeConfigs.map(config => config.email);
        const supplierMapping = {};
        
        activeConfigs.forEach(config => {
            if (config.supplier && config.supplier !== 'UNKNOWN') {
                supplierMapping[config.email] = config.supplier;
                // הוסף גם את הדומיין אם רלוונטי
                const domain = config.email.split('@')[1];
                if (domain) {
                    supplierMapping[domain] = config.supplier;
                }
            }
        });

        return {
            emails: emailList,
            supplierMapping: supplierMapping,
            configurations: activeConfigs
        };
    }

    // בעת אתחול המערכת, טען הגדרות ברירת מחדל
    static async initializeDefaultConfigurations() {
        try {
            const existingCount = await this.collection.countDocuments();
            
            if (existingCount === 0) {
                console.log('🔧 יוצר הגדרות ברירת מחדל עבור מיילי האוטומציה...');
                
                const defaultConfigs = [
                    // כתובות פנימיות לטסטים
                    {
                        email: 'michal.l@neopharmgroup.com',
                        displayName: 'Michal Test',
                        supplier: 'UPS',
                        serviceType: 'automation',
                        priority: 'HIGH',
                        addedBy: 'SYSTEM_INIT'
                    },
                    {
                        email: 'cloudteamsdev@neopharmgroup.com',
                        displayName: 'CloudTeams Dev',
                        supplier: 'UPS',
                        serviceType: 'automation',
                        priority: 'HIGH',
                        addedBy: 'SYSTEM_INIT'
                    },
                    {
                        email: 'test@neopharmgroup.com',
                        displayName: 'Test Account',
                        supplier: 'UPS',
                        serviceType: 'automation',
                        priority: 'NORMAL',
                        addedBy: 'SYSTEM_INIT'
                    },
                    
                    // כתובות FEDEX
                    {
                        email: 'noreply@fedex.com',
                        displayName: 'FedEx No Reply',
                        supplier: 'FEDEX',
                        serviceType: 'automation',
                        priority: 'HIGH',
                        addedBy: 'SYSTEM_INIT'
                    },
                    {
                        email: 'notification@fedex.com',
                        displayName: 'FedEx Notifications',
                        supplier: 'FEDEX',
                        serviceType: 'automation',
                        priority: 'HIGH',
                        addedBy: 'SYSTEM_INIT'
                    },
                    
                    // כתובות UPS
                    {
                        email: 'noreply@ups.com',
                        displayName: 'UPS No Reply',
                        supplier: 'UPS',
                        serviceType: 'automation',
                        priority: 'HIGH',
                        addedBy: 'SYSTEM_INIT'
                    },
                    {
                        email: 'notification@ups.com',
                        displayName: 'UPS Notifications',
                        supplier: 'UPS',
                        serviceType: 'automation',
                        priority: 'HIGH',
                        addedBy: 'SYSTEM_INIT'
                    },
                    
                    // כתובות DHL
                    {
                        email: 'noreply@dhl.com',
                        displayName: 'DHL No Reply',
                        supplier: 'DHL',
                        serviceType: 'automation',
                        priority: 'HIGH',
                        addedBy: 'SYSTEM_INIT'
                    }
                ];

                for (const config of defaultConfigs) {
                    try {
                        await this.add(config);
                        console.log(`✅ נוספה הגדרת ברירת מחדל עבור ${config.email}`);
                    } catch (error) {
                        console.warn(`⚠️ לא ניתן להוסיף ${config.email}:`, error.message);
                    }
                }

                console.log('✅ הגדרות ברירת מחדל נוצרו בהצלחה');
            } else {
                console.log(`ℹ️ נמצאו ${existingCount} הגדרות מייל קיימות`);
            }
        } catch (error) {
            console.error('❌ שגיאה ביצירת הגדרות ברירת מחדל:', error);
        }
    }
}

module.exports = EmailConfiguration;