/**
 * Prediction Model
 * ================
 * Tahmin veritabanı şeması
 */

const mongoose = require('mongoose');

// Tahmin seçeneği alt şeması
const optionSchema = new mongoose.Schema({
    text: {
        type: String,
        required: true,
        trim: true,
    },
    odds: {
        type: Number,
        default: 2.0, // Oran (kazanç çarpanı)
    },
    totalBets: {
        type: Number,
        default: 0,
    },
    totalCoins: {
        type: Number,
        default: 0,
    },
    isCorrect: {
        type: Boolean,
        default: null, // null = henüz sonuçlanmadı
    },
});

// Kullanıcı tahmini alt şeması
const userPredictionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    option: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    amount: {
        type: Number,
        required: true,
        min: 1,
    },
    predictedAt: {
        type: Date,
        default: Date.now,
    },
    result: {
        type: String,
        enum: ['pending', 'won', 'lost', 'refunded'],
        default: 'pending',
    },
    winnings: {
        type: Number,
        default: 0,
    },
});

// Ana tahmin şeması
const predictionSchema = new mongoose.Schema({
    // Temel Bilgiler
    title: {
        type: String,
        required: [true, 'Tahmin başlığı zorunludur'],
        trim: true,
        maxlength: [200, 'Başlık en fazla 200 karakter olabilir'],
    },
    description: {
        type: String,
        trim: true,
        maxlength: [1000, 'Açıklama en fazla 1000 karakter olabilir'],
    },
    image: {
        type: String,
        default: null,
    },

    // Kategori
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: [true, 'Kategori zorunludur'],
    },

    // Seçenekler
    options: [optionSchema],

    // Kullanıcı Tahminleri
    participants: [userPredictionSchema],

    // Zamanlama
    startDate: {
        type: Date,
        default: Date.now,
    },
    endDate: {
        type: Date,
        required: [true, 'Bitiş tarihi zorunludur'],
    },
    resultDate: {
        type: Date,
        default: null,
    },

    // Minimum/Maksimum bi! coin
    minBet: {
        type: Number,
        default: 10,
        min: 1,
    },
    maxBet: {
        type: Number,
        default: 1000,
    },

    // Durum
    status: {
        type: String,
        enum: ['draft', 'active', 'closed', 'resulted', 'cancelled'],
        default: 'draft',
    },

    // Sonuç
    correctOption: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    resultSource: {
        type: String,
        default: null, // Sonucun kaynağı (URL veya açıklama)
    },

    // İstatistikler
    totalPool: {
        type: Number,
        default: 0,
    },
    participantCount: {
        type: Number,
        default: 0,
    },
    viewCount: {
        type: Number,
        default: 0,
    },

    // Özellikler
    featured: {
        type: Boolean,
        default: false,
    },
    hot: {
        type: Boolean,
        default: false,
    },
    tags: [{
        type: String,
        trim: true,
    }],

    // Admin bilgileri
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    resultedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});

// ===================
// Virtual Fields
// ===================

// Aktif mi?
predictionSchema.virtual('isActive').get(function() {
    return this.status === 'active' && new Date() < this.endDate;
});

// Kalan süre (saniye)
predictionSchema.virtual('timeRemaining').get(function() {
    const now = new Date();
    const end = new Date(this.endDate);
    const diff = end - now;
    return Math.max(0, Math.floor(diff / 1000));
});

// İlerleme yüzdesi
predictionSchema.virtual('progress').get(function() {
    const now = new Date();
    const start = new Date(this.startDate);
    const end = new Date(this.endDate);
    const total = end - start;
    const elapsed = now - start;
    return Math.min(100, Math.max(0, (elapsed / total) * 100));
});

// En popüler seçenek
predictionSchema.virtual('popularOption').get(function() {
    if (!this.options || this.options.length === 0) return null;
    return this.options.reduce((max, opt) => 
        opt.totalBets > max.totalBets ? opt : max
    , this.options[0]);
});

// ===================
// Indexes
// ===================
predictionSchema.index({ status: 1, endDate: 1 });
predictionSchema.index({ category: 1 });
predictionSchema.index({ featured: 1, status: 1 });
predictionSchema.index({ createdAt: -1 });
predictionSchema.index({ participantCount: -1 });
predictionSchema.index({ 'participants.user': 1 });
predictionSchema.index({ tags: 1 });

// ===================
// Instance Methods
// ===================

// Kullanıcı tahmini ekle
predictionSchema.methods.addParticipant = async function(userId, optionId, amount) {
    // Zaten katılmış mı?
    const existingPrediction = this.participants.find(
        p => p.user.toString() === userId.toString()
    );
    if (existingPrediction) {
        throw new Error('Bu tahmine zaten katıldınız');
    }

    // Seçenek var mı?
    const option = this.options.id(optionId);
    if (!option) {
        throw new Error('Geçersiz seçenek');
    }

    // Tahmin aktif mi?
    if (!this.isActive) {
        throw new Error('Bu tahmin artık aktif değil');
    }

    // Miktar kontrolü
    if (amount < this.minBet || amount > this.maxBet) {
        throw new Error(`Yatırım ${this.minBet} - ${this.maxBet} bi! coin arasında olmalıdır`);
    }

    // Tahmini ekle
    this.participants.push({
        user: userId,
        option: optionId,
        amount,
    });

    // Seçenek istatistiklerini güncelle
    option.totalBets += 1;
    option.totalCoins += amount;

    // Genel istatistikleri güncelle
    this.totalPool += amount;
    this.participantCount += 1;

    // Oranları yeniden hesapla
    this.recalculateOdds();

    await this.save();
    return this;
};

