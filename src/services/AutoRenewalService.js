const SubscriptionService = require('./SubscriptionService');
const { logger } = require('../utils');

class AutoRenewalService {
    constructor() {
        this.isRunning = false;
        this.intervalId = null;
        this.renewalIntervalHours = 6; // כל 6 שעות
        this.hoursThreshold = 24; // תחדש subscriptions שפגים בעוד 24 שעות או פחות
    }

    start() {
        if (this.isRunning) {
            logger.warn('🔄 Auto-renewal service כבר רץ');
            return;
        }

        this.isRunning = true;
        logger.info(`🚀 מתחיל Auto-renewal service - יבדוק כל ${this.renewalIntervalHours} שעות`);

        // הרץ מיד בפעם הראשונה
        this.performRenewal();

        // קבע להריץ כל X שעות
        this.intervalId = setInterval(() => {
            this.performRenewal();
        }, this.renewalIntervalHours * 60 * 60 * 1000); // המרה לmilliseconds

        logger.info('✅ Auto-renewal service הופעל בהצלחה');
    }

    stop() {
        if (!this.isRunning) {
            logger.warn('⏹️ Auto-renewal service כבר עצור');
            return;
        }

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;
        logger.info('⏹️ Auto-renewal service הופסק');
    }

    async performRenewal() {
        try {
            logger.info(`🔄 מתחיל בדיקת subscriptions שפגים (threshold: ${this.hoursThreshold} שעות)`);

            const results = await SubscriptionService.renewExpiringSoon(this.hoursThreshold);
            
            const renewed = results.filter(r => r.status === 'renewed').length;
            const failed = results.filter(r => r.status === 'failed').length;

            if (renewed > 0 || failed > 0) {
                logger.info(`✅ Auto-renewal הושלם: ${renewed} חודש, ${failed} נכשל`);
                
                if (failed > 0) {
                    logger.warn(`⚠️ ${failed} subscriptions נכשלו בחידוש:`, 
                        results.filter(r => r.status === 'failed').map(r => `${r.email}: ${r.error}`)
                    );
                }
            } else {
                logger.info('ℹ️ אין subscriptions שדורשים חידוש כרגע');
            }

            return {
                success: true,
                renewed,
                failed,
                results
            };

        } catch (error) {
            logger.error('❌ שגיאה בAuto-renewal:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // פונקציה לשינוי הגדרות
    updateSettings(renewalIntervalHours, hoursThreshold) {
        this.renewalIntervalHours = renewalIntervalHours || this.renewalIntervalHours;
        this.hoursThreshold = hoursThreshold || this.hoursThreshold;
        
        logger.info(`🔧 הגדרות Auto-renewal עודכנו: interval=${this.renewalIntervalHours}h, threshold=${this.hoursThreshold}h`);
        
        // אם השירות רץ, הפעל מחדש עם ההגדרות החדשות
        if (this.isRunning) {
            this.stop();
            this.start();
        }
    }

    // מידע על מצב השירות
    getStatus() {
        return {
            isRunning: this.isRunning,
            renewalIntervalHours: this.renewalIntervalHours,
            hoursThreshold: this.hoursThreshold,
            nextRun: this.isRunning && this.intervalId ? 
                new Date(Date.now() + this.renewalIntervalHours * 60 * 60 * 1000).toISOString() : 
                null
        };
    }

    // הרצה ידנית
    async runNow() {
        logger.info('🔄 הרצת Auto-renewal ידנית');
        return await this.performRenewal();
    }
}

// יצירת instance יחיד (singleton)
const autoRenewalService = new AutoRenewalService();

module.exports = autoRenewalService;