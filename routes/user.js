const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { ensureAuthenticated } = require('../middleware/auth');

// Kullanıcı adı değiştirme ücreti (bi! coin)
const KULLANICI_ADI_DEGISTIRME_UCRETI = 180;

// Profil Sayfası
router.get('/profil', ensureAuthenticated, async (req, res) => {
    try {
        // Kullanıcı bilgilerini getir
        const kullanici = await db.getOne(`
            SELECT id, ad_soyad, kullanici_adi, email, avatar, bio, rol, bi_coin, seviye, xp,
                   toplam_tahmin, dogru_tahmin, seri, max_seri, premium_mi, premium_bitis,
                   dogrulanmis_mi, giris_yontemi, olusturma_tarihi, son_giris, ayarlar
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

        // Rozetleri getir
        const rozetler = await db.getAll(`
            SELECT r.*, kr.kazanilma_tarihi
            FROM kullanici_rozetleri kr
            JOIN rozetler r ON kr.rozet_id = r.id
            WHERE kr.kullanici_id = ?
            ORDER BY kr.kazanilma_tarihi DESC
        `, [req.user.id]);

        // bi! coin geçmişi (son 10)
        const biGecmisi = await db.getAll(`
            SELECT * FROM bi_islemleri
            WHERE kullanici_id = ?
            ORDER BY olusturma_tarihi DESC
            LIMIT 10
        `, [req.user.id]);

        // Son tahminler
        const sonTahminler = await db.getAll(`
            SELECT kt.*, t.baslik, t.durum as tahmin_durum
            FROM kullanici_tahminleri kt
            JOIN tahminler t ON kt.tahmin_id = t.id
            WHERE kt.kullanici_id = ?
            ORDER BY kt.olusturma_tarihi DESC
            LIMIT 10
        `, [req.user.id]);

        res.render('user/profil', {
            title: 'Profilim - Bilemezsin',
            layout: 'layouts/main',
            user: kullanici,
            rozetler,
            biGecmisi,
            sonTahminler,
            kullaniciAdiDegistirmeUcreti: KULLANICI_ADI_DEGISTIRME_UCRETI
        });
    } catch (err) {
        console.error('Profil sayfası hatası:', err);
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
        const { ad_soyad, bio } = req.body;
        const kullaniciId = req.user.id;

        // Validasyon
        if (!ad_soyad || ad_soyad.trim().length < 2 || ad_soyad.trim().length > 50) {
            return res.json({ success: false, message: 'İsim 2-50 karakter arasında olmalıdır' });
        }

        // Bio max 200 karakter
        const temizBio = bio ? bio.substring(0, 200) : '';

        await db.execute(
            'UPDATE kullanicilar SET ad_soyad = ?, bio = ? WHERE id = ?',
            [ad_soyad.trim(), temizBio, kullaniciId]
        );

        res.json({ success: true, message: 'Profiliniz güncellendi!' });

    } catch (err) {
        console.error('Profil güncelleme hatası:', err);
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
