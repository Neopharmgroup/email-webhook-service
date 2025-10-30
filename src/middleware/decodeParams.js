/**
 * Middleware to decode URL-encoded email addresses in route parameters
 * 
 * This middleware automatically decodes email addresses that are passed as URL parameters.
 * For example: /api/emails/test%40example.com -> /api/emails/test@example.com
 * 
 * Usage:
 *   router.get('/:email', decodeEmailParam, controller.getEmail);
 */

/**
 * Decode email parameter from URL
 */
function decodeEmailParam(req, res, next) {
    if (req.params.email) {
        try {
            req.params.email = decodeURIComponent(req.params.email);
            console.log(`📧 Decoded email param: ${req.params.email}`);
        } catch (error) {
            console.error('❌ Error decoding email parameter:', error);
            return res.status(400).json({
                error: 'Invalid email parameter encoding',
                details: error.message
            });
        }
    }
    next();
}

/**
 * Decode all parameters from URL
 */
function decodeAllParams(req, res, next) {
    try {
        Object.keys(req.params).forEach(key => {
            req.params[key] = decodeURIComponent(req.params[key]);
        });
        next();
    } catch (error) {
        console.error('❌ Error decoding parameters:', error);
        return res.status(400).json({
            error: 'Invalid parameter encoding',
            details: error.message
        });
    }
}

module.exports = {
    decodeEmailParam,
    decodeAllParams
};
