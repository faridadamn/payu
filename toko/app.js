/**
 * toko-kit -- application logic.
 *
 * One store, one config.json, one catalog. No tenant switching.
 *
 * Data flow:
 *   config.json  -> identity, theme, shipping, payment (static, CDN-cached)
 *   <api>/api/catalog      -> products + categories  (public read)
 *   <api>/api/orders       -> create / list orders   (public write, server-priced)
 *   <api>/api/shipping/quote -> real distance cost   (OSRM on the backend)
 *
 * The order total shown here is a PREVIEW. The server recomputes every price
 * from its own product table before writing an order, so a tampered cart
 * cannot change what the customer is charged.
 */

import { resolveTheme, applyTheme } from './theme.js';

/* ============================================================
   Config
   ============================================================ */

const DEFAULT_CONFIG = {
  store: { name: 'Toko', tagline: '', description: '', logo: '', banner: '', whatsapp: '', address: '', city: '', hours: '' },
  theme: { preset: 'warm-paper', primary: '' },
  checkout: { mode: 'guest', requirePhone: true, requireAddress: true },
  payment: { method: 'qris', qrisImage: '', qrisOwner: '', note: '', bank: {} },
  shipping: { enabled: true, origin: { lat: -6.13984, lng: 106.51912 }, options: [], freeAbove: 0 },
  catalog: { layout: 'grid', columns: 4, showRating: true, showStock: true, categories: [] },
  chat: { enabled: true, greeting: 'Halo!', quickReplies: [] },
  admin: { apiBase: '', storeId: '' },
  branding: { orderPrefix: 'TK', footerNote: '' },
};

let CONFIG = structuredClone(DEFAULT_CONFIG);

function mergeConfig(base, override) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(override || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null) {
      out[k] = mergeConfig(out[k], v);
    } else if (v !== undefined) {
      // An empty string in config.json usually means "not set yet" -- keep the
      // default rather than blanking out a working value.
      if (v === '' && typeof out[k] === 'string' && out[k] !== '') continue;
      out[k] = v;
    }
  }
  return out;
}

const apiBase = (path) => {
  // Two shapes, one call site:
  //   - a full URL in config  -> talk to the origin directly (local preview, self-host)
  //   - empty                 -> go through the /api/proxy edge function on the same host
  //     so the browser never needs CORS and the origin host stays out of this bundle.
  const configured = (CONFIG.admin.apiBase || '').replace(/\/+$/, '');
  if (configured) {
    // Api base already ends in the store path, so strip the leading /api.
    return `${configured}${path.replace(/^\/api/, '')}`;
  }
  return `/api/proxy${path}`;
};

/* ============================================================
   State
   ============================================================ */

const state = {
  products: [],
  categories: [],
  cart: loadCart(),
  filter: { q: '', category: '' },
  shippingOption: null,
  quote: null,
  activeOrder: null,
};

/* ============================================================
   Tiny helpers
   ============================================================ */

const $ = (sel) => document.querySelector(sel);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const rupiah = (n) => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');

const initials = (name) => String(name || '?')
  .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

const storeUrl = () => {
  const u = new URL(window.location.href);
  u.search = '';
  u.hash = '';
  return u.toString();
};

/** Full product link, so a shared URL opens that product directly. */
const productUrl = (id) => `${storeUrl()}?p=${encodeURIComponent(id)}`;

