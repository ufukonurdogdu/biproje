/**
 * Category Model
 * ==============
 * Kategori veritabanı şeması
 */

const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    // Temel Bilgiler
    name: {
        type: String,
        required: [true, 'Kategori adı zorunludur'],
        unique: true,
        trim: true,
        maxlength: [50, 'Kategori adı en fazla 50 karakter olabilir'],
    },
    slug: {
        type: String,
        unique: true,
        lowercase: true,
    },
    description: {
        type: String,
        maxlength: [200, 'Açıklama en fazla 200 karakter olabilir'],
    },

    // Görsel
    icon: {
        type: String,
        default: '📁', // Emoji icon
    },
    image: {
        type: String,
        default: null,
    },
    color: {
        type: String,
        default: '#6366f1', // Accent color
    },

    // Hiyerarşi
    parent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        default: null,
    },

    // Sıralama ve Durum
    order: {
        type: Number,
        default: 0,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    featured: {
        type: Boolean,
        default: false,
    },

    // İstatistikler
    stats: {
        totalPredictions: { type: Number, default: 0 },
        activePredictions: { type: Number, default: 0 },
        totalParticipants: { type: Number, default: 0 },
    },

    // Meta
    meta: {
        title: String,
        description: String,
        keywords: [String],
    },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});

// ===================
// Virtual Fields
// ===================

// Alt kategoriler
categorySchema.virtual('children', {
    ref: 'Category',
    localField: '_id',
    foreignField: 'parent',
});

// Aktif tahmin sayısı
categorySchema.virtual('predictions', {
    ref: 'Prediction',
    localField: '_id',
    foreignField: 'category',
    count: true,
});

// ===================
// Indexes
// ===================
categorySchema.index({ slug: 1 });
categorySchema.index({ parent: 1 });
categorySchema.index({ order: 1 });
categorySchema.index({ isActive: 1, featured: 1 });

// ===================
// Pre-save Hooks
// ===================

// Slug oluşturma
categorySchema.pre('save', function(next) {
    if (!this.slug || this.isModified('name')) {
        this.slug = this.name
            .toLowerCase()
            .replace(/ğ/g, 'g')
            .replace(/ü/g, 'u')
            .replace(/ş/g, 's')
            .replace(/ı/g, 'i')
            .replace(/ö/g, 'o')
            .replace(/ç/g, 'c')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }
    next();
});

// ===================
// Instance Methods
// ===================

// İstatistikleri güncelle
categorySchema.methods.updateStats = async function() {
    const Prediction = mongoose.model('Prediction');
    
    const [total, active, participants] = await Promise.all([
        Prediction.countDocuments({ category: this._id }),
        Prediction.countDocuments({ category: this._id, status: 'active' }),
        Prediction.aggregate([
            { $match: { category: this._id } },
            { $group: { _id: null, total: { $sum: '$participantCount' } } },
        ]),
    ]);
    
    this.stats.totalPredictions = total;
    this.stats.activePredictions = active;
    this.stats.totalParticipants = participants[0]?.total || 0;
    
    await this.save();
    return this.stats;
};

// ===================
// Static Methods
// ===================

// Aktif kategorileri getir
categorySchema.statics.getActiveCategories = function() {
    return this.find({ isActive: true, parent: null })
        .sort({ order: 1, name: 1 })
        .populate('children');
};

// Featured kategorileri getir
categorySchema.statics.getFeaturedCategories = function(limit = 8) {
    return this.find({ isActive: true, featured: true })
        .sort({ order: 1 })
        .limit(limit);
};

// Slug ile bul
categorySchema.statics.findBySlug = function(slug) {
    return this.findOne({ slug, isActive: true });
};

// Kategorileri istatistiklerle getir
categorySchema.statics.getCategoriesWithStats = async function() {
    const categories = await this.find({ isActive: true, parent: null })
        .sort({ order: 1 });
    
    // Her kategori için istatistikleri güncelle
    for (const cat of categories) {
        await cat.updateStats();
    }
    
    return categories;
};

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;
