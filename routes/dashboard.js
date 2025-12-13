const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { body, validationResult } = require('express-validator');
const { ensureAuthenticated, ensureAuthenticatedAPI, ensureAdminAPI } = require('../middleware/auth');

// Kullanıcı adı değiştirme ücreti (bi! coin)
const USERNAME_CHANGE_COST = 180;

// ==================== VIEW ROUTES ====================

// Dashboard Ana Sayfa
router.get('/', ensureAuthenticated, async (req, res) => {
    try {
        const tahminler = await db.getAll(`
            SELECT t.*, k.ad as kategori_adi, k.ikon as kategori_ikon
            FROM tahminler t
            LEFT JOIN kategoriler k ON t.kategori_id = k.id
            WHERE t.durum = 'aktif'
            ORDER BY t.olusturma_tarihi DESC
            LIMIT 10
        `);

        res.render('user/dashboard', {
            title: 'Dashboard - Bilemezsin',
            layout: 'layouts/user',
            tahminler
        });
    } catch (err) {
        console.error('Dashboard hatası:', err);
        req.flash('error_msg', 'Bir hata oluştu');
        res.redirect('/');
    }
});

// Profil Sayfası
router.get('/profil', ensureAuthenticated, async (req, res) => {
    try {
        res.render('user/profil', {
            title: 'Profil - Bilemezsin',
            layout: false // profil.ejs kendi layout'unu içeriyor
        });
    } catch (err) {
        console.error('Profil hatası:', err);
        req.flash('error_msg', 'Bir hata oluştu');
        res.redirect('/dashboard');
    }
});

// Profil Güncelleme (ad_soyad, bio)
router.post('/profil', ensureAuthenticated, [
    body('ad_soyad').trim().isLength({ min: 2, max: 50 }).withMessage('İsim 2-50 karakter olmalı'),
    body('bio').trim().isLength({ max: 200 }).withMessage('Bio en fazla 200 karakter olabilir')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        req.flash('error_msg', errors.array()[0].msg);
        return res.redirect('/dashboard/profil');
    }

    try {
        const { ad_soyad, bio } = req.body;
        await db.execute(
            'UPDATE kullanicilar SET ad_soyad = ?, bio = ? WHERE id = ?',
            [ad_soyad, bio || null, req.user.id]
        );
        req.flash('success_msg', 'Profil güncellendi');
        res.redirect('/dashboard/profil');
    } catch (err) {
        console.error('Profil güncelleme hatası:', err);
        req.flash('error_msg', 'Bir hata oluştu');
        res.redirect('/dashboard/profil');
    }
});

// Kullanıcı Adı Değiştirme (180 bi! coin)
router.post('/profil/kullanici-adi-degistir', ensureAuthenticated, [
    body('yeni_kullanici_adi')
        .trim()
        .isLength({ min: 3, max: 20 }).withMessage('Kullanıcı adı 3-20 karakter olmalı')
        .matches(/^[a-z0-9_]+$/).withMessage('Sadece küçük harf, rakam ve alt çizgi kullanılabilir')
        .toLowerCase()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        req.flash('error_msg', errors.array()[0].msg);
        return res.redirect('/dashboard/profil');
    }

    const yeniKullaniciAdi = req.body.yeni_kullanici_adi.toLowerCase();

    try {
        // Yasaklı kullanıcı adları kontrolü
        const yasakliAdlar = ['admin', 'administrator', 'moderator', 'mod', 'bilemezsin', 'bilemedin', 'support', 'destek', 'system', 'root', 'null', 'undefined'];
        if (yasakliAdlar.includes(yeniKullaniciAdi)) {
            req.flash('error_msg', 'Bu kullanıcı adı kullanılamaz');
            return res.redirect('/dashboard/profil');
        }

        // Kullanıcı adı müsait mi kontrol et
        const mevcutKullanici = await db.getOne(
            'SELECT id FROM kullanicilar WHERE kullanici_adi = ? AND id != ?',
            [yeniKullaniciAdi, req.user.id]
        );

        if (mevcutKullanici) {
            req.flash('error_msg', 'Bu kullanıcı adı zaten kullanılıyor');
            return res.redirect('/dashboard/profil');
        }

        // bi! coin kontrolü
        if (req.user.bi_coin < USERNAME_CHANGE_COST) {
            req.flash('error_msg', `Kullanıcı adı değiştirmek için ${USERNAME_CHANGE_COST} bi! coin gerekiyor. Mevcut bakiyeniz: ${req.user.bi_coin} bi!`);
            return res.redirect('/dashboard/profil');
        }

        // bi! coin düş ve kullanıcı adını güncelle
        await db.execute(
            'UPDATE kullanicilar SET kullanici_adi = ?, bi_coin = bi_coin - ? WHERE id = ?',
            [yeniKullaniciAdi, USERNAME_CHANGE_COST, req.user.id]
        );

        // bi! işlem kaydı oluştur
        const yeniBakiye = req.user.bi_coin - USERNAME_CHANGE_COST;
        await db.insert(
            `INSERT INTO bi_islemleri (kullanici_id, miktar, tip, aciklama, bakiye_sonrasi) VALUES (?, ?, ?, ?, ?)`,
            [req.user.id, -USERNAME_CHANGE_COST, 'harcama', 'Kullanıcı adı değişikliği', yeniBakiye]
        );

        req.flash('success_msg', `Kullanıcı adınız @${yeniKullaniciAdi} olarak değiştirildi. ${USERNAME_CHANGE_COST} bi! hesabınızdan düşüldü.`);
        res.redirect('/dashboard/profil');

    } catch (err) {
        console.error('Kullanıcı adı değiştirme hatası:', err);
        req.flash('error_msg', 'Bir hata oluştu');
        res.redirect('/dashboard/profil');
    }
});

