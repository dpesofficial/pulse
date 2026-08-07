/* WP Pulse — Cloudflare Worker proxy.
   Same contract as the /proxy route in server.js, so the app cannot tell them apart.
   Free tier: 100,000 requests a day. A full scan uses roughly 30 to 60.

   Deploy: dash.cloudflare.com → Workers → Create → paste this → Deploy.
   Then put the workers.dev URL + /proxy into the app's proxy field.

   Read-only. GET only. Private addresses refused. */

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT = 20000;

/* Only these origins may use the proxy. Add your Pages URL before deploying. */
const ALLOWED = [
  'http://localhost:8787',
  'https://dpesofficial.github.io'
];

function cors(origin) {
  const ok = ALLOWED.includes(origin) ? origin : ALLOWED[ALLOWED.length - 1];
  return {
    'access-control-allow-origin': ok,
    'access-control-allow-methods': 'GET, OPTIONS',
    'cache-control': 'no-store'
  };
}

function isPrivateHost(h) {
  const s = h.toLowerCase();
  if (/^(localhost|.*\.local|.*\.internal)$/.test(s)) return true;
  const m = s.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (m) {
    const a = +m[1], b = +m[2];
    return a === 10 || a === 127 || a === 0 || a >= 224
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254);
  }
  return s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80');
}

export default {
  async fetch(request) {
    const origin = request.headers.get('origin') || '';
    const head = cors(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: head });
    if (request.method !== 'GET') return json({ error: 'GET only' }, 405, head);

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return json({ error: 'Missing url' }, 400, head);

    let u;
    try { u = new URL(target); } catch { return json({ error: 'Bad URL' }, 400, head); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return json({ error: 'Only http and https' }, 400, head);
    if (isPrivateHost(u.hostname)) return json({ error: 'Refused: private address' }, 400, head);

    try {
      const r = await fetch(u.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT),
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 WP-Pulse/1.0',
          'accept': '*/*',
          'accept-language': 'en-AU,en;q=0.9'
        }
      });

      const headers = {};
      r.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

      const buf = await r.arrayBuffer();
      const body = new TextDecoder('utf-8').decode(buf.slice(0, MAX_BYTES));

      return json({
        status: r.status, finalUrl: r.url, headers, body,
        truncated: buf.byteLength > MAX_BYTES
      }, 200, head);
    } catch (e) {
      return json({ status: 0, finalUrl: target, headers: {}, body: '', error: String(e) }, 200, head);
    }
  }
};

function json(obj, status, head) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...head }
  });
}
