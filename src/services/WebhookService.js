const axios = require('axios');
const { BlobServiceClient, BlobSASPermissions } = require('@azure/storage-blob');
const blobStorageService = require('./blobStorageService');
const config = require('../config');
const { EmailNotification, Subscription, MonitoredEmail } = require('../models');

class WebhookService {
    constructor() {
        this.webhookSiteUrl = config.webhook.siteUrl;
        // הגדרת URL לשרת האוטומציה הפנימי
        this.automationServiceUrl = process.env.AUTOMATION_SERVICE_URL || 'http://localhost:4005/api/import-automation/direct-email-webhook';

        // הגדרות Azure Storage
        this.azureConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING ;
        this.containerName = process.env.CONTAINER_NAME || 'import-file-automation';

        // יצירת Azure Blob Service Client
        if (this.azureConnectionString) {
            try {
                this.blobServiceClient = BlobServiceClient.fromConnectionString(this.azureConnectionString);
                console.log(`☁️ Azure Storage מוגדר עם container: ${this.containerName}`);

                // בדיקה אם Container קיים
                this.checkAzureConnection();
            } catch (azureError) {
                console.error(`❌ שגיאה ביצירת Azure client:`, azureError.message);
                this.blobServiceClient = null;
            }
        } else {
            console.warn('⚠️ Azure Storage לא מוגדר');
        }

        // הגדרות Microsoft Graph API
        this.graphApiUrl = config.azure.graphApiUrl;
        this.accessToken = null;

        // מערך כתובות מייל לאוטומציה (ניתן לערוך ישירות בקוד)
        this.automationEmails = [
            'michal.l@neopharmgroup.com',
            'test@supplier.com',
            'import@supplier.com',
            'orders@supplier.com',
            'documents@supplier.com',
            // ספקי שילוח - דוגמאות
            'ups@test.com',
            'fedex@test.com',
            'dhl@test.com',
            'noreply@ups.com',
            'tracking@fedex.com',
            'notification@dhl.com',
            // כתובות נוספות שעשויות להכיל מסמכי משלוח
            'shipping@company.com',
            'logistics@supplier.com',
            'delivery@warehouse.com'
            // הוסף כתובות נוספות כאן...
        ];

        // בדיקה שblobStorageService טעון כראוי
        console.log(`🔧 blobStorageService זמין:`, {
            available: !!blobStorageService,
            hasUploadMethod: !!(blobStorageService && blobStorageService.uploadFileToDirectory),
            hasSasMethod: !!(blobStorageService && blobStorageService.getFileUrlWithSAS),
            methods: blobStorageService ? Object.keys(blobStorageService).slice(0, 5) : []
        });

        // מיפוי ספקי שילוח לפי כתובת מייל ונושא
        this.supplierMapping = {
            // UPS
            'ups': 'UPS',
            'united parcel': 'UPS',
            'ups.com': 'UPS',
            'quantum view': 'UPS',

            // FedEx
            'fedex': 'FEDEX',
            'fed ex': 'FEDEX',
            'federal express': 'FEDEX',
            'fedex.com': 'FEDEX',

            // DHL
            'dhl': 'DHL',
            'dhl.com': 'DHL',
            'dalsey': 'DHL',
            'hillblom': 'DHL',
            'lynn': 'DHL',

            // מיילים לבדיקה - נתייחס אליהם כספק UPS לצורך הבדיקה
            'michal.l@neopharmgroup.com': 'UPS',
            'neopharmgroup.com': 'UPS',

            // מילות מפתח נוספות
            'tracking': null, // יחפש גם מילים אחרות
            'shipment': null,
            'delivery': null,
            'משלוח': null,
            'מעקב': null,
            'חבילה': null
        };
    }

