// Export all services
const AzureAuthService = require('./AzureAuthService');
const SubscriptionService = require('./SubscriptionService');
const EmailService = require('./EmailService');
const WebhookService = require('./WebhookService');
const AutoRenewalService = require('./AutoRenewalService');
const MonitoringService = require('./MonitoringService');
    
module.exports = {
    AzureAuthService,
    SubscriptionService,
    EmailService,
    WebhookService,
    AutoRenewalService,
    MonitoringService
};