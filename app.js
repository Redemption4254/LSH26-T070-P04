// ============================================================
//  Bus Route Fare Splitter - app.js
//  PWA: dark mode, bottom-nav views, share link, QR, history,
//  backend integration via /api/trips, shareable URL load.
// ============================================================

const state = {
  stops: ['Park Street', 'MG Road', 'Central Station', 'Airport'],
  totalFare: 120,
  passengers: [],          // { id, name, inStop, outStop }
  tripId: null,            // backend id when shared
  shareUrl: null,
  history: []              // local saved trips
};

let nextId = 1;
const $ = (id) => document.getElementById(id);

// ---------- Init ----------
async function init() {
  loadTheme();
  loadHistory();
  renderAll();
  wireEvents();
  pingBackend();
  // Register service worker (only on http(s), not file://)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
  // Load shared trip from URL ?trip=ID
  const params = new URLSearchParams(location.search);
  const tripId = params.get('trip');
  if (tripId) await loadSharedTrip(tripId);
}

// ---------- Events ----------
function wireEvents() {
  $('total-fare').addEventListener('input', (e) => {
    state.totalFare = Math.max(0, parseFloat(e.target.value) || 0);
    renderResults();
  });
  $('add-stop').addEventListener('click', addStop);
  $('new-stop').addEventListener('keydown', (e) => { if (e.key === 'Enter') addStop(); });
  $('add-passenger').addEventListener('click', addPassenger);
  $('passenger-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') addPassenger(); });
  $('theme-toggle').addEventListener('click', toggleTheme);
  $('share-btn').addEventListener('click', shareTrip);
  $('qr-btn').addEventListener('click', showQR);
  $('reset-btn').addEventListener('click', resetTrip);
  $('qr-close').addEventListener('click', closeQR);
  $('qr-modal').addEventListener('click', (e) => { if (e.target.id === 'qr-modal') closeQR(); });
  $('qr-copy').addEventListener('click', copyLink);
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });
}

// ---------- Theme ----------
function loadTheme() {
  if (localStorage.getItem('faresplit-theme') === 'dark') {
    document.body.classList.add('dark');
    $('theme-toggle').textContent = '☀️';
  }
}
function toggleTheme() {
  const dark = document.body.classList.toggle('dark');
  localStorage.setItem('faresplit-theme', dark ? 'dark' : 'light');
  $('theme-toggle').textContent = dark ? '☀️' : '🌙';
}

// ---------- Views ----------
function switchView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById('view-' + name)?.classList.add('active');
  document.querySelector(`.nav-btn[data-view="${name}"]`)?.classList.add('active');
  if (name === 'history') renderHistory();
}

