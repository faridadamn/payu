# Payu — Platform Toko Online, Direct WhatsApp & Dynamic QRIS SaaS Engine

> *"Payu"* (bahasa Jawa & Sunda) artinya **Laris Manis / Laku Terjual**.  
> Payu adalah platform toko online instan & mesin operasional direct-to-consumer (D2C) yang dirancang agar UMKM dan pedagang mandiri bisa jualan online secara mandiri tanpa potongan komisi marketplace 10–15%.

---

## 🌟 Fitur Utama

### 1. High-Converting Landing Page (`/`)
- Hero section dengan penawaran tajam & nilai tambah toko.
- **Kalkulator Ongkir Akurat:** Estimasi tarif instan, sameday, dan ambil di toko.
- Etalase produk unggulan dengan tombol langsung beli.
- FAQ interaktif, testimoni pelanggan, dan petunjuk arah Google Maps presisi.
- Mobile-first responsif dengan splash screen ringan (bisa dilewati dengan 1-tap).

### 2. Toko Online & Etalase Cepat (`/toko/`)
- Navigasi chip kategori dinamis dengan dukungan deep-link (`?c=Kategori`).
- Pencarian produk realtime client-side.
- Keranjang belanja instan dengan sinkronisasi local storage.
- Checkout direct WhatsApp dengan rincian pesanan otomatis.
- **Dynamic QRIS Invoice:** Generate QRIS pembayaran instan + formulir upload bukti transfer dengan verifikasi *magic bytes* biner gambar (JPEG/PNG).
- Lacak status pesanan realtime dengan status workflow (*Pesanan Baru &rarr; Diproses &rarr; Dikirim &rarr; Selesai*).
- Widget Live Chat CS terhubung langsung ke panel admin.

### 3. Operations Admin Panel (`/admin/`)
- **Dashboard Pesanan:** Pantau pesanan baru, verifikasi bukti bayar, kirim resi, dan update status dalam 1 klik.
- **CS Live Chat Desk:** Meja layanan pelanggan multi-chat ala WhatsApp Web, bubble chat render, quick replies chips, dan broadcast pengumuman promo massal ke seluruh pelanggan.
- **Katalog & Stok:** Tambah/edit produk, atur harga, foto, dan switch aktif/nonaktif.
- **Pengaturan Profil Toko:** Konfigurasi nama toko, nomor WhatsApp, alamat, dan data merchant QRIS.
- **Theme Switcher:** Dukungan Dark Mode & Light Mode dengan standar kontras WCAG AA.
- **SaaS Hub & Modal Langganan:** Pantau masa aktif langganan toko dan QRIS perpanjangan resmi.

### 4. Backend Server Engine (`server.mjs`)
- Arsitektur microservices native Node.js tanpa framework bloatware.
- Kalkulasi ongkir otomatis berbasis jarak & tarif per-km.
- Keamanan berlapis: proteksi path traversal, price tampering prevention, IDOR authorization, file upload size limit & magic bytes checker.
- Single source of truth terintegrasi antara `config.json` toko dan database state.

---

## 🚀 Panduan Instalasi & Menjalankan

### Persyaratan
- Node.js v18.0.0 atau lebih baru.

### Menjalankan Server
```bash
# Clone repositori
git clone https://github.com/faridadamn/payu.git
cd payu

# Jalankan server
node server.mjs
```
Secara default, server akan berjalan di port `8701` (atau sesuaikan dengan environment variable `PORT`).

---

## 📂 Struktur Repositori

```
payu/
├── index.html          # Landing Page utama
├── landing.js          # Logic kalkulator ongkir & live catalog loader
├── server.mjs          # Backend server engine & API routes
├── package.json        # Manifest project
├── README.md           # Dokumentasi resmi
├── toko/               # Aplikasi Toko Online
│   ├── index.html      # Tampilan etalase toko
│   ├── app.js          # Cart, checkout, chat & tracking logic
│   ├── style.css       # Mobile & desktop responsive styling
│   ├── theme.js        # Dynamic color palette & WCAG helper
│   ├── config.json     # Konfigurasi toko single-source-of-truth
│   └── qris.jpg        # QRIS default merchant
├── admin/              # Operations Admin Panel
│   ├── index.html      # Dashboard admin operasional
│   └── admin.js        # Order workflow, CS desk & settings logic
└── img/                # Aset visual & gambar produk katalog
```

---

## 📄 Lisensi
Didistribusikan di bawah lisensi MIT. Dibuat dengan bangga oleh **[Farid Adam](https://faridadamn.my.id)**.
