const database = require('../database/connection');

class MonitoringService {

    // Helper method to get collection safely
    getCollection() {
        try {
            if (!database || !database.db) {
                console.warn('⚠️ MongoDB not available for monitoring, using memory storage');
                return null;
            }
            return database.getCollection('monitoringRules');
        } catch (error) {
            console.error('❌ Database not ready for monitoring, using memory storage:', error.message);
            return null;
        }
    }

    constructor() {
        console.log('🔄 MonitoringService אותחל - עובד ישירות עם MongoDB');
    }

    /**
     * Check if email matches rule conditions
     */
    checkRuleMatch(rule, fromEmail, subject, supplierContext = null) {
        console.log(`🔍 בודק כלל "${rule.ruleName}" (${rule.supplier}) עבור מייל מ-${fromEmail} עם נושא: "${subject}"`);

        if (!rule.active) {
            console.log(`🚫 כלל "${rule.ruleName}" לא פעיל`);
            return false;
        }

        // NEW: If supplier context provided, check if rule matches supplier
        if (supplierContext && rule.supplier && rule.supplier !== supplierContext.toUpperCase()) {
            console.log(`🚫 כלל "${rule.ruleName}" מיועד לספק ${rule.supplier}, לא תואם לספק ${supplierContext}`);
            return false;
        }

        // Check sender domains
        if (rule.senderDomains && rule.senderDomains.length > 0) {
            const fromDomain = fromEmail.split('@')[1]?.toLowerCase();
            console.log(`🌐 בודק דומיינים: ${fromDomain} נגד ${rule.senderDomains.join(', ')}`);
            if (!rule.senderDomains.some(domain => domain.toLowerCase() === fromDomain)) {
                console.log(`🚫 דומיין ${fromDomain} לא תואם לכלל "${rule.ruleName}" (${rule.supplier})`);
                return false;
            }
            console.log(`✅ דומיין ${fromDomain} תואם לכלל "${rule.ruleName}" (${rule.supplier})`);
        }

        // Check sender emails
        if (rule.senderEmails && rule.senderEmails.length > 0) {
            console.log(`📧 בודק מיילים: ${fromEmail} נגד ${rule.senderEmails.join(', ')}`);
            if (!rule.senderEmails.some(email => email.toLowerCase() === fromEmail.toLowerCase())) {
                console.log(`🚫 מייל ${fromEmail} לא תואם לכלל "${rule.ruleName}" (${rule.supplier})`);
                return false;
            }
            console.log(`✅ מייל ${fromEmail} תואם לכלל "${rule.ruleName}" (${rule.supplier})`);
        }

        // Check subject keywords
        if (rule.subjectKeywords && rule.subjectKeywords.length > 0) {
            const subjectLower = subject.toLowerCase();
            console.log(`📝 בודק מילות מפתח בנושא: "${subjectLower}" נגד ${rule.subjectKeywords.join(', ')}`);
            const hasKeyword = rule.subjectKeywords.some(keyword => {
                const keywordLower = keyword.toLowerCase();
                const matches = subjectLower.includes(keywordLower);
                console.log(`   - "${keywordLower}": ${matches ? '✅' : '❌'}`);
                return matches;
            });
            if (!hasKeyword) {
                console.log(`🚫 אף מילת מפתח לא נמצאה בנושא עבור כלל "${rule.ruleName}" (${rule.supplier})`);
                return false;
            }
            console.log(`✅ מילת מפתח נמצאה בנושא עבור כלל "${rule.ruleName}" (${rule.supplier})`);
        }

        // Check subject patterns (regex)
        if (rule.subjectPatterns && rule.subjectPatterns.length > 0) {
            console.log(`🔍 בודק דפוסי נושא: "${subject}" נגד ${rule.subjectPatterns.join(', ')}`);
            const hasPattern = rule.subjectPatterns.some(pattern => {
                try {
                    const regex = new RegExp(pattern, 'i');
                    const matches = regex.test(subject);
                    console.log(`   - דפוס "${pattern}": ${matches ? '✅' : '❌'}`);
                    return matches;
                } catch (error) {
                    console.error(`Invalid regex pattern: ${pattern}`, error);
                    return false;
                }
            });
            if (!hasPattern) {
                console.log(`🚫 אף דפוס לא תואם לנושא עבור כלל "${rule.ruleName}" (${rule.supplier})`);
                return false;
            }
            console.log(`✅ דפוס תואם לנושא עבור כלל "${rule.ruleName}" (${rule.supplier})`);
        }

        return true;
    }

