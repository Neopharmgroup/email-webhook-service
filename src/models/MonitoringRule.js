const mongoose = require('mongoose');

const monitoringRuleSchema = new mongoose.Schema({
    // Basic info
    ruleName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    description: {
        type: String,
        trim: true,
        maxlength: 500
    },
    
    // NEW: Supplier field - חובה לכללים חדשים
    supplier: {
        type: String,
        required: true,
        trim: true,
        enum: ['UPS', 'FEDEX', 'DHL', 'OTHER'],
        validate: {
            validator: function(v) {
                return v && v.length > 0;
            },
            message: 'ספק נדרש עבור כלל ניטור'
        }
    },
    
    // Rule conditions
    senderDomains: [{
        type: String,
        trim: true,
        lowercase: true
    }],
    senderEmails: [{
        type: String,
        trim: true,
        lowercase: true,
        validate: {
            validator: function(v) {
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: 'Please provide a valid email address'
        }
    }],
    subjectKeywords: [{
        type: String,
        trim: true
    }],
    subjectPatterns: [{
        type: String,
        trim: true
    }],
    
    // Rule settings
    priority: {
        type: String,
        enum: ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'],
        default: 'NORMAL'
    },
    active: {
        type: Boolean,
        default: true
    },
    
    // Target service configuration
    targetService: {
        type: String,
        enum: ['automation', 'archive', 'custom'],
        default: 'automation',
        required: true
    },
    customServiceUrl: {
        type: String,
        trim: true,
        validate: {
            validator: function(v) {
                if (this.targetService === 'custom') {
                    return v && v.length > 0;
                }
                return true;
            },
            message: 'Custom service URL is required when target service is "custom"'
        }
    },
    customServiceMethod: {
        type: String,
        enum: ['POST', 'PUT', 'PATCH'],
        default: 'POST',
        validate: {
            validator: function(v) {
                if (this.targetService === 'custom') {
                    return v && ['POST', 'PUT', 'PATCH'].includes(v);
                }
                return true;
            },
            message: 'Valid HTTP method is required when target service is "custom"'
        }
    },
    
    // Backward compatibility
    forwardToAutomation: {
        type: Boolean,
        default: function() {
            return this.targetService === 'automation';
        }
    },
    
    // Notification settings
    notificationEmails: [{
        type: String,
        trim: true,
        lowercase: true,
        validate: {
            validator: function(v) {
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: 'Please provide a valid email address'
        }
    }],
    
    // Statistics
    totalMatches: {
        type: Number,
        default: 0
    },
    successfulForwards: {
        type: Number,
        default: 0
    },
    lastTriggered: {
        type: Date
    },
    
    // Audit fields
    createdBy: {
        type: String,
        required: true,
        trim: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedBy: {
        type: String,
        trim: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'monitoringRules'
});

// Indexes for better performance
monitoringRuleSchema.index({ active: 1 });
monitoringRuleSchema.index({ createdAt: -1 });
monitoringRuleSchema.index({ active: 1, priority: -1 });
monitoringRuleSchema.index({ targetService: 1 });
monitoringRuleSchema.index({ supplier: 1 }); // NEW: Index on supplier
monitoringRuleSchema.index({ supplier: 1, active: 1 }); // NEW: Compound index

// Instance methods
monitoringRuleSchema.methods.checkMatch = function(fromEmail, subject) {
    if (!this.active) return false;
    
    // Check sender domains
    if (this.senderDomains.length > 0) {
        const fromDomain = fromEmail.split('@')[1]?.toLowerCase();
        if (!this.senderDomains.includes(fromDomain)) {
            return false;
        }
    }
    
    // Check sender emails
    if (this.senderEmails.length > 0) {
        if (!this.senderEmails.includes(fromEmail.toLowerCase())) {
            return false;
        }
    }
    
    // Check subject keywords
    if (this.subjectKeywords.length > 0) {
        const subjectLower = subject.toLowerCase();
        const hasKeyword = this.subjectKeywords.some(keyword => 
            subjectLower.includes(keyword.toLowerCase())
        );
        if (!hasKeyword) {
            return false;
        }
    }
    
    // Check subject patterns (regex)
    if (this.subjectPatterns.length > 0) {
        const hasPattern = this.subjectPatterns.some(pattern => {
            try {
                const regex = new RegExp(pattern, 'i');
                return regex.test(subject);
            } catch (error) {
                console.error(`Invalid regex pattern: ${pattern}`, error);
                return false;
            }
        });
        if (!hasPattern) {
            return false;
        }
    }
    
    return true;
};

// NEW: Get supplier display name in Hebrew
monitoringRuleSchema.methods.getSupplierDisplayName = function() {
    const supplierNames = {
        'UPS': 'UPS',
        'FEDEX': 'FedEx',
        'DHL': 'DHL',
        'OTHER': 'אחר'
    };
    return supplierNames[this.supplier] || this.supplier;
};

monitoringRuleSchema.methods.incrementMatches = async function() {
    this.totalMatches += 1;
    this.lastTriggered = new Date();
    await this.save();
};

monitoringRuleSchema.methods.incrementSuccessfulForwards = async function() {
    this.successfulForwards += 1;
    await this.save();
};

// Static methods - updated to include supplier filtering
monitoringRuleSchema.statics.findActiveRules = function() {
    return this.find({
        active: true
    }).sort({ priority: -1, createdAt: -1 });
};

monitoringRuleSchema.statics.findMatchingRules = function(fromEmail, subject) {
    return this.find({
        active: true
    }).then(rules => {
        return rules.filter(rule => rule.checkMatch(fromEmail, subject));
    });
};

// NEW: Find rules by supplier
monitoringRuleSchema.statics.findBySupplier = function(supplier, activeOnly = true) {
    const filter = { supplier };
    if (activeOnly) filter.active = true;
    return this.find(filter).sort({ priority: -1, createdAt: -1 });
};

// NEW: Get supplier statistics
monitoringRuleSchema.statics.getSupplierStatistics = function() {
    return this.aggregate([
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
    ]);
};

// Pre-save middleware
monitoringRuleSchema.pre('save', function(next) {
    if (this.isModified() && !this.isNew) {
        this.updatedAt = new Date();
    }
    next();
});

// Virtual for formatted dates
monitoringRuleSchema.virtual('formattedCreatedAt').get(function() {
    return this.createdAt?.toLocaleDateString('he-IL');
});

monitoringRuleSchema.virtual('formattedLastTriggered').get(function() {
    return this.lastTriggered?.toLocaleDateString('he-IL');
});

const MonitoringRule = mongoose.model('MonitoringRule', monitoringRuleSchema);

module.exports = MonitoringRule;