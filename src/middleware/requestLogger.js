const { AuditLog } = require('../models');

// Request logging middleware
const requestLogger = (req, res, next) => {
    const startTime = Date.now();
    
    // Log request details
    console.log(`📥 ${req.method} ${req.path} - ${req.ip || 'unknown'}`);
    
    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        console.log(`📤 ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
        
        // Log to audit if it's an important endpoint
        if (shouldAuditRequest(req)) {
            AuditLog.create({
                action: `HTTP_${req.method}`,
                resourceType: 'API_ENDPOINT',
                resourceId: req.path,
                details: {
                    method: req.method,
                    path: req.path,
                    statusCode: res.statusCode,
                    duration: duration,
                    userAgent: req.get('User-Agent'),
                    query: req.query,
                    body: sanitizeBody(req.body)
                },
                performedBy: req.body?.addedBy || req.body?.createdBy || req.body?.updatedBy || 'ANONYMOUS',
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent')
            }).catch(console.error);
        }
        
        originalEnd.call(this, chunk, encoding);
    };
    
    next();
};

// Determine if request should be audited
function shouldAuditRequest(req) {
    const auditPaths = [
        '/monitored-emails',
        '/subscriptions',
        '/webhooks'
    ];
    
    const auditMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    
    return auditMethods.includes(req.method) && 
           auditPaths.some(path => req.path.startsWith(path));
}

// Sanitize request body for logging (remove sensitive data)
function sanitizeBody(body) {
    if (!body) return {};
    
    const sanitized = { ...body };
    
    // Remove sensitive fields
    const sensitiveFields = ['password', 'secret', 'token', 'key'];
    sensitiveFields.forEach(field => {
        if (sanitized[field]) {
            sanitized[field] = '[REDACTED]';
        }
    });
    
    return sanitized;
}

module.exports = requestLogger;