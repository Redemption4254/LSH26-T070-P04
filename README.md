# 🚌 FareSplit — Bus Route Fare Splitter

A mobile-first PWA that splits a bus fare fairly, based on the segments each passenger actually rode.

**Live demo:** _(add your Vercel URL here after deploy)_

---

## ✨ Features

- 🧮 Ordered stops + custom total fare
- 👥 Per-passenger board / alight stops
- 📊 Per-segment cost breakdown (live)
- 🎯 Exact rounding — shares always sum to the total, remainder absorption is visible
- 📱 Installable PWA (Add to Home Screen) · works offline
- 🌗 Dark mode
- 🔗 Shareable link + 📱 QR code via serverless backend
- 🗂️ Local trip history
- 🎨 Mobile-first responsive UI with bottom nav

---

## 🚀 Deploy to Vercel in 60 seconds

### Option A — Drag & drop (zero setup)
1. Go to [vercel.com/new](https://vercel.com/new)
2. Drag this whole project folder onto the page (or zip it first)
3. Click **Deploy**
4. Done — you get `https://faresplit-xxx.vercel.app`

### Option B — Git push
```bash
git init
git add .
git commit -m "FareSplit MVP"
# create empty repo on github, then:
git remote add origin https://github.com/YOUR_USER/faresplit.git
git push -u origin main
# on vercel.com/new → "Import Project" → select repo → Deploy
```

That's it. No env vars, no build step, no npm install.

---

## 🏗 Architecture

```
index.html      ← Mobile-first UI (bottom nav, dark mode, modal)
styles.css      ← Design system + responsive layout
app.js          ← Math + state + backend client
manifest.json   ← PWA install + theme
service-worker.js ← Offline caching
vercel.json     ← Static + API routing
api/trips.js    ← Serverless POST/GET for shareable trips
```

- **Frontend:** Vanilla HTML/CSS/JS (PWA, no framework — ships fast, runs anywhere)
- **Backend:** Vercel Serverless Functions (`/api/trips`)
- **Storage:** In-memory Map (per serverless instance). For production, swap in Upstash Redis / Vercel KV — see comments in `api/trips.js`.

---

## 🧪 Local development

You can open `index.html` directly in a browser — the offline + localStorage parts work fully. The `/api/trips` endpoint only works on Vercel (or via `vercel dev` if you install the CLI).

```bash
npm i -g vercel
vercel dev      # starts local server with API routes
```

---

## 🎤 30-second pitch (for judges)

> *"Splitting a bus fare 3 ways shouldn't mean one person Venmo-requesting and doing math at 11pm. FareSplit does it in real-time: scan a QR, add your stops, see your share — with exact rounding and a visible audit trail. Built as an installable PWA on Vercel Serverless Functions."*

### Demo script (under 90 seconds)
1. Open the app → shows default 4-stop route, ₹120
2. Add 2 passengers with different boarding/alighting
3. Point at the **Segment costs** breakdown
4. Show **the totals match exactly** even with awkward rounding (try ₹100 / 3 segments)
5. Tap **Show QR** → phone-scan the QR on another phone
6. That phone sees the same trip, fully loaded
7. Tap 🌙 → dark mode for "it looks native" moment

---

## 🔧 Swapping storage for production

Open `api/trips.js`. Replace the `store` Map with Upstash Redis:

```js
import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();
const store = {
  async set(id, v) { await redis.set(`trip:${id}`, JSON.stringify(v)); },
  async get(id)    { const v = await redis.get(`trip:${id}`); return v ? JSON.parse(v) : null; }
};
```

Then add Upstash integration in Vercel dashboard → done. Free tier is 10k requests/day.

---

## 📜 License

MIT — do whatever you want with it. Win that hackathon. 🏆