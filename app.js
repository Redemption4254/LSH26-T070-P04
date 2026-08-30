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
  // Locale-aware, 2 decimal places, never shows "-0".
  const v = (Math.round(n * 100) / 100);
  return `₹ ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  $('share-btn').addEventListener('click', shareTrip);
  $('qr-btn').addEventListener('click', showQR);
  $('reset-btn').addEventListener('click', resetTrip);
  $('demo-btn').addEventListener('click', loadDemoTrip);
  $('qr-close').addEventListener('click', closeQR);
  $('qr-modal').addEventListener('click', (e) => { if (e.target.id === 'qr-modal') closeQR(); });
  $('qr-copy').addEventListener('click', copyLink);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeQR(); });
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });
}

// ---------- Theme ----------
function loadTheme() {
  let theme = localStorage.getItem('faresplit-theme');
  if (!theme) {
    theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  if (theme === 'dark') {
    document.body.classList.add('dark');
    $('theme-toggle').textContent = '☀️';
    $('theme-toggle').setAttribute('aria-label', 'Switch to light mode');
  }
}
function toggleTheme() {
  const dark = document.body.classList.toggle('dark');
  localStorage.setItem('faresplit-theme', dark ? 'dark' : 'light');
  $('theme-toggle').textContent = dark ? '☀️' : '🌙';
  $('theme-toggle').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}

// ---------- Views ----------
function switchView(name) {
  state.view = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => {
    const active = b.dataset.view === name;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  document.getElementById('view-' + name)?.classList.add('active');
  if (name === 'history') renderHistory();
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
    li.textContent = 'No passengers yet — add one above, or tap "Load demo trip" below.';
    list.appendChild(li);
    return;
  }
  state.passengers.forEach((p) => {
    const li = document.createElement('li');
    const left = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = p.name;
    const info = document.createElement('span');
    info.className = 'route-info';
    info.textContent = `  (${p.inStop} → ${p.outStop})`;
    left.appendChild(strong);
    left.appendChild(info);
    const btn = document.createElement('button');
    btn.className = 'btn danger small';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => removePassenger(p.id));
    li.appendChild(left);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function addPassenger() {
  if (state.passengers.length >= LIMITS.MAX_PASSENGERS) { toast(`Max ${LIMITS.MAX_PASSENGERS} passengers`); return; }
  const name = clampStr($('passenger-name').value, LIMITS.MAX_NAME_LEN);
  const inStop = $('passenger-in').value;
  const outStop = $('passenger-out').value;
  if (!name) { toast('Enter a passenger name'); return; }
  if (!inStop || !outStop) { toast('Pick board & alight stops'); return; }
  if (inStop === outStop) { toast('Boarding & alighting must differ'); return; }
  const inIdx = state.stops.indexOf(inStop);
  const outIdx = state.stops.indexOf(outStop);
  if (inIdx === -1 || outIdx === -1) return;
  if (outIdx <= inIdx) { toast('Alighting must come after boarding'); return; }
  state.passengers.push({ id: nextId++, name, inStop, outStop });
  $('passenger-name').value = '';
  renderPassengers();
  scheduleResultsRender();
  announcement(`Passenger ${name} added`);
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

// ---------- Results rendering ----------
function renderResults() {
  const container = $('results');
  container.innerHTML = '';

  // ----- Segment costs -----
  const segWrap = document.createElement('div');
  segWrap.id = 'segment-costs';
  const h3 = document.createElement('h3');
  h3.textContent = 'Segment costs';
  segWrap.appendChild(h3);

  const segCosts = FareMath.segmentCosts(state.stops, state.totalFare);
  if (segCosts.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Add at least 2 stops to define segments.';
    segWrap.appendChild(p);
  } else {
    const ol = document.createElement('ol');
    state.stops.forEach((s, i) => {
      if (i === state.stops.length - 1) return;
      const li = document.createElement('li');
      li.textContent = `${s} → ${state.stops[i + 1]} : ${fmtMoney(segCosts[i])}`;
      ol.appendChild(li);
    });
    segWrap.appendChild(ol);

    const sum = segCosts.reduce((a, b) => a + b, 0);
    const ok = Math.abs(sum - state.totalFare) < 0.005;
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = `Sum of segments: ${fmtMoney(sum)} — matches total ${fmtMoney(state.totalFare)} ${ok ? '✓' : '✗'}`;
    segWrap.appendChild(note);
  }
  container.appendChild(segWrap);

  // ----- Passenger shares -----
  if (state.passengers.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Add passengers to see per-person shares.';
    container.appendChild(p);
    return;
  }

  const { shares, absorber, segsByP } = FareMath.passengerShares(
    state.passengers, segCosts, state.totalFare, state.stops
  );

  const table = document.createElement('table');
  table.className = 'results-table';

  // Accessibility: caption + colgroup + scope
  const caption = document.createElement('caption');
  caption.textContent = 'Each passenger’s share of the fare';
  caption.style.position = 'absolute';
  caption.style.left = '-9999px';
  table.appendChild(caption);

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  ['Passenger', 'Board', 'Alight', 'Segments', 'Share'].forEach((t) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = t;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  state.passengers.forEach((p, idx) => {
    const segs = segsByP[idx] || [];
    const names = segs.map((k) => `${state.stops[k]}→${state.stops[k + 1]}`);
    const tr = document.createElement('tr');
    if (idx === absorber) tr.classList.add('absorber');
    const vals = [
      p.name + (idx === absorber ? ' (absorbed remainder ⭐)' : ''),
      p.inStop,
      p.outStop,
      names.length ? names.join(', ') : '—',
      fmtMoney(shares[idx])
    ];
    vals.forEach((v, i) => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  const totalShown = shares.reduce((a, b) => a + b, 0);
  const exact = Math.abs(totalShown - state.totalFare) < 0.005;
  const summary = document.createElement('div');
  summary.className = 'summary';
  summary.innerHTML =
    `<strong>Total of shares:</strong> ${fmtMoney(totalShown)}` +
    ` &nbsp;|&nbsp; <strong>Total fare:</strong> ${fmtMoney(state.totalFare)}` +
    ` &nbsp;|&nbsp; <strong>${exact ? 'Exact ✓' : 'Mismatch ✗'}</strong>` +
    (absorber !== null ? `<br/><strong>Rounding:</strong> remainder absorbed by <em>${state.passengers[absorber].name}</em>.` : '');
  container.appendChild(summary);

  // Announce the total so screen readers pick it up
  announcement(
    `Total ${fmtMoney(totalShown)} across ${state.passengers.length} passenger${state.passengers.length === 1 ? '' : 's'}` +
    (absorber !== null ? `. Remainder absorbed by ${state.passengers[absorber].name}.` : '')
  );
}

// Debounced render for text-input-driven re-renders
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
    ctx.fillStyle = '#1e3c72';
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
    const title = document.createElement('strong');
    title.textContent = `Trip · ${fmtMoney(h.trip.totalFare)} · ${h.trip.passengers.length} pax`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${new Date(h.ts).toLocaleString()}${h.trip._local ? ' · local' : ''}`;
    left.appendChild(title);
    left.appendChild(meta);

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.gap = '0.4rem';
    const openBtn = document.createElement('button');
    openBtn.className = 'btn small';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', () => {
      applyTrip(h.trip);
      switchView('split');
      toast('Trip loaded');
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'btn small ghost';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', () => {
      state.history = state.history.filter((x) => x.id !== h.id);
      localStorage.setItem('faresplit-history', JSON.stringify(state.history));
      renderHistory();
    });
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
  clearWrap.appendChild(clearBtn);
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