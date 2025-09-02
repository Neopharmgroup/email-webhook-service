/**
 * Email Webhook Service
 * Microsoft Graph Email Monitoring Microservice
 * 
 * Architecture:
 * - Models: Data layer (MongoDB collections)
 * - Services: Business logic layer
 * - Controllers: Request handling layer
 * - Routes: API endpoints definition
 * - Middleware: Request processing pipeline
 * - Utils: Helper functions and utilities
 */

const express = require('express');
const config = require('./config');
const database = require('./database/connection');
const routes = require('./routes');
const { corsMiddleware, requestLogger, errorHandler } = require('./middleware');
const { logger } = require('./utils');

class EmailWebhookService {
    constructor() {
        this.app = express();
        this.server = null;
    }

    async initialize() {
        try {
            // Initialize database connection
            await this.initializeDatabase();
            
            // Setup middleware
            this.setupMiddleware();
            
            // Setup routes
            this.setupRoutes();
            
            // Setup error handling
            this.setupErrorHandling();
            
            logger.info('✅ Email Webhook Service initialized successfully');
            
        } catch (error) {
            logger.error('❌ Failed to initialize Email Webhook Service', error);
            process.exit(1);
        }
    }

    async initializeDatabase() {
        try {
            await database.connect();
            logger.info('📄 Database connection established');
        } catch (error) {
            logger.error('❌ Database connection failed', error);
            throw error;
        }
    }

    setupMiddleware() {
        // Security middleware (reject unauthorized in production)
        if (!config.security.rejectUnauthorized) {
            process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
            logger.warn('⚠️ TLS certificate validation disabled (development mode)');
        }

        // CORS
        this.app.use(corsMiddleware);
        
        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        
        // Request logging
        this.app.use(requestLogger);
        
        logger.info('🔧 Middleware configured');
    }

    setupRoutes() {
        // API routes
        this.app.use('/api', routes);
        
        // Legacy compatibility routes (for backward compatibility)
        this.setupLegacyRoutes();
        
        // Root endpoint
        this.app.get('/', (req, res) => {
            res.json({
                service: 'Email Webhook Service',
                version: '2.0.0',
                status: 'running',
                environment: config.nodeEnv,
                apiEndpoint: '/api',
                healthCheck: '/api/dashboard/health',
                documentation: '/api',
                timestamp: new Date().toISOString()
            });
        });
        
        logger.info('🛣️ Routes configured');
    }

    setupLegacyRoutes() {
        // Legacy routes for backward compatibility
        const { MonitoredEmailController, SubscriptionController, WebhookController } = require('./controllers');
        
        // Legacy monitored emails routes
        this.app.post('/monitored-emails', MonitoredEmailController.addEmail);
        this.app.get('/monitored-emails', MonitoredEmailController.getEmails);
        this.app.patch('/monitored-emails/:email/status', MonitoredEmailController.updateEmailStatus);
        this.app.delete('/monitored-emails/:email', MonitoredEmailController.removeEmail);
        this.app.get('/monitored-emails/:email/subscription/status', SubscriptionController.getEmailSubscriptionStatus);
        
        // Legacy subscription routes
        this.app.post('/monitored-emails/:email/subscription', SubscriptionController.createSubscription);
        this.app.post('/create-subscriptions', SubscriptionController.createSubscriptionsForWaiting);
        this.app.get('/subscriptions', SubscriptionController.getActiveSubscriptions);
        
        // Legacy webhook routes
        this.app.post('/webhooks/microsoft-graph', WebhookController.handleWebhook);
        this.app.get('/webhooks/microsoft-graph', WebhookController.handleWebhookGet);
        
        // Legacy dashboard routes
        this.app.get('/dashboard/stats', require('./controllers/DashboardController').getStatistics);
        this.app.get('/audit-logs', require('./controllers/AuditController').getAuditLogs);
        this.app.get('/notifications', require('./controllers/NotificationController').getRecentNotifications);
        
        logger.info('🔄 Legacy routes configured for backward compatibility');
    }