// ---------- Backend ping ----------
async function pingBackend() {
  const pill = $('api-status');
  try {
    const r = await fetch('/api/trips?id=__ping__', { method: 'GET' });
    pill.textContent = r.status === 404 ? '● Online (demo storage)' : '● Online';
    pill.className = 'status-pill ok';
  } catch (e) {
    pill.textContent = '● Offline mode (saved locally)';
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
    btn.setAttribute('aria-label', `Remove ${s}`);
    btn.addEventListener('click', () => removeStop(i));
    li.appendChild(span);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function addStop() {
  const input = $('new-stop');
  const name = input.value.trim();
  if (!name) return;
  if (state.stops.includes(name)) { toast('Stop already exists'); return; }
  state.stops.push(name);
  input.value = '';
  renderStops();
  renderPassengerDropdowns();
  renderResults();
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
  renderResults();
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
    li.textContent = 'No passengers yet. Add one above.';
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
  const name = $('passenger-name').value.trim();
  const inStop = $('passenger-in').value;
  const outStop = $('passenger-out').value;
  if (!name) { toast('Enter a passenger name'); return; }
  if (!inStop || !outStop) { toast('Pick board & alight stops'); return; }
  if (inStop === outStop) { toast('Boarding & alighting must differ'); return; }
  const inIdx = state.stops.indexOf(inStop);
  const outIdx = state.stops.indexOf(outStop);
  if (inIdx === -1 || outIdx === -1) return;
  if (outIdx <= inIdx) { toast('Alighting must be after boarding'); return; }
  state.passengers.push({ id: nextId++, name, inStop, outStop });
  $('passenger-name').value = '';
  renderPassengers();
  renderResults();
}

function removePassenger(id) {
  state.passengers = state.passengers.filter((p) => p.id !== id);
  renderPassengers();
  renderResults();
}

// ============================================================
//  CORE: Fare splitting math (unchanged from v1, integer-cents)
// ============================================================
function computeSegmentCosts(stops, totalFare) {
  const segments = Math.max(0, stops.length - 1);
  if (segments === 0) return [];
  const totalCents = Math.round(totalFare * 100);
  const baseShare = Math.floor(totalCents / segments);
  const remainder = totalCents - baseShare * segments;
  const costs = new Array(segments).fill(baseShare);
  for (let i = 0; i < remainder; i++) costs[i] += 1;
  return costs.map((c) => c / 100);
}

function computePassengerShares(passengers, segmentCosts, totalFare) {
  const idx = new Map(state.stops.map((s, i) => [s, i]));
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

// ---------- Results ----------
function renderResults() {
  const container = $('results');
  container.innerHTML = '';

  const segWrap = document.createElement('div');
  segWrap.id = 'segment-costs';
  const h3 = document.createElement('h3');
  h3.textContent = 'Segment costs';
  segWrap.appendChild(h3);

  const segmentCosts = computeSegmentCosts(state.stops, state.totalFare);
  if (segmentCosts.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Add at least 2 stops to define segments.';
    segWrap.appendChild(p);
  } else {
    const ol = document.createElement('ol');
    state.stops.forEach((s, i) => {
      if (i === state.stops.length - 1) return;
      const li = document.createElement('li');
      li.textContent = `${s} → ${state.stops[i + 1]} : ₹ ${segmentCosts[i].toFixed(2)}`;
      ol.appendChild(li);
    });
    segWrap.appendChild(ol);
    const sum = segmentCosts.reduce((a, b) => a + b, 0);
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = `Sum of segments: ₹ ${sum.toFixed(2)} (matches total ₹ ${state.totalFare.toFixed(2)} ✓)`;
    segWrap.appendChild(note);
  }
  container.appendChild(segWrap);

  if (state.passengers.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Add passengers to see per-person shares.';
    container.appendChild(p);
    return;
  }

  const { shares, absorber, segsByP } = computePassengerShares(state.passengers, segmentCosts, state.totalFare);

  const table = document.createElement('table');
  table.className = 'results-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Passenger</th><th>Board</th><th>Alight</th><th>Segments</th><th>Share</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');

  state.passengers.forEach((p, idx) => {
    const segs = segsByP[idx] || [];
    const names = segs.map((k) => `${state.stops[k]}→${state.stops[k + 1]}`);
    const tr = document.createElement('tr');
    if (idx === absorber) tr.classList.add('absorber');
    const cells = ['', '', '', '', ''].map(() => document.createElement('td'));
    cells[0].textContent = p.name + (idx === absorber ? ' (absorbed remainder)' : '');
    cells[1].textContent = p.inStop;
    cells[2].textContent = p.outStop;
    cells[3].textContent = names.length ? names.join(', ') : '—';
    cells[4].textContent = `₹ ${shares[idx].toFixed(2)}`;
    cells.forEach((c) => tr.appendChild(c));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  const totalShown = shares.reduce((a, b) => a + b, 0);
  const summary = document.createElement('div');
  summary.className = 'summary';
  summary.innerHTML =
    `<strong>Total of shares:</strong> ₹ ${totalShown.toFixed(2)}` +
    ` &nbsp;|&nbsp; <strong>Total fare:</strong> ₹ ${state.totalFare.toFixed(2)}` +
    (absorber !== null ? `<br/><strong>Rounding:</strong> remainder absorbed by <em>${state.passengers[absorber].name}</em>.` : '');
  container.appendChild(summary);
}

// ---------- Share / Backend ----------
async function shareTrip() {
  if (state.passengers.length === 0) { toast('Add at least one passenger first'); return; }
  const tripData = {
    stops: state.stops,
    totalFare: state.totalFare,
    passengers: state.passengers.map((p) => ({ name: p.name, inStop: p.inStop, outStop: p.outStop }))
  };
  try {
    const r = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tripData)
    });
    if (!r.ok) throw new Error('Backend not reachable');
    const trip = await r.json();
    state.tripId = trip.id;
    state.shareUrl = `${location.origin}${location.pathname}?trip=${trip.id}`;
    saveToHistory(tripData, trip.id);
    toast('Link ready — tap Show QR');
    try { await navigator.clipboard.writeText(state.shareUrl); toast('Link copied to clipboard!'); } catch (_) {}
  } catch (e) {
    // Offline fallback: encode trip in URL hash so it's still shareable locally
    const compact = btoa(unescape(encodeURIComponent(JSON.stringify(tripData))));
    state.shareUrl = `${location.origin}${location.pathname}#trip=${compact}`;
    saveToHistory(tripData, 'local-' + Date.now());
    toast('Offline mode — link copied (local only)');
    try { await navigator.clipboard.writeText(state.shareUrl); } catch (_) {}
  }
}

async function loadSharedTrip(id) {
  try {
    const r = await fetch(`/api/trips?id=${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error('not found');
    const trip = await r.json();
    state.stops = trip.stops;
    state.totalFare = trip.totalFare;
    state.passengers = (trip.passengers || []).map((p) => ({ id: nextId++, ...p }));
    state.tripId = trip.id;
    renderAll();
    toast('Shared trip loaded ✨');
    return;
  } catch (e) { /* fall through */ }
  // Try hash-encoded local trip
  try {
    const h = location.hash.match(/trip=([^&]+)/);
    if (h) {
      const trip = JSON.parse(decodeURIComponent(escape(atob(h[1]))));
      state.stops = trip.stops;
      state.totalFare = trip.totalFare;
      state.passengers = (trip.passengers || []).map((p) => ({ id: nextId++, ...p }));
      renderAll();
      toast('Local shared trip loaded');
    }
  } catch (_) {}
}

// ---------- QR ----------
function showQR() {
  if (!state.shareUrl) {
    toast('Tap "Save & Share Link" first');
    return;
  }
  const qr = qrcode(0, 'M');
  qr.addData(state.shareUrl);
  qr.make();
  const canvas = document.createElement('canvas');
  const moduleCount = qr.getModuleCount();
  const size = 220;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#1e3c72';
  const tile = size / moduleCount;
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(c * tile, r * tile, tile, tile);
    }
  }
  const target = $('qr-canvas');
  target.innerHTML = '';
  target.appendChild(canvas);
  $('qr-link').textContent = state.shareUrl;
  $('qr-modal').classList.remove('hidden');
}

function closeQR() { $('qr-modal').classList.add('hidden'); }

async function copyLink() {
  if (!state.shareUrl) return;
  try { await navigator.clipboard.writeText(state.shareUrl); toast('Link copied'); }
  catch (e) { toast('Copy failed'); }
}

// ---------- History (localStorage) ----------
function saveToHistory(trip, id) {
  state.history.unshift({ id, ts: Date.now(), trip });
  state.history = state.history.slice(0, 20);
  localStorage.setItem('faresplit-history', JSON.stringify(state.history));
}
function loadHistory() {
  try { state.history = JSON.parse(localStorage.getItem('faresplit-history') || '[]'); }
  catch (_) { state.history = []; }
}
function renderHistory() {
  const list = $('history-list');
  list.innerHTML = '';
  if (state.history.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No saved trips yet.';
    list.appendChild(li);
    return;
  }
  state.history.forEach((h) => {
    const li = document.createElement('li');
    const left = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `Trip · ₹ ${h.trip.totalFare} · ${h.trip.passengers.length} pax`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${new Date(h.ts).toLocaleString()} · ${h.id}`;
    left.appendChild(title);
    left.appendChild(meta);
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = 'Open';
    btn.addEventListener('click', () => {
      state.stops = h.trip.stops;
      state.totalFare = h.trip.totalFare;
      state.passengers = h.trip.passengers.map((p) => ({ id: nextId++, ...p }));
      renderAll();
      switchView('split');
    });
    li.appendChild(left);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

// ---------- Reset ----------
function resetTrip() {
  if (!confirm('Reset the current trip?')) return;
  state.passengers = [];
  state.tripId = null;
  state.shareUrl = null;
  renderPassengers();
  renderResults();
  toast('Trip reset');
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
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', init);