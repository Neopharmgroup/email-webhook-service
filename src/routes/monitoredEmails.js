const express = require('express');
const { MonitoredEmailController } = require('../controllers');
const { SubscriptionController } = require('../controllers');
const { validation, decodeEmailParam } = require('../middleware');

const router = express.Router();

// Routes for monitored emails
router.post('/', 
    validation.validateAddEmailBody,
    MonitoredEmailController.addEmail
);

router.get('/', 
    validation.validatePagination,
    MonitoredEmailController.getEmails
);

router.get('/statistics', 
    MonitoredEmailController.getStatistics
);

// Routes for automation emails
router.post('/automation', 
    MonitoredEmailController.addForAutomation
);

router.get('/automation/list', 
    MonitoredEmailController.getAutomationEmails
);

router.get('/:email', 
    decodeEmailParam,
    validation.validateEmailParam,
    MonitoredEmailController.getEmailDetails
);

router.patch('/:email/status', 
    decodeEmailParam,
    validation.validateEmailParam,
    MonitoredEmailController.updateEmailStatus
);

router.delete('/:email', 
    decodeEmailParam,
    validation.validateEmailParam,
    MonitoredEmailController.removeEmail
);

// Add subscription creation route for monitored emails
router.post('/:email/subscription', 
    decodeEmailParam,
    validation.validateEmailParam,
    SubscriptionController.createSubscription
);

module.exports = router;