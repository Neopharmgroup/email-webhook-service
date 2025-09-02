const express = require('express');
const { AuditController } = require('../controllers');
const { validation } = require('../middleware');

const router = express.Router();

// Get audit logs
router.get('/', 
    validation.validatePagination,
    validation.validateDateRange,
    AuditController.getAuditLogs
);

// Get audit statistics
router.get('/statistics', 
    AuditController.getAuditStatistics
);

// Get security events
router.get('/security', 
    validation.validatePagination,
    AuditController.getSecurityEvents
);

// Get failed operations
router.get('/failed', 
    validation.validatePagination,
    AuditController.getFailedOperations
);

// Create manual audit log
router.post('/manual', 
    AuditController.createManualLog
);

// Generate audit report
router.get('/report', 
    validation.validateDateRange,
    AuditController.generateAuditReport
);

// Delete old logs
router.delete('/old', 
    AuditController.deleteOldLogs
);

module.exports = router;