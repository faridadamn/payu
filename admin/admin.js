/* Panel admin Setia Jaya Teknik — Toko Kit.
 *
 * Aturan:
 * - Token disimpan di localStorage perangkat, TIDAK pernah ditanam di HTML.
 * - Harga & stok disimpan per baris; tidak ada "simpan semua" yang menimpa.
 * - Tab pesanan langsung menampilkan rincian barang, total, status, dan link WhatsApp.
 * - Full responsive: Sidebar permanen di desktop + drawer di mobile + Bottom Navbar di layar HP.
 */

const API = '/toko-api';
const TOKEN_KEY = 'tokokit.admin.token';

const PRESETS = [
  { id: 'slate-blue', label: 'Slate Blue (Utama)', bg: '#F5F7FA', primary: '#1D4ED8', ratio: 6.3 },
  { id: 'warm-paper', label: 'Warm Paper', bg: '#F7F5F0', primary: '#C2410C', ratio: 5.1 },
  { id: 'graphite',   label: 'Graphite',   bg: '#F4F4F5', primary: '#3F3F46', ratio: 10.4 },
  { id: 'espresso',   label: 'Espresso',   bg: '#FAF6F1', primary: '#6B3F1D', ratio: 8.2 },
  { id: 'forest',     label: 'Forest',     bg: '#F4F7F4', primary: '#166534', ratio: 7.4 },
  { id: 'plum',       label: 'Plum',       bg: '#F8F4F8', primary: '#7E22CE', ratio: 6.5 },
  { id: 'terracotta', label: 'Terracotta', bg: '#FBF6F2', primary: '#9A3412', ratio: 7.1 },
  { id: 'mono',       label: 'Mono',       bg: '#FFFFFF', primary: '#111111', ratio: 18.9 },
];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const rupiah = (n) => 'Rp ' + (Math.round(Number(n) || 0)).toLocaleString('id-ID');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let token = localStorage.getItem(TOKEN_KEY) || '';
let products = [];
let settings = {};
let orders = [];
let subscription = {};
let activePreset = 'slate-blue';
let activeTab = 'pesanan';
let dirty = new Map();

/* ---------- TEMA ADMIN (DARK & LIGHT) ---------- */
const THEME_KEY = 'tokokit_admin_theme';
let currentTheme = localStorage.getItem(THEME_KEY) || 'dark';

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  const sun = $('#themeIconSun');
  const moon = $('#themeIconMoon');
  const lbl = $('#themeToggleText');
  const btn = $('#btnThemeToggle');
  if (theme === 'light') {
    if (sun) sun.style.display = 'block';
    if (moon) moon.style.display = 'none';
    if (lbl) lbl.textContent = 'Dark';
    if (btn) {
      btn.setAttribute('aria-label', 'Beralih ke Mode Gelap');
      btn.title = 'Beralih ke Mode Gelap';
    }
  } else {
    if (sun) sun.style.display = 'none';
    if (moon) moon.style.display = 'block';
    if (lbl) lbl.textContent = 'Light';
    if (btn) {
      btn.setAttribute('aria-label', 'Beralih ke Mode Terang');
      btn.title = 'Beralih ke Mode Terang';
    }
  }
}

function toggleTheme() {
  const next = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  toast(`Beralih ke ${next === 'light' ? 'Light Mode' : 'Dark Mode'}`);
}

applyTheme(currentTheme);
$('#btnThemeToggle')?.addEventListener('click', toggleTheme);

/* ---------- Kontras WCAG ---------- */
function srgb(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * srgb((n >> 16) & 255) + 0.7152 * srgb((n >> 8) & 255) + 0.0722 * srgb(n & 255);
}
function contrast(a, b) {
  const la = lum(a), lb = lum(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- API Call Helper ---------- */
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': token,
      ...(opts.headers || {}),
    },
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401) { logout(); throw new Error('Token salah atau sudah tidak berlaku.'); }
  if (!res.ok) throw new Error((data && data.error) || `Gagal (${res.status})`);
  return data;
}

/* ---------- Toast Notification ---------- */
let toastTimer = null;
function toast(msg, kind = 'ok') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.className = kind;
  el.style.display = 'block';

  const openDlg = document.querySelector('dialog[open]');
  if (openDlg && !openDlg.contains(el)) {
    openDlg.appendChild(el);
  } else if (!openDlg && el.parentElement !== document.body) {
    document.body.appendChild(el);
  }

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.display = 'none';
    if (el.parentElement !== document.body) {
      document.body.appendChild(el);
    }
  }, 3200);
}

/* ---------- Token Auth Gate ---------- */
function logout() {
  token = '';
  localStorage.removeItem(TOKEN_KEY);
  $('#app').style.display = 'none';
  $('#gate').style.display = 'block';
  $('#tok').value = '';
}

