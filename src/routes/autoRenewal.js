const express = require('express');
const { AutoRenewalController } = require('../controllers');

const router = express.Router();

// הפעלת השירות
router.post('/start', AutoRenewalController.startService);

// עצירת השירות
router.post('/stop', AutoRenewalController.stopService);

// מצב השירות
router.get('/status', AutoRenewalController.getServiceStatus);

// הרצה ידנית
router.post('/run-now', AutoRenewalController.runNow);

// עדכון הגדרות
router.patch('/settings', AutoRenewalController.updateSettings);

module.exports = router;