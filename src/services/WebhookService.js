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

        // מערך כתובות מייל לאוטומציה - מעודכן לפי הדרישות החדשות
        this.automationEmails = [
            // כתובות פנימיות לטסטים - גרסאות עם אותיות קטנות וגדולות
            'michal.l@neopharmgroup.com',
            'michal.l@Neopharmgroup.com',
            'cloudteamsdev@neopharmgroup.com',
            'cloudteamsdev@Neopharmgroup.com',
            'test@neopharmgroup.com',
            'test@Neopharmgroup.com',
            
            // כתובות FEDEX מקוריות
            'noreply@fedex.com',
            'notification@fedex.com',
            'tracking@fedex.com',
            'shipment@fedex.com',
            'express@fedex.com',
            'import@fedex.com',
            'documents@fedex.com',
            
            // כתובות UPS מקוריות
            'noreply@ups.com',
            'notification@ups.com',
            'notifications@ups.com',
            'tracking@ups.com',
            'quantum@ups.com',
            'import@ups.com',
            'shipment@ups.com',
            
            // כתובות DHL מקוריות
            'noreply@dhl.com',
            'notification@dhl.com',
            'tracking@dhl.com',
            'express@dhl.com',
            'logistics@dhl.com',
            'import@dhl.com',
            
            // כתובות נוספות שעשויות להכיל מסמכי משלוח
            'shipping@company.com',
            'logistics@supplier.com',
            'delivery@warehouse.com',
            'orders@supplier.com',
            'import@supplier.com',
            'test@supplier.com',
            
            // כתובות כלליות
            'documents@company.com',
            'invoices@company.com',
            'customs@company.com'
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
            'ups import': 'UPS',
            'ups notification': 'UPS',
            'ups tracking': 'UPS',

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
            'cloudteamsdev@neopharmgroup.com': 'UPS',

            // מילות מפתח נוספות
            'tracking': null, // יחפש גם מילים אחרות
            'shipment': null,
            'delivery': null,
            'משלוח': null,
            'מעקב': null,
            'חבילה': null
        };

        // הוספת cache למניעת שליחות כפולות לאוטומציה
        this.sentToAutomationCache = new Map();
        
        // ניקוי cache כל 10 דקות
        setInterval(() => {
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
            for (const [key, timestamp] of this.sentToAutomationCache) {
                if (timestamp < tenMinutesAgo) {
                    this.sentToAutomationCache.delete(key);
                }
            }
        }, 10 * 60 * 1000);
    }

    // זיהוי ספק שילוח לפי כתובת מייל ונושא ההודעה
    identifySupplier(email, subject = '') {
        const emailLower = email.toLowerCase();
        const subjectLower = subject.toLowerCase();

        // חפש במייל ובנושא
        const searchText = `${emailLower} ${subjectLower}`;

        console.log(`🔍 מחפש ספק ב: "${email}" | "${subject}"`);
        console.log(`🔍 טקסט חיפוש: "${searchText}"`);

        // תחילה חפש ספקים ספציפיים
        for (const [keyword, supplier] of Object.entries(this.supplierMapping)) {
            if (supplier && searchText.includes(keyword)) {
                console.log(`✅ ספק ${supplier} זוהה לפי המילה "${keyword}"`);
                return supplier;
            }
        }

        console.log(`🔍 בדיקת מילות מפתח: ${Object.keys(this.supplierMapping).filter(k => this.supplierMapping[k]).join(', ')}`);

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
                    success: false,
                    error: error.message
                });
            }
        }

        return results;
    }

    // סינון ועיבוד התראות מייל משופר עם זיהוי ספק ובדיקת רלוונטיות
    async processNotification(notification) {
        try {
            const subscription = await Subscription.findBySubscriptionId(notification.subscriptionId);

            if (!subscription) {
                console.log(`❌ מנוי לא נמצא עבור subscriptionId: ${notification.subscriptionId}`);
                return { success: false, error: 'Subscription not found' };
            }

            // שלב 1: בדיקה ראשונה - האם המייל נמצא ברשימת המיילים לניטור
            const emailLower = subscription.email.toLowerCase();
            
            console.log(`🔍 בודק מייל ברשימת האוטומציה:`, {
                email: subscription.email,
                emailLower: emailLower,
                automationEmailsLower: this.automationEmails.map(e => e.toLowerCase()),
                isInListDirect: this.automationEmails.includes(emailLower),
                isInListCaseInsensitive: this.automationEmails.map(e => e.toLowerCase()).includes(emailLower),
                totalEmailsInList: this.automationEmails.length,
                firstFewEmails: this.automationEmails.slice(0, 5)
            });
            
            // בדיקה case-insensitive
            const isInAutomationList = this.automationEmails.map(e => e.toLowerCase()).includes(emailLower);
            
            if (!isInAutomationList) {
                console.log(`🚫 מייל ${subscription.email} לא נמצא ברשימת האוטומציה - מדלג על עיבוד`);
                console.log(`📋 רשימת מיילים פעילה:`, this.automationEmails);
                
                // תיעוד התראה שדולגה
                const emailNotification = await EmailNotification.create({
                    email: subscription.email,
                    subscriptionId: notification.subscriptionId,
                    resource: notification.resource,
                    changeType: notification.changeType,
                    clientState: notification.clientState,
                    messageId: notification.resource.split('/').pop(),
                    processed: true,
                    skipped: true,
                    reason: 'Email not in automation list'
                });
                
                return { 
                    success: true, 
                    message: 'Email not in automation list - skipped',
                    skipped: true 
                };
            }

            console.log(`✅ מייל ${subscription.email} נמצא ברשימת האוטומציה - ממשיך לבדיקת רלוונטיות`);

            // שלב 2: קבלת פרטי המייל ובדיקת הנושא
            const emailDetails = await this.getEmailDetails(subscription, notification.resource);
            
            if (!emailDetails) {
                console.log(`❌ לא ניתן לקרוא פרטי מייל עבור ${subscription.email} - מתעד וממשיך`);
                
                // תיעוד שגיאה בקריאת מייל
                const emailNotification = await EmailNotification.create({
                    email: subscription.email,
                    subscriptionId: notification.subscriptionId,
                    resource: notification.resource,
                    changeType: notification.changeType,
                    clientState: notification.clientState,
                    messageId: notification.resource.split('/').pop(),
                    processed: true,
                    skipped: true,
                    reason: 'Could not read email details'
                });
                
                return { 
                    success: true, 
                    message: 'Email notification recorded but could not read details',
                    skipped: true,
                    reason: 'Could not read email details'
                };
            }

            // שלב 3: זיהוי ספק וסוג מסמך על בסיס כתובת השולח והנושא
            const supplierResult = this.identifySupplierAndDocumentType(
                emailDetails.sender,
                emailDetails.subject,
                emailDetails.attachments
            );

            if (!supplierResult.isRelevant) {
                console.log(`🚫 מייל לא רלוונטי לאוטומציה:`, {
                    sender: emailDetails.sender,
                    subject: emailDetails.subject,
                    reason: supplierResult.reason
                });

                // תיעוד מייל לא רלוונטי
                const emailNotification = await EmailNotification.create({
                    email: subscription.email,
                    subscriptionId: notification.subscriptionId,
                    resource: notification.resource,
                    changeType: notification.changeType,
                    clientState: notification.clientState,
                    messageId: notification.resource.split('/').pop(),
                    processed: true,
                    skipped: true,
                    reason: `Not relevant for automation: ${supplierResult.reason}`
                });
                
                return { 
                    success: true, 
                    message: `Email not relevant for automation: ${supplierResult.reason}`,
                    skipped: true,
                    supplier: supplierResult.supplier,
                    documentType: supplierResult.documentType
                };
            }

            console.log(`✅ מייל רלוונטי לאוטומציה מזוהה:`, {
                supplier: supplierResult.supplier,
                documentType: supplierResult.documentType,
                confidence: supplierResult.confidence,
                reason: supplierResult.reason
            });

            // שלב 4: העברה לשירות האוטומציה עם המידע המועשר
            emailDetails.supplierInfo = supplierResult;
            
            if (emailDetails.hasAttachments && emailDetails.azureUrls) {
                console.log(`📎 מייל כולל ${emailDetails.azureUrls.length} קבצים מצורפים ב-Azure`);
            }

            try {
                const automationResult = await this.sendToAutomationService(emailDetails, subscription, notification);
                
                if (automationResult.success) {
                    console.log(`✅ מייל נשלח בהצלחה לשירות האוטומציה`);
                } else {
                    console.log(`⚠️ שליחה לאוטומציה נכשלה אבל נותר מתועד:`, automationResult.error);
                }
            } catch (automationError) {
                console.error(`❌ שגיאה בשליחה לאוטומציה:`, automationError.message);
                // אל נכשל את כל התהליך בגלל שגיאה באוטומציה
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
            console.log('🔍 מחפש התראות לא מעובדות...');
            
            // שליפת כל ההתראות הלא מעובדות
            const unprocessedNotifications = await EmailNotification.collection.find({ 
                processed: false 
            }).sort({ timestamp: 1 }).toArray(); // מהישן לחדש
            
            console.log(`📬 נמצאו ${unprocessedNotifications.length} התראות לא מעובדות`);
            
            if (unprocessedNotifications.length === 0) {
                return {
                    total: 0,
                    processed: 0,
                    skipped: 0,
                    failed: 0,
                    message: 'אין התראות לעיבוד'
                };
            }
            
            // עיבוד כל ההתראות
            const results = [];
            let processedCount = 0;
            let skippedCount = 0;
            let failedCount = 0;
            
            for (const notification of unprocessedNotifications) {
                try {
                    console.log(`🔄 מעבד התראה: ${notification._id}`);
                    const result = await this.processNotification(notification);
                    
                    if (result.success) {
                        if (result.skipped) {
                            skippedCount++;
                        } else {
                            processedCount++;
                        }
                        
                        // סימון כמעובד
                        await EmailNotification.collection.updateOne(
                            { _id: notification._id },
                            { 
                                $set: {
                                    processed: true,
                                    processedAt: new Date()
                                }
                            }
                        );
                    } else {
                        failedCount++;
                    }
                    
                    results.push(result);
                    
                } catch (error) {
                    console.error(`❌ שגיאה בעיבוד התראה ${notification._id}:`, error);
                    failedCount++;
                    results.push({
                        subscriptionId: notification.subscriptionId,
                        success: false,
                        error: error.message,
                        notificationId: notification._id
                    });
                }
            }
            
            console.log(`✅ עיבוד הושלם: ${processedCount} עובדו, ${skippedCount} דולגו, ${failedCount} נכשלו`);
            
            return {
                total: unprocessedNotifications.length,
                processed: processedCount,
                skipped: skippedCount,
                failed: failedCount,
                details: results
            };
            
        } catch (error) {
            console.error('❌ שגיאה בעיבוד התראות לא מעובדות:', error);
            throw error;
        }
    }

    // שליחה לשרת האוטומציה עם מידע מועשר ומניעת כפילות
    async sendToAutomationService(emailDetails, subscription, notification) {
        try {
            console.log(`🤖 מייל מ-${subscription.email} מועבר לאוטומציה`);

            // יצירת מזהה ייחודי לאותו מייל
            const messageId = emailDetails.id || notification.resource.split('/').pop();
            const emailCacheKey = `${subscription.email}-${messageId}`;
            
            // בדיקה אם כבר נשלח לאוטומציה
            if (this.sentToAutomationCache.has(emailCacheKey)) {
                const sentTime = this.sentToAutomationCache.get(emailCacheKey);
                console.log(`🔄 מייל כבר נשלח לאוטומציה בזמן ${sentTime}, מדלג`);
                return { 
                    success: true, 
                    message: 'Email already sent to automation service',
                    duplicate: true,
                    sentAt: sentTime
                };
            }

            // השתמש במידע הספק שכבר זוהה
            const supplierInfo = emailDetails.supplierInfo;
            
            if (!supplierInfo || !supplierInfo.supplier || supplierInfo.supplier === 'UNKNOWN_SHIPPING') {
                console.log(`❌ ספק לא זוהה או לא נתמך עבור מייל זה`);
                return { 
                    success: false, 
                    error: 'ספק לא מזוהה - רק UPS, FEDEX, DHL נתמכים',
                    supportedSuppliers: ['UPS', 'FEDEX', 'DHL']
                };
            }

            console.log(`✅ ספק ${supplierInfo.supplier} זוהה בהצלחה עם רמת ביטחון ${supplierInfo.confidence}`);
            console.log(`📋 סוג מסמך: ${supplierInfo.documentType}`);
            console.log(`🤖 שולח לשרת האוטומציה: ${this.automationServiceUrl}`);

            // בניית נתוני המייל המועשרים עם מידע הספק וסוג המסמך
            const cleanEmailData = {
                type: 'direct_email',
                supplier: supplierInfo.supplier,
                supplierInfo: {
                    supplier: supplierInfo.supplier,
                    documentType: supplierInfo.documentType,
                    confidence: supplierInfo.confidence,
                    isInitialDocument: supplierInfo.isInitialDocument,
                    isDeclaration: supplierInfo.isDeclaration,
                    isBulkEmail: supplierInfo.isBulkEmail,
                    reason: supplierInfo.reason
                },
                emailData: {
                    email: subscription.email,
                    from: emailDetails.sender || emailDetails.from?.emailAddress?.address,
                    sender: emailDetails.sender || emailDetails.from?.emailAddress?.address,
                    subject: emailDetails.subject,
                    emailDetails: {
                        id: emailDetails.id,
                        subject: emailDetails.subject,
                        sender: emailDetails.sender || emailDetails.from?.emailAddress?.address,
                        senderName: emailDetails.senderName || emailDetails.from?.emailAddress?.name,
                        receivedDateTime: emailDetails.receivedDateTime,
                        hasAttachments: emailDetails.hasAttachments || (emailDetails.attachments && emailDetails.attachments.length > 0),
                        bodyPreview: emailDetails.bodyPreview,
                        webLink: emailDetails.webLink,
                        // קבצים מצורפים עם URLs מ-Azure
                        attachments: emailDetails.azureUrls || []
                    },
                    // גם שמירה ברמה העליונה לתמיכה לאחור
                    attachments: emailDetails.azureUrls || []
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
            console.log(`   📧 Email: ${cleanEmailData.emailData.email}`);
            console.log(`   📑 Subject: ${cleanEmailData.emailData.emailDetails.subject}`);
            console.log(`   📎 Attachments count: ${cleanEmailData.emailData.emailDetails.attachments.length}`);
            console.log(`   🏢 Supplier: ${cleanEmailData.supplier}`);
            console.log(`   📋 Document Type: ${cleanEmailData.supplierInfo.documentType}`);
            console.log(`   🎯 Confidence: ${cleanEmailData.supplierInfo.confidence}`);
            console.log(`   📝 Reason: ${cleanEmailData.supplierInfo.reason}`);
            
            if (cleanEmailData.emailData.emailDetails.attachments.length > 0) {
                console.log(`   🔗 First attachment URLs:`);
                cleanEmailData.emailData.emailDetails.attachments.slice(0, 3).forEach((att, index) => {
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

            // הוסף את המייל שנשלח ל-cache למניעת שליחות כפולות
            this.sentToAutomationCache.set(emailCacheKey, new Date());

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

    // זיהוי ספק וסוג מסמך מתקדם על בסיס האפיון
    identifySupplierAndDocumentType(senderEmail, subject, attachments = []) {
        const result = {
            isRelevant: false,
            supplier: null,
            documentType: null,
            confidence: 0,
            reason: '',
            isInitialDocument: false,
            isDeclaration: false,
            isBulkEmail: false
        };

        const emailLower = (senderEmail || '').toLowerCase();
        const subjectLower = (subject || '').toLowerCase();
        const searchText = `${emailLower} ${subjectLower}`;

        console.log(`🔍 מתחיל זיהוי מתקדם:`, {
            sender: senderEmail,
            subject: subject,
            attachmentsCount: attachments.length
        });

        // 1. זיהוי FEDEX
        if (this.isFedexEmail(emailLower, subjectLower, attachments)) {
            result.supplier = 'FEDEX';
            result.isRelevant = true;
            
            // בדיקת סוג מסמך FEDEX
            if (this.isFedexInitialDocument(subjectLower, attachments)) {
                result.documentType = 'INITIAL_BILL_OF_LADING';
                result.isInitialDocument = true;
                result.confidence = 0.95;
                result.reason = 'FEDEX initial shipment document';
            } else if (this.isFedexDeclarationDocument(subjectLower, attachments)) {
                result.documentType = 'DECLARATION_UPDATE';
                result.isDeclaration = true;
                result.confidence = 0.90;
                result.reason = 'FEDEX declaration document (customs release)';
            } else {
                result.documentType = 'GENERAL_FEDEX';
                result.confidence = 0.70;
                result.reason = 'FEDEX email - additional documentation';
            }
        }
        
        // 2. זיהוי UPS
        else if (this.isUpsEmail(emailLower, subjectLower, attachments)) {
            result.supplier = 'UPS';
            result.isRelevant = true;
            
            // בדיקת סוג מסמך UPS
            if (this.isUpsBulkStatusReport(subjectLower)) {
                result.documentType = 'UPS_BULK_STATUS_REPORT';
                result.isBulkEmail = true;
                result.confidence = 0.95;
                result.reason = 'UPS bulk import shipment status report';
            } else if (this.isUpsIndividualNotification(subjectLower)) {
                result.documentType = 'UPS_INDIVIDUAL_NOTIFICATION';
                result.isInitialDocument = true;
                result.confidence = 0.90;
                result.reason = 'UPS individual import notification';
            } else {
                result.documentType = 'GENERAL_UPS';
                result.confidence = 0.70;
                result.reason = 'UPS email - general documentation';
            }
        }
        
        // 3. זיהוי DHL
        else if (this.isDhlEmail(emailLower, subjectLower)) {
            result.supplier = 'DHL';
            result.isRelevant = true;
            result.documentType = 'GENERAL_DHL';
            result.confidence = 0.80;
            result.reason = 'DHL shipping email';
        }
        
        // 4. בדיקה האם יש מילות מפתח של משלוח אבל ספק לא מזוהה
        else if (this.hasShippingKeywords(searchText)) {
            result.supplier = 'UNKNOWN_SHIPPING';
            result.isRelevant = false; // לא נשלח לאוטומציה
            result.confidence = 0.30;
            result.reason = 'Contains shipping keywords but supplier not identified';
        }
        
        // 5. מייל לא רלוונטי
        else {
            result.isRelevant = false;
            result.confidence = 0;
            result.reason = 'No shipping or automation-related keywords found';
        }

        console.log(`🎯 תוצאת זיהוי:`, result);
        return result;
    }

    // בדיקות ספציפיות לכל ספק
    isFedexEmail(emailLower, subjectLower, attachments) {
        const fedexIndicators = [
            'fedex', 'fed ex', 'federal express',
            'fedex.com', 'fedex.co.il'
        ];
        
        const hasFedexKeyword = fedexIndicators.some(keyword => 
            emailLower.includes(keyword) || subjectLower.includes(keyword)
        );
        
        // בדיקה לפי הדוגמאות שנתת
        const hasFedexSubjectPattern = subjectLower.includes('fedex scanned documents for cust');
        
        return hasFedexKeyword || hasFedexSubjectPattern;
    }

    isFedexInitialDocument(subjectLower, attachments) {
        // דוגמה: "FedEx Scanned Documents for cust 27823 ELDAN ELECTRONIC INSTRUMENT, AWB: 450277523095"
        const hasAwbPattern = subjectLower.includes('awb:') && /awb:\s*\d+/.test(subjectLower);
        
        // בדיקה שאין מסמך DECLARATION בקבצים המצורפים
        const hasDeclarationDoc = attachments.some(att => {
            const fileName = (att.name || att.originalname || '').toLowerCase();
            return fileName.startsWith('declaration');
        });
        
        return hasAwbPattern && !hasDeclarationDoc;
    }

    isFedexDeclarationDocument(subjectLower, attachments) {
        // אותו נושא כמו המסמך הראשוני אבל עם מסמך DECLARATION
        const hasAwbPattern = subjectLower.includes('awb:') && /awb:\s*\d+/.test(subjectLower);
        
        const hasDeclarationDoc = attachments.some(att => {
            const fileName = (att.name || att.originalname || '').toLowerCase();
            return fileName.startsWith('declaration');
        });
        
        return hasAwbPattern && hasDeclarationDoc;
    }

    isUpsEmail(emailLower, subjectLower, attachments) {
        const upsIndicators = [
            'ups', 'united parcel', 'ups.com', 'ups.co.il',
            'quantum', 'neopharmgroup.com' // הוספתי neopharmgroup לטסטים
        ];
        
        return upsIndicators.some(keyword => 
            emailLower.includes(keyword) || subjectLower.includes(keyword)
        );
    }

    isUpsBulkStatusReport(subjectLower) {
        // דוגמה: "UPS Import Shipment Status Report"
        return subjectLower.includes('ups import shipment status report');
    }

    isUpsIndividualNotification(subjectLower) {
        // דוגמה: "UPS Import notification - Tracking # 1Z8E615X6702081284 - Pro-Forma Invoice # 3625971"
        const hasTrackingPattern = subjectLower.includes('ups import notification') && 
                                  subjectLower.includes('tracking #');
        
        const hasProFormaPattern = subjectLower.includes('pro-forma invoice #');
        
        return hasTrackingPattern || hasProFormaPattern;
    }

    isDhlEmail(emailLower, subjectLower) {
        const dhlIndicators = [
            'dhl', 'dalsey', 'dhl.com', 'dhl.co.il'
        ];
        
        return dhlIndicators.some(keyword => 
            emailLower.includes(keyword) || subjectLower.includes(keyword)
        );
    }

    hasShippingKeywords(searchText) {
        const shippingKeywords = [
            'tracking', 'shipment', 'delivery', 'awb', 'bill of lading',
            'invoice', 'customs', 'freight', 'cargo', 'container', 'manifest',
            'import', 'export', 'משלוח', 'מעקב', 'חבילה', 'יבוא', 'יצוא'
        ];
        
        return shippingKeywords.some(keyword => 
            searchText.includes(keyword.toLowerCase())
        );
    }

    // פונקציות ניהול רשימת מיילים מתקדמות
    
    // בדיקה האם מייל קיים ברשימה (תמיכה בדומיינים ושמות מלאים)
    isEmailInAutomationList(email) {
        const emailLower = email.toLowerCase();
        
        // בדיקה ישירה
        if (this.automationEmails.includes(emailLower)) {
            return { inList: true, matchType: 'exact', match: emailLower };
        }
        
        // בדיקה לפי דומיין
        const domain = emailLower.split('@')[1];
        if (domain) {
            const domainMatches = this.automationEmails.filter(automationEmail => {
                return automationEmail.includes(domain) || automationEmail.endsWith(domain);
            });
            
            if (domainMatches.length > 0) {
                return { inList: true, matchType: 'domain', match: domainMatches[0], domain };
            }
        }
        
        return { inList: false, matchType: 'none', match: null };
    }

    // הוספת מייל חכמה (עם validation)
    addEmailToAutomationSmart(email) {
        if (!email || typeof email !== 'string' || !email.includes('@')) {
            return { success: false, error: 'כתובת מייל לא תקינה' };
        }
        
        const emailLower = email.toLowerCase();
        const existingCheck = this.isEmailInAutomationList(emailLower);
        
        if (existingCheck.inList) {
            return { 
                success: false, 
                error: 'כתובת המייל כבר קיימת ברשימה',
                existingMatch: existingCheck 
            };
        }
        
        this.automationEmails.push(emailLower);
        console.log(`✅ מייל ${email} נוסף לרשימת האוטומציה`);
        
        return { 
            success: true, 
            message: 'כתובת המייל נוספה בהצלחה',
            email: emailLower 
        };
    }

    // הסרת מייל חכמה
    removeEmailFromAutomationSmart(email) {
        if (!email || typeof email !== 'string') {
            return { success: false, error: 'כתובת מייל לא תקינה' };
        }
        
        const emailLower = email.toLowerCase();
        const index = this.automationEmails.indexOf(emailLower);
        
        if (index === -1) {
            return { 
                success: false, 
                error: 'כתובת המייל לא נמצאה ברשימה' 
            };
        }
        
        this.automationEmails.splice(index, 1);
        console.log(`🗑️ מייל ${email} הוסר מרשימת האוטומציה`);
        
        return { 
            success: true, 
            message: 'כתובת המייל הוסרה בהצלחה',
            email: emailLower 
        };
    }

    // קבלת סטטיסטיקות מיילים
    getEmailListStatistics() {
        const emailsByDomain = {};
        const testEmails = [];
        const productionEmails = [];
        
        this.automationEmails.forEach(email => {
            const domain = email.split('@')[1];
            if (domain) {
                emailsByDomain[domain] = (emailsByDomain[domain] || 0) + 1;
            }
            
            if (email.includes('test') || email.includes('neopharmgroup.com')) {
                testEmails.push(email);
            } else {
                productionEmails.push(email);
            }
        });
        
        return {
            totalEmails: this.automationEmails.length,
            emailsByDomain,
            testEmails: testEmails.length,
            productionEmails: productionEmails.length,
            testEmailsList: testEmails,
            productionEmailsList: productionEmails
        };
    }

    // ייצוא רשימת מיילים לקובץ
    exportEmailList() {
        return {
            exportedAt: new Date().toISOString(),
            totalEmails: this.automationEmails.length,
            emails: [...this.automationEmails].sort(), // מעתק ממוין
            statistics: this.getEmailListStatistics()
        };
    }

    // ייבוא רשימת מיילים מקובץ
    importEmailList(emailList) {
        if (!Array.isArray(emailList)) {
            return { success: false, error: 'רשימת המיילים חייבת להיות מערך' };
        }
        
        const results = {
            success: true,
            added: [],
            skipped: [],
            errors: []
        };
        
        emailList.forEach(email => {
            const addResult = this.addEmailToAutomationSmart(email);
            if (addResult.success) {
                results.added.push(email);
            } else {
                results.skipped.push({ email, reason: addResult.error });
            }
        });
        
        return results;
    }
}

module.exports = new WebhookService();