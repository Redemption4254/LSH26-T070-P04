# 🚌 FareSplit — Bus Route Fare Splitter

> Split a bus fare **exactly** by the segments each passenger actually rode. Mobile-first PWA, no install, works offline.

[![Vercel](https://img.shields.io/badge/deploy-Vercel-black?logo=vercel)](https://vercel.com/new)
[![PWA](https://img.shields.io/badge/PWA-installable-5f0fff?logo=pwa)](https://web.dev/progressive-web-apps/)
[![JavaScript](https://img.shields.io/badge/vanilla-JavaScript-f7df1e?logo=javascript&logoColor=000)](https://developer.mozilla.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-10%20passing-brightgreen)](tests.html)

**Live demo:** _(add your Vercel URL here after deploy)_

---

## ✨ Features

- 🧮 **Ordered stops + custom total fare** — pick the route, set the fare, done.
- 👥 **Per-passenger board / alight stops** — who rode which segments.
- 📊 **Live per-segment cost breakdown** — see the math, not a black box.
- 🎯 **Exact rounding** — shares always sum to the total. Remainder absorption is **visible**, never hidden.
- 📱 **Installable PWA** — Add to Home Screen on iOS/Android. Works offline.
- 🌗 **Dark mode** — manual + system-aware.
- 🔗 **Shareable link + 📱 QR code** via serverless backend.
- 🗂️ **Local trip history** — never lose a split.
- ⌨️ **Keyboard-friendly** — full ARIA labels, escape closes modals, live announcements.
- 🧪 **Tested** — open `tests.html`, 10 assertions validate the math.

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

That's it. **No env vars. No build step. No npm install.**

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        BROWSER (PWA)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ index    │  │ styles   │  │   app    │  │ service-wkr  │  │
│  │ .html    │◄─┤  .css    │◄─┤  .js     │◄─┤  .js         │  │
│  └──────────┘  └──────────┘  └────┬─────┘  └──────────────┘  │
│                                   │                          │
│                                   │ fetch                    │
└───────────────────────────────────┼──────────────────────────┘
                                    ▼
                        ┌───────────────────────┐
                        │   Vercel Edge / CDN   │
                        └───────────┬───────────┘
                                    ▼
                        ┌───────────────────────┐
                        │   /api/trips  (POST)  │ ──► store.set(id, trip)
                        │   /api/trips/:id (GET)│ ◄── store.get(id)
                        │   /api/trips    (HEAD)│ ◄── liveness probe
                        └───────────────────────┘
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │  In-memory Map store  │
                        │  (swap → Upstash KV)  │
                        └───────────────────────┘
```

### File map

```
index.html          ← Mobile-first UI (bottom nav, dark mode, modal)
styles.css          ← Design system + responsive layout + animations
app.js              ← Math + state + backend client + a11y
manifest.json       ← PWA install + theme
service-worker.js   ← Offline caching + share-target fallback
vercel.json         ← Static + API routing + SW headers
api/trips.js        ← Serverless POST/GET/HEAD with validation
tests.html          ← In-browser test runner (10 assertions)
source.html         ← Single-page source dump (no-build view)
```

### Stack choices

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS | No build step → deploys in seconds, runs anywhere, easy to audit. |
| Backend | Vercel Serverless Functions | Same repo, zero ops, free tier covers hackathon scale. |
| Storage | In-memory `Map` | Simple. Documented swap to Upstash Redis in `api/trips.js`. |
| QR codes | `qrcode-generator@1.4.4` via jsDelivr | ~12KB, no build, no deps. |
| Offline | Service Worker (cache-first static) | Works on a moving bus. |

---

## 🧮 How the math works

The hardest part of splitting fares is **exact rounding**. `₹100 / 3 = 33.33…` — three shares at `33.33` only sum to `99.99`.

FareSplit works in **integer cents** end-to-end:

1. Convert the total fare to cents: `₹100 → 10000¢`.
2. Divide by segment count: `10000 ÷ 3 = 3333` remainder `1`.
3. Distribute the remainder one-cent-at-a-time to the **first** segments — never hidden, always labeled.
4. For each passenger, sum the cents for the segments they rode.
5. Same trick at the passenger level: divide their cents across passengers riding that segment, distribute remainder to first passengers.

The result: **shares always sum exactly to the total fare, to the cent**. Try `₹100 / 3 segments / 3 passengers` — open `tests.html` to verify.

---

## 🧪 Local development

You can open `index.html` directly in a browser — the offline + localStorage parts work fully. The `/api/trips` endpoint only works on Vercel (or via `vercel dev` if you install the CLI).

```bash
npm i -g vercel
vercel dev      # starts local server with API routes
```

### Run the tests

Open `tests.html` in any browser. You'll see a green bar with **10 / 10 passing** (or red — please open an issue).

The suite covers:
- segment sum equality
- awkward rounding (`₹100 / 3 segments`)
- single-segment, empty-stops, no-passenger edge cases
- property test with `₹333.33 / 5 stops / 4 passengers`
- extreme fares (`₹0.03` rounding stability)

---

## 🎤 30-second pitch (for judges)

> *"Splitting a bus fare 3 ways shouldn't mean one person Venmo-requesting and doing math at 11pm. FareSplit does it in real-time: scan a QR, add your stops, see your share — with exact rounding and a visible audit trail. Built as an installable PWA on Vercel Serverless Functions."*

### Demo script (under 90 seconds)
1. Open the app → shows default 4-stop route, ₹120
2. Tap **Load demo** → 3 passengers, ₹100, awkward rounding (the money-shot)
3. Point at the **Segment costs** breakdown — show the visible remainder
4. Tap **Show QR** → phone-scan the QR on another phone
5. That phone sees the same trip, fully loaded
6. Tap 🌙 → dark mode for "it looks native" moment
7. Open `tests.html` → "and here are the 10 assertions that prove the math is correct"

---

## ❓ FAQ (for judges)

**Q: How do you guarantee shares sum to the exact total?**
A: Integer-cents arithmetic end-to-end. Remainder cents are absorbed into the *first* segments/passengers, and the absorption is shown in the UI as `+1¢`. See `tests.html` for a brute-force proof.

**Q: What happens if the backend is unreachable?**
A: Share-link payload is base64-encoded and stored in the URL hash (`#trip=…`). Recipients load the trip from the hash even if the server is down. The QR code embeds the same URL.

**Q: Is the data private?**
A: Trips have 10-char random IDs. Without the link, nothing is discoverable. The in-memory store is per-instance and ephemeral; documented Redis swap is opt-in.

**Q: Does it work offline?**
A: Yes. The service worker caches all static assets. Math, history, theme, and dark mode work with no network. Sharing requires a network round-trip.

**Q: Why vanilla JS instead of React/Next?**
A: No build step → fastest deploy, smallest bundle, easy to audit in 90 seconds. For this scope, frameworks would be net-negative.

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