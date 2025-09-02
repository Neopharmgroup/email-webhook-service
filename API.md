# Email Webhook Service - API Reference

## 🚀 Quick Start

```bash
# Development
npm run dev

# Production
npm start

# With Docker
npm run docker:build
npm run docker:run
```

## 📡 Base URL
- Development: `http://localhost:8080`
- API Base: `/api`

## 🔗 Main Endpoints

### 📊 Dashboard & Health
```http
GET /api/dashboard/health          # System health check
GET /api/dashboard/stats           # General statistics
GET /api/dashboard/overview        # Dashboard overview
GET /api/dashboard/alerts          # System alerts
GET /api/dashboard/performance     # Performance metrics
POST /api/dashboard/maintenance    # Maintenance operations
```

### 📧 Monitored Emails
```http
POST /api/monitored-emails         # Add email for monitoring
GET /api/monitored-emails          # List monitored emails
GET /api/monitored-emails/{email}  # Get email details
PATCH /api/monitored-emails/{email}/status  # Update email status
DELETE /api/monitored-emails/{email}        # Remove email from monitoring
GET /api/monitored-emails/statistics        # Email statistics
```

### 🔔 Subscriptions
```http
POST /api/subscriptions/emails/{email}/subscription    # Create subscription
GET /api/subscriptions/emails/{email}/subscription/status  # Get subscription status
GET /api/subscriptions                                 # List active subscriptions
GET /api/subscriptions/{subscriptionId}               # Get subscription details
PATCH /api/subscriptions/{subscriptionId}/renew       # Renew subscription
DELETE /api/subscriptions/{subscriptionId}            # Delete subscription
GET /api/subscriptions/expiring                       # Get expiring subscriptions
POST /api/subscriptions/renew-expiring               # Auto-renew expiring
POST /api/subscriptions/validate-all                 # Validate all subscriptions
POST /api/subscriptions/create-waiting               # Create for waiting emails
```

### 📬 Webhooks
```http
POST /api/webhooks/microsoft-graph    # Webhook endpoint
GET /api/webhooks/microsoft-graph     # Webhook validation
GET /api/webhooks/statistics          # Webhook statistics
POST /api/webhooks/test               # Test webhook
POST /api/webhooks/cleanup            # Cleanup old notifications
POST /api/webhooks/reprocess          # Reprocess notifications
```

### 📨 Notifications
```http
GET /api/notifications                 # Get recent notifications
GET /api/notifications/unprocessed    # Get unprocessed notifications
GET /api/notifications/subscription/{subscriptionId}  # By subscription
PATCH /api/notifications/{notificationId}/processed   # Mark as processed
GET /api/notifications/{notificationId}/content       # Get email content
GET /api/notifications/statistics     # Notification statistics
DELETE /api/notifications/old         # Delete old notifications
```

### 📮 Email Operations
```http
GET /api/emails/{email}/messages/{messageId}           # Get email content
GET /api/emails/{email}/messages                       # List messages
GET /api/emails/{email}/search                         # Search emails
GET /api/emails/{email}/messages/{messageId}/attachments  # Get attachments
GET /api/emails/{email}/folders                        # Get email folders
GET /api/emails/{email}/unread-count                   # Get unread count
GET /api/emails/{email}/profile                        # Get user profile
PATCH /api/emails/{email}/messages/{messageId}/read    # Mark as read
```

### 📜 Audit Logs
```http
GET /api/audit                        # Get audit logs
GET /api/audit/statistics            # Audit statistics
GET /api/audit/security              # Security events
GET /api/audit/failed                # Failed operations
POST /api/audit/manual               # Create manual log
GET /api/audit/report                # Generate report
DELETE /api/audit/old                # Delete old logs
```

## 📝 Request/Response Examples

### Add Email for Monitoring
```http
POST /api/monitored-emails
Content-Type: application/json

{
  "email": "user@company.com",
  "displayName": "John Doe",
  "department": "IT",
  "monitoringReason": "Security investigation",
  "addedBy": "admin@company.com",
  "priority": "HIGH",
  "notes": "Monitor all emails",
  "preApproved": true,
  "autoCreateSubscription": true
}
```

### Response
```json
{
  "message": "מייל נוסף לניטור בהצלחה וSubscription נוצר אוטומטית",
  "status": "ACTIVE",
  "monitoredEmail": {
    "id": "60f1b2c3d4e5f6789a0b1c2d",
    "email": "user@company.com",
    "status": "ACTIVE",
    "addedAt": "2023-07-15T10:30:00.000Z",
    "preApproved": true
  },
  "subscription": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2023-07-15T10:30:00.000Z",
    "expiresAt": "2023-07-18T10:30:00.000Z",
    "status": "active"
  },
  "instruction": "המייל פעיל ומנוטר - ניטור התחיל מיידית",
  "nextSteps": [
    "✅ המייל פעיל ומנוטר",
    "📊 ניתן לצפות בסטטיסטיקות בדשבורד",
    "🔔 התראות יתקבלו אוטומטית"
  ]
}
```

### Health Check
```http
GET /api/dashboard/health
```

### Response
```json
{
  "status": "healthy",
  "timestamp": "2023-07-15T10:30:00.000Z",
  "components": {
    "database": {
      "status": "healthy",
      "timestamp": "2023-07-15T10:30:00.000Z"
    },
    "recentErrors": {
      "count": 0,
      "errors": []
    },
    "expiringSubs": {
      "count": 2,
      "subscriptions": [...]
    }
  }
}
```

## 🔧 Query Parameters

### Pagination
- `limit`: Number of items (1-1000, default: 50)
- `offset`: Skip items (default: 0)

### Filtering
- `status`: Filter by status
- `email`: Filter by email
- `startDate`: Start date (ISO format)
- `endDate`: End date (ISO format)

### Examples
```http
GET /api/monitored-emails?limit=20&status=ACTIVE
GET /api/notifications?email=user@company.com&limit=10
GET /api/audit?startDate=2023-07-01&endDate=2023-07-15
```

## ⚠️ Error Responses

All error responses follow this format:
```json
{
  "error": "Error description",
  "status": 400,
  "timestamp": "2023-07-15T10:30:00.000Z",
  "path": "/api/monitored-emails",
  "method": "POST",
  "details": "Additional error details"
}
```

## 🔐 Security

### Required Azure AD Permissions
- `Mail.Read` (Application)
- `User.Read.All` (Application)

### Environment Variables
```env
CLIENT_ID=your-azure-app-id
CLIENT_SECRET=your-azure-app-secret
TENANT_ID=your-azure-tenant-id
WEBHOOK_URL=https://your-webhook-url.com/api/webhooks/microsoft-graph
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=email-webhooks
```

## 📊 Status Codes
- `200` - Success
- `201` - Created
- `202` - Accepted (webhooks)
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `500` - Internal Server Error
- `503` - Service Unavailable

## 🔄 Legacy Compatibility

The service maintains backward compatibility with v1 endpoints:
- `/monitored-emails` → `/api/monitored-emails`
- `/webhooks/microsoft-graph` → `/api/webhooks/microsoft-graph`
- `/dashboard/stats` → `/api/dashboard/stats`

All legacy endpoints redirect to new API structure.