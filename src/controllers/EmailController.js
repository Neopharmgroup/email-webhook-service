const { EmailService } = require('../services');

class EmailController {
    // קבלת תוכן מייל ספציפי
    async getEmailContent(req, res) {
        try {
            const { email, messageId } = req.params;

            const emailContent = await EmailService.getEmailContent(email, messageId);

            res.json({
                subject: emailContent.subject,
                from: emailContent.from,
                toRecipients: emailContent.toRecipients,
                receivedDateTime: emailContent.receivedDateTime,
                bodyPreview: emailContent.bodyPreview,
                body: emailContent.body,
                hasAttachments: emailContent.hasAttachments,
                importance: emailContent.importance,
                isRead: emailContent.isRead
            });

        } catch (error) {
            console.error(`❌ שגיאה בקבלת תוכן מייל ${req.params.messageId}:`, error);
            res.status(500).json({
                error: 'שגיאה בקבלת תוכן מייל',
                details: error.message
            });
        }
    }

    // קבלת רשימת מיילים של משתמש
    async getEmailMessages(req, res) {
        try {
            const { email } = req.params;
            const limit = parseInt(req.query.limit) || 10;
            const filter = req.query.filter || '';

            const options = {
                limit,
                filter
            };

            const result = await EmailService.getEmailMessages(email, options);

            res.json(result);

        } catch (error) {
            console.error(`❌ שגיאה בקבלת מיילים עבור ${req.params.email}:`, error);
            res.status(500).json({
                error: 'שגיאה בקבלת רשימת מיילים',
                details: error.message
            });
        }
    }

    // קבלת קבצים מצורפים
    async getEmailAttachments(req, res) {
        try {
            const { email, messageId } = req.params;

            const attachments = await EmailService.getEmailAttachments(email, messageId);

            res.json({
                email,
                messageId,
                attachments
            });

        } catch (error) {
            console.error(`❌ שגיאה בקבלת קבצים מצורפים עבור מייל ${req.params.messageId}:`, error);
            res.status(500).json({
                error: 'שגיאה בקבלת קבצים מצורפים',
                details: error.message
            });
        }
    }

    // הורדת קובץ מצורף
    async downloadAttachment(req, res) {
        try {
            const { email, messageId, attachmentId } = req.params;

            const attachment = await EmailService.downloadAttachment(email, messageId, attachmentId);

            res.json({
                email,
                messageId,
                attachmentId,
                attachment
            });

        } catch (error) {
            console.error(`❌ שגיאה בהורדת קובץ מצורף ${req.params.attachmentId}:`, error);
            res.status(500).json({
                error: 'שגיאה בהורדת קובץ מצורף',
                details: error.message
            });
        }
    }

    // סימון מייל כנקרא
    async markAsRead(req, res) {
        try {
            const { email, messageId } = req.params;

            await EmailService.markEmailAsRead(email, messageId);

            res.json({
                message: 'מייל סומן כנקרא',
                email,
                messageId,
                markedAt: new Date().toISOString()
            });

        } catch (error) {
            console.error(`❌ שגיאה בסימון מייל ${req.params.messageId} כנקרא:`, error);
            res.status(500).json({
                error: 'שגיאה בסימון מייל כנקרא',
                details: error.message
            });
        }
    }

    // חיפוש מיילים
    async searchEmails(req, res) {
        try {
            const { email } = req.params;
            const { q: searchQuery, limit = 20 } = req.query;

            if (!searchQuery) {
                return res.status(400).json({
                    error: 'חסר פרמטר חיפוש (q)'
                });
            }

            const options = { limit: parseInt(limit) };
            const result = await EmailService.searchEmails(email, searchQuery, options);

            res.json(result);

        } catch (error) {
            console.error(`❌ שגיאה בחיפוש מיילים עבור ${req.params.email}:`, error);
            res.status(500).json({
                error: 'שגיאה בחיפוש מיילים',
                details: error.message
            });
        }
    }

    // קבלת תיקיות מייל
    async getEmailFolders(req, res) {
        try {
            const { email } = req.params;

            const folders = await EmailService.getEmailFolders(email);

            res.json({
                email,
                folders
            });

        } catch (error) {
            console.error(`❌ שגיאה בקבלת תיקיות מייל עבור ${req.params.email}:`, error);
            res.status(500).json({
                error: 'שגיאה בקבלת תיקיות מייל',
                details: error.message
            });
        }
    }

    // קבלת מספר מיילים לא נקראים
    async getUnreadCount(req, res) {
        try {
            const { email } = req.params;

            const unreadCount = await EmailService.getUnreadCount(email);

            res.json({
                email,
                unreadCount
            });

        } catch (error) {
            console.error(`❌ שגיאה בקבלת מספר מיילים לא נקראים עבור ${req.params.email}:`, error);
            res.status(500).json({
                error: 'שגיאה בקבלת מספר מיילים לא נקראים',
                details: error.message
            });
        }
    }

    // קבלת פרופיל משתמש
    async getUserProfile(req, res) {
        try {
            const { email } = req.params;

            const profile = await EmailService.getUserProfile(email);

            res.json(profile);

        } catch (error) {
            console.error(`❌ שגיאה בקבלת פרופיל משתמש ${req.params.email}:`, error);
            res.status(500).json({
                error: 'שגיאה בקבלת פרופיל משתמש',
                details: error.message
            });
        }
    }
}

module.exports = new EmailController();