const { AutoRenewalService } = require('../services');

class AutoRenewalController {
    // התחלת השירות
    async startService(req, res) {
        try {
            AutoRenewalService.start();
            
            res.json({
                message: 'Auto-renewal service הופעל',
                status: AutoRenewalService.getStatus(),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בהפעלת Auto-renewal service:', error);
            res.status(500).json({
                error: 'שגיאה בהפעלת השירות',
                details: error.message
            });
        }
    }

    // עצירת השירות
    async stopService(req, res) {
        try {
            AutoRenewalService.stop();
            
            res.json({
                message: 'Auto-renewal service הופסק',
                status: AutoRenewalService.getStatus(),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בעצירת Auto-renewal service:', error);
            res.status(500).json({
                error: 'שגיאה בעצירת השירות',
                details: error.message
            });
        }
    }

    // מצב השירות
    async getServiceStatus(req, res) {
        try {
            const status = AutoRenewalService.getStatus();
            
            res.json({
                service: 'Auto-renewal Service',
                ...status,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בקבלת מצב השירות:', error);
            res.status(500).json({
                error: 'שגיאה בקבלת מצב השירות',
                details: error.message
            });
        }
    }

    // הרצה ידנית
    async runNow(req, res) {
        try {
            const result = await AutoRenewalService.runNow();
            
            res.json({
                message: 'Auto-renewal הורץ ידנית',
                result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בהרצה ידנית:', error);
            res.status(500).json({
                error: 'שגיאה בהרצה ידנית',
                details: error.message
            });
        }
    }

    // עדכון הגדרות
    async updateSettings(req, res) {
        try {
            const { renewalIntervalHours, hoursThreshold } = req.body;
            
            if (renewalIntervalHours && (renewalIntervalHours < 1 || renewalIntervalHours > 24)) {
                return res.status(400).json({
                    error: 'renewalIntervalHours חייב להיות בין 1 ל-24'
                });
            }
            
            if (hoursThreshold && (hoursThreshold < 1 || hoursThreshold > 72)) {
                return res.status(400).json({
                    error: 'hoursThreshold חייב להיות בין 1 ל-72'
                });
            }
            
            AutoRenewalService.updateSettings(renewalIntervalHours, hoursThreshold);
            
            res.json({
                message: 'הגדרות עודכנו בהצלחה',
                status: AutoRenewalService.getStatus(),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ שגיאה בעדכון הגדרות:', error);
            res.status(500).json({
                error: 'שגיאה בעדכון הגדרות',
                details: error.message
            });
        }
    }
}

module.exports = new AutoRenewalController();