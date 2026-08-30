// ============================================================
//  Vercel Serverless API: /api/trips
//  POST /api/trips        -> create a trip, returns { id, ...trip }
//  GET  /api/trips?id=... -> fetch a trip by id
//
//  Storage: in-memory Map (per warm serverless instance).
//  For production swap with Upstash Redis / Vercel KV — see
//  the storage adapter pattern at the bottom of this file.
// ============================================================

// In-memory store. Resets on cold start; that's OK for demos.
const store = (globalThis.__tripStore ||= new Map());

// ---------- Limits ----------
const LIMITS = {
  MAX_STOPS: 20,
  MAX_STOP_LEN: 60,
  MAX_PASSENGERS: 20,
  MAX_NAME_LEN: 40,
  MAX_FARE: 1_000_000,
  MAX_TRIPS: 1000,          // cap memory growth
  ID_LEN: 10
};

// ---------- Helpers ----------
function send(res, status, body) {
  res.status(status)
     .setHeader('Access-Control-Allow-Origin', '*')
     .setHeader('Content-Type', 'application/json; charset=utf-8')
     .setHeader('Cache-Control', 'no-store')
     .json(body);
}

function nanoid() {
  // 10-char URL-safe id (alphabet 36). Collision-safe for demo traffic.
  const alpha = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < LIMITS.ID_LEN; i++) {
    id += alpha[Math.floor(Math.random() * alpha.length)];
  }
  return id;
}

function cleanStr(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t.length ? t : null;
}

function validateStops(raw) {
  if (!Array.isArray(raw)) return 'stops must be an array';
  if (raw.length < 2) return 'need at least 2 stops';
  if (raw.length > LIMITS.MAX_STOPS) return `too many stops (max ${LIMITS.MAX_STOPS})`;
  const cleaned = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i++) {
    const s = cleanStr(raw[i], LIMITS.MAX_STOP_LEN);
    if (!s) return `stop #${i + 1} is empty`;
    if (seen.has(s.toLowerCase())) return `duplicate stop: "${s}"`;
    seen.add(s.toLowerCase());
    cleaned.push(s);
  }
  return { ok: true, stops: cleaned };
}

function validatePassengers(raw, stops) {
  if (raw == null) return { ok: true, passengers: [] };
  if (!Array.isArray(raw)) return 'passengers must be an array';
  if (raw.length > LIMITS.MAX_PASSENGERS) return `too many passengers (max ${LIMITS.MAX_PASSENGERS})`;
  const stopSet = new Set(stops);
  const cleaned = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i] || {};
    const name = cleanStr(p.name, LIMITS.MAX_NAME_LEN);
    const inStop = cleanStr(p.inStop, LIMITS.MAX_STOP_LEN);
    const outStop = cleanStr(p.outStop, LIMITS.MAX_STOP_LEN);
    if (!name) return `passenger #${i + 1}: missing name`;
    if (!inStop || !stopSet.has(inStop)) return `passenger #${i + 1}: invalid boarding stop`;
    if (!outStop || !stopSet.has(outStop)) return `passenger #${i + 1}: invalid alighting stop`;
    const ii = stops.indexOf(inStop), oi = stops.indexOf(outStop);
    if (oi <= ii) return `passenger #${i + 1}: alighting must be after boarding`;
    cleaned.push({ name, inStop, outStop });
  }
  return { ok: true, passengers: cleaned };
}

function validateTotalFare(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 'totalFare must be > 0';
  if (n > LIMITS.MAX_FARE) return `totalFare too large (max ${LIMITS.MAX_FARE})`;
  // Round to 2 decimal places to keep storage tight.
  return { ok: true, totalFare: Math.round(n * 100) / 100 };
}

// ---------- Handler ----------
export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  // Cheap liveness probe (no work done, no body parsed)
  if (req.method === 'HEAD') {
    res.setHeader('X-FareSplit-OK', '1');
    return res.status(200).end();
  }

  try {
    if (req.method === 'POST') {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};

      const v1 = validateStops(body.stops);
      if (v1 !== 'ok' && !v1.ok) return send(res, 400, { error: v1 });
      const stops = v1.stops;

      const v2 = validateTotalFare(body.totalFare);
      if (v2 !== 'ok' && !v2.ok) return send(res, 400, { error: v2 });
      const totalFare = v2.totalFare;

      const v3 = validatePassengers(body.passengers, stops);
      if (v3 !== 'ok' && !v3.ok) return send(res, 400, { error: v3 });

      // Cap memory: if store is huge, evict oldest by insertion order.
      if (store.size >= LIMITS.MAX_TRIPS) {
        const firstKey = store.keys().next().value;
        if (firstKey !== undefined) store.delete(firstKey);
      }

      const id = nanoid();
      const trip = {
        id,
        createdAt: new Date().toISOString(),
        stops,
        totalFare,
        passengers: v3.passengers,
        // Server-side size hint for diagnostics
        bytes: Buffer.byteLength(JSON.stringify({ stops, totalFare, passengers: v3.passengers }))
      };
      store.set(id, trip);
      return send(res, 201, trip);
    }

    if (req.method === 'GET') {
      const id = (req.query.id ?? '').toString();
      if (!id) return send(res, 400, { error: 'Missing id' });
      if (id.length > LIMITS.ID_LEN + 4) return send(res, 400, { error: 'Bad id format' });
      const trip = store.get(id);
      if (!trip) return send(res, 404, { error: 'Trip not found' });
      return send(res, 200, trip);
    }

    res.setHeader('Allow', 'GET, POST, HEAD, OPTIONS');
    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    // Never leak internals to clients.
    console.error('[api/trips]', e);
    return send(res, 500, { error: 'Server error' });
  }
}

// ============================================================
//  PRODUCTION STORAGE ADAPTER (commented — uncomment + import)
// ============================================================
// import { Redis } from '@upstash/redis';
// const redis = Redis.fromEnv();
// const store = {
//   async set(id, v) { await redis.set(`trip:${id}`, JSON.stringify(v), { ex: 60 * 60 * 24 }); },
//   async get(id)    { const v = await redis.get(`trip:${id}`); return v ? JSON.parse(v) : null; },
//   async size()     { return 0; }, // optional — only used for eviction hint
// };