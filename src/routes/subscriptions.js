const express = require('express');
const { SubscriptionController } = require('../controllers');
const { validation } = require('../middleware');

const router = express.Router();

// Create subscription for specific email
router.post('/emails/:email/subscription', 
    validation.validateEmailParam,
    validation.validateSubscriptionBody,
    SubscriptionController.createSubscription
);

// Get subscription status for specific email
router.get('/emails/:email/subscription/status', 
    validation.validateEmailParam,
    SubscriptionController.getEmailSubscriptionStatus
);

// Renew subscription
router.patch('/:subscriptionId/renew', 
    SubscriptionController.renewSubscription
);

// Delete subscription
router.delete('/:subscriptionId', 
    SubscriptionController.deleteSubscription
);

// Get subscription info
router.get('/:subscriptionId', 
    SubscriptionController.getSubscriptionInfo
);

// Get all active subscriptions
router.get('/', 
    validation.validatePagination,
    SubscriptionController.getActiveSubscriptions
);

// Get subscriptions expiring soon
router.get('/expiring', 
    SubscriptionController.getExpiringSoon
);

// Auto-renew expiring subscriptions
router.post('/renew-expiring', 
    SubscriptionController.renewExpiringSoon
);

// Validate all subscriptions
router.post('/validate-all', 
    SubscriptionController.validateAllSubscriptions
);

// Create subscriptions for waiting emails
router.post('/create-waiting', 
    SubscriptionController.createSubscriptionsForWaiting
);

// Get statistics
router.get('/statistics', 
    SubscriptionController.getStatistics
);

module.exports = router;