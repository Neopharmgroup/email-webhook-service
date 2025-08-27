require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const https = require('https');

const app = express();

// פתרון זמני לשגיאת SSL עם webhook.site
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

// CORS הגדרות
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json());

// הגדרות סביבה
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const TENANT_ID = process.env.TENANT_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const REDIRECT_URI = process.env.REDIRECT_URI;
const WEBHOOK_SITE_URL = process.env.WEBHOOK_SITE_URL;

// הגדרות MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'email-webhooks';

// משתנים גלובליים לניהול tokens ו-subscriptions
let currentAccessToken = null;
let currentRefreshToken = null;
let subscriptions = new Map();
let refreshIntervals = new Map();

// משתנה למונגו DB
let mongoClient = null;
let db = null;

// התחברות למונגו DB
async function connectToMongoDB() {
    try {
        console.log('🔄 מתחבר למונגו DB...');
        mongoClient = new MongoClient(MONGODB_URI);
        await mongoClient.connect();
        db = mongoClient.db(MONGODB_DB_NAME);
        
        // יצירת אינדקסים
        await db.collection('tracked_emails').createIndex({ 'email': 1 }, { unique: true });
        await db.collection('tracked_emails').createIndex({ 'isActive': 1 });
        await db.collection('subscriptions').createIndex({ 'subscriptionId': 1 }, { unique: true });
        await db.collection('webhook_notifications').createIndex({ 'receivedAt': -1 });
        await db.collection('webhook_notifications').createIndex({ 'senderEmail': 1 });
        
        console.log('✅ התחברות למונגו DB הצליחה!');
        return true;
    } catch (error) {
        console.error('❌ שגיאה בהתחברות למונגו DB:', error.message);
        return false;
    }
}

// בדיקת משתני סביבה
function validateEnvironmentVariables() {
    const required = { CLIENT_ID, CLIENT_SECRET, TENANT_ID, WEBHOOK_URL, REDIRECT_URI, MONGODB_URI };
    const missing = Object.entries(required)
        .filter(([key, value]) => !value)
        .map(([key]) => key);
    
    if (missing.length > 0) {
        console.error('❌ חסרים משתני סביבה:', missing.join(', '));
        return false;
    }
    console.log('✅ כל משתני הסביבה מוגדרים כראוי');
    return true;
}

function isWebhookSiteUrl(url) {
    return /webhook\.site/i.test(url);
}

// פונקציה לחידוש access token
async function refreshAccessToken() {
    if (!currentRefreshToken) {
        console.error('❌ אין refresh token זמין');
        return null;
    }

    try {
        console.log('🔄 מחדש access token...');
        
        const response = await axios.post(
            `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
            new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                refresh_token: currentRefreshToken,
                grant_type: 'refresh_token',
                scope: 'https://graph.microsoft.com/Mail.Read offline_access'
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        
        currentAccessToken = response.data.access_token;
        if (response.data.refresh_token) {
            currentRefreshToken = response.data.refresh_token;
        }
        
        console.log('✅ Token חודש בהצלחה');
        return currentAccessToken;
    } catch (error) {
        console.error('❌ שגיאה בחידוש token:', error.response?.data || error.message);
        return null;
    }
}

// פונקציה לקבלת פרטי מייל מ-Microsoft Graph
async function getEmailDetails(messageId, accessToken) {
    try {
        const response = await axios.get(
            `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );

        const message = response.data;
        return {
            from: message.from?.emailAddress?.address || 'unknown',
            subject: message.subject || 'No Subject',
            receivedDateTime: message.receivedDateTime,
            bodyPreview: message.bodyPreview || '',
            isRead: message.isRead || false,
            hasAttachments: message.hasAttachments || false,
            importance: message.importance || 'normal',
            toRecipients: message.toRecipients?.map(r => r.emailAddress?.address) || [],
            ccRecipients: message.ccRecipients?.map(r => r.emailAddress?.address) || []
        };
    } catch (error) {
        console.error('❌ שגיאה בקבלת פרטי מייל:', error.message);
        return null;
    }
}

