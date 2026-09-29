/* Setia Jaya Teknik — Landing Page Logic
 * - Real catalog integration from /toko-api/catalog
 * - Direct deep links to /toko-kit/toko/?p={id}
 * - 3-Second Cinematic Splash Screen with real-time status updates
 * - Interactive Shipping Cost Calculator
 * - Clean mobile navigation
 */

const API = '/toko-api';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const rupiah = (n) => 'Rp ' + (Math.round(Number(n) || 0)).toLocaleString('id-ID');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let products = [];
let categories = [];
let settings = {};

/* Best seller staple IDs in Setia Jaya Teknik */
const BEST_SELLER_IDS = [
  'sjt-cut-107',       // Mata Gerinda Potong 107 mm
  'sjt-las-inverter',   // Mesin Las Inverter 450W
  'sjt-elektroda-27',   // Kawat Las Elektroda 2.7 mm 1kg
  'sjt-gerinda-tangan', // Mesin Gerinda Tangan 4 Inci
  'sjt-winch-24',       // Kunci Pas Ratchet Set 24 Pcs
  'sjt-tang-ampere',    // Tang Ampere Digital
  'sjt-bor-duduk',      // Mesin Bor Duduk 13 mm
  'sjt-mata-bor',       // Mata Bor Besi HSS 10 Pcs
];