    /**
     * NEW: Get supplier from email content using heuristics
     */
    identifySupplierFromEmail(fromEmail, subject, bodyPreview = '') {
        const emailLower = fromEmail.toLowerCase();
        const subjectLower = subject.toLowerCase();
        const bodyLower = bodyPreview.toLowerCase();
        const combined = `${emailLower} ${subjectLower} ${bodyLower}`;

        // Email domain based identification
        if (emailLower.includes('@ups.com') || combined.includes('ups')) {
            return 'UPS';
        }
        if (emailLower.includes('@fedex.com') || combined.includes('fedex')) {
            return 'FEDEX';
        }
        if (emailLower.includes('@dhl.com') || combined.includes('dhl')) {
            return 'DHL';
        }
        console.log(`🤔 לא זוהה ספק מהמייל ${fromEmail}, מסווג כ-OTHER`);
        return 'OTHER';
    }

    /**
     * Increment rule matches counter
     */
    async incrementRuleMatches(ruleId) {
        try {
            const collection = database.getCollection('monitoringRules');
            await collection.updateOne(
                { _id: ruleId },
                {
                    $inc: { totalMatches: 1 },
                    $set: { lastTriggered: new Date() }
                }
            );
        } catch (error) {
            console.error('❌ שגיאה בעדכון מונה התאמות:', error);
        }
    }

    /**
     * Increment successful forwards counter
     */
    async incrementRuleForwards(ruleId) {
        try {
            const collection = database.getCollection('monitoringRules');
            await collection.updateOne(
                { _id: ruleId },
                { $inc: { successfulForwards: 1 } }
            );
        } catch (error) {
            console.error('❌ שגיאה בעדכון מונה העברות מוצלחות:', error);
        }
    }

    /**
     * Get all active monitoring rules directly from MongoDB
     */
    async getAllActiveRules() {
        return await this.getAllActiveRulesFromDatabase();
    }

    /**
     * Get all active monitoring rules directly from MongoDB
     */
    async getAllActiveRulesFromDatabase() {
        try {
            const collection = this.getCollection();

            if (collection === null) {
                console.log('⚠️ MongoDB לא זמין - אין כללי מוניטורינג');
                return [];
            }

            const rules = await collection.find({ active: true })
                .sort({ priority: -1, createdAt: -1 })
                .toArray();

            console.log(`📋 שלף ${rules.length} כללי מוניטורינג פעילים ישירות מ-MongoDB`);
            console.log('📊 פילוח לפי ספקים:', this.getSupplierBreakdown(rules));
            return rules;

        } catch (error) {
            console.error('❌ שגיאה בשליפת כללי מוניטורינג מ-MongoDB:', error);
            return [];
        }
    }

    /**
     * NEW: Get rules by supplier
     */
    async getRulesBySupplier(supplier, activeOnly = true) {
        try {
            const collection = this.getCollection();
            if (!collection) return [];

            const filter = { supplier: supplier.toUpperCase() };
            if (activeOnly) filter.active = true;

            const rules = await collection.find(filter)
                .sort({ priority: -1, createdAt: -1 })
                .toArray();

            console.log(`📋 שלף ${rules.length} כללים עבור ספק ${supplier}`);
            return rules;
        } catch (error) {
            console.error(`❌ שגיאה בשליפת כללים עבור ספק ${supplier}:`, error);
            return [];
        }
    }

    /**
     * NEW: Get supplier breakdown from rules list
     */
    getSupplierBreakdown(rules) {
        const breakdown = {};
        rules.forEach(rule => {
            const supplier = rule.supplier || 'UNKNOWN';
            if (!breakdown[supplier]) {
                breakdown[supplier] = { total: 0, active: 0 };
            }
            breakdown[supplier].total++;
            if (rule.active) {
                breakdown[supplier].active++;
            }
        });
        return breakdown;
    }