// פונקציה ליצירת subscription
async function createEmailSubscription(accessToken, userEmail = 'me') {
    const maxExpirationTime = new Date(Date.now() + (4230 * 60 * 1000)).toISOString();
    const notificationUrl = WEBHOOK_URL;

    const subscription = {
        changeType: 'created',
        notificationUrl: notificationUrl,
        resource: `${userEmail}/mailFolders('Inbox')/messages`,
        expirationDateTime: maxExpirationTime,
        clientState: 'EmailWebhookSubscription',
        latestSupportedTlsVersion: 'v1_2'
    };

    try {
        console.log('🔄 יוצר subscription למיילים...');
        
        const response = await axios.post(
            'https://graph.microsoft.com/v1.0/subscriptions',
            subscription,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        const subscriptionData = {
            subscriptionId: response.data.id,
            userEmail: userEmail,
            resource: response.data.resource,
            expirationDateTime: response.data.expirationDateTime,
            status: 'active',
            createdAt: new Date(),
            lastRenewed: new Date()
        };

        // שמירה במונגו
        if (db) {
            await db.collection('subscriptions').insertOne(subscriptionData);
        }

        subscriptions.set(response.data.id, subscriptionData);
        
        console.log('✅ Email subscription נוצרה בהצלחה!');
        console.log('📧 Subscription ID:', response.data.id);
        
        scheduleSubscriptionRenewal(response.data.id, response.data.expirationDateTime);
        
        return response.data;
    } catch (error) {
        console.error('❌ שגיאה ביצירת Subscription:', JSON.stringify(error.response?.data, null, 2));
        throw error;
    }
}

// פונקציה לחידוש subscription
async function renewSubscription(subscriptionId) {
    try {
        const freshToken = await refreshAccessToken();
        if (!freshToken) {
            throw new Error('לא ניתן לחדש token');
        }

        console.log('🔄 מחדש subscription:', subscriptionId);
        
        const newExpirationTime = new Date(Date.now() + (4230 * 60 * 1000)).toISOString();
        
        const response = await axios.patch(
            `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
            {
                expirationDateTime: newExpirationTime
            },
            {
                headers: {
                    'Authorization': `Bearer ${freshToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        // עדכון במונגו ובמפה
        if (db) {
            await db.collection('subscriptions').updateOne(
                { subscriptionId: subscriptionId },
                { 
                    $set: { 
                        expirationDateTime: response.data.expirationDateTime,
                        lastRenewed: new Date(),
                        status: 'active'
                    }
                }
            );
        }

        const subscriptionData = subscriptions.get(subscriptionId);
        if (subscriptionData) {
            subscriptionData.expirationDateTime = response.data.expirationDateTime;
            subscriptionData.lastRenewed = new Date();
        }
        
        console.log('✅ Subscription חודש בהצלחה!');
        
        scheduleSubscriptionRenewal(subscriptionId, response.data.expirationDateTime);
        
        return response.data;
    } catch (error) {
        console.error('❌ שגיאה בחידוש subscription:', error.response?.data || error.message);
        
        // במקרה של כשל, נסה ליצור subscription חדש
        try {
            await createEmailSubscription(currentAccessToken);
        } catch (createError) {
            console.error('❌ גם יצירת subscription חדש נכשלה');
        }
        
        throw error;
    }
}

// מחיקת subscription
async function deleteSubscription(subscriptionId) {
    try {
        const freshToken = await refreshAccessToken();
        if (!freshToken) {
            throw new Error('לא ניתן לחדש token');
        }

        await axios.delete(
            `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
            {
                headers: {
                    'Authorization': `Bearer ${freshToken}`
                }
            }
        );
        
        // מחיקה מהמונגו ומהמפה
        if (db) {
            await db.collection('subscriptions').updateOne(
                { subscriptionId: subscriptionId },
                { $set: { status: 'deleted', deletedAt: new Date() } }
            );
        }

        subscriptions.delete(subscriptionId);
        
        if (refreshIntervals.has(subscriptionId)) {
            clearTimeout(refreshIntervals.get(subscriptionId));
            refreshIntervals.delete(subscriptionId);
        }
        
        console.log('✅ Subscription נמחק בהצלחה:', subscriptionId);
    } catch (error) {
        console.error('❌ שגיאה במחיקת subscription:', error.response?.data || error.message);
        throw error;
    }
}

// תזמון חידוש subscription
function scheduleSubscriptionRenewal(subscriptionId, expirationDateTime) {
    // ניקוי interval קודם אם קיים
    if (refreshIntervals.has(subscriptionId)) {
        clearTimeout(refreshIntervals.get(subscriptionId));
    }
    
    const expirationTime = new Date(expirationDateTime).getTime();
    const currentTime = Date.now();
    const timeUntilExpiration = expirationTime - currentTime;
    
    const renewalTime = timeUntilExpiration - (30 * 60 * 1000); // 30 דקות לפני פקיעה
    
    if (renewalTime > 0) {
        console.log(`⏰ Subscription ${subscriptionId} יחודש בעוד ${Math.round(renewalTime / 60000)} דקות`);
        
        const interval = setTimeout(async () => {
            try {
                await renewSubscription(subscriptionId);
            } catch (error) {
                console.error('❌ כשל בחידוש אוטומטי של subscription:', subscriptionId);
            }
        }, renewalTime);
        
        refreshIntervals.set(subscriptionId, interval);
    } else {
        console.log('⚠️ Subscription פג תוקף - יחודש מיד');
        renewSubscription(subscriptionId);
    }
}

// פונקציה משודרגת לשליחת webhook
async function sendToWebhookSite(webhookData) {
    if (!WEBHOOK_SITE_URL) {
        console.log('⚠️ WEBHOOK_SITE_URL לא מוגדר');
        return false;
    }

    try {
        const axiosConfig = {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Microsoft-Graph-Email-Webhook/1.0'
            },
            timeout: 15000, // 15 שניות timeout
            validateStatus: function (status) {
                return status >= 200 && status < 300;
            }
        };

        // הגדרה מיוחדת לHTTPS עם SSL bypass
        if (WEBHOOK_SITE_URL.startsWith('https://')) {
            axiosConfig.httpsAgent = new https.Agent({
                rejectUnauthorized: false,
                keepAlive: true,
                timeout: 10000
            });
        }

        console.log('📤 שולח webhook ל:', WEBHOOK_SITE_URL);
        const response = await axios.post(WEBHOOK_SITE_URL, webhookData, axiosConfig);
        
        console.log('✅ Webhook נשלח בהצלחה!', {
            status: response.status,
            statusText: response.statusText
        });
        
        return true;

    } catch (error) {
        console.error('❌ שגיאה בשליחת webhook:', {
            message: error.message,
            code: error.code,
            status: error.response?.status,
            url: WEBHOOK_SITE_URL
        });
        
        return false;
    }
}

// פונקציה לשמירת התראת webhook עם בדיקת כתובת מעוקבת
async function saveWebhookNotification(notificationData) {
    if (!db) {
        console.error('❌ אין חיבור למונגו DB');
        return null;
    }

    try {
        console.log('🔍 מחפש כתובות מעקב פעילות...');
        
        // בדיקה אם יש כתובות מעקב פעילות
        const trackedEmails = await db.collection('tracked_emails').find({ isActive: true }).toArray();
        
        if (trackedEmails.length === 0) {
            console.log('⚠️ אין כתובות מעקב פעילות - מתעלם מההתראה');
            return null;
        }

        console.log(`📧 נמצאו ${trackedEmails.length} כתובות במעקב:`, trackedEmails.map(e => e.email));

        // קבלת פרטי המייל מ-Microsoft Graph
        let emailDetails = null;
        if (currentAccessToken && notificationData.messageId !== 'unknown') {
            console.log('🔄 מקבל פרטי מייל מ-Microsoft Graph...');
            emailDetails = await getEmailDetails(notificationData.messageId, currentAccessToken);
        }

        if (!emailDetails) {
            console.log('⚠️ לא ניתן לקבל פרטי מייל - מתעלם');
            return null;
        }

        // בדיקה אם המייל הגיע לכתובת מעוקבת
        const senderEmail = emailDetails.from.toLowerCase();
        const allRecipients = [
            ...emailDetails.toRecipients,
            ...emailDetails.ccRecipients
        ].map(email => email.toLowerCase());
        
        console.log(`📨 מייל מ: ${senderEmail}`);
        console.log(`📬 אל: ${allRecipients.join(', ')}`);
        
        // בדיקה אם אחד מהנמענים נמצא ברשימת המעקב
        const trackedRecipient = trackedEmails.find(tracked => 
            allRecipients.includes(tracked.email.toLowerCase())
        );

        if (!trackedRecipient) {
            console.log(`⚠️ מייל לא הגיע לכתובת מעוקבת - מתעלם`);
            console.log('📋 נמענים:', allRecipients);
            console.log('📋 כתובות במעקב:', trackedEmails.map(e => e.email));
            return null;
        }

        console.log(`🎯 ✅ מייל הגיע לכתובת מעוקבת: ${trackedRecipient.email}`);
        console.log(`📧 מהשולח: ${senderEmail} | נושא: ${emailDetails.subject}`);

        // שמירת ההתראה עם פרטי המייל
        const webhookDocument = {
            subscriptionId: notificationData.subscriptionId,
            resource: notificationData.resource,
            changeType: notificationData.changeType,
            clientState: notificationData.clientState,
            receivedAt: new Date(),
            messageId: notificationData.messageId,
            processed: true,
            // פרטי המייל
            senderEmail: senderEmail,
            trackedRecipientEmail: trackedRecipient.email, // הכתובת המעוקבת שקיבלה את המייל
            subject: emailDetails.subject,
            receivedDateTime: emailDetails.receivedDateTime,
            bodyPreview: emailDetails.bodyPreview,
            isRead: emailDetails.isRead,
            hasAttachments: emailDetails.hasAttachments,
            importance: emailDetails.importance,
            toRecipients: emailDetails.toRecipients,
            ccRecipients: emailDetails.ccRecipients
        };

        const result = await db.collection('webhook_notifications').insertOne(webhookDocument);
        console.log('✅ התראת webhook נשמרה במונגו:', result.insertedId);
        
        // עדכון סטטיסטיקות כתובת המעקב
        await updateTrackedEmailStats(trackedRecipient.email);
        
        // שליחת webhook
        const webhookPayload = {
            type: 'email_received_notification',
            timestamp: new Date().toISOString(),
            emailData: {
                from: senderEmail,
                to_tracked_address: trackedRecipient.email, // הכתובת המעוקבת שקיבלה
                subject: emailDetails.subject,
                receivedDateTime: emailDetails.receivedDateTime,
                bodyPreview: emailDetails.bodyPreview,
                isRead: emailDetails.isRead,
                hasAttachments: emailDetails.hasAttachments,
                importance: emailDetails.importance,
                allRecipients: allRecipients
            },
            source: 'Microsoft Graph Email Webhook - TO Tracking',
            processed_at: new Date().toLocaleString('he-IL'),
            webhookId: result.insertedId
        };

        // שליחה ל-webhook.site
        const webhookSent = await sendToWebhookSite(webhookPayload);
        
        // עדכון המסמך בבסיס הנתונים עם סטטוס השליחה
        await db.collection('webhook_notifications').updateOne(
            { _id: result.insertedId },
            { $set: { webhookSent: webhookSent, webhookSentAt: new Date() } }
        );
        
        return result.insertedId;
    } catch (error) {
        console.error('❌ שגיאה בשמירת התראת webhook:', error.message);
        return null;
    }
}

// עדכון סטטיסטיקות כתובת מעקב ספציפית (כתובת שקיבלה מייל)
async function updateTrackedEmailStats(recipientEmail) {
    if (!db) return;

    try {
        const result = await db.collection('tracked_emails').updateOne(
            { email: recipientEmail, isActive: true },
            { 
                $inc: { totalEmailsReceived: 1 },
                $set: { 
                    lastEmailReceived: new Date(),
                    updatedAt: new Date()
                }
            }
        );
        
        if (result.modifiedCount > 0) {
            console.log('📊 עדכון סטטיסטיקות עבור כתובת שקיבלה מייל:', recipientEmail);
        }
    } catch (error) {
        console.error('❌ שגיאה בעדכון סטטיסטיקות כתובת מעקב:', error.message);
    }
}

// ========== ENDPOINTS ==========

// Endpoint להתחברות משתמש
app.get('/auth/login', (req, res) => {
    if (!validateEnvironmentVariables()) {
        return res.status(500).json({ 
            error: 'חסרים משתני סביבה',
            note: 'בדקי את קובץ ה-.env'
        });
    }

    const authUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?` +
        `client_id=${CLIENT_ID}&` +
        `response_type=code&` +
        `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
        `scope=${encodeURIComponent('https://graph.microsoft.com/Mail.Read offline_access')}&` +
        `response_mode=query`;

    console.log('🔗 לחצי על הקישור הזה להתחברות:');
    console.log(authUrl);

    let note = 'ההתראות יגיעו ל-webhook.site שלך ויתחדשו אוטומטי';
    if (isWebhookSiteUrl(WEBHOOK_URL)) {
        note = '⚠️ webhook.site לא נתמך על ידי Microsoft Graph Push Notifications. השתמשי ב-ngrok, localhost.run או שרת משלך.';
    }

    res.json({
        message: 'לחצי על הקישור להתחברות',
        authUrl: authUrl,
        webhookUrl: WEBHOOK_URL,
        note
    });
});

// Callback עבור Authorization Code
app.get('/auth/callback', async (req, res) => {
    const { code, error, error_description } = req.query;
    
    if (error) {
        return res.status(400).json({ 
            error: error,
            description: error_description
        });
    }
    
    if (!code) {
        return res.status(400).json({ error: 'חסר קוד אימות' });
    }
    
    try {
        const tokenResponse = await axios.post(
            `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
            new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code: code,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code',
                scope: 'https://graph.microsoft.com/Mail.Read offline_access'
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        
        currentAccessToken = tokenResponse.data.access_token;
        currentRefreshToken = tokenResponse.data.refresh_token;
        
        console.log('✅ התחברות הצליחה!');
        
        const subscription = await createEmailSubscription(currentAccessToken);

        res.json({ 
            message: '🎉 הכל מוכן! המערכת תעקוב אחר מיילים מכתובות מוגדרות',
            subscriptionId: subscription.id,
            expiresAt: subscription.expirationDateTime,
            autoRenewal: true
        });
    } catch (error) {
        console.error('❌ שגיאה בתהליך:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'שגיאה בתהליך',
            details: error.response?.data || error.message
        });
    }
});

// ✨ ENDPOINT עיקרי לקבלת התראות מ-Microsoft Graph ✨
app.post('/webhooks/microsoft-graph', async (req, res) => {
    console.log('\n🚨 ======== התראת מייל חדשה ========');
    console.log('📨 קיבלנו בקשה ב-webhook endpoint');
    console.log('⏰ זמן:', new Date().toLocaleString('he-IL'));
    
    const { validationToken } = req.query;
    
    // Microsoft Graph שולח validation token בפעם הראשונה
    if (validationToken) {
        console.log('🔍 מאמת webhook עם Microsoft Graph...');
        console.log('✅ Validation token:', validationToken);
        console.log('📤 מחזיר validation token ל-Microsoft Graph');
        return res.status(200).type('text/plain').send(validationToken);
    }
    
    // עיבוד התראות אמיתיות על מיילים חדשים
    const notifications = req.body?.value || [];
    console.log(`📬 התקבלו ${notifications.length} התראות מייל חדשות!`);
    
    for (let i = 0; i < notifications.length; i++) {
        const notification = notifications[i];
        const messageId = notification.resource.split('/Messages/')[1] || 'unknown';
        
        const notificationData = {
            subscriptionId: notification.subscriptionId,
            resource: notification.resource,
            changeType: notification.changeType,
            clientState: notification.clientState,
            timestamp: new Date().toLocaleString('he-IL'),
            receivedAt: new Date(),
            messageId: messageId
        };
        
        console.log(`\n📧 === עיבוד מייל ${i + 1} ===`);
        console.log('📋 פרטי התראה:', notificationData);
        
        // שמירת ההתראה (עם בדיקת כתובות מעקב ושליחת webhook)
        const savedId = await saveWebhookNotification(notificationData);
        
        if (savedId) {
            console.log(`✅ מייל ${i + 1} נשמר ונשלח בהצלחה! DB ID: ${savedId}`);
        } else {
            console.log(`⚠️ מייל ${i + 1} לא עובד בדיקות המעקב - לא נשמר`);
        }
    }
    
    console.log('🎯 ======== סיום עיבוד התראות ========\n');
    res.status(202).send('OK');
});

// ENDPOINT נוסף ל-GET (לבדיקה)
app.get('/webhooks/microsoft-graph', (req, res) => {
    const { validationToken } = req.query;
    
    if (validationToken) {
        return res.status(200).type('text/plain').send(validationToken);
    }
    
    res.json({ 
        message: 'Webhook endpoint פועל',
        timestamp: new Date().toLocaleString('he-IL')
    });
});

// ========== כתובות מעקב ENDPOINTS ==========

// קבלת כל הכתובות במעקב
app.get('/api/tracked-emails', async (req, res) => {
    if (!db) {
        return res.status(500).json({ error: 'אין חיבור למונגו DB' });
    }

    try {
        const trackedEmails = await db.collection('tracked_emails')
            .find({})
            .sort({ addedAt: -1 })
            .toArray();

        res.json({
            trackedEmails: trackedEmails,
            totalCount: trackedEmails.length
        });
    } catch (error) {
        console.error('❌ שגיאה בקבלת כתובות מעקב:', error.message);
        res.status(500).json({ error: 'שגיאה בקבלת כתובות מעקב' });
    }
});

// הוספת כתובת מייל למעקב
app.post('/api/tracked-emails', async (req, res) => {
    if (!db) {
        return res.status(500).json({ error: 'אין חיבור למונגו DB' });
    }

    try {
        const { email, description, isActive = true } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'כתובת מייל חובה' });
        }

        // בדיקת פורמט מייל
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'כתובת מייל לא תקינה' });
        }

        // בדיקה שהכתובת לא קיימת כבר
        const existingEmail = await db.collection('tracked_emails').findOne({ email: email.toLowerCase() });
        if (existingEmail) {
            return res.status(409).json({ error: 'כתובת מייל כבר קיימת במעקב' });
        }

        const trackedEmail = {
            email: email.toLowerCase(),
            description: description || '',
            isActive: isActive,
            addedAt: new Date(),
            lastEmailReceived: null,
            totalEmailsReceived: 0,
            createdBy: 'system',
            updatedAt: new Date()
        };

        const result = await db.collection('tracked_emails').insertOne(trackedEmail);
        
        console.log('✅ כתובת מייל נוספה למעקב:', email);
        res.status(201).json({
            message: 'כתובת מייל נוספה בהצלחה למעקב',
            trackedEmail: { ...trackedEmail, _id: result.insertedId }
        });
    } catch (error) {
        console.error('❌ שגיאה בהוספת כתובת למעקב:', error.message);
        res.status(500).json({ error: 'שגיאה בהוספת כתובת למעקב' });
    }
});

