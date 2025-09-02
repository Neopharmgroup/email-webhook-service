const config = require('../config');

// CORS Middleware
const corsMiddleware = (req, res, next) => {
    res.header('Access-Control-Allow-Origin', config.cors.origin);
    res.header('Access-Control-Allow-Methods', config.cors.methods.join(', '));
    res.header('Access-Control-Allow-Headers', config.cors.allowedHeaders.join(', '));

    // מענה לבקשות OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
};

module.exports = corsMiddleware;