const { ObjectId } = require('mongodb');
const database = require('../database/connection');
const AuditLog = require('./AuditLog');

class MonitoredEmail {
    static get collection() {
        return database.getCollection('monitoredEmails');
    }

    static async add(emailData) {
        const monitoredEmail = {
            email: emailData.email,
            displayName: emailData.displayName,
            department: emailData.department,
            monitoringReason: emailData.monitoringReason,
            addedBy: emailData.addedBy,
            addedAt: new Date(),
            status: emailData.initialStatus || 'WAITING_FOR_AZURE_SETUP',
            priority: emailData.priority || 'NORMAL',
            notes: emailData.notes || '',
            preApproved: emailData.preApproved || false,
            metadata: {
                ipAddress: emailData.ipAddress,
                userAgent: emailData.userAgent
            }
        };

        try {
            const result = await this.collection.insertOne(monitoredEmail);

            // רשום ב-audit log
            await AuditLog.create({
                action: 'EMAIL_ADDED_FOR_MONITORING',
                resourceType: 'MonitoredEmail',
                resourceId: result.insertedId.toString(),
                details: {
                    email: monitoredEmail.email,
                    addedBy: monitoredEmail.addedBy,
                    reason: monitoredEmail.monitoringReason,
                    preApproved: monitoredEmail.preApproved,
                    initialStatus: monitoredEmail.status
                },
                performedBy: monitoredEmail.addedBy
            });

            return await this.collection.findOne({ _id: result.insertedId });
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`המייל ${emailData.email} כבר במעקב`);
            }
            throw error;
        }
    }

    static async findById(id) {
        return await this.collection.findOne({ _id: new ObjectId(id) });
    }

    static async findByEmail(email) {
        return await this.collection.findOne({ email });
    }

    static async getAllEmails(limit = 100) {
        return await this.collection
            .find()
            .sort({ addedAt: -1 })
            .limit(limit)
            .toArray();
    }

    static async getEmailsByStatus(status) {
        return await this.collection
            .find({ status })
            .sort({ addedAt: -1 })
            .toArray();
    }

    static async findWaiting() {
        return await this.collection
            .find({ status: 'WAITING_FOR_AZURE_SETUP' })
            .sort({ addedAt: -1 })
            .toArray();
    }

    static async updateStatus(email, status, updatedBy, notes = '') {
        const oldEmail = await this.findByEmail(email);
        
        const result = await this.collection.updateOne(
            { email },
            {
                $set: {
                    status,
                    updatedAt: new Date(),
                    updatedBy,
                    statusNotes: notes
                }
            }
        );

        if (result.modifiedCount > 0) {
            await AuditLog.create({
                action: 'EMAIL_STATUS_UPDATED',
                resourceType: 'MonitoredEmail',
                resourceId: email,
                details: {
                    email,
                    oldStatus: oldEmail?.status,
                    newStatus: status,
                    updatedBy,
                    notes
                },
                performedBy: updatedBy
            });
        }

        return result.modifiedCount > 0;
    }

    static async remove(email, removedBy, reason) {
        const emailDoc = await this.findByEmail(email);
        if (!emailDoc) {
            throw new Error('מייל לא נמצא');
        }

        const result = await this.collection.deleteOne({ email });

        if (result.deletedCount > 0) {
            await AuditLog.create({
                action: 'EMAIL_REMOVED_FROM_MONITORING',
                resourceType: 'MonitoredEmail',
                resourceId: email,
                details: {
                    email,
                    removedBy,
                    reason,
                    originalData: emailDoc
                },
                performedBy: removedBy
            });
        }

        return result.deletedCount > 0;
    }

    static async getStatistics() {
        const pipeline = [
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ];

        const statusCounts = await this.collection.aggregate(pipeline).toArray();
        const total = await this.collection.countDocuments();

        return {
            total,
            byStatus: statusCounts.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {})
        };
    }
}

module.exports = MonitoredEmail;