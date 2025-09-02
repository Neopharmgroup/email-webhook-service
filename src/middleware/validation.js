// Validation middleware
const { validateEmail } = require('../utils/helpers');

// Validate email parameter in URL
const validateEmailParam = (req, res, next) => {
    const email = decodeURIComponent(req.params.email);
    
    if (!validateEmail(email)) {
        return res.status(400).json({
            error: 'כתובת מייל לא תקינה',
            email: email
        });
    }
    
    req.params.email = email;
    next();
};

// Validate request body for adding email
const validateAddEmailBody = (req, res, next) => {
    const { email, monitoringReason, addedBy } = req.body;
    
    const errors = [];
    
    if (!email) {
        errors.push('חסר פרמטר: email');
    } else if (!validateEmail(email)) {
        errors.push('כתובת מייל לא תקינה');
    }
    
    if (!monitoringReason) {
        errors.push('חסר פרמטר: monitoringReason');
    }
    
    if (!addedBy) {
        errors.push('חסר פרמטר: addedBy');
    }
    
    if (errors.length > 0) {
        return res.status(400).json({
            error: 'שגיאות בוולידציה',
            details: errors
        });
    }
    
    next();
};

// Validate subscription creation body
const validateSubscriptionBody = (req, res, next) => {
    const { createdBy } = req.body;
    
    if (!createdBy) {
        return res.status(400).json({
            error: 'חסר פרמטר חובה: createdBy'
        });
    }
    
    next();
};

// Validate pagination parameters
const validatePagination = (req, res, next) => {
    const limit = parseInt(req.query.limit);
    const offset = parseInt(req.query.offset);
    
    if (limit && (isNaN(limit) || limit < 1 || limit > 1000)) {
        return res.status(400).json({
            error: 'פרמטר limit חייב להיות מספר בין 1 ל-1000'
        });
    }
    
    if (offset && (isNaN(offset) || offset < 0)) {
        return res.status(400).json({
            error: 'פרמטר offset חייב להיות מספר חיובי'
        });
    }
    
    next();
};

// Validate date range parameters
const validateDateRange = (req, res, next) => {
    const { startDate, endDate } = req.query;
    
    if (startDate && isNaN(Date.parse(startDate))) {
        return res.status(400).json({
            error: 'תאריך התחלה לא תקין'
        });
    }
    
    if (endDate && isNaN(Date.parse(endDate))) {
        return res.status(400).json({
            error: 'תאריך סיום לא תקין'
        });
    }
    
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
        return res.status(400).json({
            error: 'תאריך התחלה חייב להיות לפני תאריך הסיום'
        });
    }
    
    next();
};

// Validate ObjectId parameter
const validateObjectId = (paramName) => {
    return (req, res, next) => {
        const id = req.params[paramName];
        
        if (!id || !isValidObjectId(id)) {
            return res.status(400).json({
                error: `${paramName} לא תקין`
            });
        }
        
        next();
    };
};

// Helper function to validate ObjectId
function isValidObjectId(id) {
    if (!id || typeof id !== 'string') return false;
    return /^[0-9a-fA-F]{24}$/.test(id);
}

module.exports = {
    validateEmailParam,
    validateAddEmailBody,
    validateSubscriptionBody,
    validatePagination,
    validateDateRange,
    validateObjectId
};