require('dotenv').config();

const config = {
    // Server Configuration
    port: process.env.PORT || 8080,
    nodeEnv: process.env.NODE_ENV || 'development',
    
    // Azure AD Configuration
    azure: {
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        tenantId: process.env.TENANT_ID,
        graphApiUrl: 'https://graph.microsoft.com/v1.0',
        authUrl: `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`,
        scope: 'https://graph.microsoft.com/.default'
    },
    
    // Webhook Configuration
    webhook: {
        url: process.env.WEBHOOK_URL,
        siteUrl: process.env.WEBHOOK_SITE_URL,
        maxExpirationMinutes: 4230, // Maximum webhook expiration time in minutes (Microsoft Graph limit)
        defaultExpirationHours: 72, // 72 hours as requested
        renewalThresholdHours: 24, // Renew subscriptions 24 hours before expiry
        cleanupIntervalHours: 6 // Run cleanup every 6 hours
    },
    
    // MongoDB Configuration
    database: {
        uri: process.env.MONGODB_URI,
        name: process.env.MONGODB_DB_NAME || 'email-webhooks',
        options: {
            useNewUrlParser: true,
            useUnifiedTopology: true
        }
    },
    
    // CORS Configuration
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
    },
    
    // Security Configuration
    security: {
        rejectUnauthorized: process.env.NODE_ENV === 'production'
    },
    
    // Logging Configuration
    logging: {
        level: process.env.LOG_LEVEL || 'info'
    }
};

// Validation
const requiredEnvVars = [
    'CLIENT_ID',
    'CLIENT_SECRET', 
    'TENANT_ID',
    'WEBHOOK_URL',
    'MONGODB_URI'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars);
    process.exit(1);
}

module.exports = config;