const { ObjectId } = require('mongodb');

class MonitoringRuleController {
    
    // Helper method to get collection safely - wait for MongoDB to be ready
    static async waitForDatabase(maxRetries = 10, delayMs = 500) {
        const database = require('../database/connection');
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                if (database && database.db && typeof database.getCollection === 'function') {
                    return database.getCollection('monitoringRules');
                }
            } catch (error) {
                console.log(`⏳ Attempt ${i + 1}/${maxRetries}: Database not ready, waiting...`);
            }
            
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        
        throw new Error('Database not available after maximum retries');
    }

    /**
     * Get all monitoring rules
     */
    static async getAllRules(req, res) {
        try {
            const { active, priority, supplier, page = 1, limit = 50 } = req.query;
            
            // Build filter object
            const filter = {};
            if (active !== undefined) {
                filter.active = active === 'true';
            }
            if (priority) {
                filter.priority = priority;
            }
            // NEW: Filter by supplier
            if (supplier) {
                filter.supplier = supplier.toUpperCase();
            }
            
            // Calculate pagination
            const skip = (page - 1) * limit;
            
            // Wait for database to be ready
            const collection = await MonitoringRuleController.waitForDatabase();
            
            // Use MongoDB
            const rules = await collection.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .toArray();
            
            const total = await collection.countDocuments(filter);
            
            console.log(`📊 נמצאו ${rules.length} כללי ניטור מתוך ${total} סה"כ`);
            console.log('📋 כללי ניטור:', rules.map(r => ({ 
                name: r.ruleName, 
                active: r.active, 
                supplier: r.supplier 
            })));
            
            res.json({
                success: true,
                rules,
                pagination: {
                    current_page: parseInt(page),
                    per_page: parseInt(limit),
                    total,
                    total_pages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            console.error('Error getting monitoring rules:', error);
            res.status(500).json({
                success: false,
                message: 'שגיאה בטעינת כללי הניטור',
                error: error.message
            });
        }
    }

    /**
     * Create new monitoring rule
     */
    static async createRule(req, res) {
        try {
            const ruleData = req.body;
            
            // Basic validation
            if (!ruleData.ruleName) {
                return res.status(400).json({
                    success: false,
                    message: 'שם כלל נדרש'
                });
            }

            // NEW: Validate supplier field
            if (!ruleData.supplier) {
                return res.status(400).json({
                    success: false,
                    message: 'ספק נדרש עבור כלל ניטור'
                });
            }

            // Validate supplier enum
            const validSuppliers = ['UPS', 'FEDEX', 'DHL',  'OTHER'];
            if (!validSuppliers.includes(ruleData.supplier.toUpperCase())) {
                return res.status(400).json({
                    success: false,
                    message: `ספק לא חוקי. ספקים חוקיים: ${validSuppliers.join(', ')}`
                });
            }
            
            // Wait for database to be ready
            const collection = await MonitoringRuleController.waitForDatabase();
            
            // Check if rule with same name exists
            const existingRule = await collection.findOne({
                ruleName: ruleData.ruleName
            });
            
            if (existingRule) {
                return res.status(400).json({
                    success: false,
                    message: 'כלל עם שם זה כבר קיים במערכת'
                });
            }
            
            // Create new rule
            const newRule = {
                ...ruleData,
                supplier: ruleData.supplier.toUpperCase(), // Normalize to uppercase
                createdBy: req.user?.name || req.body.createdBy || 'משתמש',
                createdAt: new Date(),
                updatedAt: new Date(),
                totalMatches: 0,
                successfulForwards: 0,
                active: ruleData.active !== false
            };
            
            console.log('📝 יוצר כלל ניטור חדש:', {
                ruleName: newRule.ruleName,
                supplier: newRule.supplier,
                senderEmails: newRule.senderEmails,
                subjectKeywords: newRule.subjectKeywords,
                priority: newRule.priority,
                active: newRule.active
            });
            
            const result = await collection.insertOne(newRule);
            newRule._id = result.insertedId;
            
            console.log('✅ כלל ניטור נשמר בהצלחה במונגו DB:', result.insertedId);
            
            res.status(201).json({
                success: true,
                message: 'כלל ניטור נוצר בהצלחה',
                rule: newRule
            });
        } catch (error) {
            console.error('Error creating monitoring rule:', error);
            res.status(500).json({
                success: false,
                message: 'שגיאה ביצירת כלל הניטור',
                error: error.message
            });
        }
    }

    /**
     * Update monitoring rule
     */
    static async updateRule(req, res) {
        try {
            const { ruleId } = req.params;
            const updateData = req.body;
            
            // Wait for database to be ready
            const collection = await MonitoringRuleController.waitForDatabase();
            
            // Find existing rule
            const existingRule = await collection.findOne({ _id: new ObjectId(ruleId) });
            if (!existingRule) {
                return res.status(404).json({
                    success: false,
                    message: 'כלל הניטור לא נמצא'
                });
            }

            // NEW: If supplier is being updated, validate it
            if (updateData.supplier) {
                const validSuppliers = ['UPS', 'FEDEX', 'DHL',  'OTHER'];
                if (!validSuppliers.includes(updateData.supplier.toUpperCase())) {
                    return res.status(400).json({
                        success: false,
                        message: `ספק לא חוקי. ספקים חוקיים: ${validSuppliers.join(', ')}`
                    });
                }
                updateData.supplier = updateData.supplier.toUpperCase();
            }
            
            // Prepare update object
            const updateObject = {
                ...updateData,
                updatedBy: req.user?.name || req.body.updatedBy || 'משתמש',
                updatedAt: new Date()
            };

            // Remove fields that shouldn't be updated
            delete updateObject._id;
            delete updateObject.createdAt;
            delete updateObject.createdBy;
            
            const result = await collection.updateOne(
                { _id: new ObjectId(ruleId) },
                { $set: updateObject }
            );
            
            if (result.modifiedCount === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'לא בוצעו שינויים בכלל'
                });
            }

            // Get updated rule
            const updatedRule = await collection.findOne({ _id: new ObjectId(ruleId) });
            
            res.json({
                success: true,
                message: 'כלל הניטור עודכן בהצלחה',
                rule: updatedRule
            });
        } catch (error) {
            console.error('Error updating monitoring rule:', error);
            res.status(500).json({
                success: false,
                message: 'שגיאה בעדכון כלל הניטור',
                error: error.message
            });
        }
    }

    /**
     * Delete monitoring rule
     */
    static async deleteRule(req, res) {
        try {
            const { ruleId } = req.params;
            
            // Wait for database to be ready
            const collection = await MonitoringRuleController.waitForDatabase();
            
            // Find rule first
            const rule = await collection.findOne({ _id: new ObjectId(ruleId) });
            if (!rule) {
                return res.status(404).json({
                    success: false,
                    message: 'כלל הניטור לא נמצא'
                });
            }
            
            // Delete rule
            await collection.deleteOne({ _id: new ObjectId(ruleId) });
            
            res.json({
                success: true,
                message: 'כלל הניטור נמחק בהצלחה',
                deletedRule: rule
            });
        } catch (error) {
            console.error('Error deleting monitoring rule:', error);
            res.status(500).json({
                success: false,
                message: 'שגיאה במחיקת כלל הניטור',
                error: error.message
            });
        }
    }

    /**
     * Get monitoring statistics with supplier breakdown
     */
    static async getStatistics(req, res) {
        try {
            const collection = await MonitoringRuleController.waitForDatabase();
            
            const [
                totalRules,
                activeRules,
                inactiveRules,
                supplierStats,
                totalMatchesResult,
                totalForwardsResult
            ] = await Promise.all([
                collection.countDocuments(),
                collection.countDocuments({ active: true }),
                collection.countDocuments({ active: false }),
                // NEW: Supplier statistics
                collection.aggregate([
                    {
                        $group: {
                            _id: '$supplier',
                            totalRules: { $sum: 1 },
                            activeRules: { 
                                $sum: { 
                                    $cond: [{ $eq: ['$active', true] }, 1, 0] 
                                } 
                            },
                            totalMatches: { $sum: '$totalMatches' },
                            totalForwards: { $sum: '$successfulForwards' }
                        }
                    },
                    {
                        $sort: { totalRules: -1 }
                    }
                ]).toArray(),
                collection.aggregate([
                    { $match: { active: true } },
                    { $group: { _id: null, totalMatches: { $sum: '$totalMatches' } } }
                ]).toArray(),
                collection.aggregate([
                    { $match: { active: true } },
                    { $group: { _id: null, totalForwards: { $sum: '$successfulForwards' } } }
                ]).toArray()
            ]);

            // Format supplier statistics with Hebrew names
            const supplierNames = {
                'UPS': 'UPS',
                'FEDEX': 'FedEx',
                'DHL': 'DHL',
                'OTHER': 'אחר'
            };

            const formattedSupplierStats = supplierStats.map(stat => ({
                supplier: stat._id,
                supplierName: supplierNames[stat._id] || stat._id,
                totalRules: stat.totalRules,
                activeRules: stat.activeRules,
                totalMatches: stat.totalMatches,
                totalForwards: stat.totalForwards,
                successRate: stat.totalMatches > 0 ? 
                    Math.round((stat.totalForwards / stat.totalMatches) * 100) : 0
            }));

            res.json({
                success: true,
                statistics: {
                    totalRules,
                    activeRules,
                    inactiveRules,
                    totalMatches: totalMatchesResult[0]?.totalMatches || 0,
                    totalForwards: totalForwardsResult[0]?.totalForwards || 0,
                    successRate: totalMatchesResult[0]?.totalMatches > 0 ? 
                        Math.round((totalForwardsResult[0]?.totalForwards || 0) / totalMatchesResult[0].totalMatches * 100) : 0,
                    // NEW: Supplier breakdown
                    supplierBreakdown: formattedSupplierStats
                }
            });
        } catch (error) {
            console.error('Error getting monitoring statistics:', error);
            res.status(500).json({
                success: false,
                message: 'שגיאה בטעינת סטטיסטיקות',
                error: error.message
            });
        }
    }

    /**
     * NEW: Get rules by supplier
     */
    static async getRulesBySupplier(req, res) {
        try {
            const { supplier } = req.params;
            const { active = 'true' } = req.query;
            
            // Validate supplier
            const validSuppliers = ['UPS', 'FEDEX', 'DHL', 'OTHER'];
            if (!validSuppliers.includes(supplier.toUpperCase())) {
                return res.status(400).json({
                    success: false,
                    message: `ספק לא חוקי. ספקים חוקיים: ${validSuppliers.join(', ')}`
                });
            }

            const collection = await MonitoringRuleController.waitForDatabase();
            
            const filter = { supplier: supplier.toUpperCase() };
            if (active !== 'all') {
                filter.active = active === 'true';
            }
            
            const rules = await collection.find(filter)
                .sort({ priority: -1, createdAt: -1 })
                .toArray();
            
            res.json({
                success: true,
                supplier: supplier.toUpperCase(),
                rules
            });
        } catch (error) {
            console.error('Error getting rules by supplier:', error);
            res.status(500).json({
                success: false,
                message: 'שגיאה בטעינת כללים לפי ספק',
                error: error.message
            });
        }
    }

    /**
     * NEW: Get available suppliers
     */
    static async getAvailableSuppliers(req, res) {
        try {
            const suppliers = [
                { value: 'UPS', label: 'UPS', description: 'United Parcel Service' },
                { value: 'FEDEX', label: 'FedEx', description: 'Federal Express' },
                { value: 'DHL', label: 'DHL', description: 'DHL Express' },
                { value: 'OTHER', label: 'אחר', description: 'ספק אחר' }
            ];

            res.json({
                success: true,
                suppliers
            });
        } catch (error) {
            console.error('Error getting available suppliers:', error);
            res.status(500).json({
                success: false,
                message: 'שגיאה בטעינת רשימת ספקים',
                error: error.message
            });
        }
    }

    /**
     * Toggle rule active status
     */
    static async toggleRule(req, res) {
        try {
            const { ruleId } = req.params;
            const { active } = req.body;
            
            const collection = await MonitoringRuleController.waitForDatabase();
            
            const rule = await collection.findOne({ _id: new ObjectId(ruleId) });
            if (!rule) {
                return res.status(404).json({
                    success: false,
                    message: 'כלל הניטור לא נמצא'
                });
            }
            
            const result = await collection.updateOne(
                { _id: new ObjectId(ruleId) },
                { 
                    $set: {
                        active,
                        updatedBy: req.user?.name || req.body.updatedBy || 'משתמש',
                        updatedAt: new Date()
                    }
                }
            );

            const updatedRule = await collection.findOne({ _id: new ObjectId(ruleId) });
            
            res.json({
                success: true,
                message: active ? 'כלל הניטור הופעל בהצלחה' : 'כלל הניטור הושבת בהצלחה',
                rule: updatedRule
            });
        } catch (error) {
            console.error('Error toggling monitoring rule:', error);
            res.status(500).json({
                success: false,
                message: 'שגיאה בעדכון סטטוס כלל הניטור',
                error: error.message
            });
        }
    }

    /**
     * Test if email matches rules
     */
    static async testEmailMatch(req, res) {
        try {
            const { fromEmail, subject, supplier } = req.body;
            
            if (!fromEmail || !subject) {
                return res.status(400).json({
                    success: false,
                    message: 'נדרשים: fromEmail, subject'
                });
            }
            
            const collection = await MonitoringRuleController.waitForDatabase();
            
            let filter = { active: true };
            if (supplier) {
                filter.supplier = supplier.toUpperCase();
            }
            
            const rules = await collection.find(filter).toArray();
            
            // Check matches using the same logic from the schema
            const matchingRules = rules.filter(rule => {
                // Same logic as in schema checkMatch method
                if (rule.senderDomains && rule.senderDomains.length > 0) {
                    const fromDomain = fromEmail.split('@')[1]?.toLowerCase();
                    if (!rule.senderDomains.includes(fromDomain)) {
                        return false;
                    }
                }
                
                if (rule.senderEmails && rule.senderEmails.length > 0) {
                    if (!rule.senderEmails.includes(fromEmail.toLowerCase())) {
                        return false;
                    }
                }
                
                if (rule.subjectKeywords && rule.subjectKeywords.length > 0) {
                    const subjectLower = subject.toLowerCase();
                    const hasKeyword = rule.subjectKeywords.some(keyword => 
                        subjectLower.includes(keyword.toLowerCase())
                    );
                    if (!hasKeyword) {
                        return false;
                    }
                }
                
                return true;
            });
            
            res.json({
                success: true,
                matches: matchingRules.length > 0,
                matchingRules,
                testData: { fromEmail, subject, supplier }
            });
        } catch (error) {
            console.error('Error testing email match:', error);
            res.status(500).json({
                success: false,
                message: 'שגיאה בבדיקת התאמה',
                error: error.message
            });
        }
    }

    /**
     * Bulk operations
     */
    static async bulkToggleRules(req, res) {
        try {
            const { ruleIds, active } = req.body;
            
            if (!Array.isArray(ruleIds) || ruleIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'נדרשת רשימת מזהי כללים'
                });
            }
            
            const collection = await MonitoringRuleController.waitForDatabase();
            
            const result = await collection.updateMany(
                { _id: { $in: ruleIds.map(id => new ObjectId(id)) } },
                { 
                    $set: {
                        active, 
                        updatedBy: req.user?.name || req.body.updatedBy || 'משתמש',
                        updatedAt: new Date()
                    }
                }
            );
            
            res.json({
                success: true,
                message: `${result.modifiedCount} כללים עודכנו בהצלחה`,
                modified: result.modifiedCount
            });
        } catch (error) {
            console.error('Error in bulk toggle rules:', error);
            res.status(500).json({
                success: false,
                message: 'שגיאה בעדכון מרובה של כללים',
                error: error.message
            });
        }
    }
}

module.exports = MonitoringRuleController;