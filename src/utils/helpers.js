// Helper functions

// Email validation
function validateEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Get next steps for user guidance
function getNextSteps(preApproved, autoCreateSubscription, subscriptionResult, subscriptionError) {
    const steps = [];
    
    if (subscriptionResult) {
        steps.push('✅ המייל פעיל ומנוטר');
        steps.push('📊 ניתן לצפות בסטטיסטיקות בדשבורד');
        steps.push('🔔 התראות יתקבלו אוטומטית');
    } else if (subscriptionError) {
        steps.push('⚠️ יש לתקן את בעיית ה-subscription');
        steps.push('🛠️ בדוק הרשאות Azure AD');
        steps.push('🔄 נסה ליצור subscription ידנית');
    } else if (preApproved === true) {
        steps.push('👍 המייל מאושר ומוכן');
        steps.push('➕ צור subscription דרך ממשק הניהול');
        steps.push('🎯 או השתמש ב-API לייצירה אוטומטית');
    } else {
        steps.push('⏳ המייל ממתין לאישור');
        steps.push('👨‍💼 פנה למנהל אבטחת מידע');
        steps.push('🔐 נדרשות הרשאות Azure AD');
    }
    
    return steps;
}

// Format date for display
function formatDate(date) {
    if (!date) return 'לא זמין';
    
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'תאריך לא תקין';
    
    return d.toLocaleString('he-IL', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Calculate time difference in human readable format
function getTimeDifference(date1, date2 = new Date()) {
    const diff = Math.abs(date2 - date1);
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} ימים`;
    if (hours > 0) return `${hours} שעות`;
    if (minutes > 0) return `${minutes} דקות`;
    return `${seconds} שניות`;
}

// Sanitize input string
function sanitizeString(str) {
    if (!str || typeof str !== 'string') return '';
    
    // Remove HTML tags and dangerous characters
    return str
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/[<>'"&]/g, '') // Remove dangerous characters
        .trim()
        .substring(0, 1000); // Limit length
}

// Generate unique ID
function generateUniqueId(prefix = '') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}${timestamp}_${random}`;
}

// Validate subscription ID format
function validateSubscriptionId(subscriptionId) {
    if (!subscriptionId || typeof subscriptionId !== 'string') return false;
    
    // Microsoft Graph subscription IDs are typically UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(subscriptionId);
}

// Parse and validate expiration hours
function parseExpirationHours(hours, defaultHours = 70, maxHours = 4230) {
    const parsed = parseInt(hours);
    
    if (isNaN(parsed) || parsed < 1) return defaultHours;
    if (parsed > maxHours) return maxHours;
    
    return parsed;
}

// Get status color for UI
function getStatusColor(status) {
    const colors = {
        'ACTIVE': 'green',
        'WAITING_FOR_AZURE_SETUP': 'orange',
        'INACTIVE': 'red',
        'PROCESSING': 'blue',
        'ERROR': 'red',
        'SUCCESS': 'green',
        'WARNING': 'orange'
    };
    
    return colors[status] || 'gray';
}

// Get status text in Hebrew
function getStatusText(status) {
    const texts = {
        'ACTIVE': 'פעיל',
        'WAITING_FOR_AZURE_SETUP': 'ממתין להגדרת Azure',
        'INACTIVE': 'לא פעיל',
        'PROCESSING': 'בעיבוד',
        'ERROR': 'שגיאה',
        'SUCCESS': 'הצלחה',
        'WARNING': 'אזהרה'
    };
    
    return texts[status] || status;
}

// Format file size
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

// Validate priority level
function validatePriority(priority) {
    const validPriorities = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];
    return validPriorities.includes(priority) ? priority : 'NORMAL';
}

// Create paginated response
function createPaginatedResponse(data, page = 1, limit = 50, total = null) {
    const currentPage = Math.max(1, parseInt(page));
    const pageSize = Math.max(1, Math.min(1000, parseInt(limit)));
    const totalItems = total !== null ? total : data.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    
    return {
        data: data.slice((currentPage - 1) * pageSize, currentPage * pageSize),
        pagination: {
            currentPage,
            pageSize,
            totalItems,
            totalPages,
            hasNext: currentPage < totalPages,
            hasPrevious: currentPage > 1
        }
    };
}

// Validate and parse date
function parseDate(dateString) {
    if (!dateString) return null;
    
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    
    return date;
}

// Get environment info
function getEnvironmentInfo() {
    return {
        nodeEnv: process.env.NODE_ENV || 'development',
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
    };
}

// Sleep function for delays
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    validateEmail,
    getNextSteps,
    formatDate,
    getTimeDifference,
    sanitizeString,
    generateUniqueId,
    validateSubscriptionId,
    parseExpirationHours,
    getStatusColor,
    getStatusText,
    formatFileSize,
    validatePriority,
    createPaginatedResponse,
    parseDate,
    getEnvironmentInfo,
    sleep
};