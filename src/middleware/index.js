// Export all middleware
const corsMiddleware = require('./cors');
const requestLogger = require('./requestLogger');
const errorHandler = require('./errorHandler');
const validation = require('./validation');
const { decodeEmailParam, decodeAllParams } = require('./decodeParams');

module.exports = {
    corsMiddleware,
    requestLogger,
    errorHandler,
    validation,
    decodeEmailParam,
    decodeAllParams
};