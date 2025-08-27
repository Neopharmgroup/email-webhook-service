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

// משתנים גלובליים לניהול subscriptions
let subscriptions = new Map();
let refreshIntervals = new Map();

// משתנה למונגו DB
let mongoClient = null;
let db = null;

// התחברות למונגו DB
async function connectToMongoDB() {
    try {
        console.log(' מתחבר למונגו DB...');
        mongoClient = new MongoClient(MONGODB_URI);
        await mongoClient.connect();
        db = mongoClient.db(MONGODB_DB_NAME);
        
        // יצירת אינדקסים מעודכנים
        await db.collection('tracked_emails').createIndex({ 'email': 1 }, { unique: true });
        await db.collection('tracked_emails').createIndex({ 'isActive': 1 });
        await db.collection('tracked_emails').createIndex({ 'hasAuthorization': 1 });
        await db.collection('tracked_emails').createIndex({ 'subscriptionStatus': 1 });
        await db.collection('subscriptions').createIndex({ 'subscriptionId': 1 }, { unique: true });
        await db.collection('subscriptions').createIndex({ 'userEmail': 1 });
        await db.collection('webhook_notifications').createIndex({ 'receivedAt': -1 });
        await db.collection('webhook_notifications').createIndex({ 'senderEmail': 1 });
        await db.collection('webhook_notifications').createIndex({ 'trackedRecipientEmail': 1 });
        
        console.log(' התחברות למונגו DB הצליחה!');
        return true;
    } catch (error) {
        console.error(' שגיאה בהתחברות למונגו DB:', error.message);
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
        console.error(' חסרים משתני סביבה:', missing.join(', '));
        return false;
    }
    console.log(' כל משתני הסביבה מוגדרים כראוי');
    return true;
}

function isWebhookSiteUrl(url) {
    return /webhook\.site/i.test(url);
}

// פונקציה ליצירת URL הרשאה לכתובת ספציפית
function generateAuthUrlForEmail(emailAddress) {
    const state = Buffer.from(JSON.stringify({
        email: emailAddress,
        timestamp: Date.now(),
        action: 'track_email'
    })).toString('base64');
    
    const authUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?` +
        `client_id=${CLIENT_ID}&` +
        `response_type=code&` +
        `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
        `scope=${encodeURIComponent('https://graph.microsoft.com/Mail.Read offline_access')}&` +
        `response_mode=query&` +
        `state=${state}&` +
        `login_hint=${encodeURIComponent(emailAddress)}&` +
        `prompt=consent`;
    
    return authUrl;
}