// עדכון כתובת מייל במעקב
app.put('/api/tracked-emails/:id', async (req, res) => {
    if (!db) {
        return res.status(500).json({ error: 'אין חיבור למונגו DB' });
    }

    try {
        const { id } = req.params;
        const { email, description, isActive } = req.body;

        const updateData = {};
        if (email !== undefined) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ error: 'כתובת מייל לא תקינה' });
            }
            updateData.email = email.toLowerCase();
        }
        if (description !== undefined) updateData.description = description;
        if (isActive !== undefined) updateData.isActive = isActive;
        
        updateData.updatedAt = new Date();

        const result = await db.collection('tracked_emails').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'כתובת מייל לא נמצאה' });
        }

        res.json({ message: 'כתובת מייל עודכנה בהצלחה' });
    } catch (error) {
        console.error('❌ שגיאה בעדכון כתובת מייל:', error.message);
        res.status(500).json({ error: 'שגיאה בעדכון כתובת מייל' });
    }
});

// מחיקת כתובת מייל מהמעקב
app.delete('/api/tracked-emails/:id', async (req, res) => {
    if (!db) {
        return res.status(500).json({ error: 'אין חיבור למונגו DB' });
    }

    try {
        const { id } = req.params;

        const result = await db.collection('tracked_emails').deleteOne(
            { _id: new ObjectId(id) }
        );

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'כתובת מייל לא נמצאה' });
        }

        res.json({ message: 'כתובת מייל הוסרה בהצלחה מהמעקב' });
    } catch (error) {
        console.error('❌ שגיאה במחיקת כתובת מייל:', error.message);
        res.status(500).json({ error: 'שגיאה במחיקת כתובת מייל' });
    }
});

