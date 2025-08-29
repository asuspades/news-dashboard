const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = path.resolve(__dirname, '..', '..');        // project root
const LOG_FILE = path.resolve(__dirname, '..', 'debug.log');

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.ico':'image/x-icon',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.txt':'text/plain; charset=utf-8',
  '.xml':'text/xml; charset=utf-8'
};

function send(res, code, body, headers={}){ res.writeHead(code, headers); res.end(body); }

function serveStatic(req, res){
  if (req.url === '/' || req.url === '/index.html') {
    return send(res, 302, 'Redirect', { Location: '/news-dashboard/src/' });
  }
  const safeUrl = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.normalize(path.join(ROOT, safeUrl));
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');

  fs.stat(filePath, (err, stat) => {
    if (err) return send(res, 404, 'Not Found');
    const target = stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    fs.readFile(target, (e, data) => {
      if (e) return send(res, 404, 'Not Found');
      const ext = path.extname(target).toLowerCase();
      send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    });
  });
}

const server = http.createServer(async (req, res) => {
  // CORS-friendly OPTIONS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type',
      'Access-Control-Max-Age':'600'
    });
    return res.end();
  }

  // Logging endpoint (unchanged)
  if (req.method === 'POST' && req.url === '/write-log') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', () => {
      try {
        const { message } = JSON.parse(body || '{}');
        fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} - ${message || ''}\n`);
        send(res, 200, JSON.stringify({ status: 'ok' }), { 'Content-Type':'application/json' });
      } catch (e) {
        send(res, 500, JSON.stringify({ status: 'error', error: e.message }), { 'Content-Type':'application/json' });
      }
    });
    return;
  }

  // NEW: RSS proxy to bypass CORS cleanly
  if (req.method === 'GET' && req.url.startsWith('/rss?')) {
    try {
      const u = new URL(req.url, `http://localhost:${PORT}`);
      const target = u.searchParams.get('url');
      if (!target) return send(res, 400, 'Missing url param');

      // Node 18+ has global fetch
      const r = await fetch(target, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (NewsDash)',
          'Accept': 'application/rss+xml, application/atom+xml, text/xml;q=0.9, */*;q=0.8'
        },
        redirect: 'follow'
      });
      const text = await r.text();
      return send(res, 200, text, { 'Content-Type': 'text/xml; charset=utf-8' });
    } catch (e) {
      return send(res, 502, `Upstream fetch failed: ${e.message}`);
    }
  }

  // Everything else → static
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Root: ${ROOT}`);
  console.log(`Log:  ${LOG_FILE}`);
});