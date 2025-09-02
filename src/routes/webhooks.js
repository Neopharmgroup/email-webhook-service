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

module.exports = router;