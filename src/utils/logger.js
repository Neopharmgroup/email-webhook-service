// Logger utility
const config = require('../config');

class Logger {
    constructor() {
        this.level = config.logging.level;
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
    }

    shouldLog(level) {
        return this.levels[level] <= this.levels[this.level];
    }

    formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const prefix = this.getPrefix(level);
        
        let formatted = `${timestamp} ${prefix} ${message}`;
        
        if (data) {
            formatted += '\n' + JSON.stringify(data, null, 2);
        }
        
        return formatted;
    }

    getPrefix(level) {
        const prefixes = {
            error: '❌ ERROR',
            warn: '⚠️  WARN',
            info: 'ℹ️  INFO',
            debug: '🔍 DEBUG'
        };
        
        return prefixes[level] || 'INFO';
    }

    error(message, data = null) {
        if (this.shouldLog('error')) {
            console.error(this.formatMessage('error', message, data));
        }
    }

    warn(message, data = null) {
        if (this.shouldLog('warn')) {
            console.warn(this.formatMessage('warn', message, data));
        }
    }

    info(message, data = null) {
        if (this.shouldLog('info')) {
            console.info(this.formatMessage('info', message, data));
        }
    }

    debug(message, data = null) {
        if (this.shouldLog('debug')) {
            console.debug(this.formatMessage('debug', message, data));
        }
    }

    // HTTP request logging
    logRequest(req, res, duration) {
        const logData = {
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent')
        };

        if (res.statusCode >= 500) {
            this.error(`HTTP ${req.method} ${req.url}`, logData);
        } else if (res.statusCode >= 400) {
            this.warn(`HTTP ${req.method} ${req.url}`, logData);
        } else {
            this.debug(`HTTP ${req.method} ${req.url}`, logData);
        }
    }

    // Database operation logging
    logDatabase(operation, collection, result, duration) {
        const logData = {
            operation,
            collection,
            duration: `${duration}ms`,
            result: result ? 'success' : 'failed'
        };

        if (result) {
            this.debug(`DB ${operation} on ${collection}`, logData);
        } else {
            this.error(`DB ${operation} on ${collection}`, logData);
        }
    }

    // Service operation logging
    logService(service, operation, result, data = null) {
        const logData = {
            service,
            operation,
            result: result ? 'success' : 'failed',
            ...(data && { data })
        };

        if (result) {
            this.info(`${service} ${operation}`, logData);
        } else {
            this.error(`${service} ${operation}`, logData);
        }
    }

    // Security event logging
    logSecurity(event, details = {}) {
        const logData = {
            event,
            ...details,
            timestamp: new Date().toISOString()
        };

        this.warn(`SECURITY: ${event}`, logData);
    }

    // Performance logging
    logPerformance(operation, duration, threshold = 1000) {
        const logData = {
            operation,
            duration: `${duration}ms`,
            threshold: `${threshold}ms`
        };

        if (duration > threshold) {
            this.warn(`PERFORMANCE: Slow operation detected`, logData);
        } else {
            this.debug(`PERFORMANCE: ${operation}`, logData);
        }
    }
}

module.exports = new Logger();