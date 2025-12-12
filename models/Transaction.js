/**
 * Transaction Model
 * =================
 * bi! coin işlem geçmişi veritabanı şeması
 */

const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    // Kullanıcı
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },

    // İşlem Türü
    type: {
        type: String,
        enum: [
            'earn',           // Kazanım
            'spend',          // Harcama
            'refund',         // İade
            'bonus',          // Bonus
            'admin_adjust',   // Admin ayarlaması
            'transfer_in',    // Transfer alma (gelecekte)
            'transfer_out',   // Transfer gönderme (gelecekte)
        ],
        required: true,
    },

    // Miktar
    amount: {
        type: Number,
        required: true,
    },

    // İşlem sonrası bakiye
    balanceAfter: {
        type: Number,
        required: true,
    },

    // Sebep/Açıklama
    reason: {
        type: String,
        enum: [
            // Kazanım sebepleri
            'welcome_bonus',       // Hoş geldin bonusu
            'daily_reward',        // Günlük ödül
            'prediction_win',      // Tahmin kazanımı
            'mission_complete',    // Görev tamamlama
            'referral_bonus',      // Referans bonusu
            'achievement',         // Başarı ödülü
            'event_reward',        // Etkinlik ödülü
            'admin_bonus',         // Admin bonusu
            
            // Harcama sebepleri
            'prediction_bet',      // Tahmine yatırım
            'shop_purchase',       // Mağaza satın alımı
            
            // Diğer
            'refund',              // İade
            'correction',          // Düzeltme
            'other',               // Diğer
        ],
        default: 'other',
    },

    // Detay (örn: tahmin ID, ürün ID)
    reference: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'referenceModel',
    },
    referenceModel: {
        type: String,
        enum: ['Prediction', 'ShopItem', 'Mission', 'User'],
    },

    // Açıklama
    description: {
        type: String,
        maxlength: 500,
    },

    // Durum
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'cancelled'],
        default: 'completed',
    },

    // Meta bilgiler
    meta: {
        ip: String,
        userAgent: String,
        adminId: mongoose.Schema.Types.ObjectId,
        note: String,
    },
}, {
    timestamps: true,
});

// ===================
// Indexes
// ===================
transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ reason: 1 });
transactionSchema.index({ createdAt: -1 });

// ===================
// Virtual Fields
// ===================

// İşlem yönü (+ veya -)
transactionSchema.virtual('direction').get(function() {
    return ['earn', 'refund', 'bonus', 'transfer_in', 'admin_adjust'].includes(this.type) && this.amount > 0 ? 'in' : 'out';
});

// Formatlanmış miktar
transactionSchema.virtual('formattedAmount').get(function() {
    const sign = this.direction === 'in' ? '+' : '-';
    return `${sign}${Math.abs(this.amount)} bi!`;
});

// ===================
// Static Methods
// ===================

// Kullanıcının işlem geçmişi
transactionSchema.statics.getUserHistory = function(userId, options = {}) {
    const query = { user: userId };
    
    if (options.type) {
        query.type = options.type;
    }
    
    if (options.startDate || options.endDate) {
        query.createdAt = {};
        if (options.startDate) query.createdAt.$gte = options.startDate;
        if (options.endDate) query.createdAt.$lte = options.endDate;
    }
    
    return this.find(query)
        .sort({ createdAt: -1 })
        .skip(options.skip || 0)
        .limit(options.limit || 50);
};

// Günlük özet
transactionSchema.statics.getDailySummary = async function(userId, date = new Date()) {
    const startOfDay = new Date(date.setHours(0, 0, 0, 0));
    const endOfDay = new Date(date.setHours(23, 59, 59, 999));
    
    const result = await this.aggregate([
        {
            $match: {
                user: mongoose.Types.ObjectId(userId),
                createdAt: { $gte: startOfDay, $lte: endOfDay },
            },
        },
        {
            $group: {
                _id: '$type',
                total: { $sum: '$amount' },
                count: { $sum: 1 },
            },
        },
    ]);
    
    return result.reduce((acc, item) => {
        acc[item._id] = { total: item.total, count: item.count };
        return acc;
    }, {});
};

// Toplam kazanım/harcama
transactionSchema.statics.getTotals = async function(userId) {
    const result = await this.aggregate([
        { $match: { user: mongoose.Types.ObjectId(userId) } },
        {
            $group: {
                _id: null,
                totalEarned: {
                    $sum: {
                        $cond: [{ $in: ['$type', ['earn', 'bonus', 'refund']] }, '$amount', 0],
                    },
                },
                totalSpent: {
                    $sum: {
                        $cond: [{ $eq: ['$type', 'spend'] }, '$amount', 0],
                    },
                },
            },
        },
    ]);
    
    return result[0] || { totalEarned: 0, totalSpent: 0 };
};

// Admin: Tüm işlemleri getir
transactionSchema.statics.getAllTransactions = function(options = {}) {
    const query = {};
    
    if (options.type) query.type = options.type;
    if (options.reason) query.reason = options.reason;
    if (options.userId) query.user = options.userId;
    
    return this.find(query)
        .populate('user', 'username avatar')
        .sort({ createdAt: -1 })
        .skip(options.skip || 0)
        .limit(options.limit || 100);
};

// İşlem oluştur (helper)
transactionSchema.statics.createTransaction = async function(data) {
    const transaction = new this({
        user: data.userId,
        type: data.type,
        amount: data.amount,
        balanceAfter: data.balanceAfter,
        reason: data.reason,
        reference: data.reference,
        referenceModel: data.referenceModel,
        description: data.description,
        meta: data.meta,
    });
    
    return transaction.save();
};

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
