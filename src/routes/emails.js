const express = require('express');
const { EmailController } = require('../controllers');
const { validation } = require('../middleware');

const router = express.Router();

// Get email content
router.get('/:email/messages/:messageId', 
    validation.validateEmailParam,
    EmailController.getEmailContent
);

// Get email messages list
router.get('/:email/messages', 
    validation.validateEmailParam,
    validation.validatePagination,
    EmailController.getEmailMessages
);

// Search emails
router.get('/:email/search', 
    validation.validateEmailParam,
    validation.validatePagination,
    EmailController.searchEmails
);

// Get email attachments
router.get('/:email/messages/:messageId/attachments', 
    validation.validateEmailParam,
    EmailController.getEmailAttachments
);

// Download attachment
router.get('/:email/messages/:messageId/attachments/:attachmentId', 
    validation.validateEmailParam,
    EmailController.downloadAttachment
);

// Mark email as read
router.patch('/:email/messages/:messageId/read', 
    validation.validateEmailParam,
    EmailController.markAsRead
);

// Get email folders
router.get('/:email/folders', 
    validation.validateEmailParam,
    EmailController.getEmailFolders
);

// Get unread count
router.get('/:email/unread-count', 
    validation.validateEmailParam,
    EmailController.getUnreadCount
);

// Get user profile
router.get('/:email/profile', 
    validation.validateEmailParam,
    EmailController.getUserProfile
);

module.exports = router;