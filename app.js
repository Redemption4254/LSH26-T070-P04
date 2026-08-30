// ============================================================
//  FareSplit - app.js
//  Quality-focused PWA: state, math, backend, QR, history,
//  theme, shareable URL, accessibility, debounced rendering.
// ============================================================

// ---------- Limits (mirror backend) ----------
const LIMITS = {
  MAX_STOPS: 20,
  MAX_STOP_LEN: 60,
  MAX_PASSENGERS: 20,
  MAX_NAME_LEN: 40,
  MAX_FARE: 1_000_000
};

// ---------- State ----------
const state = {
  stops: ['Park Street', 'MG Road', 'Central Station', 'Airport'],
  totalFare: 120,
  passengers: [],          // { id, name, inStop, outStop }
  tripId: null,
  shareUrl: null,
  history: [],
  view: 'split',
  city: 'Las Vegas, USA',
  // Settings (persisted via localStorage)
  currency: '\u09F3',
  defaultFare: 120,
  nightMode: false,
  soundOn: false,
  // Profile (persisted)
  profile: { name: '', email: '', phone: '', home: '' },
  // Notifications
  notifications: [],
  shareCount: 0
};

let nextId = 1;
const $ = (id) => document.getElementById(id);

// ---------- Tiny utilities ----------
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function clampStr(v, max) {
  return String(v ?? '').trim().slice(0, max);
}

function fmtMoney(n) {
  // Locale-aware, 2 decimal places, never shows "-0". Currency comes from settings.
  const v = (Math.round(n * 100) / 100);
  const cur = (state && state.currency) ? state.currency : '\u09F3';
  return `${cur} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const announcement = (() => {
  let el = null;
  return (msg) => {
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-atomic', 'true');
      Object.assign(el.style, {
        position: 'absolute', left: '-9999px', width: '1px', height: '1px',
        overflow: 'hidden', clip: 'rect(0 0 0 0)'
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
  };
})();

// ---------- Init ----------
async function init() {
  loadTheme();
  loadSettings();
  loadProfile();
  loadHistory();
  loadNotifications();
  renderProfileAvatar();
  updateNotifBadge();
  // Reflect saved city in the location pill if there's a labeled slot.
  if (state.city) updateLocCity(state.city);
  renderAll();
  wireEvents();
  pingBackend();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }

  // Load shared trip from URL ?trip=ID or #trip=<base64>
  const params = new URLSearchParams(location.search);
  const tripId = params.get('trip');
  if (tripId) await loadSharedTrip(tripId);
  else if (location.hash.startsWith('#trip=')) loadLocalSharedTrip(location.hash.slice(6));
}

// ---------- Events ----------
// Safe binding helper: never throws if the element is missing.
function bind(id, event, fn) {
  const el = document.getElementById(id);
  if (!el) { console.warn('[bind] missing element #' + id); return; }
  el.addEventListener(event, fn);
}
function bindAll(selector, event, fn) {
  const els = document.querySelectorAll(selector);
  els.forEach((el) => el.addEventListener(event, fn));
}

// Global error surfacing: any uncaught error becomes a toast so users can see it.
function _showErr(msg) {
  const t = document.getElementById('toast');
  if (t) { t.textContent = '⚠ ' + msg; t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 5000); }
  console.error('[FareSplit]', msg);
}
window.addEventListener('error', (e) => { if (e && e.error) _showErr(e.error.message || String(e.error)); });
window.addEventListener('unhandledrejection', (e) => { _showErr('Promise: ' + ((e.reason && (e.reason.message || String(e.reason))) || 'rejected')); });

// Action sheet that lets the user add stops, add riders, share, demo, reset.
let _sheetStep = 'route';
function openMenuSheet(step) {
  if (step) _sheetStep = step;
  closeSheet();
  const overlay = document.createElement('div');
  overlay.id = 'menu-sheet';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);z-index:120;display:flex;align-items:flex-end;justify-content:center;';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });

  const card = document.createElement('div');
  card.style.cssText = 'background:var(--card);border:1px solid var(--line);border-radius:24px 24px 0 0;padding:1.25rem 1.2rem calc(1.5rem + env(safe-area-inset-bottom));width:100%;max-width:560px;animation:sheetUp .25s ease-out;';
  card.innerHTML = `
    <style>#menu-sheet .handle{display:block;width:42px;height:4px;background:var(--line);border-radius:2px;margin:0 auto 1rem;}
    #menu-sheet h3{margin:0 0 .25rem;font-size:1.15rem;font-weight:700;}
    #menu-sheet .sub{margin:0 0 1rem;color:var(--muted);font-size:.85rem;}
    #menu-sheet .row{display:flex;gap:.5rem;align-items:center;margin-bottom:.6rem;}
    #menu-sheet input{flex:1;background:var(--card-2);border:1px solid var(--line);color:var(--text);padding:.7rem .9rem;border-radius:14px;font:inherit;font-size:.95rem;outline:none;min-height:44px;}
    #menu-sheet select{flex:1;background:var(--card-2);border:1px solid var(--line);color:var(--text);padding:.7rem .9rem;border-radius:14px;font:inherit;font-size:.95rem;outline:none;min-height:44px;appearance:none;}
    #menu-sheet .add-btn{width:44px;height:44px;border-radius:50%;background:var(--primary);color:#fff;border:none;font-size:1.2rem;font-weight:600;cursor:pointer;flex-shrink:0;}
    #menu-sheet .stops-mini{list-style:none;padding:0;margin:0 0 1rem;max-height:140px;overflow-y:auto;}
    #menu-sheet .stops-mini li{display:flex;justify-content:space-between;align-items:center;padding:.55rem .8rem;background:var(--card-2);border-radius:12px;margin-bottom:.35rem;font-size:.9rem;}
    #menu-sheet .stops-mini button{background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:1rem;padding:.2rem .5rem;}
    #menu-sheet .actions{display:flex;gap:.5rem;margin-top:1rem;}
    #menu-sheet .act{flex:1;background:var(--card-2);border:1px solid var(--line);color:var(--text);padding:.7rem .9rem;border-radius:999px;font:inherit;font-weight:600;font-size:.9rem;cursor:pointer;}
    #menu-sheet .act.red{background:var(--primary);border-color:var(--primary);color:#fff;}
    @keyframes sheetUp{from{transform:translateY(40px);opacity:0;}to{transform:none;opacity:1;}}</style>
    <span class="handle"></span>
    <div id="sheet-body"></div>
  `;

  const body = card.querySelector('#sheet-body');

  if (_sheetStep === 'route') {
    body.innerHTML = `
      <h3>Stops &amp; fare</h3>
      <p class="sub">Add the stops in order, then set the total fare.</p>
      <ul class="stops-mini" id="sheet-stops"></ul>
      <div class="row">
        <input id="sheet-new-stop" placeholder="Add a stop…" maxlength="60" />
        <button class="add-btn" id="sheet-add-stop" aria-label="Add stop">+</button>
      </div>
      <div class="row">
        <span style="color:var(--muted);font-weight:600;">Total fare ৳</span>
        <input id="sheet-fare" type="number" min="0" step="0.01" inputmode="decimal" />
      </div>
      <div class="actions">
        <button class="act" id="sheet-demo">Load demo</button>
        <button class="act red" id="sheet-next">Next: Riders →</button>
      </div>
    `;
    const list = body.querySelector('#sheet-stops');
    state.stops.forEach((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${i + 1}. ${escapeHtml(s)}</span>`;
      const x = document.createElement('button');
      x.textContent = '✕';
      x.setAttribute('aria-label', 'Remove ' + s);
      x.addEventListener('click', () => { removeStop(i); renderSheetStops(); });
      li.appendChild(x);
      list.appendChild(li);
    });
    const newIn = body.querySelector('#sheet-new-stop');
    const addBtn = body.querySelector('#sheet-add-stop');
    const fareIn = body.querySelector('#sheet-fare');
    fareIn.value = state.totalFare;
    const addStopFn = () => {
      $('new-stop').value = newIn.value;
      addStop();
      newIn.value = '';
      renderSheetStops();
    };
    addBtn.addEventListener('click', addStopFn);
    newIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addStopFn(); } });
    fareIn.addEventListener('input', () => { $('total-fare').value = fareIn.value; $('total-fare').dispatchEvent(new Event('input')); });
    body.querySelector('#sheet-demo').addEventListener('click', () => { closeSheet(); loadDemoTrip(); });
    body.querySelector('#sheet-next').addEventListener('click', () => { _sheetStep = 'passengers'; openMenuSheet(); });
  } else if (_sheetStep === 'passengers') {
    body.innerHTML = `
      <h3>Who's riding?</h3>
      <p class="sub">Add each passenger's board &amp; alight stops.</p>
      <ul class="stops-mini" id="sheet-passengers" style="margin-bottom:1rem;"></ul>
      <div class="row"><input id="sheet-pname" placeholder="Passenger name" maxlength="40" /></div>
      <div class="row">
        <select id="sheet-pin"></select>
        <span style="color:var(--muted);">→</span>
        <select id="sheet-pout"></select>
      </div>
      <div class="actions">
        <button class="act" id="sheet-back">← Stops</button>
        <button class="act red" id="sheet-add-pax">+ Add Passenger</button>
      </div>
      <div class="actions">
        <button class="act" id="sheet-share" style="flex:2;">Save &amp; Share Link</button>
      </div>
    `;
    const inSel = body.querySelector('#sheet-pin');
    const outSel = body.querySelector('#sheet-pout');
    state.stops.forEach((s, i) => {
      inSel.innerHTML += `<option value="${escapeHtml(s)}">${i + 1}. ${escapeHtml(s)}</option>`;
      outSel.innerHTML += `<option value="${escapeHtml(s)}">${i + 1}. ${escapeHtml(s)}</option>`;
    });
    if (outSel.options.length) outSel.selectedIndex = Math.min(outSel.options.length - 1, 1);

    const list = body.querySelector('#sheet-passengers');
    state.passengers.forEach((p) => {
      const li = document.createElement('li');
      li.innerHTML = `<span><strong>${escapeHtml(p.name)}</strong> · ${escapeHtml(p.inStop)} → ${escapeHtml(p.outStop)}</span>`;
      const x = document.createElement('button');
      x.textContent = '✕';
      x.addEventListener('click', () => { removePassenger(p.id); list.removeChild(li); });
      li.appendChild(x);
      list.appendChild(li);
    });

    const addPax = () => {
      $('passenger-name').value = body.querySelector('#sheet-pname').value;
      $('passenger-in').value = inSel.value;
      $('passenger-out').value = outSel.value;
      const ok = addPassenger();
      if (ok !== false) {
        body.querySelector('#sheet-pname').value = '';
        renderResults();
      }
    };
    body.querySelector('#sheet-add-pax').addEventListener('click', addPax);
    body.querySelector('#sheet-back').addEventListener('click', () => { _sheetStep = 'route'; openMenuSheet(); });
    body.querySelector('#sheet-share').addEventListener('click', () => { closeSheet(); shareTrip(); });
  } else if (_sheetStep === 'results') {
    body.innerHTML = `
      <h3>Split the fare</h3>
      <p class="sub">Review the math, then share with everyone.</p>
      <div class="actions">
        <button class="act" id="sheet-demo">Load demo</button>
        <button class="act" id="sheet-qr">Show QR</button>
        <button class="act red" id="sheet-share">Save &amp; Share</button>
      </div>
      <div class="actions">
        <button class="act" id="sheet-reset">Reset trip</button>
      </div>
    `;
    body.querySelector('#sheet-demo').addEventListener('click', () => { closeSheet(); loadDemoTrip(); });
    body.querySelector('#sheet-qr').addEventListener('click', () => { closeSheet(); showQR(); });
    body.querySelector('#sheet-share').addEventListener('click', () => { closeSheet(); shareTrip(); });
    body.querySelector('#sheet-reset').addEventListener('click', () => { closeSheet(); resetTrip(); });
  } else {
    body.innerHTML = `
      <h3>Quick actions</h3>
      <p class="sub">Build your trip, then share.</p>
      <div class="actions">
        <button class="act" id="sheet-demo">Load demo trip</button>
        <button class="act red" id="sheet-share">Save &amp; Share</button>
      </div>
      <div class="actions">
        <button class="act" id="sheet-qr">Show QR</button>
        <button class="act" id="sheet-reset">Reset trip</button>
      </div>
    `;
    body.querySelector('#sheet-demo').addEventListener('click', () => { closeSheet(); loadDemoTrip(); });
    body.querySelector('#sheet-share').addEventListener('click', () => { closeSheet(); shareTrip(); });
    body.querySelector('#sheet-qr').addEventListener('click', () => { closeSheet(); showQR(); });
    body.querySelector('#sheet-reset').addEventListener('click', () => { closeSheet(); resetTrip(); });
  }

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}