// Tahminler Sayfası
router.get('/tahminlerim', ensureAuthenticated, async (req, res) => {
    try {
        const tahminlerim = await db.getAll(`
            SELECT kt.*, t.baslik, t.durum, t.dogru_cevap, k.ad as kategori_adi
            FROM kullanici_tahminleri kt
            JOIN tahminler t ON kt.tahmin_id = t.id
            LEFT JOIN kategoriler k ON t.kategori_id = k.id
            WHERE kt.kullanici_id = ?
            ORDER BY kt.olusturma_tarihi DESC
        `, [req.user.id]);

        res.render('user/tahminlerim', {
            title: 'Tahminlerim - Bilemezsin',
            layout: 'layouts/user',
            tahminlerim
        });
    } catch (err) {
        console.error('Tahminlerim hatası:', err);
        req.flash('error_msg', 'Bir hata oluştu');
        res.redirect('/dashboard');
    }
});

// Ayarlar Sayfası
router.get('/ayarlar', ensureAuthenticated, (req, res) => {
    res.render('user/ayarlar', {
        title: 'Ayarlar - Bilemezsin',
        layout: 'layouts/user'
    });
});

// Ayarlar Güncelleme
router.post('/ayarlar', ensureAuthenticated, async (req, res) => {
    try {
        const { tema, bildirimler, email_bildirimleri } = req.body;
        const ayarlar = JSON.stringify({
            tema: tema || 'auto',
            bildirimler: bildirimler === 'on',
            email_bildirimleri: email_bildirimleri === 'on',
            dil: 'tr'
        });

        await db.execute('UPDATE kullanicilar SET ayarlar = ? WHERE id = ?', [ayarlar, req.user.id]);
        req.flash('success_msg', 'Ayarlar kaydedildi');
        res.redirect('/dashboard/ayarlar');
    } catch (err) {
        console.error('Ayarlar güncelleme hatası:', err);
        req.flash('error_msg', 'Bir hata oluştu');
        res.redirect('/dashboard/ayarlar');
    }
});

// ==================== API ROUTES ====================

// Tahminleri Getir
router.get('/tahminler', async (req, res) => {
    try {
        const { kategori, durum = 'aktif', limit = 20, offset = 0 } = req.query;
        
        let sql = `
            SELECT t.*, k.ad as kategori_adi, k.ikon as kategori_ikon, k.renk as kategori_renk
            FROM tahminler t
            LEFT JOIN kategoriler k ON t.kategori_id = k.id
            WHERE t.durum = ?
        `;
        const params = [durum];

        if (kategori) {
            sql += ' AND k.slug = ?';
            params.push(kategori);
        }

        sql += ' ORDER BY t.olusturma_tarihi DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const tahminler = await db.getAll(sql, params);

        res.json({ success: true, data: tahminler });
    } catch (err) {
        console.error('API tahminler hatası:', err);
        res.status(500).json({ success: false, message: 'Bir hata oluştu' });
    }
});

// Tek Tahmin Getir
router.get('/tahminler/:id', async (req, res) => {
    try {
        const tahmin = await db.getOne(`
            SELECT t.*, k.ad as kategori_adi, k.ikon as kategori_ikon
            FROM tahminler t
            LEFT JOIN kategoriler k ON t.kategori_id = k.id
            WHERE t.id = ?
        `, [req.params.id]);

        if (!tahmin) {
            return res.status(404).json({ success: false, message: 'Tahmin bulunamadı' });
        }

        res.json({ success: true, data: tahmin });
    } catch (err) {
        console.error('API tek tahmin hatası:', err);
        res.status(500).json({ success: false, message: 'Bir hata oluştu' });
    }
});

