/* WP Pulse — WordPress site reader.
   Static. No backend, no keys, no credentials, nothing stored server-side.
   Direct fetch where the source allows CORS; proxy only where browsers block us. */

'use strict';

/* ------------------------------------------------------------------ config */

const WPORG_PLUGIN = 'https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request%5Bslug%5D=';
const WPORG_THEME  = 'https://api.wordpress.org/themes/info/1.2/?action=theme_information&request%5Bslug%5D=';
const WPORG_CORE   = 'https://api.wordpress.org/core/version-check/1.7/';
const VULN_PLUGIN  = 'https://www.wpvulnerability.net/plugin/';
const VULN_THEME   = 'https://www.wpvulnerability.net/theme/';
const VULN_CORE    = 'https://www.wpvulnerability.net/wordpress/';

/* Must match BM_VERSION in collect.js. Older payloads carry known-wrong counts,
   so they are refused outright rather than merged into a report. */
const BM_VERSION = 4;

/* PHP security-support end dates. Stable data, worth hardcoding. */
const PHP_EOL = {
  '5.6': '2018-12-31', '7.0': '2019-01-10', '7.1': '2019-12-01', '7.2': '2020-11-30',
  '7.3': '2021-12-06', '7.4': '2022-11-28', '8.0': '2023-11-26', '8.1': '2025-12-31',
  '8.2': '2026-12-31', '8.3': '2027-12-31', '8.4': '2028-12-31', '8.5': '2029-12-31'
};

/* REST namespace -> wordpress.org slug. Namespaces rarely match the slug. */
const NS_SLUG = {
  'wordfence': 'wordfence', 'yoast': 'wordpress-seo', 'rankmath': 'seo-by-rank-math',
  'contact-form-7': 'contact-form-7', 'wpcf7': 'contact-form-7', 'akismet': 'akismet',
  'jetpack': 'jetpack', 'wc': 'woocommerce', 'wc-analytics': 'woocommerce',
  'wc-admin': 'woocommerce', 'wc-blocks': 'woocommerce', 'elementor': 'elementor',
  'redirection': 'redirection', 'duplicate-post': 'duplicate-post',
  'regenerate-thumbnails': 'regenerate-thumbnails', 'wpforms': 'wpforms-lite',
  'litespeed': 'litespeed-cache', 'wp-smush': 'wp-smushit', 'smush': 'wp-smushit',
  'ninja-forms': 'ninja-forms', 'mailpoet': 'mailpoet', 'wpml': 'sitepress-multilingual-cms',
  'gf': 'gravityforms', 'wp-rocket': 'wp-rocket', 'link-whisper': 'link-whisper',
  'acf': 'advanced-custom-fields',
  'aioseo': 'all-in-one-seo-pack', 'wordpress-seo': 'wordpress-seo',
  'sensei': 'sensei-lms', 'give-api': 'give', 'give': 'give',
  'wpseopress': 'wp-seopress', 'seopress': 'wp-seopress', 'wpe': null,
  'complianz': 'complianz-gdpr', 'wpstatistics': 'wp-statistics',
  'updraftplus': 'updraftplus', 'wp-super-cache': 'wp-super-cache'
};

/* Plugins with no wordpress.org listing. Not a fault, just unknowable from outside.
   Compared after normSlug(), so link-whisper-premium matches link-whisper. */
const PREMIUM = new Set([
  'wp-rocket', 'gravityforms', 'gf', 'sitepress-multilingual-cms', 'wpml',
  'link-whisper', 'acf', 'advanced-custom-fields-pro', 'wpe', 'wpengine',
  'elementor-pro', 'wpforms', 'searchwp', 'facetwp', 'perfmatters'
]);

