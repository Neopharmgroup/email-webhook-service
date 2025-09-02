// Export all middleware
const corsMiddleware = require('./cors');
const requestLogger = require('./requestLogger');
const errorHandler = require('./errorHandler');
const validation = require('./validation');

module.exports = {
    corsMiddleware,
    requestLogger,
    errorHandler,
    validation
};