async function tryEnter(t) {
  token = t.trim();
  try {
    const r = await api('/admin/ping');
    localStorage.setItem(TOKEN_KEY, token);
    $('#gate').style.display = 'none';
    $('#app').style.display = 'block';
    $('#hdrStore').textContent = r.store ? `— ${r.store}` : '';
    await loadAll();
    initChatListeners();
    return true;
  } catch (e) {
    $('#tokErr').textContent = e.message;
    $('#tokErr').style.display = 'block';
    token = '';
    return false;
  }
}

$('#tokGo')?.addEventListener('click', () => tryEnter($('#tok').value));
$('#tok')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryEnter($('#tok').value); });
$('#logout')?.addEventListener('click', logout);

/* ---------- TAB & DRAWER NAVIGATION ---------- */
const TAB_TITLES = {
  pesanan: 'Pesanan Masuk',
  chat: 'Chat Pelanggan',
  produk: 'Produk & Stok',
  profil: 'Profil Toko',
  tema: 'Tema Tampilan',
  menu: 'Menu & Langganan SaaS'
};

function switchTab(tabId) {
  if (!TAB_TITLES[tabId]) return;
  activeTab = tabId;

  const pageTitle = $('#pageTitle');
  if (pageTitle) pageTitle.textContent = TAB_TITLES[tabId];

  // Update all tab buttons (both in sidebar and bottom nav)
  $$('[data-tab]').forEach((b) => {
    const isCur = b.dataset.tab === tabId;
    b.setAttribute('aria-selected', String(isCur));
    b.classList.toggle('active', isCur);
  });

  // Toggle visible sections
  $$('main section').forEach((s) => {
    s.hidden = s.id !== 'tab-' + tabId;
  });

  if (tabId === 'chat') {
    loadChats();
  } else if (tabId === 'menu') {
    loadSubscription();
  }

  closeMobileSidebar();
}

