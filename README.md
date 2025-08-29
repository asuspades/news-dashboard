# 🗞️ News Dashboard

A minimalist, fast, full-screen headline viewer that aggregates stories from trusted sources via **RSS**. Filter by **WORLD**, **US**, or **CYBER**. No accounts, no API keys.

---

## ✨ Features

* Responsive, keyboard-friendly grid UI
* Category filters: **WORLD | US | CYBER**
* Auto-refresh every 15 minutes (manual refresh button too)
* De-dupes items and sorts newest first
* Direct links to original articles
* Simple logging to `debug.log` for troubleshooting
* Zero build step (pure HTML/CSS/JS) + tiny Node server with an RSS proxy

---

## 🧰 Tech Stack

* **Frontend:** HTML5, CSS3, Vanilla JS (ES6)
* **Server:** Node 18+ (uses built-in `fetch`)
* **Data:** Public RSS/Atom feeds

---

## 📁 Project Structure

```
news_aggregator/
├── news-dashboard/
│   ├── debug.log                # runtime logs (optional)
│   ├── README.md                # this file
│   └── src/
│       ├── index.html           # UI markup (buttons: WORLD | US | CYBER)
│       ├── styles.css           # layout & theme
│       ├── script.js            # feed fetch, parse, render, filters
│       └── server.js            # static server + /rss proxy + /write-log
└── project.md                   # notes (optional)
```

> If you still have older files like `adapted_script.js`, `feeds.json`, `w3m_dumps/`, or `Claude-dashboard.html`, you can delete them—they’re not used.

---

## 🚀 Getting Started

### Prerequisites

* **Node 18+** (required for global `fetch` in `server.js`)
* A browser

### Run locally

```bash
cd news-dashboard/src
node server.js
# Open http://localhost:8080/news-dashboard/src/
```

You should see the dashboard and three filter buttons: **WORLD**, **US**, **CYBER**.

---

## ⚙️ Configuration

### Add or edit sources

All sources live at the top of `src/script.js` in the `feeds` array:

```js
const feeds = [
  { name: 'BBC (World)', url: 'http://feeds.bbci.co.uk/news/world/rss.xml', category: 'world' },
  { name: 'Reuters (US)', url: 'https://www.reuters.com/world/us/rss', category: 'us' },
  { name: 'Dark Reading', url: 'https://www.darkreading.com/rss.xml', category: 'cyber' },
  // add more...
];
```

* **name**: label displayed under each card
* **url**: RSS/Atom feed URL (full URL)
* **category**: one of `'world' | 'us' | 'cyber'` (controls which tab shows it)

> AP feeds often require licensed endpoints; they’re not included by default.

### Add a new category (optional)

1. Add a button in `index.html`:

   ```html
   <button class="source-btn" data-cat="science">SCIENCE</button>
   ```
2. Tag feeds with `category: 'science'`.
3. Give it a color in `script.js`:

   ```js
   const catColor = (c) => ({
     world:'#e74c3c', us:'#2ecc71', cyber:'#1abc9c',
     science:'#8e44ad', // new
     default:'#667eea'
   }[c] || '#667eea');
   ```

---

## 🖧 Server Details

`src/server.js` does three things:

1. **Serves static files** for the whole project (so deep links work).
2. **RSS proxy** at `GET /rss?url=...` to avoid browser CORS when fetching feeds.
3. **Logging endpoint** `POST /write-log` used by the client to append messages to `news-dashboard/debug.log`.

* Default port: **8080** (change the `PORT` constant if needed).
* Logs: `news-dashboard/debug.log` (delete it to clear; it’ll be recreated).

---

## 🌐 Deployment

This app is static, but it **does need** a small proxy for RSS:

* **Node/VM:** run `server.js` behind nginx/Apache and keep it up with pm2 or systemd.
* **Serverless/Workers:** port the `/rss` endpoint to a Cloudflare Worker, Netlify Function, or Vercel Function, then update the client to call your endpoint (replace `/rss?...`).

> Pure static hosting (GitHub Pages/Netlify without functions) will hit CORS on many feeds.

---

## 🧪 Troubleshooting

* **No cards / empty state**

  * Check DevTools → **Network** for `/rss?url=...` responses.
  * Make sure `node server.js` is running and you’re on `http://localhost:8080/...`.
  * Some publishers throttle or move RSS paths—swap in a current feed URL.

* **Only one tab shows content**

  * Ensure each feed’s `category` matches one of `world | us | cyber`.
  * Filters are static buttons in `index.html`; no “ALL” exists by design.

* **Port already in use**

  * Change `const PORT = 8080;` in `server.js`.

* **Logs not updating**

  * File permissions or path issues—`server.js` writes to `../debug.log` from `src/`.

---

## 🗺️ Roadmap (nice-to-haves)

* AP’s public site doesn’t offer open RSS; need their API
* Offline cache of last successful fetch