// סטטיסטיקות כתובות במעקב
app.get('/api/tracked-emails/stats', async (req, res) => {
    if (!db) {
        return res.status(500).json({ error: 'אין חיבור למונגו DB' });
    }

    try {
        const emailStats = await db.collection('tracked_emails').aggregate([
            {
                $group: {
                    _id: null,
                    totalTracked: { $sum: 1 },
                    activeTracked: { $sum: { $cond: ['$isActive', 1, 0] } },
                    inactiveTracked: { $sum: { $cond: ['$isActive', 0, 1] } },
                    totalEmailsReceived: { $sum: '$totalEmailsReceived' }
                }
            }
        ]).toArray();

        const webhookStats = await db.collection('webhook_notifications').countDocuments();

        const result = {
            general: emailStats[0] || {
                totalTracked: 0,
                activeTracked: 0,
                inactiveTracked: 0,
                totalEmailsReceived: 0
            },
            totalWebhookNotifications: webhookStats
        };

        res.json(result);
    } catch (error) {
        console.error('❌ שגיאה בקבלת סטטיסטיקות:', error.message);
        res.status(500).json({ error: 'שגיאה בקבלת סטטיסטיקות' });
    }
});

// ========== התראות ומיילים ENDPOINTS ==========

// קבלת התראות שנשמרו
app.get('/api/webhook-notifications', async (req, res) => {
    if (!db) {
        return res.status(500).json({ error: 'אין חיבור למונגו DB' });
    }

    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const notifications = await db.collection('webhook_notifications')
            .find({})
            .sort({ receivedAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const totalCount = await db.collection('webhook_notifications').countDocuments();

        res.json({
            notifications: notifications,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalCount / limit),
                totalCount: totalCount
            }
        });
    } catch (error) {
        console.error('❌ שגיאה בקבלת התראות:', error.message);
        res.status(500).json({ error: 'שגיאה בקבלת התראות' });
    }
});

