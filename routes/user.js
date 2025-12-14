const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../config/database');
const { ensureAuthenticated } = require('../middleware/auth');

// Multer ayarları - profil resmi yükleme
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        const uploadDir = path.join(__dirname, '../public/uploads/avatars');
        // Klasör yoksa oluştur
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function(req, file, cb) {
        // Benzersiz dosya adı: user_id_timestamp.ext
        const ext = path.extname(file.originalname).toLowerCase();
        const filename = `user_${req.user.id}_${Date.now()}${ext}`;
        cb(null, filename);
    }
});

const fileFilter = (req, file, cb) => {
    // Sadece resim dosyaları
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Sadece resim dosyaları yüklenebilir (JPG, PNG, GIF, WebP)'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB limit
    }
});

// Kullanıcı adı değiştirme ücreti (bi! coin)
const KULLANICI_ADI_DEGISTIRME_UCRETI = 180;

// Profil Sayfası
router.get('/profil', ensureAuthenticated, async (req, res) => {
    try {
        console.log('📄 Profil sayfası yükleniyor, user:', req.user?.id);

        // Kullanıcı bilgilerini getir
        const kullanici = await db.getOne(`
            SELECT id, ad_soyad, kullanici_adi, email, avatar, bio, rol, bi_coin, seviye, xp,
                   toplam_tahmin, dogru_tahmin, seri, max_seri, premium_mi, premium_bitis,
                   dogrulanmis_mi, giris_yontemi, olusturma_tarihi, son_giris, ayarlar
            FROM kullanicilar
            WHERE id = ?
        `, [req.user.id]);

        if (!kullanici) {
            console.error('❌ Kullanıcı bulunamadı:', req.user.id);
            req.flash('error_msg', 'Kullanıcı bulunamadı');
            return res.redirect('/');
        }

        console.log('✅ Kullanıcı bulundu:', kullanici.kullanici_adi);

        // Sıralama
        const siralama = await db.getOne(`
            SELECT COUNT(*) + 1 as siralama
            FROM kullanicilar
            WHERE bi_coin > ? AND banlandi_mi = 0
        `, [kullanici.bi_coin || 0]);

        kullanici.siralama = siralama?.siralama || 0;
        kullanici.dogruluk_orani = kullanici.toplam_tahmin > 0
            ? Math.round((kullanici.dogru_tahmin / kullanici.toplam_tahmin) * 100)
            : 0;

        // Rozetleri getir
        const rozetler = await db.getAll(`
            SELECT r.*, kr.kazanilma_tarihi
            FROM kullanici_rozetleri kr
            JOIN rozetler r ON kr.rozet_id = r.id
            WHERE kr.kullanici_id = ?
            ORDER BY kr.kazanilma_tarihi DESC
        `, [req.user.id]) || [];

        // bi! coin geçmişi (son 10)
        const biGecmisi = await db.getAll(`
            SELECT * FROM bi_islemleri
            WHERE kullanici_id = ?
            ORDER BY olusturma_tarihi DESC
            LIMIT 10
        `, [req.user.id]) || [];

        // Son tahminler
        const sonTahminler = await db.getAll(`
            SELECT kt.*, t.baslik, t.durum as tahmin_durum
            FROM kullanici_tahminleri kt
            JOIN tahminler t ON kt.tahmin_id = t.id
            WHERE kt.kullanici_id = ?
            ORDER BY kt.olusturma_tarihi DESC
            LIMIT 10
        `, [req.user.id]) || [];

        console.log('✅ Profil verisi hazır, render ediliyor...');

        res.render('user/profil', {
            title: 'Profilim - Bilemezsin',
            layout: false,
            user: kullanici,
            rozetler,
            biGecmisi,
            sonTahminler,
            kullaniciAdiDegistirmeUcreti: KULLANICI_ADI_DEGISTIRME_UCRETI
        });
    } catch (err) {
        console.error('❌ Profil sayfası hatası:', err);
        req.flash('error_msg', 'Profil yüklenirken bir hata oluştu');
        res.redirect('/');
    }
});