function cleanWa(num) {
  if (!num) return '';
  const digits = String(num).replace(/\D/g, '');
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  return digits;
}

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function icon(name) {
  const paths = {
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3-6.2 3.3L7 14.2l-5-4.9 6.9-1z"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    wa: '<path d="M21 12a9 9 0 0 1-13.4 7.8L3 21l1.3-4.5A9 9 0 1 1 21 12z"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    truck: '<path d="M1 3h13v13H1z"/><path d="M14 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="1.5"/><circle cx="17.5" cy="18.5" r="1.5"/>',
    up: '<path d="M12 17V4"/><path d="m6 10 6-6 6 6"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

/* ============================================================
   Cart persistence
   ============================================================ */

function cartKey() { return `tokokit.cart.${CONFIG.admin.storeId || 'default'}`; }

function loadCart() {
  try {
    const raw = localStorage.getItem(`tokokit.cart.${(CONFIG.admin?.storeId) || 'default'}`) || localStorage.getItem('tokokit.cart.default');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((i) => i && i.id) : [];
  } catch { return []; }
}

function saveCart() {
  try {
    localStorage.setItem(cartKey(), JSON.stringify(state.cart));
  } catch { /* quota or private mode -- cart stays in memory for this session */ }
}

function cartCount() { return state.cart.reduce((n, i) => n + (Number(i.qty) || 0), 0); }

function cartItems() {
  return state.cart.map((line) => {
    const p = state.products.find((x) => x.id === line.id);
    return p ? { ...p, qty: line.qty } : null;
  }).filter(Boolean);
}

function cartSubtotal() {
  return cartItems().reduce((sum, i) => sum + i.price * i.qty, 0);
}

const JASA_CATEGORIES = ['jasa', 'layanan', 'service', 'kursus', 'perbaikan', 'laundry'];

/**
 * Whether a product needs delivery. Sourced from the product itself and the
 * store's category labels -- not inferred from how it was typed into a form.
 */
function isPhysical(p) {
  if (typeof p.shippable === 'boolean') return p.shippable;
  const cat = String(p.category || '').toLowerCase();
  return !JASA_CATEGORIES.some((j) => cat.includes(j));
}

function fulfillmentMode() {
  const items = cartItems();
  if (!items.length) return 'physical';
  if (items.every((i) => isPhysical(i))) return 'physical';
  if (items.some((i) => isPhysical(i))) return 'mixed';
  return 'jasa';
}

/* ============================================================
   Boot
   ============================================================ */

let boot = async function boot() {
  await loadConfig();
  applyConfig();

  try {
    await loadCatalog();
  } catch (err) {
    renderCatalogError(err);
    return;
  }

  renderIntro();
  renderChips();
  renderCatalog();
  renderCartBadge();
  wireGlobal();

  // Deep link: /?p=<productId> opens that product, /?c=<category> filters by category.
  const sp = new URLSearchParams(window.location.search);
  const cat = sp.get('c') || sp.get('category');
  if (cat) {
    state.activeCategory = cat;
    renderChips();
    renderCatalog();
  }
  const pid = sp.get('p');
  if (pid) openProduct(pid);
}

async function loadConfig() {
  try {
    const res = await fetch('./config.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`config.json ${res.status}`);
    CONFIG = mergeConfig(DEFAULT_CONFIG, await res.json());
  } catch (err) {
    console.warn('[toko-kit] config.json tidak terbaca, pakai default.', err);
    CONFIG = structuredClone(DEFAULT_CONFIG);
  }
}

async function loadCatalog() {
  const res = await fetch(apiBase('/api/catalog'), { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Katalog gagal dimuat (HTTP ${res.status})`);
  const data = await res.json();

  const raw = Array.isArray(data) ? data : (data.products || []);
  state.products = raw.map(normalizeProduct).filter((p) => p.id);

  const fromProducts = [...new Set(state.products.map((p) => p.category).filter(Boolean))];
  const configured = (CONFIG.catalog.categories || []).filter(Boolean);
  // Only show categories that actually contain something. An empty chip that
  // leads to "no products" is the fastest way to make a small store feel broken.
  state.categories = (configured.length ? configured : fromProducts)
    .filter((c) => state.products.some((p) => p.category === c));
}

function normalizeProduct(p) {
  const price = Number(p.price) || 0;
  const compareAt = Number(p.compareAt ?? p.compare_at ?? p.originalPrice ?? 0) || 0;
  const stockRaw = p.stock;
  const unlimited = stockRaw === undefined || stockRaw === null || p.unlimited === true;
  const stock = unlimited ? Infinity : Math.max(0, Number(stockRaw) || 0);

  return {
    id: String(p.id ?? p.sku ?? ''),
    name: String(p.name ?? p.title ?? 'Tanpa nama'),
    price,
    compareAt: compareAt > price ? compareAt : 0,
    category: String(p.category ?? ''),
    description: String(p.description ?? p.desc ?? ''),
    image: String(p.image ?? p.imageUrl ?? p.img ?? ''),
    rating: Number(p.rating) || 0,
    sold: Number(p.sold) || 0,
    stock,
    unlimited,
    weight: Number(p.weight ?? p.berat ?? 0) || 0,
    unit: String(p.unit ?? ''),
    isNew: Boolean(p.isNew ?? p.new),
    shippable: typeof p.shippable === 'boolean' ? p.shippable : undefined,
  };
}

/* ============================================================
   Apply config to the shell
   ============================================================ */

function applyConfig() {
  const s = CONFIG.store;
  const storeId = CONFIG.admin.storeId || 'default';

  // Re-read the cart now that we know the store id.
  state.cart = (() => {
    try {
      const raw = localStorage.getItem(`tokokit.cart.${storeId}`);
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed.filter((i) => i && i.id) : [];
    } catch { return []; }
  })();

  const theme = resolveTheme(CONFIG.theme);
  applyTheme(theme.tokens, document.documentElement, CONFIG.theme?.preset || theme.name || 'custom');
  for (const w of theme.warnings) console.warn('[toko-kit:theme]', w);

  const metaTheme = $('#meta-theme');
  if (metaTheme) metaTheme.setAttribute('content', theme.tokens.bg);

  document.title = s.name || 'Toko';
  const desc = $('#meta-desc');
  if (desc) desc.setAttribute('content', s.tagline || s.description || '');

  if (s.logo) {
    const fav = $('#favicon');
    if (fav) { fav.setAttribute('rel', 'icon'); fav.setAttribute('href', s.logo); }
  }

  setAvatar($('#hdrLogo'), s.logo, initials(s.name));
  $('#hdrName').textContent = s.name || '';

  const chatOn = CONFIG.chat.enabled !== false;
  $('#chatFab').hidden = !chatOn;
  setAvatar($('#chatAv'), s.logo, initials(s.name));
  $('#chatName').textContent = s.name || 'Penjual';
}

function setAvatar(el, logo, fallbackText) {
  if (!el) return;
  if (!logo) {
    el.textContent = fallbackText || '';
    return;
  }
  const img = document.createElement('img');
  img.src = logo;
  img.alt = '';
  img.onerror = () => { el.textContent = fallbackText || ''; };
  el.replaceChildren(img);
}

function renderIntro() {
  const s = CONFIG.store;
  $('#intro').hidden = false;

  const banner = $('#introBanner');
  // Toko tanpa banner cukup menyembunyikan blok ini. Jangan pernah menaruh
  // pesan untuk pemilik toko di halaman yang dilihat pembeli.
  if (s.banner) {
    banner.innerHTML = `<img src="${esc(s.banner)}" alt="">`;
    banner.hidden = false;
  } else {
    banner.innerHTML = '';
    banner.hidden = true;
  }

  setAvatar($('#introAvatar'), s.logo, initials(s.name));
  $('#introName').textContent = s.name || '';
  $('#introTagline').textContent = s.tagline || '';
  $('#introTagline').hidden = !s.tagline;

  const facts = [];
  if (s.city) facts.push(`<span>${icon('pin')}${esc(s.city)}</span>`);
  if (s.hours) facts.push(`<span>${icon('clock')}${esc(s.hours)}</span>`);
  const opts = activeShippingOptions();
  if (opts.length) {
    const fastest = opts.find((o) => o.id === 'instan') || opts[0];
    facts.push(`<span>${icon('truck')}${esc(fastest.label)}</span>`);
  }
  if (CONFIG.shipping.freeAbove > 0) {
    facts.push(`<span>Gratis ongkir di atas ${rupiah(CONFIG.shipping.freeAbove)}</span>`);
  }
  $('#introFacts').innerHTML = facts.join('');

  // Footer
  const ftr = $('#ftr');
  ftr.hidden = false;
  const fFacts = [];
  if (s.address) fFacts.push(`<span>${esc(s.address)}</span>`);
  if (s.whatsapp) {
    fFacts.push(`<span><a href="https://wa.me/${cleanWa(s.whatsapp)}" target="_blank" rel="noopener">WhatsApp ${esc(s.whatsapp)}</a></span>`);
  }
  $('#ftrFacts').innerHTML = fFacts.join('');
  $('#ftrNote').textContent = CONFIG.branding.footerNote || s.description || '';
}

let renderChips = function renderChips() {
  const nav = $('#chips');
  const cats = state.categories;

  if (cats.length < 2) { nav.hidden = true; return; }

  nav.hidden = false;
  nav.innerHTML = ['', ...cats].map((c) => `
    <button class="chip" data-cat="${esc(c)}" aria-pressed="${state.filter.category === c}">
      ${esc(c || 'Semua')}
    </button>
  `).join('');
}

/* ============================================================
   Catalog rendering
   ============================================================ */

function visibleProducts() {
  const q = state.filter.q.trim().toLowerCase();
  return state.products.filter((p) => {
    if (state.filter.category && p.category !== state.filter.category) return false;
    if (!q) return true;
    return (p.name + ' ' + p.category + ' ' + p.description).toLowerCase().includes(q);
  });
}

let renderCatalog = function renderCatalog() {
  const grid = $('#grid');
  const items = visibleProducts();

  if (!state.products.length) {
    $('#secHead').hidden = true;
    grid.innerHTML = '';
    grid.insertAdjacentHTML('afterend', '');
    renderEmpty(grid, 'Toko belum punya produk', 'Tambahkan produk lewat panel admin, lalu muat ulang halaman ini.');
    return;
  }

  $('#secHead').hidden = false;
  const cat = state.filter.category;
  $('#secTitle').textContent = cat || (state.filter.q ? 'Hasil pencarian' : 'Semua Produk');
  $('#secCount').textContent = `${items.length} produk`;

  if (!items.length) {
    grid.innerHTML = '';
    renderEmpty(grid, 'Tidak ada yang cocok', state.filter.q
      ? `Tidak ada produk yang cocok dengan "${state.filter.q}".`
      : 'Coba pilih kategori lain.');
    return;
  }

  grid.innerHTML = items.map(cardHtml).join('');
}

function renderEmpty(grid, title, msg) {
  grid.innerHTML = `
    <div class="state" style="grid-column:1/-1">
      ${icon('box')}
      <p class="state-title">${esc(title)}</p>
      <p class="state-msg">${esc(msg)}</p>
    </div>`;
}

function cardHtml(p) {
  const disc = p.compareAt ? Math.round((1 - p.price / p.compareAt) * 100) : 0;
  const out = !p.unlimited && p.stock <= 0;

  let tag = '';
  if (out) tag = '<span class="tag tag-out">Habis</span>';
  else if (disc >= 5) tag = `<span class="tag tag-disc">-${disc}%</span>`;
  else if (p.isNew) tag = '<span class="tag tag-new">Baru</span>';

  const media = p.image
    ? `<img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.onerror=null;this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='grid'"><div class="card-media-ph card-media-fallback">${icon('box')}</div>`
    : `<div class="card-media-ph">${icon('box')}</div>`;

  const showRating = CONFIG.catalog.showRating !== false && p.rating > 0;
  const showStock = CONFIG.catalog.showStock !== false;

  const low = !p.unlimited && p.stock > 0 && p.stock <= 5;
  const stockTxt = p.unlimited ? '' : (out ? 'Stok habis' : `Sisa ${p.stock}`);

  return `
  <button class="card" data-pid="${esc(p.id)}" aria-label="${esc(p.name)}">
    <div class="card-media">${tag}${media}</div>
    <div class="card-body">
      <div class="card-name">${esc(p.name)}</div>
      <div class="card-price">
        <span class="card-price-now">${rupiah(p.price)}</span>
        ${p.compareAt ? `<span class="card-price-was">${rupiah(p.compareAt)}</span>` : ''}
      </div>
      <div class="card-foot">
        ${showRating ? `<span class="card-rating">${icon('star')}${p.rating.toFixed(1)}</span>` : '<span></span>'}
        ${showStock && stockTxt ? `<span class="card-stock${low ? ' low' : ''}">${esc(stockTxt)}</span>` : ''}
      </div>
    </div>
  </button>`;
}

function renderCatalogError(err) {
  const grid = $('#grid');
  grid.innerHTML = `
    <div class="state" style="grid-column:1/-1">
      ${icon('box')}
      <p class="state-title">Katalog tidak bisa dimuat</p>
      <p class="state-msg">${esc(err.message || 'Terjadi kesalahan.')}<br>Cek koneksi ke server toko, lalu coba lagi.</p>
      <button id="retryCat">Coba lagi</button>
    </div>`;
  $('#retryCat').addEventListener('click', () => window.location.reload());
}

/* ============================================================
   Cart UI
   ============================================================ */

let renderCartBadge = function renderCartBadge() {
  const n = cartCount();
  const b = $('#cartBadge');
  b.textContent = String(n);
  b.hidden = n === 0;
  const bnav = document.getElementById('bnavCartBadge');
  if (bnav) {
    bnav.textContent = String(n);
    bnav.hidden = n === 0;
  }
}

function addToCart(id, qty = 1) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  if (!p.unlimited && p.stock <= 0) { toast('Stok habis'); return; }

  const line = state.cart.find((i) => i.id === id);
  const max = p.unlimited ? Infinity : p.stock;
  const next = (line ? line.qty : 0) + qty;

  if (next > max) { toast(`Stok cuma ${p.stock}`); return; }

  if (line) line.qty = next;
  else state.cart.push({ id, qty });
  saveCart();
  renderCartBadge();
  toast(`${p.name} masuk keranjang`);
}

function setQty(id, qty) {
  const p = state.products.find((x) => x.id === id);
  const line = state.cart.find((i) => i.id === id);
  if (!line) return;

  const max = p && !p.unlimited ? p.stock : Infinity;
  const q = Math.max(0, Math.min(qty, max));

  if (q === 0) state.cart = state.cart.filter((i) => i.id !== id);
  else line.qty = q;

  saveCart();
  renderCartBadge();
  openCart();
}

/* ============================================================
   Sheet
   ============================================================ */

let sheetStack = [];

let openSheet = function openSheet(title, bodyHtml, footHtml = '') {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = bodyHtml;
  $('#sheetFoot').innerHTML = footHtml;
  $('#sheet').hidden = false;
  $('#scrim').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#sheetBody').scrollTop = 0;
}

function closeSheet() {
  $('#sheet').hidden = true;
  $('#scrim').hidden = true;
  document.body.style.overflow = '';
  sheetStack = [];
}

function openCart() {
  const items = cartItems();

  if (!items.length) {
    openSheet('Keranjang', `
      <div class="state">
        ${icon('box')}
        <p class="state-title">Keranjang kosong</p>
        <p class="state-msg">Pilih produk dulu, nanti muncul di sini.</p>
      </div>`);
    return;
  }

  const body = items.map((i) => `
    <div class="row" data-testid="cart-row">
      <div class="row-media">${i.image ? `<img src="${esc(i.image)}" alt="">` : icon('box')}</div>
      <div class="row-main">
        <div class="row-name">${esc(i.name)}</div>
        <div class="row-price">${rupiah(i.price * i.qty)}</div>
        <div class="row-ctl">
          <button data-dec="${esc(i.id)}" aria-label="Kurangi" ${i.qty <= 1 ? 'disabled' : ''}>−</button>
          <span class="row-qty">${i.qty}</span>
          <button data-inc="${esc(i.id)}" aria-label="Tambah" ${!i.unlimited && i.qty >= i.stock ? 'disabled' : ''}>+</button>
          <button class="row-del" data-del="${esc(i.id)}" aria-label="Hapus dari keranjang" title="Hapus dari keranjang">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      </div>
    </div>`).join('');

  const sub = cartSubtotal();
  openSheet('Keranjang', body, `
    <div class="tot grand"><span class="tot-k">Subtotal</span><span class="tot-v">${rupiah(sub)}</span></div>
    <p class="hint" style="font-size:11.5px;color:var(--tk-text-muted);margin:8px 0 11px">Ongkir dihitung di langkah berikutnya.</p>
    <button class="btn" id="toCheckout" data-testid="to-checkout">Lanjut ke checkout</button>
  `);

  $('#toCheckout').addEventListener('click', () => openCheckout());
}

/* ============================================================
   Product detail
   ============================================================ */

function openProduct(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;

  const disc = p.compareAt ? Math.round((1 - p.price / p.compareAt) * 100) : 0;
  const out = !p.unlimited && p.stock <= 0;

  const facts = [];
  if (p.category) facts.push(`<span>${esc(p.category)}</span>`);
  if (CONFIG.catalog.showRating !== false && p.rating > 0) {
    facts.push(`<span>${icon('star')}${p.rating.toFixed(1)}</span>`);
  }
  if (!p.unlimited) {
    facts.push(`<span>${out ? 'Stok habis' : `Stok ${p.stock}`}</span>`);
  }
  if (p.weight) facts.push(`<span>${p.weight} g</span>`);
  if (isPhysical(p)) facts.push(`<span>${icon('truck')}Dikirim</span>`);
  else facts.push(`<span>${icon('check')}Layanan di toko</span>`);

  const body = `
    <div class="pd-media">${p.image ? `<img src="${esc(p.image)}" alt="">` : icon('box')}</div>
    <h3 class="pd-name">${esc(p.name)}</h3>
    <div class="pd-price">
      <span class="pd-price-now">${rupiah(p.price)}</span>
      ${p.compareAt ? `<span class="pd-price-was">${rupiah(p.compareAt)}</span>` : ''}
      ${disc >= 5 ? `<span class="tag tag-disc" style="position:static">-${disc}%</span>` : ''}
    </div>
    <div class="pd-facts">${facts.join('')}</div>
    ${p.description ? `<p class="pd-label">Deskripsi</p><p class="pd-desc">${esc(p.description)}</p>` : ''}
    <div style="display:flex;gap:8px;margin-top:6px">
      <button class="btn btn-ghost" id="pdShare" style="flex:0 0 auto;width:auto;padding:0 16px">Bagikan</button>
      <button class="btn" id="pdAdd" data-testid="pd-add" style="flex:1" ${out ? 'disabled' : ''}>
        ${out ? 'Stok habis' : 'Tambah ke keranjang'}
      </button>
    </div>`;

  openSheet('Detail Produk', body);
  const pdRoot = $('#sheetBody .pd-media');
  if (pdRoot) pdRoot.dataset.testid = 'product-sheet';

  $('#pdAdd')?.addEventListener('click', () => {
    addToCart(p.id, 1);
    openCart();
  });

  $('#pdShare')?.addEventListener('click', async () => {
    const url = productUrl(p.id);
    const data = { title: p.name, text: `${p.name} — ${rupiah(p.price)}`, url };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(url); toast('Link produk disalin'); }
    } catch { /* user cancelled the share sheet */ }
  });
}

/* ============================================================
   Checkout
   ============================================================ */

function activeShippingOptions() {
  if (CONFIG.shipping.enabled === false) return [];
  return (CONFIG.shipping.options || []).filter((o) => o.active !== false);
}

function openCheckout() {
  const items = cartItems();
  if (!items.length) { toast('Keranjang masih kosong'); return; }

  const mode = fulfillmentMode();
  const needsShipping = mode !== 'jasa';
  const opts = needsShipping ? activeShippingOptions() : [];
  const sub = cartSubtotal();
  const needsIdentity = CONFIG.checkout.mode === 'otp';

  if (!state.shippingOption && opts.length) {
    state.shippingOption = opts[0].id;
  }

  const shipHtml = !needsShipping ? `
    <p class="hint" style="font-size:12.5px;color:var(--tk-text-muted);margin-bottom:12px">
      ${mode === 'jasa' ? 'Semua item ini berupa layanan — tidak perlu pengiriman.' : ''}
    </p>` : (!opts.length ? `
    <p class="hint" style="font-size:12.5px;color:var(--tk-text-muted);margin-bottom:12px">
      Pengiriman belum diatur toko. Hubungi penjual lewat chat.
    </p>` : `
    <div class="field">
      <label>Pengiriman</label>
      <div class="radio-list" id="shipList">
        ${opts.map((o) => `
          <label class="radio">
            <input type="radio" name="ship" data-testid="shipping-option" value="${esc(o.id)}" ${state.shippingOption === o.id ? 'checked' : ''}>
            <span class="radio-main">
              <span class="radio-name">${esc(o.label)}</span>
              <span class="radio-sub">${o.perKm ? 'Ongkir dihitung dari jarak' : 'Tarif tetap'}</span>
            </span>
            <span class="radio-cost" data-cost="${esc(o.id)}">—</span>
          </label>`).join('')}
      </div>
    </div>`);

  const body = `
    ${needsIdentity ? `
    <div class="field" id="fPhoneFirst">
      <label for="cPhoneFirst">Nomor WhatsApp</label>
      <input type="tel" id="cPhoneFirst" inputmode="numeric" placeholder="08xxxxxxxxxx" autocomplete="tel">
      <div class="hint">Kami kirim kode verifikasi ke WhatsApp ini.</div>
      <button class="btn" id="sendOtp" style="margin-top:9px">Kirim kode</button>
    </div>
    <div id="otpBlock" hidden>
      <div class="field">
        <label for="cOtp">Kode verifikasi</label>
        <input type="text" id="cOtp" inputmode="numeric" maxlength="6" placeholder="6 angka">
      </div>
      <button class="btn btn-ghost" id="verifyOtp">Verifikasi</button>
    </div>
    <hr style="border:0;border-top:1px solid var(--tk-border);margin:16px 0">
    ` : ''}

    <div class="field">
      <label for="cName">Nama penerima</label>
      <input type="text" id="cName" data-testid="customer-name" autocomplete="name" placeholder="Nama lengkap">
    </div>

    <div class="field">
      <label for="cPhone">Nomor WhatsApp</label>
      <input type="tel" id="cPhone" data-testid="customer-phone" inputmode="numeric" autocomplete="tel" placeholder="08xxxxxxxxxx">
      <div class="hint">Untuk konfirmasi pesanan.</div>
    </div>

    ${needsShipping ? `
    <div class="field">
      <label for="cAddr">Alamat lengkap</label>
      <textarea id="cAddr" data-testid="customer-address" placeholder="Jalan, nomor rumah, RT/RW, kelurahan, kecamatan, kota, kode pos" autocomplete="street-address"></textarea>
    </div>
    <div class="field">
      <label for="cNote">Catatan untuk penjual <span style="font-weight:400;color:var(--tk-text-muted)">(opsional)</span></label>
      <input type="text" id="cNote" placeholder="Contoh: titip ke pos keamanan">
    </div>
    ${shipHtml}
    ` : ''}

    <div class="tot"><span class="tot-k">Subtotal (${cartCount()} barang)</span><span class="tot-v">${rupiah(sub)}</span></div>
    <div class="tot"><span class="tot-k">Ongkir</span><span class="tot-v" id="shipCost" data-testid="shipping-cost">—</span></div>
    <div class="tot grand"><span class="tot-k">Total</span><span class="tot-v" id="grandTotal" data-testid="grand-total">${rupiah(sub)}</span></div>`;

  openSheet('Checkout', body, `<button class="btn" id="placeOrder" data-testid="place-order">Buat pesanan</button>`);

  const prof = getUserProfile();
  if (prof) {
    if ($('#cName') && !$('#cName').value) $('#cName').value = prof.name || '';
    if ($('#cPhone') && !$('#cPhone').value) $('#cPhone').value = prof.phone || '';
    if ($('#cAddr') && !$('#cAddr').value) $('#cAddr').value = prof.address || '';
  }

  if (needsShipping && opts.length) {
    $('#shipList').addEventListener('change', (e) => {
      if (e.target.name === 'ship') { state.shippingOption = e.target.value; refreshQuote(); }
    });
    refreshQuote();
  }

  if (needsIdentity) wireOtp();

  $('#placeOrder').addEventListener('click', submitOrder);
}

/* ---- OTP (only when config.checkout.mode === "otp") ---- */

function wireOtp() {
  let verified = false;

  $('#sendOtp')?.addEventListener('click', async () => {
    const phone = $('#cPhoneFirst').value.trim();
    if (!/^0?8\d{7,13}$/.test(phone.replace(/[\s-]/g, ''))) {
      toast('Nomor WhatsApp tidak valid'); return;
    }
    $('#sendOtp').disabled = true;
    try {
      const res = await fetch(apiBase('/api/otp/request'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) throw new Error('Gagal mengirim kode');
      $('#otpBlock').hidden = false;
      toast('Kode dikirim ke WhatsApp kamu');
    } catch (err) {
      toast(err.message);
    } finally {
      // Re-enable so a failed send can be retried without reloading.
      setTimeout(() => { $('#sendOtp').disabled = false; }, 30000);
    }
  });

  $('#verifyOtp')?.addEventListener('click', async () => {
    const phone = $('#cPhoneFirst').value.trim();
    const code = $('#cOtp').value.trim();
    try {
      const res = await fetch(apiBase('/api/otp/verify'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Kode salah');
      verified = true;
      $('#cPhone').value = phone;
      $('#fPhoneFirst').innerHTML = `<div class="hint" style="color:var(--tk-accent);font-weight:600">✓ Nomor terverifikasi</div>`;
      $('#otpBlock').innerHTML = '';
      toast('Nomor terverifikasi');
    } catch (err) {
      toast(err.message);
    }
  });

  // Block submit until verified, so the mode actually means something.
  $('#placeOrder').addEventListener('click', (e) => {
    if (!verified) {
      e.stopImmediatePropagation();
      toast('Verifikasi nomor WhatsApp dulu');
    }
  }, true);
}

/* ---- shipping quote (real distance, via backend + OSRM) ---- */

let quoteTimer;

async function refreshQuote() {
  const needsShipping = fulfillmentMode() !== 'jasa';
  const costEl = $('#shipCost');
  const totalEl = $('#grandTotal');
  const sub = cartSubtotal();
  if (!costEl) return;

  const opt = activeShippingOptions().find((o) => o.id === state.shippingOption);
  if (!opt) { costEl.textContent = '—'; totalEl.textContent = rupiah(sub); return; }

  if (!opt.perKm) {
    const cost = applyFreeShipping(sub, Number(opt.flat) || 0);
    state.quote = { cost };
    costEl.textContent = cost === 0 ? 'Gratis' : rupiah(cost);
    totalEl.textContent = rupiah(sub + cost);
    return;
  }

  const addr = ($('#cAddr')?.value || '').trim();
  if (addr.length < 10) {
    costEl.textContent = 'Isi alamat dulu';
    totalEl.textContent = rupiah(sub);
    state.quote = null;
    return;
  }

  state.quote = null;
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(async () => {
    costEl.textContent = 'Menghitung…';
    try {
      const res = await fetch(apiBase('/api/shipping/quote'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address: addr,
          optionId: opt.id,
          perKm: opt.perKm,
          origin: CONFIG.shipping.origin,
          weight: cartItems().reduce((w, i) => w + (i.weight || 0) * i.qty, 0),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.distanceKm == null) throw new Error(data.error || 'Alamat tidak ditemukan');

      const cost = applyFreeShipping(sub, Math.round(data.distanceKm * opt.perKm));
      state.quote = { cost, distanceKm: data.distanceKm };
      costEl.textContent = `${rupiah(cost)} · ${data.distanceKm.toFixed(1)} km`;
      totalEl.textContent = rupiah(sub + cost);
    } catch (err) {
      costEl.textContent = 'Gagal hitung';
      totalEl.textContent = rupiah(sub);
      state.quote = null;
      console.warn('[toko-kit] quote gagal:', err.message);
    }
  }, 700);
}

function shippingCost() {
  return Number(state.quote?.cost) || 0;
}

function applyFreeShipping(subtotal, cost) {
  const threshold = Number(CONFIG.shipping.freeAbove) || 0;
  if (threshold > 0 && subtotal >= threshold) return 0;
  return cost;
}

/* ---- submit ---- */

let submitting = false;

async function submitOrder() {
  if (submitting) return;

  const items = cartItems();
  if (!items.length) { toast('Keranjang masih kosong'); return; }

  const name = ($('#cName')?.value || '').trim();
  const phone = ($('#cPhone')?.value || '').trim();
  const address = ($('#cAddr')?.value || '').trim();
  const note = ($('#cNote')?.value || '').trim();
  const needsShipping = fulfillmentMode() !== 'jasa';

  let bad = false;
  const mark = (id, msg) => {
    const f = $(id)?.closest('.field');
    if (!f) return;
    f.classList.add('bad');
    let e = f.querySelector('.err');
    if (!e) { e = document.createElement('div'); e.className = 'err'; f.appendChild(e); }
    e.textContent = msg;
    bad = true;
  };
  document.querySelectorAll('.field.bad').forEach((f) => {
    f.classList.remove('bad');
    f.querySelector('.err')?.remove();
  });

  if (CONFIG.checkout.requirePhone !== false && !/^0?8\d{7,13}$/.test(phone.replace(/[\s-]/g, ''))) {
    mark('#cPhone', 'Nomor WhatsApp belum benar. Contoh: 08123456789');
  }
  if (!name) mark('#cName', 'Nama penerima wajib diisi.');
  if (needsShipping && CONFIG.checkout.requireAddress !== false && address.length < 10) {
    mark('#cAddr', 'Alamat terlalu singkat — tulis minimal 10 karakter.');
  }
  if (needsShipping && activeShippingOptions().length && !state.shippingOption) {
    toast('Pilih metode pengiriman'); bad = true;
  }
  if (needsShipping && state.shippingOption) {
    const opt = activeShippingOptions().find((o) => o.id === state.shippingOption);
    if (opt && opt.perKm && !state.quote) {
      toast('Menghitung ongkir, silakan tunggu sebentar'); return;
    }
  }
  if (bad) { toast('Ada yang perlu dibetulkan'); return; }

  submitting = true;
  const btn = $('#placeOrder');
  if (btn) { btn.disabled = true; btn.textContent = 'Memproses…'; }

  try {
    const res = await fetch(apiBase('/api/orders'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer: { name, phone, address, note },
        name,
        phone,
        address,
        note,
        items: state.cart.map((i) => ({ productId: i.id, qty: i.qty })),
        shipping: state.shippingOption || 'kurir',
        shippingMethod: state.shippingOption || 'kurir',
        shippingDetail: needsShipping && state.shippingOption
          ? { optionId: state.shippingOption, origin: CONFIG.shipping.origin, cost: shippingCost(), distanceKm: state.quote?.distanceKm ?? null }
          : null,
        clientTotal: cartSubtotal(),
        ongkir: shippingCost(),
        total: cartSubtotal() + shippingCost(),
        chatId: getChatId(),
        userToken: getUserToken() || undefined,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Pesanan gagal dibuat');
    const created = data.order || data;
    if (!created.orderNo && !created.id && !created.ref) throw new Error(data.error || 'Pesanan gagal dibuat');
    
    // Simpan ke riwayat pesanan lokal pembeli
    try {
      const myOrders = JSON.parse(localStorage.getItem("tokokit.my_orders") || "[]");
      const refCode = created.ref || created.orderNo || created.id;
      myOrders.unshift({
        id: created.id,
        ref: refCode,
        orderNo: refCode,
        total: created.total || (cartSubtotal() + shippingCost()),
        statusLabel: created.statusLabel || "Pesanan Baru",
        createdAt: created.createdAt || new Date().toISOString(),
        items: cartItems().map(i => ({ name: i.name, qty: i.qty, price: i.price }))
      });
      localStorage.setItem("tokokit.my_orders", JSON.stringify(myOrders.slice(0, 30)));
    } catch {}
    // Prices are computed server-side, so the server's figure is the one shown.
    // A mismatch here means the catalog changed under the customer's feet.
    if (created.total != null && Number(created.total) !== cartSubtotal() + shippingCost()) {
      toast('Harga berubah sejak kamu membuka halaman — mohon cek ulang pesanan.');
    }

    state.activeOrder = created;
    state.cart = [];
    saveCart();
    renderCartBadge();
    openPayment(created);
  } catch (err) {
    toast(err.message || 'Pesanan gagal dibuat');
  } finally {
    submitting = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Buat pesanan'; }
  }
}

/* ============================================================
   Payment
   ============================================================ */

/* ============================================================
   User Auth & Account (Adopted from Payu)
   ============================================================ */

const USER_TOKEN_KEY = 'tokokit.user_token';
const USER_PROFILE_KEY = 'tokokit.user_profile';

function getUserToken() {
  try { return localStorage.getItem(USER_TOKEN_KEY) || ''; } catch { return ''; }
}

function getUserProfile() {
  try {
    const raw = localStorage.getItem(USER_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setUserAuth(user, token) {
  try {
    if (token) localStorage.setItem(USER_TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(user));
  } catch (e) { console.warn(e); }
  updateUserUI();
}

function clearUserAuth() {
  try {
    localStorage.removeItem(USER_TOKEN_KEY);
    localStorage.removeItem(USER_PROFILE_KEY);
  } catch (e) { console.warn(e); }
  updateUserUI();
}

function updateUserUI() {
  const user = getUserProfile();
  const dot = document.getElementById('userDot');
  if (dot) dot.hidden = !user;
}

function openAuthSheet(onSuccess) {
  let pendingPhone = '';

  function renderPhoneStep() {
    const body = `
      <div class="auth-step" id="authStepPhone">
        <p class="auth-desc">Masuk pakai nomor WhatsApp kamu. Kode OTP 6 digit akan dikirimkan otomatis.</p>
        <div class="row" style="flex-direction:column;align-items:flex-start;gap:6px">
          <label style="font-size:12.5px;font-weight:600">Nomor WhatsApp</label>
          <input type="tel" id="inpAuthPhone" placeholder="Contoh: 081234567890" inputmode="numeric" style="width:100%;font-size:14px">
        </div>
        <button class="btn" id="btnSendOtp" style="width:100%;margin-top:6px">Kirim Kode OTP</button>
      </div>`;

    openSheet('Masuk ke Akun', body, '');

    $('#btnSendOtp')?.addEventListener('click', async () => {
      const ph = ($('#inpAuthPhone')?.value || '').trim();
      if (!ph || ph.length < 9) { toast('Masukkan nomor WhatsApp yang valid'); return; }
      const btn = $('#btnSendOtp');
      btn.disabled = true;
      btn.textContent = 'Mengirim OTP…';
      try {
        const res = await fetch(apiBase('/api/auth/otp'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone: ph }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Gagal meminta OTP');
        pendingPhone = ph;
        toast(d.hint || 'Kode OTP dikirim');
        renderOtpStep();
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
        btn.textContent = 'Kirim Kode OTP';
      }
    });
  }

  function renderOtpStep() {
    const body = `
      <div class="auth-step" id="authStepOtp">
        <p class="auth-desc">Masukkan 6 digit kode OTP yang diterima untuk nomor <strong>${esc(pendingPhone)}</strong>:</p>
        <div style="text-align:center;margin:12px 0">
          <input type="text" id="inpAuthCode" maxlength="6" inputmode="numeric" placeholder="000000" class="auth-otp-input">
        </div>
        <button class="btn" id="btnVerifyOtp" style="width:100%">Verifikasi OTP</button>
        <button class="btn btn-ghost" id="btnBackPhone" style="width:100%;margin-top:8px">← Ganti Nomor</button>
      </div>`;

    openSheet('Verifikasi Kode OTP', body, '');

    $('#btnBackPhone')?.addEventListener('click', renderPhoneStep);
    $('#btnVerifyOtp')?.addEventListener('click', async () => {
      const code = ($('#inpAuthCode')?.value || '').trim();
      if (code.length !== 6) { toast('Masukkan 6 digit kode OTP'); return; }
      const btn = $('#btnVerifyOtp');
      btn.disabled = true;
      btn.textContent = 'Memverifikasi…';
      try {
        const res = await fetch(apiBase('/api/auth/verify'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone: pendingPhone, code }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Kode salah atau kedaluwarsa');
        setUserAuth(d.user, d.token);
        toast(`Selamat datang${d.user?.name ? ', ' + d.user.name : ''}!`);
        closeSheet();
        if (typeof onSuccess === 'function') onSuccess(d.user);
        else openProfileSheet();
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
        btn.textContent = 'Verifikasi OTP';
      }
    });
  }

  renderPhoneStep();
}

function openProfileSheet() {
  const user = getUserProfile();
  if (!user || !getUserToken()) {
    openAuthSheet();
    return;
  }

  const body = `
    <div class="auth-step">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-weight:700;font-size:15px">${esc(user.name || 'Pelanggan')}</div>
          <div style="font-size:12.5px;color:var(--tk-text-muted)">${esc(user.phone || '')}</div>
        </div>
        <span class="user-profile-badge">
          <span class="user-logged-dot"></span> Terhubung
        </span>
      </div>
      <hr style="border:0;border-top:1px solid var(--tk-border);margin:10px 0">
      <div class="row" style="flex-direction:column;align-items:flex-start;gap:6px">
        <label style="font-size:12px;font-weight:600">Nama Penerima</label>
        <input type="text" id="pfName" value="${esc(user.name || '')}" placeholder="Nama lengkap kamu" style="width:100%">
      </div>
      <div class="row" style="flex-direction:column;align-items:flex-start;gap:6px">
        <label style="font-size:12px;font-weight:600">Alamat Pengiriman</label>
        <textarea id="pfAddress" rows="2" placeholder="Nama jalan, nomor rumah, RT/RW, kota" style="width:100%">${esc(user.address || '')}</textarea>
      </div>
      <button class="btn" id="btnSaveProfile" style="width:100%;margin-top:6px">Simpan Profil</button>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
        <button class="btn btn-ghost" id="btnProfileOrders">Pesanan Saya</button>
        <button class="btn btn-ghost" id="btnLogoutUser" style="color:var(--tk-danger)">Keluar Akun</button>
      </div>
    </div>`;

  openSheet('Profil Saya', body, '');

  $('#btnSaveProfile')?.addEventListener('click', async () => {
    const name = ($('#pfName')?.value || '').trim();
    const address = ($('#pfAddress')?.value || '').trim();
    const token = getUserToken();
    try {
      const res = await fetch(apiBase('/api/users/me'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}` },
        body: JSON.stringify({ name, address }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Gagal menyimpan profil');
      const updated = { ...user, name, address };
      setUserAuth(updated, token);
      toast('Profil berhasil disimpan');
    } catch (err) {
      toast(err.message);
    }
  });

  $('#btnProfileOrders')?.addEventListener('click', () => {
    closeSheet();
    setTimeout(openOrders, 150);
  });

  $('#btnLogoutUser')?.addEventListener('click', () => {
    clearUserAuth();
    toast('Telah keluar dari akun');
    closeSheet();
  });
}

/* ============================================================
   Proof Upload Helper
   ============================================================ */

async function uploadProofFile(file, orderNo) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('File terlalu besar (maks 5 MB)'); return; }

  const prev1 = $('#upPrev');
  if (prev1) {
    prev1.hidden = false;
    prev1.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Pratinjau bukti transfer">`;
  }
  const prev2 = $('#trackUpPrev');
  if (prev2) {
    prev2.hidden = false;
    prev2.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Pratinjau bukti transfer" style="max-height:140px;border-radius:6px;object-fit:cover;margin-top:6px">`;
  }

  const fd = new FormData();
  fd.append('proof', file);
  const targetNo = orderNo || state.activeOrder?.orderNo || state.activeOrder?.id || state.activeOrder?.ref;
  if (!targetNo) {
    toast('Nomor pesanan tidak ditemukan');
    return;
  }
  try {
    toast('Mengunggah bukti transfer…');
    const res = await fetch(apiBase(`/api/orders/${encodeURIComponent(targetNo)}/proof`), {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) throw new Error('Gagal mengunggah bukti');
    toast('Bukti diterima — penjual akan memverifikasi');
    document.documentElement.dataset.proofUploaded = 'true';
    if (state.activeOrder) {
      state.activeOrder.stage = 'bayar';
      state.activeOrder.statusLabel = 'Menunggu Verifikasi';
      state.activeOrder.paid = true;
      if ($('#payAccordion')) {
        renderTracking(state.activeOrder, targetNo);
      }
    }
  } catch (err) {
    toast(err.message);
  }
}

/* ============================================================
   Payment
   ============================================================ */

function openPayment(order) {
  state.activeOrder = order;
  const total = Number(order.total) || 0;
  const orderNo = order.ref || order.orderNo || order.id;
  const storeName = CONFIG.store?.name || 'toko ini';
  const method = CONFIG.payment?.method || 'qris';
  const wa = CONFIG.store.whatsapp;
  const waText = encodeURIComponent(
    `Halo ${CONFIG.store.name}, saya sudah pesan.\nNo. pesanan: ${orderNo}\nTotal: ${rupiah(total)}\n\nBukti transfer saya kirim di bawah ini.`
  );

  const payBlock = method === 'qris' ? `
    <div class="qr-box">
      <div class="qr-img">
        ${CONFIG.payment?.qrisImage
          ? `<img src="${esc(CONFIG.payment.qrisImage)}" data-testid="qris-image" alt="QRIS ${esc(storeName)}">`
          : '<span style="font-size:12.5px;color:var(--tk-text-muted);padding:20px;text-align:center">QRIS belum diatur toko.<br>Hubungi penjual untuk cara bayar.</span>'}
      </div>
      <div class="qr-amount">${rupiah(total)}</div>
      <div class="qr-owner">${esc(CONFIG.payment?.qrisOwner || storeName)}</div>
      ${CONFIG.payment?.note ? `<div class="qr-note">${esc(CONFIG.payment.note)}</div>` : ''}
    </div>` : method === 'transfer' ? `
    <div class="qr-box" style="text-align:left">
      <p class="pd-label">Transfer ke</p>
      <div class="copy-row">
        <input type="text" readonly value="${esc(CONFIG.payment?.bank?.account || '-')}">
        <button data-copy="${esc(CONFIG.payment?.bank?.account || '')}">Salin</button>
      </div>
      <div class="tot"><span class="tot-k">Bank</span><span class="tot-v">${esc(CONFIG.payment?.bank?.name || '-')}</span></div>
      <div class="tot"><span class="tot-k">Atas nama</span><span class="tot-v">${esc(CONFIG.payment?.bank?.holder || '-')}</span></div>
      <div class="tot grand"><span class="tot-k">Jumlah</span><span class="tot-v">${rupiah(total)}</span></div>
      ${CONFIG.payment?.note ? `<div class="qr-note" style="margin-top:12px">${esc(CONFIG.payment.note)}</div>` : ''}
    </div>` : `
    <div class="qr-box">
      <p class="state-title">Bayar di tempat</p>
      <p class="state-msg">Siapkan ${rupiah(total)} saat pesanan diantar atau diambil.</p>
    </div>`;

  const body = `
    <div class="tot"><span class="tot-k">No. pesanan</span><span class="tot-v" data-testid="order-no" style="font-weight:600">${esc(orderNo)}</span></div>
    <div class="tot" style="margin-bottom:14px"><span class="tot-k">Status</span><span class="tot-v">${esc(order.statusLabel || 'Menunggu pembayaran')}</span></div>
    <div class="tot" style="margin-bottom:14px"><span class="tot-k">Total</span><span class="tot-v" data-testid="order-total">${rupiah(total)}</span></div>
    ${payBlock}
    ${method !== 'cod' ? `
    <p class="pd-label" style="margin-top:16px">Unggah bukti pembayaran</p>
    <div class="upload" id="upBox" data-testid="proof-upload" role="button" tabindex="0">
      ${icon('up')}
      <div class="upload-t">Pilih foto bukti transfer</div>
      <div class="upload-s">JPG atau PNG, maksimal 5 MB</div>
      <div class="upload-preview" id="upPrev" hidden></div>
    </div>` : ''}
    ${wa ? `<a class="btn btn-ghost" style="display:grid;place-items:center;margin-top:12px;text-decoration:none" href="https://wa.me/${cleanWa(wa)}?text=${waText}" target="_blank" rel="noopener">Konfirmasi lewat WhatsApp</a>` : ''}
    <button class="btn btn-ghost" id="btnTrack" style="margin-top:8px">Lacak pesanan ini</button>`;

  openSheet('Pesanan Dibuat', body, `
    <button class="btn" id="btnDonePay">Selesai</button>
  `);

  $('#btnDonePay')?.addEventListener('click', closeSheet);
  $('#btnTrack')?.addEventListener('click', () => openTracking(orderNo));

  document.querySelectorAll('[data-copy]').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Disalin'); }
      catch { toast('Gagal menyalin'); }
    });
  });

  $('#upBox')?.addEventListener('click', () => {
    state.activeOrder = order;
    const pick = $('#filePick');
    pick.value = '';
    pick.click();
  });
}

/* ============================================================
   Tracking
   ============================================================ */

/** The six stages a Payu order moves through, in order. */
const STAGES = [
  { id: 'baru',        label: 'Pesanan diterima' },
  { id: 'bayar',       label: 'Pembayaran diverifikasi' },
  { id: 'siap',        label: 'Sedang disiapkan' },
  { id: 'kirim',       label: 'Dalam pengiriman' },
  { id: 'tiba',        label: 'Pesanan tiba' },
  { id: 'selesai',     label: 'Selesai' },
];

function openTracking(orderNo) {
  openSheet('Lacak Pesanan', `
    <div class="state">
      ${icon('truck')}
      <p class="state-title">Memuat status…</p>
    </div>`);

  fetch(apiBase(`/api/orders/${encodeURIComponent(orderNo)}`), { headers: { accept: 'application/json' } })
    .then((r) => r.ok ? r.json() : null)
    .then((order) => {
      if (!order || order.error) renderTracking(null, orderNo);
      else renderTracking(order, orderNo);
    })
    .catch(() => renderTracking(null, orderNo));
}

function renderTracking(order, orderNo) {
  const no = order?.orderNo || order?.id || orderNo;
  if (!order) {
    $('#sheetBody').innerHTML = `
      <div class="state">
        ${icon('box')}
        <p class="state-title">Pesanan tidak ditemukan</p>
        <p class="state-msg">Cek nomor pesanan kamu, atau tanya langsung ke penjual lewat chat.</p>
      </div>`;
    return;
  }

  state.activeOrder = order;
  const currentIdx = Math.max(0, STAGES.findIndex((s) => s.id === (order.stage || 'baru')));
  const history = new Map((order.history || []).map((h) => [h.stage, h.at]));

  // Is payment still pending? (Stage is baru or unpaid)
  const isUnpaid = currentIdx === 0 && !order.paid && (order.stage === 'baru' || order.status === 'PesananBaru');
  const total = Number(order.total) || 0;
  const storeName = CONFIG.store?.name || 'toko ini';
  const method = CONFIG.payment?.method || 'qris';
  const wa = CONFIG.store.whatsapp;
  const waText = encodeURIComponent(
    `Halo ${CONFIG.store.name}, saya konfirmasi pembayaran pesanan: ${no}\nTotal: ${rupiah(total)}`
  );

  const payBlock = method === 'qris' ? `
    <div class="qr-box">
      <div class="qr-img">
        ${CONFIG.payment?.qrisImage
          ? `<img src="${esc(CONFIG.payment.qrisImage)}" data-testid="qris-image" alt="QRIS ${esc(storeName)}">`
          : '<span style="font-size:12.5px;color:var(--tk-text-muted);padding:20px;text-align:center">QRIS belum diatur toko.<br>Hubungi penjual untuk cara bayar.</span>'}
      </div>
      <div class="qr-amount">${rupiah(total)}</div>
      <div class="qr-owner">${esc(CONFIG.payment?.qrisOwner || storeName)}</div>
      ${CONFIG.payment?.note ? `<div class="qr-note">${esc(CONFIG.payment.note)}</div>` : ''}
    </div>` : method === 'transfer' ? `
    <div class="qr-box" style="text-align:left">
      <p class="pd-label">Transfer ke</p>
      <div class="copy-row">
        <input type="text" readonly value="${esc(CONFIG.payment?.bank?.account || '-')}">
        <button data-copy="${esc(CONFIG.payment?.bank?.account || '')}">Salin</button>
      </div>
      <div class="tot"><span class="tot-k">Bank</span><span class="tot-v">${esc(CONFIG.payment?.bank?.name || '-')}</span></div>
      <div class="tot"><span class="tot-k">Atas nama</span><span class="tot-v">${esc(CONFIG.payment?.bank?.holder || '-')}</span></div>
      <div class="tot grand"><span class="tot-k">Jumlah</span><span class="tot-v">${rupiah(total)}</span></div>
      ${CONFIG.payment?.note ? `<div class="qr-note" style="margin-top:12px">${esc(CONFIG.payment.note)}</div>` : ''}
    </div>` : `
    <div class="qr-box">
      <p class="state-title">Bayar di tempat</p>
      <p class="state-msg">Siapkan ${rupiah(total)} saat pesanan diantar atau diambil.</p>
    </div>`;

  const payAccordionHtml = isUnpaid ? `
    <div class="pay-accordion open" id="payAccordion">
      <div class="pay-accordion-head" id="payAccordionToggle">
        <div class="pay-accordion-title">
          <span class="pay-accordion-badge">Belum Bayar</span>
          <span>QRIS &amp; Cara Bayar</span>
        </div>
        <svg class="pay-accordion-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
      </div>
      <div class="pay-accordion-body" id="payAccordionBody">
        ${payBlock}
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
          ${method !== 'cod' ? `
          <button class="btn btn-ghost" id="trackUploadBtn" style="display:flex;align-items:center;justify-content:center;gap:8px">
            ${icon('up')} <span>Unggah Bukti Transfer</span>
          </button>
          <div class="upload-preview" id="trackUpPrev" hidden style="margin-top:6px"></div>
          ` : ''}
          ${wa ? `<a class="btn btn-ghost" style="display:grid;place-items:center;text-decoration:none" href="https://wa.me/${cleanWa(wa)}?text=${waText}" target="_blank" rel="noopener">Konfirmasi via WhatsApp</a>` : ''}
          <button class="btn" id="trackFullPayBtn" style="margin-top:2px">Buka Lembar Pembayaran Lengkap</button>
        </div>
      </div>
    </div>` : `
    <div class="pay-verified-banner">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <span>Pembayaran Telah Diverifikasi Penjual</span>
    </div>`;

  $('#sheetBody').innerHTML = `
    <div class="tot"><span class="tot-k">No. pesanan</span><span class="tot-v" data-testid="order-no" style="font-weight:600">${esc(no)}</span></div>
    <div class="tot" style="margin-bottom:12px"><span class="tot-k">Total</span><span class="tot-v" data-testid="order-total" style="font-weight:600">${rupiah(order.total)}</span></div>
    ${payAccordionHtml}
    <ul class="tl">
      ${STAGES.map((s, i) => {
        const done = i <= currentIdx;
        const cls = done && i < STAGES.length - 1 ? 'done' : i === currentIdx ? 'now' : '';
        const at = history.get(s.id);
        return `<li class="${cls}" data-testid="track-stage" data-done="${done ? 'true' : 'false'}" data-state="${done ? 'done' : 'todo'}">
          <div class="tl-t">${esc(s.label)}</div>
          ${at ? `<div class="tl-d">${esc(new Date(at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }))}</div>` : ''}
        </li>`;
      }).join('')}
    </ul>`;

  $('#payAccordionToggle')?.addEventListener('click', () => {
    $('#payAccordion')?.classList.toggle('open');
  });
  $('#trackFullPayBtn')?.addEventListener('click', () => openPayment(order));
  $('#trackUploadBtn')?.addEventListener('click', () => {
    state.activeOrder = order;
    const pick = $('#filePick');
    pick.value = '';
    pick.click();
  });
  document.querySelectorAll('[data-copy]').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Disalin'); }
      catch { toast('Gagal menyalin'); }
    });
  });
}

/* ============================================================
   Orders list
   ============================================================ */

function openOrders() {
  openSheet('Pesanan Saya', `
    <div class="state">
      ${icon('truck')}
      <p class="state-title">Memuat…</p>
    </div>`);

  const token = getUserToken();
  const headers = { accept: 'application/json' };
  if (token) headers['authorization'] = `Bearer ${token}`;

  const fetchUrl = token ? apiBase('/api/orders/me') : apiBase('/api/orders?limit=20');

  fetch(fetchUrl, { headers })
    .then((r) => r.ok ? r.json() : { orders: [] })
    .catch(() => ({ orders: [] }))
    .then((data) => {
      let list = Array.isArray(data) ? data : (data.orders || []);
      let localList = [];
      try { localList = JSON.parse(localStorage.getItem('tokokit.my_orders') || '[]'); } catch { localList = []; }

      // Gabungkan riwayat server & lokal tanpa duplikat
      const seen = new Set();
      const combined = [];
      for (const o of [...list, ...localList]) {
        const key = o.ref || o.orderNo || o.id;
        if (key && !seen.has(key)) {
          seen.add(key);
          combined.push(o);
        }
      }
      list = combined;

      if (!list.length) {
        $('#sheetBody').innerHTML = `
          <div class="state">
            ${icon('box')}
            <p class="state-title">Belum ada pesanan</p>
            <p class="state-msg">Pesanan yang kamu buat di perangkat ini akan muncul di sini.</p>
            ${!token ? `<button class="btn btn-ghost" id="btnOrdersLogin" style="margin-top:12px">Masuk untuk Lihat Riwayat Akun</button>` : ''}
          </div>`;
        $('#btnOrdersLogin')?.addEventListener('click', () => openAuthSheet(() => openOrders()));
        return;
      }

      $('#sheetBody').innerHTML = `
        ${!token ? `
        <div style="background:var(--tk-surface-alt);padding:10px 12px;border-radius:var(--tk-radius-sm);margin-bottom:12px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;color:var(--tk-text-muted)">Sinkronkan pesanan antar HP?</span>
          <button class="btn btn-ghost" id="btnSyncLogin" style="font-size:12px;padding:4px 10px">Masuk Akun</button>
        </div>` : ''}
        ${list.map((o) => {
          const isUnpaid = (o.stage === 'baru' || o.status === 'PesananBaru' || o.status === 'MenungguBayar') && !o.paid;
          return `
          <div class="row" style="width:100%;border:0;border-bottom:1px solid var(--tk-border);background:transparent;padding:12px 0;display:flex;align-items:center;justify-content:space-between">
            <div class="row-main" data-track="${esc(o.orderNo || o.id || o.ref)}" style="cursor:pointer;flex:1">
              <div class="row-name" style="font-weight:600">${esc(o.orderNo || o.id || o.ref)}</div>
              <div class="tl-d">${esc((o.items || []).map((i) => i.name).slice(0, 2).join(', ') || '')}</div>
            </div>
            <div style="text-align:right">
              <div class="row-price" style="font-weight:600">${rupiah(o.total)}</div>
              <div class="tl-d" style="font-size:11.5px">${esc(o.statusLabel || (isUnpaid ? 'Menunggu Pembayaran' : 'Diproses'))}</div>
              ${isUnpaid ? `<button class="btn-sm-pay" data-pay-order="${esc(o.orderNo || o.id || o.ref)}">Bayar QRIS</button>` : ''}
            </div>
          </div>`;
        }).join('')}`;

      $('#btnSyncLogin')?.addEventListener('click', () => openAuthSheet(() => openOrders()));

      $('#sheetBody').addEventListener('click', (e) => {
        const payBtn = e.target.closest('[data-pay-order]');
        if (payBtn) {
          const ordId = payBtn.dataset.payOrder;
          const found = list.find(x => (x.orderNo || x.id || x.ref) === ordId);
          if (found) { openPayment(found); return; }
        }
        const b = e.target.closest('[data-track]');
        if (b) openTracking(b.dataset.track);
      });
    })
    .catch(() => {
      $('#sheetBody').innerHTML = `
        <div class="state">
          ${icon('box')}
          <p class="state-title">Gagal memuat pesanan</p>
          <p class="state-msg">Coba lagi sebentar.</p>
        </div>`;
    });
}

/* ============================================================
   Chat with Live Admin CS & Bot Sync
   ============================================================ */

function getChatId() {
  let cid = localStorage.getItem('tokokit.chat_id');
  if (!cid) {
    cid = 'chat_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
    localStorage.setItem('tokokit.chat_id', cid);
  }
  return cid;
}

const chat = {
  open: false,
  log: [],
  busy: false,
  pollTimer: null,
  renderedIds: new Set(),
};

function scrollChatToBottom(smooth = false) {
  const body = $('#chatBody');
  if (!body) return;
  requestAnimationFrame(() => {
    body.scrollTop = body.scrollHeight;
    if (body.lastElementChild) {
      body.lastElementChild.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
    }
  });
}

async function openChat() {
  chat.open = true;
  $('#chatFab').hidden = true;
  $('#chatPanel').hidden = false;
  renderQuick();
  setTimeout(() => {
    $('#chatText').focus();
    scrollChatToBottom();
  }, 100);

  // Load chat history from server
  await fetchChatHistory();
  scrollChatToBottom();

  // Start real-time polling every 4 seconds
  if (chat.pollTimer) clearInterval(chat.pollTimer);
  chat.pollTimer = setInterval(pollChatReplies, 4000);
}

function closeChat() {
  chat.open = false;
  $('#chatPanel').hidden = true;
  $('#chatFab').hidden = CONFIG.chat.enabled === false;
  if (chat.pollTimer) {
    clearInterval(chat.pollTimer);
    chat.pollTimer = null;
  }
  const bnavChat = document.getElementById('bnavChat');
  if (bnavChat && bnavChat.classList.contains('active')) {
    setBnavActive('bnavHome');
  }
}

async function fetchChatHistory() {
  const cid = getChatId();
  try {
    const res = await fetch(apiBase(`/api/chat/${encodeURIComponent(cid)}`));
    if (res.ok) {
      const data = await res.json();
      const msgs = data.chat?.messages || [];
      if (msgs.length) {
        renderFullChat(msgs);
        return;
      }
    }
  } catch (err) {
    console.warn('Chat fetch history error:', err);
  }
  if (!chat.renderedIds.size) {
    say('shop', CONFIG.chat.greeting || `Halo! Selamat datang di ${CONFIG.store.name}. Silakan tinggalkan pesan, admin kami akan segera merespon.`);
  }
}

async function pollChatReplies() {
  if (!chat.open) return;
  const cid = getChatId();
  try {
    const res = await fetch(apiBase(`/api/chat/${encodeURIComponent(cid)}`));
    if (!res.ok) return;
    const data = await res.json();
    const msgs = data.chat?.messages || [];
    let added = false;
    for (const m of msgs) {
      const msgId = m.id || (m.at + '-' + m.role);
      if (!chat.renderedIds.has(msgId)) {
        chat.renderedIds.add(msgId);
        const who = m.role === 'user' ? 'me' : 'shop';
        renderMessageBubble(who, m.content, m.at, m.byAdmin);
        added = true;
      }
    }
    if (added) {
      scrollChatToBottom(true);
    }
  } catch (e) {
    // silent
  }
}

function renderFullChat(messages) {
  const body = $('#chatBody');
  body.innerHTML = '';
  chat.renderedIds.clear();
  for (const m of messages) {
    const msgId = m.id || (m.at + '-' + m.role);
    chat.renderedIds.add(msgId);
    const who = m.role === 'user' ? 'me' : 'shop';
    renderMessageBubble(who, m.content, m.at, m.byAdmin);
  }
  scrollChatToBottom();
}

function renderMessageBubble(who, text, at, byAdmin) {
  const body = $('#chatBody');
  const el = document.createElement('div');
  el.className = `bub bub-${who}`;
  el.dataset.testid = 'chat-bubble';
  el.dataset.who = who;
  const time = at
    ? new Date(at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  const adminTag = byAdmin
    ? `<span class="chat-msg-admin-badge"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:3px"><polyline points="20 6 9 17 4 12"/></svg>Admin CS</span>`
    : '';

  el.innerHTML = `${adminTag}${esc(text).replace(/\n/g, '<br>')}<span class="bub-time">${time}</span>`;

  if ((who === 'shop' || who === 'sys') && /wa\.me|WhatsApp/i.test(text)) {
    const wa = CONFIG.store.whatsapp;
    if (wa) {
      const a = document.createElement('a');
      a.className = 'chat-wa';
      a.dataset.testid = 'chat-wa-link';
      a.href = `https://wa.me/${cleanWa(wa)}`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = `Chat WhatsApp ${wa}`;
      a.style.cssText = 'display:inline-block;margin-top:6px;font-size:13px;text-decoration:underline';
      el.insertBefore(a, el.querySelector('.bub-time'));
    }
  }
  body.appendChild(el);
}

function say(who, text, byAdmin) {
  const pseudoId = 'local_' + Date.now();
  chat.renderedIds.add(pseudoId);
  renderMessageBubble(who, text, Date.now(), byAdmin);
  scrollChatToBottom();
}

function renderQuick() {
  const q = CONFIG.chat.quickReplies || [];
  const box = $('#chatQuick');
  const wa = CONFIG.store.whatsapp;
  const waLink = wa ? `<a class="chip" data-testid="chat-wa-link" href="https://wa.me/${cleanWa(wa)}" target="_blank" rel="noopener">Chat WhatsApp Penjual</a>` : '';

  box.innerHTML = q.map((t) => `<button data-quick="${esc(t)}">${esc(t)}</button>`).join('') + waLink;
  box.hidden = !q.length && !waLink;
}

async function sendChat(text) {
  const msg = (text || '').trim();
  if (!msg || chat.busy) return;

  say('me', msg);
  $('#chatText').value = '';
  chat.busy = true;
  $('#chatSend').disabled = true;
  scrollChatToBottom();

  const user = getUserProfile();
  const cid = getChatId();

  try {
    const res = await fetch(apiBase('/api/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: cid,
        message: msg,
        customer: user ? { name: user.name || '', phone: user.phone || '' } : undefined,
        userToken: getUserToken() || undefined,
        storeId: CONFIG.admin?.storeId || '',
        cart: cartItems().map((i) => ({ name: i.name, qty: i.qty })),
      }),
    });
    const data = await res.json();
    const chatObj = data.chat || {};
    const msgs = chatObj.messages || [];
    if (msgs.length) {
      for (const m of msgs) {
        const msgId = m.id || (m.at + '-' + m.role);
        if (!chat.renderedIds.has(msgId)) {
          chat.renderedIds.add(msgId);
          const who = m.role === 'user' ? 'me' : 'shop';
          renderMessageBubble(who, m.content, m.at, m.byAdmin);
        }
      }
      scrollChatToBottom();
    }
  } catch {
    const wa = CONFIG.store.whatsapp;
    if (wa) {
      say('sys', `Pesan belum terkirim. Anda juga bisa hubungi WhatsApp: ${wa}`);
    } else {
      say('sys', 'Gagal mengirim pesan. Silakan periksa koneksi internet Anda.');
    }
  } finally {
    chat.busy = false;
    $('#chatSend').disabled = false;
    $('#chatText').focus();
    scrollChatToBottom();
  }
}

/* ============================================================
   Events
   ============================================================ */
const setBnavActive = (id) => {
  document.querySelectorAll('.toko-nav-item').forEach(btn => btn.classList.toggle('active', btn.id === id));
};

function wireGlobal() {
  $('#grid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-pid]');
    if (card) openProduct(card.dataset.pid);
  });

  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    state.filter.category = chip.dataset.cat;
    renderChips();
    renderCatalog();
  });

  let searchTimer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => {
      state.filter.q = v;
      renderCatalog();
    }, 220);
  });
  document.getElementById('bnavHome')?.addEventListener('click', () => {
    if (chat.open) closeChat();
    setBnavActive('bnavHome');
    state.filter.category = '';
    state.filter.q = '';
    const qEl = document.getElementById('q');
    if (qEl) qEl.value = '';
    renderChips();
    renderCatalog();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.getElementById('bnavCats')?.addEventListener('click', () => {
    if (chat.open) closeChat();
    setBnavActive('bnavCats');
    const c = document.getElementById('chips');
    if (c) {
      c.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('Pilih kategori di atas');
    }
  });

  document.getElementById('bnavCart')?.addEventListener('click', () => {
    if (chat.open) closeChat();
    setBnavActive('bnavCart');
    openCart();
  });

  document.getElementById('bnavOrders')?.addEventListener('click', () => {
    if (chat.open) closeChat();
    setBnavActive('bnavOrders');
    openOrders();
  });

  document.getElementById('bnavChat')?.addEventListener('click', () => {
    if (chat.open) {
      closeChat();
      setBnavActive('bnavHome');
    } else {
      setBnavActive('bnavChat');
      openChat();
    }
  });

  $('#btnCart').addEventListener('click', openCart);
  $('#btnOrders').addEventListener('click', openOrders);
  $('#btnUser')?.addEventListener('click', () => {
    if (getUserToken()) openProfileSheet();
    else openAuthSheet();
  });
  updateUserUI();

  const pick = $('#filePick');
  if (pick) {
    pick.onchange = () => {
      if (pick.files?.[0]) uploadProofFile(pick.files[0]);
    };
  }

  $('#sheetClose').addEventListener('click', closeSheet);
  $('#scrim').addEventListener('click', closeSheet);
  $('#chatFab').addEventListener('click', openChat);
  $('#chatClose').addEventListener('click', closeChat);

  $('#chatSend').addEventListener('click', () => sendChat($('#chatText').value));
  $('#chatText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat($('#chatText').value); }
  });
  $('#chatText').addEventListener('focus', () => {
    setTimeout(() => scrollChatToBottom(true), 250);
  });
  $('#chatQuick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-quick]');
    if (b) sendChat(b.dataset.quick);
  });

  // Sheet body holds cart controls, which get re-rendered on every change.
  $('#sheetBody').addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    const del = e.target.closest('[data-del]');
    if (inc) {
      const id = inc.dataset.inc;
      setQty(id, (state.cart.find((i) => i.id === id)?.qty || 0) + 1);
    } else if (dec) {
      const id = dec.dataset.dec;
      setQty(id, (state.cart.find((i) => i.id === id)?.qty || 0) - 1);
    } else if (del) {
      setQty(del.dataset.del, 0);
      toast('Dihapus dari keranjang');
    }
  });

  $('#sheetBody').addEventListener('input', (e) => {
    if (e.target.id === 'cAddr') refreshQuote();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (chat.open) closeChat();
    else if (!$('#sheet').hidden) closeSheet();
  });

  window.addEventListener('popstate', () => {
    if (chat.open) closeChat();
    else if (!$('#sheet').hidden) closeSheet();
  });
}


