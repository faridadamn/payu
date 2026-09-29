#!/usr/bin/env node
/**
 * PAYU — toko pribadi Adam. Zero-dependency Node bridge.
 * Port 8650, storage file JSON (products.json + orders.json).
 *
 * Subdomain: payu.faridadamn.my.id  (atau lokasi nginx lain)
 * Endpoints:
 *   GET  /api/health
 *   GET  /api/products          -> katalog
 *   POST /api/products          -> tambah produk (admin)
 *   PUT  /api/products/:id      -> update produk (admin)
 *   DELETE /api/products/:id    -> hapus produk (admin)
 *   POST /api/orders            -> checkout (customer)
 *   GET  /api/orders            -> semua orders (admin)
 *   GET  /api/orders/:id        -> status order by id (customer track)
 *   PUT  /api/orders/:id/status -> update status (admin workflow)
 *   GET  /api/qris              -> QRIS statis kosong + cara bayar
 *   POST /api/auth/login        -> {token} -> {ok} singleton admin token
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PAYU_PORT || 8650);
const HOST = process.env.PAYU_HOST || '127.0.0.1';

const STATE_DIR = path.join(__dirname, 'state');
const PRODUCTS_FILE = path.join(STATE_DIR, 'products.json');
const ORDERS_FILE = path.join(STATE_DIR, 'orders.json');
const CHATS_FILE = path.join(STATE_DIR, 'chats.json');
const USERS_FILE = path.join(STATE_DIR, 'users.json');
const OTPS_FILE = path.join(STATE_DIR, 'otps.json');
const SETTINGS_FILE = path.join(STATE_DIR, 'settings.json');
const SUBSCRIPTION_FILE = path.join(STATE_DIR, 'subscription.json');
const HASHES_FILE = path.join(STATE_DIR, 'receipt_hashes.json');
const TOKO_CONFIG_PATH = process.env.TOKO_CONFIG_PATH || '/var/www/toko-kit/toko/config.json';

function getSettings() {
  const def = {
    storeName: "Setia Jaya Teknik",
    storeDesc: "Alat Teknik, Mesin & Perlengkapan Bengkel Terlengkap di Tangerang",
    adminPhone: "6281212686654",
    waPublic: "6281212686654",
    address: "Jl. Raya Serang Km 14, Cikupa",
    city: "Tangerang",
    hours: "Senin–Sabtu 08.00–17.00 WIB",
    qrisOwner: "Setia Jaya Teknik",
    qrisNote: "Scan QRIS di bawah untuk pembayaran pesanan. Pastikan nominal pembayaran tepat.",
    theme: "slate-blue",
  };
  const s = readJSON(SETTINGS_FILE, def);
  return { ...def, ...s };
}
function saveSettings(s) {
  writeJSON(SETTINGS_FILE, s);
}

function getSubscription() {
  const now = new Date();
  const defEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const def = {
    status: 'active',
    planId: 'starter',
    planName: 'Starter SaaS TokoKit',
    price: 49000,
    billingCycle: 'Bulanan',
    startDate: now.toISOString(),
    endDate: defEnd,
    ownerName: 'FARID ADAM (Founder TokoKit)',
    ownerPhone: '6285810574163',
    qrisImage: '/toko-kit/img/qris.jpg',
    bankInfo: {
      bank: 'BCA',
      accountNumber: '8691882041',
      accountHolder: 'FARID ADAM'
    },
    plans: [
      {
        id: 'starter',
        name: 'Starter',
        price: 49000,
        badge: 'Aktif Saat Ini',
        isCurrent: true,
        features: [
          'Landing Page',
          'Katalog dan Etalase',
          'Panel Admin',
          'Vercel Deploy'
        ]
      },
      {
        id: 'pro',
        name: 'Pro Growth',
        price: 299000,
        badge: 'Segera Hadir',
        isCurrent: false,
        features: [
          'Semua fitur Starter',
          'VPS Shared Server',
          'Custom Domain Toko',
          'Fitur Articles / Content Engine & Blog SEO',
          'Multi-akun Staf Admin & CS'
        ]
      },
      {
        id: 'enterprise',
        name: 'Enterprise Scale',
        price: 999000,
        badge: 'Segera Hadir',
        isCurrent: false,
        features: [
          'Semua fitur Pro Growth',
          'Dedicated Cloud VPS Server',
          'Custom Domain Dedicated + Enterprise SSL',
          'Fitur Articles & Content Multi-Author',
          'AI Sales Assistant otomatis (Hermes Gateway)',
          'Integrasi API POS & Pergudangan Fisik'
        ]
      }
    ]
  };
  const sub = readJSON(SUBSCRIPTION_FILE, def);
  return { ...def, ...sub, plans: def.plans };
}

function saveSubscription(sub) {
  writeJSON(SUBSCRIPTION_FILE, sub);
}

function syncToTokoConfig(settings, products) {
  try {
    if (!fs.existsSync(TOKO_CONFIG_PATH)) return;
    const raw = fs.readFileSync(TOKO_CONFIG_PATH, 'utf-8');
    const conf = JSON.parse(raw);
    conf.store = conf.store || {};
    if (settings.storeName) conf.store.name = settings.storeName;
    if (settings.storeDesc) {
      conf.store.tagline = settings.storeDesc;
      conf.store.description = settings.storeDesc;
    }
    const phone = settings.waPublic || settings.adminPhone;
    if (phone) conf.store.whatsapp = normalizePhone(phone);
    if (settings.address) conf.store.address = settings.address;
    if (settings.city) conf.store.city = settings.city;
    if (settings.hours) conf.store.hours = settings.hours;
    if (settings.logo) conf.store.logo = settings.logo;

    conf.payment = conf.payment || {};
    if (settings.qrisOwner) conf.payment.qrisOwner = settings.qrisOwner;
    if (settings.qrisNote) conf.payment.note = settings.qrisNote;

    if (settings.theme) {
      conf.theme = typeof settings.theme === 'string'
        ? { preset: settings.theme, primary: '' }
        : settings.theme;
    }

    if (Array.isArray(products) && products.length) {
      conf.products = products.map(p => ({
        id: p.id,
        name: p.name,
        price: Number(p.price) || 0,
        stock: p.stock !== undefined ? Number(p.stock) : 10,
        weight: p.weight !== undefined ? Number(p.weight) : 500,
        category: p.category || 'Umum',
        rating: p.rating || 4.8,
        sold: p.sold || 0,
        description: p.description || '',
        image: p.image || '/toko-kit/img/tools/gerinda-potong.jpg',
        active: p.active !== false
      }));
      conf.catalog = conf.catalog || {};
      conf.catalog.categories = [...new Set(conf.products.map(p => p.category).filter(Boolean))];
    }

    fs.writeFileSync(TOKO_CONFIG_PATH, JSON.stringify(conf, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[syncToTokoConfig] Gagal menyelaraskan config.json:', err.message);
  }
}

// Hermes API (Mack) — persona "Payu" lives on the existing mack gateway.
// Env set via systemd unit (PAYU_HERMES_URL / PAYU_HERMES_KEY).
const HERMES_URL = process.env.PAYU_HERMES_URL || 'http://127.0.0.1:8642';
const HERMES_KEY = process.env.PAYU_HERMES_KEY || '';
const HERMES_MODEL = process.env.PAYU_HERMES_MODEL || 'mack';

// WhatsApp bridge — kirim notifikasi OTP ke admin (Adam) buat di-forward manual.
const WA_BRIDGE_URL = process.env.PAYU_WA_BRIDGE_URL || 'http://127.0.0.1:3001';
const WA_ADMIN_CHAT = process.env.PAYU_WA_ADMIN || '6285179656654@s.whatsapp.net';

// single admin token (mirror ngobrol pattern). Stored in .token (mode 600).
const TOKEN_FILE = path.join(__dirname, '.token');

// ---- QRIS statis kosong config (set nominal by user). Edit admin.
const QRIS_CONF = {
  owner: 'Setia Jaya Teknik',
  note: 'Scan QRIS di bawah untuk pembayaran pesanan. Pastikan nominal pembayaran tepat sesuai total pesanan. Setelah transfer, silakan unggah foto bukti pembayaran atau konfirmasi via WhatsApp.',
};

// ---- Order workflow (ala Shopee)
const ORDER_FLOW = ['PesananBaru', 'MenungguBayar', 'Dibayar', 'Diproses', 'Dikirim', 'Selesai'];
const ORDER_CANCEL = 'Batal';

const SHIPPING = {
  kurir:      { label: 'Kurir Toko',   perKm: 2500, flat: 15000 },
  instan:     { label: 'Instan (1 Jam)', perKm: 2500, flat: 15000 },
  ambil:      { label: 'Ambil di Toko', flat: 0 },
  sameday:    { label: 'SameDay',      perKm: 1200, flat: 15000 },
  regular:    { label: 'Regular',      flat: 15000 },
  free:       { label: 'Free (7 hari)', flat: 0 },
};

// ---- storage helpers
function ensureState() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (!fs.existsSync(PRODUCTS_FILE)) fs.writeFileSync(PRODUCTS_FILE, '[]');
  if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '[]');
  if (!fs.existsSync(CHATS_FILE)) fs.writeFileSync(CHATS_FILE, '{}');
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  if (!fs.existsSync(OTPS_FILE)) fs.writeFileSync(OTPS_FILE, '{}');
  if (!fs.existsSync(HASHES_FILE)) fs.writeFileSync(HASHES_FILE, '{}');
}
function getUsers() { ensureState(); return readJSON(USERS_FILE, []); }
function getOtps() { ensureState(); return readJSON(OTPS_FILE, {}); }
function getReceiptHashes() { ensureState(); return readJSON(HASHES_FILE, {}); }
function normalizePhone(p) {
  return String(p||'').replace(/[^0-9]/g,'').replace(/^0+/,'62') || String(p||'').trim();
}

// ---- Timing-Safe String Comparison (Immune to timing attacks & length leaks) ----
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// ---- HMAC Action Tokens for WhatsApp 1-Tap Links (24h TTL) ----
const ACTION_LINK_TTL_MS = 24 * 60 * 60 * 1000;
function signActionUrl(ref, status) {
  const exp = Date.now() + ACTION_LINK_TTL_MS;
  const data = `${ref}:${status}:${exp}`;
  const sig = crypto.createHmac('sha256', getAdminSecret()).update(data).digest('base64url');
  const baseUrl = 'https://faridadamn.my.id/payu';
  return `${baseUrl}/api/admin/action?ref=${encodeURIComponent(ref)}&s=${encodeURIComponent(status)}&exp=${exp}&sig=${sig}`;
}
function verifyActionSig(ref, status, expStr, sigStr) {
  if (!ref || !status || !expStr || !sigStr) return false;
  const exp = Number(expStr);
  if (!exp || Date.now() > exp) return false;
  const data = `${ref}:${status}:${exp}`;
  const expectSig = crypto.createHmac('sha256', getAdminSecret()).update(data).digest('base64url');
  return timingSafeEqualStr(sigStr, expectSig);
}

// ---- Client IP Extraction Helper ----
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const ips = xff.split(',');
    if (ips.length && ips[0].trim()) return ips[0].trim();
  }
  const xReal = req.headers['x-real-ip'];
  if (xReal) return xReal.trim();
  return req.socket.remoteAddress || '127.0.0.1';
}

// ---- In-Memory Sliding Window Rate Limiter ----
const RATE_LIMIT_STORE = new Map();

function checkRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  let timestamps = RATE_LIMIT_STORE.get(key) || [];
  timestamps = timestamps.filter(t => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    RATE_LIMIT_STORE.set(key, timestamps);
    const oldest = timestamps[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  timestamps.push(now);
  RATE_LIMIT_STORE.set(key, timestamps);
  return { allowed: true, remaining: maxRequests - timestamps.length };
}

// Periodic cleanup of rate limiter store every 5 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000;
  for (const [k, timestamps] of RATE_LIMIT_STORE.entries()) {
    const fresh = timestamps.filter(t => now - t < maxAge);
    if (!fresh.length) RATE_LIMIT_STORE.delete(k);
    else RATE_LIMIT_STORE.set(k, fresh);
  }
}, 5 * 60 * 1000).unref();

// ---- Magic Bytes Image Validation (Anti-Malware & File Masquerading) ----
function isValidImageBuffer(buffer) {
  if (!buffer || buffer.length < 12) return false;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  // GIF: GIF87a or GIF89a
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'gif';
  // WEBP: RIFF....WEBP
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'webp';
  return null;
}

// ---- OTP helpers ----
function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digit
}
// Kirim notif OTP ke WhatsApp admin (Adam) — manual forward ke customer.
async function notifyOtpToAdmin(phone, otp, isNewUser) {
  const msg = [
    '[PAYU] Permintaan OTP login',
    'No: ' + phone,
    'Kode: *' + otp + '* (expire 5 menit)',
    'Status: ' + (isNewUser ? 'USER BARU — belum punya akun' : 'User terdaftar — login'),
  ].join('\n');
  try {
    const resp = await fetch(`${WA_BRIDGE_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: WA_ADMIN_CHAT, message: msg }),
    });
    const d = await resp.json();
    return d.success === true;
  } catch (e) {
    console.error('[payu] notifyOtpToAdmin error:', e.message);
    return false;
  }
}

// Kirim notifikasi WhatsApp ke admin saat pesanan baru masuk
async function notifyOrderToAdmin(order) {
  const tok = getToken() || '';
  const itemsText = (order.items || []).map(i => `• ${i.qty}x ${i.name} (${rupiah(i.lineTotal)})`).join('\n');
  const kmText = order.km ? ` (${order.km} km)` : '';
  const customerInfo = order.customer ? [
    order.customer.name ? 'Nama: ' + order.customer.name : '',
    order.customer.phone ? 'No WA: ' + order.customer.phone : '',
    order.customer.address ? 'Alamat: ' + order.customer.address : '',
  ].filter(Boolean).join('\n') : '';

  let mapsUrl = '';
  if (order.customer && order.customer.lat != null && order.customer.lng != null) {
    mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${STORE_LOC.lat},${STORE_LOC.lng}&destination=${order.customer.lat},${order.customer.lng}&travelmode=two_wheeler`;
  } else if (order.customer && order.customer.address) {
    mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.customer.address)}`;
  }

  const actionPaid = signActionUrl(order.ref, 'Dibayar');
  const actionDiproses = signActionUrl(order.ref, 'Diproses');
  const actionDikirim = signActionUrl(order.ref, 'Dikirim');
  const actionSelesai = signActionUrl(order.ref, 'Selesai');

  const msg = [
    '🛍️ *[PAYU] PESANAN BARU MASUK!*',
    'Ref: *' + order.ref + '*',
    'Waktu: ' + new Date(order.createdAt).toLocaleString('id-ID'),
    '',
    '📦 *Item:*\n' + itemsText,
    '',
    '🚚 *Pengiriman:* ' + (order.shippingLabel || '-') + kmText + ' (' + rupiah(order.ongkir) + ')',
    '💰 *Total Tagihan:* *' + rupiah(order.total) + '*',
    '',
    '👤 *Info Customer:*\n' + (customerInfo || 'Customer Belum Isi Detail'),
    mapsUrl ? '\n📍 *Rute Kurir (Google Maps):*\n' + mapsUrl : '',
    '',
    '⚡ *1-Tap Action Status:*\n• Set Dibayar: ' + actionPaid + '\n• Set Diproses: ' + actionDiproses + '\n• Set Dikirim: ' + actionDikirim + '\n• Set Selesai: ' + actionSelesai,
  ].filter(Boolean).join('\n');

  try {
    const resp = await fetch(`${WA_BRIDGE_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: WA_ADMIN_CHAT, message: msg }),
    });
    const d = await resp.json();
    return d.success === true;
  } catch (e) {
    console.error('[payu] notifyOrderToAdmin error:', e.message);
    return false;
  }
}

// Kirim update status ke Chat Room Toko & WhatsApp Customer
async function notifyCustomerStatus(order, newStatus) {
  const statusChatMessages = {
    Dibayar: `🎉 Yeay, pembayaran terverifikasi! Pembayaran untuk pesanan *${order.ref}* sebesar *${rupiah(order.total)}* sudah sukses diverifikasi oleh Admin. Pesanan kamu sekarang langsung kami siapkan & proses! 👨‍🍳✨`,
    Diproses: `👨‍🍳 *Pesanan Sedang Disiapkan!* Hai Kak ${order.customer?.name || ""}, pesanan *${order.ref}* sedang diracik dan dikemas dengan teliti oleh tim toko.`,
    Dikirim: `🛵 *Pesanan Sedang Meluncur!* Pesanan *${order.ref}* sudah diserahkan ke kurir dan sedang dalam perjalanan ke alamat: ${order.customer?.address || "tujuan"}. Mohon pastikan nomor telepon aktif ya Kak!`,
    Selesai: `🎉 *Pesanan Selesai!* Pesanan *${order.ref}* telah sampai/selesai. Terima kasih banyak sudah berbelanja di Payu Toko Farid Adam. Selamat menikmati dan sampai jumpa di orderan berikutnya!`,
    Batal: `Pesanan *${order.ref}* telah dibatalkan. Hubungi admin jika ada pertanyaan.`,
  };

  const chatText = statusChatMessages[newStatus];
  if (chatText) {
    let targetChatId = order.chatId;
    if (!targetChatId) {
      const chats = getChats();
      for (const [cId, cData] of Object.entries(chats)) {
        if (cData.messages && cData.messages.some(m => m.content && m.content.includes(order.ref))) {
          targetChatId = cId;
          break;
        }
      }
    }
    if (targetChatId) {
      postChatMessage(targetChatId, chatText, "assistant");
    }
  }

  const phone = normalizePhone(order.customer?.phone);
  if (!/^62\d{8,15}$/.test(phone)) return false;
  const targetChat = phone + "@s.whatsapp.net";
  const text = statusChatMessages[newStatus] || `Status pesanan ${order.ref} berubah menjadi: ${newStatus}`;
  const msg = `🛒 *[Payu - Toko Farid Adam]*\n\n${text}\n\nLacak status pesanan kamu di: https://faridadamn.my.id/payu/`;

  try {
    const resp = await fetch(`${WA_BRIDGE_URL}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: targetChat, message: msg }),
    });
    const d = await resp.json();
    return d.success === true;
  } catch (e) {
    console.error("[payu] notifyCustomerStatus error:", e.message);
    return false;
  }
}

function postChatMessage(chatId, text, role = "assistant", attachment = null, invoice = null) {
  if (!chatId) return null;
  const chats = getChats();
  let chat = chats[chatId];
  if (!chat) {
    chat = { id: chatId, title: "Chat Toko", createdAt: new Date().toISOString(), messages: [] };
  }
  const msgObj = {
    id: id(),
    role,
    content: text,
    attachment: attachment || undefined,
    invoice: invoice || undefined,
    at: new Date().toISOString(),
  };
  chat.messages.push(msgObj);
  chats[chatId] = chat;
  writeJSON(CHATS_FILE, chats);
  return msgObj;
}

async function notifyPaymentConfirmToAdmin(order, note, attachment) {
  const verifyLink = signActionUrl(order.ref, 'Dibayar');
  const attachmentLine = attachment && attachment.url ? `\n📎 *Bukti Bayar:* https://faridadamn.my.id${attachment.url}` : "";
  const noteLine = note ? `\n💬 *Catatan:* ${note}` : "";

  const msg = `🔔 *[KONFIRMASI BAYAR - PAYU]*\n\n` +
    `Pembeli mengonfirmasi telah melakukan pembayaran via QRIS!\n\n` +
    `📌 *ID Pesanan:* ${order.ref}\n` +
    `👤 *Pembeli:* ${order.customer?.name || "Pelanggan"} (${order.customer?.phone || "-"})
` +
    `💰 *Total Tagihan:* *${rupiah(order.total)}*\n` +
    `📦 *Produk:* ${order.productName || "-"}${attachmentLine}${noteLine}\n\n` +
    `👉 *Klik untuk Verifikasi & Ubah ke Dibayar:*\n${verifyLink}`;

  try {
    const resp = await fetch(`${WA_BRIDGE_URL}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: WA_ADMIN_CHAT, message: msg }),
    });
    const d = await resp.json();
    return d.success === true;
  } catch (e) {
    console.error("[payu] notifyPaymentConfirmToAdmin error:", e.message);
    return false;
  }
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(file + '.tmp', file);   // atomic
}
function getProducts() { ensureState(); return readJSON(PRODUCTS_FILE, []); }
function getOrders() { ensureState(); return readJSON(ORDERS_FILE, []); }

function getToken() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { return null; }
}
function authorized(req) {
  return authAdmin(req) || authAdminToko(req);
}

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function rupiah(n) { return 'Rp' + Math.round(n).toLocaleString('id-ID'); }

// ---- lokasi toko (Adam) — dipakai hitung jarak antar real ----
const STORE_LOC = { lat: -6.13984, lng: 106.51912 };

// Haversine: jarak km antara dua koordinat.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// OSRM public (sama seperti di repo orderan Adam): jarak jalan real.
// Profile driving (public server tidak support exclude=toll). Fallback: haversine.
const OSRM_URL = process.env.PAYU_OSRM_URL || 'https://router.project-osrm.org';
async function osrmKm(lat1, lng1, lat2, lng2) {
  const coords = `${lng1},${lat1};${lng2},${lat2}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(`${OSRM_URL}/route/v1/driving/${coords}?overview=false`, { signal: controller.signal });
    if (!resp.ok) return null;
    const d = await resp.json();
    if (d.code !== 'Ok' || !d.routes?.[0]) return null;
    return Math.round((d.routes[0].distance / 1000) * 10) / 10;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function calcShipping(method, km) {
  const m = SHIPPING[method];
  if (!m) return 15000;
  const kmn = Number(km) || 0;
  if (m.perKm && kmn > 0) return Math.round(m.perKm * kmn);
  if (m.flat != null) return m.flat;
  return 15000;
}

// ---- route helpers
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// ---- CHAT: persona "Payu" + Hermes forwarding
function getChats() { ensureState(); return readJSON(CHATS_FILE, {}); }

// Product catalog summary injected into Payu's context so it can answer
// product/price/shipping questions accurately without tools.
function catalogPrompt() {
  const prods = getProducts().filter(p => p.active);
  if (!prods.length) return 'Katalog sedang kosong.';
  return prods.map(p => {
    const stock = p.stock === null ? 'digital (unlimited)' : `stok ${p.stock}`;
    return `- ${p.name} (${p.category}, ${stock}): Rp${p.price.toLocaleString('id-ID')}`;
  }).join('\n');
}

// Returns OpenAI-style messages: system persona + stored history (max 12).
function buildMessages(chat) {
  const system = [
    'Kamu adalah PAYU, toko online pribadi milik Farid Adam (kurir & content creator).',
    'Jawab singkat, ramah, santai, bahasa Indonesia kasual. Fokus membantu customer belanja.',
    'Kamu TAHU katalog ini (harga bisa berubah, cek selalu):',
    catalogPrompt(),
    '',
    'Ongkir: Instan Rp2.500/km, SameDay Rp1.200/km, Regular Rp15.000 (2-3 hari), Free (7 hari).',
    'Digital = instant delivery tanpa ongkir. Fisik = pilih metode kirim.',
    'Bayar pakai QRIS statis: customer ketik nominal sendiri = total pesanan.',
    '',
    'Kalau customer minta hal personal / negosiasi / komplain / butuh admin, jawab:',
    '"Bentar ya, aku cek admin dulu. Nanti dibalas ya." lalu JANGAN tebak-tebak.',
    'Jangan pernah klaim stok/ketersediaan selain dari yang tercantum.',
    'Kalau diminta sesuatu di luar katalog (pesan khusus, harga nego, info di luar toko),',
    'tetap sopan, arahkan ke admin, jangan mengarang.',
  ].join('\n');
  const msgs = [{ role: 'system', content: system }];
  const hist = (chat.messages || []).slice(-12);
  for (const m of hist) {
    msgs.push({ role: m.role, content: m.content });
  }
  return msgs;
}

async function callHermes(messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const resp = await fetch(`${HERMES_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HERMES_KEY}`,
      },
      body: JSON.stringify({
        model: HERMES_MODEL,
        messages,
        max_tokens: 300,
        temperature: 0.6,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`hermes ${resp.status}: ${body.slice(0, 200)}`);
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    return content || '';
  } finally {
    clearTimeout(timer);
  }
}

function publicChat(chat) {
  const orders = getOrders();
  const users = getUsers();
  const order = orders.slice().reverse().find(o => o.chatId === chat.id);
  const user = users.find(u => u.id === chat.userId || (order && order.customer && normalizePhone(order.customer.phone) === normalizePhone(u.phone)));

  const customerName = (user && user.name) || (order && order.customer && order.customer.name) || "";
  const customerPhone = (user && user.phone) || (order && order.customer && order.customer.phone) || "";
  const customerAddress = (user && user.address) || (order && order.customer && order.customer.address) || "";

  let displayName = customerName;
  if (!displayName && customerPhone) {
    const raw = normalizePhone(customerPhone);
    displayName = raw.startsWith("62") ? "+" + raw : raw;
  }
  if (!displayName) {
    if (chat.title && chat.title !== "Chat Toko" && !chat.title.startsWith("Chat ")) {
      displayName = chat.title;
    } else if (chat.title && chat.title.startsWith("Chat ")) {
      displayName = chat.title.replace(/^Chat\s+/, "Tanya: ");
    } else {
      displayName = "Pelanggan #" + chat.id.slice(-5).toUpperCase();
    }
  }

  return {
    id: chat.id,
    title: displayName,
    customerName,
    customerPhone: customerPhone ? normalizePhone(customerPhone) : "",
    customerAddress,
    lastOrderRef: order ? order.ref : null,
    lastOrderStatus: order ? order.status : null,
    lastOrderTotal: order ? order.total : null,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt || chat.createdAt,
    messages: (chat.messages || []).slice(-50),
  };
}

// ---- user auth (HMAC-signed token, expire 30 hari) ----
const USER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function userSecret() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(TOKEN_FILE, secret);
    return secret;
  }
}
function signUserToken(userId) {
  const payload = userId + '.' + Date.now();
  const sig = crypto.createHmac('sha256', userSecret()).update(payload).digest('base64url');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}
function verifyUserToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  let payload;
  try { payload = Buffer.from(parts[0], 'base64url').toString('utf8'); } catch { return null; }
  const expect = crypto.createHmac('sha256', userSecret()).update(payload).digest('base64url');
  if (!timingSafeEqualStr(parts[1], expect)) return null;
  const ts = Number(payload.split('.')[1]);
  if (!ts || Date.now() - ts > USER_TTL_MS) return null;
  return payload.split('.')[0];
}
function authUser(req) {
  const h = req.headers['authorization'] || '';
  const t = new URL(req.url, `http://${req.headers.host}`).searchParams.get('u');
  const raw = h.replace(/^Bearer\s+/i, '').replace(/[^\x20-\x7E]/g, '').trim() || t || '';
  if (!raw) return null;
  const uid = verifyUserToken(raw);
  if (!uid) return null;
  return getUsers().find(u => u.id === uid) || null;
}
function publicUser(u) {
  return { id: u.id, phone: u.phone, name: u.name || '', address: u.address || '', lat: u.lat ?? null, lng: u.lng ?? null, createdAt: u.createdAt };
}

// Admin auth: cek header X-Admin-Token, Authorization: Bearer, query ?admin_token= / ?t= dengan timing-safe equal
function authAdmin(req) {
  const hAdmin = req.headers['x-admin-token'] || '';
  const hAuth = req.headers['authorization'] || '';
  const u = new URL(req.url, `http://${req.headers.host}`);
  const qAdmin = u.searchParams.get('admin_token') || '';
  const qT = u.searchParams.get('t') || '';

  const bearer = hAuth.replace(/^Bearer\s+/i, '').replace(/[^\x20-\x7E]/g, '').trim();
  const raw = (hAdmin || bearer || qAdmin || qT).replace(/[^\x20-\x7E]/g, '').trim();
  if (!raw) return false;
  const secret = getAdminSecret();
  if (!secret) return false;
  return timingSafeEqualStr(raw, secret);
}

function getAdminSecret() {
  try {
    return fs.readFileSync(path.join(__dirname, '.token'), 'utf8').trim();
  } catch { return ''; }
}

// Ensure public/img directory exists
const PUBLIC_IMG_DIR = path.join(__dirname, 'public', 'img');
if (!fs.existsSync(PUBLIC_IMG_DIR)) fs.mkdirSync(PUBLIC_IMG_DIR, { recursive: true });
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---- server
const server = http.createServer(async (req, res) => {
  try {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') return sendJSON(res, 204, {});

  // ---------- STATIC ----------
  if (p === '/' || p === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'));
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    return res.end(html);
  }
  if (p === '/manifest.json') {
    const f = fs.readFileSync(path.join(__dirname, 'manifest.json'));
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.end(f);
  }
  if (p === '/sw.js') {
    const f = fs.readFileSync(path.join(__dirname, 'sw.js'));
    res.writeHead(200, {
      'Content-Type': 'application/javascript',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.end(f);
  }
  if (p.startsWith('/icons/')) {
    const fp = path.resolve(path.join(__dirname, p));
    const allowedDir = path.resolve(path.join(__dirname, 'icons'));
    if (!fp.startsWith(allowedDir)) return sendJSON(res, 403, { error: 'forbidden' });
    if (fs.existsSync(fp)) {
      const mime = fp.endsWith('.jpg') || fp.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
      res.writeHead(200, { 'Content-Type': mime }); return res.end(fs.readFileSync(fp));
    }
  }

  // ---------- PUBLIC API ----------
  if (p === '/api/health') return sendJSON(res, 200, { ok: true, service: 'payu', port: PORT });

  if (method === 'GET' && (p === '/api/products' || p === '/api/catalog')) {
    const products = getProducts().map(({ archive, ...rest }) => rest);
    return sendJSON(res, 200, { products, shipping: SHIPPING, storeLocation: STORE_LOC });
  }

  if (method === 'GET' && p === '/api/orders') {
    // admin list
    if (!authorized(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    return sendJSON(res, 200, { orders: getOrders() });
  }

  // ---------- AUTH & ORDER HISTORY ----------
  // Customer: list orders by phone (get first matching user by phone, then orders).
  if (method === 'GET' && p === '/api/orders/me') {
    const u = authUser(req);
    if (!u) return sendJSON(res, 401, { error: 'unauthorized' });
    const uPhone = normalizePhone(u.phone);
    const orders = getOrders()
      .filter(o => o.customer?.phone && normalizePhone(o.customer.phone) === uPhone)
      .slice(0, 50);
    return sendJSON(res, 200, { orders: orders.map(publicOrder) });
  }

  // Confirm Payment Endpoint (Placed before generic order regex)
  if (method === "POST" && p === "/api/orders/confirm-pay") {
    const body = await readBody(req);
    const orderId = body.orderId;
    const chatId = body.chatId;
    const attachment = body.attachment;
    const note = String(body.note || "").trim().slice(0, 500);

    const orders = getOrders();
    const order = orders.find(o => o.id === orderId || o.ref === orderId);
    if (!order) return sendJSON(res, 404, { error: "order not found" });

    // Deduplikasi Hash Bukti Transfer (Anti-Fake Receipt & Anti-Reuse)
    let receiptHash = attachment && attachment.hash ? String(attachment.hash).trim() : null;
    if (!receiptHash && attachment && attachment.url) {
      const fname = path.basename(attachment.url);
      const fp = path.join(UPLOADS_DIR, fname);
      if (fs.existsSync(fp)) {
        try {
          receiptHash = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
        } catch {}
      }
    }

    if (receiptHash) {
      const hashes = getReceiptHashes();
      const existing = hashes[receiptHash];
      if (existing && existing.orderRef !== order.ref) {
        return sendJSON(res, 400, {
          error: `Bukti transfer ini sudah pernah digunakan pada pesanan lain (#${existing.orderRef}). Mohon unggah bukti transfer yang asli dan baru.`,
          duplicateReceipt: true
        });
      }
      hashes[receiptHash] = {
        orderRef: order.ref,
        orderId: order.id,
        phone: order.customer?.phone || '',
        usedAt: new Date().toISOString()
      };
      writeJSON(HASHES_FILE, hashes);
      order.receiptHash = receiptHash;
    }

    if (chatId) order.chatId = chatId;
    order.status = "MenungguBayar";
    order.updatedAt = new Date().toISOString();
    order.history = order.history || [];
    order.history.push({ status: "MenungguVerifikasi", at: new Date().toISOString() });
    writeJSON(ORDERS_FILE, orders);

    if (chatId) {
      postChatMessage(chatId, `Saya sudah melakukan pembayaran untuk pesanan *${order.ref}* via QRIS.`, "user", attachment);
      postChatMessage(chatId, `Baik Kak ${order.customer?.name || ""}! Pembayaran untuk pesanan *${order.ref}* (${rupiah(order.total)}) sudah kami catat dan sedang diverifikasi oleh admin. Mohon tunggu sebentar ya, kami akan segera infokan begitu verifikasi selesai!`, "assistant");
    }

    notifyPaymentConfirmToAdmin(order, note, attachment).catch(e => console.error(e));
    return sendJSON(res, 200, { ok: true, order: publicOrder(order) });
  }

  // Upload Chat Image Attachment
  if (method === "POST" && p === "/api/chat/upload") {
    const ip = getClientIp(req);
    const rlUp = checkRateLimit('upload_10m:' + ip, 5, 10 * 60 * 1000);
    if (!rlUp.allowed) {
      return sendJSON(res, 429, {
        error: `Batas unggah gambar tercapai (maksimal 5 gambar per 10 menit). Mohon tunggu ${rlUp.retryAfterSec} detik lagi.`,
        retryAfter: rlUp.retryAfterSec
      });
    }

    const body = await readBody(req);
    if (body.data && body.data.startsWith("data:image/")) {
      const parts = body.data.split(";base64,");
      const buffer = Buffer.from(parts[1], "base64");
      if (!buffer.length || buffer.length > 2 * 1024 * 1024) return sendJSON(res, 400, { error: "Ukuran gambar maksimal 2MB" });

      const detectedExt = isValidImageBuffer(buffer);
      if (!detectedExt) {
        return sendJSON(res, 400, { error: "File bukan format gambar yang valid (hanya JPG, PNG, WEBP, GIF didukung)." });
      }

      const imgHash = crypto.createHash('sha256').update(buffer).digest('hex');
      const safeFilename = "img_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + "." + detectedExt;
      const dest = path.join(UPLOADS_DIR, safeFilename);
      fs.writeFileSync(dest, buffer);
      return sendJSON(res, 200, { ok: true, url: "/payu/uploads/" + safeFilename, filename: safeFilename, hash: imgHash });
    }
    return sendJSON(res, 400, { error: "invalid image payload" });
  }

  const orderMatch = p.match(/^\/api\/orders\/([^/]+)(\/status)?$/);
  if (orderMatch) {
    const oid = orderMatch[1];
    const isStatus = !!orderMatch[2];
    const orders = getOrders();
    const order = orders.find(o => o.id === oid || o.ref === oid);
    if (!order) return sendJSON(res, 404, { error: 'order not found' });

    if (isStatus && method === 'PUT') {
      if (!authorized(req)) return sendJSON(res, 401, { error: 'unauthorized' });
      const body = await readBody(req);
      let next = body.status;
      if (next === 'Dibatalkan') next = 'Batal';
      if (!ORDER_FLOW.includes(next) && next !== ORDER_CANCEL) {
        return sendJSON(res, 400, { error: 'status invalid', valid: [...ORDER_FLOW, ORDER_CANCEL] });
      }
      order.status = next;
      order.updatedAt = new Date().toISOString();
      order.history = order.history || [];
      order.history.push({ status: next, at: new Date().toISOString() });
      writeJSON(ORDERS_FILE, orders);
      notifyCustomerStatus(order, next).catch(e => console.error('[payu] notify cust error:', e.message));
      return sendJSON(res, 200, { ok: true, order: publicOrder(order) });
    }
    // GET detail via route ini sudah ditangani blok orderDetailMatch di atas (dengan auth).
  }

  if (method === 'POST' && p === '/api/orders') {
    const body = await readBody(req);
    // Normalize cart: prefer items[] (multi-item), fallback to legacy productId+qty.
    let items;
    if (Array.isArray(body.items) && body.items.length) {
      items = body.items;
    } else if (body.productId) {
      items = [{ productId: body.productId, qty: Math.max(1, Math.floor(Number(body.qty) || 1)) }];
    } else {
      return sendJSON(res, 400, { error: 'items (cart) required' });
    }
    // Resolve products + validate stock
    const products = getProducts();
    const orderItems = [];
    let subtotal = 0;
    for (const it of items) {
      const prod = products.find(x => x.id === it.productId);
      if (!prod) return sendJSON(res, 400, { error: 'product not found', productId: it.productId });
      const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
      if (prod.stock !== null && qty > prod.stock) {
        return sendJSON(res, 400, { error: 'stok kurang', productId: prod.id, name: prod.name, stock: prod.stock });
      }
      orderItems.push({
        productId: prod.id,
        name: prod.name,
        qty,
        unitPrice: prod.price,
        lineTotal: prod.price * qty,
        digital: prod.stock === null,
      });
      subtotal += prod.price * qty;
    }
// Ekstraksi data customer (dukung format root maupun nested customer)
    const cust = body.customer || {};
    const name = String(body.name || cust.name || '').trim();
    const phone = String(body.phone || cust.phone || '').trim();
    const address = String(body.address || cust.address || '').trim();
    const note = String(body.note || cust.note || '').trim();

    // Validasi identitas penerima
    if (!name) {
      return sendJSON(res, 400, { error: 'Nama penerima wajib diisi.', needContact: true });
    }
    if (!phone) {
      return sendJSON(res, 400, { error: 'Nomor WhatsApp wajib diisi.', needContact: true });
    }

    // Resolusi metode pengiriman Toko-Kit
    let method_ = 'kurir';
    let clientCost = null;
    if (typeof body.shipping === 'string') {
      method_ = body.shipping;
    } else if (body.shipping && typeof body.shipping === 'object') {
      method_ = body.shipping.optionId || body.shipping.id || 'kurir';
      if (body.shipping.cost != null) clientCost = Number(body.shipping.cost);
    }
    if (body.shippingMethod) method_ = body.shippingMethod;
    if (!SHIPPING[method_]) method_ = 'kurir';

    if (method_ !== 'ambil' && (!address || address.length < 5)) {
      return sendJSON(res, 400, { error: 'Alamat lengkap wajib diisi untuk pengiriman.', needContact: true });
    }

    let km = Number(body.km) || 0;
    let distFrom = 'manual';

    let ongkir = 0;
    if (method_ === 'ambil') {
      ongkir = 0;
    } else if (subtotal >= 500000 && method_ !== 'instan') {
      ongkir = 0; // Gratis ongkir untuk pembelian >= 500rb
    } else {
      ongkir = calcShipping(method_, km);
      if (ongkir < 0 || isNaN(ongkir)) ongkir = 0;
    }

    // Re-validasi stok di data TERBARU
    const fresh = getProducts();
    for (const li of orderItems) {
      const g = fresh.find(x => x.id === li.productId);
      if (!g) return sendJSON(res, 400, { error: 'product not found', productId: li.productId });
      if (g.stock !== null && g.stock < li.qty) {
        return sendJSON(res, 400, { error: 'Stok barang tidak mencukupi', productId: g.id, name: g.name, stock: g.stock });
      }
    }
    const updatedProducts = fresh.map(g => {
      const li = orderItems.find(i => i.productId === g.id);
      if (li && g.stock !== null) g.stock -= li.qty;
      return g;
    });
    writeJSON(PRODUCTS_FILE, updatedProducts);

    const total = subtotal + ongkir;
    const orderChatId = body.chatId || "";
    const orderNo = "SJT-" + Math.random().toString(36).slice(2, 7).toUpperCase();
    const order = {
      id: id(),
      ref: orderNo,
      orderNo: orderNo,
      chatId: orderChatId,
      items: orderItems,
      productName: orderItems.map(i => i.name).join(", "),
      qty: orderItems.reduce((s, i) => s + i.qty, 0),
      subtotal,
      shippingMethod: method_,
      shippingLabel: SHIPPING[method_]?.label || method_,
      km,
      distFrom,
      ongkir,
      total,
      status: "PesananBaru",
      statusLabel: "Pesanan Baru",
      stage: "baru",
      customer: {
        name: name.slice(0, 100),
        phone: normalizePhone(phone).slice(0, 20),
        address: address.slice(0, 500),
      },
      note: note.slice(0, 500),
      qris: QRIS_CONF,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{ status: "PesananBaru", stage: "baru", at: new Date().toISOString() }],
    };
    const orders = getOrders();
    orders.unshift(order);
    writeJSON(ORDERS_FILE, orders);
    if (orderChatId) {
      postChatMessage(orderChatId, `Rincian Pesanan #${order.ref}`, "assistant", null, publicOrder(order));
    }
    notifyOrderToAdmin(order).catch(e => console.error("[payu] notify order error:", e.message));
    return sendJSON(res, 201, { order: publicOrder(order) });
  }

  // ---------- CHAT ----------
  // GET single chat history by chatId (supports /api/chat/:id or /api/chat?chatId=...)
  const chatMatch = p.match(/^\/api\/chat\/([^/]+)$/);
  if ((chatMatch || p === '/api/chat') && method === 'GET') {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const chatId = chatMatch ? chatMatch[1] : (u.searchParams.get('chatId') || '');
    if (!chatId) return sendJSON(res, 400, { error: 'chatId required' });
    const chats = getChats();
    const chat = chats[chatId];
    if (!chat) return sendJSON(res, 200, { chat: { id: chatId, messages: [] } });
    return sendJSON(res, 200, { chat: publicChat(chat) });
  }

  // Detail order untuk CUSTOMER: butuh token user; nomor HP selalu disembunyikan;
  // alamat hanya keluar jika pemilik order (HP user == HP di order).
  // Minimal public payload untuk modal pembayaran (tanpa data customer sama sekali).
const payMatch = p.match(/^\/api\/orders\/([^/]+)\/pay$/);
if (payMatch && method === 'GET') {
  const oid = payMatch[1];
  const order = getOrders().find(o => o.id === oid || o.ref === oid);
  if (!order) return sendJSON(res, 404, { error: 'order not found' });
  return sendJSON(res, 200, { order: { id: order.id, ref: order.ref, total: order.total, status: order.status } });
}

// Endpoint Upload Bukti Pembayaran Pesanan (Customer Proof Upload)
  const proofMatch = p.match(/^\/api\/orders\/([^/]+)\/proof$/);
  if (proofMatch && method === 'POST') {
    const oid = proofMatch[1];
    const orders = getOrders();
    const order = orders.find(o => o.id === oid || o.ref === oid || o.orderNo === oid);
    if (!order) return sendJSON(res, 404, { error: 'Pesanan tidak ditemukan' });

    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) return sendJSON(res, 400, { error: 'multipart required' });
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) return sendJSON(res, 400, { error: 'boundary required' });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = Buffer.concat(chunks);
    const parts = data.toString('binary').split('--' + boundary);
    let filename = '', fileBuffer = null;
    for (const part of parts) {
      if (part.includes('filename=')) {
        const m = part.match(/filename="([^"]+)"/);
        if (m) filename = m[1];
        const bodyStart = part.indexOf('\r\n\r\n');
        if (bodyStart >= 0) {
          const bodyEnd = part.lastIndexOf('\r\n');
          fileBuffer = Buffer.from(part.slice(bodyStart + 4, bodyEnd), 'binary');
        }
      }
    }
    if (!fileBuffer || !fileBuffer.length) return sendJSON(res, 400, { error: 'File bukti transfer tidak terbaca' });
    if (fileBuffer.length > 5 * 1024 * 1024) return sendJSON(res, 400, { error: 'Ukuran file maksimal 5MB' });
    const validExt = isValidImageBuffer(fileBuffer);
    if (!validExt) return sendJSON(res, 400, { error: 'Format file tidak valid' });
    const ext = '.' + validExt;
    const safeFilename = 'proof_' + (order.ref || order.id) + '_' + Date.now() + ext;
    const dest = path.join(UPLOADS_DIR, safeFilename);
    fs.writeFileSync(dest, fileBuffer);

    order.proofImage = '/toko-kit/uploads/' + safeFilename;
    order.status = 'MenungguVerifikasi';
    order.statusLabel = 'Menunggu Verifikasi';
    order.stage = 'bayar';
    order.updatedAt = new Date().toISOString();
    order.history = order.history || [];
    order.history.push({ status: 'MenungguVerifikasi', stage: 'bayar', at: new Date().toISOString() });
    writeJSON(ORDERS_FILE, orders);

    return sendJSON(res, 200, { ok: true, proofUrl: order.proofImage, order: publicOrder(order) });
  }

  // Public Order Tracking by ID or Ref (No Login Required)
  const orderDetailMatch = p.match(/^\/api\/orders\/([^/]+)$/);
  if (orderDetailMatch && method === 'GET' && !p.endsWith('/status')) {
    if (!authorized(req) && !authAdminToko(req) && !authUser(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const oid = orderDetailMatch[1];
    const orders = getOrders();
    const order = orders.find(o => o.id === oid || o.ref === oid || o.orderNo === oid);
    if (!order) return sendJSON(res, 404, { error: 'Pesanan tidak ditemukan' });
    const pub = publicOrder(order);
    pub.orderNo = order.ref || order.orderNo || order.id;
    pub.statusLabel = order.statusLabel || (order.status === 'PesananBaru' ? 'Pesanan Diterima' : order.status);
    pub.stage = order.stage || 'baru';
    pub.customer = { name: order.customer?.name || '', address: order.customer?.address || '' };
    return sendJSON(res, 200, { order: pub, ...pub });
  }

  // Customer sends a message; gets Payu (AI) reply. Payu replies are stored.
  if (method === 'POST' && p === '/api/chat') {
    const ip = getClientIp(req);
    const rlMin = checkRateLimit('chat_min:' + ip, 10, 60 * 1000);
    if (!rlMin.allowed) {
      return sendJSON(res, 429, {
        error: `Terlalu banyak pesan. Mohon tunggu ${rlMin.retryAfterSec} detik sebelum mengirim lagi ya.`,
        retryAfter: rlMin.retryAfterSec
      });
    }
    const rlHour = checkRateLimit('chat_hr:' + ip, 60, 60 * 60 * 1000);
    if (!rlHour.allowed) {
      return sendJSON(res, 429, {
        error: `Batas pesan per jam tercapai. Mohon coba lagi nanti atau hubungi WhatsApp admin.`,
        retryAfter: rlHour.retryAfterSec
      });
    }

    const body = await readBody(req);
    const text = String(body.message || '').trim().slice(0, 1000);
    if (!text) return sendJSON(res, 400, { error: 'message required' });
    const chatId = String(body.chatId || '').trim();
    const chats = getChats();
    let chat = chatId && chats[chatId] ? chats[chatId] : null;
    if (!chat) {
      chat = { id: chatId || id(), title: 'Chat ' + text.slice(0, 24), createdAt: new Date().toISOString(), messages: [] };
    }
    if (body.customer && typeof body.customer === 'object') {
      chat.customer = {
        name: String(body.customer.name || '').trim().slice(0, 100),
        phone: normalizePhone(body.customer.phone || '').slice(0, 20),
      };
    }
    if (body.userToken) {
      const u = verifyUserToken(body.userToken);
      if (u) chat.userId = u;
    }
    const userMsg = { id: id(), role: 'user', content: text, at: new Date().toISOString() };
    if (body.replyTo && body.replyTo.content) {
      userMsg.replyTo = {
        id: body.replyTo.id || '',
        content: String(body.replyTo.content).slice(0, 200),
        role: body.replyTo.role || 'assistant',
      };
    }
    chat.messages.push(userMsg);
    chat.updatedAt = new Date().toISOString();
    chats[chat.id] = chat;
    writeJSON(CHATS_FILE, chats);
    return sendJSON(res, 200, { ok: true, chat: publicChat(chat) });
  }

  // 1-Tap Admin Action Endpoint for WhatsApp deep links
  if (method === 'GET' && p === '/api/admin/action') {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const ref = u.searchParams.get('ref');
    let newStatus = u.searchParams.get('s');
    if (newStatus === 'Dibatalkan') newStatus = 'Batal';
    const exp = u.searchParams.get('exp');
    const sig = u.searchParams.get('sig');

    const isSignedAction = verifyActionSig(ref, newStatus, exp, sig);
    const isAdminAuth = authAdmin(req);

    if (!isSignedAction && !isAdminAuth) {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h3>401 Unauthorized</h3><p>Tautan aksi tidak valid atau sudah kedaluwarsa.</p>');
    }
    if (!ref || !newStatus) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h3>400 Bad Request</h3><p>Parameter ref dan s (status) diperlukan.</p>');
    }
    const orders = getOrders();
    const order = orders.find(o => o.ref === ref || o.id === ref);
    if (!order) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<h3>404 Not Found</h3><p>Pesanan ${ref} tidak ditemukan.</p>`);
    }
    if (!ORDER_FLOW.includes(newStatus) && newStatus !== ORDER_CANCEL) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<h3>400 Invalid Status</h3><p>Status ${newStatus} tidak valid.</p>`);
    }

    order.status = newStatus;
    order.updatedAt = new Date().toISOString();
    order.history = order.history || [];
    order.history.push({ status: newStatus, at: new Date().toISOString() });
    writeJSON(ORDERS_FILE, orders);

    notifyCustomerStatus(order, newStatus).catch(e => console.error(e));

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payu Admin Action</title><style>body{font-family:sans-serif;background:#0c1317;color:#e9edef;padding:30px;text-align:center}.card{background:#111b21;border:1px solid #222d34;border-radius:12px;padding:24px;max-width:400px;margin:40px auto;box-shadow:0 8px 30px rgba(0,0,0,0.5)}.badge{background:#005c4b;color:#25d366;padding:4px 10px;border-radius:6px;font-weight:bold;font-size:14px}a{color:#00a884;text-decoration:none;display:inline-block;margin-top:20px;font-weight:bold}</style></head><body><div class="card"><div style="font-size:40px;margin-bottom:12px">✅</div><h2>Status Berhasil Diubah</h2><p style="margin:12px 0 16px">Pesanan <b>${order.ref}</b> (${order.productName})</p><p>Status Baru: <span class="badge">${newStatus}</span></p><a href="/payu/">← Buka Toko Payu</a></div></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  // Admin: list all chats (for override / dashboard).
  if (method === 'GET' && p === '/api/chats') {
    if (!authorized(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const chats = getChats();
    const arr = Object.values(chats).map(publicChat);
    arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendJSON(res, 200, { chats: arr });
  }

  // Admin: override — Adam replies as "Payu" to a specific chat.
  if (method === 'POST' && p === '/api/chat/reply') {
    if (!authorized(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const body = await readBody(req);
    const chatId = String(body.chatId || '').trim();
    const text = String(body.message || '').trim();
    if (!chatId || !text) return sendJSON(res, 400, { error: 'chatId & message required' });
    const chats = getChats();
    const chat = chats[chatId];
    if (!chat) return sendJSON(res, 404, { error: 'chat not found' });
    chat.messages.push({ role: 'assistant', content: text, at: new Date().toISOString(), byAdmin: true });
    chats[chatId] = chat;
    writeJSON(CHATS_FILE, chats);
    return sendJSON(res, 200, { ok: true, chat: publicChat(chat) });
  }

  // ---------- AUTH (OTP manual via WA admin) ----------
  // 1) Minta OTP: {phone} -> generate 6 digit, simpan 5 menit, notif ke WA Adam.
  if (method === 'POST' && (p === '/api/auth/otp' || p === '/api/otp/request')) {
    const body = await readBody(req);
    const phone = normalizePhone(body.phone);
    if (!/^62\d{8,15}$/.test(phone)) return sendJSON(res, 400, { error: 'nomor tidak valid. Pakai format 08xx atau +62xx' });
    // rate limit: max 3 request per 10 menit per nomor
    const otps = getOtps();
    const now = Date.now();
    const recent = (otps[phone]||[]).filter(o => now - o.at < 10*60*1000);
    if (recent.length >= 3) return sendJSON(res, 429, { error: 'Terlalu sering minta OTP. Coba lagi 10 menit lagi.' });
    const otp = genOtp();
    recent.push({ code: otp, at: now, exp: now + 5*60*1000, used: false });
    otps[phone] = recent;
    writeJSON(OTPS_FILE, otps);
    const users = getUsers();
    const isNew = !users.some(u => u.phone === phone);
    const sent = await notifyOtpToAdmin(phone, otp, isNew);
    return sendJSON(res, 200, { ok: true, sent, isNew, phone, hint: sent ? 'OTP dikirim ke admin, tunggu kode dari WhatsApp.' : 'Gagal kirim notif ke admin. Coba lagi.' });
  }

  // 2) Verifikasi OTP: {phone, code} -> user (baru/lama) + token user.
  //    Rate limit: max 5 percobaan gagal per nomor per 10 menit (anti brute-force 6 digit).
  if (method === 'POST' && (p === '/api/auth/verify' || p === '/api/otp/verify')) {
    const body = await readBody(req);
    const phone = normalizePhone(body.phone);
    const code = String(body.code||'').trim();
    if (!/^62\d{8,15}$/.test(phone) || !/^\d{6}$/.test(code)) return sendJSON(res, 400, { error: 'nomor / kode tidak valid' });
    const otps = getOtps();
    const now = Date.now();
    const list = (otps[phone]||[]).filter(o => now - o.at < 10*60*1000); // buang entri > 10 menit
    otps[phone] = list;
    const fails = list.filter(o => o.fail).length;
    if (fails >= 5) {
      writeJSON(OTPS_FILE, otps);
      return sendJSON(res, 429, { error: 'Terlalu banyak percobaan salah. Coba lagi dalam beberapa menit.' });
    }
    const entry = list.find(o => !o.used && !o.fail && o.code === code && now < o.exp);
    if (!entry) {
      // catat percobaan gagal agar brute-force terhitung
      list.push({ fail: true, at: now, exp: now });
      writeJSON(OTPS_FILE, otps);
      return sendJSON(res, 401, { error: 'Kode salah atau sudah kedaluwarsa.' });
    }
    entry.used = true;
    writeJSON(OTPS_FILE, otps);
    let users = getUsers();
    let user = users.find(u => u.phone === phone);
    if (!user) {
      user = { id: id(), phone, name: '', address: '', lat: null, lng: null, createdAt: new Date().toISOString() };
      users.push(user);
      writeJSON(USERS_FILE, users);
    }
    const token = signUserToken(user.id);
    return sendJSON(res, 200, { ok: true, user: publicUser(user), token });
  }

  // 3) Ambil profil user (butuh user token).
  if (method === 'GET' && p === '/api/users/me') {
    const u = authUser(req);
    if (!u) return sendJSON(res, 401, { error: 'unauthorized' });
    return sendJSON(res, 200, { user: publicUser(u) });
  }

  // 4) Update profil user: nama, alamat, lat/lng.
  if (method === 'PUT' && p === '/api/users/me') {
    const u = authUser(req);
    if (!u) return sendJSON(res, 401, { error: 'unauthorized' });
    const body = await readBody(req);
    if (body.name !== undefined) u.name = String(body.name).slice(0, 100);
    if (body.address !== undefined) u.address = String(body.address).slice(0, 300);
    if (body.lat !== undefined && body.lng !== undefined) {
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        u.lat = lat; u.lng = lng;
      }
    }
    u.updatedAt = new Date().toISOString();
    const users = getUsers();
    const idx = users.findIndex(x => x.id === u.id);
    if (idx >= 0) { users[idx] = u; writeJSON(USERS_FILE, users); }
    return sendJSON(res, 200, { user: publicUser(u) });
  }

  // ---------- ADMIN API ----------
  if (method === 'POST' && p === '/api/products') {
    if (!authorized(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const body = await readBody(req);
    if (!body.name || body.price === undefined) return sendJSON(res, 400, { error: 'name & price required' });
    const products = getProducts();
    products.push({
      id: id(),
      name: body.name,
      category: body.category || 'Lainnya',
      desc: body.desc || '',
      price: Number(body.price),
      stock: body.stock === undefined || body.stock === null ? null : Number(body.stock),
      image: body.image || '',
      active: true,
      createdAt: new Date().toISOString(),
    });
    writeJSON(PRODUCTS_FILE, products);
    return sendJSON(res, 201, { ok: true, product: products[products.length - 1] });
  }

  const prodMatch = p.match(/^\/api\/products\/([^/]+)$/);
  if (prodMatch && method === 'PUT') {
    if (!authorized(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const pid = prodMatch[1];
    const body = await readBody(req);
    const products = getProducts();
    const idx = products.findIndex(x => x.id === pid);
    if (idx < 0) return sendJSON(res, 404, { error: 'not found' });
    products[idx] = { ...products[idx], ...body, id: pid, updatedAt: new Date().toISOString() };
    writeJSON(PRODUCTS_FILE, products);
    return sendJSON(res, 200, { ok: true, product: products[idx] });
  }
  if (prodMatch && method === 'DELETE') {
    if (!authorized(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const pid = prodMatch[1];
    const products = getProducts();
    const next = products.filter(x => x.id !== pid);
    if (next.length === products.length) return sendJSON(res, 404, { error: 'not found' });
    writeJSON(PRODUCTS_FILE, next);
    return sendJSON(res, 200, { ok: true });
  }

  // ========== ADMIN ROUTES (authAdmin) ==========

  // Admin: list users (untuk pilih target chat)
  if (method === 'GET' && p === '/api/admin/users') {
    if (!authAdmin(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const users = getUsers().map(publicUser);
    return sendJSON(res, 200, { users });
  }

  // Admin: list all chats (multi-conversation seperti WhatsApp Web)
  if (method === 'GET' && p === '/api/admin/chats') {
    if (!authAdmin(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const chats = getChats();
    const arr = Object.values(chats).map(c => publicChat(c));
    arr.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    return sendJSON(res, 200, { chats: arr });
  }

  // Admin: get single chat (full messages)
  if (method === 'GET' && p.match(/^\/api\/admin\/chats\/[^/]+$/)) {
    if (!authAdmin(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const chatId = p.split('/').pop();
    const chat = getChats()[chatId];
    if (!chat) return sendJSON(res, 404, { error: 'chat not found' });
    return sendJSON(res, 200, { chat: publicChat(chat) });
  }

  // Admin: reply to a specific chat (sebagai "Payu")
  if (method === 'POST' && p === '/api/admin/chats/reply') {
    if (!authAdmin(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const body = await readBody(req);
    const chatId = String(body.chatId || '').trim();
    const text = String(body.message || '').trim();
    if (!chatId || !text) return sendJSON(res, 400, { error: 'chatId & message required' });
    const chats = getChats();
    const chat = chats[chatId];
    if (!chat) return sendJSON(res, 404, { error: 'chat not found' });
    chat.messages.push({ role: 'assistant', content: text, at: new Date().toISOString(), byAdmin: true });
    chat.updatedAt = new Date().toISOString();
    chats[chatId] = chat;
    writeJSON(CHATS_FILE, chats);
    return sendJSON(res, 200, { ok: true, chat: publicChat(chat) });
  }

  // Admin: BROADCAST ke SEMUA user (termasuk anon yang punya chatId)
  if (method === 'POST' && p === '/api/admin/broadcast') {
    if (!authAdmin(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const body = await readBody(req);
    const text = String(body.message || '').trim();
    if (!text) return sendJSON(res, 400, { error: 'message required' });
    const chats = getChats();
    let count = 0;
    for (const [cid, chat] of Object.entries(chats)) {
      chat.messages.push({ role: 'assistant', content: text, at: new Date().toISOString(), byAdmin: true, broadcast: true });
      chat.updatedAt = new Date().toISOString();
      chats[cid] = chat;
      count++;
    }
    writeJSON(CHATS_FILE, chats);
    return sendJSON(res, 200, { ok: true, sent: count });
  }

  // Admin: list all orders (pakai authAdmin, bukan authorized)
  if (method === 'GET' && p === '/api/admin/orders') {
    if (!authAdmin(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    return sendJSON(res, 200, { orders: getOrders() });
  }

  // Admin: list all products (termasuk archived)
  if (method === 'GET' && p === '/api/admin/products') {
    if (!authAdminToko(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const products = getProducts(); // include archived
    return sendJSON(res, 200, { products });
  }

  // Admin: product CRUD (pakai authAdmin, bukan authorized)
  if (method === 'POST' && p === '/api/admin/products') {
    if (!authAdminToko(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const body = await readBody(req);
    const products = getProducts();
    const prod = {
      id: id(),
      name: String(body.name || '').trim(),
      price: Number(body.price),
      stock: body.stock === undefined || body.stock === null ? null : Number(body.stock),
      image: String(body.image || '').trim(),
      digital: !!body.digital,
      active: true,
      createdAt: new Date().toISOString(),
    };
    if (!prod.name || isNaN(prod.price)) return sendJSON(res, 400, { error: 'name & price required' });
    products.push(prod);
    writeJSON(PRODUCTS_FILE, products);
    return sendJSON(res, 201, { ok: true, product: prod });
  }

  if ((method === 'PUT' || method === 'PATCH') && p.match(/^\/api\/admin\/products\/[^/]+$/)) {
    if (!authAdminToko(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const pid = p.split('/').pop();
    const body = await readBody(req);
    const products = getProducts();
    const idx = products.findIndex(x => x.id === pid);
    if (idx < 0) return sendJSON(res, 404, { error: 'not found' });
    products[idx] = { ...products[idx], ...body, id: pid, updatedAt: new Date().toISOString() };
    writeJSON(PRODUCTS_FILE, products);
    return sendJSON(res, 200, { ok: true, product: products[idx] });
  }

  if (method === 'DELETE' && p.match(/^\/api\/admin\/products\/[^/]+$/)) {
    if (!authAdminToko(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const pid = p.split('/').pop();
    const products = getProducts();
    const next = products.filter(x => x.id !== pid);
    if (next.length === products.length) return sendJSON(res, 404, { error: 'not found' });
    writeJSON(PRODUCTS_FILE, next);
    return sendJSON(res, 200, { ok: true });
  }

  // Admin: upload gambar produk (multipart/form-data sederhana)
  if (method === 'POST' && p === '/api/admin/upload') {
    if (!authAdmin(req)) return sendJSON(res, 401, { error: 'unauthorized' });
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) return sendJSON(res, 400, { error: 'multipart required' });
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) return sendJSON(res, 400, { error: 'boundary required' });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = Buffer.concat(chunks);
    const parts = data.toString('binary').split('--' + boundary);
    let filename = '', fileBuffer = null;
    for (const part of parts) {
      if (part.includes('filename=')) {
        const m = part.match(/filename="([^"]+)"/);
        if (m) filename = m[1];
        const bodyStart = part.indexOf('\r\n\r\n');
        if (bodyStart >= 0) {
          const bodyEnd = part.lastIndexOf('\r\n');
          fileBuffer = Buffer.from(part.slice(bodyStart + 4, bodyEnd), 'binary');
        }
      }
    }
    if (!fileBuffer || !filename) return sendJSON(res, 400, { error: 'file not found' });
    if (fileBuffer.length > 2 * 1024 * 1024) return sendJSON(res, 400, { error: 'max 2MB' });
    const detectedExt = isValidImageBuffer(fileBuffer);
    if (!detectedExt) return sendJSON(res, 400, { error: 'format gambar tidak didukung atau file bukan gambar valid' });
    const saveName = 'prod_' + id() + '.' + detectedExt;
    const savePath = path.join(PUBLIC_IMG_DIR, saveName);
    fs.writeFileSync(savePath, fileBuffer);
    return sendJSON(res, 200, { ok: true, url: '/public/img/' + saveName });
  }

  // Admin: update order status by ref or id
  if (method === "PUT" && p.match(/^\/api\/admin\/orders\/[^/]+$/)) {
    if (!authAdmin(req)) return sendJSON(res, 401, { error: "unauthorized" });
    const orderRef = p.split("/").pop();
    const body = await readBody(req);
    let newStatus = body.status;
    if (newStatus === 'Dibatalkan') newStatus = 'Batal';
    if (!newStatus) return sendJSON(res, 400, { error: "status required" });

    const orders = getOrders();
    const order = orders.find(o => o.ref === orderRef || o.id === orderRef);
    if (!order) return sendJSON(res, 404, { error: "order not found" });

    order.status = newStatus;
    order.updatedAt = new Date().toISOString();
    order.history = order.history || [];
    order.history.push({ status: newStatus, at: new Date().toISOString() });
    writeJSON(ORDERS_FILE, orders);

    notifyCustomerStatus(order, newStatus).catch(e => console.error("[payu] notifyCustomerStatus error:", e.message));
    return sendJSON(res, 200, { ok: true, order: publicOrder(order) });
  }

  // Admin: get settings
  // Serve admin.html
  if (p === '/admin.html' || p === '/admin') {
    const f = path.join(__dirname, 'admin.html');
    if (fs.existsSync(f)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      });
      return res.end(fs.readFileSync(f));
    }
    return sendJSON(res, 404, { error: 'admin UI not deployed yet' });
  }

  // Serve public/img/*
  if (p.startsWith('/public/img/')) {
    const fp = path.resolve(path.join(__dirname, p));
    const allowedDir = path.resolve(path.join(__dirname, 'public', 'img'));
    if (!fp.startsWith(allowedDir)) return sendJSON(res, 403, { error: 'forbidden' });
    if (fs.existsSync(fp)) {
      const ext = path.extname(fp).toLowerCase();
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : 'image/webp';
      res.writeHead(200, { 'Content-Type': mime });
      return res.end(fs.readFileSync(fp));
    }
    return sendJSON(res, 404, { error: 'not found' });
  }

  // Serve uploads/* (bukti transfer dari customer) — hanya file dengan nama aman & ekstensi gambar
  if (p.startsWith('/toko-kit/uploads/') || p.startsWith('/payu/uploads/') || p.startsWith('/uploads/')) {
    const fname = path.basename(p); // basename mencegah path traversal
    const fp = path.join(UPLOADS_DIR, fname);
    const allowedExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    if (allowedExt.includes(path.extname(fname).toLowerCase()) && fs.existsSync(fp)) {
      const ext = path.extname(fname).toLowerCase();
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[ext];
      res.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
      return res.end(fs.readFileSync(fp));
    }
    return sendJSON(res, 404, { error: 'not found' });
  }

// ---------- endpoint admin Toko Kit ----------
// Token Toko Kit terpisah dari .token milik Payu — panel toko tidak boleh
// jadi jalan masuk ke admin Payu, dan sebaliknya.
function authAdminToko(req) {
  let secret = '';
  try { secret = fs.readFileSync(path.join(STATE_DIR, '.admin-token'), 'utf8').trim(); } catch { return false; }
  if (!secret) return false;
  const hAdmin = req.headers['x-admin-token'] || '';
  const hAuth = req.headers['authorization'] || '';
  const u = new URL(req.url, `http://${req.headers.host}`);
  const qAdmin = u.searchParams.get('admin_token') || '';
  const bearer = hAuth.replace(/^Bearer\s+/i, '').replace(/[^\x20-\x7E]/g, '').trim();
  const raw = (hAdmin || bearer || qAdmin).replace(/[^\x20-\x7E]/g, '').trim();
  if (!raw) return false;
  return timingSafeEqualStr(raw, secret);
}

// Dipasang SEBELUM blok 404 penutup router, supaya rute di bawah ini menang.
// Semua rute WAJIB lewat authAdmin(): panel ini bisa mengubah isi toko klien.
// Token dibaca dari state/.admin-token — dibuat sekali di server, tidak
// pernah ikut terkirim ke browser.

if (method === 'GET' && p === '/api/admin/products') {
  if (!authAdminToko(req)) return sendJSON(res, 401, { error: 'unauthorized' });
  return sendJSON(res, 200, { products: getProducts() });
}

if (method === 'PUT' && p === '/api/admin/products') {
  if (!authAdminToko(req)) return sendJSON(res, 401, { error: 'unauthorized' });
  const body = await readBody(req);
  const products = getProducts();
  const idx = products.findIndex(x => x.id === String(body.id || ''));
  if (idx === -1) return sendJSON(res, 404, { error: 'product not found' });

  const next = { ...products[idx] };
  if (body.name !== undefined) next.name = String(body.name).trim();
  if (body.price !== undefined) next.price = Number(body.price);
  if (body.stock !== undefined) next.stock = body.stock === null ? null : Number(body.stock);
  if (body.image !== undefined) next.image = String(body.image).trim();
  if (body.description !== undefined) next.description = String(body.description).trim();
  if (body.desc !== undefined) next.description = String(body.desc).trim();
  if (body.category !== undefined) next.category = String(body.category).trim();
  if (body.weight !== undefined) next.weight = Number(body.weight) || 0;
  if (body.active !== undefined) next.active = !!body.active;

  if (!next.name) return sendJSON(res, 400, { error: 'nama produk tidak boleh kosong' });
  if (isNaN(next.price) || next.price < 0) return sendJSON(res, 400, { error: 'harga harus angka dan tidak negatif' });

  next.updatedAt = new Date().toISOString();
  products[idx] = next;
  writeJSON(PRODUCTS_FILE, products);
  syncToTokoConfig(getSettings(), products);
  return sendJSON(res, 200, { ok: true, product: next });
}

if (method === 'DELETE' && p === '/api/admin/products') {
  if (!authAdminToko(req)) return sendJSON(res, 401, { error: 'unauthorized' });
  const body = await readBody(req);
  const targetId = String(body.id || body.productId || '');
  const products = getProducts();
  const idx = products.findIndex(x => x.id === targetId);
  if (idx === -1) return sendJSON(res, 404, { error: 'product not found' });

  // Pesanan lama menyimpan productId. Menghapus baris memutus riwayat pesanan,
  // jadi default = arsipkan. Hapus permanen harus diminta eksplisit.
  if (body.permanent === true) {
    products.splice(idx, 1);
    writeJSON(PRODUCTS_FILE, products);
    syncToTokoConfig(getSettings(), products);
    return sendJSON(res, 200, { ok: true, removed: true, id: targetId });
  }
  products[idx] = { ...products[idx], active: false, archivedAt: new Date().toISOString() };
  writeJSON(PRODUCTS_FILE, products);
  syncToTokoConfig(getSettings(), products);
  return sendJSON(res, 200, { ok: true, archived: true, id: targetId });
}

if (method === 'GET' && p === '/api/admin/settings') {
  if (!authAdminToko(req)) return sendJSON(res, 401, { error: 'unauthorized' });
  return sendJSON(res, 200, { settings: getSettings() });
}

if (method === 'PUT' && p === '/api/admin/settings') {
  if (!authAdminToko(req)) return sendJSON(res, 401, { error: 'unauthorized' });
  const body = await readBody(req);
  const cur = getSettings();
  // Daftar putih bidang: klien tidak boleh menulis kunci sembarangan.
  const allowed = ['storeName', 'storeDesc', 'adminPhone', 'waPublic', 'address', 'city', 'hours', 'qrisOwner', 'qrisNote', 'logo'];
  const next = { ...cur };
  for (const k of allowed) {
    if (body[k] === undefined) continue;
    next[k] = String(body[k]).trim();
  }
  if (body.theme !== undefined) {
    if (typeof body.theme === 'string') next.theme = body.theme;
    else if (body.theme && typeof body.theme === 'object') {
      next.theme = {
        preset: String(body.theme.preset || 'warm-paper'),
        ...(body.theme.primary ? { primary: String(body.theme.primary) } : {}),
      };
    }
  }
  next.updatedAt = new Date().toISOString();
  saveSettings(next);
  syncToTokoConfig(next, getProducts());
  return sendJSON(res, 200, { ok: true, settings: next });
}

// Setelan publik: dipakai halaman toko untuk menampilkan nama/kontak/jam buka.
if (method === 'GET' && p === '/api/settings-public') {
  const s = getSettings();
  return sendJSON(res, 200, {
    settings: {
      storeName: s.storeName || '',
      storeDesc: s.storeDesc || '',
      waPublic: s.waPublic || s.adminPhone || '',
      address: s.address || '',
      city: s.city || '',
      hours: s.hours || '',
      logo: s.logo || '',
      theme: s.theme || 'warm-paper',
      qrisOwner: s.qrisOwner || '',
      qrisNote: s.qrisNote || '',
    },
  });
}

// Admin: info langganan SaaS
if (method === 'GET' && p === '/api/admin/subscription') {
  if (!authAdminToko(req)) return sendJSON(res, 401, { error: 'unauthorized' });
  const sub = getSubscription();
  const end = new Date(sub.endDate).getTime();
  const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)));
  return sendJSON(res, 200, { ok: true, subscription: { ...sub, daysLeft } });
}

// Admin: konfirmasi pembayaran perpanjangan langganan SaaS
if (method === 'POST' && p === '/api/admin/subscription/confirm') {
  if (!authAdminToko(req)) return sendJSON(res, 401, { error: 'unauthorized' });
  const body = await readBody(req);
  const sub = getSubscription();
  sub.lastRenewRequest = {
    at: new Date().toISOString(),
    planId: body.planId || 'starter',
    amount: 49000,
    note: String(body.note || '').slice(0, 200),
  };
  saveSubscription(sub);
  return sendJSON(res, 200, { ok: true, message: 'Konfirmasi perpanjangan dicatat', subscription: sub });
}

// Cek token: dipakai panel untuk memastikan token benar sebelum menampilkan form.
if (method === 'GET' && p === '/api/admin/ping') {
  if (!authAdminToko(req)) return sendJSON(res, 401, { error: 'unauthorized' });
  return sendJSON(res, 200, { ok: true, store: getSettings().storeName || '' });
}

if (method === 'POST' && p === '/api/auth/login') {
  const body = await readBody(req);
  const tok = getToken();
  if (tok && timingSafeEqualStr(String(body.token || ''), tok)) return sendJSON(res, 200, { ok: true });
  return sendJSON(res, 401, { error: 'unauthorized' });
}

  sendJSON(res, 404, { error: 'not found', path: p });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      sendJSON(res, 500, { error: 'Internal Server Error' });
    }
  }
});

function publicOrder(o) {
  return {
    id: o.id, ref: o.ref,
    items: o.items || (o.productId ? [{ productId: o.productId, name: o.productName, qty: o.qty, unitPrice: o.unitPrice, lineTotal: o.subtotal }] : []),
    productName: o.productName, qty: o.qty,
    subtotal: o.subtotal, shippingMethod: o.shippingMethod,
    shippingLabel: o.shippingLabel, km: o.km, distFrom: o.distFrom, ongkir: o.ongkir,
    total: o.total, status: o.status, note: o.note, qris: o.qris,
    receiptHash: o.receiptHash || null,
    customer: o.customer, createdAt: o.createdAt, history: o.history,
  };
}

server.listen(PORT, HOST, () => {
  ensureState();
  console.log(`[payu] listening on http://${HOST}:${PORT}`);
});