// Kullanıcı Adı Değiştirme (180 bi! coin)
router.post('/profil/kullanici-adi-degistir', ensureAuthenticated, async (req, res) => {
    try {
        const { yeni_kullanici_adi } = req.body;
        const kullaniciId = req.user.id;

        // Validasyon
        if (!yeni_kullanici_adi) {
            return res.json({ success: false, message: 'Kullanıcı adı gerekli' });
        }

        const username = yeni_kullanici_adi.toLowerCase().trim();

        // Uzunluk kontrolü
        if (username.length < 3 || username.length > 20) {
            return res.json({ success: false, message: 'Kullanıcı adı 3-20 karakter olmalı' });
        }

        // Karakter kontrolü
        if (!/^[a-z0-9_]+$/.test(username)) {
            return res.json({ success: false, message: 'Kullanıcı adı sadece harf, rakam ve alt çizgi içerebilir' });
        }

        // Yasaklı kullanıcı adları
        const yasakliAdlar = ['admin', 'administrator', 'moderator', 'mod', 'bilemezsin', 'support', 'destek', 'system', 'root', 'null', 'undefined'];
        if (yasakliAdlar.includes(username)) {
            return res.json({ success: false, message: 'Bu kullanıcı adı kullanılamaz' });
        }

        // Aynı kullanıcı adı mı kontrol et
        const mevcutKullanici = await db.getOne('SELECT kullanici_adi, bi_coin FROM kullanicilar WHERE id = ?', [kullaniciId]);

        if (mevcutKullanici.kullanici_adi === username) {
            return res.json({ success: false, message: 'Bu zaten mevcut kullanıcı adınız' });
        }

        // Kullanıcı adı müsait mi?
        const kullaniciAdiMevcut = await db.getOne(
            'SELECT id FROM kullanicilar WHERE kullanici_adi = ? AND id != ?',
            [username, kullaniciId]
        );

        if (kullaniciAdiMevcut) {
            return res.json({ success: false, message: 'Bu kullanıcı adı zaten kullanılıyor' });
        }

        // bi! coin kontrolü
        if (mevcutKullanici.bi_coin < KULLANICI_ADI_DEGISTIRME_UCRETI) {
            return res.json({
                success: false,
                message: `Kullanıcı adı değiştirmek için ${KULLANICI_ADI_DEGISTIRME_UCRETI} bi! coin gerekli. Mevcut bakiyeniz: ${mevcutKullanici.bi_coin} bi!`
            });
        }

        // bi! coin düş
        const yeniBakiye = mevcutKullanici.bi_coin - KULLANICI_ADI_DEGISTIRME_UCRETI;

        await db.execute(
            'UPDATE kullanicilar SET kullanici_adi = ?, bi_coin = ? WHERE id = ?',
            [username, yeniBakiye, kullaniciId]
        );

        // bi! işlem kaydı oluştur
        await db.insert(
            `INSERT INTO bi_islemleri (kullanici_id, miktar, tip, aciklama, bakiye_sonrasi)
             VALUES (?, ?, 'harcama', ?, ?)`,
            [kullaniciId, -KULLANICI_ADI_DEGISTIRME_UCRETI, 'Kullanıcı adı değişikliği', yeniBakiye]
        );

        res.json({
            success: true,
            message: 'Kullanıcı adınız başarıyla değiştirildi!',
            yeni_kullanici_adi: username,
            yeni_bakiye: yeniBakiye
        });

    } catch (err) {
        console.error('Kullanıcı adı değiştirme hatası:', err);
        res.json({ success: false, message: 'Bir hata oluştu, lütfen tekrar deneyin' });
    }
});

// Profil Güncelleme (ad_soyad, bio)
router.post('/profil/guncelle', ensureAuthenticated, async (req, res) => {
    try {
        console.log('📝 Profil güncelleme isteği:', req.body);
        const { ad_soyad, bio } = req.body;
        const kullaniciId = req.user.id;

        // Validasyon
        if (!ad_soyad || ad_soyad.trim().length < 2 || ad_soyad.trim().length > 50) {
            console.log('❌ Validasyon hatası: ad_soyad geçersiz');
            return res.json({ success: false, message: 'İsim 2-50 karakter arasında olmalıdır' });
        }

        // Bio max 200 karakter
        const temizBio = bio ? bio.substring(0, 200) : '';

        console.log('💾 Veritabanı güncelleniyor:', { ad_soyad: ad_soyad.trim(), bio: temizBio, kullaniciId });

        await db.execute(
            'UPDATE kullanicilar SET ad_soyad = ?, bio = ? WHERE id = ?',
            [ad_soyad.trim(), temizBio, kullaniciId]
        );

        console.log('✅ Profil başarıyla güncellendi');
        res.json({ success: true, message: 'Profiliniz güncellendi!' });

    } catch (err) {
        console.error('❌ Profil güncelleme hatası:', err);
        res.json({ success: false, message: 'Bir hata oluştu' });
    }
});

