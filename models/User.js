/**
 * User Model
 * ==========
 * Kullanıcı veritabanı şeması
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    // Temel Bilgiler
    username: {
        type: String,
        required: [true, 'Kullanıcı adı zorunludur'],
        unique: true,
        trim: true,
        minlength: [3, 'Kullanıcı adı en az 3 karakter olmalıdır'],
        maxlength: [20, 'Kullanıcı adı en fazla 20 karakter olabilir'],
        match: [/^[a-zA-Z0-9_]+$/, 'Kullanıcı adı sadece harf, rakam ve alt çizgi içerebilir'],
    },
    email: {
        type: String,
        required: [true, 'E-posta adresi zorunludur'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Geçerli bir e-posta adresi giriniz'],
    },
    password: {
        type: String,
        required: [true, 'Şifre zorunludur'],
        minlength: [6, 'Şifre en az 6 karakter olmalıdır'],
        select: false, // Default olarak sorguya dahil etme
    },

    // Profil Bilgileri
    avatar: {
        type: String,
        default: '/images/avatars/default.png',
    },
    bio: {
        type: String,
        maxlength: [200, 'Biyografi en fazla 200 karakter olabilir'],
        default: '',
    },
    frame: {
        type: String,
        default: null, // Satın alınan çerçeve
    },
    badges: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ShopItem',
    }],

    // bi! coin Sistemi
    coins: {
        type: Number,
        default: 100, // Başlangıç bonusu
        min: 0,
    },
    totalEarned: {
        type: Number,
        default: 100,
    },
    totalSpent: {
        type: Number,
        default: 0,
    },

    // İstatistikler
    stats: {
        totalPredictions: { type: Number, default: 0 },
        correctPredictions: { type: Number, default: 0 },
        wrongPredictions: { type: Number, default: 0 },
        pendingPredictions: { type: Number, default: 0 },
        winRate: { type: Number, default: 0 },
        streak: { type: Number, default: 0 }, // Ardışık doğru tahmin
        bestStreak: { type: Number, default: 0 },
        rank: { type: Number, default: 0 },
    },

    // Görevler
    completedMissions: [{
        mission: { type: mongoose.Schema.Types.ObjectId, ref: 'Mission' },
        completedAt: { type: Date, default: Date.now },
    }],
    dailyLoginStreak: {
        type: Number,
        default: 0,
    },
    lastDailyReward: {
        type: Date,
        default: null,
    },

    // Hesap Durumu
    role: {
        type: String,
        enum: ['user', 'moderator', 'admin'],
        default: 'user',
    },
    status: {
        type: String,
        enum: ['active', 'suspended', 'banned'],
        default: 'active',
    },
    isVerified: {
        type: Boolean,
        default: false,
    },
    verificationToken: String,
    verificationExpires: Date,

    // Şifre Sıfırlama
    resetPasswordToken: String,
    resetPasswordExpires: Date,

    // Ayarlar
    settings: {
        emailNotifications: { type: Boolean, default: true },
        pushNotifications: { type: Boolean, default: true },
        showOnLeaderboard: { type: Boolean, default: true },
        privateProfile: { type: Boolean, default: false },
        theme: { type: String, enum: ['dark', 'light', 'system'], default: 'dark' },
        language: { type: String, default: 'tr' },
    },

    // Sosyal
    followers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }],
    following: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }],

    // Referans Sistemi
    referralCode: {
        type: String,
        unique: true,
        sparse: true,
    },
    referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    referralCount: {
        type: Number,
        default: 0,
    },

    // Zaman Damgaları
    lastLogin: {
        type: Date,
        default: Date.now,
    },
    lastActive: {
        type: Date,
        default: Date.now,
    },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});

// ===================
// Virtual Fields
// ===================

// Seviye hesaplama (her 1000 puan = 1 seviye)
userSchema.virtual('level').get(function() {
    return Math.floor(this.stats.correctPredictions / 10) + 1;
});

// Sonraki seviyeye ilerleme
userSchema.virtual('levelProgress').get(function() {
    return (this.stats.correctPredictions % 10) * 10;
});

// Toplam takipçi sayısı
userSchema.virtual('followerCount').get(function() {
    return this.followers?.length || 0;
});

// Toplam takip sayısı
userSchema.virtual('followingCount').get(function() {
    return this.following?.length || 0;
});

// ===================
// Indexes
// ===================
userSchema.index({ username: 1 });
userSchema.index({ email: 1 });
userSchema.index({ 'stats.correctPredictions': -1 });
userSchema.index({ coins: -1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ referralCode: 1 });

// ===================
// Pre-save Hooks
// ===================

// Şifre hashleme
userSchema.pre('save', async function(next) {
    // Şifre değişmediyse atla
    if (!this.isModified('password')) return next();
    
    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Referral kodu oluşturma
userSchema.pre('save', function(next) {
    if (!this.referralCode) {
        this.referralCode = this.username.toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    next();
});

// Win rate hesaplama
userSchema.pre('save', function(next) {
    if (this.stats.totalPredictions > 0) {
        this.stats.winRate = Math.round((this.stats.correctPredictions / this.stats.totalPredictions) * 100);
    }
    next();
});

// ===================
// Instance Methods
// ===================

// Şifre doğrulama
userSchema.methods.comparePassword = async function(candidatePassword) {
    try {
        return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
        throw new Error('Şifre doğrulanamadı');
    }
};

// bi! coin ekleme
userSchema.methods.addCoins = async function(amount, reason = 'unknown') {
    this.coins += amount;
    this.totalEarned += amount;
    await this.save();
    
    // Transaction kaydı oluştur
    const Transaction = mongoose.model('Transaction');
    await Transaction.create({
        user: this._id,
        type: 'earn',
        amount,
        reason,
        balanceAfter: this.coins,
    });
    
    return this.coins;
};

// bi! coin harcama
userSchema.methods.spendCoins = async function(amount, reason = 'unknown') {
    if (this.coins < amount) {
        throw new Error('Yetersiz bi! coin');
    }
    
    this.coins -= amount;
    this.totalSpent += amount;
    await this.save();
    
    // Transaction kaydı oluştur
    const Transaction = mongoose.model('Transaction');
    await Transaction.create({
        user: this._id,
        type: 'spend',
        amount,
        reason,
        balanceAfter: this.coins,
    });
    
    return this.coins;
};

// Günlük ödül alma
userSchema.methods.claimDailyReward = async function() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    if (this.lastDailyReward) {
        const lastReward = new Date(this.lastDailyReward);
        const lastRewardDay = new Date(lastReward.getFullYear(), lastReward.getMonth(), lastReward.getDate());
        
        // Bugün zaten aldıysa
        if (lastRewardDay.getTime() === today.getTime()) {
            return { success: false, message: 'Bugünkü ödülü zaten aldınız' };
        }
        
        // Dün aldıysa streak devam
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (lastRewardDay.getTime() === yesterday.getTime()) {
            this.dailyLoginStreak += 1;
        } else {
            // Streak kırıldı
            this.dailyLoginStreak = 1;
        }
    } else {
        this.dailyLoginStreak = 1;
    }
    
    // Ödül hesapla (streak'e göre artan)
    const baseReward = 10;
    const streakBonus = Math.min(this.dailyLoginStreak - 1, 6) * 5; // Max 30 bonus
    const totalReward = baseReward + streakBonus;
    
    this.lastDailyReward = now;
    await this.addCoins(totalReward, 'daily_reward');
    
    return {
        success: true,
        reward: totalReward,
        streak: this.dailyLoginStreak,
        message: `${totalReward} bi! coin kazandınız! (${this.dailyLoginStreak} günlük seri)`,
    };
};

// Tahmin yap
userSchema.methods.makePrediction = async function(prediction, option, amount) {
    if (this.coins < amount) {
        throw new Error('Yetersiz bi! coin');
    }
    
    await this.spendCoins(amount, `prediction_${prediction._id}`);
    
    this.stats.totalPredictions += 1;
    this.stats.pendingPredictions += 1;
    await this.save();
    
    return true;
};

// ===================
// Static Methods
// ===================

// Kullanıcı ara
userSchema.statics.searchUsers = async function(query, limit = 10) {
    return this.find({
        $or: [
            { username: new RegExp(query, 'i') },
            { email: new RegExp(query, 'i') },
        ],
        status: 'active',
    })
    .select('username avatar stats.correctPredictions level')
    .limit(limit);
};

// Sıralama listesi
userSchema.statics.getLeaderboard = async function(limit = 100, period = 'all') {
    const query = { 
        role: 'user', 
        status: 'active',
        'settings.showOnLeaderboard': true,
    };
    
    // Dönem filtresi (ileride eklenecek)
    
    return this.find(query)
        .select('username avatar stats.correctPredictions stats.winRate coins level')
        .sort({ 'stats.correctPredictions': -1 })
        .limit(limit);
};

// E-posta ile bul
userSchema.statics.findByEmail = function(email) {
    return this.findOne({ email: email.toLowerCase() });
};

// Kullanıcı adı ile bul
userSchema.statics.findByUsername = function(username) {
    return this.findOne({ username: new RegExp(`^${username}$`, 'i') });
};

const User = mongoose.model('User', userSchema);

module.exports = User;