function openMobileSidebar() {
  $('#adminSidebar')?.classList.add('open');
  $('#sidebarOverlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeMobileSidebar() {
  $('#adminSidebar')?.classList.remove('open');
  $('#sidebarOverlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

function toggleMobileSidebar() {
  const isCurrentlyOpen = $('#adminSidebar')?.classList.contains('open');
  if (isCurrentlyOpen) closeMobileSidebar();
  else openMobileSidebar();
}

// Wire tab click listeners for both sidebar items and bottom nav items
$$('[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

$('#btnToggleSidebar')?.addEventListener('click', openMobileSidebar);
$('#btnCloseSidebar')?.addEventListener('click', closeMobileSidebar);
$('#sidebarOverlay')?.addEventListener('click', closeMobileSidebar);
$('#btnTopRefresh')?.addEventListener('click', async () => {
  toast('Memuat data terbaru...');
  await loadAll();
});

/* ---------- LANGGANAN SAAS & MENU HUB ---------- */
async function loadSubscription() {
  try {
    const res = await api('/admin/subscription');
    subscription = res.subscription || {};
    renderSubscription(subscription);
  } catch (err) {
    console.warn('Gagal memuat status langganan:', err);
  }
}

function renderSubscription(sub) {
  if (!sub) return;
  if ($('#subPlanTitle')) $('#subPlanTitle').textContent = sub.planName || 'Starter SaaS TokoKit';
  if ($('#subPlanPrice')) $('#subPlanPrice').innerHTML = `${rupiah(sub.price || 49000)} <span>/ bulan</span>`;
  
  if (sub.endDate) {
    const endObj = new Date(sub.endDate);
    const endStr = endObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    if ($('#subMetaEndDate')) $('#subMetaEndDate').textContent = endStr;
    const diffDays = sub.daysLeft !== undefined ? sub.daysLeft : Math.max(0, Math.ceil((endObj.getTime() - Date.now()) / 86400000));
    if ($('#subMetaDaysLeft')) $('#subMetaDaysLeft').textContent = `${diffDays} Hari Tersisa`;
    if ($('#subStatusBadge')) $('#subStatusBadge').textContent = `Paket Starter (${diffDays} hari lagi)`;
  }

  if (sub.qrisImage) {
    if ($('#dlgSubQrisImg')) $('#dlgSubQrisImg').src = sub.qrisImage;
  }
  if (sub.ownerName) {
    if ($('#dlgSubOwner')) $('#dlgSubOwner').textContent = sub.ownerName;
  }

  const phone = sub.ownerPhone || '6285810574163';
  const storeName = settings.storeName || 'Toko Kami';
  const waText = `Halo Mas Adam, saya ingin konfirmasi perpanjangan langganan SaaS TokoKit untuk toko "${storeName}" sebesar Rp 49.000.`;
  const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(waText)}`;
  if ($('#btnWaConfirmDlg')) $('#btnWaConfirmDlg').href = waUrl;
  if ($('#btnWaConfirmHub')) $('#btnWaConfirmHub').href = waUrl;
}

let hasWiredSubEvents = false;
function wireSubscriptionEvents() {
  if (hasWiredSubEvents) return;
  hasWiredSubEvents = true;
  $('#btnOpenSubModal')?.addEventListener('click', () => {
    $('#dlgSubscription')?.showModal();
  });
  $('#btnCloseSubDlg')?.addEventListener('click', () => {
    $('#dlgSubscription')?.close();
  });
  $('#btnCancelSubDlg')?.addEventListener('click', () => {
    $('#dlgSubscription')?.close();
  });

  const copyNominal = () => {
    navigator.clipboard.writeText('49000').then(() => {
      toast('Nominal Rp 49.000 berhasil disalin ke clipboard!', 'ok');
    }).catch(() => {
      toast('Nominal transfer: Rp 49.000', 'ok');
    });
  };

  $('#btnCopyNominalDlg')?.addEventListener('click', copyNominal);
  $('#btnCopyNominalHub')?.addEventListener('click', copyNominal);

  // Quick Action cards in Menu Hub
  $$('[data-goto-tab]').forEach((el) => {
    el.addEventListener('click', () => switchTab(el.dataset.gotoTab));
  });

  $('#btnMenuBroadcast')?.addEventListener('click', () => {
    $('#dlgBroadcast')?.showModal();
  });
}

/* ---------- Muat Data ---------- */
async function loadAll() {
  try {
    const [pr, st, ord, sub] = await Promise.all([
      api('/admin/products'),
      api('/admin/settings'),
      api('/admin/orders').catch(() => ({ orders: [] })),
      api('/admin/subscription').catch(() => ({ subscription: {} })),
      loadChats().catch(() => ({ chats: [] }))
    ]);
    products = pr.products || [];
    settings = st.settings || {};
    orders = ord.orders || [];
    subscription = sub.subscription || {};
    activePreset = typeof settings.theme === 'string'
      ? settings.theme
      : (settings.theme && settings.theme.preset) || 'slate-blue';
    renderOrders();
    renderProducts();
    renderProfil();
    renderTema();
    renderSubscription(subscription);
    wireSubscriptionEvents();
  } catch (err) {
    toast(`Gagal memuat data: ${err.message}`, 'bad');
  }
}

/* ---------- PESANAN ---------- */
function renderOrders() {
  const q = ($('#qOrder')?.value || '').trim().toLowerCase();
  const filterSt = $('#fOrderStatus')?.value || '';

  const rows = orders.filter((o) => {
    if (filterSt && o.status !== filterSt) return false;
    if (q) {
      const match = (String(o.ref || '') + ' ' + (o.customer?.name || '') + ' ' + (o.customer?.phone || '')).toLowerCase();
      if (!match.includes(q)) return false;
    }
    return true;
  });

  const tb = $('#tblOrders tbody');
  if (!tb) return;
  const countEl = $('#orderCount');
  if (countEl) countEl.textContent = `${rows.length} pesanan`;

  // Update badges on both sidebar and bottom navbar
  const newOrdersCount = orders.filter(o => o.status === 'PesananBaru').length;
  const sideBadge = $('#sideBadgePesanan');
  if (sideBadge) {
    sideBadge.textContent = newOrdersCount;
    sideBadge.hidden = newOrdersCount === 0;
  }
  const bnavBadge = $('#bnavBadgePesanan');
  if (bnavBadge) {
    bnavBadge.textContent = newOrdersCount;
    bnavBadge.hidden = newOrdersCount === 0;
  }

  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="7" style="padding:28px;text-align:center;color:var(--dim)">
      ${orders.length ? 'Tidak ada pesanan yang cocok dengan filter.' : 'Belum ada pesanan masuk.'}</td></tr>`;
    return;
  }

  const statusTags = {
    PesananBaru: 'warn',
    MenungguBayar: 'warn',
    Diproses: 'accent',
    Dikirim: 'accent',
    Selesai: 'ok',
    Dibatalkan: 'bad'
  };

  tb.innerHTML = rows.map((o) => {
    const cust = o.customer || {};
    const rawPhone = String(cust.phone || '').replace(/[^0-9]/g, '');
    const phone = rawPhone.startsWith('0') ? '62' + rawPhone.slice(1) : rawPhone;
    const waLink = phone ? `https://wa.me/${phone}?text=${encodeURIComponent('Halo Kak ' + (cust.name || '') + ', mengenai pesanan #' + (o.ref || o.id) + ' di Setia Jaya Teknik...')}` : '';
    const dateStr = o.createdAt ? new Date(o.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    const itemsStr = (o.items && o.items.length)
      ? o.items.map(it => `• ${esc(it.name)} (${it.qty}x)`).join('<br>')
      : esc(o.productName || '1x Pesanan');

    return `
      <tr data-oid="${esc(o.id || o.ref)}">
        <td><strong>#${esc(o.ref || o.id)}</strong></td>
        <td style="font-size:12.5px;color:var(--dim)">${dateStr}</td>
        <td>
          <div style="font-weight:700;color:var(--text)">${esc(cust.name || 'Pelanggan')}</div>
          ${waLink ? `<a href="${waLink}" target="_blank" rel="noopener" style="font-size:12px;color:var(--ok);display:inline-block;margin-top:2px">WA: ${esc(cust.phone)}</a>` : ''}
          <div style="font-size:12px;color:var(--dim);margin-top:3px;max-width:240px;line-height:1.3">${esc(cust.address || '')}</div>
        </td>
        <td style="font-size:13px;line-height:1.4">${itemsStr}</td>
        <td class="num" style="font-weight:700;color:var(--accent)">${rupiah(o.total || o.subtotal || 0)}</td>
        <td>
          <span class="tag ${statusTags[o.status] || ''}">${esc(o.status || 'PesananBaru')}</span>
        </td>
        <td>
          <select class="order-status-sel" data-oid="${esc(o.id || o.ref)}" style="padding:5px 8px;font-size:12px;background:var(--panel-2);border:1px solid var(--line);border-radius:6px">
            <option value="PesananBaru" ${o.status === 'PesananBaru' ? 'selected' : ''}>Pesanan Baru</option>
            <option value="MenungguBayar" ${o.status === 'MenungguBayar' ? 'selected' : ''}>Menunggu Bayar</option>
            <option value="Diproses" ${o.status === 'Diproses' ? 'selected' : ''}>Diproses</option>
            <option value="Dikirim" ${o.status === 'Dikirim' ? 'selected' : ''}>Dikirim</option>
            <option value="Selesai" ${o.status === 'Selesai' ? 'selected' : ''}>Selesai</option>
            <option value="Dibatalkan" ${o.status === 'Dibatalkan' ? 'selected' : ''}>Dibatalkan</option>
          </select>
        </td>
      </tr>
    `;
  }).join('');

  tb.querySelectorAll('.order-status-sel').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const oid = sel.dataset.oid;
      const nextStatus = sel.value;
      try {
        await api(`/orders/${encodeURIComponent(oid)}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status: nextStatus })
        });
        toast(`Status pesanan #${oid} diperbarui jadi: ${nextStatus}`);
        const ord = orders.find(x => x.id === oid || x.ref === oid);
        if (ord) ord.status = nextStatus;
        renderOrders();
      } catch (err) {
        toast(`Gagal update status: ${err.message}`, 'bad');
      }
    });
  });
}