// Profil Resmi Yükleme
router.post('/profil/avatar-yukle', ensureAuthenticated, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.json({ success: false, message: 'Lütfen bir resim seçin' });
        }

        console.log('📸 Avatar yükleniyor:', req.file.filename);
        const kullaniciId = req.user.id;

        // Eski avatar'ı sil (varsa ve local ise)
        const eskiKullanici = await db.getOne('SELECT avatar FROM kullanicilar WHERE id = ?', [kullaniciId]);
        if (eskiKullanici && eskiKullanici.avatar && eskiKullanici.avatar.includes('/uploads/avatars/')) {
            const eskiDosya = path.join(__dirname, '../public', eskiKullanici.avatar);
            if (fs.existsSync(eskiDosya)) {
                fs.unlinkSync(eskiDosya);
                console.log('🗑️ Eski avatar silindi:', eskiDosya);
            }
        }

        // Yeni avatar URL'i
        const avatarUrl = `/uploads/avatars/${req.file.filename}`;

        // Veritabanını güncelle
        await db.execute(
            'UPDATE kullanicilar SET avatar = ? WHERE id = ?',
            [avatarUrl, kullaniciId]
        );

        console.log('✅ Avatar başarıyla güncellendi:', avatarUrl);
        res.json({
            success: true,
            message: 'Profil resmi başarıyla güncellendi!',
            avatar: avatarUrl
        });

    } catch (err) {
        console.error('❌ Avatar yükleme hatası:', err);
        // Multer hataları için özel mesajlar
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.json({ success: false, message: 'Dosya boyutu çok büyük (maksimum 2MB)' });
        }
        res.json({ success: false, message: err.message || 'Bir hata oluştu' });
    }
});

// Profil Resmi Silme
router.post('/profil/avatar-sil', ensureAuthenticated, async (req, res) => {
    try {
        const kullaniciId = req.user.id;

        // Mevcut avatar'ı al
        const kullanici = await db.getOne('SELECT avatar FROM kullanicilar WHERE id = ?', [kullaniciId]);

        // Eğer local bir avatar varsa dosyayı sil
        if (kullanici && kullanici.avatar && kullanici.avatar.includes('/uploads/avatars/')) {
            const dosyaYolu = path.join(__dirname, '../public', kullanici.avatar);
            if (fs.existsSync(dosyaYolu)) {
                fs.unlinkSync(dosyaYolu);
                console.log('🗑️ Avatar dosyası silindi:', dosyaYolu);
            }
        }

        // Veritabanında avatar'ı NULL yap
        await db.execute(
            'UPDATE kullanicilar SET avatar = NULL WHERE id = ?',
            [kullaniciId]
        );

        console.log('✅ Avatar başarıyla silindi');
        res.json({ success: true, message: 'Profil resmi kaldırıldı' });

    } catch (err) {
        console.error('❌ Avatar silme hatası:', err);
        res.json({ success: false, message: 'Bir hata oluştu' });
    }
});

// Dashboard
router.get('/dashboard', ensureAuthenticated, async (req, res) => {
    try {
        // Aktif tahminleri getir
        const tahminler = await db.getAll(`
            SELECT t.*, k.ad as kategori_adi, k.ikon as kategori_ikon, k.renk as kategori_renk
            FROM tahminler t
            LEFT JOIN kategoriler k ON t.kategori_id = k.id
            WHERE t.durum = 'aktif'
            ORDER BY t.olusturma_tarihi DESC
            LIMIT 10
        `);

        // Kategorileri getir
        const kategoriler = await db.getAll(
            'SELECT * FROM kategoriler WHERE aktif_mi = 1 ORDER BY sira'
        );

        // Kullanıcı istatistikleri
        const kullanici = await db.getOne(`
            SELECT bi_coin, toplam_tahmin, dogru_tahmin, seri
            FROM kullanicilar WHERE id = ?
        `, [req.user.id]);

        res.render('user/dashboard', {
            title: 'Dashboard - Bilemezsin',
            layout: 'layouts/main',
            tahminler,
            kategoriler,
            kullanici
        });
    } catch (err) {
        console.error('Dashboard hatası:', err);
        res.redirect('/');
    }
});

module.exports = router;