    setupErrorHandling() {
        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Resource not found',
                path: req.originalUrl,
                method: req.method,
                suggestion: 'Check /api for available endpoints',
                timestamp: new Date().toISOString()
            });
        });
        
        // Global error handler
        this.app.use(errorHandler);
        
        logger.info('🛡️ Error handling configured');
    }

    async start() {
        try {
            const port = config.port;
            
            this.server = this.app.listen(port, () => {
                this.logStartupInfo(port);
            });
            
            // Graceful shutdown handlers
            this.setupGracefulShutdown();
            
        } catch (error) {
            logger.error('❌ Failed to start server', error);
            process.exit(1);
        }
    }

    logStartupInfo(port) {
        console.log('\n🚀 Email Webhook Service Started Successfully!');
        console.log('==========================================');
        console.log(`📡 Server: http://localhost:${port}`);
        console.log(`🌐 Environment: ${config.nodeEnv}`);
        console.log(`📄 Database: ${config.database.name}`);
        console.log(`🔗 Webhook URL: ${config.webhook.url}`);
        console.log(`📧 External Webhook: ${config.webhook.siteUrl || 'Not configured'}`);
        console.log('\n📋 API Endpoints:');
        console.log(`   📊 Dashboard: http://localhost:${port}/api/dashboard`);
        console.log(`   📧 Monitored Emails: http://localhost:${port}/api/monitored-emails`);
        console.log(`   🔔 Subscriptions: http://localhost:${port}/api/subscriptions`);
        console.log(`   📬 Webhooks: http://localhost:${port}/api/webhooks`);
        console.log(`   📨 Notifications: http://localhost:${port}/api/notifications`);
        console.log(`   📮 Emails: http://localhost:${port}/api/emails`);
        console.log(`   📜 Audit Logs: http://localhost:${port}/api/audit`);
        console.log(`   🏥 Health Check: http://localhost:${port}/api/dashboard/health`);
        console.log('\n🔧 Management:');
        console.log('   1. Add email for monitoring: POST /api/monitored-emails');
        console.log('   2. Create subscriptions: POST /api/subscriptions/create-waiting');
        console.log('   3. View dashboard: GET /api/dashboard/overview');
        console.log('   4. Check health: GET /api/dashboard/health');
        console.log('\n⚠️ Important: Azure AD Application permissions required!');
        console.log('   - Mail.Read (Application permission)');
        console.log('   - User.Read.All (Application permission)');
        console.log('==========================================\n');
        
        logger.info('🚀 Server started successfully', { port, environment: config.nodeEnv });
    }

    setupGracefulShutdown() {
        const gracefulShutdown = async (signal) => {
            logger.info(`📶 Received ${signal}, starting graceful shutdown...`);
            
            if (this.server) {
                this.server.close(async () => {
                    logger.info('🔌 HTTP server closed');
                    
                    // Close database connection
                    try {
                        await database.disconnect();
                        logger.info('📄 Database connection closed');
                    } catch (error) {
                        logger.error('❌ Error closing database connection', error);
                    }
                    
                    logger.info('✅ Graceful shutdown completed');
                    process.exit(0);
                });
                
                // Force close after 30 seconds
                setTimeout(() => {
                    logger.error('❌ Could not close connections in time, forcefully shutting down');
                    process.exit(1);
                }, 30000);
            }
        };
        
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('❌ Uncaught Exception', error);
            gracefulShutdown('UNCAUGHT_EXCEPTION');
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('❌ Unhandled Rejection', { reason, promise });
            gracefulShutdown('UNHANDLED_REJECTION');
        });
    }

    // Helper method to get app instance (for testing)
    getApp() {
        return this.app;
    }
}

// Create and start the service
const emailWebhookService = new EmailWebhookService();

// Start the service if this file is run directly
if (require.main === module) {
    emailWebhookService.initialize().then(() => {
        emailWebhookService.start();
    });
}

module.exports = emailWebhookService;