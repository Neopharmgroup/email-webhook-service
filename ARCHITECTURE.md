# Email Webhook Service - Architecture Documentation

## 🏗️ Architecture Overview

This microservice follows **Clean Architecture** principles with clear separation of concerns:

```
src/
├── app.js              # Main application entry point
├── config/             # Configuration management
├── database/           # Database connection and setup
├── models/             # Data layer (MongoDB collections)
├── services/           # Business logic layer
├── controllers/        # Request handling layer
├── routes/             # API endpoints definition
├── middleware/         # Request processing pipeline
└── utils/              # Helper functions and utilities
```

## 📚 Layer Responsibilities

### 1. **Models Layer** (`src/models/`)
- Data access and manipulation
- Database operations
- Data validation
- Audit logging

**Files:**
- `MonitoredEmail.js` - Managed email addresses
- `Subscription.js` - Microsoft Graph subscriptions
- `EmailNotification.js` - Incoming webhook notifications
- `AuditLog.js` - System audit trail

### 2. **Services Layer** (`src/services/`)
- Business logic implementation
- External API integration
- Complex operations orchestration

**Files:**
- `AzureAuthService.js` - Microsoft Graph authentication
- `SubscriptionService.js` - Subscription management
- `EmailService.js` - Email operations via Graph API
- `WebhookService.js` - Webhook processing logic

### 3. **Controllers Layer** (`src/controllers/`)
- HTTP request/response handling
- Input validation
- Response formatting
- Error handling

**Files:**
- `MonitoredEmailController.js` - Email monitoring endpoints
- `SubscriptionController.js` - Subscription management endpoints
- `WebhookController.js` - Webhook endpoints
- `NotificationController.js` - Notification management
- `EmailController.js` - Email content access
- `DashboardController.js` - System statistics and health
- `AuditController.js` - Audit log management

### 4. **Routes Layer** (`src/routes/`)
- API endpoint definitions
- Route-specific middleware
- Parameter validation

### 5. **Middleware Layer** (`src/middleware/`)
- Cross-cutting concerns
- Request preprocessing
- Security, logging, validation

### 6. **Configuration Layer** (`src/config/`)
- Environment management
- Service configuration
- Validation of required settings

### 7. **Database Layer** (`src/database/`)
- Database connection management
- Index creation
- Health checks

### 8. **Utils Layer** (`src/utils/`)
- Helper functions
- Common utilities
- Logging utilities

## 🔄 Request Flow

```
Incoming Request
      ↓
  Middleware
   (CORS, Logging, Validation)
      ↓
    Routes
   (Endpoint Mapping)
      ↓
  Controllers
   (Request Handling)
      ↓
   Services
   (Business Logic)
      ↓
    Models
   (Data Access)
      ↓
   Database
   (MongoDB)
```

## 🎯 Key Benefits

1. **Maintainability**: Clear separation of concerns
2. **Testability**: Each layer can be tested independently
3. **Scalability**: Easy to add new features or modify existing ones
4. **Reusability**: Services and utilities can be reused across controllers
5. **Security**: Centralized validation and error handling
6. **Monitoring**: Built-in logging and audit trails

## 🔧 Configuration Management

All configuration is centralized in `src/config/index.js`:
- Environment variables validation
- Default values
- Type conversion
- Configuration categories (Azure, Database, Security, etc.)

## 📊 Error Handling Strategy

1. **Validation Errors**: Caught at middleware level
2. **Business Logic Errors**: Handled in services
3. **Database Errors**: Handled in models
4. **Global Errors**: Caught by error middleware
5. **Audit Trail**: All errors logged to audit system

## 🔍 Monitoring & Observability

- **Request Logging**: All requests logged with timing
- **Audit Trail**: All important operations logged
- **Health Checks**: Database and service health monitoring
- **Performance Metrics**: Response times and system stats
- **Error Tracking**: Comprehensive error logging

## 🚀 Deployment

The service supports multiple deployment methods:
- Direct Node.js execution
- Docker containers
- Development with hot reload

## 📖 API Documentation

The service provides:
- RESTful API endpoints
- Consistent response formats
- Comprehensive error messages
- Backward compatibility with legacy endpoints