if ($('#qOrder')) $('#qOrder').addEventListener('input', renderOrders);
if ($('#fOrderStatus')) $('#fOrderStatus').addEventListener('change', renderOrders);
if ($('#btnRefreshOrders')) $('#btnRefreshOrders').addEventListener('click', async () => {
  try {
    const ord = await api('/admin/orders');
    orders = ord.orders || [];
    renderOrders();
    toast('Data pesanan dimuat ulang.');
  } catch (err) {
    toast(`Gagal memuat pesanan: ${err.message}`, 'bad');
  }
});

/* ---------- CHAT PELANGGAN (LIVE CS DESK) ---------- */
let chats = [];
let activeChatId = null;
let chatPollTimer = null;

async function loadChats() {
  try {
    const res = await api('/admin/chats');
    chats = res.chats || [];
    renderChatList();
    if (activeChatId) {
      const cur = chats.find(c => c.id === activeChatId);
      if (cur) renderActiveChat(cur);
    }
    const badge1 = $('#sideBadgeChat');
    const badge2 = $('#bnavBadgeChat');
    if (badge1) { badge1.textContent = chats.length; badge1.hidden = chats.length === 0; }
    if (badge2) { badge2.textContent = chats.length; badge2.hidden = chats.length === 0; }
  } catch (err) {
    console.warn('Failed to load chats:', err);
  }
}

