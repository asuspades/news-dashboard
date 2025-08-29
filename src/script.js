// News Dashboard client (resilient)
// - Same-origin proxy: GET /rss?url=...
// - Categories: WORLD | US | CYBER
// - Robust XML parsing with entity sanitization + regex fallback
// - Auto-fallback for JS/captcha pages (Reuters etc.)
// - Fair interleave + de-dupe + detailed logging

console.log('Script loaded and running (resilient parser build)');

const REFRESH_MS = 15 * 60 * 1000; // 15 minutes
const FEED_ITEM_LIMIT = 25;
const MAX_RENDER = 200;
const REQUEST_TIMEOUT_MS = 15000;

// --------------------------- Sources (mirrors + fallbacks) ---------------------------
const feeds = [
  // US
  { name: 'BBC (US & Canada)',   url: 'http://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', category: 'us' },
  { name: 'The Guardian (US)',   url: 'https://www.theguardian.com/us-news/rss',                  category: 'us' },
  { name: 'The Independent (US)',url: 'https://www.independent.co.uk/topic/us/rss',               category: 'us' },
  { name: 'POLITICO (Politics)', urls: [
      // Put the working mirror first
      'https://rss.politico.com/politics-news.xml',
      'https://www.politico.com/rss/politics-news.xml',
      'https://www.politico.com/rss/politics08.xml'
    ], category: 'us'
  },
  { name: 'Racket News',         url: 'https://www.racket.news/feed',                             category: 'us' },
  { name: 'FfF Online (Reports)',url: 'https://foundationforfreedomonline.com/category/reports/feed/', category: 'us' },
  { name: 'Reuters (US)',        urls: [
      'https://feeds.reuters.com/reuters/USNews',
      'https://feeds.reuters.com/Reuters/USNews'
    ], category: 'us'
  },

  // World
  { name: 'BBC (World)',         url: 'http://feeds.bbci.co.uk/news/world/rss.xml',               category: 'world' },
  { name: 'The Guardian (World)',url: 'https://www.theguardian.com/world/rss',                    category: 'world' },
  { name: 'The Independent (World)', url: 'https://www.independent.co.uk/news/world/rss',         category: 'world' },
  { name: 'Popular Resistance',  url: 'https://popularresistance.org/feed/',                      category: 'world' },
  { name: 'Bellingcat',          url: 'https://www.bellingcat.com/feed/',                         category: 'world' },
  { name: 'The Grayzone',        urls: [
      'https://thegrayzone.com/feed/',
      'https://thegrayzone.com/category/news/feed/'
    ], category: 'world'
  },
  { name: 'Reuters (World)',     urls: [
      'https://feeds.reuters.com/reuters/worldNews',
      'https://feeds.reuters.com/Reuters/worldNews'
    ], category: 'world'
  },
  { name: 'WSJ (World)',         url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml',              category: 'world' },

  // Cybersecurity
  { name: 'Dark Reading',        url: 'https://www.darkreading.com/rss.xml',                      category: 'cyber' },
  { name: 'The Hacker News',     url: 'https://thehackernews.com/feeds/posts/default?alt=rss',    category: 'cyber' },
  { name: 'Cybersecurity Hub',   urls: [
      'https://www.cshub.com/rss.xml',
      'https://cshub.com/rss.xml'
    ], category: 'cyber'
  },
  { name: 'The Hill (Cyber)',    url: 'https://thehill.com/policy/cybersecurity/feed/',           category: 'cyber' },
];

// --------------------------- Logging ---------------------------
async function writeToLog(message) {
  try {
    const res = await fetch('/write-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error('log error:', e);
  }
}

// --------------------------- DOM & State ---------------------------
const $ = id => document.getElementById(id);
const newsGrid   = $('newsGrid');
const loader     = $('loader');
const statusEl   = $('status');
const filtersEl  = $('filters');
const refreshBtn = $('refreshBtn');

let allArticles = [];
let currentCat = 'world';
let timer = null;

// --------------------------- Utils ---------------------------
const fmtAgo = (d) => {
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms/60000), h = Math.floor(ms/3600000), day = Math.floor(ms/86400000);
  if (day > 0) return `${day}d ago`;
  if (h > 0)   return `${h}h ago`;
  if (m > 0)   return `${m}m ago`;
  return 'Just now';
};

const catColor = (c) => ({
  world:'#e74c3c', us:'#2ecc71', cyber:'#1abc9c',
  politics:'#9b59b6', business:'#3498db', tech:'#1abc9c',
  sports:'#f39c12', entertainment:'#e91e63', default:'#667eea'
}[c] || '#667eea');

function canonicalLink(url){
  try {
    const u = new URL(url);
    u.hash = '';
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id','mc_cid','mc_eid'].forEach(p=>u.searchParams.delete(p));
    return u.toString();
  } catch { return url || ''; }
}

const dedupeBy = (arr, keyFn) => {
  const seen = new Set();
  return arr.filter(x => {
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

function shuffleInPlace(a){
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fairMixBySource(items){
  if (items.length <= 2) return items.slice();
  const bySource = new Map();
  for (const it of items) {
    const s = it.source || 'Unknown';
    if (!bySource.has(s)) bySource.set(s, []);
    bySource.get(s).push(it);
  }
  const sources = Array.from(bySource.keys());
  for (const s of sources) bySource.get(s).sort((a,b)=>b.pubDate - a.pubDate);
  shuffleInPlace(sources);
  const queues = sources.map(s => bySource.get(s).slice());
  const result = [];
  let remaining = items.length;
  let start = Math.floor(Math.random()*sources.length);
  while (remaining > 0) {
    for (let step = 0; step < sources.length; step++) {
      const idx = (start + step) % sources.length;
      const q = queues[idx];
      if (q && q.length) {
        result.push(q.shift());
        if (--remaining === 0) break;
      }
    }
    start = Math.floor(Math.random()*sources.length);
  }
  return shuffleInPlace(result);
}

function setStatus(msg, loading=false){
  statusEl.textContent = msg;
  loader.style.display = loading ? 'block' : 'none';
  refreshBtn.disabled = loading;
}

function setActiveButton(cat){
  filtersEl.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === cat);
  });
}

// --------------------------- Fetch helpers ---------------------------
function fetchWithTimeout(url, opts = {}, timeoutMs = REQUEST_TIMEOUT_MS){
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: ctl.signal })
    .finally(() => clearTimeout(id));
}

