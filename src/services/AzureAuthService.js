const axios = require('axios');
const config = require('../config');

class AzureAuthService {
    constructor() {
        this.tokenCache = new Map();
        this.tokenExpirationTime = null;
    }

    async getServicePrincipalToken(forceRefresh = false) {
        const cacheKey = 'service_principal_token';
        
        // Check if we have a valid cached token
        if (!forceRefresh && this.tokenCache.has(cacheKey) && this.tokenExpirationTime && new Date() < this.tokenExpirationTime) {
            return this.tokenCache.get(cacheKey);
        }

        try {
            console.log('🔄 מקבל Service Principal token...');
            
            const response = await axios.post(
                config.azure.authUrl,
                new URLSearchParams({
                    client_id: config.azure.clientId,
                    client_secret: config.azure.clientSecret,
                    scope: config.azure.scope,
                    grant_type: 'client_credentials'
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            const token = response.data.access_token;
            const expiresIn = response.data.expires_in || 3600; // Default to 1 hour
            
            // Cache the token
            this.tokenCache.set(cacheKey, token);
            this.tokenExpirationTime = new Date(Date.now() + (expiresIn - 300) * 1000); // Refresh 5 minutes before expiry
            
            console.log('✅ Service Principal token התקבל בהצלחה');
            return token;
        } catch (error) {
            console.error('❌ שגיאה בקבלת Service Principal token:', error.response?.data || error.message);
            
            // Clear cache on error
            this.tokenCache.delete(cacheKey);
            this.tokenExpirationTime = null;
            
            throw new Error(`Failed to get Service Principal token: ${error.response?.data?.error_description || error.message}`);
        }
    }

    async validateToken(token) {
        try {
            // Try to make a simple Graph API call to validate the token
            const response = await axios.get(
                `${config.azure.graphApiUrl}/applications`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );
            return response.status === 200;
        } catch (error) {
            return false;
        }
    }

    clearTokenCache() {
        this.tokenCache.clear();
        this.tokenExpirationTime = null;
    }

    getTokenExpirationTime() {
        return this.tokenExpirationTime;
    }

    isTokenExpired() {
        if (!this.tokenExpirationTime) return true;
        return new Date() >= this.tokenExpirationTime;
    }
}

module.exports = new AzureAuthService();