// Oranları yeniden hesapla
predictionSchema.methods.recalculateOdds = function() {
    if (this.totalPool === 0) return;

    this.options.forEach(option => {
        if (option.totalCoins > 0) {
            // Basit oran hesaplama: toplam havuz / seçenek havuzu
            option.odds = Math.max(1.1, (this.totalPool / option.totalCoins).toFixed(2));
        }
    });
};

// Sonuçlandır
predictionSchema.methods.setResult = async function(correctOptionId, source, adminId) {
    if (this.status === 'resulted') {
        throw new Error('Bu tahmin zaten sonuçlandırılmış');
    }

    const correctOption = this.options.id(correctOptionId);
    if (!correctOption) {
        throw new Error('Geçersiz seçenek');
    }

    // Doğru seçeneği işaretle
    this.options.forEach(opt => {
        opt.isCorrect = opt._id.toString() === correctOptionId.toString();
    });

    this.correctOption = correctOptionId;
    this.resultSource = source;
    this.resultedBy = adminId;
    this.resultDate = new Date();
    this.status = 'resulted';

    // Kazananları hesapla ve öde
    const User = mongoose.model('User');
    const winningOdds = correctOption.odds;

    for (const participant of this.participants) {
        const user = await User.findById(participant.user);
        if (!user) continue;

        if (participant.option.toString() === correctOptionId.toString()) {
            // Kazandı
            const winnings = Math.floor(participant.amount * winningOdds);
            participant.result = 'won';
            participant.winnings = winnings;

            await user.addCoins(winnings, `prediction_win_${this._id}`);
            
            // İstatistikleri güncelle
            user.stats.correctPredictions += 1;
            user.stats.pendingPredictions -= 1;
            user.stats.streak += 1;
            if (user.stats.streak > user.stats.bestStreak) {
                user.stats.bestStreak = user.stats.streak;
            }
        } else {
            // Kaybetti
            participant.result = 'lost';
            
            // İstatistikleri güncelle
            user.stats.wrongPredictions += 1;
            user.stats.pendingPredictions -= 1;
            user.stats.streak = 0;
        }

        await user.save();
    }

    await this.save();
    return this;
};

// İptal et
predictionSchema.methods.cancel = async function(reason) {
    if (this.status === 'resulted') {
        throw new Error('Sonuçlanmış tahmin iptal edilemez');
    }

    // Tüm katılımcılara iade yap
    const User = mongoose.model('User');
    
    for (const participant of this.participants) {
        const user = await User.findById(participant.user);
        if (!user) continue;

        await user.addCoins(participant.amount, `prediction_refund_${this._id}`);
        participant.result = 'refunded';
        
        user.stats.pendingPredictions -= 1;
        await user.save();
    }

    this.status = 'cancelled';
    await this.save();
    return this;
};

// Görüntüleme sayısını artır
predictionSchema.methods.incrementViews = async function() {
    this.viewCount += 1;
    await this.save();
    return this.viewCount;
};

// ===================
// Static Methods
// ===================

// Aktif tahminleri getir
predictionSchema.statics.getActivePredictions = function(limit = 20) {
    return this.find({
        status: 'active',
        endDate: { $gt: new Date() },
    })
    .populate('category', 'name icon color')
    .sort({ featured: -1, participantCount: -1 })
    .limit(limit);
};

// Kategoriye göre getir
predictionSchema.statics.getByCategory = function(categoryId, limit = 20) {
    return this.find({
        category: categoryId,
        status: 'active',
        endDate: { $gt: new Date() },
    })
    .populate('category', 'name icon color')
    .sort({ participantCount: -1 })
    .limit(limit);
};

// Kullanıcının tahminlerini getir
predictionSchema.statics.getUserPredictions = function(userId, status = null) {
    const query = { 'participants.user': userId };
    if (status) {
        query.status = status;
    }
    
    return this.find(query)
        .populate('category', 'name icon color')
        .sort({ createdAt: -1 });
};

// Sonuçlanacak tahminleri getir
predictionSchema.statics.getPendingResults = function() {
    return this.find({
        status: 'active',
        endDate: { $lt: new Date() },
    })
    .populate('category', 'name')
    .sort({ endDate: 1 });
};

// Arama
predictionSchema.statics.search = function(query, limit = 20) {
    return this.find({
        $or: [
            { title: new RegExp(query, 'i') },
            { description: new RegExp(query, 'i') },
            { tags: new RegExp(query, 'i') },
        ],
        status: { $in: ['active', 'closed'] },
    })
    .populate('category', 'name icon color')
    .sort({ participantCount: -1 })
    .limit(limit);
};

const Prediction = mongoose.model('Prediction', predictionSchema);

module.exports = Prediction;
