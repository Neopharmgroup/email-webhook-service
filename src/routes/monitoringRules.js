const express = require('express');
const { MonitoringRuleController } = require('../controllers');

const router = express.Router();

// Routes

/**
 * @route GET /api/monitoring-rules
 * @desc Get all monitoring rules with optional filters and pagination
 * @query emailAddress - Filter by email address
 * @query active - Filter by active status (true/false)
 * @query priority - Filter by priority (LOW/NORMAL/HIGH/CRITICAL)
 * @query page - Page number (default: 1)
 * @query limit - Items per page (default: 50)
 */
router.get('/', MonitoringRuleController.getAllRules);

/**
 * @route GET /api/monitoring-rules/statistics
 * @desc Get monitoring rules statistics
 */
router.get('/statistics', MonitoringRuleController.getStatistics);

/**
 * @route GET /api/monitoring-rules/email/:emailAddress
 * @desc Get all active monitoring rules for specific email address
 */
// router.get('/email/:emailAddress', MonitoringRuleController.getRulesForEmail);

/**
 * @route POST /api/monitoring-rules
 * @desc Create new monitoring rule
 */
router.post('/', MonitoringRuleController.createRule);

/**
 * @route PUT /api/monitoring-rules/:ruleId
 * @desc Update monitoring rule
 */
router.put('/:ruleId', MonitoringRuleController.updateRule);

/**
 * @route DELETE /api/monitoring-rules/:ruleId
 * @desc Delete monitoring rule
 */
router.delete('/:ruleId', MonitoringRuleController.deleteRule);

/**
 * @route GET /api/monitoring-rules/statistics
 * @desc Get monitoring rules statistics
 */
router.get('/statistics', MonitoringRuleController.getStatistics);

/**
 * NEW: @route GET /api/monitoring-rules/suppliers
 * @desc Get available suppliers list
 */
router.get('/suppliers', MonitoringRuleController.getAvailableSuppliers);

/**
 * NEW: @route GET /api/monitoring-rules/supplier/:supplier  
 * @desc Get all monitoring rules for specific supplier
 */
router.get('/supplier/:supplier', MonitoringRuleController.getRulesBySupplier);

/**
 * @route PATCH /api/monitoring-rules/:ruleId/toggle
 * @desc Toggle rule active status
 */
router.patch('/:ruleId/toggle', MonitoringRuleController.toggleRule);

/**
 * @route POST /api/monitoring-rules/test
 * @desc Test if email matches rules
 */
router.post('/test', MonitoringRuleController.testEmailMatch);

/**
 * @route PATCH /api/monitoring-rules/bulk/toggle
 * @desc Bulk toggle rules active status
 */
router.patch('/bulk/toggle', MonitoringRuleController.bulkToggleRules);


module.exports = router;