// חיפוש התראות לפי שולח
app.get('/api/webhook-notifications/search', async (req, res) => {
    if (!db) {
        return res.status(500).json({ error: 'אין חיבור למונגו DB' });
    }

    try {
        const { sender, subject } = req.query;
        const filter = {};

        if (sender) {
            filter.senderEmail = { $regex: sender, $options: 'i' };
        }
        if (subject) {
            filter.subject = { $regex: subject, $options: 'i' };
        }

        const notifications = await db.collection('webhook_notifications')
            .find(filter)
            .sort({ receivedAt: -1 })
            .limit(50)
            .toArray();

        res.json({
            notifications: notifications,
            count: notifications.length
        });
    } catch (error) {
        console.error('❌ שגיאה בחיפוש התראות:', error.message);
        res.status(500).json({ error: 'שגיאה בחיפוש התראות' });
    }
});

// ========== ניהול SUBSCRIPTIONS ENDPOINTS ==========

// קבלת כל ה-subscriptions
app.get('/api/subscriptions', async (req, res) => {
    if (!db) {
        return res.status(500).json({ error: 'אין חיבור למונגו DB' });
    }

    try {
        const subs = await db.collection('subscriptions')
            .find({ status: { $ne: 'deleted' } })
            .sort({ createdAt: -1 })
            .toArray();

        res.json({
            subscriptions: subs,
            activeCount: subs.filter(s => s.status === 'active').length
        });
    } catch (error) {
        res.status(500).json({ error: 'שגיאה בקבלת subscriptions' });
    }
});

