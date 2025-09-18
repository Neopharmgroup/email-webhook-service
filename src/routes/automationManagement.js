const express = require('express');
const WebhookService = require('../services/WebhookService');

const router = express.Router();

/**
 * API עבור ניהול רשימת מיילים לאוטומציה
 */

// קבלת רשימת מיילים לאוטומציה
router.get('/automation-emails', async (req, res) => {
    try {
        const emails = WebhookService.getAutomationEmails();
        const statistics = WebhookService.getEmailListStatistics();
        
        res.json({
            success: true,
            emails: emails,
            statistics: statistics,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// הוספת מייל לרשימת האוטומציה
router.post('/automation-emails', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'חסר שדה email בבקשה'
            });
        }
        
        const result = WebhookService.addEmailToAutomationSmart(email);
        
        if (result.success) {
            res.status(201).json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// הסרת מייל מרשימת האוטומציה
router.delete('/automation-emails/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const result = WebhookService.removeEmailFromAutomationSmart(email);
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(404).json(result);
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// בדיקה האם מייל ברשימת האוטומציה
router.get('/automation-emails/check/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const result = WebhookService.isEmailInAutomationList(email);
        
        res.json({
            success: true,
            email: email,
            inAutomationList: result.inList,
            matchType: result.matchType,
            match: result.match,
            domain: result.domain || null
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ייצוא רשימת מיילים
router.get('/automation-emails/export', async (req, res) => {
    try {
        const exportData = WebhookService.exportEmailList();
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="automation-emails-${Date.now()}.json"`);
        res.json(exportData);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ייבוא רשימת מיילים
router.post('/automation-emails/import', async (req, res) => {
    try {
        const { emails } = req.body;
        
        if (!emails) {
            return res.status(400).json({
                success: false,
                error: 'חסר שדה emails בבקשה'
            });
        }
        
        const result = WebhookService.importEmailList(emails);
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// בדיקת ספק וסוג מסמך למייל
router.post('/identify-supplier', async (req, res) => {
    try {
        const { sender, subject, attachments } = req.body;
        
        if (!sender && !subject) {
            return res.status(400).json({
                success: false,
                error: 'נדרש לפחות שולח או נושא'
            });
        }
        
        const result = WebhookService.identifySupplierAndDocumentType(
            sender, 
            subject, 
            attachments || []
        );
        
        res.json({
            success: true,
            result: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// סטטיסטיקות כלליות
router.get('/statistics', async (req, res) => {
    try {
        const emailStats = WebhookService.getEmailListStatistics();
        const webhookStats = await WebhookService.getWebhookStatistics();
        
        res.json({
            success: true,
            emailList: emailStats,
            webhooks: webhookStats,
            systemInfo: {
                azureConnected: !!WebhookService.blobServiceClient,
                automationServiceUrl: WebhookService.automationServiceUrl
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