    // זיהוי ספק שילוח לפי כתובת מייל ונושא ההודעה
    identifySupplier(email, subject = '') {
        const emailLower = email.toLowerCase();
        const subjectLower = subject.toLowerCase();

        // חפש במייל ובנושא
        const searchText = `${emailLower} ${subjectLower}`;

        console.log(`🔍 מחפש ספק ב: "${email}" | "${subject}"`);

        // תחילה חפש ספקים ספציפיים
        for (const [keyword, supplier] of Object.entries(this.supplierMapping)) {
            if (supplier && searchText.includes(keyword)) {
                console.log(`✅ ספק ${supplier} זוהה לפי המילה "${keyword}"`);
                return supplier;
            }
        }

        // אם לא נמצא ספק ספציפי, בדוק אם יש מילות מפתח של משלוח
        const shippingKeywords = ['tracking', 'shipment', 'delivery', 'משלוח', 'מעקב', 'חבילה'];
        const hasShippingKeyword = shippingKeywords.some(keyword => searchText.includes(keyword));

        if (hasShippingKeyword) {
            console.log(`📦 זוהה מייל משלוח אבל ספק לא זוהה עבור: ${email}`);
            // אם זה נראה כמו מייל משלוח אבל הספק לא זוהה, החזר null אבל עם הערה
            return 'UNKNOWN_SHIPPING';
        }

        console.log(`❓ לא זוהה ספק או מילות מפתח של משלוח עבור: ${email}`);
        return null;
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

    // תיקון הבעיה - הוספת בדיקה חזקה יותר לפני שליחה לאוטומציה
    async processNotification(notification) {
        try {
            const subscription = await Subscription.findBySubscriptionId(notification.subscriptionId);

            if (!subscription) {
                console.log(`❌ מנוי לא נמצא עבור subscriptionId: ${notification.subscriptionId}`);
                return { success: false, error: 'Subscription not found' };
            }

            // בדיקה ראשונה: האם המייל נמצא ברשימת האוטומציה
            const emailLower = subscription.email.toLowerCase();
            
            if (!this.automationEmails.includes(emailLower)) {
                console.log(`🚫 מייל ${subscription.email} לא נמצא ברשימת האוטומציה - מדלג על עיבוד`);
                
                // עדיין נתעד את הnotification במסד נתונים
                const emailNotification = await EmailNotification.create({
                    email: subscription.email,
                    subscriptionId: notification.subscriptionId,
                    resource: notification.resource,
                    changeType: notification.changeType,
                    clientState: notification.clientState,
                    messageId: notification.resource.split('/').pop(),
                    processed: true, // מסמן כמעובד אבל לא נשלח לאוטומציה
                    skipped: true,   // מוסיף שדה חדש למעקב
                    reason: 'Email not in automation list'
                });
                
                return { 
                    success: true, 
                    message: 'Email not in automation list - skipped',
                    skipped: true 
                };
            }

            console.log(`✅ מייל ${subscription.email} נמצא ברשימת האוטומציה - ממשיך בעיבוד`);

            // המשך העיבוד הרגיל...
            const emailDetails = await this.getEmailDetails(subscription, notification.resource);
            
            if (emailDetails) {
                console.log(`🤖 מייל מ-${subscription.email} מועבר לאוטומציה`);
                
                // הקבצים כבר עובדו בתוך getEmailDetails ויש לנו URLs
                if (emailDetails.hasAttachments && emailDetails.azureUrls) {
                    console.log(`📎 מייל כולל ${emailDetails.azureUrls.length} קבצים מצורפים ב-Azure`);
                }

                // עכשיו emailDetails.azureUrls מכיל את ה-URLs
                await this.sendToAutomationService(emailDetails, subscription, notification);
            }

            return { success: true, message: 'Notification processed successfully' };

        } catch (error) {
            console.error(`❌ שגיאה בעיבוד notification:`, error);
            return { success: false, error: error.message };
        }
    }

    // פונקציה נפרדת לבדיקה אם מייל נמצא ברשימה
    isInAutomationList(email) {
        const emailLower = email.toLowerCase();
        const isInList = this.automationEmails.includes(emailLower);
        
        console.log(`🔍 בודק אם ${email} ברשימת האוטומציה: ${isInList ? 'כן' : 'לא'}`);
        console.log(`📋 רשימת מיילים לאוטומציה:`, this.automationEmails);
        
        return isInList;
    }

    // פונקציה לקבלת רשימת המיילים הפעילים
    getAutomationEmails() {
        return [...this.automationEmails]; // החזרת עותק של המערך
    }

    // פונקציה להוספת מייל לרשימה
    addEmailToAutomation(email) {
        const emailLower = email.toLowerCase();
        if (!this.automationEmails.includes(emailLower)) {
            this.automationEmails.push(emailLower);
            console.log(`✅ מייל ${email} נוסף לרשימת האוטומציה`);
            return true;
        }
        console.log(`ℹ️ מייל ${email} כבר קיים ברשימת האוטומציה`);
        return false;
    }

    // פונקציה להסרת מייל מהרשימה
    removeEmailFromAutomation(email) {
        const emailLower = email.toLowerCase();
        const index = this.automationEmails.indexOf(emailLower);
        if (index > -1) {
            this.automationEmails.splice(index, 1);
            console.log(`🗑️ מייל ${email} הוסר מרשימת האוטומציה`);
            return true;
        }
        console.log(`ℹ️ מייל ${email} לא נמצא ברשימת האוטומציה`);
        return false;
    }

    // קבלת Access Token ל-Microsoft Graph API
    async getAccessToken() {
        if (this.accessToken) {
            return this.accessToken;
        }

        try {
            const tokenUrl = config.azure.authUrl;
            const tokenData = new URLSearchParams({
                client_id: config.azure.clientId,
                client_secret: config.azure.clientSecret,
                scope: config.azure.scope,
                grant_type: 'client_credentials'
            });

            const response = await axios.post(tokenUrl, tokenData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            this.accessToken = response.data.access_token;
            console.log('✅ קיבלנו Access Token מ-Microsoft Graph');

            // Token expires after 1 hour, clear it after 50 minutes
            setTimeout(() => {
                this.accessToken = null;
            }, 50 * 60 * 1000);

            return this.accessToken;
        } catch (error) {
            console.error('❌ שגיאה בקבלת Access Token:', error.message);
            throw error;
        }
    }

    // קריאת פרטי מייל מ-Microsoft Graph כולל קבצים מצורפים
    async getEmailDetails(subscription, resource) {
        try {
            const accessToken = await this.getAccessToken();

            // הסר prefix אם קיים ובנה URL נכון
            const cleanResource = resource.replace('/v1.0/', '');
            const emailUrl = `${this.graphApiUrl}/${cleanResource}`;

            console.log(`📖 קורא פרטי מייל מ-Graph API: ${emailUrl}`);

            const response = await axios.get(emailUrl, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const email = response.data;

            const emailDetails = {
                id: email.id,
                subject: email.subject || 'ללא נושא',
                sender: email.from?.emailAddress?.address || email.sender?.emailAddress?.address || subscription.email,
                senderName: email.from?.emailAddress?.name || email.sender?.emailAddress?.name || '',
                receivedDateTime: email.receivedDateTime,
                hasAttachments: email.hasAttachments || false,
                bodyPreview: email.bodyPreview || '',
                webLink: email.webLink || '',
                attachments: [],
                azureUrls: [] // מערך חדש לשמירת URLs של הקבצים ב-Azure
            };

            // אם יש קבצים מצורפים, הורד אותם והעלה ל-Azure
            if (email.hasAttachments) {
                console.log(`📎 מייל כולל קבצים מצורפים - מוריד...`);
                const { attachments, azureUrls } = await this.getEmailAttachments(accessToken, cleanResource);
                emailDetails.attachments = attachments;
                emailDetails.azureUrls = azureUrls; // שמירת ה-URLs ל-Azure
            }

            return emailDetails;
        } catch (error) {
            console.error('❌ שגיאה בקריאת פרטי מייל:', error.message);
            if (error.response) {
                console.error('📊 Graph API Error:', error.response.status, error.response.data);
            }
            // אם יש שגיאה, החזר נתונים בסיסיים
            return {
                id: 'unknown',
                subject: `מייל מ-${subscription.email}`,
                sender: subscription.email,
                senderName: '',
                receivedDateTime: new Date().toISOString(),
                hasAttachments: false,
                bodyPreview: '',
                webLink: '',
                attachments: [],
                azureUrls: []
            };
        }
    }

    // הורדת קבצים מצורפים מ-Microsoft Graph והעלאה ל-Azure Storage
    async getEmailAttachments(accessToken, resourcePath) {
        try {
            const attachmentsUrl = `${this.graphApiUrl}/${resourcePath}/attachments`;
            console.log(`📎 מוריד קבצים מצורפים: ${attachmentsUrl}`);

            const response = await axios.get(attachmentsUrl, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const attachments = response.data.value || [];
            console.log(`📎 נמצאו ${attachments.length} קבצים מצורפים`);

            const processedAttachments = [];
            const azureUrls = []; // מערך חדש לשמירת URLs

            for (const attachment of attachments) {
                try {
                    console.log(`📎 מעבד קובץ: ${attachment.name} (${attachment.size} bytes)`);

                    // הורד את תוכן הקובץ מ-Microsoft Graph
                    const attachmentContent = await this.getAttachmentContent(accessToken, resourcePath, attachment.id);

                    if (attachmentContent) {
                        console.log(`📥 קיבלנו תוכן קובץ ${attachment.name}: ${attachmentContent.length} תווי Base64`);

                        // נסה להעלות ל-Azure Storage באמצעות blobStorageService
                        try {
                            // יצירת שם directory נקי - זה הקטע שגרם לבעיה!
                            const cleanMessageId = resourcePath
                                .replace(/[^a-zA-Z0-9]/g, '') // מסיר כל תו שאינו אות או ספרה
                                .substring(0, 50); // מגביל אורך
                            
                            const directoryName = `emails/${cleanMessageId}`;
                            
                            // יצירת timestamp ושם קובץ נקי
                            const timestamp = Date.now();
                            const cleanFileName = attachment.name
                                .replace(/[^a-zA-Z0-9.-]/g, '_') // מחליף תווים לא חוקיים ב-_
                                .substring(0, 100); // מגביל אורך שם קובץ
                            
                            const fileName = `${timestamp}-${cleanFileName}`;

                            console.log(`☁️ מעלה קובץ ל-Azure: ${directoryName}/${fileName}`);
                            console.log(`🔧 Directory נקי: "${directoryName}"`);
                            console.log(`🔧 FileName נקי: "${fileName}"`);

                            // שימוש ב-blobStorageService במקום הקוד הכפול
                            const uploadResult = await blobStorageService.uploadFileToDirectory(
                                this.containerName,
                                directoryName,
                                fileName,
                                attachmentContent,
                                attachment.contentType,
                                attachment.name
                            );

                            if (uploadResult.success) {
                                // יצירת SAS URL להורדה
                                const sasUrl = await blobStorageService.getFileUrlWithSAS(this.containerName, uploadResult.filePath);

                                console.log(`✅ קובץ ${attachment.name} הועלה ל-Azure בהצלחה`);
                                console.log(`🔗 SAS URL: ${sasUrl}`);

                                // שמירת מידע לשירות import-automation
                                const attachmentInfo = {
                                    originalname: attachment.name,
                                    filename: fileName,
                                    name: attachment.name,
                                    size: attachment.size,
                                    mimetype: attachment.contentType || 'application/octet-stream',
                                    contentType: attachment.contentType || 'application/octet-stream',
                                    storedInAzure: true,
                                    containerName: this.containerName,
                                    blobName: uploadResult.filePath,
                                    downloadUrl: sasUrl,
                                    azureUrl: sasUrl,
                                    sasUrl: sasUrl,
                                    url: sasUrl,
                                    uploadedAt: new Date().toISOString()
                                };

                                processedAttachments.push(attachmentInfo);
                                azureUrls.push(attachmentInfo); // הוספה למערך ה-URLs

                            } else {
                                throw new Error('Azure upload failed');
                            }

                        } catch (azureError) {
                            console.error(`❌ שגיאה בהעלאת קובץ ${attachment.name} ל-Azure:`, azureError.message);
                            
                            // Fallback - שלח עם Base64 (רק כגיבוי)
                            console.log(`📦 Fallback: שולח ${attachment.name} כ-Base64`);
                            const fallbackInfo = {
                                originalname: attachment.name,
                                filename: attachment.name,
                                name: attachment.name,
                                size: attachment.size,
                                mimetype: attachment.contentType || 'application/octet-stream',
                                contentType: attachment.contentType || 'application/octet-stream',
                                content: attachmentContent,
                                storedInAzure: false,
                                fallbackReason: 'azure_upload_failed',
                                error: azureError.message
                            };
                            
                            processedAttachments.push(fallbackInfo);
                            azureUrls.push(fallbackInfo); // גם זה נוסיף למערך
                        }
                    }
                } catch (error) {
                    console.error(`❌ שגיאה בעיבוד קובץ ${attachment.name}:`, error.message);
                    const errorInfo = {
                        originalname: attachment.name,
                        filename: attachment.name,
                        name: attachment.name,
                        size: attachment.size,
                        mimetype: attachment.contentType || 'application/octet-stream',
                        contentType: attachment.contentType || 'application/octet-stream',
                        error: error.message,
                        storedInAzure: false,
                        fallbackReason: 'processing_failed'
                    };
                    
                    processedAttachments.push(errorInfo);
                    azureUrls.push(errorInfo);
                }
            }

            console.log(`📎 סיימנו לעבד ${processedAttachments.length} קבצים מצורפים`);
            
            // החזרת גם המידע המלא וגם רק ה-URLs
            return {
                attachments: processedAttachments,
                azureUrls: azureUrls
            };

        } catch (error) {
            console.error('❌ שגיאה בהורדת קבצים מצורפים:', error.message);
            return {
                attachments: [],
                azureUrls: []
            };
        }
    }

    // הורדת תוכן קובץ מצורף ספציפי
    async getAttachmentContent(accessToken, resourcePath, attachmentId) {
        try {
            const attachmentUrl = `${this.graphApiUrl}/${resourcePath}/attachments/${attachmentId}`;

            const response = await axios.get(attachmentUrl, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            // Microsoft Graph מחזיר את התוכן בשדה contentBytes (Base64)
            const contentBytes = response.data.contentBytes;

            if (contentBytes) {
                console.log(`📥 הורד תוכן קובץ ${attachmentId}: ${contentBytes.length} תווי Base64`);
                console.log(`🔍 Base64 מתחיל ב: ${contentBytes.substring(0, 50)}...`);
                console.log(`🔍 Base64 מסתיים ב: ...${contentBytes.substring(contentBytes.length - 50)}`);

                // בדיקה שהתוכן Base64 תקין
                try {
                    const buffer = Buffer.from(contentBytes, 'base64');
                    console.log(`✅ תוכן Base64 תקין - גודל אחרי המרה: ${buffer.length} bytes`);
                } catch (base64Error) {
                    console.error(`❌ תוכן Base64 לא תקין:`, base64Error.message);
                }

                return contentBytes;
            } else {
                console.warn(`⚠️ לא נמצא תוכן בשדה contentBytes עבור ${attachmentId}`);
                return null;
            }
        } catch (error) {
            console.error(`❌ שגיאה בהורדת תוכן קובץ ${attachmentId}:`, error.message);
            return null;
        }
    }

    // בדיקת חיבור ל-Azure Storage
    async checkAzureConnection() {
        try {
            if (!this.blobServiceClient) {
                console.warn('⚠️ Azure client לא זמין');
                return false;
            }

            console.log('🔍 בודק חיבור ל-Azure Storage...');
            
            // בדיקה באמצעות blobStorageService
            const containerExists = await blobStorageService.containerExists(this.containerName);
            
            if (!containerExists) {
                console.log(`📦 יוצר container: ${this.containerName}`);
                await blobStorageService.createContainer(this.containerName);
            }

            console.log('✅ חיבור ל-Azure Storage פעיל');
            return true;

        } catch (error) {
            console.error('❌ שגיאה בבדיקת חיבור Azure:', error.message);
            return false;
        }
    }

    // הוספת הפונקציות החסרות:

    // אימות בקשת webhook
    validateWebhookRequest(req) {
        const validationToken = req.query.validationToken;
        
        if (validationToken) {
            // זה validation request
            return {
                isValidation: true,
                token: validationToken
            };
        }

        // זה notification request
        const notifications = req.body.value || [];
        return {
            isValidation: false,
            notifications: notifications
        };
    }

    // טיפול בvalidation request
    async handleValidation(token) {
        console.log('🔓 מטפל בvalidation token:', token);
        return token;
    }

    // קבלת סטטיסטיקות webhook
    async getWebhookStatistics() {
        try {
            const { EmailNotification } = require('../models');
            
            const total = await EmailNotification.collection.countDocuments();
            const processed = await EmailNotification.collection.countDocuments({ processed: true });
            const unprocessed = await EmailNotification.collection.countDocuments({ processed: false });
            const skipped = await EmailNotification.collection.countDocuments({ skipped: true });
            
            // Get notifications from last 24 hours
            const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const recent = await EmailNotification.collection.countDocuments({
                timestamp: { $gte: last24Hours }
            });

            return {
                total,
                processed,
                unprocessed,
                skipped,
                recentCount: recent,
                automationEmailsCount: this.automationEmails.length,
                automationEmails: this.automationEmails
            };
        } catch (error) {
            console.error('❌ שגיאה בקבלת סטטיסטיקות:', error);
            return {
                total: 0,
                processed: 0,
                unprocessed: 0,
                skipped: 0,
                recentCount: 0,
                automationEmailsCount: this.automationEmails.length,
                automationEmails: this.automationEmails,
                error: error.message
            };
        }
    }

    // בדיקת webhook
    async testWebhook() {
        return {
            status: 'success',
            message: 'Webhook service is working',
            timestamp: new Date().toISOString(),
            azureConnected: !!this.blobServiceClient,
            automationServiceUrl: this.automationServiceUrl,
            automationEmailsCount: this.automationEmails.length
        };
    }

    // ניקוי התראות ישנות
    async cleanupOldNotifications(daysToKeep = 30) {
        try {
            const { EmailNotification } = require('../models');
            return await EmailNotification.deleteOldNotifications(daysToKeep);
        } catch (error) {
            console.error('❌ שגיאה בניקוי התראות:', error);
            throw error;
        }
    }

    // עיבוד מחדש של התראות לא מעובדות
    async processUnprocessedNotifications() {
        try {
            const { EmailNotification } = require('../models');
            const unprocessedNotifications = await EmailNotification.getUnprocessedNotifications(50);
            
            const results = [];
            
            for (const notification of unprocessedNotifications) {
                try {
                    // נסה לעבד שוב את ההתראה
                    const result = await this.processNotification({
                        subscriptionId: notification.subscriptionId,
                        resource: notification.resource,
                        changeType: notification.changeType,
                        clientState: notification.clientState
                    });
                    
                    if (result.success) {
                        await EmailNotification.markAsProcessed(notification._id);
                        results.push({
                            notificationId: notification._id,
                            status: 'reprocessed',
                            message: 'Successfully reprocessed'
                        });
                    } else {
                        results.push({
                            notificationId: notification._id,
                            status: 'failed',
                            error: result.error
                        });
                    }
                } catch (error) {
                    results.push({
                        notificationId: notification._id,
                        status: 'failed',
                        error: error.message
                    });
                }
            }
            
            return results;
        } catch (error) {
            console.error('❌ שגיאה בעיבוד מחדש:', error);
            throw error;
        }
    }

    // שליחה לשרת האוטומציה (פונקציה שנראית שחסרה)
    async sendToAutomationService(emailDetails, subscription, notification) {
        try {
            console.log(`🤖 מייל מ-${subscription.email} מועבר לאוטומציה`);
            console.log(`🤖 שולח לשרת האוטומציה: ${this.automationServiceUrl}`);

            // במקום לשלוח את emailDetails עם "[MAX_DEPTH_REACHED]", 
            // נבנה אובייקט נקי עם URLs של הקבצים
            const cleanEmailData = {
                email: subscription.email,
                emailDetails: {
                    id: emailDetails.id,
                    subject: emailDetails.subject,
                    sender: emailDetails.sender || emailDetails.from?.emailAddress?.address,
                    senderName: emailDetails.senderName || emailDetails.from?.emailAddress?.name,
                    receivedDateTime: emailDetails.receivedDateTime,
                    hasAttachments: emailDetails.hasAttachments || (emailDetails.attachments && emailDetails.attachments.length > 0),
                    bodyPreview: emailDetails.bodyPreview,
                    webLink: emailDetails.webLink,
                    // במקום attachments עם "[MAX_DEPTH_REACHED]", נשלח URLs
                    attachments: emailDetails.azureUrls || [] // ה-URLs שנוצרו בהעלאה ל-Azure
                },
                notification: {
                    subscriptionId: notification.subscriptionId,
                    subscriptionExpirationDateTime: notification.subscriptionExpirationDateTime,
                    changeType: notification.changeType,
                    resource: notification.resource,
                    clientState: notification.clientState,
                    tenantId: notification.tenantId
                },
                timestamp: new Date().toISOString()
            };

            // לוג מפורט של מה שנשלח
            console.log(`📤 מה שנשלח לשירות האוטומציה:`);
            console.log(`   📧 Email: ${cleanEmailData.email}`);
            console.log(`   📑 Subject: ${cleanEmailData.emailDetails.subject}`);
            console.log(`   📎 Attachments count: ${cleanEmailData.emailDetails.attachments.length}`);
            if (cleanEmailData.emailDetails.attachments.length > 0) {
                console.log(`   🔗 First attachment URLs:`);
                cleanEmailData.emailDetails.attachments.slice(0, 3).forEach((att, index) => {
                    console.log(`      ${index + 1}. ${att.name || att.originalname || 'Unknown'}: ${(att.downloadUrl || att.azureUrl || att.url || att.sasUrl || 'No URL').substring(0, 100)}...`);
                });
            }

            const response = await axios.post(this.automationServiceUrl, cleanEmailData, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'EmailWebhookService/1.0'
                },
                timeout: 300000 // 5 דקות - זמן מספיק לעיבוד Gemini AI
            });

            console.log(`✅ נשלח בהצלחה לשרת האוטומציה, סטטוס: ${response.status}`);
            return { success: true, status: response.status };

        } catch (error) {
            console.error(`❌ שגיאה בשליחה לשרת האוטומציה:`, error.message);
            if (error.response) {
                console.error(`📊 סטטוס התגובה: ${error.response.status}`);
                console.error(`📊 נתוני התגובה:`, error.response.data);
            }
            return { success: false, error: error.message };
        }
    }

    async processAttachments(email, messageId, userId) {
        try {
            console.log(`📎 מוריד קבצים מצורפים: ${this.graphBaseUrl}/Users/${userId}/Messages/${messageId}/attachments`);
            
            const attachmentsResponse = await axios.get(
                `${this.graphBaseUrl}/Users/${userId}/Messages/${messageId}/attachments`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const attachments = attachmentsResponse.data.value;
            console.log(`📎 נמצאו ${attachments.length} קבצים מצורפים`);

            const azureUrls = []; // מערך לשמירת URLs של Azure

            for (const attachment of attachments) {
                if (attachment['@odata.type'] === '#microsoft.graph.fileAttachment') {
                    try {
                        console.log(`📎 מעבד קובץ: ${attachment.name} (${attachment.size} bytes)`);
                        
                        // הורדת תוכן הקובץ
                        const attachmentResponse = await axios.get(
                            `${this.graphBaseUrl}/Users/${userId}/Messages/${messageId}/attachments/${attachment.id}`,
                            {
                                headers: {
                                    'Authorization': `Bearer ${this.accessToken}`,
                                    'Content-Type': 'application/json'
                            }
                        }
                        );

                        const fileContent = attachmentResponse.data.contentBytes;
                        console.log(`📥 הורד תוכן קובץ ${attachment.id}: ${fileContent.length} תווי Base64`);

                        // בדיקת תקינות Base64
                        console.log(`🔍 Base64 מתחיל ב: ${fileContent.substring(0, 50)}...`);
                        console.log(`🔍 Base64 מסתיים ב: ...${fileContent.substring(fileContent.length - 50)}`);

                        try {
                            const binaryData = Buffer.from(fileContent, 'base64');
                            console.log(`✅ תוכן Base64 תקין - גודל אחרי המרה: ${binaryData.length} bytes`);
                        } catch (base64Error) {
                            console.error(`❌ שגיאה בפענוח Base64:`, base64Error);
                            continue;
                        }

                        console.log(`📥 קיבלנו תוכן קובץ ${attachment.name}: ${fileContent.length} תווי Base64`);
                        
                        // העלאה ל-Azure Storage
                        const timestamp = Date.now();
                        const directory = `emails/Users${userId.replace(/[^a-zA-Z0-9]/g, '')}MessagesAAMkA`;
                        const fileName = `${timestamp}-${attachment.name}`;
                        
                        console.log(`☁️ מעלה קובץ ל-Azure: ${directory}/${fileName}`);
                        
                        // ניקוי שם הקובץ והתיקייה
                        const cleanDirectory = directory.replace(/[^a-zA-Z0-9\/\-_]/g, '');
                        const cleanFileName = fileName.replace(/[^a-zA-Z0-9\.\-_]/g, '');
                        
                        console.log(`🔧 Directory נקי: "${cleanDirectory}"`);
                        console.log(`🔧 FileName נקי: "${cleanFileName}"`);

                        const uploadResult = await this.blobStorageService.uploadBase64File(
                            cleanDirectory,
                            cleanFileName,
                            fileContent,
                            attachment.contentType || 'application/octet-stream'
                        );

                        if (uploadResult.success) {
                            console.log(`✅ קובץ ${attachment.name} הועלה ל-Azure בהצלחה`);
                            
                            // יצירת SAS URL
                            const sasUrl = await this.blobStorageService.getFileUrl(
                                `${cleanDirectory}/${cleanFileName}`,
                                24 * 60 // 24 שעות
                            );
                            
                            console.log(`🔗 SAS URL: ${sasUrl}`);
                            
                            // הוספת הURL למערך
                            azureUrls.push({
                                fileName: attachment.name,
                                contentType: attachment.contentType,
                                size: attachment.size,
                                azureUrl: sasUrl,
                                azurePath: `${cleanDirectory}/${cleanFileName}`
                            });
                            
                        } else {
                            console.error(`❌ שגיאה בהעלאה ל-Azure:`, uploadResult.error);
                        }

                    } catch (attachmentError) {
                        console.error(`❌ שגיאה בעיבוד קובץ ${attachment.name}:`, attachmentError);
                    }
                }
            }

            console.log(`📎 סיימנו לעבד ${attachments.length} קבצים מצורפים`);
            
            // החזרת המייל עם ה-URLs של Azure
            return {
                ...email,
                azureUrls: azureUrls // הוספת URLs ל-object של המייל
            };

        } catch (error) {
            console.error(`❌ שגיאה בהורדת קבצים מצורפים:`, error);
            return email; // החזרת המייל המקורי במקרה של שגיאה
        }
    }
}

module.exports = new WebhookService();