/* Plugins that announce themselves in a generator meta tag. Free version data. */
const GENERATORS = [
  [/content=["']WP Rocket\s+([\d.]+)/i, 'wp-rocket'],
  [/content=["']Yoast SEO\s+v?([\d.]+)/i, 'wordpress-seo'],
  [/content=["']Elementor\s+([\d.]+)/i, 'elementor'],
  [/content=["']WooCommerce\s+([\d.]+)/i, 'woocommerce'],
  [/content=["']Site Kit by Google\s+([\d.]+)/i, 'google-site-kit'],
  [/content=["']Rank Math[^"']*?([\d.]+)/i, 'seo-by-rank-math'],
  [/content=["']All in One SEO[^"']*?([\d.]+)/i, 'all-in-one-seo-pack']
];

const TAGS = [
  ['Google Tag Manager', /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/],
  ['GA4',                /gtag\/js\?id=G-|["']G-[A-Z0-9]{8,}["']/],
  ['Meta Pixel',         /connect\.facebook\.net|fbq\s*\(/],
  ['CallRail',           /cdn\.callrail\.com/],
  ['Hotjar',             /static\.hotjar\.com/],
  ['Clarity',            /clarity\.ms/],
  ['LinkedIn Insight',   /snap\.licdn\.com/]
];

/* What the site is built with. Facts, no verdicts, so no colour and no dots.
   Answers "what am I walking into" on a site you have never opened before. */
const STACK_SIGNS = [
  ['Page builder', 'Elementor',        /elementor-frontend|\/plugins\/elementor\//i],
  ['Page builder', 'Divi',             /\/themes\/Divi\/|\bet_pb_/i],
  ['Page builder', 'WPBakery',         /js_composer|\bvc_row\b/i],
  ['Page builder', 'Beaver Builder',   /fl-builder/i],
  ['Page builder', 'Bricks',           /\/themes\/bricks\//i],
  ['Page builder', 'Oxygen',           /oxygen-vsb|\bct_section\b/i],
  ['Page builder', 'Gutenberg',        /wp-includes\/css\/dist\/block-library/i],
  ['Ecommerce',    'WooCommerce',      /woocommerce/i],
  ['Ecommerce',    'Easy Digital Downloads', /easy-digital-downloads/i],
  ['Forms',        'Gravity Forms',    /gravityforms|\bgform_/i],
  ['Forms',        'Contact Form 7',   /wpcf7|contact-form-7/i],
  ['Forms',        'WPForms',          /wpforms/i],
  ['Forms',        'Ninja Forms',      /ninja-forms|\bnf-form/i],
  ['Forms',        'Fluent Forms',     /fluentform/i],
  ['Forms',        'Formspark',        /submit-form\.com/i],
  ['SEO',          'Yoast SEO',        /yoast|wordpress-seo/i],
  ['SEO',          'Rank Math',        /rank-?math/i],
  ['SEO',          'All in One SEO',   /all-in-one-seo/i],
  ['Cache',        'WP Rocket',        /wp-rocket|\bwpr-/i],
  ['Cache',        'LiteSpeed',        /litespeed/i],
  ['Cache',        'W3 Total Cache',   /w3-total-cache|\bw3tc/i],
  ['Cache',        'WP Super Cache',   /wp-super-cache/i],
  ['Security',     'Wordfence',        /wordfence/i],
  ['Security',     'Sucuri',           /sucuri/i],
  ['Consent',      'CookieYes',        /cookieyes|cookie-law-info/i],
  ['Consent',      'Complianz',        /complianz|\bcmplz/i],
  ['Consent',      'Cookiebot',        /cookiebot/i],
  ['Consent',      'OneTrust',         /onetrust/i],
  ['Fonts',        'Google Fonts',     /fonts\.(googleapis|gstatic)\.com/i],
  ['Fonts',        'Adobe Fonts',      /use\.typekit\.net/i],
  ['JS',           'jQuery',           /jquery[.\-]?[\d.]*(\.min)?\.js/i],
  ['JS',           'GSAP',             /\bgsap\b/i],
  ['JS',           'Swiper',           /swiper/i],
  ['JS',           'Slick',            /slick[.\-](min\.)?js|slick-carousel/i],
  ['JS',           'Lottie',           /lottie/i],
  ['JS',           'Alpine',           /alpinejs/i],
  ['JS',           'React',            /react-dom/i],
  ['JS',           'Vue',              /vue(\.runtime)?(\.min)?\.js/i],
  ['Chat',         'Intercom',         /intercom/i],
  ['Chat',         'Tawk',             /tawk\.to/i],
  ['Chat',         'Crisp',            /crisp\.chat/i],
  ['Chat',         'HubSpot',          /js\.hs-scripts\.com|hs-analytics/i],
  ['Chat',         'Drift',            /js\.driftt\.com/i],
  ['Marketing',    'Mailchimp',        /mailchimp|list-manage\.com/i],
  ['Marketing',    'ActiveCampaign',   /activehosted|activecampaign/i],
  ['Marketing',    'Klaviyo',          /klaviyo/i],
  ['Marketing',    'Campaign Monitor', /createsend/i],
  ['Booking',      'Calendly',         /calendly/i],
  ['Reviews',      'Trustindex',       /trustindex/i],
  ['Reviews',      'Trustpilot',       /trustpilot/i],
  ['Maps',         'Google Maps',      /maps\.google(apis)?\.com/i],
  ['Maps',         'Mapbox',           /mapbox/i],
  ['Video',        'Vimeo',            /player\.vimeo\.com/i],
  ['Video',        'YouTube',          /youtube(-nocookie)?\.com\/embed|youtu\.be/i],
  ['Video',        'Wistia',           /wistia/i],
  ['Media',        'Cloudinary',       /cloudinary/i],
  ['Translation',  'WPML',             /wpml|sitepress/i],
  ['Translation',  'Polylang',         /polylang/i]
];

/* Hosting and CDN only ever show up in headers, never in the markup. */
const HOST_SIGNS = [
  ['Hosting', 'WP Engine',  h => !!h['x-wpe-backend'] || /wpengine/i.test(h['server'] || h['x-powered-by'] || '')],
  ['Hosting', 'Kinsta',     h => !!h['x-kinsta-cache']],
  ['Hosting', 'Pantheon',   h => !!h['x-pantheon-styx-hostname']],
  ['Hosting', 'SiteGround', h => !!h['x-proxy-cache'] && /siteground/i.test(h['server'] || '')],
  ['Hosting', 'Flywheel',   h => /flywheel/i.test(h['server'] || '')],
  ['CDN',     'Cloudflare', h => !!h['cf-ray']],
  ['CDN',     'Fastly',     h => /fastly/i.test(h['x-served-by'] || h['via'] || '')],
  ['CDN',     'BunnyCDN',   h => /bunnycdn/i.test(h['server'] || h['cdn-cache'] || '')]
];

const STACK_ORDER = ['CMS', 'Theme', 'Page builder', 'Ecommerce', 'Forms', 'SEO',
  'Cache', 'Security', 'Consent', 'Analytics', 'Marketing', 'Chat', 'Booking',
  'Reviews', 'Maps', 'Video', 'Media', 'Fonts', 'JS', 'Translation', 'Hosting', 'CDN'];

/* Ordered spine of the Site block. Anything not listed lands at the end. */
const LABEL = {
  wordpress: 'WordPress', php: 'PHP', theme: 'Theme', plugins: 'Plugins',
  cache: 'Cache', server: 'Host', cdn: 'CDN', tls: 'HTTPS',
  headers: 'Security headers', users: 'User enumeration',
  restapi: 'REST API', robots: 'robots.txt', sitemap: 'sitemap.xml',
  llms: 'llms.txt', tags: 'Tracking', types: 'Content types',
  db: 'Database', software: 'Server', memory: 'Memory limit', upload: 'Max upload',
  objcache: 'Object cache', cron: 'WP-Cron', debugflags: 'Debug constants',
  posts: 'Posts', pages: 'Pages', media: 'Media', major: 'Key plugins',
  themes: 'Themes', twofa: 'Two-factor auth',
  schema: 'Schema', title: 'Meta', content: 'Content', lastpost: 'Last post'
};

/* Where "Open wp-admin" should actually land. Sending everything to /wp-admin/
   and making you navigate is a wasted click on work you do every day. */
const ADMIN = {
  wordpress: '/wp-admin/update-core.php',
  plugins:   '/wp-admin/plugins.php',
  theme:     '/wp-admin/themes.php',
  php:       '/wp-admin/site-health.php?tab=debug',
  users:     '/wp-admin/users.php',
  tags:      '/wp-admin/admin.php?page=gtm',
  title:     '/wp-admin/edit.php?post_type=page',
  schema:    '/wp-admin/admin.php?page=wpseo_dashboard',
  sitemap:   '/wp-admin/options-reading.php'
};

const ORDER = [
  'wordpress', 'php', 'theme', 'plugins', 'cache', 'security', 'seo', 'forms',
  'server', 'cdn', 'tls', 'db', 'software', 'memory', 'upload', 'objcache', 'cron', 'debugflags',
  'headers', 'users', 'users2', 'spam', 'restapi', 'twofa', 'themes', 'major',
  'posts', 'pages', 'media',
  'robots', 'sitemap', 'llms', 'spf', 'dmarc', 'tags', 'schema', 'title',
  'content', 'types', 'lastpost', 'fetchblock'
];

/* ------------------------------------------------------------------- state */

let ctx = null;
let runToken = 0;

const $ = (s) => document.querySelector(s);
const el = {
  app: $('#app'), form: $('#form'), url: $('#url'), results: $('#results'),
  issues: $('#issues'), site: $('#site'), count: $('#issue-count'),
  foot: $('#foot'), needs: $('#needs-login'), copy: $('#copy'),
  rerun: $('#rerun'), recent: $('#recent'),
  settings: $('#settings'), settingsToggle: $('#settings-toggle'), proxy: $('#proxy'),
  stack: $('#stack'), drop: $('#drop'), toast: $('#toast'), v2Link: $('#v2-link'),
  types: $('#types'), pTypes: $('#p-types'), typesCount: $('#types-count'),
  ask: $('#ask'), askWhy: $('#ask-why'),
  summary: $('#summary'), plugins: $('#plugins'), pluginCount: $('#plugin-count'),
  loader: $('#loader'),
  pPlugins: $('#p-plugins'), pStack: $('#p-stack'), pIssues: $('#p-issues'),
  siteCount: $('#site-count'), stackCount: $('#stack-count'),
  loaderText: $('#loader-text')
};

/* -------------------------------------------------------------- small util */

const enc = encodeURIComponent;
const clean = (s) => String(s == null ? '' : s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
  .replace(/&amp;/g, '&').replace(/&#8211;/g, '-').trim();

function vcmp(a, b) {
  const pa = String(a).split(/[.\-+_]/), pb = String(b).split(/[.\-+_]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = parseInt(pa[i], 10) || 0, y = parseInt(pb[i], 10) || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
const major = (v) => String(v).split('.')[0];
const minor = (v) => String(v).split('.').slice(0, 2).join('.');

/* An asset's ?ver= is very often a cache-buster, not a version. WP Rocket writes
   epoch timestamps, the block editor writes build hashes. Reject those outright,
   otherwise we report "version 1783907673" and lose all credibility. */
function cleanVer(v) {
  const s = String(v || '');
  if (/^\d{9,}$/.test(s)) return '';          // epoch timestamp
  if (/^[0-9a-f]{12,}$/i.test(s)) return '';  // build hash
  if (!/^\d+\.\d+/.test(s)) return '';        // needs at least x.y to be a version
  return s;
}

/* link-whisper-premium and link-whisper are the same plugin to us. */
const normSlug = (s) => String(s).toLowerCase().replace(/-(premium|pro)$/, '');

function monthsSince(dateStr) {
  const t = Date.parse(String(dateStr).replace(/(\d)(am|pm)/i, '$1 $2'));
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 2629800000);
}

function withTimeout(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function getJSON(url, ms = 15000) {
  const r = await fetch(url, { signal: withTimeout(ms) });
  const body = await r.json();
  return { ok: r.ok, status: r.status, body, headers: r.headers };
}

/* Proxy contract: GET {proxy}?url=<enc> -> {status, finalUrl, headers, body} */
async function viaProxy(target, ms = 20000) {
  if (!ctx.proxy) return null;
  try {
    const r = await fetch(ctx.proxy + (ctx.proxy.includes('?') ? '&' : '?') + 'url=' + enc(target),
      { signal: withTimeout(ms) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/* ---------------------------------------------------------- saved scans */

/* A reload should not throw away a minute of API calls. State is kept per host
   in this browser only, never uploaded, and never auto-refreshed: a stale
   number you did not ask for is worse than an obviously old one. */

const STORE = 'wp-pulse-scans';
const ADMIN_STORE = 'wp-pulse-admin';
const KEEP = 10;

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
}

function saveState() {
  if (!ctx || !ctx.host) return;
  /* Nothing is saved until every check has settled, so a half-run cannot be
     restored and mistaken for a finished one. */
  if ([...rows.values()].some(r => r.state === 'pending')) return;
  try {
    const all = readStore();
    all[ctx.host] = {
      at: new Date().toISOString(),
      rows: [...rows.values()].map(r => ({
        id: r.id, subject: r.subject, state: r.state, value: r.value,
        action: r.action, detail: (r.detail || '').slice(0, 600),
        inSite: r.inSite, inIssues: r.inIssues
      })),
      ctx: {
        host: ctx.host, origin: ctx.origin, proxy: ctx.proxy,
        headers: ctx.headers || {}, timing: ctx.timing || {},
        plugins: ctx.plugins || [], pluginTotal: ctx.pluginTotal,
        pluginActive: ctx.pluginActive, fromAdmin: !!ctx.fromAdmin,
        coreVersion: ctx.coreVersion, coreLatest: ctx.coreLatest, core: ctx.core,
        theme: ctx.theme, namespaces: ctx.namespaces, htmlBlocked: ctx.htmlBlocked,
        types: ctx.types
      }
    };
    /* Oldest out first, so the store cannot grow without bound. */
    const keys = Object.keys(all).sort((a, b) => (all[b].at || '').localeCompare(all[a].at || ''));
    const trimmed = {};
    keys.slice(0, KEEP).forEach(k => { trimmed[k] = all[k]; });
    localStorage.setItem(STORE, JSON.stringify(trimmed));
    if (el.recent) drawRecent();
  } catch { /* quota or private mode: not worth interrupting the scan over */ }
}

function restoreState(host) {
  const st = readStore()[host];
  if (!st || !st.rows || !st.ctx) return false;

  rows.clear();
  st.rows.forEach(r => rows.set(r.id, r));
  ctx = st.ctx;
  ctx.html = '';               // never persisted, too large and not needed
  ctx.restoredAt = st.at;
  const kept = loadAdmin(host);
  if (kept) { ctx.admin = kept.data; ctx.adminAt = kept.at; }

  el.app.classList.remove('start');
  el.results.hidden = false;
  el.rerun.hidden = false;
  document.title = host + ' — WP Pulse';
  if (el.v2Link) el.v2Link.href = 'v2.html?s=' + enc(host);
  paint();
  return true;
}

/* The raw bookmarklet payload, kept per host. Storing this rather than only the
   derived rows means a reload, a view switch or a fresh re-scan all re-apply it
   automatically. You paste once per site and only again to replace it. */
function saveAdmin(data) {
  try {
    const all = JSON.parse(localStorage.getItem(ADMIN_STORE) || '{}');
    all[ctx.host] = { at: new Date().toISOString(), data };
    const keys = Object.keys(all).sort((a, b) => (all[b].at || '').localeCompare(all[a].at || ''));
    const trim = {};
    keys.slice(0, KEEP).forEach(k => { trim[k] = all[k]; });
    localStorage.setItem(ADMIN_STORE, JSON.stringify(trim));
  } catch {}
}

function loadAdmin(host) {
  try {
    const e = JSON.parse(localStorage.getItem(ADMIN_STORE) || '{}')[host];
    return e ? e : null;
  } catch { return null; }
}

function clearAdmin(host) {
  try {
    if (!host) { localStorage.removeItem(ADMIN_STORE); return; }
    const all = JSON.parse(localStorage.getItem(ADMIN_STORE) || '{}');
    delete all[host];
    localStorage.setItem(ADMIN_STORE, JSON.stringify(all));
  } catch {}
}

function clearState(host) {
  try {
    if (!host) { localStorage.removeItem(STORE); clearAdmin(); return; }
    const all = readStore();
    delete all[host];
    localStorage.setItem(STORE, JSON.stringify(all));
    clearAdmin(host);
  } catch {}
}

/* A row with nothing in it is not worth a line. Judged on state, never on the
   text: "Usernames public: blocked" is a real finding, "Theme: blocked" is an
   absence, and only the state tells them apart. */
const noFact = (r) => !r || r.state === 'pending' || r.state === 'hollow'
  || /^(\?|\u2014|-|)$/.test(String(r.value == null ? '' : r.value).trim());

/* ------------------------------------------------------------------ rows */

const rows = new Map();

function addRow(id, subject) {
  if (rows.has(id)) return rows.get(id);
  const r = { id, subject, state: 'pending', value: '', action: '', detail: '', hits: [] };
  rows.set(id, r);
  paint();
  return r;
}

function setRow(id, patch) {
  const r = rows.get(id) || addRow(id, id);
  Object.assign(r, patch);
  paint();
  return r;
}

/* An issue is anything actionable. Facts with nothing to do stay in Site only. */
const isIssue = (r) => r.inIssues !== false && !noFact(r)
  && (r.state === 'red' || r.state === 'amber') && r.action;
const RANK = { red: 0, amber: 1, hollow: 2, ok: 3, pending: 4 };
const DOT  = { red: '●', amber: '●', ok: '●', hollow: '○', pending: '○' };

/* setTimeout, not requestAnimationFrame: rAF is suspended in background tabs,
   so a scan started and left alone would never draw anything. */
let paintQueued = false;
function paint() {
  if (paintQueued) return;
  paintQueued = true;
  setTimeout(() => { paintQueued = false; render(); }, 16);
}

function rowNode(r, mode) {
  const n = document.createElement('div');
  n.className = 'row sev-' + r.state
    + (r.state === 'pending' ? ' pending' : '')
    + (r.detail ? ' clickable' : '');

  const dot = document.createElement('span');
  dot.className = 'dot ' + r.state;
  dot.textContent = DOT[r.state] || '';

  const sub = document.createElement('span');
  sub.className = 'subject';
  sub.textContent = r.subject;

  const val = document.createElement('span');
  val.className = 'value';
  val.textContent = r.state === 'pending' ? '' : r.value;

  /* In the Site block, show the action on anything not already fine, even rows
     folded out of Issues. A row that says "blocked" with no way forward is a
     dead end. */
  const text = mode === 'issue' ? r.action
    : (r.state !== 'ok' && r.state !== 'pending' ? r.action : '');
  let act;

  if (text === 'Open wp-admin' && ctx) {
    /* A real link straight to the screen that answers this row. */
    act = document.createElement('a');
    act.href = ctx.origin + (ADMIN[r.id]
      || (/^plugins?:|^pl:/.test(r.id) ? ADMIN.plugins : '/wp-admin/'));
    act.target = '_blank';
    act.rel = 'noopener noreferrer';
    act.addEventListener('click', (e) => e.stopPropagation());   // do not toggle the detail
  } else if (text === 'Copy for Claude') {
    act = document.createElement('button');
    act.type = 'button';
    act.addEventListener('click', (e) => { e.stopPropagation(); el.copy.click(); });
  } else {
    act = document.createElement('span');
  }
  act.className = 'action';
  act.textContent = text;

  n.append(dot, sub, val, act);

  if (r.detail) {
    n.addEventListener('click', () => {
      const open = n.querySelector('.detail');
      if (open) { open.remove(); return; }
      const d = document.createElement('div');
      d.className = 'detail';
      d.textContent = r.detail;
      n.append(d);
    });
  }
  return n;
}

function render() {
  const all = [...rows.values()];

  const issues = all.filter(isIssue).sort((a, b) =>
    (RANK[a.state] - RANK[b.state]) || a.subject.localeCompare(b.subject));

  el.issues.replaceChildren();
  if (issues.length) {
    issues.forEach(r => el.issues.append(rowNode(r, 'issue')));
  } else if (all.every(r => r.state !== 'pending')) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Nothing to fix.';
    el.issues.append(p);
  }
  el.count.textContent = issues.length || '';
  el.count.className = 'count'
    + (issues.some(r => r.state === 'red') ? ' has-red'
      : issues.some(r => r.state === 'amber') ? ' has-amber' : '');

  const facts = all.filter(r => r.inSite !== false && !noFact(r)).sort((a, b) => {
    const ia = ORDER.indexOf(a.id), ib = ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  el.site.replaceChildren();
  facts.forEach(r => el.site.append(rowNode(r, 'site')));
  if (el.siteCount) el.siteCount.textContent = facts.length;

  renderStack();
  renderTypes();
  renderPlugins();
  renderSummary();

  const hollow = all.filter(r => r.state === 'hollow').length;
  /* Say what to do, not just what is missing. Pulse cannot read a logged-in
     session itself, so the workflow is: log in, then let Claude read the tab. */
  const age = ctx && ctx.restoredAt
    ? 'Saved scan from ' + String(ctx.restoredAt).replace('T', ' ').slice(0, 16) + '. Press r to re-run. ' : '';
  el.needs.textContent = age + (ctx && ctx.fromAdmin
    ? 'Includes wp-admin data.' : 'Public scan only.');
  if (el.drop) el.drop.hidden = !!(ctx && ctx.fromAdmin);
}

/* --------------------------------------------------------------- the run */

async function run(input) {
  const token = ++runToken;
  rows.clear();
  el.app.classList.remove('start');
  el.results.hidden = false;
  el.rerun.hidden = false;
  el.settings.hidden = true;

  let host;
  try {
    host = new URL(/^https?:\/\//.test(input) ? input : 'https://' + input).hostname;
  } catch { return fail('Bad URL.'); }

  ctx = { host, origin: 'https://' + host, proxy: el.proxy.value.trim(), html: '', headers: {} };
  ctx.restoredAt = null;
  history.replaceState(null, '', '?s=' + enc(host));
  if (el.v2Link) el.v2Link.href = 'v2.html?s=' + enc(host);
  remember(host);
  document.title = host + ' — WP Pulse';

  /* Placeholders first, so the page shows the work being done. */
  ['wordpress', 'plugins', 'users'].forEach(id => addRow(id, LABEL[id]));
  if (ctx.proxy) ['php', 'theme', 'tags', 'robots', 'sitemap', 'llms', 'headers']
    .forEach(id => addRow(id, LABEL[id]));

  /* 1. Is it WordPress? Everything downstream depends on this. */
  let root = null;
  try {
    const r = await getJSON(ctx.origin + '/wp-json/', 15000);
    if (r.ok && r.body && (r.body.namespaces || r.body.routes)) root = r.body;
  } catch { /* falls through to the proxy attempt */ }

  if (!root && ctx.proxy) {
    const p = await viaProxy(ctx.origin + '/wp-json/');
    if (p && p.status === 200) { try { root = JSON.parse(p.body); } catch {} }
  }

  if (token !== runToken) return;

  if (!root) {
    const p = ctx.proxy ? await viaProxy(ctx.origin + '/') : null;
    const looksWP = p && /wp-content|wp-includes/.test(p.body || '');
    if (!looksWP) return fail(ctx.proxy
      ? 'Not a WordPress site, or it did not respond.'
      : 'No REST API response. Set a proxy URL, or the site is not WordPress.');
  }

  setRow('wordpress', { value: root && root.name ? clean(root.name) : ctx.host, state: 'ok' });

  /* 2. Everything that can run at once, runs at once. */
  await Promise.allSettled([
    /* coreVersion reads what fetchHTML found, so it must follow it. Run in
       parallel and it races, reporting "hidden" or a version at random. */
    fetchHTML().then(coreVersion),
    restChecks(root), counts(), postTypes(),
    /* robots.txt first: it names the sitemap, so sitemap() waits on it. */
    textFile('robots', '/robots.txt', 'robots.txt').then(sitemap),
    textFile('llms', '/llms.txt', 'llms.txt')
  ]);
  if (token !== runToken) return;

  /* 3. Plugins last: they depend on both the namespace list and the HTML. */
  await plugins(root, token);
  if (token !== runToken) return;

  /* Re-apply stored wp-admin data so a re-scan does not silently lose it. */
  const kept = loadAdmin(host);
  if (kept && kept.data) {
    ctx.adminAt = kept.at;
    await mergeAdmin(kept.data);
    if (token !== runToken) return;
  }

  paint();
  saveState();
}

function fail(msg) {
  rows.clear();
  setRow('error', { subject: msg, state: 'red', value: '', action: '', inSite: true });
  paint();
}

/* ------------------------------------------------------------- collectors */

async function fetchHTML() {
  if (!ctx.proxy) {
    ['php', 'theme', 'tags', 'headers', 'schema', 'title', 'cache', 'cdn', 'server', 'tls']
      .forEach(id => addRow(id, id[0].toUpperCase() + id.slice(1)));
    ['php', 'theme', 'tags', 'headers'].forEach(id =>
      setRow(id, { state: 'hollow', value: 'no proxy', action: 'Set proxy URL' }));
    ['schema', 'title', 'cache', 'cdn', 'server', 'tls'].forEach(id => rows.delete(id));
    return;
  }

  const t0 = (performance && performance.now) ? performance.now() : 0;
  const p = await viaProxy(ctx.origin + '/');
  /* Server-side round trip through our proxy. Not a browser load time, and
     labelled as such wherever it is shown. */
  ctx.timing = { proxyMs: Math.round(((performance && performance.now) ? performance.now() : 0) - t0) };

  /* Content-derived checks. If we did not get the HTML, none of these can be
     answered, and reporting them as failures would be inventing findings. */
  const CONTENT = ['theme', 'tags', 'title', 'schema'];

  if (!p) {
    ['php', 'headers', ...CONTENT].forEach(id => {
      addRow(id, LABEL[id] || id);
      setRow(id, { state: 'hollow', value: 'proxy failed', action: 'Check proxy' });
    });
    ctx.htmlBlocked = 'proxy failed';
    return;
  }

  /* A 403 or 503 still carries real headers, so header checks stay valid. */
  ctx.headers = p.headers || {};
  if (p.status !== 200) {
    ctx.html = '';
    ctx.htmlBlocked = 'HTTP ' + p.status;
    /* One row explains it. Repeating "HTTP 403" eight times explains it worse. */
    addRow('fetchblock', 'Page fetch');
    setRow('fetchblock', {
      state: 'hollow', value: 'HTTP ' + p.status + ', firewall blocked',
      action: 'Copy for Claude',
      detail: 'The homepage refused our request, so theme, plugin versions, tracking '
        + 'tags, schema and meta could not be read. Everything below came from headers, '
        + 'the REST API or DNS, which did respond.'
    });
    CONTENT.forEach(id => {
      addRow(id, LABEL[id] || id);
      setRow(id, { state: 'hollow', value: 'blocked', action: 'Open wp-admin', inIssues: false });
    });
  } else {
    ctx.html = p.body || '';
    ctx.timing.htmlBytes = ctx.html.length;
    /* Every external reference in the markup. An approximation of request count,
       not a measurement, so it is always labelled as one. */
    ctx.timing.assets = (ctx.html.match(/(?:src|href)=["'][^"']+\.(?:js|css|png|jpe?g|webp|svg|woff2?)/gi) || []).length;
  }

  const h = ctx.headers, html = ctx.html;

  /* PHP */
  const php = (h['x-powered-by'] || '').match(/PHP\/([\d.]+)/);
  if (php) {
    const v = php[1], eol = PHP_EOL[minor(v)];
    const dead = eol && Date.parse(eol) < Date.now();
    setRow('php', {
      state: dead ? 'red' : 'ok',
      value: v + (dead ? '  EOL ' + eol.slice(0, 7) : ''),
      action: dead ? 'Ask host for 8.3' : '',
      detail: eol ? 'Security support ends ' + eol : ''
    });
  } else {
    setRow('php', { state: 'hollow', value: 'hidden', action: 'Open wp-admin' });
  }

  /* Server, CDN, cache */
  addRow('server', 'Host');
  setRow('server', { state: 'ok', value: h['server'] || h['x-served-by'] || 'unknown' });
  if (h['cf-ray'] || /cloudflare/i.test(h['server'] || '')) {
    addRow('cdn', 'CDN'); setRow('cdn', { state: 'ok', value: 'Cloudflare' });
  }
  const cacheHdr = h['cf-cache-status'] || h['x-cache'] || h['x-litespeed-cache'] || h['x-wp-rocket'];
  if (cacheHdr) { addRow('cache', 'Cache'); setRow('cache', { state: 'ok', value: cacheHdr }); }

  /* Security headers: report the missing ones by name, not a score */
  const want = {
    'strict-transport-security': 'HSTS',
    'content-security-policy': 'CSP',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'frame-options',
    'referrer-policy': 'referrer-policy'
  };
  const missing = Object.keys(want).filter(k => !h[k]);
  /* HSTS is one line of config and genuinely matters. A missing CSP is worth
     knowing about but is not a monthly-maintenance action, so it stays green. */
  const bad = missing.includes('strict-transport-security') || missing.length >= 4;
  setRow('headers', {
    state: bad ? 'amber' : 'ok',
    value: missing.length ? (5 - missing.length) + '/5, no ' + missing.map(k => want[k]).join(', ')
                          : 'all 5 present',
    action: bad ? 'Add HSTS' : ''
  });

  /* TLS: the proxy followed redirects, so the final URL settles it.
     Valid even on a 403, so it sits above the guard. */
  addRow('tls', 'HTTPS');
  const https = String(p.finalUrl || '').startsWith('https://');
  setRow('tls', { state: https ? 'ok' : 'red', value: https ? 'enforced' : 'not enforced',
                  action: https ? '' : 'Force HTTPS' });

  if (ctx.htmlBlocked) return;   // nothing below here can be answered honestly

  /* Core version. Only from sources that genuinely carry core's own version.
     A loose "wp-includes/...?ver=" match happily grabs jquery.min.js?ver=3.7.1
     and reports WordPress 3.7.1, which then matches a decade of ancient CVEs.
     Precision matters more than coverage here. */
  for (const re of [
    /name=["']generator["'][^>]*content=["']WordPress\s+([\d.]+)/i,
    /wp-includes\/js\/wp-emoji-release\.min\.js\?[^"'>]*\bver=([\d.]+)/i,
    /wp-includes\/css\/dist\/block-library\/style(?:\.min)?\.css\?[^"'>]*\bver=([\d.]+)/i,
    /wp-includes\/blocks\/[^"'>]*\?[^"'>]*\bver=([\d.]+)/i
  ]) {
    const m = html.match(re);
    if (m) { ctx.coreVersion = m[1]; break; }
  }

  /* Theme */
  const theme = html.match(/\/wp-content\/themes\/([a-z0-9\-_]+)\//i);
  if (theme) {
    const slug = theme[1];
    const tv = html.match(new RegExp('/wp-content/themes/' + slug + '/[^"\'\\s]*?[?&]ver=([^&"\'\\s>]+)', 'i'));
    const ver = tv && tv[1] !== ctx.coreVersion ? cleanVer(tv[1]) : '';
    setRow('theme', { state: 'ok', value: slug + (ver ? '  ' + ver : '') });
    ctx.theme = { slug, ver };
  } else {
    setRow('theme', { state: 'hollow', value: 'not detected', action: 'Open wp-admin' });
  }

  /* Tags */
  const found = TAGS.filter(([, re]) => re.test(html)).map(([n]) => n);
  setRow('tags', { state: 'ok', value: found.length ? found.join(', ') : 'none detected' });

  /* Title, schema */
  const t = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
  const desc = /name=["']description["']/i.test(html);
  addRow('title', 'Meta');
  setRow('title', {
    state: t && desc ? 'ok' : 'amber',
    value: t ? clean(t[1]).slice(0, 60) : 'no title',
    action: !desc ? 'Add description' : (!t ? 'Add title' : '')
  });

  addRow('schema', 'Schema');
  const schema = /application\/ld\+json/i.test(html);
  setRow('schema', {
    state: schema ? 'ok' : 'amber',
    value: schema ? 'present' : 'none',
    action: schema ? '' : 'Add JSON-LD'
  });
}

async function coreVersion() {
  addRow('wordpress', 'WordPress');
  let latest = null;
  try {
    const r = await getJSON(WPORG_CORE, 12000);
    latest = r.body && r.body.offers && r.body.offers[0] && r.body.offers[0].current;
  } catch {}
  ctx.coreLatest = latest;

  const have = ctx.coreVersion;
  if (!have) {
    return setRow('wordpress', {
      state: latest ? 'hollow' : 'ok',
      value: latest ? 'version hidden, latest ' + latest : (ctx.host),
      action: latest ? 'Open wp-admin' : ''
    });
  }

  let vulns = [];
  try {
    const r = await getJSON(VULN_CORE + have + '/', 12000);
    vulns = (r.body && r.body.data && r.body.data.vulnerability) || [];
  } catch {}

  const behind = latest && vcmp(have, latest) < 0;
  const worst = worstOf(vulns);
  ctx.core = { have, target: behind ? latest : null };
  setRow('wordpress', {
    state: worst ? sevState(worst) : (behind ? 'amber' : 'ok'),
    value: have + (behind ? '  → ' + latest : '  latest'),
    action: worst ? 'Update core now' : (behind ? 'Update core' : ''),
    detail: vulns.length ? vulns.slice(0, 4).map(v => clean(v.name)).join('\n') : ''
  });
}

async function restChecks(root) {
  /* User enumeration is the single highest-value no-auth check */
  try {
    const r = await fetch(ctx.origin + '/wp-json/wp/v2/users', { signal: withTimeout(12000) });
    const b = await r.json();
    if (Array.isArray(b) && b.length) {
      setRow('users', {
        state: 'red', value: b.length + ' names public',
        action: 'Restrict endpoint',
        detail: b.map(u => (u.slug || '') + '  ' + (u.name || '')).join('\n')
      });
    } else {
      setRow('users', { state: 'ok', value: 'blocked' });
    }
  } catch {
    setRow('users', { state: 'ok', value: 'blocked' });
  }

  addRow('restapi', 'REST API');
  const ns = (root && root.namespaces) || [];
  setRow('restapi', { state: 'ok', value: ns.length + ' namespaces', detail: ns.join('\n') });
}

/* Every registered post type and how much is in it. This is the content model,
   which is the first thing you want on a site you did not build. */
async function postTypes() {
  const SKIP = new Set(['attachment', 'nav_menu_item', 'revision', 'custom_css',
    'customize_changeset', 'oembed_cache', 'user_request', 'wp_block', 'wp_template',
    'wp_template_part', 'wp_navigation', 'wp_global_styles', 'wp_font_family',
    'wp_font_face', 'patterns_ai_data', 'wp_recovery_mode']);
  const BUILTIN = new Set(['post', 'page']);

  let list = null;
  try {
    const r = await fetch(ctx.origin + '/wp-json/wp/v2/types', { signal: withTimeout(12000) });
    if (!r.ok) return;
    list = await r.json();
  } catch { return; }
  if (!list || typeof list !== 'object') return;

  const keys = Object.keys(list).filter(k => !SKIP.has(k) && list[k] && list[k].rest_base);
  if (!keys.length) return;

  const out = [];
  /* Four at a time: enough to be quick without hammering the client's site. */
  for (let i = 0; i < keys.length && i < 16; i += 4) {
    const batch = await Promise.all(keys.slice(i, i + 4).map(async (k) => {
      const t = list[k];
      const entry = { slug: k, name: clean(t.name) || k, builtin: BUILTIN.has(k), n: null };
      try {
        const rr = await fetch(ctx.origin + '/wp-json/wp/v2/' + t.rest_base + '?per_page=1',
          { signal: withTimeout(10000) });
        if (rr.ok) entry.n = parseInt(rr.headers.get('x-wp-total') || '0', 10);
      } catch {}
      return entry;
    }));
    out.push(...batch);
  }

  ctx.types = out.sort((a, b) => (b.n || 0) - (a.n || 0));

  const total = out.reduce((s, t) => s + (t.n || 0), 0);
  const custom = out.filter(t => !t.builtin).length;
  addRow('types', LABEL.types);
  setRow('types', {
    state: 'ok',
    value: out.length + ' types, ' + total + ' items'
      + (custom ? '  (' + custom + ' custom)' : ''),
    detail: out.map(t => (t.name + '  ').padEnd(26) + String(t.n == null ? '?' : t.n).padStart(6)
      + '   ' + t.slug + (t.builtin ? '' : '  custom')).join('\n')
  });
}

async function counts() {
  const grab = async (type) => {
    try {
      const r = await fetch(ctx.origin + '/wp-json/wp/v2/' + type + '?per_page=1',
        { signal: withTimeout(12000) });
      return { n: parseInt(r.headers.get('x-wp-total') || '0', 10), body: await r.json() };
    } catch { return null; }
  };
  const [posts, pages, media] = await Promise.all([grab('posts'), grab('pages'), grab('media')]);
  if (!posts && !pages) return;

  addRow('content', 'Content');
  setRow('content', {
    state: 'ok',
    value: [posts && posts.n + ' posts', pages && pages.n + ' pages', media && media.n + ' media']
      .filter(Boolean).join('  ')
  });

  const last = posts && Array.isArray(posts.body) && posts.body[0] && posts.body[0].date;
  if (last) {
    const m = monthsSince(last);
    addRow('lastpost', 'Last post');
    setRow('lastpost', {
      state: m >= 12 ? 'amber' : 'ok',
      value: String(last).slice(0, 10) + (m != null ? '  ' + m + 'mo' : ''),
      action: m >= 12 ? 'Publish something' : ''
    });
  }
}

async function textFile(id, path, label) {
  if (!ctx.proxy) return;
  addRow(id, label);
  const p = await viaProxy(ctx.origin + path, 15000);
  const ok = p && p.status === 200 && (p.body || '').trim().length > 0;
  if (id === 'robots' && ok) ctx.robots = p.body;

  /* 404 means genuinely absent. Anything else means we were stopped, and
     "missing" would be a lie. */
  if (!ok && p && p.status !== 404 && p.status !== 200) {
    return setRow(id, { state: 'hollow', value: 'blocked', action: 'Check manually', inIssues: false });
  }
  setRow(id, {
    state: ok ? 'ok' : 'amber',
    value: ok ? 'present' : 'missing',
    action: ok ? '' : (id === 'llms' ? 'Add for AI search' : 'Add file')
  });
}

async function sitemap() {
  if (!ctx.proxy) return;
  addRow('sitemap', 'sitemap.xml');

  /* Yoast, Rank Math and core all disagree on the filename, and robots.txt is
     the only place that reliably says which. Try the declared one first. */
  const declared = (ctx.robots || '').match(/^\s*sitemap:\s*(\S+)/im);
  const candidates = [
    declared && declared[1],
    ctx.origin + '/sitemap_index.xml',
    ctx.origin + '/sitemap.xml',
    ctx.origin + '/wp-sitemap.xml'
  ].filter(Boolean);

  let blocked = 0;
  for (const url of candidates) {
    const p = await viaProxy(url, 15000);
    if (p && p.status !== 200 && p.status !== 404) blocked = p.status;
    if (!p || p.status !== 200 || !/<(?:urlset|sitemapindex)/i.test(p.body || '')) continue;
    const isIndex = /<sitemapindex/i.test(p.body);
    const n = (p.body.match(/<loc>/g) || []).length;
    return setRow('sitemap', {
      state: 'ok',
      value: isIndex ? n + ' sitemaps' : n + ' URLs',
      detail: url
    });
  }
  setRow('sitemap', blocked
    ? { state: 'hollow', value: 'blocked', action: 'Check manually', inIssues: false }
    : { state: 'amber', value: 'missing', action: 'Add sitemap' });
}

/* ---------------------------------------------------------------- plugins */

function detectPlugins(root) {
  /* Keyed by normalised slug so REST namespaces and asset paths converge on one row. */
  const found = new Map();

  const get = (slug) => {
    const key = normSlug(slug);
    if (!found.has(key)) found.set(key, { slug, key, version: '', source: '', vers: [] });
    const e = found.get(key);
    /* Prefer the longer, more specific slug: link-whisper-premium over link-whisper. */
    if (slug.length > e.slug.length) e.slug = slug;
    return e;
  };

  /* 1. REST namespaces. Broad coverage, no versions. */
  ((root && root.namespaces) || []).forEach(ns => {
    const base = ns.split('/')[0];
    if (['wp', 'oembed', 'wp-site-health', 'wp-block-editor', 'wp-abilities', 'batch', 'mcp']
      .includes(base)) return;
    const mapped = NS_SLUG.hasOwnProperty(base) ? NS_SLUG[base] : base;
    const e = get(mapped || base);
    e.source = e.source || 'rest';
  });

  /* 2. Generator meta tags. Exact versions, straight from the plugin. */
  GENERATORS.forEach(([re, slug]) => {
    const m = ctx.html.match(re);
    if (!m) return;
    const e = get(slug);
    e.version = m[1];
    e.source = 'generator';
    e.confident = true;
    e.trusted = true;   // the plugin said so itself; assets only ever imply
  });

  /* 3. Asset paths. Broad, but ?ver= is the script's version as often as the
        plugin's, so anything from here is inferred and flagged as such. */
  const re = /\/wp-content\/plugins\/([a-z0-9][a-z0-9\-_]*)\/[^"'\s>)]*/gi;
  let m;
  while ((m = re.exec(ctx.html))) {
    const e = get(m[1].toLowerCase());
    e.source = e.source || 'asset';
    const raw = (m[0].match(/[?&]ver=([^&"'\s>]+)/) || [])[1];
    const v = cleanVer(raw);
    if (v && v !== ctx.coreVersion) e.vers.push(v);
  }

  /* Most frequent plausible version wins. A version seen on two or more of a
     plugin's assets is far more likely to be the plugin's own. */
  found.forEach(e => {
    if (e.confident || !e.vers.length) return;
    const tally = new Map();
    e.vers.forEach(v => tally.set(v, (tally.get(v) || 0) + 1));
    const [best, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    e.version = best;
    e.confident = n >= 2;
  });

  return [...found.values()];
}

async function plugins(root, token) {
  const list = detectPlugins(root);
  if (!list.length) {
    return setRow('plugins', { state: 'hollow', value: 'none detected', action: 'Open wp-admin' });
  }
  return inspectAll(list, token);
}

/* Shared by the public scan and the bookmarklet. The bookmarklet feeds it real
   versions instead of inferred ones, so the same criticality logic runs on
   solid data and every finding turns from "verify" into "act". */
async function inspectAll(list, token) {
  setRow('plugins', { state: 'pending', value: 'checking ' + list.length + '…' });

  const results = [];
  const size = 5;
  for (let i = 0; i < list.length; i += size) {
    if (token !== runToken) return;
    const batch = await Promise.all(list.slice(i, i + size).map(inspectPlugin));
    results.push(...batch);
    setRow('plugins', { value: 'checking ' + results.length + '/' + list.length + '…' });
  }

  ctx.plugins = results;

  const vulnerable = results.filter(p => p.worst && p.confident);
  const suspect = results.filter(p => p.worst && !p.confident);
  const outdated = results.filter(p => p.behind && !p.worst);
  const unknown = results.filter(p => p.state === 'hollow');

  const bits = [results.length + ' found'];
  if (vulnerable.length) bits.push(vulnerable.length + ' vulnerable');
  if (suspect.length) bits.push(suspect.length + ' to verify');
  if (outdated.length) bits.push(outdated.length + ' outdated');
  if (unknown.length) bits.push(unknown.length + ' unknown version');

  /* When we could not read a single version, "4 found, 4 unknown version" says
     nothing. The names we do have are worth more than the count. */
  const names = results.map(p => p.name || p.slug).join(', ');
  const allUnknown = unknown.length === results.length;

  setRow('plugins', {
    inSite: false, inIssues: false,
    state: vulnerable.length ? 'red'
      : (suspect.length || outdated.length) ? 'amber'
      : unknown.length ? 'hollow' : 'ok',
    value: allUnknown ? names + '  (no versions)' : bits.join(', '),
    action: vulnerable.length ? 'Update now'
      : outdated.length ? 'Update'
      : (suspect.length || unknown.length) ? 'Open wp-admin' : '',
    detail: 'slug'.padEnd(30) + 'have'.padEnd(14) + 'latest'.padEnd(14) + 'note\n'
      + results.map(p => [
          p.slug.slice(0, 29).padEnd(30),
          (p.version || '?').padEnd(14),
          (p.latest || '?').padEnd(14),
          p.note
        ].join('')).join('\n')
  });

  /* Only plugins with a real finding get their own row. Everything we simply
     cannot see from outside stays folded into the Plugins summary above, which
     already says "open wp-admin" once. Eleven rows saying the same thing is
     noise, and noise is what makes people stop reading. */
  /* Plugins are never rows in Issues. One place for plugins: the Plugins table.
     Vulnerable ones are flagged there with their CVSS instead. */
  [...rows.keys()].filter(k => k.startsWith('plugin:')).forEach(k => rows.delete(k));
}

async function inspectPlugin(p) {
  const out = Object.assign({ latest: '', note: '', state: '', action: '', evidence: '', detail: '' }, p);
  out.name = p.name || '';

  if (PREMIUM.has(p.key) || PREMIUM.has(p.slug)) {
    /* No wordpress.org listing, so there is no "latest" to compare against.
       An inferred version here is worse than useless: reporting Gravity Forms
       as 3.0.2 when that is a bundled script's version is a wrong fact.
       Only show a version we are confident in. */
    /* Only a generator tag is trustworthy here. Gravity Forms ships scripts
       tagged ver=3.0.2 while the plugin itself is on 2.9.x, and with no
       wordpress.org listing there is nothing to sanity-check it against. */
    const known = p.trusted ? p.version : '';
    if (known) {
      let vulns = [];
      try {
        const r = await getJSON(VULN_PLUGIN + enc(p.key) + '/', 12000);
        vulns = (r.body && r.body.data && r.body.data.vulnerability) || [];
      } catch {}
      const worst = worstOf(matchVulns(vulns, known));
      if (worst) {
        out.worst = worst; out.confident = true;
        out.state = sevState(worst);
        out.evidence = known + '  CVSS ' + worst.score;
        out.action = 'Update now';
        out.note = 'premium, vulnerable';
        out.detail = clean(worst.name);
        return out;
      }
      if (p.adminUpdate) {
        out.state = 'amber'; out.evidence = known + ' → ' + p.adminUpdate;
        out.action = 'Update'; out.note = 'premium, update pending';
        return out;
      }
      out.state = 'ok'; out.evidence = known; out.note = 'premium, no known CVE';
      return out;
    }
    out.version = '';
    out.note = 'premium, no public version data';
    out.state = 'hollow';
    out.evidence = 'version unknown';
    out.action = 'Open wp-admin';
    return out;
  }

  let info = null;
  try {
    const r = await getJSON(WPORG_PLUGIN + enc(p.key || p.slug), 12000);
    if (r.body && !r.body.error && r.body.version) info = r.body;
  } catch {}

  if (!info) {
    out.note = 'not found on wordpress.org';
    out.state = p.version ? 'ok' : 'hollow';
    out.evidence = p.version || 'version unknown';
    out.action = p.version ? '' : 'Open wp-admin';
    return out;
  }

  /* Strip a trailing tagline, but only on a spaced dash. A bare hyphen is
     part of the name: "Akismet Anti-spam" must not become "Akismet Anti". */
  out.name = p.name || clean(info.name).replace(/\s+[–—-]\s+.*$/, '').replace(/:\s.*$/, '');
  out.latest = info.version;

  /* Sanity check: nobody is running a version newer than the one that exists.
     If the asset said so, the asset was talking about something else. */
  if (p.version && !p.trusted && vcmp(p.version, info.version) > 0) {
    p = Object.assign({}, p, { version: '', confident: false });
    out.version = '';
    out.confident = false;
  }

  out.installs = info.active_installs;
  out.lastUpdated = info.last_updated;
  const age = monthsSince(info.last_updated);

  let vulns = [];
  try {
    const r = await getJSON(VULN_PLUGIN + enc(p.key || p.slug) + '/', 12000);
    vulns = (r.body && r.body.data && r.body.data.vulnerability) || [];
  } catch {}

  /* Without an installed version we cannot say this site is affected. Say so. */
  if (!p.version) {
    out.note = 'latest ' + info.version + ', version unknown';
    out.state = 'hollow';
    out.evidence = 'version unknown, latest ' + info.version;
    out.action = 'Open wp-admin';
    out.detail = vulns.length ? vulns.length + ' known CVEs for this plugin overall' : '';
    return out;
  }

  const hits = matchVulns(vulns, p.version);
  const worst = worstOf(hits);
  out.worst = worst;
  out.behind = vcmp(p.version, info.version) < 0;

  if (worst) {
    /* An inferred version is not proof. Flag it for verification rather than
       raising a red alarm we cannot stand behind. False positives cost more
       than they save. */
    out.state = p.confident ? sevState(worst) : 'amber';
    out.evidence = p.version + ' → ' + info.version + (p.confident ? '' : '  (inferred)');
    out.action = p.confident ? 'Update now' : 'Verify version';
    out.note = 'CVSS ' + worst.score + ' ' + worst.severity + (p.confident ? '' : ', inferred');
    out.detail = (p.confident ? '' : 'Version read from an asset URL, not confirmed.\n')
      + hits.slice(0, 5).map(h => clean(h.name)).join('\n');
    return out;
  }

  if (info.closed) {
    out.state = 'red'; out.evidence = 'removed from repo'; out.action = 'Replace plugin';
    out.note = 'closed'; return out;
  }

  if (out.behind) {
    const gap = major(info.version) !== major(p.version) ? 'major'
      : (minor(info.version) !== minor(p.version) ? 'minor' : 'patch');
    out.state = gap === 'patch' ? 'ok' : 'amber';
    out.evidence = p.version + ' → ' + info.version + (p.confident ? '' : '  (inferred)');
    out.action = out.state === 'ok' ? '' : 'Update';
    out.note = gap + ' behind' + (p.confident ? '' : ', inferred');
    return out;
  }

  if (age != null && age >= 24) {
    out.state = 'amber'; out.evidence = 'no update in ' + age + ' months';
    out.action = 'Review, likely abandoned'; out.note = 'stale'; return out;
  }

  /* wp-admin is the authority on whether an update is waiting. It knows about
     premium plugins and private update servers that wordpress.org cannot see. */
  if (p.adminUpdate) {
    out.state = 'amber';
    out.evidence = p.version + ' → ' + p.adminUpdate;
    out.action = 'Update';
    out.note = 'update pending';
    return out;
  }

  out.state = 'ok';
  out.evidence = p.version;
  out.note = 'current';
  return out;
}

function matchVulns(vulns, version) {
  return vulns.filter(v => {
    const op = v.operator || {};
    if (op.max_version) {
      const c = vcmp(version, op.max_version);
      if (op.max_operator === 'lt' && !(c < 0)) return false;
      if (op.max_operator === 'le' && !(c <= 0)) return false;
      if (op.max_operator === 'eq' && c !== 0) return false;
    }
    if (op.min_version) {
      const c = vcmp(version, op.min_version);
      if (op.min_operator === 'gt' && !(c > 0)) return false;
      if (op.min_operator === 'ge' && !(c >= 0)) return false;
    }
    return !!(op.max_version || op.min_version);
  });
}

function worstOf(hits) {
  let best = null;
  (hits || []).forEach(h => {
    const c = (h.impact && (h.impact.cvss3 || h.impact.cvss)) || {};
    const score = parseFloat(c.score) || 0;
    const unfixed = h.operator && String(h.operator.unfixed) === '1';
    if (!best || score > best.score) best = { score, severity: c.severity || '', unfixed, name: h.name };
  });
  return best;
}

const sevState = (w) => (w.unfixed || w.score >= 7) ? 'red' : 'amber';

/* ------------------------------------------------------------ copy output */
/* A plain-text summary, ready to paste into whatever tracker or email you use. */

function reportBlock() {
  const all = [...rows.values()];
  const line = (r) => {
    const mark = r.state === 'red' ? '❌' : r.state === 'amber' ? '⚠️'
      : r.state === 'hollow' ? '❓' : '✅';
    return mark + ' ' + r.subject + ' — ' + r.value + (r.action ? ' — ' + r.action : '');
  };
  const issues = all.filter(isIssue).sort((a, b) => RANK[a.state] - RANK[b.state]);
  const facts = all.filter(r => r.inSite !== false && !isIssue(r));

  /* The proxy runs from a datacentre IP that some firewalls refuse outright.
     A browser tab is never refused, and Claude reading that tab sees the page
     after JavaScript has run, so it catches tags a raw fetch would miss. */
  const readPage = ctx.htmlBlocked ? [
    '',
    'BLOCKED — the site refused our server-side fetch (' + ctx.htmlBlocked + ').',
    'Open ' + ctx.origin + '/ in a tab, read the page source, and fill in:',
    '  generator meta        WordPress core version, WP Rocket, Yoast, Elementor',
    '  /wp-content/themes/   theme slug and its ?ver=',
    '  /wp-content/plugins/  every plugin slug and its ?ver=',
    '  tracking              GTM, GA4, Meta Pixel, CallRail, Hotjar, Clarity',
    '  ld+json               schema types present',
    '  head                  title, meta description, canonical',
    'Ignore any ?ver= that is a 9+ digit timestamp or a long hex hash. Those are',
    'cache-busters, not versions.'
  ].join('\n') : '';

  const hollow = all.filter(r => r.state === 'hollow');
  const ask = hollow.length ? [
    '',
    'STILL NEEDED — read these from my open wp-admin tabs and complete the list:',
    '  /wp-admin/update-core.php   core + plugin + theme updates',
    '  /wp-admin/plugins.php       every plugin, version, active state',
    '  /wp-admin/users.php         admin accounts and roles',
    '  /wp-admin/edit-comments.php?comment_status=spam',
    '  /wp-admin/site-health.php   PHP, DB, critical issues',
    '  security plugin screen      last scan, notifications',
    '  backup plugin screen        last backup, destinations',
    '',
    'Rank plugin updates by criticality: unpatched CVE > patched CVE > removed from repo',
    '> major behind > 12mo stale > minor > patch. Do not click Update.'
  ].join('\n') : '';

  return [
    'WP Pulse — ' + ctx.host,
    new Date().toISOString().slice(0, 10),
    '',
    'ISSUES (' + issues.length + ')',
    issues.length ? issues.map(line).join('\n') : 'None.',
    '',
    'SITE',
    facts.map(line).join('\n'),
    readPage,
    ask
  ].join('\n');
}

/* ------------------------------------------------------------------ stack */

/* Built from what we already collected. No extra requests. Versions come from
   the plugin pass where we have them, so this sharpens once the bookmarklet
   has run without needing to detect anything twice. */
function buildStack() {
  const found = new Map();
  const add = (cat, name) => {
    if (!found.has(cat)) found.set(cat, new Set());
    found.get(cat).add(name);
  };

  add('CMS', 'WordPress' + (ctx.coreVersion ? ' ' + ctx.coreVersion : ''));
  if (ctx.theme && ctx.theme.slug) {
    add('Theme', ctx.theme.slug + (ctx.theme.ver ? ' ' + ctx.theme.ver : ''));
  }

  /* Version lookup by plugin name, so "Elementor" becomes "Elementor 3.2.1". */
  const versions = new Map();
  (ctx.plugins || []).forEach(p => {
    if (p.version) versions.set((p.name || p.slug).toLowerCase(), p.version);
  });
  const withVer = (name) => {
    const v = versions.get(name.toLowerCase());
    return v ? name + ' ' + v : name;
  };

  const hay = ctx.html + ' ' + (ctx.plugins || []).map(p => p.slug).join(' ')
    + ' ' + (ctx.namespaces || []).join(' ');

  STACK_SIGNS.forEach(([cat, name, re]) => { if (re.test(hay)) add(cat, withVer(name)); });
  HOST_SIGNS.forEach(([cat, name, test]) => {
    try { if (test(ctx.headers || {})) add(cat, name); } catch {}
  });

  TAGS.forEach(([name, re]) => { if (ctx.html && re.test(ctx.html)) add('Analytics', name); });

  return STACK_ORDER
    .filter(cat => found.has(cat))
    .map(cat => [cat, [...found.get(cat)].join(', ')]);
}

/* --------------------------------------------------------------- summary */

/* The four numbers you want before reading anything else. Facts, not a score. */
function renderSummary() {
  if (!ctx || !el.summary) return;

  const list = ctx.plugins || [];
  const needUpdate = list.filter(p => p.adminUpdate || p.behind || p.worst).length;
  const activeN = list.filter(p => p.active).length;
  const knowsActive = list.some(p => p.active !== undefined);

  const core = ctx.core || {};
  const phpRow = rows.get('php');
  const php = phpRow && phpRow.state !== 'pending' && phpRow.state !== 'hollow'
    ? String(phpRow.value).split(/\s{2,}/)[0] : '';
  const phpDead = phpRow && phpRow.state === 'red';

  const issues = [...rows.values()].filter(isIssue);
  const reds = issues.filter(r => r.state === 'red').length;

  /* Only what we can actually fill. Four cards reading "needs wp-admin" say the
     same thing four times and crowd out the ones that have an answer. */
  const stats = [];
  if (core.have) stats.push(['WordPress', core.have,
    core.target ? 'update to ' + core.target : 'latest', core.target ? 'amber' : 'ok']);
  if (php) stats.push(['PHP', php, phpDead ? 'end of life' : 'supported', phpDead ? 'red' : 'ok']);
  if (ctx.fromAdmin) {
    stats.push(['Plugins', ctx.pluginTotal || list.length,
      (ctx.pluginActive != null ? ctx.pluginActive : activeN) + ' active', '']);
    stats.push(['Updates', needUpdate, needUpdate ? 'pending' : 'none',
      needUpdate ? 'amber' : 'ok']);
  }
  stats.push(['Issues', issues.length, reds ? reds + ' critical' : 'none critical',
    reds ? 'red' : (issues.length ? 'amber' : 'ok')]);

  if (el.ask) el.ask.hidden = !!ctx.fromAdmin;
  if (el.askWhy) {
    el.askWhy.textContent = ctx.htmlBlocked
      ? 'This site\u2019s firewall also blocked our reader, so almost everything needs the bookmark.'
      : '';
  }

  el.summary.replaceChildren();
  stats.forEach(([k, v, sub, cls]) => {
    const d = document.createElement('div');
    d.className = 'stat ' + cls;
    d.innerHTML = '';
    const a = document.createElement('span'); a.className = 'k'; a.textContent = k;
    const b = document.createElement('span'); b.className = 'v'; b.textContent = String(v);
    const c = document.createElement('span'); c.className = 's'; c.textContent = sub;
    d.append(a, b, c);
    el.summary.append(d);
  });
}

/* --------------------------------------------------------------- plugins */

/* Every plugin, grouped. Updates first because that is the work; then active,
   then inactive. Outdated plugins are housekeeping, not incidents, so they
   live here rather than padding out the Issues list. */
function renderPlugins() {
  if (!ctx || !el.plugins) return;

  /* Only wp-admin knows the real plugin list. A guess assembled from REST
     namespaces and asset paths is worse than nothing here, so show nothing
     until the bookmarklet has run. */
  if (!ctx.fromAdmin) { el.pPlugins.hidden = true; return; }

  const list = ctx.plugins || [];
  const needs = list
    .filter(p => p.adminUpdate || p.behind || p.worst)
    .sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9)
      || String(a.name || a.slug).localeCompare(String(b.name || b.slug)));

  el.pPlugins.hidden = false;
  el.pPlugins.classList.toggle('alert', needs.length > 0);
  if (needs.length) el.pPlugins.open = true;
  el.pluginCount.textContent = needs.length + ' of ' + (ctx.pluginTotal || list.length)
    + ' need update';
  el.pluginCount.className = 'count' + (needs.length ? ' has-red' : '');

  el.plugins.replaceChildren();

  if (!needs.length) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'All plugins up to date.';
    el.plugins.append(p);
    return;
  }

  const head = document.createElement('div');
  head.className = 'prow phead';
  ['#', 'Plugin', 'Installed', 'Update to', ''].forEach(t => {
    const c = document.createElement('span');
    c.textContent = t;
    head.append(c);
  });
  el.plugins.append(head);

  needs.forEach((p, i) => {
    const n = document.createElement('div');
    n.className = 'prow' + (p.worst ? ' vuln' : '');

    const cells = [
      String(i + 1),
      p.name || p.slug,
      p.version || '?',
      p.adminUpdate && p.adminUpdate !== 'available' ? p.adminUpdate
        : (p.latest || (p.adminUpdate ? 'available' : '?')),
      p.worst ? 'CVSS ' + p.worst.score : (p.active === false ? 'inactive' : '')
    ];

    cells.forEach((t, j) => {
      const c = document.createElement('span');
      c.textContent = t;
      if (j === 4 && p.worst) c.className = 'vtag';
      n.append(c);
    });

    if (p.detail) {
      n.classList.add('clickable');
      n.addEventListener('click', () => {
        const open = n.querySelector('.detail');
        if (open) { open.remove(); return; }
        const d = document.createElement('div');
        d.className = 'detail';
        d.textContent = p.detail;
        n.append(d);
      });
    }
    el.plugins.append(n);
  });
}

function renderTypes() {
  if (!el.types || !ctx) return;
  const list = ctx.types || [];
  if (!list.length) { if (el.pTypes) el.pTypes.hidden = true; return; }
  if (el.pTypes) el.pTypes.hidden = false;

  const total = list.reduce((s, t) => s + (t.n || 0), 0);
  if (el.typesCount) {
    el.typesCount.textContent = list.length + ' WordPress post types (' + total + ' items)';
  }

  el.types.replaceChildren();
  list.forEach((t, i) => {
    const n = document.createElement('div');
    n.className = 'trow';

    const num = document.createElement('span');
    num.className = 'tn';
    num.textContent = (i + 1);

    const name = document.createElement('span');
    name.className = 'tname';
    name.textContent = t.name;

    const count = document.createElement('span');
    count.className = 'tcount';
    count.textContent = (t.n == null ? '?' : t.n) + (t.n === 1 ? ' item' : ' items');

    const kind = document.createElement('span');
    kind.className = 'tkind';
    kind.textContent = t.builtin ? 'built in' : 'custom';

    /* The slug is also the jump: this is the screen you would open to see them. */
    const link = document.createElement('a');
    link.className = 'tlink';
    link.href = ctx.origin + '/wp-admin/edit.php?post_type=' + enc(t.slug);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = t.slug;

    n.append(num, name, count, kind, link);
    el.types.append(n);
  });
}

function renderStack() {
  if (!ctx || !el.stack) return;
  const list = buildStack();
  el.stack.replaceChildren();
  list.forEach(([cat, names]) => {
    const n = document.createElement('div');
    n.className = 'srow';
    const a = document.createElement('span');
    a.className = 'scat';
    a.textContent = cat;
    const b = document.createElement('span');
    b.className = 'sval';
    b.textContent = names;
    n.append(a, b);
    el.stack.append(n);
  });
  if (el.pStack) el.pStack.hidden = list.length < 2;
  if (el.stackCount) el.stackCount.textContent = list.length;
}

/* ------------------------------------------------- bookmarklet ingestion */

/* The bookmarklet runs inside wp-admin and copies a JSON blob out. Paste it
   anywhere on this page and the rows we could not see fill in with real data.
   Nothing is fetched from the client site here; this is just a merge. */
async function applyAdmin(data) {
  if (!ctx) return note('Run a scan first, then paste.', true);
  busy(true, 'Pasted from WP Pulse. Reading wp-admin data…');
  note('Pasted from WP Pulse. Getting data…', 'work');
  try { await mergeAdmin(data); } finally { busy(false); }
}

function busy(on, text) {
  if (!el.results) return;
  el.results.classList.toggle('busy', !!on);
  if (el.loader) el.loader.hidden = !on;
  if (on && text && el.loaderText) el.loaderText.textContent = text;
}

async function mergeAdmin(data) {

  if ((data.v || 1) < BM_VERSION) {
    return note('Your bookmarklet is out of date (v' + (data.v || 1) + ', needs v' + BM_VERSION
      + '). Open Bookmarklet below, delete the old one and drag the new one in.', true);
  }

  const host = (() => { try { return new URL(data.site).hostname; } catch { return ''; } })();
  if (host && host.replace(/^www\./, '') !== ctx.host.replace(/^www\./, '')) {
    return note('That data is from ' + host + ', not ' + ctx.host + '.', true);
  }

  const token = runToken;

  /* Core */
  if (data.core && data.core.version) {
    const have = data.core.version, latest = ctx.coreLatest;
    let vulns = [];
    try {
      const r = await getJSON(VULN_CORE + have + '/', 12000);
      vulns = (r.body && r.body.data && r.body.data.vulnerability) || [];
    } catch {}
    const worst = worstOf(matchVulns(vulns, have));
    const target = data.core.update || (latest && vcmp(have, latest) < 0 ? latest : null);
    ctx.core = { have, target };
    setRow('wordpress', {
      state: worst ? sevState(worst) : (target ? 'amber' : 'ok'),
      value: have + (target ? ' → ' + target : '  latest'),
      action: worst ? 'Update core now' : (target ? 'Update core' : ''),
      detail: vulns.length ? vulns.slice(0, 4).map(v => clean(v.name)).join('\n') : ''
    });
  }

  /* PHP */
  if (data.php) {
    const eol = PHP_EOL[minor(data.php)];
    const dead = eol && Date.parse(eol) < Date.now();
    setRow('php', {
      state: dead ? 'red' : 'ok',
      value: data.php + (dead ? '  EOL ' + eol.slice(0, 7) : ''),
      action: dead ? 'Ask host for 8.3' : '',
      detail: eol ? 'Security support ends ' + eol : ''
    });
  }

  /* Theme */
  const active = (data.themes || []).find(t => t.active) || (data.themes || [])[0];
  if (active) {
    addRow('theme', LABEL.theme);
    setRow('theme', {
      state: active.update ? 'amber' : 'ok',
      value: (active.name || active.slug) + '  ' + (active.version || '?')
        + (active.update ? '  → ' + active.update : ''),
      action: active.update ? 'Update' : '',
      detail: (data.themes || []).map(t =>
        (t.slug + '').padEnd(26) + (t.version || '?').padEnd(12)
        + (t.active ? 'active' : 'inactive')).join('\n')
    });
  }

  /* Server and limits, straight from Site Health. Facts, no verdicts, except
     where a value is genuinely actionable. */
  const S = data.server || {}, L = data.limits || {}, ST = data.status || {},
        C = data.constants || {}, CT = data.content || {};

  const fact = (id, value, opts) => {
    if (!value && value !== 0) return;
    addRow(id, LABEL[id] || id);
    setRow(id, Object.assign({ state: 'ok', value: String(value), action: '' }, opts || {}));
  };

  fact('db', S.database);
  fact('software', S.software || S.phpSapi);
  fact('memory', [L.phpMemory, L.wpMemory && L.wpMemory !== L.phpMemory ? 'WP ' + L.wpMemory : '']
    .filter(Boolean).join('  '));
  fact('upload', [L.maxUpload, L.postMax ? 'post ' + L.postMax : '',
    L.timeLimit ? L.timeLimit + 's' : ''].filter(Boolean).join('  '));

  if (ST.objectCache) {
    const none = /not|no|disabled/i.test(ST.objectCache);
    fact('objcache', ST.objectCache, none
      ? { state: 'amber', action: 'Consider Redis' } : {});
  }

  if (ST.cron) {
    /* Site Health reports the raw DISABLE_WP_CRON constant, so "false" means
       cron is on. Printing "false" next to WP-Cron reads as the opposite. */
    const off = /^true$|disabled/i.test(ST.cron.trim());
    fact('cron', off ? 'disabled (DISABLE_WP_CRON)'
      : (/^false$/i.test(ST.cron.trim()) ? 'enabled' : ST.cron),
      off ? { state: 'amber', action: 'Confirm server cron' } : {});
  }

  /* Debug flags left on in production leak paths and notices to visitors. */
  const onFlags = Object.keys(C).filter(k => /enabled|true/i.test(C[k] || ''));
  if (Object.keys(C).some(k => C[k])) {
    const live = /production/i.test(C.WP_ENVIRONMENT_TYPE || '');
    const risky = onFlags.filter(k => k === 'WP_DEBUG' || k === 'WP_DEBUG_DISPLAY');
    fact('debugflags', onFlags.length ? onFlags.join(', ') : 'all off',
      risky.length && live ? { state: 'red', action: 'Turn off on live' }
        : risky.length ? { state: 'amber', action: 'Check' } : {});
  }

  if (CT.posts != null) fact('posts', CT.posts);
  if (CT.pages != null) fact('pages', CT.pages);
  if (CT.media != null) fact('media', CT.media);

  if (Array.isArray(data.major) && data.major.length) fact('major', data.major.join(', '));

  if (Array.isArray(data.themes) && data.themes.length) {
    const upd = data.themes.filter(t => t.update).length;
    fact('themes', data.themes.length + (upd ? ', ' + upd + ' to update' : ''),
      upd ? { state: 'amber', action: 'Update themes' } : {});
  }

  /* Users */
  if (data.users && data.users.all != null) {
    const admins = data.users.administrator || 0;
    addRow('users2', 'Admin accounts');
    setRow('users2', {
      state: admins >= 4 ? 'amber' : 'ok',
      value: data.users.all + ' users, ' + admins + ' admin',
      action: admins >= 4 ? 'Review admins' : '',
      detail: Object.entries(data.users).map(([k, v]) => k.padEnd(20) + v).join('\n')
    });
  }

  /* Wordfence and friends add 2FA columns to users.php, so when the counts are
     there we get a real answer on admin account hardening for free. */
  const u = data.users || {};
  if (u['2fa_active'] != null || u['2fa_inactive'] != null) {
    const on = u['2fa_active'] || 0, off = u['2fa_inactive'] || 0;
    const admins = u.administrator || 0;
    addRow('twofa', LABEL.twofa);
    setRow('twofa', {
      state: on === 0 ? 'red' : (off > 0 ? 'amber' : 'ok'),
      value: on + ' of ' + (on + off) + ' users',
      action: on === 0 ? 'Enable for ' + (admins || 'all') + ' admin'
        : (off ? 'Enable for the rest' : ''),
      detail: 'Reported by the security plugin that adds 2FA columns to users.php.'
    });
  }

  /* Spam */
  if (data.spam != null) {
    addRow('spam', 'Spam comments');
    setRow('spam', {
      state: data.spam > 0 ? 'amber' : 'ok',
      value: String(data.spam),
      action: data.spam > 0 ? 'Empty spam' : ''
    });
  }

  /* Plugins: real versions, so the same criticality engine now runs on fact. */
  if (Array.isArray(data.plugins) && data.plugins.length) {
    /* Drop the guessed rows before rebuilding, or stale ones linger. */
    [...rows.keys()].filter(k => k.startsWith('plugin:')).forEach(k => rows.delete(k));

    ctx.pluginTotal = (data.pluginCounts && data.pluginCounts.all) || data.plugins.length;
    ctx.pluginActive = (data.pluginCounts && data.pluginCounts.active);
    await inspectAll(data.plugins.map(p => ({
      slug: p.slug,
      name: p.name || '',
      key: normSlug(p.slug),
      version: p.version || '',
      confident: !!p.version,
      trusted: !!p.version,
      adminUpdate: p.update && p.update !== 'available' ? p.update : (p.update ? 'available' : null),
      active: p.active
    })), token);
  }

  /* The page fetch may still have been blocked, but it no longer matters. */
  if (rows.has('fetchblock')) {
    setRow('fetchblock', {
      state: 'ok', value: 'covered by bookmarklet', action: '', inIssues: false
    });
  }

  ctx.fromAdmin = true;

  /* Keep the raw payload, on ctx for the detail panels and on disk so a reload,
     a view switch or a fresh re-scan all re-apply it. You paste once per site,
     and again only to replace it. */
  ctx.admin = data;
  saveAdmin(data);
  saveState();

  if ((data.content || {}).posts != null) rows.delete('content');
  const n = ctx.pluginTotal || (ctx.plugins || []).length;
  const up = (ctx.plugins || []).filter(p => p.adminUpdate || p.behind || p.worst).length;
  note('✓  Complete  —  core ' + (data.core && data.core.version || '?')
    + ', PHP ' + (data.php || '?') + ', ' + n + ' plugins, ' + up + ' need update'
    + (data.spam ? ', ' + data.spam + ' spam' : ''));
  paint();
}

let noteTimer = 0;
function note(msg, kind) {
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.className = kind === true || kind === 'bad' ? 'bad' : (kind === 'work' ? 'work' : '');
  el.toast.hidden = false;
  clearTimeout(noteTimer);
  /* "Working" stays until replaced. Success says its piece and gets out. */
  if (kind === 'work') return;
  noteTimer = setTimeout(() => { el.toast.hidden = true; }, kind ? 7000 : 6000);
}

if (el.drop) {
  const take = () => {
    const t = el.drop.value.trim();
    if (!t) return;
    let data = null;
    try { data = JSON.parse(t); } catch {}
    el.drop.value = '';
    if (data && data.wpPulse === 1) applyAdmin(data);
    else note('That is not WP Pulse bookmarklet data.', true);
  };
  el.drop.addEventListener('input', () => setTimeout(take, 0));
}

document.addEventListener('paste', (e) => {
  const text = (e.clipboardData || window.clipboardData || {}).getData
    ? (e.clipboardData || window.clipboardData).getData('text') : '';
  if (!text || text.indexOf('wpPulse') === -1) return;
  let data;
  try { data = JSON.parse(text); } catch { return; }
  if (!data || data.wpPulse !== 1) return;
  e.preventDefault();
  applyAdmin(data);
});

/* ------------------------------------------------------------------ shell */

function remember(host) {
  const key = 'wp-pulse-recent';
  const list = JSON.parse(localStorage.getItem(key) || '[]').filter(h => h !== host);
  list.unshift(host);
  localStorage.setItem(key, JSON.stringify(list.slice(0, 8)));
  drawRecent();
}

/* Only sites with a saved scan. A host you typed once and abandoned is not a
   result, and offering it implies there is something there to open. */
function drawRecent() {
  const all = readStore();
  const list = Object.keys(all)
    .sort((a, b) => (all[b].at || '').localeCompare(all[a].at || ''))
    .slice(0, 8);

  el.recent.replaceChildren();
  list.forEach(h => {
    const li = document.createElement('li');
    li.append(document.createTextNode(h));
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = String(all[h].at || '').slice(0, 10);
    li.append(when);
    li.addEventListener('click', () => { el.url.value = h; run(h); });
    el.recent.append(li);
  });
}

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = el.url.value.trim();
  if (v) run(v);
});

el.rerun.addEventListener('click', () => el.url.value.trim() && run(el.url.value.trim()));

el.settingsToggle.addEventListener('click', () => {
  el.settings.hidden = !el.settings.hidden;
  if (!el.settings.hidden) el.proxy.focus();
});

const clearBtn = $('#clear-saved');
if (clearBtn) {
  /* Ask once. Losing every saved scan to a stray click is not recoverable. */
  let armed = false;
  clearBtn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      clearBtn.classList.add('armed');
      clearBtn.textContent = 'Clear everything?';
      setTimeout(() => {
        if (!armed) return;
        armed = false;
        clearBtn.classList.remove('armed');
        clearBtn.textContent = 'Clear saved scans';
      }, 4000);
      return;
    }
    clearState();
    try {
      localStorage.removeItem('wp-pulse-recent');
      localStorage.removeItem('wp-pulse-history');
    } catch {}
    armed = false;
    clearBtn.classList.remove('armed');
    clearBtn.disabled = true;
    clearBtn.textContent = 'Cleared';
    drawRecent();
  });
}

el.proxy.addEventListener('change', () =>
  localStorage.setItem('wp-pulse-proxy', el.proxy.value.trim()));

el.copy.addEventListener('click', async () => {
  const text = reportBlock();
  let ok = true;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* The Clipboard API needs focus and a secure context. When it refuses,
       fall back rather than failing silently with nothing on the clipboard. */
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    ok = document.execCommand('copy');
    ta.remove();
  }
  el.copy.textContent = ok ? 'Copied' : 'Copy failed';
  setTimeout(() => { el.copy.textContent = 'Copy for Claude'; }, 1400);
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === '/') { e.preventDefault(); el.url.focus(); el.url.select(); }
  if (e.key === 'r' && ctx) el.rerun.click();
  if (e.key === 'c' && ctx) el.copy.click();
});

/* boot */
el.proxy.value = localStorage.getItem('wp-pulse-proxy')
  || (location.hostname === 'localhost' ? location.origin + '/proxy' : '');
drawRecent();

const seed = new URLSearchParams(location.search).get('s');
if (seed) {
  el.url.value = seed;
  if (el.v2Link) el.v2Link.href = 'v2.html?s=' + enc(seed);
  if (!restoreState(seed)) run(seed);
} else {
  el.url.focus();
}


/* --------------------------------------------------------------- public hook

   The v2 dashboard renders from this rather than scraping the DOM. Keeping one
   engine means a fix lands in both views at once. */

window.PULSE = {
  get rows() { return rows; },
  get ctx() { return ctx; },
  isIssue, RANK, LABEL, ADMIN,
  reportBlock,
  run, applyAdmin, saveState, clearState, readStore, loadAdmin, clearAdmin,
  onRender: []
};

const _render = render;
render = function () {
  _render();
  window.PULSE.onRender.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
};