const JS_BLOCK_PATTERNS = [
  'Please enable JS and disable any ad blocker',
  'captcha-delivery.com',
  'geo.captcha-delivery.com',
  'ct.captcha-delivery.com'
];

function looksLikeJSBlockPage(text){
  const head = (text || '').slice(0, 1200);
  return JS_BLOCK_PATTERNS.some(s => head.includes(s));
}

async function discoverFeedUrl(homepage){
  try {
    const res = await fetchWithTimeout(`/rss?url=${encodeURIComponent(homepage)}`);
    const html = await res.text();
    if (looksLikeJSBlockPage(html)) return null;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const el = doc.querySelector(
      'link[rel="alternate"][type*="rss"], link[type="application/rss+xml"], link[type="application/atom+xml"]'
    );
    if (!el) return null;
    let href = el.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) {
      href = new URL(href, homepage).toString();
    }
    return href;
  } catch {
    return null;
  }
}

function normalizeCandidateList(feed){
  if (feed.urls && Array.isArray(feed.urls)) return feed.urls.slice();
  if (feed.url) return [feed.url];
  return [];
}

// --- XML hardening ---
// Some feeds ship HTML entities invalid for XML (&nbsp;, &ndash;, etc.). Replace with numeric refs.
function sanitizeXmlEntities(xml) {
  if (!xml) return '';
  const map = {
    nbsp: '#160', ndash: '#8211', mdash: '#8212', middot: '#183',
    copy: '#169', reg: '#174', trade: '#8482',
    rsquo: '#8217', lsquo: '#8216', rdquo: '#8221', ldquo: '#8220',
    hellip: '#8230', euro: '#8364', laquo: '#171', raquo: '#187'
  };
  return xml.replace(/&([a-zA-Z]+);/g, (m, name) => {
    if (['amp','lt','gt','quot','apos'].includes(name)) return m; // valid XML entities
    if (map[name]) return `&${map[name]};`;
    return m; // leave unknown entities; regex fallback will still work
  });
}