    /**
     * Enhanced email processing that considers supplier context
     */
    async shouldProcessEmailForAutomation(toEmail, fromEmail, subject, bodyPreview = '') {
        try {
            console.log(`🔍 === בדיקת כללי מוניטורינג ===`);
            console.log(`📧 נמען: ${toEmail}`);
            console.log(`👤 שולח: ${fromEmail}`);
            console.log(`📝 נושא: "${subject}"`);

            // זיהוי ספק מהמייל (כ-fallback)
            const identifiedSupplier = this.identifySupplierFromEmail(fromEmail, subject, bodyPreview);
            console.log(`🏢 ספק מזוהה מתוכן: ${identifiedSupplier}`);

            // קבלת כל הכללים הפעילים
            const rules = await this.getAllActiveRulesFromDatabase();

            if (rules.length === 0) {
                console.log(`🚫 אין כללי מוניטורינג פעילים במערכת`);
                return {
                    shouldProcess: false,
                    reason: 'לא נמצאו כללי מוניטורינג פעילים במערכת',
                    matchingRules: [],
                    forwardToAutomation: false,
                    supplier: null, // ✅ וודא שזה מוחזר
                    identifiedSupplier
                };
            }

            const matchingRules = [];

            for (const rule of rules) {
                if (this.checkRuleMatch(rule, fromEmail, subject, identifiedSupplier)) {
                    matchingRules.push(rule);
                    await this.incrementRuleMatches(rule._id);
                }
            }

            if (matchingRules.length === 0) {
                console.log(`🚫 מייל לא תואם לאף כלל`);
                return {
                    shouldProcess: false,
                    reason: 'המייל לא תואם לאף כלל מוניטורינג',
                    matchingRules: [],
                    availableRules: rules.length,
                    forwardToAutomation: false,
                    supplier: null, // ✅ וודא שזה מוחזר
                    identifiedSupplier
                };
            }

            // מיון לפי עדיפות
            const priorityOrder = { 'CRITICAL': 4, 'HIGH': 3, 'NORMAL': 2, 'LOW': 1 };
            matchingRules.sort((a, b) => {
                const aPriority = priorityOrder[a.priority] || 2;
                const bPriority = priorityOrder[b.priority] || 2;
                return bPriority - aPriority;
            });

            const topRule = matchingRules[0];

            console.log(`✅ מייל תואם לכלל "${topRule.ruleName}" עבור ספק ${topRule.supplier}`);

            return {
                shouldProcess: true,
                reason: `תואם לכלל "${topRule.ruleName}" עבור ספק ${topRule.supplier}`,
                matchingRules,
                topRule,
                forwardToAutomation: topRule.forwardToAutomation !== false,
                priority: topRule.priority,
                supplier: topRule.supplier, // ✅ זה הספק מ-MongoDB!
                identifiedSupplier,
                notificationEmails: topRule.notificationEmails || []
            };
        } catch (error) {
            console.error('❌ שגיאה בבדיקת כללי מוניטורינג:', error);

            return {
                shouldProcess: true, // fallback - אל תחסום
                reason: 'שגיאה בבדיקת כללי מוניטורינג - מעבד כברירת מחדל',
                matchingRules: [],
                supplier: this.identifySupplierFromEmail(fromEmail, subject, bodyPreview),
                error: error.message
            };
        }
    }

    /**
     * Process successful automation forward (update statistics)
     */
    async recordSuccessfulForward(matchingRules) {
        try {
            if (!Array.isArray(matchingRules)) {
                return;
            }

            for (const rule of matchingRules) {
                await this.incrementRuleForwards(rule._id);
            }

            console.log(`📈 עודכנו סטטיסטיקות עבור ${matchingRules.length} כללים`);
        } catch (error) {
            console.error('❌ שגיאה בעדכון סטטיסטיקות העברה לאוטומציה:', error);
        }
    }

    /**
     * Get all monitored email addresses that have active rules
     */
    async getMonitoredEmailAddresses() {
        try {
            const collection = this.getCollection();
            if (!collection) return [];
            const uniqueEmails = await collection.distinct('emailAddress', { active: true });
            return uniqueEmails.map(email => email.toLowerCase());
        } catch (error) {
            console.error('❌ שגיאה בקבלת כתובות מייל מנוטרות:', error);
            return [];
        }
    }

    /**
     * Enhanced monitoring statistics with supplier data
     */
    async getMonitoringStatistics() {
        try {
            const collection = database.getCollection('monitoringRules');

            const stats = await Promise.all([
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
                ]).toArray(),
                collection.find({ active: true })
                    .sort({ lastTriggered: -1 })
                    .limit(10)
                    .project({ ruleName: 1, supplier: 1, lastTriggered: 1, totalMatches: 1 })
                    .toArray()
            ]);

            const [
                activeRules,
                inactiveRules,
                supplierStats,
                totalMatchesResult,
                totalForwardsResult,
                recentlyTriggered
            ] = stats;

            // Format supplier names
            const supplierNames = {
                'UPS': 'UPS',
                'FEDEX': 'FedEx',
                'DHL': 'DHL',
                'OTHER': 'אחר'
            };