function renderChatList() {
  const container = $('#chatListContainer');
  if (!container) return;
  const q = ($('#chatSearchInput')?.value || '').toLowerCase().trim();
  const list = chats.filter(c => {
    if (!q) return true;
    const name = (c.customerName || c.title || '').toLowerCase();
    const phone = (c.customerPhone || '').toLowerCase();
    const lastMsg = (c.messages?.slice(-1)[0]?.content || '').toLowerCase();
    return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
  });

  if (!list.length) {
    container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--dim);font-size:13px">${q ? 'Tidak ada percakapan yang cocok' : 'Belum ada percakapan pelanggan'}</div>`;
    return;
  }

  container.innerHTML = list.map(c => {
    const isAct = c.id === activeChatId;
    const name = c.customerName || c.title || `Pelanggan #${c.id.slice(-5).toUpperCase()}`;
    const initial = (name[0] || 'P').toUpperCase();
    const msgs = c.messages || [];
    const last = msgs[msgs.length - 1];
    const snippet = last ? (last.role === 'user' ? last.content : 'CS: ' + last.content) : 'Percakapan baru';
    const time = c.updatedAt ? new Date(c.updatedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div class="chat-row ${isAct ? 'active' : ''}" data-chat-id="${esc(c.id)}">
        <div class="avatar-circle">${esc(initial)}</div>
        <div class="chat-row-info">
          <div class="chat-row-top">
            <span class="chat-row-name">${esc(name)}</span>
            <span class="chat-row-time">${esc(time)}</span>
          </div>
          <div class="chat-row-bottom">
            <span class="chat-row-snippet">${esc(snippet)}</span>
            ${c.lastOrderRef ? `<span class="badge" style="font-size:9.5px;padding:1px 5px">${esc(c.lastOrderRef)}</span>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.chat-row').forEach(row => {
    row.addEventListener('click', () => {
      const cid = row.dataset.chatId;
      activeChatId = cid;
      renderChatList();
      const selected = chats.find(c => c.id === cid);
      if (selected) {
        renderActiveChat(selected);
        if (window.innerWidth <= 860) {
          $('#chatPanelList')?.classList.add('hide-mobile');
          $('#chatPanelView')?.classList.remove('hide-mobile');
          const backBtn = $('#btnBackChatList');
          if (backBtn) backBtn.style.display = 'inline-block';
        }
      }
    });
  });
}

function renderActiveChat(chat) {
  const name = chat.customerName || chat.title || `Pelanggan #${chat.id.slice(-5).toUpperCase()}`;
  const initial = (name[0] || 'P').toUpperCase();
  const phone = chat.customerPhone || '';

  const av = $('#activeChatAvatar');
  if (av) { av.style.display = 'grid'; av.textContent = initial; }
  const hdr = $('#activeChatHeader');
  if (hdr) hdr.textContent = name;
  const sub = $('#activeChatSub');
  if (sub) {
    const details = [];
    if (phone) details.push(phone);
    if (chat.lastOrderRef) details.push(`Order: ${chat.lastOrderRef}`);
    sub.textContent = details.join(' · ') || 'Live CS Desk Setia Jaya Teknik';
  }

  const waLink = $('#activeChatWaLink');
  if (waLink) {
    if (phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      const waNum = cleanPhone.startsWith('0') ? '62' + cleanPhone.slice(1) : cleanPhone;
      waLink.href = `https://wa.me/${waNum}`;
      waLink.style.display = 'inline-flex';
    } else {
      waLink.style.display = 'none';
    }
  }

  const msgBox = $('#activeChatMessages');
  const msgs = chat.messages || [];
  if (!msgs.length) {
    msgBox.innerHTML = `<div style="text-align:center;color:var(--dim);margin:auto;font-size:13px">Belum ada riwayat pesan dalam percakapan ini.</div>`;
  } else {
    msgBox.innerHTML = msgs.map(m => {
      const isOut = m.role === 'assistant';
      const sender = isOut ? (m.byAdmin ? 'Admin CS' : 'Bot AI') : 'Pelanggan';
      const senderClass = isOut ? 'admin' : 'cust';
      const time = m.at ? new Date(m.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
      return `
        <div class="msg-row ${isOut ? 'out' : 'in'}">
          <div class="chat-bubble ${isOut ? 'out' : 'in'} ${m.broadcast ? 'broadcast' : ''}">
            <span class="sender-tag ${senderClass}">${esc(sender)}</span>
            <span class="msg-text">${esc(m.content).replace(/\n/g, '<br>')}</span>
            <span class="bubble-time">${esc(time)}</span>
          </div>
        </div>`;
    }).join('');
    const wasNearBottom = (msgBox.scrollHeight - msgBox.scrollTop - msgBox.clientHeight) < 120;
    if (wasNearBottom || !msgBox.scrollTop) {
      msgBox.scrollTop = msgBox.scrollHeight;
    }
  }

  const chips = $('#adminQuickChips');
  if (chips) chips.style.display = 'flex';
  const inp = $('#adminChatInput');
  if (inp) inp.disabled = false;
  const sbtn = $('#adminChatSendBtn');
  if (sbtn) sbtn.disabled = false;
}

async function sendAdminReply() {
  if (!activeChatId) return;
  const input = $('#adminChatInput');
  const text = (input?.value || '').trim();
  if (!text) return;

  input.value = '';
  const btn = $('#adminChatSendBtn');
  if (btn) btn.disabled = true;

  try {
    const res = await api('/admin/chats/reply', {
      method: 'POST',
      body: JSON.stringify({ chatId: activeChatId, message: text }),
    });
    if (res.chat) {
      const idx = chats.findIndex(c => c.id === activeChatId);
      if (idx >= 0) chats[idx] = res.chat;
      renderActiveChat(res.chat);
      renderChatList();
    }
  } catch (err) {
    toast(`Gagal kirim: ${err.message}`, 'bad');
  } finally {
    if (btn) btn.disabled = false;
    input?.focus();
  }
}

let hasInitChatListeners = false;
function initChatListeners() {
  if (hasInitChatListeners) return;
  hasInitChatListeners = true;
  $('#chatSearchInput')?.addEventListener('input', renderChatList);

  $('#adminChatSendBtn')?.addEventListener('click', sendAdminReply);
  $('#adminChatInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendAdminReply();
  });

  $('#btnBackChatList')?.addEventListener('click', () => {
    $('#chatPanelList')?.classList.remove('hide-mobile');
    $('#chatPanelView')?.classList.add('hide-mobile');
    const b = $('#btnBackChatList');
    if (b) b.style.display = 'none';
  });

  $('#adminQuickChips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-quick-reply]');
    if (chip) {
      const inp = $('#adminChatInput');
      if (inp) {
        inp.value = chip.dataset.quickReply;
        sendAdminReply();
      }
    }
  });

  $('#btnOpenBroadcast')?.addEventListener('click', () => {
    const bInp = $('#broadcastInput');
    if (bInp) bInp.value = '';
    $('#dlgBroadcast')?.showModal();
  });
  $('#btnCloseBroadcast')?.addEventListener('click', () => {
    $('#dlgBroadcast')?.close();
  });
  $('#btnSendBroadcast')?.addEventListener('click', async () => {
    const text = ($('#broadcastInput')?.value || '').trim();
    if (!text) { toast('Tulis pesan broadcast terlebih dahulu', 'bad'); return; }
    const btn = $('#btnSendBroadcast');
    btn.disabled = true;
    btn.textContent = 'Mengirim…';
    try {
      const res = await api('/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      });
      toast(`Broadcast terkirim ke ${res.sent || 0} percakapan!`, 'ok');
      $('#dlgBroadcast')?.close();
      loadChats();
    } catch (err) {
      toast(`Gagal broadcast: ${err.message}`, 'bad');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Kirim Broadcast';
    }
  });

  if (chatPollTimer) clearInterval(chatPollTimer);
  chatPollTimer = setInterval(() => {
    if (token) loadChats();
  }, 4000);
}

/* ---------- PRODUK & STOK ---------- */
function renderProducts() {
  const q = ($('#qProd')?.value || '').trim().toLowerCase();
  const showOff = $('#showOff')?.checked;
  const rows = products.filter((p) => {
    if (!showOff && p.active === false) return false;
    if (q && !p.name.toLowerCase().includes(q) && !(p.category || '').toLowerCase().includes(q)) return false;
    return true;
  });

  const countEl = $('#prodCount');
  if (countEl) countEl.textContent = `${rows.length} dari ${products.length} produk`;

  const tb = $('#tblProd tbody');
  if (!tb) return;
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="7" style="padding:28px;text-align:center;color:var(--dim)">Tidak ada produk yang cocok.</td></tr>`;
    return;
  }

  tb.innerHTML = rows.map((p) => {
    const isOff = p.active === false;
    const isDirty = dirty.has(p.id);
    const dVal = dirty.get(p.id) || {};
    const priceVal = dVal.price !== undefined ? dVal.price : p.price;
    const stockVal = dVal.stock !== undefined ? dVal.stock : (p.stock === null || p.stock === undefined ? '' : p.stock);

    return `
      <tr data-id="${esc(p.id)}" class="${isOff ? 'off' : ''}">
        <td><img class="thumb" src="${esc(p.image || '')}" alt="" onerror="this.style.opacity=.2"></td>
        <td>
          <div style="font-weight:600">${esc(p.name)}</div>
          <div style="font-size:12px;color:var(--dim)">ID: ${esc(p.id)} ${isOff ? '• <span class="tag bad">Diarsipkan</span>' : ''}</div>
        </td>
        <td><span class="tag">${esc(p.category || '—')}</span></td>
        <td class="num">
          <input class="row-price" type="number" min="0" step="500" value="${priceVal}"
            style="width:110px;text-align:right" data-id="${esc(p.id)}">
        </td>
        <td class="num">
          <input class="row-stock" type="number" min="0" step="1" placeholder="∞" value="${stockVal}"
            style="width:70px;text-align:right" data-id="${esc(p.id)}">
        </td>
        <td class="num" style="color:var(--dim)">${p.weight || 0}g</td>
        <td>
          <div class="actions">
            <button class="btn btn-sm btn-primary row-save" data-id="${esc(p.id)}" ${isDirty ? '' : 'disabled'}>Simpan</button>
            <button class="btn btn-sm row-toggle" data-id="${esc(p.id)}">${isOff ? 'Pulihkan' : 'Arsipkan'}</button>
            <button class="btn btn-sm btn-danger row-del" data-id="${esc(p.id)}">Hapus</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tb.querySelectorAll('.row-price, .row-stock').forEach((inp) => {
    inp.addEventListener('input', () => {
      const tr = inp.closest('tr');
      const id = tr.dataset.id;
      const price = Number(tr.querySelector('.row-price').value);
      const stockStr = tr.querySelector('.row-stock').value.trim();
      const stock = stockStr === '' ? null : Number(stockStr);
      dirty.set(id, { price, stock });
      tr.querySelector('.row-save').disabled = false;
    });
  });

  tb.querySelectorAll('.row-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const d = dirty.get(id);
      if (!d) return;
      btn.disabled = true;
      try {
        await api('/admin/products/' + encodeURIComponent(id), {
          method: 'PATCH',
          body: JSON.stringify(d),
        });
        const p = products.find((x) => x.id === id);
        if (p) Object.assign(p, d);
        dirty.delete(id);
        toast(`Perubahan “${p ? p.name : id}” tersimpan.`);
        renderProducts();
      } catch (e) {
        toast(e.message, 'bad');
        btn.disabled = false;
      }
    });
  });

  tb.querySelectorAll('.row-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const p = products.find((x) => x.id === id);
      if (!p) return;
      const nextActive = p.active === false;
      try {
        await api('/admin/products/' + encodeURIComponent(id), {
          method: 'PATCH',
          body: JSON.stringify({ active: nextActive }),
        });
        p.active = nextActive;
        toast(nextActive ? `“${p.name}” dipulihkan.` : `“${p.name}” diarsipkan.`);
        renderProducts();
      } catch (e) {
        toast(e.message, 'bad');
      }
    });
  });

  tb.querySelectorAll('.row-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const p = products.find((x) => x.id === id);
      askDelete(p);
    });
  });
}