// Regex fallback for RSS/Atom when DOM parse fails
function regexParseItems(xml, feedName) {
  const items = [];
  // Try RSS <item>…
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) && items.length < FEED_ITEM_LIMIT) {
    const chunk = m[0];
    const get = (tag) => (chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')) || [,''])[1].trim();
    const getAttr = (tag, attr) => {
      const a = chunk.match(new RegExp(`<${tag}[^>]*\\b${attr}=["']([^"']+)["'][^>]*>`, 'i'));
      return (a && a[1]) || '';
    };
    let title = get('title') || '(untitled)';
    // Strip CDATA markers if present
    title = title.replace(/^<!\[CDATA\[(.*)\]\]>$/s, '$1').trim();

    let link = get('link') || getAttr('link','href') || get('guid');
    if (link) link = link.replace(/^<!\[CDATA\[(.*)\]\]>$/s, '$1').trim();

    const pub = get('pubDate');
    const dt = pub ? new Date(pub) : new Date();

    items.push({ title, link, source: feedName, pubDate: isNaN(dt) ? new Date() : dt });
  }
  if (items.length) return items;

  // Try Atom <entry>…
  const entryRe = /<entry[\s\S]*?<\/entry>/gi;
  while ((m = entryRe.exec(xml)) && items.length < FEED_ITEM_LIMIT) {
    const chunk = m[0];
    const get = (tag) => (chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')) || [,''])[1].trim();
    const linkHref = (() => {
      const a = chunk.match(/<link[^>]*rel=["']?alternate["']?[^>]*href=["']([^"']+)["'][^>]*>/i) ||
                chunk.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
      return (a && a[1]) || '';
    })();
    let title = get('title') || '(untitled)';
    title = title.replace(/^<!\[CDATA\[(.*)\]\]>$/s, '$1').trim();
    const link = (linkHref || get('id')).replace(/^<!\[CDATA\[(.*)\]\]>$/s, '$1').trim();
    const pub = get('updated') || get('published');
    const dt = pub ? new Date(pub) : new Date();
    items.push({ title, link, source: feedName, pubDate: isNaN(dt) ? new Date() : dt });
  }
  return items;
}

function parseRssXmlToArticles(xmlText, feed, urlUsed){
  // 1) quick block-page detection
  if (looksLikeJSBlockPage(xmlText)) return { items: [], blocked: true };

  // 2) sanitize common HTML entities that break XML
  const cleaned = sanitizeXmlEntities(xmlText);

  // 3) attempt DOM parse
  const doc = new DOMParser().parseFromString(cleaned, 'text/xml');
  const hasError = doc.getElementsByTagName('parsererror').length > 0;

  let nodes = [];
  if (!hasError) {
    nodes = [...doc.querySelectorAll('item')];
    if (!nodes.length) nodes = [...doc.querySelectorAll('entry')];
  }

  // 3a) Successful DOM path
  if (!hasError && nodes.length) {
    const articles = nodes.slice(0, FEED_ITEM_LIMIT).map(node => {
      const text = (sel) => node.querySelector(sel)?.textContent?.trim() || '';
      const attr = (sel, a) => node.querySelector(sel)?.getAttribute(a) || '';
      let title = text('title') || '(untitled)';

      let link = text('link') ||
                 attr('link[rel="alternate"]','href') ||
                 attr('link','href') ||
                 text('id') ||
                 urlUsed;

      const guid = text('guid');
      if ((!/^https?:\/\//i.test(link)) && /^https?:\/\//i.test(guid)) link = guid;

      const pub = text('pubDate') || text('updated') || text('published') || new Date().toISOString();
      const dt = new Date(pub);

      return {
        title,
        link,
        source: feed.name,
        category: feed.category,
        pubDate: isNaN(dt) ? new Date() : dt
      };
    });
    return { items: articles, blocked: false };
  }

  // 4) Fallback regex parse
  const fallback = regexParseItems(xmlText, feed.name).map(a => ({
    ...a,
    category: feed.category
  }));
  return { items: fallback, blocked: false, domFailed: true };
}

// Try each candidate URL; handle discovery + JS-block fallbacks.
async function fetchFeed(feed){
  const candidates = normalizeCandidateList(feed);
  const tried = new Set();

  async function tryOne(u){
    if (!u || tried.has(u)) return [];
    tried.add(u);

    const res = await fetchWithTimeout(`/rss?url=${encodeURIComponent(u)}`, {
      headers: { 'Accept': 'application/rss+xml, application/atom+xml, text/xml, */*' }
    });
    if (!res.ok) throw new Error(`${feed.name} ${res.status}`);

    const text = await res.text();
    const { items, blocked, domFailed } = parseRssXmlToArticles(text, feed, u);

    if (blocked) {
      // Try direct RSS mirrors if this was a section/homepage
      if (!/\/(rss|feed)/i.test(u)) {
        // Known fallbacks for Reuters sections:
        if (/reuters\.com\/world\/us\/?$/i.test(u)) {
          return tryOne('https://feeds.reuters.com/reuters/USNews');
        }
        if (/reuters\.com\/world\/?$/i.test(u)) {
          return tryOne('https://feeds.reuters.com/reuters/worldNews');
        }
      }
      await writeToLog(`Blocked/JS page for ${feed.name} @ ${u}`);
      return [];
    }

    if (items.length) {
      await writeToLog(`Fetched ${items.length} from ${feed.name} (${u})${domFailed ? ' [regex]' : ''}`);
      return items;
    }

    // 0 items -> attempt discovery once if this looked like a page
    if (!/\/(rss|feed)/i.test(u)) {
      const discovered = await discoverFeedUrl(u);
      if (discovered && !tried.has(discovered)) {
        await writeToLog(`Discovered RSS for ${feed.name}: ${discovered}`);
        return tryOne(discovered);
      }
    }

    await writeToLog(`No items from ${feed.name} (${u})`);
    return [];
  }

  try {
    for (const candidate of candidates) {
      const items = await tryOne(candidate);
      if (items.length) return items;
    }
    // Last resort discovery if a single homepage was provided
    if (candidates.length === 1 && !/\/(rss|feed)/i.test(candidates[0])) {
      const discovered = await discoverFeedUrl(candidates[0]);
      if (discovered) return await tryOne(discovered);
    }
    return [];
  } catch (e) {
    await writeToLog(`Error ${feed.name}: ${e.message}`);
    return [];
  }
}

// --------------------------- Rendering ---------------------------
function render(articles){
  if (!articles.length) {
    newsGrid.innerHTML = `<div class="empty-state">No ${currentCat.toUpperCase()} articles found.</div>`;
    return;
  }

  newsGrid.innerHTML = articles.slice(0, MAX_RENDER).map((a,i)=>`
    <a href="${a.link}" class="card fade-in" target="_blank" style="animation-delay:${i*0.035}s">
      <h2>${a.title}</h2>
      <div class="card-meta">
        <div>
          <span class="source">${a.source}</span>
          <span class="category-tag" style="background-color:${catColor(a.category)}20;color:${catColor(a.category)}">
            ${(a.category||'news').toUpperCase()}
          </span>
        </div>
        <span class="timestamp">${fmtAgo(a.pubDate)}</span>
      </div>
    </a>
  `).join('');
}

function applyFilter(){
  const subset = allArticles.filter(a => a.category === currentCat);
  const deduped = dedupeBy(subset, x => canonicalLink(x.link));
  const mixed = fairMixBySource(deduped);
  render(mixed);
  setStatus(`Showing ${mixed.length} ${currentCat.toUpperCase()} articles`);
}

// --------------------------- Update + Auto Refresh ---------------------------
async function updateDashboard(){
  setStatus('Fetching headlines...', true);
  newsGrid.innerHTML = '';

  console.time('fetchAllFeeds');
  const batches = await Promise.allSettled(feeds.map(fetchFeed));
  console.timeEnd('fetchAllFeeds');

  const flat = batches.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  allArticles = dedupeBy(flat, x => canonicalLink(x.link));

  applyFilter();
  setStatus('Headlines updated');
}

function startAuto(){ timer = setInterval(updateDashboard, REFRESH_MS); }
function stopAuto(){ if (timer) clearInterval(timer); }

// --------------------------- Init ---------------------------
document.addEventListener('DOMContentLoaded', () => {
  filtersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cat]');
    if (!btn) return;
    currentCat = btn.dataset.cat;
    setActiveButton(currentCat);
    applyFilter();
  });

  setActiveButton(currentCat);
  updateDashboard();
  startAuto();
});

$('refreshBtn').addEventListener('click', updateDashboard);
document.addEventListener('visibilitychange', () => document.hidden ? stopAuto() : startAuto());

console.log('Script is running and calling writeToLog');
writeToLog('Client booted (resilient RSS parser)');