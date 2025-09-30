const express = require('express');
const { ImportLogsController } = require('../controllers');
const { validation } = require('../middleware');

const router = express.Router();

// Get import logs with advanced filtering
router.get('/', 
    validation.validatePagination,
    validation.validateDateRange,
    ImportLogsController.getImportLogs
);

// Get import statistics
router.get('/statistics', 
    ImportLogsController.getImportStatistics
);

// Get failed imports
router.get('/failed', 
    validation.validatePagination,
    ImportLogsController.getFailedImports
);

// Get imports without PO numbers
router.get('/missing-po', 
    validation.validatePagination,
    ImportLogsController.getImportsWithoutPO
);

// Get import details by ID
router.get('/:id', 
    ImportLogsController.getImportDetails
);

// Get processing summary for specific email/tracking
router.get('/summary/:trackingNumber', 
    ImportLogsController.getProcessingSummary
);

// Get monitoring rules statistics
router.get('/monitoring/statistics', 
    ImportLogsController.getMonitoringStatistics
);

// Get supplier statistics
router.get('/suppliers/statistics', 
    ImportLogsController.getSupplierStatistics
);

module.exports = router;