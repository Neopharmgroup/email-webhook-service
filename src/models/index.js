// Export all models
const MonitoredEmail = require('./MonitoredEmail');
const Subscription = require('./Subscription');
const EmailNotification = require('./EmailNotification');
const AuditLog = require('./AuditLog');
const EmailConfiguration = require('./EmailConfiguration');
const MonitoringRule = require('./MonitoringRule');

module.exports = {
    MonitoredEmail,
    Subscription,
    EmailNotification,
    AuditLog,
    EmailConfiguration,
    MonitoringRule
};