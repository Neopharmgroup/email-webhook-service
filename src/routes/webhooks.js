const express = require('express');
const { WebhookController } = require('../controllers');

const router = express.Router();

// Main webhook endpoint
router.post('/microsoft-graph', WebhookController.handleWebhook);
router.get('/microsoft-graph', WebhookController.handleWebhookGet);

// Webhook management
router.get('/statistics', WebhookController.getStatistics);
router.post('/test', WebhookController.testWebhook);
router.post('/cleanup', WebhookController.cleanupOldNotifications);
router.post('/reprocess', WebhookController.reprocessUnprocessedNotifications);

// Automation emails management (from array)
router.get('/automation-emails', WebhookController.getAutomationEmails);
router.post('/automation-emails', WebhookController.addEmailToAutomation);
router.delete('/automation-emails/:email', WebhookController.removeEmailFromAutomation);

module.exports = router;