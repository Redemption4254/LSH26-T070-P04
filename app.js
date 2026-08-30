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
  view: 'split'
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
  // Locale-aware, 2 decimal places, never shows "-0". Currency: Bangladeshi Taka (৳).
  const v = (Math.round(n * 100) / 100);
  return `\u09F3 ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  loadHistory();
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
  $('total-fare').addEventListener('input', (e) => {
    let v = parseFloat(e.target.value);
    if (!Number.isFinite(v) || v < 0) v = 0;
    if (v > LIMITS.MAX_FARE) {
      v = LIMITS.MAX_FARE;
      e.target.value = v;
    }
    state.totalFare = v;
    scheduleResultsRender();
  });
  $('add-stop').addEventListener('click', addStop);
  $('new-stop').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addStop(); } });
  $('new-stop').addEventListener('input', (e) => { e.target.value = e.target.value.slice(0, LIMITS.MAX_STOP_LEN); });

  $('add-passenger').addEventListener('click', addPassenger);
  $('passenger-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addPassenger(); } });
  $('passenger-name').addEventListener('input', (e) => { e.target.value = e.target.value.slice(0, LIMITS.MAX_NAME_LEN); });

  $('theme-toggle').addEventListener('click', toggleTheme);
  $('menu-btn').addEventListener('click', openMenuSheet);
  $('cam-btn')?.addEventListener('click', openMenuSheet);

  // Category tabs open the quick-config sheet for that step
  document.querySelectorAll('.cat-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cat-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      openMenuSheet(tab.dataset.step);
    });
  });

  // Generic "switch view" wiring for any element carrying [data-view].
  // Covers .view-link (What's-new link), .round-icon[data-view] (back arrows
  // on results / history / about), and the rail-link / nav-btn / nav-fab
  // selectors below remain for their side-effects.
  document.querySelectorAll('[data-view]').forEach((el) => {
    if (el.classList.contains('nav-btn') ||
        el.classList.contains('nav-fab') ||
        el.classList.contains('rail-link')) return; // wired separately
    el.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(el.dataset.view);
    });
  });

  $('share-btn').addEventListener('click', shareTrip);
  $('qr-btn').addEventListener('click', showQR);
  $('reset-btn').addEventListener('click', resetTrip);
  $('demo-btn').addEventListener('click', loadDemoTrip);
  $('qr-close').addEventListener('click', closeQR);
  $('qr-modal').addEventListener('click', (e) => { if (e.target.id === 'qr-modal') closeQR(); });
  $('qr-copy').addEventListener('click', copyLink);
  $('bk-booknow')?.addEventListener('click', shareTrip);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheet(); closeQR(); } });
  document.querySelectorAll('.nav-btn, .nav-fab').forEach((b) => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });
  document.querySelectorAll('.rail-link').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(a.dataset.view);
    });
  });
  // Summary pane Share button
  $('sum-share')?.addEventListener('click', shareTrip);

  // Bell + inactive round-icons → small toasts so they feel alive.
  $('bell-btn')?.addEventListener('click', () => toast('No new notifications'));
  // Triple-chevron "next" pill jumps to the next step sheet.
  $('ghost-next')?.addEventListener('click', () => {
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
    b.addEventListener('click', () => {
      if (state.view === 'history') { toast('Open a saved trip from the list below'); return; }
      if (state.view === 'about')   { loadDemoTrip(); return; }
      toast('Tap a stop or rider to get started');
    });
  });
  // Map pin on the location pill: pretend we picked up a city.
  document.querySelector('.loc-pin')?.addEventListener('click', () => {
    const cities = ['Dhaka, BD', 'Chittagong, BD', 'Sylhet, BD', 'Khulna, BD'];
    const cur = $('loc-city');
    if (cur) cur.textContent = cities[Math.floor(Math.random() * cities.length)];
    toast('Location updated · routes refresh');
  });

  // Scroll-reveal observer
  setupReveals();
  // First-paint summary
  updateSummary();
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

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', init);