/* ============================================================
   Test hooks
   ============================================================

   Every element the verification script drives gets a stable
   data-testid. Querying a stable hook means "the badge element is
   gone" fails the check, instead of a real bug being hidden behind
   a selector that silently matched nothing.
   ============================================================ */

function addTestHooks() {
  const put = (el, name) => { if (el && !el.dataset.testid) el.dataset.testid = name; };

  put($('#hdrName'), 'store-name');
  put($('#grid'), 'product-grid');
  put($('#chips'), 'category-chips');
  put($('#cartBadge'), 'cart-badge');
  put($('#btnCart'), 'nav-cart');
  put($('#btnOrders'), 'nav-orders');
  put($('#chatFab'), 'chat-fab');
  put($('#chatPanel'), 'chat-panel');
  put($('#chatBody'), 'chat-body');
  put($('#chatText'), 'chat-input');
  put($('#chatSend'), 'chat-send');
  put($('#chatQuick'), 'chat-quick');
  put($('#sheetBody'), 'sheet-body');
  put($('#sheetTitle'), 'sheet-title');
  put($('#sheetFoot'), 'sheet-foot');

  document.querySelectorAll('.chip').forEach((c) => {
    put(c, 'category-chip');
    c.dataset.active = String(c.classList.contains('on') || c.getAttribute('aria-pressed') === 'true');
  });

  document.querySelectorAll('.card').forEach((c) => put(c, 'product-card'));
  document.querySelectorAll('.card-name').forEach((n) => put(n, 'product-name'));
  document.querySelectorAll('.card-price').forEach((p) => put(p, 'product-price'));
  document.querySelectorAll('.ship-opt, [data-shipping-option]').forEach((o) => put(o, 'shipping-option'));
  document.querySelectorAll('.tl li').forEach((t) => {
    put(t, 'track-stage');
    t.dataset.state = t.classList.contains('done') ? 'done' : t.classList.contains('now') ? 'now' : 'todo';
  });
  document.querySelectorAll('.field input, .field textarea').forEach((f) => {
    if (f.id === 'cName') put(f, 'customer-name');
    else if (f.id === 'cPhone') put(f, 'customer-phone');
    else if (f.id === 'cAddr') put(f, 'customer-address');
  });
  put($('#placeOrder'), 'place-order');
  put($('#shipCost'), 'shipping-cost');
  put($('#grandTotal'), 'grand-total');
  put($('#upBox'), 'proof-upload');
  put($('#qrImg') || document.querySelector('.qr-img img'), 'qris-image');
  put($('#toast'), 'toast');
  // Tracking diakses lewat nomor pesanan; tombol pintasnya ditandai agar
  // verifikasi bisa menemukannya tanpa bergantung pada teks tombol.
  document.querySelectorAll('button').forEach((b) => {
    const t = (b.textContent || '').toLowerCase();
    if (/lacak|tracking|status pesanan/.test(t)) put(b, 'nav-track');
  });
}

// Re-run after every render that can introduce new nodes.
const _renderCatalog = renderCatalog;
renderCatalog = function (...a) { const r = _renderCatalog.apply(this, a); addTestHooks(); return r; };
const _renderChips = renderChips;
renderChips = function (...a) { const r = _renderChips.apply(this, a); addTestHooks(); return r; };
const _openSheet = openSheet;
openSheet = function (...a) { const r = _openSheet.apply(this, a); addTestHooks(); return r; };
const openCartBase = openCart;
function openCartWrapped() {
  const r = openCartBase.apply(this, arguments);
  addTestHooks();
  // The footer button opens checkout only when the cart can be paid for;
  // tagging it here keeps that affordance discoverable by data-testid.
  // openSheet menulis DOM di dalam openCartBase, jadi tandai setelah itu.
  const set = (sel, name, prop = 'testid') => {
    const el = document.querySelector(sel);
    if (el) el.dataset[prop] = name;
  };
  set('#toCheckout', 'to-checkout');
  set('#sheetFoot .tot-v', 'cart-subtotal');
  return r;
}
openCart = openCartWrapped;

const _boot = boot;
boot = async function () { await _boot(); addTestHooks(); };

// Start the storefront (after the test wrappers are in place).
boot();
