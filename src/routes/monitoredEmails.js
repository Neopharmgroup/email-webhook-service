const express = require('express');
const { MonitoredEmailController } = require('../controllers');
const { validation } = require('../middleware');

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

router.get('/:email', 
    validation.validateEmailParam,
    MonitoredEmailController.getEmailDetails
);

router.patch('/:email/status', 
    validation.validateEmailParam,
    MonitoredEmailController.updateEmailStatus
);

router.delete('/:email', 
    validation.validateEmailParam,
    MonitoredEmailController.removeEmail
);

module.exports = router;