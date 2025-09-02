const express = require('express');
const { NotificationController } = require('../controllers');
const { validation } = require('../middleware');

const router = express.Router();

// Get recent notifications
router.get('/', 
    validation.validatePagination,
    NotificationController.getRecentNotifications
);

// Get notifications by subscription
router.get('/subscription/:subscriptionId', 
    validation.validatePagination,
    NotificationController.getNotificationsBySubscription
);

// Get unprocessed notifications
router.get('/unprocessed', 
    validation.validatePagination,
    NotificationController.getUnprocessedNotifications
);

// Mark notification as processed
router.patch('/:notificationId/processed', 
    validation.validateObjectId('notificationId'),
    NotificationController.markAsProcessed
);

// Get email content from notification
router.get('/:notificationId/content', 
    validation.validateObjectId('notificationId'),
    NotificationController.getEmailContentFromNotification
);

// Get statistics
router.get('/statistics', 
    NotificationController.getStatistics
);

// Delete old notifications
router.delete('/old', 
    NotificationController.deleteOldNotifications
);

module.exports = router;