const axios = require('axios');
const config = require('../config');
const AzureAuthService = require('./AzureAuthService');

class EmailService {
    constructor() {
        this.graphApiUrl = config.azure.graphApiUrl;
    }

    async getEmailContent(email, messageId) {
        try {
            const token = await AzureAuthService.getServicePrincipalToken();

            const response = await axios.get(
                `${this.graphApiUrl}/users/${email}/messages/${messageId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error(`❌ שגיאה בקריאת מייל ${messageId}:`, error.response?.data || error.message);
            throw this._handleEmailError(error);
        }
    }

    async getEmailMessages(email, options = {}) {
        try {
            const {
                limit = 10,
                filter = '',
                select = 'id,subject,from,receivedDateTime,bodyPreview,hasAttachments,importance,isRead',
                orderBy = 'receivedDateTime desc'
            } = options;

            const token = await AzureAuthService.getServicePrincipalToken();

            let url = `${this.graphApiUrl}/users/${email}/messages?$top=${limit}&$select=${select}&$orderby=${orderBy}`;
            
            if (filter) {
                url += `&$filter=${encodeURIComponent(filter)}`;
            }

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            return {
                email: email,
                totalMessages: response.data.value.length,
                messages: response.data.value,
                nextLink: response.data['@odata.nextLink']
            };
        } catch (error) {
            console.error(`❌ שגיאה בקבלת מיילים עבור ${email}:`, error.response?.data || error.message);
            throw this._handleEmailError(error);
        }
    }

    async getEmailAttachments(email, messageId) {
        try {
            const token = await AzureAuthService.getServicePrincipalToken();

            const response = await axios.get(
                `${this.graphApiUrl}/users/${email}/messages/${messageId}/attachments`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            return response.data.value;
        } catch (error) {
            console.error(`❌ שגיאה בקבלת קבצים מצורפים עבור מייל ${messageId}:`, error.response?.data || error.message);
            throw this._handleEmailError(error);
        }
    }

    async downloadAttachment(email, messageId, attachmentId) {
        try {
            const token = await AzureAuthService.getServicePrincipalToken();

            const response = await axios.get(
                `${this.graphApiUrl}/users/${email}/messages/${messageId}/attachments/${attachmentId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error(`❌ שגיאה בהורדת קובץ מצורף ${attachmentId}:`, error.response?.data || error.message);
            throw this._handleEmailError(error);
        }
    }

    async markEmailAsRead(email, messageId) {
        try {
            const token = await AzureAuthService.getServicePrincipalToken();

            await axios.patch(
                `${this.graphApiUrl}/users/${email}/messages/${messageId}`,
                {
                    isRead: true
                },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return true;
        } catch (error) {
            console.error(`❌ שגיאה בסימון מייל ${messageId} כנקרא:`, error.response?.data || error.message);
            throw this._handleEmailError(error);
        }
    }

    async searchEmails(email, searchQuery, options = {}) {
        try {
            const {
                limit = 20,
                select = 'id,subject,from,receivedDateTime,bodyPreview,hasAttachments,importance,isRead'
            } = options;

            const token = await AzureAuthService.getServicePrincipalToken();

            const response = await axios.get(
                `${this.graphApiUrl}/users/${email}/messages?$search="${encodeURIComponent(searchQuery)}"&$top=${limit}&$select=${select}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            return {
                email: email,
                searchQuery: searchQuery,
                totalResults: response.data.value.length,
                messages: response.data.value
            };
        } catch (error) {
            console.error(`❌ שגיאה בחיפוש מיילים עבור ${email}:`, error.response?.data || error.message);
            throw this._handleEmailError(error);
        }
    }

    async getEmailFolders(email) {
        try {
            const token = await AzureAuthService.getServicePrincipalToken();

            const response = await axios.get(
                `${this.graphApiUrl}/users/${email}/mailFolders`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            return response.data.value;
        } catch (error) {
            console.error(`❌ שגיאה בקבלת תיקיות מייל עבור ${email}:`, error.response?.data || error.message);
            throw this._handleEmailError(error);
        }
    }

    async getUnreadCount(email) {
        try {
            const token = await AzureAuthService.getServicePrincipalToken();

            const response = await axios.get(
                `${this.graphApiUrl}/users/${email}/messages/$count?$filter=isRead eq false`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            return parseInt(response.data);
        } catch (error) {
            console.error(`❌ שגיאה בקבלת מספר מיילים לא נקראים עבור ${email}:`, error.response?.data || error.message);
            throw this._handleEmailError(error);
        }
    }

    async getUserProfile(email) {
        try {
            const token = await AzureAuthService.getServicePrincipalToken();

            const response = await axios.get(
                `${this.graphApiUrl}/users/${email}?$select=id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error(`❌ שגיאה בקבלת פרופיל משתמש ${email}:`, error.response?.data || error.message);
            throw this._handleEmailError(error);
        }
    }

    _handleEmailError(error) {
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data;

            switch (status) {
                case 401:
                    return new Error('שגיאת הרשאה - נדרשות הרשאות Mail.Read');
                case 403:
                    return new Error(`אין הרשאות לגישה למייל: ${data?.error?.message || 'Forbidden'}`);
                case 404:
                    return new Error('מייל או משתמש לא נמצא');
                case 429:
                    return new Error('יותר מדי בקשות - נסה שוב מאוחר יותר');
                default:
                    return new Error(`שגיאה ב-Microsoft Graph API: ${data?.error?.message || error.message}`);
            }
        }
        
        return error;
    }
}

module.exports = new EmailService();