function askDelete(p) {
  if (!p) return;
  const isOff = p.active === false;
  openDialog(isOff ? 'Hapus permanen' : 'Arsipkan produk', `
    <p style="margin:0 0 12px">${isOff
      ? `“${esc(p.name)}” akan dihapus selamanya dan tidak bisa dikembalikan.`
      : `“${esc(p.name)}” akan disembunyikan dari toko, tapi riwayat pesanan lama tetap utuh.`}</p>
    ${isOff ? `<div class="row"><label for="confirmName">Ketik nama produk untuk memastikan</label>
      <input id="confirmName" placeholder="${esc(p.name)}"></div>` : ''}
  `, async () => {
    if (isOff) {
      const typed = ($('#confirmName')?.value || '').trim();
      if (typed !== p.name) { toast('Nama tidak cocok. Dibatalkan.', 'bad'); return false; }
    }
    await api('/admin/products/' + encodeURIComponent(p.id), {
      method: 'DELETE',
      body: JSON.stringify({ id: p.id, permanent: isOff === true }),
    });
    products = products.filter((x) => x.id !== p.id || !isOff);
    if (!isOff) {
      const i = products.findIndex((x) => x.id === p.id);
      if (i > -1) products[i] = { ...products[i], active: false };
    }
    toast(isOff ? 'Produk dihapus permanen.' : 'Produk diarsipkan.');
    renderProducts();
  });
}

