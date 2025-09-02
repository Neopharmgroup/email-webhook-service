# Email Webhook Microservice 📧

שירות מיקרו לניטור מיילים באמצעות Microsoft Graph API עם ארכיטקטורה נקייה ומודולרית.

## 🏗️ מבנה הפרויקט

```
email-webhook/
├── app.js                  # Legacy entry point (קבצו הישן)
├── package.json           # תלות הפרויקט
├── README.md             # תיעוד הפרויקט
├── ARCHITECTURE.md       # תיעוד ארכיטקטורה
├── API.md               # תיעוד API
└── src/                 # ◄ ארכיטקטורה חדשה
    ├── app.js           # Entry point חדש
    ├── config/          # הגדרות וקונפיגורציה
    ├── database/        # חיבור וטיפול במסד נתונים
    ├── models/          # מודלים ולוגיקה עסקית
    ├── services/        # שירותים חיצוניים
    ├── controllers/     # בקרי API
    ├── routes/          # נתיבי API
    ├── middleware/      # middleware ו-interceptors
    └── utils/           # כלי עזר ופונקציות שתופיות
```

## 🚀 התחלה מהירה

### דרישות מקדימות
- Node.js 16+
- MongoDB
- Azure AD Application עם הרשאות Microsoft Graph

### התקנה

1. **שכפול הפרויקט**
```bash
cd email-webhook
```

2. **התקנת תלויות**
```bash
npm install
```

3. **הגדרת משתני סביבה**
```bash
# צור קובץ .env בשורש הפרויקט
cp .env.example .env
```

4. **הפעלת השרות**
```bash
# פיתוח עם hot reload
npm run dev

# production
npm start

# legacy (הקובץ הישן)
npm run legacy
```

## ⚙️ משתני סביבה

```env
# Azure AD Configuration
CLIENT_ID=your-azure-app-client-id
CLIENT_SECRET=your-azure-app-client-secret
TENANT_ID=your-azure-tenant-id

# Webhook Configuration
WEBHOOK_URL=https://your-domain.com/webhooks/microsoft-graph
WEBHOOK_SITE_URL=https://your-notification-site.com/webhook

# Database Configuration
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=email-webhooks

# Server Configuration
PORT=8080
NODE_ENV=development
```

## 📚 שימוש

### 1. הוספת מייל לניטור
```bash
curl -X POST http://localhost:8080/monitored-emails \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@domain.com",
    "displayName": "שם המשתמש",
    "department": "IT",
    "monitoringReason": "בקשה מהנהלה",
    "addedBy": "admin@company.com",
    "priority": "HIGH",
    "preApproved": true,
    "autoCreateSubscription": true
  }'
```

### 2. קבלת רשימת מיילים מנוטרים
```bash
curl http://localhost:8080/monitored-emails
```

### 3. יצירת subscription למייל
```bash
curl -X POST http://localhost:8080/monitored-emails/user@domain.com/subscription \
  -H "Content-Type: application/json" \
  -d '{
    "createdBy": "admin@company.com"
  }'
```

### 4. צפייה בסטטיסטיקות
```bash
curl http://localhost:8080/dashboard/stats
```

## 🔄 תהליך העבודה

1. **הוספת מייל** - מוסיפים מייל לרשימת הניטור
2. **הגדרת הרשאות** - מנהל אבטחה מגדיר הרשאות ב-Azure AD
3. **יצירת Subscription** - יוצרים subscription ב-Microsoft Graph
4. **ניטור אוטומטי** - המערכת מקבלת התראות על מיילים חדשים

## 🛠️ פקודות שימושיות

```bash
# פיתוח עם watch mode
npm run dev:watch

# debug mode
npm run dev:debug

# production mode
npm run prod

```

## 📖 תיעוד נוסף

- [📐 ARCHITECTURE.md](./ARCHITECTURE.md) - תיעוד מפורט של הארכיטקטורה
- [🔌 API.md](./API.md) - תיעוד מלא של ה-API

## 🔧 הגדרות Azure AD

### הרשאות נדרשות
- `Mail.Read` (Application)
- `Mail.ReadWrite` (Application) - אופציונלי
- `User.Read.All` (Application)

### Webhook URL
יש להגדיר את ה-webhook URL ב-Azure AD Application:
```
https://your-domain.com/webhooks/microsoft-graph
```

## 🐳 Docker

```bash
# Build
docker build -t email-webhook-service .

# Run
docker run -p 8080:8080 -e NODE_ENV=production email-webhook-service
```

## 🔍 בדיקת תקינות

```bash
# בדיקת שרת
curl http://localhost:8080/dashboard/stats

# בדיקת webhook
curl http://localhost:8080/webhooks/microsoft-graph
```

## 📋 מצבי Status

- `WAITING_FOR_AZURE_SETUP` - ממתין להגדרת הרשאות
- `ACTIVE` - פעיל ומנוטר
- `INACTIVE` - לא פעיל

## 🚨 Troubleshooting

### שגיאות נפוצות

1. **401 Unauthorized**
   - בדוק הרשאות Azure AD
   - ודא שהמפתחות נכונים

2. **MongoDB Connection Error**
   - בדוק שMongoDB רץ
   - ודא את connection string

3. **Webhook Validation Failed**
   - בדוק שה-URL נגיש מהאינטרנט
   - ודא HTTPS

## 👥 תרומה

1. Fork הפרויקט
2. צור branch חדש (`git checkout -b feature/amazing-feature`)
3. Commit השינויים (`git commit -m 'Add amazing feature'`)
4. Push ל-branch (`git push origin feature/amazing-feature`)
5. פתח Pull Request


---

**מפותח על ידי צוות Neopharm** 🏥
