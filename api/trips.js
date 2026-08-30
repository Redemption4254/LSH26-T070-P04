// ============================================================
//  Vercel Serverless API: /api/trips
//  POST /api/trips        -> create a trip, returns { id, ...trip }
//  GET  /api/trips?id=... -> fetch a trip by id
//
//  Storage: in-memory map (good enough for a hackathon demo).
//  In production swap for Upstash Redis / Vercel KV / a real DB.
// ============================================================

// In-memory store. Resets on cold start, but that's OK for demos.
// Tip for judges: data lives ~5 min on warm instances.
const store = (global.__tripStore ||= new Map());

function nanoid() {
  // 8-char URL-safe id (no extra deps)
  return Math.random().toString(36).slice(2, 6) +
         Math.random().toString(36).slice(2, 6);
}

function send(res, status, body) {
  res.status(status).setHeader('Access-Control-Allow-Origin', '*')
     .setHeader('Content-Type', 'application/json')
     .json(body);
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  try {
    if (req.method === 'POST') {
      const body = req.body || {};
      const { stops, totalFare, passengers, results } = body;
      if (!Array.isArray(stops) || stops.length < 2) {
        return send(res, 400, { error: 'Need at least 2 stops' });
      }
      if (typeof totalFare !== 'number' || totalFare <= 0) {
        return send(res, 400, { error: 'Invalid totalFare' });
      }
      const id = nanoid();
      const trip = {
        id,
        createdAt: new Date().toISOString(),
        stops,
        totalFare,
        passengers: Array.isArray(passengers) ? passengers : [],
        results: results || null
      };
      store.set(id, trip);
      return send(res, 201, trip);
    }

    if (req.method === 'GET') {
      const id = (req.query.id || '').toString();
      if (!id) return send(res, 400, { error: 'Missing id' });
      const trip = store.get(id);
      if (!trip) return send(res, 404, { error: 'Trip not found' });
      return send(res, 200, trip);
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: e.message || 'Server error' });
  }
}
