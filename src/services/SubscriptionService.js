const axios = require('axios');
const config = require('../config');
const AzureAuthService = require('./AzureAuthService');
const { Subscription, AuditLog } = require('../models');

class SubscriptionService {
    constructor() {
        this.defaultExpirationHours = config.webhook.defaultExpirationHours;
        this.maxExpirationMinutes = config.webhook.maxExpirationHours;
    }

    async createSubscription(subscriptionData) {
        console.log(`🐛 DEBUG SERVICE: subscriptionData =`, subscriptionData);
        
        const {
            email,
            createdBy,
            notificationUrl = config.webhook.url,
            changeType = 'created',
            expirationHours = this.defaultExpirationHours
        } = subscriptionData;

        console.log(`🐛 DEBUG SERVICE: extracted email = ${email}`);

        try {
            console.log(`🔄 יוצר subscription עבור ${email}`);

            const token = await AzureAuthService.getServicePrincipalToken();
            const expirationDateTime = new Date(Date.now() + (expirationHours * 60 * 60 * 1000)).toISOString();

            const subscription = {
                changeType: changeType,
                notificationUrl: notificationUrl,
                resource: `users/${email}/mailFolders('Inbox')/messages`,
                expirationDateTime: expirationDateTime,
                clientState: `email_${email}_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
                latestSupportedTlsVersion: 'v1_2'
            };

            const response = await axios.post(
                `${config.azure.graphApiUrl}/subscriptions`,
                subscription,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // Save to database
            const savedSubscription = await Subscription.create({
                email: email,
                subscriptionId: response.data.id,
                resource: response.data.resource,
                expirationDateTime: response.data.expirationDateTime,
                createdBy: createdBy,
                changeType: changeType,
                clientState: response.data.clientState
            });

            console.log(`✅ Subscription נוצר עבור ${email}: ${response.data.id}`);
            return {
                subscription: savedSubscription,
                microsoftResponse: response.data
            };
        } catch (error) {
            console.error(`❌ שגיאה ביצירת subscription עבור ${email}:`, error.response?.data || error.message);
            throw this._handleSubscriptionError(error);
        }
    }

    async renewSubscription(subscriptionId, renewedBy, expirationHours = this.defaultExpirationHours) {
        try {
            console.log(`🔄 מחדש subscription: ${subscriptionId}`);

            // ולידציה של subscriptionId - בדיקה שזה GUID תקין
            if (!this._isValidGuid(subscriptionId)) {
                console.warn(`⚠️ Subscription ID לא תקין: ${subscriptionId} - מדלג`);
                throw new Error('Subscription ID format is invalid');
            }

            const token = await AzureAuthService.getServicePrincipalToken();
            const newExpirationDateTime = new Date(Date.now() + (expirationHours * 60 * 60 * 1000)).toISOString();

            const response = await axios.patch(
                `${config.azure.graphApiUrl}/subscriptions/${subscriptionId}`,
                {
                    expirationDateTime: newExpirationDateTime
                },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // Update in database
            await Subscription.updateExpiration(subscriptionId, response.data.expirationDateTime, renewedBy);

            console.log(`✅ Subscription חודש: ${subscriptionId}`);
            return { success: true, data: response.data };
        } catch (error) {
            if (error.response?.status === 404) {
                // Subscription doesn't exist in Microsoft, deactivate in DB
                await Subscription.deactivate(subscriptionId, renewedBy);
                console.log(`⚠️ Subscription ${subscriptionId} לא נמצא ב-Microsoft, בוטל במסד הנתונים`);
                // RETURN SUCCESS WITH SPECIAL FLAG INSTEAD OF THROWING
                return {
                    success: true,
                    cleaned: true,
                    message: `Subscription ${subscriptionId} לא נמצא ב-Microsoft Graph ובוטל מהמסד נתונים`
                };
            }

            console.error(`❌ שגיאה בחידוש subscription ${subscriptionId}:`, error.response?.data || error.message);
            throw this._handleSubscriptionError(error);
        }
    }

    async deleteSubscription(subscriptionId, deletedBy = 'SYSTEM') {
        try {
            console.log(`🗑️ מוחק subscription: ${subscriptionId}`);

            const token = await AzureAuthService.getServicePrincipalToken();

            await axios.delete(
                `${config.azure.graphApiUrl}/subscriptions/${subscriptionId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            // Deactivate in database
            await Subscription.deactivate(subscriptionId, deletedBy);

            console.log(`✅ Subscription נמחק: ${subscriptionId}`);
            return true;
        } catch (error) {
            if (error.response?.status === 404) {
                // Subscription doesn't exist in Microsoft, just deactivate in DB
                await Subscription.deactivate(subscriptionId, deletedBy);
                console.log(`⚠️ Subscription ${subscriptionId} לא נמצא ב-Microsoft, בוטל במסד הנתונים`);
                return true;
            }

            console.error(`❌ שגיאה במחיקת subscription ${subscriptionId}:`, error.response?.data || error.message);
            throw this._handleSubscriptionError(error);
        }
    }

    async getSubscriptionInfo(subscriptionId) {
        try {
            const token = await AzureAuthService.getServicePrincipalToken();

            const response = await axios.get(
                `${config.azure.graphApiUrl}/subscriptions/${subscriptionId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error(`❌ שגיאה בקבלת מידע על subscription ${subscriptionId}:`, error.response?.data || error.message);
            throw this._handleSubscriptionError(error);
        }
    }

    async renewExpiringSoon(hoursThreshold = 24) {
        try {
            const expiringSubs = await Subscription.getExpiringSoon(hoursThreshold);
            const results = [];

            for (const sub of expiringSubs) {
                try {
                    const renewResult = await this.renewSubscription(sub.subscriptionId, 'AUTO_RENEWAL');
                    
                    if (renewResult.cleaned) {
                        // Subscription was invalid and was cleaned up
                        results.push({
                            subscriptionId: sub.subscriptionId,
                            email: sub.email,
                            status: 'cleaned',
                            message: renewResult.message || 'Subscription was invalid and was deactivated'
                        });
                    } else {
                        // Normal renewal
                        results.push({
                            subscriptionId: sub.subscriptionId,
                            email: sub.email,
                            status: 'renewed',
                            message: 'Subscription חודש אוטומטית'
                        });
                    }
                } catch (error) {
                    // Check if it's an invalid ID error
                    if (error.message.includes('Subscription ID format is invalid')) {
                        // Deactivate the subscription in DB
                        try {
                            await Subscription.deactivate(sub.subscriptionId, 'AUTO_RENEWAL');
                            results.push({
                                subscriptionId: sub.subscriptionId,
                                email: sub.email,
                                status: 'cleaned',
                                message: 'Invalid subscription ID - deactivated',
                                error: error.message
                            });
                        } catch (deactivateError) {
                            results.push({
                                subscriptionId: sub.subscriptionId,
                                email: sub.email,
                                status: 'failed',
                                error: `Invalid ID and failed to deactivate: ${deactivateError.message}`
                            });
                        }
                    } else {
                        // Other errors
                        results.push({
                            subscriptionId: sub.subscriptionId,
                            email: sub.email,
                            status: 'failed',
                            error: error.message
                        });
                    }
                }
            }

            return results;
        } catch (error) {
            console.error('❌ שגיאה בחידוש subscriptions שפגים:', error);
            throw error;
        }
    }

    async validateAllSubscriptions() {
        try {
            const activeSubscriptions = await Subscription.getAllActive();
            const results = [];

            for (const sub of activeSubscriptions) {
                try {
                    const info = await this.getSubscriptionInfo(sub.subscriptionId);
                    results.push({
                        subscriptionId: sub.subscriptionId,
                        email: sub.email,
                        status: 'valid',
                        expiresAt: info.expirationDateTime
                    });
                } catch (error) {
                    if (error.response?.status === 404) {
                        // Subscription doesn't exist, deactivate it
                        await Subscription.deactivate(sub.subscriptionId, 'VALIDATION_CHECK');
                        results.push({
                            subscriptionId: sub.subscriptionId,
                            email: sub.email,
                            status: 'not_found',
                            action: 'deactivated'
                        });
                    } else {
                        results.push({
                            subscriptionId: sub.subscriptionId,
                            email: sub.email,
                            status: 'error',
                            error: error.message
                        });
                    }
                }
            }

            return results;
        } catch (error) {
            console.error('❌ שגיאה באימות subscriptions:', error);
            throw error;
        }
    }

    _handleSubscriptionError(error) {
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data;

            switch (status) {
                case 401:
                    return new Error('שגיאת הרשאה - נדרשות הרשאות Application ב-Azure AD');
                case 403:
                    return new Error(`אין הרשאות לגישה: ${data?.error?.message || 'Forbidden'}`);
                case 404:
                    return new Error('Subscription לא נמצא');
                case 429:
                    return new Error('יותר מדי בקשות - נסה שוב מאוחר יותר');
                default:
                    return new Error(`שגיאה ב-Microsoft Graph API: ${data?.error?.message || error.message}`);
            }
        }

        return error;
    }

    // פונקציית עזר לולידציה של GUID
    _isValidGuid(guid) {
        if (!guid || typeof guid !== 'string') {
            return false;
        }
        
        // בדיקה של פורמט GUID סטנדרטי
        const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        
        // בדיקה שזה לא GUID של אפסים
        const isAllZeros = guid === '00000000-0000-0000-0000-000000000000';
        
        // בדיקה שזה לא test subscription
        const isTestSubscription = guid.includes('test-subscription');
        
        return guidRegex.test(guid) && !isAllZeros && !isTestSubscription;
    }
}

module.exports = new SubscriptionService();