// פונקציה לחידוש access token של משתמש ספציפי
async function refreshUserAccessToken(userRefreshToken) {
    if (!userRefreshToken) {
        console.error(' אין refresh token זמין למשתמש');
        return null;
    }

    try {
        console.log(' מחדש access token למשתמש...');
        
        const response = await axios.post(
            `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
            new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                refresh_token: userRefreshToken,
                grant_type: 'refresh_token',
                scope: 'https://graph.microsoft.com/Mail.Read offline_access'
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        
        console.log(' Token משתמש חודש בהצלחה');
        return {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token || userRefreshToken,
            expiresIn: response.data.expires_in
        };
    } catch (error) {
        console.error(' שגיאה בחידוש token משתמש:', error.response?.data || error.message);
        return null;
    }
}

// בדיקה אם token פג תוקף
async function isTokenExpired(accessToken) {
    try {
        await axios.get('https://graph.microsoft.com/v1.0/me', {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            timeout: 5000
        });
        return false;
    } catch (error) {
        if (error.response?.status === 401) {
            return true;
        }
        return false;
    }
}

// קבלת access token עדכני למשתמש
async function getValidAccessTokenForUser(userEmail) {
    if (!db) return null;
    
    try {
        const user = await db.collection('tracked_emails').findOne({
            email: userEmail.toLowerCase(),
            hasAuthorization: true
        });
        
        if (!user || !user.accessToken) {
            console.log(` לא נמצא access token עבור ${userEmail}`);
            return null;
        }
        
        // בדיקה אם ה-token עדיין תקף
        const isExpired = await isTokenExpired(user.accessToken);
        
        if (!isExpired) {
            return user.accessToken;
        }
        
        // חידוש token אם פג תוקף
        console.log(` מחדש token עבור ${userEmail}...`);
        const refreshResult = await refreshUserAccessToken(user.refreshToken);
        
        if (!refreshResult) {
            console.error(` לא ניתן לחדש token עבור ${userEmail}`);
            
            // עדכון סטטוס למשתמש שנכשל
            await db.collection('tracked_emails').updateOne(
                { email: userEmail.toLowerCase() },
                {
                    $set: {
                        hasAuthorization: false,
                        subscriptionStatus: 'token_failed',
                        updatedAt: new Date()
                    }
                }
            );
            
            return null;
        }
        
        // עדכון tokens במונגו
        const expiresAt = new Date(Date.now() + (refreshResult.expiresIn * 1000));
        
        await db.collection('tracked_emails').updateOne(
            { email: userEmail.toLowerCase() },
            {
                $set: {
                    accessToken: refreshResult.accessToken,
                    refreshToken: refreshResult.refreshToken,
                    tokenExpiresAt: expiresAt,
                    updatedAt: new Date()
                }
            }
        );
        
        console.log(` Token עודכן בהצלחה עבור ${userEmail}`);
        return refreshResult.accessToken;
        
    } catch (error) {
        console.error(` שגיאה בקבלת access token עבור ${userEmail}:`, error.message);
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
        console.error(' שגיאה בקבלת פרטי מייל:', error.message);
        return null;
    }
}

// פונקציה ליצירת subscription לכתובת ספציפית
async function createEmailSubscriptionForUser(accessToken, userEmail) {
    const maxExpirationTime = new Date(Date.now() + (4230 * 60 * 1000)).toISOString();
    const notificationUrl = WEBHOOK_URL;

    // קביעת הresource על בסיס הכתובת
    let resource = "me/mailFolders('Inbox')/messages";
    let userId = null;
    
    try {
        // קבלת פרטי המשתמש
        const userResponse = await axios.get(
            'https://graph.microsoft.com/v1.0/me',
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );
        
        userId = userResponse.data.id;
        const actualEmail = userResponse.data.mail || userResponse.data.userPrincipalName;
        
        console.log(` יוצר subscription עבור userId: ${userId} (${actualEmail})`);
        
    } catch (userError) {
        console.log(' לא ניתן לקבל user details, משתמש ב-me');
    }

    const subscription = {
        changeType: 'created',
        notificationUrl: notificationUrl,
        resource: resource,
        expirationDateTime: maxExpirationTime,
        clientState: `EmailWebhookSubscription_${userEmail}`,
        latestSupportedTlsVersion: 'v1_2'
    };

    try {
        console.log(` יוצר subscription עבור ${userEmail}...`);
        
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
            userId: userId,
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
        
        console.log(` Email subscription נוצרה בהצלחה עבור ${userEmail}!`);
        console.log(' Subscription ID:', response.data.id);
        
        // תזמון חידוש
        scheduleSubscriptionRenewal(response.data.id, response.data.expirationDateTime, userEmail);
        
        return response.data;
    } catch (error) {
        console.error(`שגיאה ביצירת Subscription עבור ${userEmail}:`, JSON.stringify(error.response?.data, null, 2));
        throw error;
    }
}

// תזמון חידוש subscription עם משתמש ספציפי
function scheduleSubscriptionRenewal(subscriptionId, expirationDateTime, userEmail) {
    // ניקוי interval קודם אם קיים
    if (refreshIntervals.has(subscriptionId)) {
        clearTimeout(refreshIntervals.get(subscriptionId));
    }
    
    const expirationTime = new Date(expirationDateTime).getTime();
    const currentTime = Date.now();
    const timeUntilExpiration = expirationTime - currentTime;
    
    const renewalTime = timeUntilExpiration - (30 * 60 * 1000); // 30 דקות לפני פקיעה
    
    if (renewalTime > 0) {
        console.log(` Subscription ${subscriptionId} עבור ${userEmail} יחודש בעוד ${Math.round(renewalTime / 60000)} דקות`);
        
        const interval = setTimeout(async () => {
            try {
                await renewSubscriptionForUser(subscriptionId, userEmail);
            } catch (error) {
                console.error(` כשל בחידוש אוטומטי של subscription עבור ${userEmail}:`, subscriptionId);
            }
        }, renewalTime);
        
        refreshIntervals.set(subscriptionId, interval);
    } else {
        console.log(` Subscription עבור ${userEmail} פג תוקף - יחודש מיד`);
        renewSubscriptionForUser(subscriptionId, userEmail);
    }
}

// חידוש subscription עבור משתמש ספציפי
async function renewSubscriptionForUser(subscriptionId, userEmail) {
    try {
        console.log(` מחדש subscription ${subscriptionId} עבור ${userEmail}...`);
        
        const accessToken = await getValidAccessTokenForUser(userEmail);
        if (!accessToken) {
            throw new Error(`לא ניתן לקבל access token עבור ${userEmail}`);
        }
        
        const newExpirationTime = new Date(Date.now() + (4230 * 60 * 1000)).toISOString();
        
        const response = await axios.patch(
            `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
            {
                expirationDateTime: newExpirationTime
            },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        // עדכון במונגו
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
            
            // עדכון גם בtracked_emails
            await db.collection('tracked_emails').updateOne(
                { email: userEmail.toLowerCase() },
                {
                    $set: {
                        subscriptionExpiresAt: new Date(response.data.expirationDateTime),
                        subscriptionStatus: 'active',
                        updatedAt: new Date()
                    }
                }
            );
        }

        console.log(` Subscription חודש בהצלחה עבור ${userEmail}!`);
        scheduleSubscriptionRenewal(subscriptionId, response.data.expirationDateTime, userEmail);
        
        return response.data;
    } catch (error) {
        console.error(` שגיאה בחידוש subscription עבור ${userEmail}:`, error.response?.data || error.message);
        
        // עדכון סטטוס כשל
        if (db) {
            await db.collection('tracked_emails').updateOne(
                { email: userEmail.toLowerCase() },
                {
                    $set: {
                        subscriptionStatus: 'renewal_failed',
                        updatedAt: new Date()
                    }
                }
            );
        }
        
        throw error;
    }
}