// Tahmin Yap
router.post('/tahminler/:id/tahmin-yap', ensureAuthenticatedAPI, async (req, res) => {
    try {
        const tahminId = req.params.id;
        const kullaniciId = req.user.id;
        const { secim } = req.body;

        if (!secim || !['evet', 'hayir'].includes(secim.toLowerCase())) {
            return res.status(400).json({ success: false, message: 'Geçersiz seçim' });
        }

        // Tahmin kontrolü
        const tahmin = await db.getOne('SELECT * FROM tahminler WHERE id = ? AND durum = "aktif"', [tahminId]);
        if (!tahmin) {
            return res.status(404).json({ success: false, message: 'Aktif tahmin bulunamadı' });
        }

        // Daha önce tahmin yapılmış mı?
        const mevcutTahmin = await db.getOne(
            'SELECT id FROM kullanici_tahminleri WHERE kullanici_id = ? AND tahmin_id = ?',
            [kullaniciId, tahminId]
        );
        if (mevcutTahmin) {
            return res.status(400).json({ success: false, message: 'Bu tahmin için zaten oy kullandınız' });
        }

        // Tahmin yap
        await db.insert(
            'INSERT INTO kullanici_tahminleri (kullanici_id, tahmin_id, secim) VALUES (?, ?, ?)',
            [kullaniciId, tahminId, secim.toLowerCase()]
        );

        // Katılım sayısını güncelle
        await db.execute('UPDATE tahminler SET katilim_sayisi = katilim_sayisi + 1 WHERE id = ?', [tahminId]);

        // Kullanıcının toplam tahminini güncelle
        await db.execute('UPDATE kullanicilar SET toplam_tahmin = toplam_tahmin + 1 WHERE id = ?', [kullaniciId]);

        // Oranları güncelle
        const oranlar = await db.getOne(`
            SELECT 
                COUNT(CASE WHEN secim = 'evet' THEN 1 END) as evet_count,
                COUNT(CASE WHEN secim = 'hayir' THEN 1 END) as hayir_count,
                COUNT(*) as total
            FROM kullanici_tahminleri
            WHERE tahmin_id = ?
        `, [tahminId]);

        const evetOrani = ((oranlar.evet_count / oranlar.total) * 100).toFixed(2);
        const hayirOrani = ((oranlar.hayir_count / oranlar.total) * 100).toFixed(2);

        await db.execute(
            'UPDATE tahminler SET evet_orani = ?, hayir_orani = ? WHERE id = ?',
            [evetOrani, hayirOrani, tahminId]
        );

        res.json({ 
            success: true, 
            message: 'Tahmininiz kaydedildi',
            data: {
                evet_orani: parseFloat(evetOrani),
                hayir_orani: parseFloat(hayirOrani),
                katilim_sayisi: oranlar.total
            }
        });
    } catch (err) {
        console.error('API tahmin yap hatası:', err);
        res.status(500).json({ success: false, message: 'Bir hata oluştu' });
    }
});

// Kategorileri Getir
router.get('/kategoriler', async (req, res) => {
    try {
        const kategoriler = await db.getAll('SELECT * FROM kategoriler WHERE aktif_mi = 1 ORDER BY sira');
        res.json({ success: true, data: kategoriler });
    } catch (err) {
        console.error('API kategoriler hatası:', err);
        res.status(500).json({ success: false, message: 'Bir hata oluştu' });
    }
});

// Kullanıcı Adı Müsaitlik Kontrolü (Live Check)
router.get('/kullanici-adi-kontrol', async (req, res) => {
    try {
        const { kullanici_adi } = req.query;

        if (!kullanici_adi) {
            return res.json({ available: false, message: 'Kullanıcı adı gerekli' });
        }

        const username = kullanici_adi.toLowerCase().trim();

        // Uzunluk kontrolü
        if (username.length < 3 || username.length > 20) {
            return res.json({ available: false, message: 'Kullanıcı adı 3-20 karakter olmalı' });
        }

        // Karakter kontrolü
        if (!/^[a-z0-9_]+$/.test(username)) {
            return res.json({ available: false, message: 'Geçersiz karakterler' });
        }

        // Yasaklı kullanıcı adları
        const yasakliAdlar = ['admin', 'administrator', 'moderator', 'mod', 'bilemezsin', 'support', 'destek', 'system', 'root', 'null', 'undefined'];
        if (yasakliAdlar.includes(username)) {
            return res.json({ available: false, message: 'Bu kullanıcı adı kullanılamaz' });
        }

        // Veritabanında kontrol
        const mevcutKullanici = await db.getOne(
            'SELECT id FROM kullanicilar WHERE kullanici_adi = ?',
            [username]
        );

        if (mevcutKullanici) {
            return res.json({ available: false, message: 'Bu kullanıcı adı kullanılıyor' });
        }

        res.json({ available: true, message: 'Kullanıcı adı müsait' });

    } catch (err) {
        console.error('Kullanıcı adı kontrol hatası:', err);
        res.status(500).json({ available: false, message: 'Bir hata oluştu' });
    }
});