            return {
                totalRules: activeRules + inactiveRules,
                activeRules,
                inactiveRules,
                totalMatches: totalMatchesResult[0]?.totalMatches || 0,
                totalForwards: totalForwardsResult[0]?.totalForwards || 0,
                successRate: totalMatchesResult[0]?.totalMatches > 0 ?
                    Math.round((totalForwardsResult[0]?.totalForwards || 0) / totalMatchesResult[0].totalMatches * 100) : 0,
                // NEW: Enhanced supplier statistics
                supplierBreakdown: supplierStats.map(stat => ({
                    supplier: stat._id,
                    supplierName: supplierNames[stat._id] || stat._id,
                    totalRules: stat.totalRules,
                    activeRules: stat.activeRules,
                    totalMatches: stat.totalMatches,
                    totalForwards: stat.totalForwards,
                    successRate: stat.totalMatches > 0 ?
                        Math.round((stat.totalForwards / stat.totalMatches) * 100) : 0
                })),
                recentlyTriggered: recentlyTriggered.map(rule => ({
                    ruleName: rule.ruleName,
                    supplier: rule.supplier,
                    supplierName: supplierNames[rule.supplier] || rule.supplier,
                    lastTriggered: rule.lastTriggered,
                    totalMatches: rule.totalMatches
                }))
            };
        } catch (error) {
            console.error('❌ שגיאה בקבלת סטטיסטיקות מוניטורינג:', error);
            return {
                totalRules: 0,
                activeRules: 0,
                inactiveRules: 0,
                totalMatches: 0,
                totalForwards: 0,
                successRate: 0,
                supplierBreakdown: [],
                recentlyTriggered: [],
                error: error.message
            };
        }
    }

    /**
     * Enhanced rules needing attention with supplier context
     */
    async getRulesNeedingAttention() {
        try {
            const collection = database.getCollection('monitoringRules');
            const allRules = await collection.find({ active: true }).toArray();
            const rulesNeedingAttention = [];

            const now = new Date();
            const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

            for (const rule of allRules) {
                const reasons = [];

                // Rule never triggered but created more than a week ago
                if (!rule.lastTriggered && rule.createdAt < oneWeekAgo) {
                    reasons.push('לא הופעל במשך שבוע מאז היצירה');
                }

                // Low success rate (less than 50% if had more than 10 matches)
                if (rule.totalMatches > 10) {
                    const successRate = rule.successfulForwards / rule.totalMatches;
                    if (successRate < 0.5) {
                        reasons.push(`יעילות נמוכה: ${Math.round(successRate * 100)}%`);
                    }
                }

                // No matches in last month but rule is active
                if (rule.lastTriggered) {
                    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    if (rule.lastTriggered < oneMonthAgo) {
                        reasons.push('לא הופעל במשך חודש');
                    }
                }

                // No conditions defined
                const hasConditions =
                    (rule.senderDomains && rule.senderDomains.length > 0) ||
                    (rule.senderEmails && rule.senderEmails.length > 0) ||
                    (rule.subjectKeywords && rule.subjectKeywords.length > 0) ||
                    (rule.subjectPatterns && rule.subjectPatterns.length > 0);

                if (!hasConditions) {
                    reasons.push('אין תנאי סינון מוגדרים');
                }

                // NEW: Missing supplier (for backward compatibility)
                if (!rule.supplier) {
                    reasons.push('חסר הגדרת ספק');
                }

                if (reasons.length > 0) {
                    rulesNeedingAttention.push({
                        ruleId: rule._id,
                        ruleName: rule.ruleName,
                        supplier: rule.supplier || 'UNKNOWN',
                        reasons,
                        priority: rule.priority,
                        totalMatches: rule.totalMatches,
                        successfulForwards: rule.successfulForwards,
                        lastTriggered: rule.lastTriggered,
                        createdAt: rule.createdAt
                    });
                }
            }

            return rulesNeedingAttention;
        } catch (error) {
            console.error('❌ שגיאה בבדיקת כללים הזקוקים לתשומת לב:', error);
            return [];
        }
    }

    /**
     * NEW: Validate supplier value
     */
    validateSupplier(supplier) {
        const validSuppliers = ['UPS', 'FEDEX', 'DHL', 'OTHER'];
        return validSuppliers.includes(supplier?.toUpperCase());
    }

    /**
     * NEW: Get supplier display name
     */
    getSupplierDisplayName(supplier) {
        const supplierNames = {
            'UPS': 'UPS',
            'FEDEX': 'FedEx',
            'DHL': 'DHL',
            'OTHER': 'אחר'
        };
        return supplierNames[supplier?.toUpperCase()] || supplier;
    }
}

module.exports = MonitoringService;