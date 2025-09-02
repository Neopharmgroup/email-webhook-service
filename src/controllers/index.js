// Export all controllers
const MonitoredEmailController = require('./MonitoredEmailController');
const SubscriptionController = require('./SubscriptionController');
const WebhookController = require('./WebhookController');
const NotificationController = require('./NotificationController');
const EmailController = require('./EmailController');
const DashboardController = require('./DashboardController');
const AuditController = require('./AuditController');

module.exports = {
    MonitoredEmailController,
    SubscriptionController,
    WebhookController,
    NotificationController,
    EmailController,
    DashboardController,
    AuditController
};