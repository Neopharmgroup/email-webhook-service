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
router.post('/process-unprocessed', WebhookController.processUnprocessedNotifications); // Manual processing of unprocessed notifications

// System diagnosis
router.get('/system-diagnosis', WebhookController.systemDiagnosis);
router.get('/check-graph-subscriptions', WebhookController.checkGraphSubscriptions);
router.post('/test-manual', WebhookController.testWebhookManually);

// Automation emails management (from array)
router.get('/automation-emails', WebhookController.getAutomationEmails);
router.post('/automation-emails', WebhookController.addEmailToAutomation);
router.delete('/automation-emails/:email', WebhookController.removeEmailFromAutomation);

module.exports = router;