const express = require('express');
const { DashboardController } = require('../controllers');

const router = express.Router();

// Dashboard statistics
router.get('/stats', DashboardController.getStatistics);

// System health check
router.get('/health', DashboardController.getHealthCheck);

// Dashboard overview
router.get('/overview', DashboardController.getOverview);

// System alerts
router.get('/alerts', DashboardController.getSystemAlerts);

// Performance metrics
router.get('/performance', DashboardController.getPerformanceMetrics);

// Maintenance operations
router.post('/maintenance', DashboardController.performMaintenance);

module.exports = router;