// Error handling middleware
const errorHandler = (err, req, res, next) => {
    console.error('❌ שגיאה בשרת:', err);
    
    // Default error
    let error = {
        message: 'שגיאה פנימית בשרת',
        status: 500,
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method
    };
    
    // Handle specific error types
    if (err.name === 'ValidationError') {
        error.status = 400;
        error.message = 'שגיאה בוולידציה';
        error.details = err.message;
    } else if (err.name === 'CastError') {
        error.status = 400;
        error.message = 'פרמטר לא תקין';
        error.details = err.message;
    } else if (err.code === 11000) {
        error.status = 409;
        error.message = 'רשומה כבר קיימת';
        error.details = 'הרשומה שאתה מנסה ליצור כבר קיימת במערכת';
    } else if (err.message) {
        error.message = err.message;
        error.status = err.status || 500;
    }
    
    // Add request details in development
    if (process.env.NODE_ENV !== 'production') {
        error.stack = err.stack;
        error.requestBody = req.body;
        error.requestQuery = req.query;
        error.requestParams = req.params;
    }
    
    // Log audit trail for errors
    const { AuditLog } = require('../models');
    AuditLog.create({
        action: 'ERROR_OCCURRED',
        resourceType: 'SERVER_ERROR',
        resourceId: req.path,
        details: {
            error: error.message,
            status: error.status,
            method: req.method,
            path: req.path,
            stack: err.stack,
            userAgent: req.get('User-Agent')
        },
        performedBy: 'SYSTEM',
        severity: 'ERROR',
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent')
    }).catch(console.error);
    
    res.status(error.status).json(error);
};

module.exports = errorHandler;