// מחיקת subscription
async function deleteSubscriptionForUser(subscriptionId, userEmail) {
    try {
        const accessToken = await getValidAccessTokenForUser(userEmail);
        if (!accessToken) {
            throw new Error(`לא ניתן לקבל access token עבור ${userEmail}`);
        }

        await axios.delete(
            `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );
        
        // עדכון במונגו
        if (db) {
            await db.collection('subscriptions').updateOne(
                { subscriptionId: subscriptionId },
                { $set: { status: 'deleted', deletedAt: new Date() } }
            );
            
            await db.collection('tracked_emails').updateOne(
                { email: userEmail.toLowerCase() },
                {
                    $set: {
                        subscriptionStatus: 'deleted',
                        subscriptionId: null,
                        updatedAt: new Date()
                    }
                }
            );
        }

        subscriptions.delete(subscriptionId);
        
        if (refreshIntervals.has(subscriptionId)) {
            clearTimeout(refreshIntervals.get(subscriptionId));
            refreshIntervals.delete(subscriptionId);
        }
        
        console.log(` Subscription נמחק בהצלחה עבור ${userEmail}:`, subscriptionId);
    } catch (error) {
        console.error(` שגיאה במחיקת subscription עבור ${userEmail}:`, error.response?.data || error.message);
        throw error;
    }
}

// פונקציה משודרגת לשליחת webhook
async function sendToWebhookSite(webhookData) {
    if (!WEBHOOK_SITE_URL) {
        console.log('WEBHOOK_SITE_URL לא מוגדר');
        return false;
    }

    try {
        const axiosConfig = {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Microsoft-Graph-Email-Webhook/1.0'
            },
            timeout: 15000,
            validateStatus: function (status) {
                return status >= 200 && status < 300;
            }
        };

        if (WEBHOOK_SITE_URL.startsWith('https://')) {
            axiosConfig.httpsAgent = new https.Agent({
                rejectUnauthorized: false,
                keepAlive: true,
                timeout: 10000
            });
        }

        console.log(' שולח webhook ל:', WEBHOOK_SITE_URL);
        const response = await axios.post(WEBHOOK_SITE_URL, webhookData, axiosConfig);
        
        console.log(' Webhook נשלח בהצלחה!', {
            status: response.status,
            statusText: response.statusText
        });
        
        return true;

    } catch (error) {
        console.error(' שגיאה בשליחת webhook:', {
            message: error.message,
            code: error.code,
            status: error.response?.status,
            url: WEBHOOK_SITE_URL
        });
        
        return false;
    }
}

// שמירת התראת webhook עבור משתמש ספציפי
async function saveWebhookNotificationForUser(notificationData, emailDetails, targetUserEmail) {
    if (!db) {
        console.error(' אין חיבור למונגו DB');
        return null;
    }

    try {
        console.log(` מעבד מייל עבור משתמש: ${targetUserEmail}`);
        console.log(` מייל מ: ${emailDetails.from} | נושא: ${emailDetails.subject}`);
        
        // שמירת ההתראה
        const webhookDocument = {
            subscriptionId: notificationData.subscriptionId,
            resource: notificationData.resource,
            changeType: notificationData.changeType,
            clientState: notificationData.clientState,
            receivedAt: new Date(),
            messageId: notificationData.messageId,
            processed: true,
            
            // פרטי המייל
            trackedUserEmail: targetUserEmail, // המשתמש שמעוקב
            senderEmail: emailDetails.from.toLowerCase(),
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
        console.log(' התראת webhook נשמרה במונגו:', result.insertedId);
        
        // עדכון סטטיסטיקות
        await updateTrackedEmailStats(targetUserEmail);
        
        // שליחת webhook
        const webhookPayload = {
            type: 'email_received_notification',
            timestamp: new Date().toISOString(),
            emailData: {
                from: emailDetails.from,
                to_tracked_user: targetUserEmail,
                subject: emailDetails.subject,
                receivedDateTime: emailDetails.receivedDateTime,
                bodyPreview: emailDetails.bodyPreview,
                isRead: emailDetails.isRead,
                hasAttachments: emailDetails.hasAttachments,
                importance: emailDetails.importance,
                allRecipients: [...emailDetails.toRecipients, ...emailDetails.ccRecipients]
            },
            source: 'Microsoft Graph Email Webhook - Multi User Tracking',
            processed_at: new Date().toLocaleString('he-IL'),
            webhookId: result.insertedId
        };

        const webhookSent = await sendToWebhookSite(webhookPayload);
        
        // עדכון המסמך בבסיס הנתונים עם סטטוס השליחה
        await db.collection('webhook_notifications').updateOne(
            { _id: result.insertedId },
            { $set: { webhookSent: webhookSent, webhookSentAt: new Date() } }
        );
        
        return result.insertedId;
    } catch (error) {
        console.error(' שגיאה בשמירת התראת webhook:', error.message);
        return null;
    }
}

// עדכון סטטיסטיקות כתובת מעקב
async function updateTrackedEmailStats(userEmail) {
    if (!db) return;

    try {
        const result = await db.collection('tracked_emails').updateOne(
            { email: userEmail.toLowerCase(), isActive: true },
            { 
                $inc: { totalEmailsReceived: 1 },
                $set: { 
                    lastEmailReceived: new Date(),
                    updatedAt: new Date()
                }
            }
        );
        
        if (result.modifiedCount > 0) {
            console.log(` עדכון סטטיסטיקות עבור ${userEmail}`);
        }
    } catch (error) {
        console.error(' שגיאה בעדכון סטטיסטיקות:', error.message);
    }
}

// ========== ENDPOINTS ==========

// Endpoint להתחברות כללית (ישן)
app.get('/auth/login', (req, res) => {
    if (!validateEnvironmentVariables()) {
        return res.status(500).json({ 
            error: 'חסרים משתני סביבה',
            note: 'בדק את קובץ ה-.env'
        });
    }

    const authUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?` +
        `client_id=${CLIENT_ID}&` +
        `response_type=code&` +
        `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
        `scope=${encodeURIComponent('https://graph.microsoft.com/Mail.Read offline_access')}&` +
        `response_mode=query`;

    res.json({
        message: 'השתמש ב-/api/tracked-emails להוספת כתובות עם הרשאה אוטומטית',
        legacyAuthUrl: authUrl,
        recommendedFlow: 'POST /api/tracked-emails -> authUrl -> auto subscription creation'
    });
});

// Callback מעודכן עבור Authorization Code
app.get('/auth/callback', async (req, res) => {
    const { code, error, error_description, state } = req.query;
    
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
        // פענוח ה-state לזיהוי הכתובת
        let targetEmail = null;
        let isTrackingRequest = false;
        
        if (state) {
            try {
                const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
                if (stateData.email && stateData.action === 'track_email') {
                    targetEmail = stateData.email;
                    isTrackingRequest = true;
                    console.log(' מעבד הרשאה עבור כתובת:', targetEmail);
                }
            } catch (stateError) {
                console.log(' לא ניתן לפענח state');
            }
        }
        
        if (!isTrackingRequest) {
            return res.status(400).json({ 
                error: 'בקשה לא תקינה',
                message: 'השתמש ב-API להוספת כתובות מעקב'
            });
        }
        
        // קבלת tokens
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
        
        const accessToken = tokenResponse.data.access_token;
        const refreshToken = tokenResponse.data.refresh_token;
        const expiresIn = tokenResponse.data.expires_in;
        const tokenExpiresAt = new Date(Date.now() + (expiresIn * 1000));
        
        console.log(' התחברות הצליחה עבור:', targetEmail);
        
        // עדכון הרשומה במונגו
        await db.collection('tracked_emails').updateOne(
            { email: targetEmail.toLowerCase() },
            {
                $set: {
                    hasAuthorization: true,
                    accessToken: accessToken,
                    refreshToken: refreshToken,
                    tokenExpiresAt: tokenExpiresAt,
                    authorizationDate: new Date(),
                    subscriptionStatus: 'authorized',
                    updatedAt: new Date()
                }
            }
        );
        
        console.log(' עודכן מצב הרשאה במונגו עבור:', targetEmail);
        
        // יצירת subscription עבור הכתובת
        try {
            const subscription = await createEmailSubscriptionForUser(accessToken, targetEmail);
            
            // עדכון subscription ID במונגו
            await db.collection('tracked_emails').updateOne(
                { email: targetEmail.toLowerCase() },
                {
                    $set: {
                        subscriptionId: subscription.id,
                        subscriptionExpiresAt: new Date(subscription.expirationDateTime),
                        subscriptionStatus: 'active',
                        updatedAt: new Date()
                    }
                }
            );
            
            console.log(` מערכת מעקב הופעלה במלואה עבור ${targetEmail}!`);
            
            res.json({ 
                message: ` מעקב הופעל עבור ${targetEmail}!`,
                email: targetEmail,
                subscriptionId: subscription.id,
                expiresAt: subscription.expirationDateTime,
                autoRenewal: true,
                status: 'active'
            });
            
        } catch (subscriptionError) {
            console.error(' שגיאה ביצירת subscription:', subscriptionError.message);
            
            // עדכון סטטוס כשל
            await db.collection('tracked_emails').updateOne(
                { email: targetEmail.toLowerCase() },
                {
                    $set: {
                        subscriptionStatus: 'subscription_failed',
                        updatedAt: new Date()
                    }
                }
            );
            
            res.status(500).json({
                error: 'הרשאה הצליחה אבל יצירת subscription נכשלה',
                email: targetEmail,
                details: subscriptionError.message,
                nextSteps: 'נסה ליצור subscription מחדש דרך ה-API'
            });
        }
        
    } catch (error) {
        console.error(' שגיאה בתהליך:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'שגיאה בתהליך',
            details: error.response?.data || error.message
        });
    }
});

// Endpoint עיקרי לקבלת התראות מ-Microsoft Graph (מעודכן למרובי משתמשים)
app.post('/webhooks/microsoft-graph', async (req, res) => {
    console.log('\n ======== התראת מייל חדשה ========');
    console.log(' קיבלנו בקשה ב-webhook endpoint');
    console.log(' זמן:', new Date().toLocaleString('he-IL'));
    
    const { validationToken } = req.query;
    
    if (validationToken) {
        console.log(' מאמת webhook עם Microsoft Graph...');
        console.log(' Validation token:', validationToken);
        return res.status(200).type('text/plain').send(validationToken);
    }
    
    const notifications = req.body?.value || [];
    console.log(` התקבלו ${notifications.length} התראות מייל חדשות!`);
    
    for (let i = 0; i < notifications.length; i++) {
        const notification = notifications[i];
        const messageId = notification.resource.split('/Messages/')[1] || 'unknown';
        
        // זיהוי המשתמש על בסיס clientState
        let targetUserEmail = 'unknown';
        if (notification.clientState && notification.clientState.includes('_')) {
            const parts = notification.clientState.split('_');
            if (parts.length > 1) {
                targetUserEmail = parts[1];
            }
        }
        
        console.log(`\n === עיבוד מייל ${i + 1} עבור ${targetUserEmail} ===`);
        console.log(' Subscription ID:', notification.subscriptionId);
        console.log(' Resource:', notification.resource);
        console.log(' Message ID:', messageId);
        
        if (targetUserEmail === 'unknown' || messageId === 'unknown') {
            console.log(' לא ניתן לזהות משתמש או message ID - מדלג');
            continue;
        }
        
        // קבלת access token עבור המשתמש
        const userToken = await getValidAccessTokenForUser(targetUserEmail);
        if (!userToken) {
            console.log(` לא ניתן לקבל access token עבור ${targetUserEmail} - מדלג`);
            continue;
        }
        
        // קבלת פרטי המייל
        const emailDetails = await getEmailDetails(messageId, userToken);
        if (!emailDetails) {
            console.log(` לא ניתן לקבל פרטי מייל עבור ${targetUserEmail} - מדלג`);
            continue;
        }
        
        // שמירה ושליחת webhook
        const notificationData = {
            subscriptionId: notification.subscriptionId,
            resource: notification.resource,
            changeType: notification.changeType,
            clientState: notification.clientState,
            messageId: messageId
        };
        
        const savedId = await saveWebhookNotificationForUser(notificationData, emailDetails, targetUserEmail);
        
        if (savedId) {
            console.log(` מייל ${i + 1} עבור ${targetUserEmail} נשמר ונשלח בהצלחה! DB ID: ${savedId}`);
        } else {
            console.log(` כשל בעיבוד מייל ${i + 1} עבור ${targetUserEmail}`);
        }
    }
    
    console.log(' ======== סיום עיבוד התראות ========\n');
    res.status(202).send('OK');
});

// ENDPOINT נוסף ל-GET (לבדיקה)
app.get('/webhooks/microsoft-graph', (req, res) => {
    const { validationToken } = req.query;
    
    if (validationToken) {
        return res.status(200).type('text/plain').send(validationToken);
    }
    
    res.json({ 
        message: 'Webhook endpoint פועל - מערכת מרובת משתמשים',
        timestamp: new Date().toLocaleString('he-IL'),
        version: 'multi-user-v1'
    });
});

// ========== כתובות מעקב ENDPOINTS - מעודכן ==========

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

        // הוספת authUrl לכתובות שלא אושרו
        const emailsWithUrls = trackedEmails.map(email => ({
            ...email,
            authUrl: email.hasAuthorization ? null : generateAuthUrlForEmail(email.email),
            needsAction: !email.hasAuthorization || email.subscriptionStatus !== 'active'
        }));

        res.json({
            trackedEmails: emailsWithUrls,
            totalCount: trackedEmails.length,
            summary: {
                total: trackedEmails.length,
                authorized: trackedEmails.filter(e => e.hasAuthorization).length,
                activeSubscriptions: trackedEmails.filter(e => e.subscriptionStatus === 'active').length,
                needingAction: trackedEmails.filter(e => !e.hasAuthorization || e.subscriptionStatus !== 'active').length
            }
        });
    } catch (error) {
        console.error(' שגיאה בקבלת כתובות מעקב:', error.message);
        res.status(500).json({ error: 'שגיאה בקבלת כתובות מעקב' });
    }
});

// הוספת כתובת מייל למעקב - מעודכן
app.post('/api/tracked-emails', async (req, res) => {
    if (!db) {
        return res.status(500).json({ error: 'אין חיבור למונגו DB' });
    }

    try {
        const { email, description, isActive = true } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'כתובת מייל חובה' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'כתובת מייל לא תקינה' });
        }

        // בדיקה שהכתובת לא קיימת כבר
        const existingEmail = await db.collection('tracked_emails').findOne({ email: email.toLowerCase() });
        if (existingEmail) {
            return res.status(409).json({ 
                error: 'כתובת מייל כבר קיימת במעקב',
                existingEmail: existingEmail,
                authUrl: existingEmail.hasAuthorization ? null : generateAuthUrlForEmail(email)
            });
        }

        // יצירת רשומה עם מבנה מעודכן
        const trackedEmail = {
            email: email.toLowerCase(),
            description: description || '',
            isActive: isActive,
            
            // OAuth fields
            hasAuthorization: false,
            accessToken: null,
            refreshToken: null,
            tokenExpiresAt: null,
            authorizationDate: null,
            
            // Subscription fields
            subscriptionId: null,
            subscriptionExpiresAt: null,
            subscriptionStatus: 'pending_authorization',
            
            // Statistics
            addedAt: new Date(),
            lastEmailReceived: null,
            totalEmailsReceived: 0,
            createdBy: 'api',
            updatedAt: new Date()
        };

        const result = await db.collection('tracked_emails').insertOne(trackedEmail);
        
        // יצירת URL הרשאה
        const authUrl = generateAuthUrlForEmail(email);
        
        console.log(' כתובת מייל נוספה למעקב (ממתינה להרשאה):', email);
        console.log(' Authorization URL:', authUrl);

        
        
        res.status(201).json({
            success: true,
            message: 'כתובת מייל נוספה למעקב - נדרשת הרשאה',
            trackedEmail: { ...trackedEmail, _id: result.insertedId },
            authUrl: authUrl,
            nextSteps: [
                '1. שלח את ה-authUrl למשתמש',
                '2. המשתמש נכנס לקישור ומאשר גישה',
                '3. המערכת תיצור subscription אוטומטית',
                '4. בדוק סטטוס ב-GET /api/tracked-emails'
            ]
        });
    } catch (error) {
        console.error(' שגיאה בהוספת כתובת למעקב:', error.message);
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

        res.json({ 
            success: true,
            message: 'כתובת מייל עודכנה בהצלחה' 
        });
    } catch (error) {
        console.error(' שגיאה בעדכון כתובת מייל:', error.message);
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

        // קבלת פרטי הכתובת לפני מחיקה
        const emailDoc = await db.collection('tracked_emails').findOne({ _id: new ObjectId(id) });
        if (!emailDoc) {
            return res.status(404).json({ error: 'כתובת מייל לא נמצאה' });
        }

        // מחיקת subscription אם קיים
        if (emailDoc.subscriptionId) {
            try {
                await deleteSubscriptionForUser(emailDoc.subscriptionId, emailDoc.email);
                console.log(`🗑️ Subscription נמחק עבור ${emailDoc.email}`);
            } catch (subError) {
                console.error(` לא ניתן למחוק subscription עבור ${emailDoc.email}:`, subError.message);
            }
        }

        // מחיקת הכתובת
        const result = await db.collection('tracked_emails').deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'כתובת מייל לא נמצאה' });
        }

        console.log(` כתובת ${emailDoc.email} הוסרה מהמעקב`);
        res.json({ 
            success: true,
            message: 'כתובת מייל הוסרה בהצלחה מהמעקב',
            deletedEmail: emailDoc.email
        });
    } catch (error) {
        console.error(' שגיאה במחיקת כתובת מייל:', error.message);
        res.status(500).json({ error: 'שגיאה במחיקת כתובת מייל' });
    }
});

// Endpoint להפעלה מחדש של הרשאה
app.post('/api/tracked-emails/:id/reauthorize', async (req, res) => {
    if (!db) {
        return res.status(500).json({ error: 'אין חיבור למונגו DB' });
    }

    try {
        const { id } = req.params;
        const email = await db.collection('tracked_emails').findOne({ _id: new ObjectId(id) });
        
        if (!email) {
            return res.status(404).json({ error: 'כתובת מייל לא נמצאה' });
        }

        // מחיקת subscription ישן אם קיים
        if (email.subscriptionId) {
            try {
                await deleteSubscriptionForUser(email.subscriptionId, email.email);
            } catch (error) {
                console.log(' לא ניתן למחוק subscription ישן');
            }
        }

        // איפוס נתוני הרשאה
        await db.collection('tracked_emails').updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    hasAuthorization: false,
                    accessToken: null,
                    refreshToken: null,
                    tokenExpiresAt: null,
                    authorizationDate: null,
                    subscriptionId: null,
                    subscriptionExpiresAt: null,
                    subscriptionStatus: 'pending_reauthorization',
                    updatedAt: new Date()
                }
            }
        );

        const authUrl = generateAuthUrlForEmail(email.email);
        
        res.json({
            success: true,
            message: 'קישור הרשאה חדש נוצר',
            email: email.email,
            authUrl: authUrl
        });
    } catch (error) {
        console.error(' שגיאה ביצירת הרשאה מחדש:', error.message);
        res.status(500).json({ error: 'שגיאה ביצירת הרשאה מחדש' });
    }
});

// סטטיסטיקות כתובות במעקב - מעודכן
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
                    authorizedUsers: { $sum: { $cond: ['$hasAuthorization', 1, 0] } },
                    activeSubscriptions: { $sum: { $cond: [{ $eq: ['$subscriptionStatus', 'active'] }, 1, 0] } },
                    totalEmailsReceived: { $sum: '$totalEmailsReceived' }
                }
            }
        ]).toArray();

        const subscriptionStats = await db.collection('subscriptions').aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]).toArray();

        const webhookStats = await db.collection('webhook_notifications').countDocuments();

        const statusBreakdown = await db.collection('tracked_emails').aggregate([
            {
                $group: {
                    _id: '$subscriptionStatus',
                    count: { $sum: 1 }
                }
            }
        ]).toArray();

        const result = {
            emailTracking: emailStats[0] || {
                totalTracked: 0,
                activeTracked: 0,
                authorizedUsers: 0,
                activeSubscriptions: 0,
                totalEmailsReceived: 0
            },
            subscriptionsByStatus: subscriptionStats.reduce((acc, curr) => {
                acc[curr._id] = curr.count;
                return acc;
            }, {}),
            emailStatusBreakdown: statusBreakdown.reduce((acc, curr) => {
                acc[curr._id] = curr.count;
                return acc;
            }, {}),
            totalWebhookNotifications: webhookStats
        };

        res.json(result);
    } catch (error) {
        console.error(' שגיאה בקבלת סטטיסטיקות:', error.message);
        res.status(500).json({ error: 'שגיאה בקבלת סטטיסטיקות' });
    }
});

// Endpoint לקבלת מצב הרשאות
app.get('/api/tracked-emails/authorization-status', async (req, res) => {
    if (!db) {
        return res.status(500).json({ error: 'אין חיבור למונגו DB' });
    }

    try {
        const emails = await db.collection('tracked_emails')
            .find({})
            .project({
                email: 1,
                hasAuthorization: 1,
                subscriptionStatus: 1,
                subscriptionId: 1,
                authorizationDate: 1,
                subscriptionExpiresAt: 1,
                totalEmailsReceived: 1,
                lastEmailReceived: 1,
                tokenExpiresAt: 1
            })
            .sort({ addedAt: -1 })
            .toArray();

        // הוספת URL הרשאה לכתובות שלא אושרו
        const emailsWithAuthUrls = emails.map(email => ({
            ...email,
            authUrl: email.hasAuthorization ? null : generateAuthUrlForEmail(email.email),
            needsAuthorization: !email.hasAuthorization,
            needsAction: !email.hasAuthorization || email.subscriptionStatus !== 'active',
            tokenExpiresSoon: email.tokenExpiresAt ? (new Date(email.tokenExpiresAt) - new Date()) < (24 * 60 * 60 * 1000) : false
        }));

        res.json({
            emails: emailsWithAuthUrls,
            summary: {
                total: emails.length,
                authorized: emails.filter(e => e.hasAuthorization).length,
                pending: emails.filter(e => !e.hasAuthorization).length,
                activeSubscriptions: emails.filter(e => e.subscriptionStatus === 'active').length,
                needingAction: emails.filter(e => !e.hasAuthorization || e.subscriptionStatus !== 'active').length
            }
        });
    } catch (error) {
        console.error(' שגיאה בקבלת מצב הרשאות:', error.message);
        res.status(500).json({ error: 'שגיאה בקבלת מצב הרשאות' });
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
        const userEmail = req.query.user;

        let filter = {};
        if (userEmail) {
            filter.trackedUserEmail = userEmail.toLowerCase();
        }

        const notifications = await db.collection('webhook_notifications')
            .find(filter)
            .sort({ receivedAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const totalCount = await db.collection('webhook_notifications').countDocuments(filter);

        res.json({
            notifications: notifications,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalCount / limit),
                totalCount: totalCount
            },
            filter: userEmail ? { userEmail } : null
        });
    } catch (error) {
        console.error(' שגיאה בקבלת התראות:', error.message);
        res.status(500).json({ error: 'שגיאה בקבלת התראות' });
    }
});

// חיפוש התראות
app.get('/api/webhook-notifications/search', async (req, res) => {
    if (!db) {
        return res.status(500).json({ error: 'אין חיבור למונגו DB' });
    }

    try {
        const { sender, subject, user } = req.query;
        const filter = {};

        if (sender) {
            filter.senderEmail = { $regex: sender, $options: 'i' };
        }
        if (subject) {
            filter.subject = { $regex: subject, $options: 'i' };
        }
        if (user) {
            filter.trackedUserEmail = { $regex: user, $options: 'i' };
        }

        const notifications = await db.collection('webhook_notifications')
            .find(filter)
            .sort({ receivedAt: -1 })
            .limit(50)
            .toArray();

        res.json({
            notifications: notifications,
            count: notifications.length,
            searchCriteria: { sender, subject, user }
        });
    } catch (error) {
        console.error(' שגיאה בחיפוש התראות:', error.message);
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
            activeCount: subs.filter(s => s.status === 'active').length,
            totalCount: subs.length
        });
    } catch (error) {
        res.status(500).json({ error: 'שגיאה בקבלת subscriptions' });
    }
});

// חידוש subscription
app.post('/api/subscriptions/:id/renew', async (req, res) => {
    try {
        const { id } = req.params;
        
        // מציאת ה-subscription במונגו
        const subscription = await db.collection('subscriptions').findOne({ subscriptionId: id });
        if (!subscription) {
            return res.status(404).json({ error: 'Subscription לא נמצא' });
        }
        
        await renewSubscriptionForUser(id, subscription.userEmail);
        res.json({ 
            success: true,
            message: 'Subscription חודש בהצלחה',
            userEmail: subscription.userEmail
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'שגיאה בחידוש subscription',
            details: error.message
        });
    }
});

// מחיקת subscription
app.delete('/api/subscriptions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // מציאת ה-subscription במונגו
        const subscription = await db.collection('subscriptions').findOne({ subscriptionId: id });
        if (!subscription) {
            return res.status(404).json({ error: 'Subscription לא נמצא' });
        }
        
        await deleteSubscriptionForUser(id, subscription.userEmail);
        res.json({ 
            success: true,
            message: 'Subscription נמחק בהצלחה',
            userEmail: subscription.userEmail
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'שגיאה במחיקת subscription',
            details: error.message
        });
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
            message: 'בדיקת חיבור מהשרת - מערכת מרובת משתמשים',
            source: 'Manual Test - Multi User System',
            testId: Date.now(),
            version: 'multi-user-v1'
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

// Endpoint לבדיקת מצב השרות - מעודכן
app.get('/health', async (req, res) => {
    let trackedEmailsStats = null;
    let activeSubscriptionsCount = 0;
    
    if (db) {
        try {
            const stats = await db.collection('tracked_emails').aggregate([
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        authorized: { $sum: { $cond: ['$hasAuthorization', 1, 0] } },
                        active: { $sum: { $cond: [{ $eq: ['$subscriptionStatus', 'active'] }, 1, 0] } }
                    }
                }
            ]).toArray();
            
            trackedEmailsStats = stats[0] || { total: 0, authorized: 0, active: 0 };
            activeSubscriptionsCount = await db.collection('subscriptions').countDocuments({ status: 'active' });
        } catch (error) {
            console.error('שגיאה בקבלת סטטיסטיקות health:', error.message);
        }
    }
    
    res.json({ 
        status: 'השרת רץ בהצלחה - מערכת מרובת משתמשים',
        version: 'multi-user-v1',
        timestamp: new Date().toLocaleString('he-IL'),
        webhookUrl: WEBHOOK_URL,
        webhookSiteUrl: WEBHOOK_SITE_URL,
        
        // סטטיסטיקות מעודכנות
        trackedEmails: trackedEmailsStats,
        subscriptions: {
            active: activeSubscriptionsCount,
            total: subscriptions.size
        },
        
        // מצב מערכת
        mongoDbConnected: !!db,
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
        console.error(' לא ניתן להתחבר למונגו DB');
        process.exit(1);
    }

    // טעינת subscriptions קיימים מהמונגו
    try {
        const existingSubscriptions = await db.collection('subscriptions')
            .find({ status: 'active' })
            .toArray();
        
        for (const sub of existingSubscriptions) {
            subscriptions.set(sub.subscriptionId, sub);
            
            // תזמון חידוש עם פרטי המשתמש
            if (sub.userEmail) {
                scheduleSubscriptionRenewal(sub.subscriptionId, sub.expirationDateTime, sub.userEmail);
            }
        }
        
        console.log(` נטענו ${existingSubscriptions.length} subscriptions קיימים`);
        
        // טעינת כתובות מעוקבות
        const trackedEmails = await db.collection('tracked_emails')
            .find({ isActive: true })
            .toArray();
        
        console.log(` נמצאו ${trackedEmails.length} כתובות במעקב`);
        console.log(`   - מאושרות: ${trackedEmails.filter(e => e.hasAuthorization).length}`);
        console.log(`   - subscriptions פעילים: ${trackedEmails.filter(e => e.subscriptionStatus === 'active').length}`);
        
    } catch (error) {
        console.error(' שגיאה בטעינת נתונים:', error.message);
    }

    app.listen(PORT, () => {
        console.log(`
 ===== מערכת מעקב מיילים מרובת משתמשים =====
 השרת רץ על פורט ${PORT}
 התראות יגיעו ל: ${WEBHOOK_URL}

    Endpoints עיקריים:
    סטטוס מערכת: http://localhost:${PORT}/health
    ניהול כתובות: http://localhost:${PORT}/api/tracked-emails  
    מצב הרשאות: http://localhost:${PORT}/api/tracked-emails/authorization-status
    התראות: http://localhost:${PORT}/api/webhook-notifications
    Subscriptions: http://localhost:${PORT}/api/subscriptions
    בדיקת webhook: http://localhost:${PORT}/api/test-webhook

   תהליך הפעלה:
   1. הוסף כתובת: POST /api/tracked-emails
   2. שלח למשתמש את ה-authUrl שמתקבל
   3. המשתמש נכנס לקישור ומאשר גישה
   4. המערכת תיצור subscription אוטומטית
   5. בדוק מצב: GET /api/tracked-emails/authorization-status
   6. שלח מיילים ותראה התראות ב-webhook

${WEBHOOK_SITE_URL ? `📱 Webhook.site: ${WEBHOOK_SITE_URL}` : ''}

${!validateEnvironmentVariables() ? '  עדכן את קובץ ה-.env לפני שתמשיך!' : ' משתני סביבה תקינים'}
`);
    });
}

// סגירה נכונה של חיבור מונגו
process.on('SIGINT', async () => {
    console.log('\n סוגר את השרת...');
    
    // ניקוי intervals
    refreshIntervals.forEach(interval => clearTimeout(interval));
    
    if (mongoClient) {
        await mongoClient.close();
        console.log(' חיבור מונגו DB נסגר');
    }
    process.exit(0);
});

startServer();