/* ---------- Featured Real Best-Selling Products Grid ---------- */
function renderFeaturedGrid() {
  const grid = $('#liveProdGrid');
  if (!grid) return;

  if (!products.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--ink-dim)">Memuat etalase produk...</div>`;
    return;
  }

  // Prioritize real best sellers
  const sorted = [...products].sort((a, b) => {
    const idxA = BEST_SELLER_IDS.indexOf(a.id);
    const idxB = BEST_SELLER_IDS.indexOf(b.id);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return 0;
  });

  const featured = sorted.slice(0, 8);

  grid.innerHTML = featured.map(p => {
    const isBestSeller = BEST_SELLER_IDS.includes(p.id);
    const isOut = p.stock !== null && p.stock !== undefined && Number(p.stock) <= 0;
    const isLow = p.stock !== null && p.stock !== undefined && Number(p.stock) > 0 && Number(p.stock) <= 5;
    const stockBadge = isOut ? 'Habis' : isLow ? `Sisa ${p.stock}` : `Stok Ready (${p.stock || 'Banyak'})`;

    return `
      <div class="prod-card" style="display:flex;flex-direction:column;">
        <div class="prod-shot">
          ${isBestSeller 
            ? `<span class="prod-badge-tag" style="background:#d97706;color:#fff;font-weight:700">★ TERLARIS</span>` 
            : `<span class="prod-badge-tag">${esc(p.category || 'Alat Teknik')}</span>`}
          <img src="${esc(p.image || '/toko-kit/img/tools/gerinda-potong.svg')}" alt="${esc(p.name)}" loading="lazy">
        </div>
        <div class="prod-body" style="display:flex;flex-direction:column;flex:1;">
          <span class="prod-cat-tag">${esc(p.category || 'Alat Bengkel')}</span>
          <h4 class="prod-title">${esc(p.name)}</h4>
          <p class="prod-desc-brief">${esc(p.description || '')}</p>
          <div class="prod-meta-row" style="margin-top:auto;margin-bottom:14px;">
            <div class="prod-price">${rupiah(p.price)}</div>
            <div class="prod-stock-lbl ${isLow || isOut ? 'low' : ''}">${stockBadge}</div>
          </div>
          <div class="prod-btn-row">
            <a href="./toko/?p=${encodeURIComponent(p.id)}" class="btn btn-primary" style="width:100%;display:flex;align-items:center;justify-content:center;gap:7px;padding:8px 12px;font-size:12.5px;font-weight:600">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              ${isOut ? 'Lihat Detail di Toko' : 'Beli di Toko Online'}
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* ---------- Interactive Shipping Calculator ---------- */
function initShippingCalc() {
  const areaSelect = $('#calcAreaSelect');
  const srvSelect = $('#calcServiceSelect');
  const btn = $('#btnHitungOngkir');
  if (!areaSelect || !srvSelect || !btn) return;

  function hitung() {
    const opt = areaSelect.selectedOptions[0];
    const km = Number(opt.dataset.km || 5);
    const time = opt.dataset.time || '1 Jam';
    const srv = srvSelect.value;

    let cost = 0;
    if (srv === 'ambil') {
      cost = 0;
    } else if (srv === 'instan') {
      cost = Math.max(15000, km * 3000);
    } else {
      // Reguler sameday
      cost = km <= 8 ? 10000 : 10000 + (km - 8) * 2000;
    }

    const freeMin = 500000;
    const elKm = $('#resKm');
    const elTime = $('#resTime');
    const elCost = $('#resCost');
    if (elKm) elKm.textContent = km + ' km';
    if (elTime) elTime.textContent = time;
    if (elCost) elCost.textContent = cost === 0 ? 'GRATIS' : rupiah(cost);
  }

  btn.addEventListener('click', hitung);
  areaSelect.addEventListener('change', hitung);
  srvSelect.addEventListener('change', hitung);
}

/* ---------- Mobile Drawer Navigation ---------- */
function initMobileNav() {
  const nav = $('#mobNav');
  const openBtn = $('#mobNavToggle');
  const closeBtn = $('#closeMobNav');
  if (!nav || !openBtn) return;

  openBtn.addEventListener('click', () => { nav.classList.add('open'); document.body.style.overflow = 'hidden'; });
  if (closeBtn) closeBtn.addEventListener('click', () => { nav.classList.remove('open'); document.body.style.overflow = ''; });
  nav.addEventListener('click', (e) => {
    if (e.target === nav) { nav.classList.remove('open'); document.body.style.overflow = ''; }
  });
  nav.querySelectorAll('.mob-link').forEach(link => {
    link.addEventListener('click', () => { nav.classList.remove('open'); document.body.style.overflow = ''; });
  });
}

function tutupSplash() {
  const s = document.getElementById('splash');
  if (!s || s.classList.contains('gone')) return;
  s.classList.add('gone');
  setTimeout(() => { if (s && s.parentNode) s.remove(); }, 650);
}

/* ---------- Data Bootstrapping ---------- */
async function boot() {
  const startTime = Date.now();
  const yr = $('#footYr');
  if (yr) yr.textContent = new Date().getFullYear();

  initShippingCalc();
  initMobileNav();

  // Status updates during 3-second cinematic splash
  setTimeout(() => {
    const st = document.getElementById('splashStatus');
    if (st) st.textContent = 'Menghubungkan inventaris gudang Cikupa...';
  }, 1000);
  setTimeout(() => {
    const st = document.getElementById('splashStatus');
    if (st) st.textContent = 'Menyiapkan etalase 500+ alat teknik...';
  }, 2000);
  setTimeout(() => {
    const st = document.getElementById('splashStatus');
    if (st) {
      st.textContent = 'Selesai! Menampilkan halaman toko...';
      st.style.color = '#60a5fa';
    }
  }, 2750);

  // Load public settings
  try {
    const res = await fetch(`${API}/settings-public`);
    if (res.ok) {
      const data = await res.json();
      settings = data.settings || {};

      // Dynamic Single Source of Truth updates on Landing Page
      if (settings.storeName) {
        $$('.brand-name').forEach(el => { el.textContent = settings.storeName; });
        const ovTitle = $('.overlay-title');
        if (ovTitle) ovTitle.textContent = `${settings.storeName} · Gerai Resmi`;
      }
      if (settings.storeDesc) {
        $$('.brand-tag').forEach(el => { el.textContent = settings.storeDesc; });
      }
      if (settings.address || settings.city || settings.hours) {
        const ovSub = $('.overlay-sub');
        if (ovSub) {
          ovSub.textContent = `${settings.address || ''}${settings.city ? ', ' + settings.city : ''} · ${settings.hours || ''}`;
        }
      }
      if (settings.waPublic) {
        const waNum = String(settings.waPublic).replace(/[^0-9]/g, '');
        const storeName = settings.storeName || 'Toko';
        const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(`Halo ${storeName}, saya mau tanya stok dan info produk.`)}`;
        $$('a[href*="wa.me"]').forEach(a => { a.href = waUrl; });
      }
    }
  } catch (err) {
    console.warn('[landing] Gagal memuat settings-public:', err);
  }

  // Load catalog
  try {
    const res = await fetch(`${API}/catalog`);
    if (!res.ok) throw new Error('Status ' + res.status);
    const data = await res.json();
    const raw = Array.isArray(data) ? data : (data.products || []);
    products = raw.filter(p => p.active !== false);
    categories = [...new Set(products.map(p => p.category).filter(Boolean))];

    const countEl = $('#heroStatCount');
    if (countEl) countEl.textContent = products.length >= 50 ? `${products.length}+` : '500+';
  } catch (err) {
    console.warn('[landing] Gagal memuat live catalog:', err);
  }

  renderFeaturedGrid();

  // Allow click to skip splash screen
  const splash = $('#splash');
  if (splash) {
    splash.addEventListener('click', tutupSplash);
    splash.style.cursor = 'pointer';
  }

  // Smooth cinematic presentation without excessive delay
  const elapsed = Date.now() - startTime;
  if (elapsed < 1200) {
    await new Promise(r => setTimeout(r, 1200 - elapsed));
  }
  tutupSplash();
}

boot();

setTimeout(tutupSplash, 2000);