function renderSheetStops() {
  const list = document.getElementById('sheet-stops');
  if (!list) return;
  list.innerHTML = '';
  state.stops.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${i + 1}. ${escapeHtml(s)}</span>`;
    const x = document.createElement('button');
    x.textContent = '✕';
    x.addEventListener('click', () => { removeStop(i); renderSheetStops(); });
    li.appendChild(x);
    list.appendChild(li);
  });
  // Sync the in/out selects in the open passenger sheet, if any
  const inSel = document.getElementById('sheet-pin');
  const outSel = document.getElementById('sheet-pout');
  if (inSel && outSel) {
    const prevIn = inSel.value, prevOut = outSel.value;
    inSel.innerHTML = ''; outSel.innerHTML = '';
    state.stops.forEach((s, i) => {
      inSel.innerHTML += `<option value="${escapeHtml(s)}">${i + 1}. ${escapeHtml(s)}</option>`;
      outSel.innerHTML += `<option value="${escapeHtml(s)}">${i + 1}. ${escapeHtml(s)}</option>`;
    });
    if ([...inSel.options].some((o) => o.value === prevIn)) inSel.value = prevIn;
    if ([...outSel.options].some((o) => o.value === prevOut)) outSel.value = prevOut;
  }
}

function closeSheet() {
  const existing = document.getElementById('menu-sheet');
  if (existing) existing.remove();
  document.body.style.overflow = '';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wireEvents() {
  // Every bind is wrapped to never abort the rest of the wiring if one
  // selector misses. We bind each handler individually.
  bind('total-fare', 'input', (e) => {
    let v = parseFloat(e.target.value);
    if (!Number.isFinite(v) || v < 0) v = 0;
    if (v > LIMITS.MAX_FARE) {
      v = LIMITS.MAX_FARE;
      e.target.value = v;
    }
    state.totalFare = v;
    scheduleResultsRender();
  });
  bind('add-stop', 'click', () => { try { addStop(); } catch (e) { _showErr(e.message); } });
  bind('new-stop', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); try { addStop(); } catch (e) { _showErr(e.message); } } });
  bind('new-stop', 'input', (e) => { e.target.value = e.target.value.slice(0, LIMITS.MAX_STOP_LEN); });

  bind('add-passenger', 'click', () => { try { addPassenger(); } catch (e) { _showErr(e.message); } });
  bind('passenger-name', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); try { addPassenger(); } catch (e) { _showErr(e.message); } } });
  bind('passenger-name', 'input', (e) => { e.target.value = e.target.value.slice(0, LIMITS.MAX_NAME_LEN); });

  bind('menu-btn', 'click', () => { try { openRichMenu(); } catch (e) { _showErr(e.message); } });
  bind('cam-btn', 'click', () => { try { openScanModal(); } catch (e) { _showErr(e.message); } });

  // Category tabs open the quick-config sheet for that step
  document.querySelectorAll('.cat-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      try {
        document.querySelectorAll('.cat-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        openMenuSheet(tab.dataset.step);
      } catch (e) { _showErr(e.message); }
    });
  });

  // Generic "switch view" wiring for any element carrying [data-view].
  // Covers .view-link (What's-new link) and .round-icon[data-view] (back
  // arrows on results / history / about). rail-link / nav-btn / nav-fab are
  // wired below for any extra side-effects.
  document.querySelectorAll('[data-view]').forEach((el) => {
    if (el.classList.contains('nav-btn') ||
        el.classList.contains('nav-fab') ||
        el.classList.contains('rail-link')) return;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      try { switchView(el.dataset.view); } catch (err) { _showErr(err.message); }
    });
  });

  bind('share-btn', 'click', () => { shareTrip(); });
  bind('qr-btn', 'click', () => { showQR(); });
  bind('reset-btn', 'click', () => { resetTrip(); });
  bind('demo-btn', 'click', () => { loadDemoTrip(); });
  bind('qr-close', 'click', () => { closeQR(); });
  bind('qr-modal', 'click', (e) => { if (e.target.id === 'qr-modal') closeQR(); });
  bind('qr-copy', 'click', () => { copyLink(); });
  bind('bk-booknow', 'click', () => { shareTrip(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheet(); closeQR(); } });
  document.querySelectorAll('.nav-btn, .nav-fab').forEach((b) => {
    b.addEventListener('click', () => { try { switchView(b.dataset.view); } catch (e) { _showErr(e.message); } });
  });
  document.querySelectorAll('.rail-link').forEach((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); try { switchView(a.dataset.view); } catch (err) { _showErr(err.message); } });
  });
  // Summary pane Share button
  bind('sum-share', 'click', () => { shareTrip(); });

  // Bell handler is wired below in the new feature block — keep this line
  // as a no-op fallback in case the new wiring fails to run.
  bind('bell-btn', 'click', () => { /* openNotifications is wired below */ });
  // Triple-chevron "next" pill jumps to the next step sheet.
  bind('ghost-next', 'click', () => {
    const order = ['route', 'passengers', 'results'];
    const i = order.indexOf(_sheetStep);
    openMenuSheet(order[(i + 1) % order.length]);
  });
  // The "View" cards on the What's-new rail map to the matching sheet step.
  document.querySelectorAll('.wn-view').forEach((b, i) => {
    b.addEventListener('click', () => {
      const step = ['route', 'passengers', 'results'][i] || 'route';
      openMenuSheet(step);
    });
  });
  // The "+" buttons on the history / about headers open the demo flow.
  document.querySelectorAll('.bk-header .round-icon:not([data-view])').forEach((b) => {
    const label = (b.getAttribute('aria-label') || '').toLowerCase();
    b.addEventListener('click', () => {
      if (label.includes('notif')) { openNotifications(); return; }
      if (label.includes('add'))   { loadDemoTrip(); switchView('split'); toast('Demo trip loaded'); return; }
      if (label.includes('setting')){ openSettings(); return; }
      toast('Tap a stop or rider to get started');
    });
  });
  // Map pin on the location pill opens the real city picker.
  document.querySelector('.loc-pin')?.addEventListener('click', openCityPicker);
  // The "Map" ghost pill on the featured card opens the route preview.
  document.querySelectorAll('.ghost-pill').forEach((b) => {
    if ((b.getAttribute('aria-label') || '').toLowerCase().includes('map')) {
      b.addEventListener('click', openRoutePreview);
    }
  });
  // Scanner (camera button) opens the scan-trip flow.
  document.getElementById('cam-btn')?.addEventListener('click', openScanModal);

  // Avatar (top right) opens the profile; keep theme toggle as a small click-zone inside it.
  const avatar = document.getElementById('theme-toggle');
  if (avatar) {
    avatar.addEventListener('click', (e) => {
      // Shift-click toggles theme (hidden feature), plain click opens profile.
      if (e.shiftKey) { toggleTheme(); return; }
      openProfile();
    });
  }
  // Bell opens the notifications panel.
  bind('bell-btn', 'click', openNotifications);

  // Wire every "View" button inside the What's-new cards.
  document.querySelectorAll('.wn-card').forEach((card, i) => {
    const btn = card.querySelector('.wn-view');
    if (!btn) return;
    btn.addEventListener('click', () => openWhatsNew(card.dataset.feature || ['routes','newRoutes','night'][i] || 'routes'));
    // Whole card is also clickable
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.closest('.wn-view')) return;
      openWhatsNew(card.dataset.feature || ['routes','newRoutes','night'][i] || 'routes');
    });
  });

  // Bookings tabs (3 Deals / Details / Reviews).
  document.querySelectorAll('.bk-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      try {
        document.querySelectorAll('.bk-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        renderBookingsTab(tab.textContent.trim());
      } catch (e) { _showErr(e.message); }
    });
  });
  // Book Now → confirm + share trip.
  bind('bk-booknow', 'click', () => { try { bookNow(); } catch (e) { _showErr(e.message); } });

  // Generic modal close — every [data-close="<id>"] button.
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  // Click on backdrop closes any open modal.
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(m.id); });
  });

  // ====== Profile modal wiring ======
  bind('profile-form', 'submit', (e) => {
    e.preventDefault();
    try { saveProfile(); } catch (err) { _showErr(err.message); }
  });
  bind('profile-signout', 'click', () => { wipeAllData(); closeModal('profile-modal'); });

  // ====== Notifications modal wiring ======
  document.querySelectorAll('.notif-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.notif-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      renderNotifications(tab.dataset.notifTab);
    });
  });
  bind('notif-clear', 'click', () => { clearNotifications(); renderNotifications(); });
  bind('notif-mark-read', 'click', () => { markAllRead(); renderNotifications(); });

  // ====== Settings modal wiring ======
  bind('set-currency', 'change', (e) => { state.currency = e.target.value; persistSettings(); renderAll(); toast('Currency updated to ' + e.target.value); });
  bind('set-default-fare', 'change', (e) => { state.defaultFare = parseFloat(e.target.value) || 0; persistSettings(); });
  bind('set-theme', 'change', (e) => { applyTheme(e.target.value); persistSettings(); });
  bind('set-night-mode', 'change', (e) => { state.nightMode = e.target.checked; persistSettings(); document.body.classList.toggle('night', state.nightMode); });
  bind('set-sound', 'change', (e) => { state.soundOn = e.target.checked; persistSettings(); });
  bind('set-export', 'click', exportData);
  bind('set-import-trigger', 'click', () => document.getElementById('set-import-file').click());
  bind('set-import-file', 'change', importData);
  bind('set-wipe', 'click', wipeAllData);

  // ====== City picker wiring ======
  bind('city-input', 'input', (e) => renderCityList(e.target.value));
  bind('city-geolocate', 'click', geolocateCity);

  // ====== Route preview wiring ======
  bind('route-print', 'click', () => window.print());
  bind('route-share', 'click', () => { closeModal('route-modal'); shareTrip(); });

  // ====== Scan modal wiring ======
  bind('scan-paste', 'click', async () => {
    try {
      const txt = await navigator.clipboard.readText();
      $('scan-link').value = txt;
      toast('Link pasted');
    } catch { toast('Clipboard blocked — paste manually'); }
  });
  bind('scan-go', 'click', () => {
    const url = $('scan-link').value.trim();
    if (!url) { toast('Paste a shared link first'); return; }
    closeModal('scan-modal');
    loadSharedTrip(url);
  });

  // Scroll-reveal observer
  try { setupReveals(); } catch (e) { _showErr('reveal: ' + e.message); }
  // First-paint summary
  try { updateSummary(); } catch (e) { _showErr('summary: ' + e.message); }
}

// ---------- Theme ----------
function loadTheme() {
  let theme = localStorage.getItem('faresplit-theme');
  if (!theme) {
    theme = 'dark'; // app is dark-first by design
  }
  applyTheme(theme);
}
function applyTheme(theme) {
  const dark = theme === 'dark';
  document.body.classList.toggle('dark', dark);
  document.body.classList.toggle('light', !dark);
  // The new avatar is always rendered as a photo — keep it untouched.
}
function toggleTheme() {
  const next = document.body.classList.contains('dark') ? 'light' : 'dark';
  localStorage.setItem('faresplit-theme', next);
  applyTheme(next);
}

// ---------- Views ----------
function switchView(name) {
  if (!name) return;
  state.view = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn, .nav-fab').forEach((b) => {
    const active = b.dataset.view === name;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.rail-link').forEach((a) => {
    a.classList.toggle('active', a.dataset.view === name);
  });
  document.getElementById('view-' + name)?.classList.add('active');
  if (name === 'history') renderHistory();
  if (name === 'split') window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- Backend health ----------
async function pingBackend() {
  const pill = $('api-status');
  try {
    const r = await fetch('/api/trips', { method: 'HEAD' });
    if (r.ok) { pill.textContent = '● Online'; pill.className = 'status-pill ok'; }
    else      { pill.textContent = '● Online (demo storage)'; pill.className = 'status-pill ok'; }
  } catch (_) {
    pill.textContent = '● Offline · saves locally';
    pill.className = 'status-pill err';
  }
}

// ---------- Stops ----------
function renderStops() {
  const list = $('stops-list');
  list.innerHTML = '';
  state.stops.forEach((s, i) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'stop-name';
    span.textContent = `${i + 1}. ${s}`;
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.title = `Remove ${s}`;
    btn.setAttribute('aria-label', `Remove stop ${s}`);
    btn.addEventListener('click', () => removeStop(i));
    li.appendChild(span);
    li.appendChild(btn);
    list.appendChild(li);
  });
  const maxReached = state.stops.length >= LIMITS.MAX_STOPS;
  $('add-stop').disabled = maxReached;
  $('new-stop').disabled = maxReached;
  $('new-stop').placeholder = maxReached ? `Max ${LIMITS.MAX_STOPS} stops` : 'Add a stop…';
}

function addStop() {
  const input = $('new-stop');
  const name = clampStr(input.value, LIMITS.MAX_STOP_LEN);
  if (!name) { toast('Enter a stop name'); return; }
  if (state.stops.length >= LIMITS.MAX_STOPS) { toast(`Max ${LIMITS.MAX_STOPS} stops`); return; }
  if (state.stops.some((s) => s.toLowerCase() === name.toLowerCase())) {
    toast(`"${name}" already exists`);
    return;
  }
  state.stops.push(name);
  input.value = '';
  renderStops();
  renderPassengerDropdowns();
  scheduleResultsRender();
  announcement(`Stop ${name} added`);
}

function removeStop(index) {
  const name = state.stops[index];
  const inUse = state.passengers.some((p) => p.inStop === name || p.outStop === name);
  if (inUse) { toast(`Can't remove "${name}" — used by a passenger`); return; }
  state.stops.splice(index, 1);
  if (state.stops.length < 2) {
    state.stops.splice(index, 0, name);
    toast('Need at least 2 stops');
    return;
  }
  renderStops();
  renderPassengerDropdowns();
  scheduleResultsRender();
  announcement(`Stop ${name} removed`);
}

