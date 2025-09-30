const express = require('express');
const { EmailConfigurationController } = require('../controllers');
const { validation } = require('../middleware');

const router = express.Router();

// הוספת הגדרת מייל חדשה
router.post('/', EmailConfigurationController.addConfiguration);

// קבלת כל ההגדרות (עם סינונים אופציונליים)
router.get('/', EmailConfigurationController.getAllConfigurations);

// קבלת סטטיסטיקות
router.get('/statistics', EmailConfigurationController.getStatistics);

// רענון ידני של WebhookService
router.post('/refresh-webhook-service', EmailConfigurationController.refreshWebhookServiceManual);

// ייבוא הגדרות מקובץ
router.post('/import', EmailConfigurationController.importConfigurations);

// ייצוא הגדרות לקובץ
router.get('/export', EmailConfigurationController.exportConfigurations);

// קבלת הגדרה ספציפית
router.get('/:email', 
    validation.validateEmailParam,
    EmailConfigurationController.getConfiguration
);

// עדכון הגדרת מייל
router.patch('/:email', 
    validation.validateEmailParam,
    EmailConfigurationController.updateConfiguration
);

// הפעלה/השבתה של הגדרת מייל
router.patch('/:email/toggle', 
    validation.validateEmailParam,
    EmailConfigurationController.toggleActive
);

// מחיקת הגדרת מייל
router.delete('/:email', 
    validation.validateEmailParam,
    EmailConfigurationController.removeConfiguration
);

module.exports = router;