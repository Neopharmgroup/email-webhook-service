require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// הגדרות סביבה
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const TENANT_ID = process.env.TENANT_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const REDIRECT_URI = process.env.REDIRECT_URI;
const WEBHOOK_SITE_URL = process.env.WEBHOOK_SITE_URL; // אופציונלי - לצפייה ב-webhook.site

// משתנים גלובליים לניהול tokens ו-subscriptions
let currentAccessToken = null;
let currentRefreshToken = null;
let currentSubscriptionId = null;
let refreshInterval = null;

// משתנה לשמירת ההתראות האחרונות
let recentNotifications = [];

// פונקציה לשליחת התראה ל-webhook.site (אם מוגדר)
async function forwardToWebhookSite(notificationData) {
    if (!WEBHOOK_SITE_URL) {
        return; // אם לא מוגדר WEBHOOK_SITE_URL, לא שולחים
    }
    
    try {
        console.log('📤 שולח התראה ל-webhook.site...');
        
        const response = await axios.post(WEBHOOK_SITE_URL, {
            type: 'email_notification',
            timestamp: new Date().toISOString(),
            data: notificationData,
            source: 'Microsoft Graph Email Webhook',
            processed_at: new Date().toLocaleString('he-IL')
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ התראה נשלחה בהצלחה ל-webhook.site');
    } catch (error) {
        console.error('❌ שגיאה בשליחה ל-webhook.site:', error.message);
    }
}

// בדיקת משתני סביבה
function validateEnvironmentVariables() {
    const required = { CLIENT_ID, CLIENT_SECRET, TENANT_ID, WEBHOOK_URL, REDIRECT_URI };
    const missing = Object.entries(required)
        .filter(([key, value]) => !value)
        .map(([key]) => key);
    
    if (missing.length > 0) {
        console.error('❌ חסרים משתני סביבה:', missing.join(', '));
        console.error('🔧 אנא עדכני את הקובץ .env');
        return false;
    }
    console.log('✅ כל משתני הסביבה מוגדרים כראוי');
    return true;
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

// בדיקת תקינות ה-WEBHOOK_URL (חייב להיות HTTPS עבור Microsoft Graph)
function validateWebhookUrl() {
    if (!WEBHOOK_URL) {
        console.error('❌ לא הוגדר WEBHOOK_URL');
        return false;
    }
    if (!/^https:\/\//i.test(WEBHOOK_URL)) {
        console.warn('⚠️ Microsoft Graph דורש כתובת HTTPS עבור notificationUrl (למעט localhost/ngrok בפיתוח)');
        console.warn(`🔗 כתובת נוכחית: ${WEBHOOK_URL}`);
    }
    // אפשר להוסיף בדיקה נוספת ל-localhost/ngrok אם רוצים
    return true;
}

// בדיקת האם ה-WEBHOOK_URL הוא webhook.site (Microsoft Graph לא תומך בזה)
function isWebhookSiteUrl(url) {
    return /webhook\.site/i.test(url);
}

// פונקציה ליצירת subscription (כמו בדוגמא של מיקרוסופט)
async function createEmailSubscription(accessToken) {
    // Microsoft Graph תומך ב-subscription עד 4230 דקות (כ-3 ימים)
    const maxExpirationTime = new Date(Date.now() + (4230 * 60 * 1000)).toISOString();
    
    // שימוש ב-localhost.run או ngrok URL במקום webhook.site
    const notificationUrl = WEBHOOK_URL; 

    // בדוק תקינות הכתובת לפני שליחה ל-Microsoft
    if (!validateWebhookUrl()) {
        throw new Error('WEBHOOK_URL לא תקין');
    }
    if (isWebhookSiteUrl(notificationUrl)) {
        console.error('❌ webhook.site לא תומך ב-handshake של Microsoft Graph. השתמשי ב-ngrok, localhost.run או שרת משלך.');
        throw new Error('WEBHOOK_URL לא נתמך: webhook.site');
    }

    const subscription = {
        changeType: 'created',
        notificationUrl: notificationUrl,
        resource: 'me/mailFolders(\'Inbox\')/messages',
        expirationDateTime: maxExpirationTime,
        clientState: 'MySecretClientState',
        latestSupportedTlsVersion: 'v1_2' // כמו בדוגמא של מיקרוסופט
    };

    try {
        console.log('🔄 יוצר subscription למיילים...');
        console.log('📍 נתונים ישלחו ל:', notificationUrl);
        console.log('⏰ תוקף עד:', maxExpirationTime);
        
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
        
        currentSubscriptionId = response.data.id;
        console.log('✅ Email subscription נוצרה בהצלחה!');
        console.log('📧 Subscription ID:', response.data.id);
        console.log('⏰ פג תוקף ב:', response.data.expirationDateTime);
        console.log('📬 התראות יתקבלו ב-endpoint: /webhooks/microsoft-graph');
        
        // הגדרת חידוש אוטומטי
        scheduleSubscriptionRenewal(response.data.expirationDateTime);
        
        return response.data;
    } catch (error) {
        // שפר לוג שגיאה: הצג את כל המידע שה-Graph מחזיר
        if (error.response) {
            console.error('❌ שגיאה ביצירת Subscription:', JSON.stringify(error.response.data, null, 2));
            if (error.response.data?.error?.code === 'ValidationError') {
                console.error('📢 שגיאת ValidationError:');
                if (isWebhookSiteUrl(notificationUrl)) {
                    console.error('❌ webhook.site לא תומך ב-validation של Microsoft Graph. השתמשי ב-ngrok, localhost.run או שרת משלך.');
                }
                console.error('📄 ודאי שההרשאות (permissions) של האפליקציה ב-Azure AD כוללות Mail.Read');
                console.error('🔗 ודאי שה-notificationUrl נגיש מהאינטרנט (HTTPS חובה, למעט localhost/ngrok בפיתוח)');
                console.error('📚 ראה: https://learn.microsoft.com/en-us/graph/webhooks');
            }
        } else {
            console.error('❌ שגיאה ביצירת Subscription:', error.message);
        }
        throw error;
    }
}

// פונקציה לחידוש subscription אוטומטי
async function renewSubscription() {
    if (!currentSubscriptionId || !currentAccessToken) {
        console.error('❌ חסרים נתונים לחידוש subscription');
        return;
    }

    try {
        // חדש token קודם
        const freshToken = await refreshAccessToken();
        if (!freshToken) {
            console.error('❌ לא ניתן לחדש token - ננסה ליצור subscription חדש');
            return await createEmailSubscription(currentAccessToken);
        }

        console.log('🔄 מחדש subscription...');
        
        const newExpirationTime = new Date(Date.now() + (4230 * 60 * 1000)).toISOString();
        
        const response = await axios.patch(
            `https://graph.microsoft.com/v1.0/subscriptions/${currentSubscriptionId}`,
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
        
        console.log('✅ Subscription חודש בהצלחה!');
        console.log('⏰ תוקף חדש עד:', response.data.expirationDateTime);
        
        // תזמן חידוש הבא
        scheduleSubscriptionRenewal(response.data.expirationDateTime);
        
    } catch (error) {
        console.error('❌ שגיאה בחידוש subscription:', error.response?.data || error.message);
        
        // אם החידוש נכשל, צור subscription חדש
        console.log('🔄 מנסה ליצור subscription חדש...');
        try {
            await createEmailSubscription(currentAccessToken);
        } catch (createError) {
            console.error('❌ גם יצירת subscription חדש נכשלה:', createError.message);
        }
    }
}

// תזמון חידוש subscription
function scheduleSubscriptionRenewal(expirationDateTime) {
    if (refreshInterval) {
        clearTimeout(refreshInterval);
    }
    
    const expirationTime = new Date(expirationDateTime).getTime();
    const currentTime = Date.now();
    const timeUntilExpiration = expirationTime - currentTime;
    
    // חדש 30 דקות לפני שפג התוקף
    const renewalTime = timeUntilExpiration - (30 * 60 * 1000);
    
    if (renewalTime > 0) {
        console.log(`⏰ Subscription יחודש אוטומטית בעוד ${Math.round(renewalTime / 60000)} דקות`);
        
        refreshInterval = setTimeout(() => {
            renewSubscription();
        }, renewalTime);
    } else {
        console.log('⚠️ Subscription פג תוקף - יחודש מיד');
        renewSubscription();
    }
}

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

    let note = 'ההתראות יגיעו ל-webhook.site שלך ויתחדשו אוטומטית';
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
        console.error('❌ שגיאה באימות:', error);
        console.error('📝 תיאור השגיאה:', error_description);
        return res.status(400).json({ 
            error: error,
            description: error_description,
            solution: 'בדקי שהאפליקציה רשומה נכון ב-Azure AD'
        });
    }
    
    if (!code) {
        return res.status(400).json({ error: 'חסר קוד אימות' });
    }
    
    try {
        console.log('🔄 מחליף קוד לטוקן...');
        
        // החלפת קוד לטוקן
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
        
        // שמירת tokens לחידוש אוטומטי
        currentAccessToken = tokenResponse.data.access_token;
        currentRefreshToken = tokenResponse.data.refresh_token;
        
        console.log('✅ התחברות הצליחה!');
        console.log('🎫 Tokens נשמרו לחידוש אוטומטי');
        
        // יצירת subscription
        const subscription = await createEmailSubscription(currentAccessToken);

        let instructions = [
            '1. לכי ל-webhook.site שלך',
            '2. שלחי מייל לעצמך', 
            '3. תראי את ההתראה מגיעה!',
            '4. המערכת תחדש את עצמה אוטומטית'
        ];
        let note = undefined;
        if (isWebhookSiteUrl(WEBHOOK_URL)) {
            note = '⚠️ webhook.site לא נתמך על ידי Microsoft Graph Push Notifications. השתמשי ב-ngrok, localhost.run או שרת משלך.';
            instructions = [
                '⚠️ webhook.site לא יעבוד עם Microsoft Graph.',
                'השתמשי ב-ngrok, localhost.run או שרת משלך.',
                'https://learn.microsoft.com/en-us/graph/webhooks'
            ];
        }

        res.json({ 
            message: '🎉 הכל מוכן! המיילים יגיעו עכשיו ל-webhook שלך',
            webhookUrl: WEBHOOK_URL,
            subscriptionId: subscription.id,
            expiresAt: subscription.expirationDateTime,
            autoRenewal: true,
            instructions,
            note
        });
    } catch (error) {
        console.error('❌ שגיאה בתהליך:', error.response?.data || error.message);
        
        if (error.response?.status === 400 && error.response?.data?.error === 'invalid_client') {
            console.error('🔑 CLIENT_ID או CLIENT_SECRET שגויים');
        } else if (error.response?.status === 400 && error.response?.data?.error === 'invalid_grant') {
            console.error('⏰ קוד האימות פג תוקף. נסי שוב');
        }
        
        res.status(500).json({ 
            error: 'שגיאה בתהליך',
            details: error.response?.data || error.message,
            solution: 'בדקי שהאפליקציה רשומה ב-Azure AD עם ההרשאות הנכונות'
        });
    }
});

// ✨ ENDPOINT חדש לקבלת התראות מ-Microsoft Graph ✨
app.post('/webhooks/microsoft-graph', (req, res) => {
    console.log('📨 קיבלנו בקשה ב-webhook endpoint');
    console.log('Headers:', req.headers);
    console.log('Query:', req.query);
    console.log('Body:', req.body);
    
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
    
    notifications.forEach(async (notification, index) => {
        const notificationData = {
            subscriptionId: notification.subscriptionId,
            resource: notification.resource,
            changeType: notification.changeType,
            clientState: notification.clientState,
            timestamp: new Date().toLocaleString('he-IL'),
            receivedAt: new Date(),
            messageId: notification.resource.split('/Messages/')[1] || 'unknown'
        };
        
        console.log(`📧 מייל חדש ${index + 1}:`, notificationData);
        
        // שמירת ההתראה לתצוגה בדף הניטור
        recentNotifications.unshift(notificationData);
        
        // שמירה של 50 ההתראות האחרונות בלבד
        if (recentNotifications.length > 50) {
            recentNotifications = recentNotifications.slice(0, 50);
        }
        
        // שליחת ההתראה ל-webhook.site אם מוגדר
        await forwardToWebhookSite(notificationData);
        
        // כאן תוכלי להוסיף לוגיקה נוספת לטיפול במייל
        // לדוגמה: שליחת התראה למערכת אחרת, שמירה בDB וכו'
    });
    
    res.status(202).send('OK');
});

// ENDPOINT נוסף ל-GET (לבדיקה)
app.get('/webhooks/microsoft-graph', (req, res) => {
    console.log('📨 קיבלנו בקשת GET ב-webhook endpoint');
    const { validationToken } = req.query;
    
    if (validationToken) {
        console.log('🔍 מאמת webhook עם Microsoft Graph (GET)...');
        console.log('✅ Validation token:', validationToken);
        return res.status(200).type('text/plain').send(validationToken);
    }
    
    res.json({ 
        message: 'Webhook endpoint פועל',
        timestamp: new Date().toLocaleString('he-IL'),
        method: 'GET'
    });
});

// Endpoint לבדוק אם ה-webhook שלך נגיש (לבדיקה עצמית)
app.get('/test-webhook-url', async (req, res) => {
    try {
        const response = await axios.post(WEBHOOK_URL, { test: true });
        res.json({ success: true, status: response.status, data: response.data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Endpoint לבדיקת מצב השרות
app.get('/health', (req, res) => {
    res.json({ 
        status: 'השרות רץ בהצלחה', 
        timestamp: new Date().toLocaleString('he-IL'),
        webhookUrl: WEBHOOK_URL,
        hasActiveSubscription: !!currentSubscriptionId,
        hasRefreshToken: !!currentRefreshToken,
        subscriptionId: currentSubscriptionId,
        environment: {
            hasClientId: !!CLIENT_ID,
            hasTenantId: !!TENANT_ID,
            hasClientSecret: !!CLIENT_SECRET
        }
    });
});

// Endpoint להפעלה מחדש ידנית של subscription
app.post('/renew-subscription', async (req, res) => {
    try {
        if (!currentAccessToken) {
            return res.status(400).json({ error: 'אין access token פעיל - התחברי קודם' });
        }
        
        await renewSubscription();
        res.json({ message: 'Subscription חודש בהצלחה', subscriptionId: currentSubscriptionId });
    } catch (error) {
        res.status(500).json({ error: 'שגיאה בחידוש subscription', details: error.message });
    }
});

// Endpoint למחיקת subscription
app.delete('/subscription', async (req, res) => {
    if (!currentSubscriptionId || !currentAccessToken) {
        return res.status(400).json({ error: 'אין subscription פעיל למחיקה' });
    }

    try {
        await axios.delete(
            `https://graph.microsoft.com/v1.0/subscriptions/${currentSubscriptionId}`,
            {
                headers: {
                    'Authorization': `Bearer ${currentAccessToken}`
                }
            }
        );
        
        currentSubscriptionId = null;
        if (refreshInterval) {
            clearTimeout(refreshInterval);
            refreshInterval = null;
        }
        
        console.log('✅ Subscription נמחק בהצלחה');
        res.json({ message: 'Subscription נמחק בהצלחה' });
    } catch (error) {
        console.error('❌ שגיאה במחיקת subscription:', error.response?.data || error.message);
        res.status(500).json({ error: 'שגיאה במחיקת subscription' });
    }
});

// הרצת השרות
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 השרות רץ על פורט ${PORT}`);
    console.log(`📍 ההתראות יגיעו ל: ${WEBHOOK_URL}`);
    console.log(`🌐 התחברות: http://localhost:${PORT}/auth/login`);
    console.log(`📊 סטטוס: http://localhost:${PORT}/health`);
    console.log(`🔔 ניטור התראות: http://localhost:${PORT}/monitor`);
    
    if (WEBHOOK_SITE_URL) {
        console.log(`📱 Webhook.site: ${WEBHOOK_SITE_URL}`);
        console.log('   ההתראות יישלחו גם ל-webhook.site לצפייה ויזואלית');
    }
    
    console.log('\n📋 הוראות:');
    console.log('1. ודאי ש-Azure AD מוגדר כראוי (CLIENT_ID, CLIENT_SECRET, TENANT_ID)');
    console.log('2. לכי ל: http://localhost:5000/auth/login');
    console.log('3. התחברי פעם אחת');
    console.log('4. המערכת תעבוד ותתחדש אוטומטית!');
    console.log('5. לכי ל: https://webhook.site/#!/view/63ed1a58-da5d-43e4-886b-345789c8eb02/55bd4bd9-4ef7-44a9-b1b7-5892981682f8/1 לראות את ההתראות');
    if (WEBHOOK_SITE_URL) {
        console.log('6. לכי ל: webhook.site לראות את ההתראות בממשק ויזואלי');
    }
    console.log('7. שלחי מייל לעצמך לבדיקה\n');
    
    // בדיקת משתני סביבה בהפעלה
    if (!validateEnvironmentVariables()) {
        console.log('\n⚠️  עדכני את קובץ ה-.env לפני שתמשיכי!');
    }
    if (isWebhookSiteUrl(WEBHOOK_URL)) {
        console.warn('\n⚠️  כתובת webhook.site לא תומכת ב-Microsoft Graph Push Notifications!');
        console.warn('   השתמשי ב-ngrok, localhost.run או שרת משלך כדי לקבל התראות.');
        console.warn('   ראי: https://learn.microsoft.com/en-us/graph/webhooks');
    }
});