if ($('#qProd')) $('#qProd').addEventListener('input', renderProducts);
if ($('#showOff')) $('#showOff').addEventListener('change', renderProducts);

/* Tambah produk baru */
if ($('#addProd')) $('#addProd').addEventListener('click', () => {
  openDialog('Tambah produk baru', `
    <div class="row"><label for="nName">Nama produk</label><input id="nName" placeholder="Contoh: Mata Gerinda Poles 4 Inci"></div>
    <div class="grid2">
      <div class="row"><label for="nCat">Kategori</label><input id="nCat" placeholder="Mata Gerinda / Alat Las / dll"></div>
      <div class="row"><label for="nPrice">Harga (Rp)</label><input id="nPrice" type="number" min="0" step="500" placeholder="50000"></div>
    </div>
    <div class="grid2">
      <div class="row"><label for="nStock">Stok (kosongkan bila bebas)</label><input id="nStock" type="number" min="0" placeholder="10"></div>
      <div class="row"><label for="nWeight">Berat (gram)</label><input id="nWeight" type="number" min="0" step="50" value="500"></div>
    </div>
    <div class="row"><label for="nDesc">Deskripsi</label><textarea id="nDesc" placeholder="Penjelasan barang, ukuran, kegunaan..."></textarea></div>
  `, async () => {
    const name = ($('#nName').value || '').trim();
    const price = Number($('#nPrice').value);
    if (!name) { toast('Nama produk wajib diisi.', 'bad'); return false; }
    if (isNaN(price) || price < 0) { toast('Harga harus berupa angka.', 'bad'); return false; }
    const stockRaw = ($('#nStock').value || '').trim();
    await api('/admin/products', {
      method: 'POST',
      body: JSON.stringify({
        name, price,
        category: ($('#nCat').value || '').trim() || 'Alat Teknik',
        description: ($('#nDesc').value || '').trim(),
        stock: stockRaw === '' ? null : Number(stockRaw),
        weight: Number($('#nWeight').value) || 0,
        image: '/toko-kit/img/tools/gerinda-potong.jpg'
      }),
    });
    toast('Produk baru berhasil ditambahkan.');
    await loadAll();
  });
});

/* ---------- PROFIL ---------- */
function renderProfil() {
  if ($('#sName')) $('#sName').value = settings.storeName || '';
  if ($('#sDesc')) $('#sDesc').value = settings.storeDesc || '';
  if ($('#sWa')) $('#sWa').value = settings.waPublic || settings.adminPhone || '';
  if ($('#sCity')) $('#sCity').value = settings.city || '';
  if ($('#sAddr')) $('#sAddr').value = settings.address || '';
  if ($('#sHours')) $('#sHours').value = settings.hours || '';
  if ($('#sQrisOwner')) $('#sQrisOwner').value = settings.qrisOwner || '';
  if ($('#sQrisNote')) $('#sQrisNote').value = settings.qrisNote || '';
}