// Sıralamayı Getir
router.get('/siralama', async (req, res) => {
    try {
        const { limit = 100 } = req.query;

        const kullanicilar = await db.getAll(`
            SELECT id, ad_soyad, kullanici_adi, avatar, bi_coin, seviye, 
                   toplam_tahmin, dogru_tahmin, seri, premium_mi
            FROM kullanicilar
            WHERE banlandi_mi = 0
            ORDER BY bi_coin DESC
            LIMIT ?
        `, [parseInt(limit)]);

        res.json({ success: true, data: kullanicilar });
    } catch (err) {
        console.error('API sıralama hatası:', err);
        res.status(500).json({ success: false, message: 'Bir hata oluştu' });
    }
});

// Kullanıcı Bilgisi
router.get('/profil', ensureAuthenticatedAPI, async (req, res) => {
    try {
        const kullanici = await db.getOne(`
            SELECT id, ad_soyad, kullanici_adi, email, avatar, bio, rol, bi_coin, seviye, xp,
                   toplam_tahmin, dogru_tahmin, seri, max_seri, premium_mi, dogrulanmis_mi,
                   olusturma_tarihi
            FROM kullanicilar
            WHERE id = ?
        `, [req.user.id]);

        // Sıralama
        const siralama = await db.getOne(`
            SELECT COUNT(*) + 1 as siralama
            FROM kullanicilar
            WHERE bi_coin > ? AND banlandi_mi = 0
        `, [kullanici.bi_coin]);

        kullanici.siralama = siralama?.siralama || 0;
        kullanici.dogruluk_orani = kullanici.toplam_tahmin > 0 
            ? Math.round((kullanici.dogru_tahmin / kullanici.toplam_tahmin) * 100) 
            : 0;

        res.json({ success: true, data: kullanici });
    } catch (err) {
        console.error('API profil hatası:', err);
        res.status(500).json({ success: false, message: 'Bir hata oluştu' });
    }
});

// Bildirimleri Getir
router.get('/bildirimler', ensureAuthenticatedAPI, async (req, res) => {
    try {
        const bildirimler = await db.getAll(`
            SELECT * FROM bildirimler
            WHERE kullanici_id = ?
            ORDER BY olusturma_tarihi DESC
            LIMIT 20
        `, [req.user.id]);

        const okunmamisCount = await db.getOne(`
            SELECT COUNT(*) as count FROM bildirimler
            WHERE kullanici_id = ? AND okundu_mu = 0
        `, [req.user.id]);

        res.json({ 
            success: true, 
            data: bildirimler,
            okunmamis: okunmamisCount?.count || 0
        });
    } catch (err) {
        console.error('API bildirimler hatası:', err);
        res.status(500).json({ success: false, message: 'Bir hata oluştu' });
    }
});

// Bildirimi Okundu İşaretle
router.post('/bildirimler/:id/okundu', ensureAuthenticatedAPI, async (req, res) => {
    try {
        await db.execute(
            'UPDATE bildirimler SET okundu_mu = 1 WHERE id = ? AND kullanici_id = ?',
            [req.params.id, req.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('API bildirim okundu hatası:', err);
        res.status(500).json({ success: false, message: 'Bir hata oluştu' });
    }
});

// Tüm Bildirimleri Okundu İşaretle
router.post('/bildirimler/tumunu-oku', ensureAuthenticatedAPI, async (req, res) => {
    try {
        await db.execute(
            'UPDATE bildirimler SET okundu_mu = 1 WHERE kullanici_id = ?',
            [req.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('API tüm bildirimleri oku hatası:', err);
        res.status(500).json({ success: false, message: 'Bir hata oluştu' });
    }
});

// Admin: İstatistikler
router.get('/admin/istatistikler', ensureAdminAPI, async (req, res) => {
    try {
        const stats = {};

        const userCount = await db.getOne('SELECT COUNT(*) as total FROM kullanicilar');
        stats.toplamKullanici = userCount?.total || 0;

        const todayUsers = await db.getOne(`
            SELECT COUNT(*) as total FROM kullanicilar 
            WHERE DATE(olusturma_tarihi) = CURDATE()
        `);
        stats.bugunKayit = todayUsers?.total || 0;

        const activePredictions = await db.getOne('SELECT COUNT(*) as total FROM tahminler WHERE durum = "aktif"');
        stats.aktifTahmin = activePredictions?.total || 0;

        const totalVotes = await db.getOne('SELECT COUNT(*) as total FROM kullanici_tahminleri');
        stats.toplamOy = totalVotes?.total || 0;

        res.json({ success: true, data: stats });
    } catch (err) {
        console.error('API admin istatistikler hatası:', err);
        res.status(500).json({ success: false, message: 'Bir hata oluştu' });
    }
});

module.exports = router;