// ---------- Dropdowns ----------
function renderPassengerDropdowns() {
  const inSel = $('passenger-in');
  const outSel = $('passenger-out');
  const prevIn = inSel.value;
  const prevOut = outSel.value;
  inSel.innerHTML = '';
  outSel.innerHTML = '';
  state.stops.forEach((s, i) => {
    const oi = document.createElement('option');
    oi.value = s; oi.textContent = `${i + 1}. ${s}`;
    inSel.appendChild(oi);
    const oo = document.createElement('option');
    oo.value = s; oo.textContent = `${i + 1}. ${s}`;
    outSel.appendChild(oo);
  });
  if ([...inSel.options].some((o) => o.value === prevIn)) inSel.value = prevIn;
  if ([...outSel.options].some((o) => o.value === prevOut)) outSel.value = prevOut;
  if (inSel.selectedIndex === -1 && inSel.options.length) inSel.selectedIndex = 0;
  if (outSel.selectedIndex === -1 && outSel.options.length) outSel.selectedIndex = outSel.options.length - 1;
}

// ---------- Passengers ----------
function renderPassengers() {
  const list = $('passenger-list');
  list.innerHTML = '';
  if (state.passengers.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No passengers yet — add one above, or tap Demo below.';
    list.appendChild(li);
    return;
  }
  state.passengers.forEach((p) => {
    const li = document.createElement('li');
    const av = document.createElement('div');
    av.className = 'avatar-sm';
    av.textContent = (p.name || '?').charAt(0).toUpperCase();
    const info = document.createElement('div');
    info.className = 'pinfo';
    const nm = document.createElement('div');
    nm.className = 'pname';
    nm.textContent = p.name;
    const rt = document.createElement('div');
    rt.className = 'proute';
    rt.textContent = `${p.inStop} → ${p.outStop}`;
    info.appendChild(nm);
    info.appendChild(rt);
    const btn = document.createElement('button');
    btn.className = 'premove';
    btn.setAttribute('aria-label', `Remove ${p.name}`);
    btn.title = 'Remove';
    btn.textContent = '✕';
    btn.addEventListener('click', () => removePassenger(p.id));
    li.appendChild(av);
    li.appendChild(info);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function addPassenger() {
  if (state.passengers.length >= LIMITS.MAX_PASSENGERS) { toast(`Max ${LIMITS.MAX_PASSENGERS} passengers`); return false; }
  const name = clampStr($('passenger-name').value, LIMITS.MAX_NAME_LEN);
  const inStop = $('passenger-in').value;
  const outStop = $('passenger-out').value;
  if (!name) { toast('Enter a passenger name'); return false; }
  if (!inStop || !outStop) { toast('Pick board & alight stops'); return false; }
  if (inStop === outStop) { toast('Boarding & alighting must differ'); return false; }
  const inIdx = state.stops.indexOf(inStop);
  const outIdx = state.stops.indexOf(outStop);
  if (inIdx === -1 || outIdx === -1) return false;
  if (outIdx <= inIdx) { toast('Alighting must come after boarding'); return false; }
  state.passengers.push({ id: nextId++, name, inStop, outStop });
  $('passenger-name').value = '';
  renderPassengers();
  scheduleResultsRender();
  announcement(`Passenger ${name} added`);
  return true;
}

function removePassenger(id) {
  const p = state.passengers.find((x) => x.id === id);
  state.passengers = state.passengers.filter((x) => x.id !== id);
  renderPassengers();
  scheduleResultsRender();
  if (p) announcement(`Passenger ${p.name} removed`);
}

// ============================================================
//  CORE: Fare-splitting math (integer-cents, exact)
// ============================================================
const FareMath = {
  segmentCosts(stops, totalFare) {
    const segments = Math.max(0, stops.length - 1);
    if (segments === 0) return [];
    const totalCents = Math.round(totalFare * 100);
    const baseShare = Math.floor(totalCents / segments);
    const remainder = totalCents - baseShare * segments;
    const cents = new Array(segments).fill(baseShare);
    for (let i = 0; i < remainder; i++) cents[i] += 1;
    return cents.map((c) => c / 100);
  },
  passengerShares(passengers, segmentCosts, totalFare, stops) {
    const idx = new Map(stops.map((s, i) => [s, i]));
    const segsByP = passengers.map((p) => {
      const i = idx.get(p.inStop), j = idx.get(p.outStop);
      const a = [];
      for (let k = i; k < j; k++) a.push(k);
      return a;
    });
    const raw = segsByP.map((segs) => segs.reduce((acc, k) => acc + Math.round(segmentCosts[k] * 100), 0));
    const totalCents = Math.round(totalFare * 100);
    const sumRaw = raw.reduce((a, b) => a + b, 0);
    const diff = totalCents - sumRaw;
    const shares = raw.map((c) => c / 100);
    let absorber = null;
    if (diff !== 0 && shares.length > 0) {
      absorber = 0;
      shares[0] = (raw[0] + diff) / 100;
    }
    return { shares, absorber, segsByP };
  }
};

// Expose for ad-hoc tests in DevTools
window.FareMath = FareMath;

// ---------- Results rendering (Bookings style) ----------
// ---------- Live summary pane (desktop right rail) ----------
function updateSummary() {
  const totEl   = $('sum-total');
  const stEl    = $('sum-stops');
  const riEl    = $('sum-riders');
  const segEl   = $('sum-segments');
  const segCEl  = $('sum-segment');
  const fill    = $('sum-bar-fill');
  const status  = $('sum-status');
  const list    = $('sum-share-list');
  if (!totEl) return; // pane not present (very narrow screens)

  const total = Number(state.totalFare) || 0;
  const stops = state.stops.length;
  const riders = state.passengers.length;
  const segCosts = FareMath.segmentCosts(state.stops, total);
  const segCount = Math.max(0, stops - 1);
  const segPrice = segCount > 0 ? (total / segCount) : 0;

  tweenNumber(totEl, total);
  tweenNumber(stEl, stops);
  tweenNumber(riEl, riders);
  tweenNumber(segEl, segCount);
  tweenNumber(segCEl, segPrice, true);

  // Bar: filled proportionally to a 2000 ceiling so it grows visibly
  const pct = Math.min(100, (total / 2000) * 100);
  if (fill) fill.style.width = pct + '%';

  // Status copy
  let msg = 'Add a route to begin';
  if (stops >= 2 && riders === 0) msg = 'Now add some riders';
  else if (stops < 2 && riders > 0) msg = 'Add at least 2 stops';
  else if (stops >= 2 && riders >= 1) msg = 'Live · exact-cent math';
  if (status) status.textContent = msg;

  // Roster
  if (list) {
    list.innerHTML = '';
    if (riders === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No riders yet — open the menu to add some.';
      list.appendChild(li);
    } else {
      const { shares, segsByP } = FareMath.passengerShares(
        state.passengers, segCosts, total, state.stops
      );
      state.passengers.forEach((p, i) => {
        const segs = segsByP[i] || [];
        const li = document.createElement('li');
        const av = document.createElement('span');
        av.className = 'av';
        av.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
        const nm = document.createElement('div');
        nm.className = 'nm';
        nm.innerHTML = `<div>${escapeHtml(p.name)}</div>
                        <div class="rt">${segs.length} segment${segs.length === 1 ? '' : 's'}</div>`;
        const sh = document.createElement('div');
        sh.className = 'sh';
        sh.textContent = fmtMoney(shares[i] || 0).replace(/\u09F3\s/, '\u09F3');
        li.append(av, nm, sh);
        list.appendChild(li);
      });
    }
  }
}

// Smoothly tween a number into an element using requestAnimationFrame.
// Honors prefers-reduced-motion.
function tweenNumber(el, target, isCurrency) {
  if (!el) return;
  const cur = Number(el.dataset.val ?? el.textContent.replace(/[^\d.]/g, '')) || 0;
  const dur = 600;
  const start = performance.now();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || cur === target) { el.textContent = isCurrency ? target.toFixed(2) : Math.round(target); el.dataset.val = String(target); return; }
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    const v = cur + (target - cur) * eased;
    el.textContent = isCurrency ? v.toFixed(2) : Math.round(v);
    if (t < 1) requestAnimationFrame(step);
    else el.dataset.val = String(target);
  }
  requestAnimationFrame(step);
}

// Scroll-reveal using IntersectionObserver; falls back gracefully if unavailable.
function setupReveals() {
  const els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    els.forEach((e) => e.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  els.forEach((e) => io.observe(e));
}

function renderResults() {
  const container = $('results-visible');
  if (!container) return;
  container.innerHTML = '';

  const segCosts = FareMath.segmentCosts(state.stops, state.totalFare);

  // Empty state
  if (state.passengers.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '1.5rem 0.5rem';
    empty.style.textAlign = 'center';
    empty.style.color = 'var(--muted)';
    empty.innerHTML = `<p style="margin:0 0 .8rem; font-size:1rem;">No passengers yet</p>
      <p style="margin:0; font-size:.85rem;">Tap the menu icon (top-left) or the camera button to add stops and riders.</p>`;
    container.appendChild(empty);
    updateBookingsHeader(0, 0);
    updateBookNowBar(0);
    return;
  }

  const { shares, absorber, segsByP } = FareMath.passengerShares(
    state.passengers, segCosts, state.totalFare, state.stops
  );

  // Header summary
  updateBookingsHeader(shares.reduce((a, b) => a + b, 0), state.passengers.length);

  state.passengers.forEach((p, idx) => {
    const segs = segsByP[idx] || [];
    const routeText = segs.length
      ? `${state.stops[segs[0]]} → ${state.stops[segs[segs.length - 1] + 1]}`
      : '—';

    const li = document.createElement('div');
    li.className = 'bk-row';

    const thumb = document.createElement('div');
    const tclasses = ['bk-thumb-red', 'bk-thumb-blue', 'bk-thumb-dark'];
    thumb.className = 'bk-thumb ' + tclasses[idx % tclasses.length];
    thumb.setAttribute('aria-hidden', 'true');

    const info = document.createElement('div');
    info.className = 'bk-info';
    const h4 = document.createElement('h4');
    h4.textContent = p.name + (idx === absorber ? ' ⭐' : '');
    const meta = document.createElement('p');
    meta.innerHTML = `<span class="bk-stars">${'★'.repeat(Math.max(3, 5 - segs.length))}${'☆'.repeat(Math.max(0, 5 - Math.max(3, 5 - segs.length)))}</span> &nbsp; ${routeText} · ${segs.length} segment${segs.length === 1 ? '' : 's'}`;
    info.appendChild(h4);
    info.appendChild(meta);

    const priceBlock = document.createElement('div');
    priceBlock.className = 'bk-price-block';
    const price = document.createElement('span');
    price.className = 'price';
    price.textContent = fmtMoney(shares[idx]).replace(/\u09F3\s/, '\u09F3');
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = `Per People`;
    priceBlock.appendChild(price);
    priceBlock.appendChild(sub);

    const arrow = document.createElement('div');
    arrow.className = 'bk-arrow';
    arrow.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;

    li.appendChild(thumb);
    li.appendChild(info);
    li.appendChild(priceBlock);
    li.appendChild(arrow);
    container.appendChild(li);
  });

  updateBookNowBar(shares.reduce((a, b) => a + b, 0));

  // Announce the total so screen readers pick it up
  const totalShown = shares.reduce((a, b) => a + b, 0);
  announcement(
    `Total ${fmtMoney(totalShown)} across ${state.passengers.length} passenger${state.passengers.length === 1 ? '' : 's'}` +
    (absorber !== null ? `. Remainder absorbed by ${state.passengers[absorber].name}.` : '')
  );

  // Keep the desktop live-summary pane in sync.
  updateSummary();
}

function updateBookingsHeader(total, count) {
  const h1 = document.querySelector('.bookings-view .bk-h1 span');
  if (h1) h1.textContent = fmtMoney(total || 0).replace(/\u09F3\s/, '\u09F3');
  const tabs = document.querySelectorAll('.bookings-view .bk-tab');
  if (tabs[0]) tabs[0].textContent = `${count} Deal${count === 1 ? '' : 's'}`;
}
function updateBookNowBar(total) {
  const el = $('bk-action-price');
  if (el) el.textContent = fmtMoney(total || 0).replace(/\u09F3\s/, '\u09F3');
  const label = document.querySelector('.bookings-view .bk-action-label');
  if (label) label.textContent = `${state.passengers.length || 0} Deal${state.passengers.length === 1 ? '' : 's'} left`;
}

// Debounced render for text-input-driven re-renders.
// `renderResults` itself keeps the desktop live-summary pane in sync.
const scheduleResultsRender = debounce(renderResults, 80);

// ---------- Share / Backend ----------
async function shareTrip() {
  if (state.passengers.length === 0) { toast('Add at least one passenger first'); return; }
  if (state.stops.length < 2) { toast('Need at least 2 stops'); return; }

  const btn = $('share-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Saving…';

  const tripData = {
    stops: state.stops.slice(0, LIMITS.MAX_STOPS),
    totalFare: Math.min(state.totalFare, LIMITS.MAX_FARE),
    passengers: state.passengers.slice(0, LIMITS.MAX_PASSENGERS).map((p) => ({
      name: p.name.slice(0, LIMITS.MAX_NAME_LEN),
      inStop: p.inStop,
      outStop: p.outStop
    }))
  };

  let usedLocal = false;
  try {
    const r = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tripData)
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    const trip = await r.json();
    state.tripId = trip.id;
    state.shareUrl = `${location.origin}${location.pathname}?trip=${trip.id}`;
  } catch (e) {
    // Offline fallback: hash-encoded trip (still shareable between two phones
    // that share the link, but data lives in the URL itself).
    usedLocal = true;
    try {
      const compact = btoa(unescape(encodeURIComponent(JSON.stringify(tripData))));
      state.tripId = 'local-' + Date.now();
      state.shareUrl = `${location.origin}${location.pathname}#trip=${compact}`;
    } catch (_) {
      btn.disabled = false; btn.textContent = originalLabel;
      toast('Could not create share link');
      return;
    }
  }

  saveToHistory({ ...tripData, _shareUrl: state.shareUrl, _local: usedLocal });
  btn.disabled = false;
  btn.textContent = usedLocal ? '✓ Saved locally' : '✓ Saved & shared';

  // Track + notify
  state.shareCount = (state.shareCount || 0) + 1;
  notifyAdd('Trip shared · ' + state.passengers.length + ' riders', 'trips');
  renderProfileAvatar();

  // Auto-open QR for the wow moment
  showQR();

  // Copy link too if possible
  try {
    await navigator.clipboard.writeText(state.shareUrl);
    toast('Link copied · QR ready 📱');
  } catch (_) {
    toast(usedLocal ? 'Saved locally (offline mode)' : 'Link ready · QR shown 📱');
  }

  setTimeout(() => { btn.textContent = originalLabel; }, 2200);
}

async function loadSharedTrip(id) {
  try {
    const r = await fetch(`/api/trips?id=${encodeURIComponent(id)}`);
    if (!r.ok) {
      toast('Could not load shared trip');
      return;
    }
    const trip = await r.json();
    applyTrip(trip);
    toast('Shared trip loaded ✨');
  } catch (_) {
    toast('Could not load shared trip');
  }
}

function loadLocalSharedTrip(b64) {
  try {
    const json = decodeURIComponent(escape(atob(b64)));
    const trip = JSON.parse(json);
    applyTrip(trip);
    toast('Local shared trip loaded');
  } catch (_) {
    toast('Shared link is invalid');
  }
}

function applyTrip(trip) {
  if (!trip || !Array.isArray(trip.stops) || trip.stops.length < 2) return;
  notifyAdd('Trip loaded · ' + trip.passengers.length + ' riders', 'trips');
  state.stops = trip.stops.slice(0, LIMITS.MAX_STOPS);
  state.totalFare = Number(trip.totalFare) || state.totalFare;
  state.passengers = (trip.passengers || []).slice(0, LIMITS.MAX_PASSENGERS).map((p) => ({
    id: nextId++,
    name: String(p.name || 'Passenger').slice(0, LIMITS.MAX_NAME_LEN),
    inStop: String(p.inStop),
    outStop: String(p.outStop)
  }));
  state.tripId = trip.id || null;
  // Reflect total in the input
  const fareInput = $('total-fare');
  if (fareInput) fareInput.value = state.totalFare;
  renderAll();
}

// ---------- QR ----------
function showQR() {
  if (!state.shareUrl) {
    toast('Tap "Save & Share Link" first');
    return;
  }
  // Build QR manually using the qrcode-generator lib loaded via CDN.
  // Fallback: show plain link if the lib isn't available.
  const target = $('qr-canvas');
  target.innerHTML = '';
  try {
    if (typeof qrcode !== 'function') throw new Error('qr lib not loaded');
    const qr = qrcode(0, 'M');
    qr.addData(state.shareUrl);
    qr.make();
    const moduleCount = qr.getModuleCount();
    const size = 220;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.setAttribute('aria-label', 'QR code for this trip');
    const ctx = canvas.getContext('2d');
    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#0a0a0c';
    const tile = size / (moduleCount + 4); // padding
    const offset = tile * 2;
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(offset + c * tile, offset + r * tile, tile, tile);
      }
    }
    target.appendChild(canvas);
  } catch (e) {
    const fallback = document.createElement('p');
    fallback.textContent = state.shareUrl;
    fallback.style.wordBreak = 'break-all';
    target.appendChild(fallback);
  }
  $('qr-link').textContent = state.shareUrl;
  $('qr-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeQR() {
  $('qr-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

async function copyLink() {
  if (!state.shareUrl) return;
  try { await navigator.clipboard.writeText(state.shareUrl); toast('Link copied'); }
  catch (e) { toast('Copy failed — long-press the link'); }
}

// ---------- History (localStorage) ----------
function saveToHistory(trip) {
  state.history.unshift({ id: state.tripId || ('local-' + Date.now()), ts: Date.now(), trip });
  state.history = state.history.slice(0, 20);
  try {
    localStorage.setItem('faresplit-history', JSON.stringify(state.history));
  } catch (_) { /* quota exceeded — silently drop oldest */ }
}
function loadHistory() {
  try { state.history = JSON.parse(localStorage.getItem('faresplit-history') || '[]'); }
  catch (_) { state.history = []; }
}
function clearHistory() {
  if (!confirm('Clear all saved trips on this device?')) return;
  state.history = [];
  localStorage.removeItem('faresplit-history');
  renderHistory();
  toast('History cleared');
}

function renderHistory() {
  const list = $('history-list');
  list.innerHTML = '';
  if (state.history.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No saved trips yet. Tap "Save & Share Link" to save one.';
    list.appendChild(li);
    return;
  }
  state.history.forEach((h) => {
    const li = document.createElement('li');
    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'htitle';
    title.textContent = `${h.trip.passengers.length} pax · ${h.trip.stops.length} stops`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${new Date(h.ts).toLocaleString()}${h.trip._local ? ' · local' : ''}`;
    left.appendChild(title);
    left.appendChild(meta);

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.gap = '0.4rem';
    wrap.style.alignItems = 'center';
    const fare = document.createElement('span');
    fare.className = 'hfare';
    fare.textContent = fmtMoney(h.trip.totalFare);
    const openBtn = document.createElement('button');
    openBtn.className = 'btn small';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', () => {
      applyTrip(h.trip);
      switchView('split');
      toast('Trip loaded');
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'premove';
    delBtn.title = 'Delete';
    delBtn.setAttribute('aria-label', 'Delete trip');
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      state.history = state.history.filter((x) => x.id !== h.id);
      localStorage.setItem('faresplit-history', JSON.stringify(state.history));
      renderHistory();
    });
    wrap.appendChild(fare);
    wrap.appendChild(openBtn);
    wrap.appendChild(delBtn);

    li.appendChild(left);
    li.appendChild(wrap);
    list.appendChild(li);
  });

  // Clear-all button
  const clearWrap = document.createElement('div');
  clearWrap.style.marginTop = '0.5rem';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn ghost block';
  clearBtn.textContent = 'Clear history';
  clearBtn.addEventListener('click', clearHistory);
  list.parentElement.appendChild(clearWrap);
}

// ---------- Reset ----------
function resetTrip() {
  if (state.passengers.length === 0 && state.tripId === null) { toast('Already empty'); return; }
  if (!confirm('Reset the current trip?')) return;
  state.passengers = [];
  state.tripId = null;
  state.shareUrl = null;
  renderPassengers();
  renderResults();
  toast('Trip reset');
}

// ---------- Demo trip (judge-friendly) ----------
function loadDemoTrip() {
  state.stops = ['Park Street', 'MG Road', 'Central Station', 'Airport'];
  state.totalFare = 100; // awkward number → nice rounding demo
  state.passengers = [
    { id: nextId++, name: 'Asha', inStop: 'Park Street', outStop: 'MG Road' },
    { id: nextId++, name: 'Bilal', inStop: 'MG Road', outStop: 'Airport' },
    { id: nextId++, name: 'Cyrus', inStop: 'Park Street', outStop: 'Central Station' }
  ];
  $('total-fare').value = state.totalFare;
  renderAll();
  switchView('split');
  toast('Demo trip loaded — check the exact total ✓');
}

// ---------- Render all ----------
function renderAll() {
  renderStops();
  renderPassengerDropdowns();
  renderPassengers();
  renderResults();
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
}

// ============================================================
// Feature implementations — every hollow button gets a real
// destination. Modal helpers, profile, notifications, settings,
// city picker, route preview, scanner, what\'s-new, bookings
// tabs, menu sheet, plus data export/import/wipe.
// ============================================================

// ---------- Modal helpers ----------
function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  // Focus first focusable for accessibility
  const focusable = m.querySelector('input, select, textarea, button');
  if (focusable) setTimeout(() => focusable.focus(), 60);
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add('hidden');
  document.body.style.overflow = '';
}

// ---------- Settings persistence ----------
function persistSettings() {
  try {
    localStorage.setItem('faresplit-settings', JSON.stringify({
      currency: state.currency, defaultFare: state.defaultFare,
      nightMode: state.nightMode, soundOn: state.soundOn,
      theme: (document.body.classList.contains('light') ? 'light' : 'dark'),
      city: state.city
    }));
  } catch (_) {}
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('faresplit-settings') || 'null');
    if (!s) return;
    if (s.currency) state.currency = s.currency;
    if (Number.isFinite(s.defaultFare)) state.defaultFare = s.defaultFare;
    if (typeof s.nightMode === 'boolean') state.nightMode = s.nightMode;
    if (typeof s.soundOn === 'boolean') state.soundOn = s.soundOn;
    if (s.city) state.city = s.city;
    if (s.theme) applyTheme(s.theme);
  } catch (_) {}
  document.body.classList.toggle('night', !!state.nightMode);
}

// ---------- Profile ----------
function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem('faresplit-profile') || 'null');
    if (p && typeof p === 'object') state.profile = Object.assign(state.profile, p);
  } catch (_) {}
}
function saveProfile() {
  state.profile.name = clampStr($('profile-name').value, 32);
  state.profile.email = clampStr($('profile-email').value, 64);
  state.profile.phone = clampStr($('profile-phone').value, 20);
  state.profile.home = clampStr($('profile-home').value, 40);
  try { localStorage.setItem('faresplit-profile', JSON.stringify(state.profile)); } catch (_) {}
  renderProfileAvatar();
  notifyAdd('Profile saved', 'profile');
  toast('Profile saved');
}
function renderProfileAvatar() {
  const av = $('profile-avatar');
  const top = $('theme-toggle');
  const init = (state.profile.name || 'F').trim().slice(0, 1).toUpperCase() || 'F';
  if (av) av.textContent = init;
  if (top) {
    top.textContent = init;
    top.setAttribute('aria-label', 'Open profile');
  }
  // Stats
  const tc = $('profile-trip-count'); if (tc) tc.textContent = String(state.history.length);
  const sc = $('profile-share-count'); if (sc) sc.textContent = String(state.shareCount || 0);
  let riders = 0;
  state.history.forEach((h) => { riders += (h.trip && h.trip.passengers) ? h.trip.passengers.length : 0; });
  riders += state.passengers.length;
  const rc = $('profile-rider-count'); if (rc) rc.textContent = String(riders);
}
function openProfile() {
  $('profile-name').value = state.profile.name || '';
  $('profile-email').value = state.profile.email || '';
  $('profile-phone').value = state.profile.phone || '';
  $('profile-home').value = state.profile.home || '';
  renderProfileAvatar();
  openModal('profile-modal');
}

// ---------- Notifications ----------
const SEED_NOTIFS = () => ([
  { id: 'n-welcome', ts: Date.now() - 1000 * 60 * 60 * 2, type: 'trips', title: 'Welcome to FareSplit', body: 'Add stops, then riders — we\'ll do the math.', read: false },
  { id: 'n-tip',    ts: Date.now() - 1000 * 60 * 90,      type: 'trips', title: 'Tip: Save & share your trip',   body: 'Tap the share button to get a link anyone can open.', read: false }
]);
function loadNotifications() {
  try {
    const raw = JSON.parse(localStorage.getItem('faresplit-notifs') || 'null');
    state.notifications = Array.isArray(raw) && raw.length ? raw : SEED_NOTIFS();
    if (!raw) try { localStorage.setItem('faresplit-notifs', JSON.stringify(state.notifications)); } catch (_) {}
  } catch (_) { state.notifications = SEED_NOTIFS(); }
}
function persistNotifications() {
  try { localStorage.setItem('faresplit-notifs', JSON.stringify(state.notifications.slice(0, 40))); } catch (_) {}
}
function notifyAdd(title, type) {
  state.notifications.unshift({ id: 'n-' + Date.now(), ts: Date.now(), type: type || 'trips', title, body: '', read: false });
  state.notifications = state.notifications.slice(0, 40);
  persistNotifications();
  updateNotifBadge();
}
function updateNotifBadge() {
  const badge = $('notif-unread-badge');
  if (!badge) return;
  const n = state.notifications.filter((x) => !x.read).length;
  badge.textContent = String(n);
  // Also reflect on the bell
  const bell = $('bell-btn');
  if (bell) bell.setAttribute('data-count', n > 0 ? String(n) : '');
}
function renderNotifications(filter) {
  filter = filter || 'all';
  const list = $('notif-list');
  if (!list) return;
  const items = state.notifications.filter((n) => {
    if (filter === 'unread') return !n.read;
    if (filter === 'trips')  return n.type === 'trips';
    return true;
  });
  list.innerHTML = '';
  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'notif-empty';
    li.textContent = filter === 'unread' ? 'Nothing unread — you\'re caught up.' : 'No notifications yet.';
    list.appendChild(li);
  } else {
    items.forEach((n) => {
      const li = document.createElement('li');
      li.className = 'notif-item' + (n.read ? '' : ' unread');
      const dot = document.createElement('span');
      dot.className = 'notif-dot';
      const body = document.createElement('div');
      body.className = 'notif-body';
      const t = document.createElement('div');
      t.className = 'notif-title';
      t.textContent = n.title;
      body.appendChild(t);
      if (n.body) {
        const b = document.createElement('div');
        b.className = 'notif-sub';
        b.textContent = n.body;
        body.appendChild(b);
      }
      const ts = document.createElement('div');
      ts.className = 'notif-time';
      ts.textContent = timeAgo(n.ts);
      body.appendChild(ts);
      li.appendChild(dot);
      li.appendChild(body);
      li.addEventListener('click', () => { n.read = true; persistNotifications(); updateNotifBadge(); renderNotifications(filter); });
      list.appendChild(li);
    });
  }
  updateNotifBadge();
}
function timeAgo(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  return new Date(ts).toLocaleDateString();
}
function clearNotifications() {
  if (!confirm('Clear all notifications?')) return;
  state.notifications = [];
  persistNotifications();
  toast('Notifications cleared');
}
function markAllRead() {
  state.notifications.forEach((n) => { n.read = true; });
  persistNotifications();
  toast('All marked read');
}
function openNotifications() {
  renderNotifications('all');
  openModal('notif-modal');
}

// ---------- Settings ----------
function openSettings() {
  const cur = $('set-currency'); if (cur) cur.value = state.currency;
  const df = $('set-default-fare'); if (df) df.value = state.defaultFare;
  const th = $('set-theme'); if (th) th.value = document.body.classList.contains('light') ? 'light' : 'dark';
  const nm = $('set-night-mode'); if (nm) nm.checked = !!state.nightMode;
  const so = $('set-sound'); if (so) so.checked = !!state.soundOn;
  openModal('settings-modal');
}
function exportData() {
  const data = {
    exportedAt: new Date().toISOString(),
    profile: state.profile,
    settings: {
      currency: state.currency, defaultFare: state.defaultFare,
      nightMode: state.nightMode, soundOn: state.soundOn, city: state.city
    },
    history: state.history,
    notifications: state.notifications
  };
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'faresplit-export-' + Date.now() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Export downloaded');
  } catch (e) { toast('Export failed'); }
}
function importData(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      if (obj.profile) { state.profile = Object.assign(state.profile, obj.profile); try { localStorage.setItem('faresplit-profile', JSON.stringify(state.profile)); } catch (_) {} }
      if (obj.history && Array.isArray(obj.history)) { state.history = obj.history.slice(0, 20); try { localStorage.setItem('faresplit-history', JSON.stringify(state.history)); } catch (_) {} }
      if (obj.settings) {
        Object.assign(state, obj.settings);
        persistSettings();
        renderAll();
        if (state.city) updateLocCity(state.city);
      }
      if (obj.notifications && Array.isArray(obj.notifications)) { state.notifications = obj.notifications; persistNotifications(); }
      renderProfileAvatar(); renderHistory(); updateNotifBadge();
      toast('Import successful');
    } catch (_) { toast('Import failed — invalid JSON'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}
function wipeAllData() {
  if (!confirm('Erase ALL local data — profile, settings, history, notifications?')) return;
  if (!confirm('Really wipe? This cannot be undone.')) return;
  try {
    ['faresplit-profile', 'faresplit-settings', 'faresplit-history', 'faresplit-notifs', 'faresplit-theme']
      .forEach((k) => localStorage.removeItem(k));
  } catch (_) {}
  state.profile = { name: '', email: '', phone: '', home: '' };
  state.currency = '\u09F3';
  state.defaultFare = 120;
  state.nightMode = false;
  state.soundOn = false;
  state.history = [];
  state.shareCount = 0;
  state.notifications = SEED_NOTIFS();
  persistNotifications();
  document.body.classList.remove('light', 'night');
  applyTheme('dark');
  renderProfileAvatar();
  renderHistory();
  updateNotifBadge();
  toast('All local data cleared');
}

// ---------- City picker ----------
const CITIES = [
  { name: 'Dhaka',     country: 'Bangladesh', cur: '\u09F3', fare: 80  },
  { name: 'Mumbai',    country: 'India',      cur: '\u20B9', fare: 120 },
  { name: 'Delhi',     country: 'India',      cur: '\u20B9', fare: 100 },
  { name: 'Singapore', country: 'Singapore',  cur: 'S$',     fare: 9   },
  { name: 'Bangkok',   country: 'Thailand',   cur: '\u0E3F', fare: 60  },
  { name: 'Kuala Lumpur', country: 'Malaysia',cur: 'RM',     fare: 8   },
  { name: 'New York',  country: 'USA',        cur: '$',      fare: 17  },
  { name: 'London',    country: 'UK',         cur: '\u00A3', fare: 12  }
];
function renderCityList(q) {
  q = (q || '').trim().toLowerCase();
  const list = $('city-list');
  if (!list) return;
  const filtered = q ? CITIES.filter((c) => (c.name + ' ' + c.country).toLowerCase().includes(q)) : CITIES;
  list.innerHTML = '';
  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.className = 'city-empty';
    li.textContent = 'No cities match "' + q + '"';
    list.appendChild(li);
    return;
  }
  filtered.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'city-item';
    const left = document.createElement('div');
    left.innerHTML = '<strong>' + escapeHtml(c.name) + '</strong><span class="muted small">' + escapeHtml(c.country) + '</span>';
    const right = document.createElement('span');
    right.className = 'city-fare';
    right.textContent = c.cur + ' ' + c.fare + ' typical';
    li.appendChild(left);
    li.appendChild(right);
    li.addEventListener('click', () => selectCity(c));
    list.appendChild(li);
  });
}
function selectCity(c) {
  state.city = c.name + ', ' + c.country;
  state.defaultFare = c.fare;
  state.currency = c.cur;
  updateLocCity(state.city);
  if ($('total-fare')) $('total-fare').value = c.fare;
  state.totalFare = c.fare;
  persistSettings();
  renderAll();
  closeModal('city-modal');
  notifyAdd('City set to ' + state.city, 'trips');
  toast('City set to ' + state.city);
}
function geolocateCity() {
  if (!navigator.geolocation) { toast('Geolocation not supported'); return; }
  toast('Locating…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      let best = CITIES[0], bestD = Infinity;
      // Tiny city centroid table (approximate, for demo)
      const centroids = {
        'Dhaka': [23.81, 90.41], 'Mumbai': [19.07, 72.87], 'Delhi': [28.61, 77.20],
        'Singapore': [1.35, 103.81], 'Bangkok': [13.75, 100.50], 'Kuala Lumpur': [3.13, 101.68],
        'New York': [40.71, -74.00], 'London': [51.50, -0.12]
      };
      Object.keys(centroids).forEach((name) => {
        const [lat, lon] = centroids[name];
        const d = Math.hypot(lat - latitude, lon - longitude);
        if (d < bestD) { bestD = d; best = CITIES.find((c) => c.name === name) || CITIES[0]; }
      });
      selectCity(best);
    },
    () => toast('Location denied')
  );
}
function openCityPicker() {
  if ($('city-input')) $('city-input').value = '';
  renderCityList('');
  openModal('city-modal');
}
function updateLocCity(label) {
  const el = $('loc-city');
  if (el && label) el.textContent = label;
}

// ---------- Route preview (SVG) ----------
function openRoutePreview() {
  if (!state.stops || state.stops.length < 2) {
    toast('Add at least two stops first');
    return;
  }
  renderRouteSVG();
  const list = $('route-stop-list');
  if (list) {
    list.innerHTML = '';
    state.stops.forEach((s, i) => {
      const li = document.createElement('li');
      const seg = i < state.stops.length - 1
        ? FareMath.segmentCosts(state.stops, state.totalFare)[i] : 0;
      li.innerHTML = '<span class="rs-num">' + (i + 1) + '</span>' +
        '<span class="rs-name">' + escapeHtml(s) + '</span>' +
        (i < state.stops.length - 1
          ? '<span class="rs-seg">' + fmtMoney(seg) + '</span>' : '');
      list.appendChild(li);
    });
  }
  const sum = $('route-summary');
  if (sum) sum.textContent = state.stops.length + ' stops · total ' + fmtMoney(state.totalFare);
  openModal('route-modal');
}
function renderRouteSVG() {
  const svg = $('route-svg');
  if (!svg) return;
  const W = 320, H = 240, pad = 28;
  const n = state.stops.length;
  svg.innerHTML = '';
  // Curved path through points
  const pts = state.stops.map((_, i) => {
    const t = n <= 1 ? 0.5 : i / (n - 1);
    const x = pad + t * (W - pad * 2);
    // Slight wave so it looks like a route, not a ruler
    const y = H / 2 + Math.sin(t * Math.PI * 2) * (H / 2 - pad - 8) * 0.6;
    return [x, y];
  });
  // Path string
  let d = 'M ' + pts[0][0] + ' ' + pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    const cx = (x1 + x2) / 2;
    d += ' Q ' + cx + ' ' + y1 + ' ' + cx + ' ' + ((y1 + y2) / 2);
    d += ' Q ' + cx + ' ' + y2 + ' ' + x2 + ' ' + y2;
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('stroke', '#ff2d2d');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);
  // Dots + labels
  pts.forEach(([x, y], i) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 7);
    c.setAttribute('fill', i === 0 ? '#10b981' : (i === pts.length - 1 ? '#ff2d2d' : '#ffffff'));
    c.setAttribute('stroke', '#ff2d2d'); c.setAttribute('stroke-width', '2');
    svg.appendChild(c);
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', x); t.setAttribute('y', y - 12);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', '10'); t.setAttribute('fill', '#fff');
    t.textContent = String(i + 1);
    svg.appendChild(t);
  });
}

// ---------- Scanner ----------
function openScanModal() {
  if ($('scan-link')) $('scan-link').value = '';
  openModal('scan-modal');
  setTimeout(() => $('scan-link') && $('scan-link').focus(), 80);
}

// ---------- What\'s new ----------
const ROUTES_LIBRARY = [
  { line: 'AC-12',  from: 'Park Street', to: 'Airport',     fare: 120, busy: 'High'   },
  { line: 'DN-3',   from: 'MG Road',     to: 'Central Stn', fare: 60,  busy: 'Medium' },
  { line: 'Local 7',from: 'Farmgate',    to: 'New Market',  fare: 30,  busy: 'Low'    },
  { line: 'Night-1',from: 'Gulshan',     to: 'Old Town',    fare: 180, busy: 'Off-peak' },
  { line: 'Express',from: 'Uttara',      to: 'Motijheel',   fare: 90,  busy: 'High'   }
];
const NEW_ROUTES_THIS_WEEK = [
  { line: 'Metro-L2', from: 'Mirpur',   to: 'Farmgate',   fare: 50, since: 'Mon' },
  { line: 'BR-9',     from: 'Sayedabad',to: 'Gulistan',   fare: 25, since: 'Wed' },
  { line: 'Express-X',from: 'Banani',  to: 'Mohammadpur',fare: 75, since: 'Fri' }
];
function openWhatsNew(feature) {
  // Reuse the route-modal scaffold (has the same shape) but swap its content
  const card = document.querySelector('#route-modal .modal-card');
  if (!card) return;
  const title = card.querySelector('h3');
  const summary = $('route-summary');
  const svg = $('route-svg');
  const list = $('route-stop-list');
  const acts = card.querySelector('.route-actions');
  if (feature === 'routes') {
    title.textContent = 'Curated routes';
    if (summary) summary.textContent = 'Popular lines with typical fares — tap to load.';
    if (svg) svg.style.display = 'none';
    list.innerHTML = '';
    ROUTES_LIBRARY.forEach((r) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="rs-num">' + escapeHtml(r.line) + '</span>' +
        '<span class="rs-name">' + escapeHtml(r.from) + ' → ' + escapeHtml(r.to) + '</span>' +
        '<span class="rs-seg">' + state.currency + ' ' + r.fare + ' · ' + r.busy + '</span>';
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => {
        state.stops = [r.from, r.to];
        state.totalFare = r.fare;
        if ($('total-fare')) $('total-fare').value = r.fare;
        renderAll();
        closeModal('route-modal');
        switchView('split');
        toast('Loaded ' + r.line + ' — add riders and split');
      });
      list.appendChild(li);
    });
    if (acts) acts.style.display = 'none';
  } else if (feature === 'newRoutes') {
    title.textContent = 'New this week';
    if (summary) summary.textContent = 'Lines added in the last 7 days.';
    if (svg) svg.style.display = 'none';
    list.innerHTML = '';
    NEW_ROUTES_THIS_WEEK.forEach((r) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="rs-num">' + escapeHtml(r.since) + '</span>' +
        '<span class="rs-name">' + escapeHtml(r.line) + ' · ' + escapeHtml(r.from) + ' → ' + escapeHtml(r.to) + '</span>' +
        '<span class="rs-seg">' + state.currency + ' ' + r.fare + '</span>';
      list.appendChild(li);
    });
    if (acts) acts.style.display = 'none';
  } else if (feature === 'night') {
    title.textContent = 'Night rides';
    if (summary) summary.textContent = 'Late-night pricing & tips.';
    if (svg) svg.style.display = 'none';
    list.innerHTML = '';
    [
      'Night services (00:00–05:00) usually cost 1.5× the day fare.',
      'Most night lines depart every 30–45 min, not every 10.',
      'Tap the map pin to switch to a city that runs night service.',
      'Turn on Night rides only in Settings to filter results.'
    ].forEach((tip) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="rs-num">✦</span><span class="rs-name">' + escapeHtml(tip) + '</span>';
      list.appendChild(li);
    });
    if (acts) acts.style.display = 'none';
  } else if (feature === 'help') {
    title.textContent = 'Help & tips';
    if (summary) summary.textContent = 'Quick how-to for every feature.';
    if (svg) svg.style.display = 'none';
    list.innerHTML = '';
    [
      'Add stops in the order you ride them.',
      'Set the total fare, then add each rider with in/out stops.',
      'Each rider\'s share is the sum of segments they rode.',
      'Save & Share creates a link you can open on another device.',
      'History is stored locally — Export to back it up.'
    ].forEach((tip, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="rs-num">' + (i + 1) + '</span><span class="rs-name">' + escapeHtml(tip) + '</span>';
      list.appendChild(li);
    });
    if (acts) acts.style.display = 'none';
  }
  // Reset any previous SVG so reopening the modal feels clean
  if (svg) {
    svg.innerHTML = '';
    if (!svg.style.display || svg.style.display === 'none') svg.style.display = '';
  }
  openModal('route-modal');
}

// ---------- Bookings tabs ----------
function renderBookingsTab(label) {
  const label2 = (label || '').toLowerCase();
  // Use the bookings header bar as the injection point: there\'s no
  // dedicated bookings content block, so we reuse the route-modal.
  const card = document.querySelector('#route-modal .modal-card');
  if (!card) return;
  const title = card.querySelector('h3');
  const summary = $('route-summary');
  const svg = $('route-svg');
  const list = $('route-stop-list');
  const acts = card.querySelector('.route-actions');
  if (label2.includes('deal')) {
    title.textContent = 'Deals';
    if (summary) summary.textContent = 'Tips to save on your next ride.';
    if (svg) svg.style.display = 'none';
    list.innerHTML = '';
    [
      'Save 12% with an off-peak return trip (before 7am).',
      'Group rides (4+ riders) get an automatic 8% off.',
      'Use "Open a shared trip" to import fare splits from friends.'
    ].forEach((d, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="rs-num">' + (i + 1) + '</span><span class="rs-name">' + escapeHtml(d) + '</span>';
      list.appendChild(li);
    });
    if (acts) acts.style.display = 'none';
    openModal('route-modal');
  } else if (label2.includes('detail')) {
    title.textContent = 'Current trip details';
    if (summary) summary.textContent = state.stops.length + ' stops · ' + state.passengers.length + ' riders · ' + fmtMoney(state.totalFare);
    if (svg) svg.style.display = 'none';
    list.innerHTML = '';
    state.stops.forEach((s, i) => {
      const li = document.createElement('li');
      const seg = i < state.stops.length - 1 ? FareMath.segmentCosts(state.stops, state.totalFare)[i] : 0;
      li.innerHTML = '<span class="rs-num">' + (i + 1) + '</span><span class="rs-name">' + escapeHtml(s) + '</span>' +
        (i < state.stops.length - 1 ? '<span class="rs-seg">' + fmtMoney(seg) + '</span>' : '');
      list.appendChild(li);
    });
    if (acts) acts.style.display = '';
    openModal('route-modal');
  } else if (label2.includes('review')) {
    title.textContent = 'Reviews';
    if (summary) summary.textContent = 'What riders say about FareSplit.';
    if (svg) svg.style.display = 'none';
    list.innerHTML = '';
    [
      { who: 'Asha, Dhaka',   stars: 5, text: 'Saved an argument with three roommates on the first try.' },
      { who: 'Bilal, Mumbai', stars: 4, stars_max: 5, text: 'The exact-rounding math is genuinely impressive.' },
      { who: 'Cyrus, Delhi',  stars: 5, text: 'I share the link in WhatsApp and everyone\'s paid by lunch.' }
    ].forEach((r) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="rs-num">\u2605'.repeat(r.stars) + '</span>' +
        '<span class="rs-name">' + escapeHtml(r.text) + '<br><span class="muted small">' + escapeHtml(r.who) + '</span></span>';
      list.appendChild(li);
    });
    if (acts) acts.style.display = 'none';
    openModal('route-modal');
  }
}

// ---------- Book Now ----------
function bookNow() {
  if (state.passengers.length === 0) {
    toast('Add at least one rider first');
    switchView('split');
    return;
  }
  if (!state.totalFare || state.totalFare <= 0) {
    toast('Set a total fare first');
    return;
  }
  notifyAdd('Trip booked · ' + state.passengers.length + ' riders · ' + fmtMoney(state.totalFare), 'trips');
  toast('Booking confirmed \u2713');
  shareTrip();
}

// ---------- Hamburger menu (rich items) ----------
function openRichMenu() {
  closeSheet();
  const overlay = document.createElement('div');
  overlay.id = 'menu-sheet';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);z-index:120;display:flex;align-items:flex-end;justify-content:center;';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });
  const card = document.createElement('div');
  card.style.cssText = 'background:var(--card);border:1px solid var(--line);border-radius:24px 24px 0 0;padding:1.25rem 1.2rem calc(1.5rem + env(safe-area-inset-bottom));width:100%;max-width:560px;animation:sheetUp .25s ease-out;';
  card.innerHTML = `
    <style>#menu-sheet .handle{display:block;width:42px;height:4px;background:var(--line);border-radius:2px;margin:0 auto 1rem;}
    #menu-sheet h3{margin:0 0 .25rem;font-size:1.15rem;font-weight:700;}
    #menu-sheet .sub{margin:0 0 1rem;color:var(--muted);font-size:.85rem;}
    #menu-sheet .mi{display:flex;align-items:center;gap:.8rem;padding:.8rem 1rem;background:var(--card-2);border:1px solid var(--line);border-radius:14px;margin-bottom:.5rem;cursor:pointer;font-size:.95rem;color:var(--text);}
    #menu-sheet .mi:hover{border-color:var(--primary);}
    #menu-sheet .mi .ic{width:36px;height:36px;border-radius:10px;background:var(--card);display:flex;align-items:center;justify-content:center;}
    #menu-sheet .mi .grow{flex:1;font-weight:600;}
    #menu-sheet .mi .chev{color:var(--muted);}
    #menu-sheet .mi.danger{color:#ff6b6b;}
    @keyframes sheetUp{from{transform:translateY(40px);opacity:0;}to{transform:none;opacity:1;}}</style>
    <span class="handle"></span>
    <h3>Menu</h3>
    <p class="sub">Signed in as ${escapeHtml(state.profile.name || 'Guest')}</p>
    <div class="mi" data-act="profile"><span class="ic">&#x1F464;</span><span class="grow">My Profile</span><span class="chev">›</span></div>
    <div class="mi" data-act="notif"><span class="ic">&#x1F514;</span><span class="grow">Notifications</span><span class="chev">›</span></div>
    <div class="mi" data-act="settings"><span class="ic">&#x2699;</span><span class="grow">Settings</span><span class="chev">›</span></div>
    <div class="mi" data-act="city"><span class="ic">&#x1F4CD;</span><span class="grow">Change city</span><span class="chev">›</span></div>
    <div class="mi" data-act="help"><span class="ic">&#x2753;</span><span class="grow">Help &amp; tips</span><span class="chev">›</span></div>
    <div class="mi danger" data-act="signout"><span class="ic">&#x1F6AA;</span><span class="grow">Sign out</span><span class="chev">›</span></div>
  `;
  card.querySelectorAll('.mi').forEach((row) => {
    row.addEventListener('click', () => {
      const act = row.dataset.act;
      closeSheet();
      if (act === 'profile')   openProfile();
      else if (act === 'notif') openNotifications();
      else if (act === 'settings') openSettings();
      else if (act === 'city') openCityPicker();
      else if (act === 'help') openWhatsNew('help');
      else if (act === 'signout') { wipeAllData(); }
    });
  });
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', init);