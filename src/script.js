console.log('Script loaded and running');

const REFRESH_MS = 15 * 60 * 1000; // 15 min

// ---- Sources (RSS endpoints; tag each with category: 'world' | 'us' | 'cyber') ----
const feeds = [
  // World / US
  { name: 'BBC (US & Canada)',   url: 'http://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', category: 'us' },
  { name: 'BBC (World)',         url: 'http://feeds.bbci.co.uk/news/world/rss.xml',               category: 'world' },
  { name: 'Guardian (US)',       url: 'https://www.theguardian.com/us-news/rss',                  category: 'us' },
  { name: 'Guardian (World)',    url: 'https://www.theguardian.com/world/rss',                    category: 'world' },
  { name: 'Independent (US)',    url: 'https://www.independent.co.uk/topic/us/rss',               category: 'us' },
  { name: 'Independent (World)', url: 'https://www.independent.co.uk/news/world/rss',             category: 'world' },
  { name: 'POLITICO (Politics)', url: 'https://www.politico.com/rss/politics-news.xml',           category: 'us' },
  { name: 'Popular Resistance',  url: 'https://popularresistance.org/feed/',                      category: 'world' },
  { name: 'Racket News',         url: 'https://www.racket.news/feed',                             category: 'us' },
  { name: 'Bellingcat',          url: 'https://www.bellingcat.com/feed/',                         category: 'world' },
  { name: 'FfF Online Reports',  url: 'https://foundationforfreedomonline.com/category/reports/feed/', category: 'us' },
  { name: 'Grayzone',            url: 'https://thegrayzone.com/feed/',                            category: 'world' },
  { name: 'Reuters (US)',        url: 'https://www.reuters.com/world/us/rss',                     category: 'us' },
  { name: 'Reuters (World)',     url: 'https://www.reuters.com/world/rss',                        category: 'world' },
  { name: 'WSJ (World)',         url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml',              category: 'world' },

  // Cybersecurity
  { name: 'Dark Reading',        url: 'https://www.darkreading.com/rss.xml',                      category: 'cyber' },
  { name: 'The Hacker News',     url: 'https://thehackernews.com/feeds/posts/default?alt=rss',    category: 'cyber' },
  { name: 'Cybersecurity Hub',   url: 'https://www.cshub.com/rss.xml',                            category: 'cyber' },
  { name: 'The Hill (Cyber)',    url: 'https://thehill.com/policy/cybersecurity/feed/',           category: 'cyber' },
];

// ---- Logging (same-origin to Node) ----
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

// ---- DOM helpers and state ----
const $ = id => document.getElementById(id);
const newsGrid = $('newsGrid');
const loader = $('loader');
const statusEl = $('status');
const filtersEl = $('filters');
const refreshBtn = $('refreshBtn');

let allArticles = [];
let currentCat = 'world';   // default category (no "ALL")
let timer = null;

// ---- Utils ----
const fmtAgo = (d) => {
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms/60000), h = Math.floor(ms/3600000), day = Math.floor(ms/86400000);
  if (day > 0) return `${day}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'Just now';
};
const catColor = (c) => ({
  world:'#e74c3c', us:'#2ecc71', cyber:'#1abc9c',
  politics:'#9b59b6', business:'#3498db', tech:'#1abc9c',
  sports:'#f39c12', entertainment:'#e91e63', default:'#667eea'
}[c] || '#667eea');
const dedupeBy = (arr, keyFn) => {
  const seen = new Set();
  return arr.filter(x => {
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

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

// ---- RSS fetch + parse ----
async function fetchFeed(feed){
  try {
    const res = await fetch(`/rss?url=${encodeURIComponent(feed.url)}`);
    if (!res.ok) throw new Error(`${feed.name} ${res.status}`);
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml');

    let items = [...doc.querySelectorAll('item')];
    if (!items.length) items = [...doc.querySelectorAll('entry')];

    const articles = items.slice(0, 12).map(node => {
      const get = (sel) => node.querySelector(sel)?.textContent?.trim() || '';
      const getAttr = (sel, attr) => node.querySelector(sel)?.getAttribute(attr) || '';
      const title = get('title') || '(untitled)';
      const link  = get('link') || getAttr('link[rel="alternate"]','href') || getAttr('link','href') || feed.url;
      const pub   = get('pubDate') || get('updated') || get('published') || new Date().toISOString();
      const dt    = new Date(pub);
      return { title, link, source: feed.name, category: feed.category, pubDate: isNaN(dt) ? new Date() : dt };
    });

    await writeToLog(`Fetched ${articles.length} from ${feed.name}`);
    return articles;
  } catch (e) {
    await writeToLog(`Error ${feed.name}: ${e.message}`);
    return [];
  }
}

// ---- Rendering ----
function render(articles){
  if (!articles.length) {
    newsGrid.innerHTML = `<div class="empty-state">No ${currentCat.toUpperCase()} articles found.</div>`;
    return;
  }
  newsGrid.innerHTML = articles.map((a,i)=>`
    <a href="${a.link}" class="card fade-in" target="_blank" style="animation-delay:${i*0.06}s">
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
  const shown = allArticles.filter(a => a.category === currentCat);
  render(shown);
  setStatus(`Showing ${shown.length} ${currentCat.toUpperCase()} articles`);
}

// ---- Update + Auto refresh ----
async function updateDashboard(){
  setStatus('Fetching headlines...', true);
  newsGrid.innerHTML = '';
  const batches = await Promise.all(feeds.map(fetchFeed));
  const flat = batches.flat();

  // Dedupe by canonical link & sort newest first
  allArticles = dedupeBy(flat, x => (x.link || '').replace(/#.*$/,''))
                  .sort((a,b) => b.pubDate - a.pubDate);

  // Keep current filter (don’t reset to ALL since it doesn’t exist)
  applyFilter();
  setStatus('Headlines updated');
}

function startAuto(){ timer = setInterval(updateDashboard, REFRESH_MS); }
function stopAuto(){ if (timer) clearInterval(timer); }

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  // Static filter buttons in HTML: WORLD | US | CYBER
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
document.addEventListener('visibilitychange', ()=> document.hidden ? stopAuto() : startAuto());

// Trace
console.log('Script is running and calling writeToLog');
writeToLog('Client booted');