// חידוש subscription
app.post('/api/subscriptions/:id/renew', async (req, res) => {
    try {
        const { id } = req.params;
        await renewSubscription(id);
        res.json({ message: 'Subscription חודש בהצלחה' });
    } catch (error) {
        res.status(500).json({ error: 'שגיאה בחידוש subscription' });
    }
});

// מחיקת subscription
app.delete('/api/subscriptions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await deleteSubscription(id);
        res.json({ message: 'Subscription נמחק בהצלחה' });
    } catch (error) {
        res.status(500).json({ error: 'שגיאה במחיקת subscription' });
    }
});

// endpoint לבדיקת חיבור ל-webhook.site
app.post('/api/test-webhook', async (req, res) => {
    if (!WEBHOOK_SITE_URL) {
        return res.status(400).json({ error: 'WEBHOOK_SITE_URL לא מוגדר' });
    }

    try {
        const testData = {
            type: 'test_notification',
            timestamp: new Date().toISOString(),
            message: 'זוהי בדיקת חיבור מהשרת',
            source: 'Manual Test',
            testId: Date.now()
        };

        const webhookSent = await sendToWebhookSite(testData);

        res.json({
            success: webhookSent,
            message: webhookSent ? 'בדיקת webhook.site הצליחה!' : 'בדיקת webhook.site נכשלה',
            webhookUrl: WEBHOOK_SITE_URL,
            testData: testData
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            code: error.code,
            webhookUrl: WEBHOOK_SITE_URL
        });
    }
});