if ($('#saveProfil')) $('#saveProfil').addEventListener('click', async () => {
  const wa = ($('#sWa').value || '').trim();
  if (wa && !/^(08|628|\+628)\d{7,13}$/.test(wa.replace(/[\s-]/g, ''))) {
    return toast('Nomor WhatsApp harus format 08… atau 628…', 'bad');
  }
  const btn = $('#saveProfil');
  btn.disabled = true;
  try {
    const r = await api('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        storeName: $('#sName').value,
        storeDesc: $('#sDesc').value,
        waPublic: wa,
        city: $('#sCity').value,
        address: $('#sAddr').value,
        hours: $('#sHours').value,
        qrisOwner: $('#sQrisOwner').value,
        qrisNote: $('#sQrisNote').value,
      }),
    });
    settings = r.settings;
    if ($('#hdrStore')) $('#hdrStore').textContent = settings.storeName ? `— ${settings.storeName}` : '';
    toast('Profil toko tersimpan. Landing page dan toko langsung memakai data baru.');
  } catch (e) {
    toast(e.message, 'bad');
  } finally {
    btn.disabled = false;
  }
});

/* ---------- TEMA ---------- */
function renderTema() {
  const sw = $('#swatches');
  if (!sw) return;
  sw.innerHTML = PRESETS.map((p) => `
    <button class="swatch" data-id="${p.id}" aria-pressed="${p.id === activePreset}">
      <div class="bar" style="background:linear-gradient(90deg, ${p.primary} 0 55%, ${p.bg} 55% 100%)"></div>
      <div class="nm">${p.label}</div>
      <div class="ratio">kontras ${p.ratio}:1</div>
    </button>`).join('');
  $$('#swatches .swatch').forEach((b) => b.addEventListener('click', () => {
    activePreset = b.dataset.id;
    renderTema();
  }));
  const cur = settings.theme && typeof settings.theme === 'object' && settings.theme.primary;
  const hex = cur || (PRESETS.find((p) => p.id === activePreset) || PRESETS[0]).primary;
  if ($('#tCustom')) $('#tCustom').value = hex;
  updateRatio();
}

function updateRatio() {
  const cust = $('#tCustom');
  if (!cust) return;
  const c = contrast(cust.value, '#FFFFFF');
  const el = $('#tRatio');
  if (!el) return;
  if (c === null) { el.textContent = 'Hex tidak valid'; el.style.color = 'var(--bad)'; return; }
  const ok = c >= 4.5;
  el.textContent = `Kontras teks putih: ${c.toFixed(2)}:1 ${ok ? '— lolos AA' : '— KURANG dari 4.5:1'}`;
  el.style.color = ok ? 'var(--ok)' : 'var(--bad)';
}

if ($('#tCustom')) $('#tCustom').addEventListener('input', updateRatio);

if ($('#saveTema')) $('#saveTema').addEventListener('click', async () => {
  const hex = $('#tCustom').value;
  const presetDefault = (PRESETS.find((p) => p.id === activePreset) || PRESETS[0]).primary;
  const isCustom = hex.toLowerCase() !== presetDefault.toLowerCase();
  if (isCustom) {
    const c = contrast(hex, '#FFFFFF');
    if (c !== null && c < 4.5) {
      return toast(`Warna itu kontrasnya ${c.toFixed(2)}:1 — di bawah 4.5:1, teks tombol bakal susah dibaca. Pilih yang lebih gelap.`, 'bad');
    }
  }
  const btn = $('#saveTema');
  btn.disabled = true;
  try {
    const r = await api('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ theme: isCustom ? { preset: activePreset, primary: hex } : activePreset }),
    });
    settings = r.settings;
    toast('Tema tersimpan.');
  } catch (e) {
    toast(e.message, 'bad');
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Dialog Modal ---------- */
let dialogSubmit = null;
function openDialog(title, bodyHtml, onSubmit) {
  $('#dlgBody').innerHTML = `<h3>${esc(title)}</h3>` + bodyHtml;
  dialogSubmit = onSubmit;
  $('#dlg').showModal();
}
$('#dlg')?.addEventListener('close', async () => {
  if ($('#dlg').returnValue !== 'ok' || !dialogSubmit) return;
  const fn = dialogSubmit;
  dialogSubmit = null;
  try {
    const res = await fn();
    if (res === false) $('#dlg').returnValue = 'cancel';
  } catch (e) {
    toast(e.message, 'bad');
  }
});

/* ---------- Inisialisasi ---------- */
if (token) {
  tryEnter(token).then((ok) => { if (!ok) { $('#gate').style.display = 'block'; } });
} else {
  $('#gate').style.display = 'block';
}
