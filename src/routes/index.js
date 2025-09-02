const express = require('express');

// Import all route modules
const monitoredEmailsRouter = require('./monitoredEmails');
const subscriptionsRouter = require('./subscriptions');
const webhooksRouter = require('./webhooks');
const notificationsRouter = require('./notifications');
const emailsRouter = require('./emails');
const dashboardRouter = require('./dashboard');
const auditRouter = require('./audit');

const router = express.Router();

// API version info
router.get('/', (req, res) => {
    res.json({
        service: 'Email Webhook Service',
        version: '1.0.0',
        description: 'Microsoft Graph Email Monitoring Service',
        endpoints: {
            monitoredEmails: '/api/monitored-emails',
            subscriptions: '/api/subscriptions',
            webhooks: '/api/webhooks',
            notifications: '/api/notifications',
            emails: '/api/emails',
            dashboard: '/api/dashboard',
            audit: '/api/audit'
        },
        documentation: '/api/docs',
        health: '/api/dashboard/health',
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'email-webhook-service',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Mount route modules
router.use('/monitored-emails', monitoredEmailsRouter);
router.use('/subscriptions', subscriptionsRouter);
router.use('/webhooks', webhooksRouter);
router.use('/notifications', notificationsRouter);
router.use('/emails', emailsRouter);
router.use('/dashboard', dashboardRouter);
router.use('/audit', auditRouter);

// 404 handler for API routes
router.use('*', (req, res) => {
    res.status(404).json({
        error: 'API endpoint not found',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

module.exports = router;