// Endpoint לבדיקת מצב השרות
app.get('/health', (req, res) => {
    const activeSubscriptions = Array.from(subscriptions.values()).filter(s => s.status === 'active');
    
    res.json({ 
        status: 'השרת רץ בהצלחה', 
        timestamp: new Date().toLocaleString('he-IL'),
        webhookUrl: WEBHOOK_URL,
        webhookSiteUrl: WEBHOOK_SITE_URL,
        hasActiveSubscription: activeSubscriptions.length > 0,
        activeSubscriptions: activeSubscriptions.length,
        totalSubscriptions: subscriptions.size,
        mongoDbConnected: !!db,
        hasAccessToken: !!currentAccessToken,
        hasRefreshToken: !!currentRefreshToken,
        environment: {
            hasClientId: !!CLIENT_ID,
            hasTenantId: !!TENANT_ID,
            hasClientSecret: !!CLIENT_SECRET,
            hasMongoUri: !!MONGODB_URI,
            hasWebhookUrl: !!WEBHOOK_URL,
            hasWebhookSiteUrl: !!WEBHOOK_SITE_URL
        }
    });
});

// הרצת השרת
const PORT = process.env.PORT || 5000;

async function startServer() {
    const mongoConnected = await connectToMongoDB();
    
    if (!mongoConnected) {
        console.error('❌ לא ניתן להתחבר למונגו DB');
        process.exit(1);
    }

    // טעינת subscriptions קיימים מהמונגו
    try {
        const existingSubscriptions = await db.collection('subscriptions')
            .find({ status: 'active' })
            .toArray();
        
        for (const sub of existingSubscriptions) {
            subscriptions.set(sub.subscriptionId, sub);
            scheduleSubscriptionRenewal(sub.subscriptionId, sub.expirationDateTime);
        }
        
        console.log(`📧 נטענו ${existingSubscriptions.length} subscriptions קיימים`);
    } catch (error) {
        console.error('❌ שגיאה בטעינת subscriptions:', error.message);
    }

    app.listen(PORT, () => {
        console.log(`🚀 השרת רץ על פורט ${PORT}`);
        console.log(`📍 ההתראות יגיעו ל: ${WEBHOOK_URL}`);
        console.log(`🌐 התחברות: http://localhost:${PORT}/auth/login`);
        console.log(`📊 סטטוס: http://localhost:${PORT}/health`);
        console.log(`📧 ניהול כתובות: http://localhost:${PORT}/api/tracked-emails`);
        console.log(`📨 התראות: http://localhost:${PORT}/api/webhook-notifications`);
        console.log(`🧪 בדיקת webhook: http://localhost:${PORT}/api/test-webhook`);
        
        if (WEBHOOK_SITE_URL) {
            console.log(`📱 Webhook.site: ${WEBHOOK_SITE_URL}`);
        }
        
        console.log('\n📋 שלבים הבאים:');
        console.log('1. התחבר: GET /auth/login');
        console.log('2. בדוק שיש subscriptions: GET /api/subscriptions');
        console.log('3. בדוק כתובות מעקב: GET /api/tracked-emails');
        console.log('4. בדוק webhook: POST /api/test-webhook');
        console.log('5. שלח מייל ממייל מעוקב');
        console.log('6. צפה בהתראות: GET /api/webhook-notifications');
        
        if (!validateEnvironmentVariables()) {
            console.log('\n⚠️  עדכן את קובץ ה-.env לפני שתמשיך!');
        }
    });
}

// סגירה נכונה של חיבור מונגו
process.on('SIGINT', async () => {
    console.log('\n🔄 סוגר את השרת...');
    
    // ניקוי intervals
    refreshIntervals.forEach(interval => clearTimeout(interval));
    
    if (mongoClient) {
        await mongoClient.close();
        console.log('✅ חיבור מונגו DB נסגר');
    }
    process.exit(0);
});

startServer();