/* WP Pulse — local dev server.
   Serves the static app and provides the fetch proxy that browsers otherwise block.
   Node built-ins only. No dependencies, no install step.

     node server.js          then open http://localhost:8787

   The proxy is read-only: GET only, capped size, private addresses refused. */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');

const PORT = process.env.PORT || 8787;
const ROOT = __dirname;
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT = 20000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/* --- SSRF guard: never let the proxy reach inside the network it runs on --- */

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
      || a >= 224;
  }
  const s = ip.toLowerCase();
  return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd')
    || s.startsWith('fe80') || s.startsWith('::ffff:');
}

async function safeTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'Bad URL'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http and https';
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) return 'Refused: local host';
  try {
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (addrs.some(a => isPrivate(a.address))) return 'Refused: private address';
  } catch { return 'DNS lookup failed'; }
  return null;
}

/* ---------------------------------------------------------------- proxy --- */

async function proxy(req, res, target) {
  const bad = await safeTarget(target);
  if (bad) return json(res, 400, { error: bad });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT);

  try {
    const r = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 WP-Pulse/1.0',
        'accept': '*/*',
        'accept-language': 'en-AU,en;q=0.9'
      }
    });

    const headers = {};
    r.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

    const buf = Buffer.from(await r.arrayBuffer());
    const body = buf.subarray(0, MAX_BYTES).toString('utf8');

    json(res, 200, { status: r.status, finalUrl: r.url, headers, body, truncated: buf.length > MAX_BYTES });
  } catch (e) {
    json(res, 200, { status: 0, finalUrl: target, headers: {}, body: '', error: String(e.message || e) });
  } finally {
    clearTimeout(timer);
  }
}

function json(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store'
  });
  res.end(s);
}

/* ---------------------------------------------------------------- static -- */

function serve(res, file) {
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(full)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(data);
  });
}

/* ------------------------------------------------------------------ boot -- */

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS'
    });
    return res.end();
  }

  if (u.pathname === '/proxy') {
    const target = u.searchParams.get('url');
    if (!target) return json(res, 400, { error: 'Missing url' });
    return proxy(req, res, target);
  }

  serve(res, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\/+/, ''));
}).listen(PORT, () => {
  console.log('WP Pulse  →  http://localhost:' + PORT);
});
