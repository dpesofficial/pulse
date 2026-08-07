/* WP Pulse — v2 dashboard renderer.
   Reads window.PULSE and draws the dashboard. It runs no checks of its own, so
   the two views can never disagree about what a site's state is. */

'use strict';

(function () {

  const $ = (s) => document.querySelector(s);
  const E = {
    bar: $('#v2-bar'), form: $('#v2-form'), url: $('#v2-url'),
    status: $('#v2-status'), body: $('#v2-body'), empty: $('#v2-empty'),
    cards: $('#cards'), actions: $('#actions'),
    todo: $('#todo'), nTodo: $('#n-todo'),
    issues: $('#v2-issues'), nIssues: $('#n-issues'),
    plugins: $('#v2-plugins'), nPlugins: $('#n-plugins'), bPlugins: $('#b-plugins'),
    stack: $('#v2-stack'), headers: $('#v2-headers'), nHeaders: $('#n-headers'),
    perf: $('#v2-perf'), content: $('#v2-content'),
    history: $('#v2-history'), bHistory: $('#b-history'),
    diff: $('#diff'), bDiff: $('#b-diff'), nDiff: $('#n-diff'),
    drop: $('#up-drop'), upsell: $('#upsell'), note: $('#v2-note'), recent: $('#v2-recent'),
    server: $('#v2-server'), limits: $('#v2-limits'), config: $('#v2-config'),
    constants: $('#v2-constants'), themes: $('#v2-themes'), nThemes: $('#n-themes'),
    seo: $('#v2-seo'), tracking: $('#v2-tracking'),
    all: $('#v2-all'), nAll: $('#n-all'),
    bServer: $('#b-server'), bLimits: $('#b-limits'), bConfig: $('#b-config'),
    bConstants: $('#b-constants'), bThemes: $('#b-themes'), bTracking: $('#b-tracking')
  };

  const HIST = 'wp-pulse-history';

  /* A row that carries no fact is not worth a line. The banner at the top says
     once that more is available; repeating "needs wp-admin" twenty times below
     it just buries the things we do know. */
  const BLANK = /^(\?|\u2014|-|)$/;
  const NOTHING = /needs wp-admin|version hidden|version unknown|unknown version|not reported|no proxy|not detected|not measured|none detected|proxy failed/i;
  const unknown = (r) => !r || r.state === 'hollow' || r.state === 'pending'
    || BLANK.test(String(r.value == null ? '' : r.value).trim())
    || NOTHING.test(String(r.value || ''));
  const known = (v) => v != null && v !== '' && !BLANK.test(String(v).trim())
    && !NOTHING.test(String(v));
  const enc = encodeURIComponent;
  const el = (t, cls, text) => {
    const n = document.createElement(t);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  };
  const kv = (host, pairs) => {
    host.replaceChildren();
    const dl = el('dl', 'kv');
    pairs.forEach(([k, v, cls]) => {
      if (!known(v)) return;
      dl.append(el('dt', null, k), el('dd', cls || null, v));
    });
    host.append(dl);
  };

  /* ------------------------------------------------------------------ score */

  /* Every deduction is listed in the card's tooltip and in the export. A score
     you cannot take apart is a number people stop trusting the first time it
     disagrees with them. */
  const WEIGHT = { critical: 20, high: 12, red: 12, amber: 5, phpEol: 15, coreBehind: 10 };

  function score() {
    const P = window.PULSE, rows = [...P.rows.values()];
    const deductions = [];
    let s = 100;

    (P.ctx.plugins || []).forEach(p => {
      if (!p.worst) return;
      const sc = parseFloat(p.worst.score) || 0;
      const w = sc >= 9 ? WEIGHT.critical : sc >= 7 ? WEIGHT.high : 6;
      s -= w;
      deductions.push([w, (p.name || p.slug) + ' CVSS ' + p.worst.score]);
    });

    rows.filter(P.isIssue).forEach(r => {
      if (r.id.startsWith('plugin:')) return;   // already counted above
      if (r.state === 'hollow') return;         // unknown is not a penalty
      const isPhp = r.id === 'php' && /EOL/i.test(r.value);
      const isCore = r.id === 'wordpress' && /→/.test(r.value);
      const w = isPhp ? WEIGHT.phpEol : isCore ? WEIGHT.coreBehind
        : (r.state === 'red' ? WEIGHT.red : WEIGHT.amber);
      s -= w;
      deductions.push([w, r.subject + ' — ' + r.value]);
    });

    deductions.sort((a, b) => b[0] - a[0]);
    return { value: Math.max(0, Math.round(s)), deductions };
  }

  const band = (n) => n >= 85 ? 'ok' : n >= 60 ? 'amber' : 'red';

  /* ------------------------------------------------------------------ cards */

  function renderCards(sc, counts) {
    const P = window.PULSE, C = P.ctx;
    E.cards.replaceChildren();

    /* Score */
    const c1 = el('div', 'card ' + band(sc.value));
    c1.append(el('span', 'lab', 'Security score'), el('span', 'big', sc.value));
    const bar = el('div', 'bar'); const fill = el('i');
    fill.style.width = sc.value + '%';
    bar.append(fill); c1.append(bar);
    c1.append(el('span', 'sub', sc.deductions.length
      ? 'worst: ' + sc.deductions[0][1]
      : 'nothing found'));
    c1.title = sc.deductions.length
      ? sc.deductions.map(d => '-' + d[0] + '  ' + d[1]).join('\n')
      : 'No deductions';
    E.cards.append(c1);

    /* Issues with breakdown. Green means zero and nothing else: a count of 3 in
       green reads as "three problems, all fine", which is a contradiction. */
    const totalIssues = counts.red + counts.amber + counts.info;
    const c2 = el('div', 'card ' + (counts.red ? 'red' : counts.amber ? 'amber'
      : totalIssues ? 'red' : 'ok'));
    c2.append(el('span', 'lab', 'Issues'),
      el('span', 'big', totalIssues));
    const pips = el('div', 'pips');
    [['red', 'Critical', counts.red], ['amber', 'Warning', counts.amber],
     ['info', 'Info', counts.info]].forEach(([k, label, n]) => {
      const w = el('span');
      w.append(el('i', 'pip ' + k), el('b', null, n), document.createTextNode(' ' + label));
      pips.append(w);
    });
    c2.append(pips);
    E.cards.append(c2);

    /* Plugins */
    const fromAdmin = !!C.fromAdmin;
    const total = C.pluginTotal || (C.plugins || []).length;
    const needs = (C.plugins || []).filter(p => p.adminUpdate || p.behind || p.worst).length;
    if (fromAdmin) {
      const c3 = el('div', 'card ' + (needs ? 'amber' : 'ok'));
      c3.append(el('span', 'lab', 'Plugins'), el('span', 'big', total));
      c3.append(el('span', 'sub',
        (C.pluginActive != null ? C.pluginActive + ' active, ' : '') + needs + ' need update'));
      E.cards.append(c3);
    }

    /* Server response. Honest about what it is. */
    const t = C.timing || {};
    const ms = t.proxyMs;
    if (ms != null) {
      const c4 = el('div', 'card ' + (ms > 2500 ? 'amber' : 'ok'));
      c4.append(el('span', 'lab', 'Server response'), el('span', 'big', ms + 'ms'));
      c4.append(el('span', 'sub', 'how fast the server replied'));
      E.cards.append(c4);
    }
  }

  /* ------------------------------------------------------------------ issues */

  const BADGE = { red: ['CRITICAL', 'red'], amber: ['WARNING', 'amber'], hollow: ['INFO', 'info'] };

  function renderIssues(list) {
    E.issues.replaceChildren();
    E.nIssues.textContent = list.length || '';
    if (!list.length) {
      E.issues.append(el('p', 'gap', 'Nothing to fix.'));
      return;
    }
    list.forEach(r => {
      const [label, cls] = BADGE[r.state] || BADGE.hollow;
      const row = el('div', 'irow');
      row.append(el('span', 'badge ' + cls, label));

      const mid = el('div');
      mid.append(el('span', 'lab', r.subject));
      if (r.value) mid.append(el('span', 'ev', r.value));
      if (r.detail) {
        const d = el('span', 'ev');
        d.textContent = String(r.detail).split('\n')[0].slice(0, 120);
        mid.append(d);
      }
      row.append(mid);

      const admin = window.PULSE.ADMIN[r.id];
      if (r.action === 'Open wp-admin' || admin) {
        const a = el('a', 'act', r.action || 'Open wp-admin');
        a.href = window.PULSE.ctx.origin + (admin || '/wp-admin/');
        a.target = '_blank'; a.rel = 'noopener noreferrer';
        row.append(a);
      } else {
        row.append(el('span', 'act', r.action || ''));
      }
      E.issues.append(row);
    });
  }

  /* ----------------------------------------------------------------- to-do */

  function renderTodo(list, sc) {
    E.todo.replaceChildren();
    const ranked = list
      .filter(r => r.state === 'red' || r.state === 'amber')
      .slice(0, 8);
    E.nTodo.textContent = ranked.length || '';
    if (!ranked.length) {
      E.todo.append(el('p', 'gap', 'Nothing outstanding.'));
      return;
    }
    ranked.forEach((r, i) => {
      const li = el('li', r.state);
      li.append(el('span', 'rank', i + 1));
      const mid = el('div');
      mid.append(el('span', 'lab', r.subject + (r.value ? ' — ' + r.value : '')));
      mid.append(el('span', 'why', why(r)));
      li.append(mid);
      li.append(el('span', 'fix', r.action || ''));
      E.todo.append(li);
    });
  }

  /* Impact in one line, and only where it is genuinely true. */
  const WHY = {
    php: 'No security patches. Any new PHP vulnerability stays unfixed.',
    wordpress: 'Core releases fix security holes that are public once released.',
    debugflags: 'Debug output can expose file paths and query errors to visitors.',
    objcache: 'Every page build re-queries the database.',
    twofa: 'A leaked password is enough to get in.',
    users2: 'More admin accounts means more ways in, and more to audit.',
    llms: 'AI answer engines have no structured summary of the site to cite.',
    lastpost: 'Stale content weakens topical authority in search.',
    headers: 'Browsers cannot enforce protections the server never asks for.',
    sitemap: 'Search engines crawl by discovery instead of by instruction.',
    themes: 'Theme updates carry security fixes just like plugins.',
    tls: 'Traffic is interceptable and search engines penalise it.',
    users: 'Usernames are half of a brute-force attempt.',
    spam: 'Spam comments harm crawl budget and look unmaintained.',
    title: 'Search engines write their own snippet when yours is missing.',
    schema: 'No structured data means no rich results.'
  };
  const why = (r) => WHY[r.id] || (r.id.startsWith('plugin:')
    ? 'Known vulnerability at the installed version.' : '');

  /* --------------------------------------------------------- plugin health */

  function renderPlugins() {
    const C = window.PULSE.ctx;
    const list = C.plugins || [];
    if (!C.fromAdmin || !list.length) { E.bPlugins.hidden = true; return; }
    E.bPlugins.hidden = false;

    const R = window.PULSE.RANK;
    const sorted = list.slice().sort((a, b) =>
      (R[a.state] ?? 9) - (R[b.state] ?? 9)
      || String(a.name || a.slug).localeCompare(String(b.name || b.slug)));

    const needs = list.filter(p => p.adminUpdate || p.behind || p.worst).length;
    E.nPlugins.textContent = needs + ' of ' + (C.pluginTotal || list.length) + ' need update';

    E.plugins.replaceChildren();
    const head = el('div', 'ph head');
    ['Plugin', 'Installed', 'Latest', 'Risk', 'Status', 'Released']
      .forEach(t => head.append(el('span', null, t)));
    E.plugins.append(head);

    sorted.forEach(p => {
      const bad = p.worst ? 'is-red' : (p.adminUpdate || p.behind) ? 'is-amber' : '';
      const row = el('div', 'ph ' + bad);
      row.append(el('span', null, p.name || p.slug));
      row.append(el('span', null, p.version || '?'));
      row.append(el('span', 'to', p.adminUpdate && p.adminUpdate !== 'available'
        ? p.adminUpdate : (p.latest || (p.adminUpdate ? 'avail' : '—'))));
      row.append(el('span', 'vulns' + (p.worst ? ' has' : ''), p.worst ? 'CVSS ' + p.worst.score : '0'));

      const st = el('span', 'st' + (p.active === false ? ' off' : ''));
      const dot = el('i', 'pip ' + (p.worst ? 'red' : (p.adminUpdate || p.behind) ? 'amber' : 'info'));
      if (!p.worst && !p.adminUpdate && !p.behind) dot.style.background = 'var(--green)';
      st.append(dot, document.createTextNode(p.active === false ? 'inactive' : 'active'));
      row.append(st);

      row.append(el('span', null, p.lastUpdated ? String(p.lastUpdated).slice(0, 10) : '—'));
      if (p.detail) row.title = p.detail;
      E.plugins.append(row);
    });

    E.plugins.append(el('p', 'gap', 'Released is the author’s release date.'));
  }

  /* ---------------------------------------------------------------- stack */

  function renderStack() {
    const P = window.PULSE, C = P.ctx, get = (id) => P.rows.get(id);
    const v = (id) => { const r = get(id); return r && !unknown(r) ? r.value : ''; };
    const phpRow = get('php');
    const phpDead = phpRow && phpRow.state === 'red';

    kv(E.stack, [
      ['Web server', v('software') || v('server')],
      /* hostingOf() reads the same header when there is no host-specific one,
         so only show it when it actually adds something. */
      ['PHP', v('php'), phpDead ? 'red' : 'ok'],
      ['Database', v('db')],
      ['WordPress', v('wordpress'), get('wordpress') && get('wordpress').state === 'amber' ? 'amber' : ''],
      ['Theme', v('theme')],
      ['Hosting', hostingOf(C) === (v('software') || v('server')) ? '' : hostingOf(C)],
      ['CDN', v('cdn')],
      ['Caching', v('cache') || (v('objcache') ? 'object: ' + v('objcache') : '')],
      ['Memory', v('memory')],
      ['Max upload', v('upload')],
      ['HTTPS', v('tls'), v('tls') === 'enforced' ? 'ok' : 'red']
    ]);
  }

  function hostingOf(C) {
    const h = C.headers || {};
    if (h['x-wpe-backend'] || /wpengine/i.test(h['server'] || '')) return 'WP Engine';
    if (h['x-kinsta-cache']) return 'Kinsta';
    if (h['x-pantheon-styx-hostname']) return 'Pantheon';
    if (/flywheel/i.test(h['server'] || '')) return 'Flywheel';
    return h['server'] || '';
  }

  /* -------------------------------------------------------------- headers */

  const HEADERS = [
    ['strict-transport-security', 'HSTS'],
    ['content-security-policy', 'Content-Security-Policy'],
    ['x-frame-options', 'X-Frame-Options'],
    ['x-content-type-options', 'X-Content-Type-Options'],
    ['referrer-policy', 'Referrer-Policy'],
    ['permissions-policy', 'Permissions-Policy']
  ];

  function renderHeaders() {
    const h = window.PULSE.ctx.headers || {};
    const seen = Object.keys(h).length;
    if (!seen) {
      E.headers.replaceChildren(el('p', 'gap', 'Could not read the site’s headers.'));
      E.nHeaders.textContent = '';
      return;
    }
    const pass = HEADERS.filter(([k]) => h[k]).length;
    E.nHeaders.textContent = pass + ' of ' + HEADERS.length;
    kv(E.headers, HEADERS.map(([k, label]) => [
      label,
      h[k] ? (String(h[k]).length > 46 ? String(h[k]).slice(0, 46) + '…' : h[k]) : 'not set',
      h[k] ? 'ok' : (k === 'content-security-policy' ? 'miss' : 'amber')
    ]));
  }

  /* ------------------------------------------------- response and content */

  function renderPerf() {
    const t = window.PULSE.ctx.timing || {};
    if (t.proxyMs == null) {
      E.perf.replaceChildren(el('p', 'gap', 'Not measured.'));
      return;
    }
    kv(E.perf, [
      ['Server replied in', t.proxyMs + ' ms', t.proxyMs > 2500 ? 'amber' : 'ok'],
      ['Page size', t.htmlBytes ? Math.round(t.htmlBytes / 1024) + ' KB' : '',
        t.htmlBytes > 250000 ? 'amber' : ''],
      ['Files on the page', t.assets != null ? t.assets : '']
    ]);
    E.perf.append(el('p', 'gap', 'For real visitor speed, use PageSpeed below.'));
  }

  function renderContent() {
    const P = window.PULSE, v = (id) => { const r = P.rows.get(id); return r && !unknown(r) ? r.value : ''; };
    const types = (window.PULSE.ctx.types || [])
      .filter(t => t.n)
      .map(t => t.name + ' ' + t.n);
    kv(E.content, [
      ['Content types', types.join(', ')],
      ['Posts', v('posts')], ['Pages', v('pages')], ['Media', v('media')],
      ['Users', v('users2')], ['Spam', v('spam')],
      ['Last published', v('lastpost')],
      ['Key plugins', v('major')],
      ['Themes', v('themes')]
    ]);
  }

  /* ------------------------------------------------------------- detail */

  /* Everything wp-admin gave us, laid out by area. Rendered from the stored
     payload, so a reload or a view switch shows it without pasting again. */
  function renderDetail() {
    const P = window.PULSE, C = P.ctx;
    const A = C.admin || null;
    const row = (id) => { const r = P.rows.get(id); return r && !unknown(r) ? r : null; };
    const val = (id) => { const r = row(id); return r ? r.value : ''; };
    const cls = (id) => { const r = row(id); return r ? (r.state === 'ok' ? 'ok' : r.state) : ''; };

    const S = (A && A.server) || {}, L = (A && A.limits) || {},
          ST = (A && A.status) || {}, K = (A && A.constants) || {};

    const hasServer = !!(S.php || S.database || S.software || val('software'));
    E.bServer.hidden = !hasServer;
    if (hasServer) kv(E.server, [
      ['PHP', S.php || val('php'), cls('php')],
      ['PHP mode', S.phpSapi],
      ['Database', S.database || val('db')],
      ['Database driver', S.databaseExt],
      ['Web server', S.software || val('software')],
      ['cURL', S.curl],
      ['Hosting', hostingOf(C) === (S.software || val('software')) ? '' : hostingOf(C)],
      ['CDN', val('cdn')],
      ['HTTPS', S.https || val('tls'), val('tls') === 'enforced' ? 'ok' : ''],
      ['Timezone', S.timezone],
      ['Language', S.language]
    ]);

    const hasLimits = Object.keys(L).some(k => L[k]);
    E.bLimits.hidden = !hasLimits;
    if (hasLimits) kv(E.limits, [
      ['PHP memory', L.phpMemory],
      ['WP memory', L.wpMemory],
      ['Max upload', L.maxUpload],
      ['POST max', L.postMax],
      ['Time limit', L.timeLimit ? L.timeLimit + ' s' : ''],
      ['Max input vars', L.inputVars]
    ]);

    const cacheVal = val('objcache') || ST.objectCache;
    const hasCfg = Object.keys(ST).some(k => ST[k]) || cacheVal || val('cron');
    E.bConfig.hidden = !hasCfg;
    if (hasCfg) kv(E.config, [
      ['Object cache', cacheVal || 'not reported',
        /not|no\b|disabled/i.test(cacheVal || 'not') ? 'amber' : 'ok'],
      ['OPcache', ST.opcache],
      ['WP-Cron', val('cron') || ST.cron],
      ['Permalinks', ST.permalinks],
      ['Multisite', ST.multisite],
      ['Anyone can register', ST.registration, /yes/i.test(ST.registration || '') ? 'amber' : ''],
      ['Usernames public', val('users'), cls('users')],
      ['Two-factor', val('twofa'), cls('twofa')]
    ]);

    const hasK = Object.keys(K).some(k => K[k]);
    E.bConstants.hidden = !hasK;
    if (hasK) {
      const live = /production/i.test(K.WP_ENVIRONMENT_TYPE || '');
      kv(E.constants, Object.keys(K).map(k => {
        const v = K[k];
        if (!v) return [k, ''];
        const on = /enabled|true/i.test(v);
        const risky = on && live && (k === 'WP_DEBUG' || k === 'WP_DEBUG_DISPLAY');
        return [k, v, risky ? 'red' : (on ? 'amber' : 'ok')];
      }));
    }

    const themes = (A && A.themes) || [];
    E.bThemes.hidden = !themes.length;
    if (themes.length) {
      E.nThemes.textContent = themes.length;
      kv(E.themes, themes.map(t => [
        (t.active ? 'Active: ' : '') + (t.name || t.slug),
        (t.version || '?') + (t.update ? '  to ' + t.update : ''),
        t.update ? 'amber' : (t.active ? 'ok' : 'miss')
      ]));
    }

    kv(E.seo, [
      ['Meta title', val('title'), cls('title')],
      ['Schema', val('schema'), cls('schema')],
      ['robots.txt', val('robots'), cls('robots')],
      ['sitemap.xml', val('sitemap'), cls('sitemap')],
      ['llms.txt', val('llms'), cls('llms')],
      ['Last published', val('lastpost'), cls('lastpost')],
      ['Security headers', val('headers'), cls('headers')]
    ]);

    const ns = C.namespaces || [];
    kv(E.tracking, [
      ['Analytics and tags', val('tags')],
      ['Key plugins', val('major')],
      ['Plugin APIs in use', ns.length ? ns.join(', ') : val('restapi')]
    ]);

    /* Every check verbatim, for when a number gets disputed. */
    const all = [...P.rows.values()].filter(r => !unknown(r));
    E.nAll.textContent = all.length;
    E.all.replaceChildren();
    const dl = el('dl', 'kv');
    all.forEach(r => {
      dl.append(el('dt', null, r.subject),
        el('dd', r.state === 'ok' ? 'ok' : r.state,
          r.value + (r.action ? '  -> ' + r.action : '')));
    });
    E.all.append(dl);
  }

  /* A heading over nothing is worse than no heading. Any block that ended up
     with no real values disappears entirely. */
  function hideEmpty() {
    document.querySelectorAll('#v2-body .block').forEach(b => {
      if (b.id === 'b-psi' || b.id === 'b-history' || b.id === 'b-diff') return;
      const body = b.querySelector(':scope > div');
      if (!body) return;
      const hasValue = [...body.querySelectorAll('dd, .irow, .ph:not(.head), li, .prow:not(.phead)')]
        .some(n => n.textContent.trim());
      b.hidden = !hasValue;
    });
  }

  /* --------------------------------------------------- history and compare */

  const readHist = () => { try { return JSON.parse(localStorage.getItem(HIST) || '[]'); } catch { return []; } };

  function saveHist(entry) {
    const all = readHist();
    const last = all.find(e => e.host === entry.host);
    /* One entry per host per day, so a few re-runs do not bury the history. */
    if (last && last.day === entry.day) Object.assign(last, entry);
    else all.unshift(entry);
    localStorage.setItem(HIST, JSON.stringify(all.slice(0, 40)));
  }

  const prevFor = (host, day) => readHist().find(e => e.host === host && e.day !== day);

  function renderHistory() {
    const all = readHist();
    if (!all.length) { E.bHistory.hidden = true; return; }
    E.bHistory.hidden = false;
    E.history.replaceChildren();
    const head = el('div', 'hrow head');
    E.history.append(head);
    all.slice(0, 12).forEach(e => {
      const row = el('div', 'hrow');
      row.append(el('span', 'dom', e.host));
      row.append(el('span', null, e.day));
      row.append(el('span', 'sc ' + band(e.score), e.score));
      row.append(el('span', null, e.issues + ' issues'));
      row.append(el('span', null, (e.updates || 0) + ' upd'));
      row.addEventListener('click', () => go(e.host));
      E.history.append(row);
    });
  }

  function renderDiff(entry) {
    const prev = prevFor(entry.host, entry.day);
    if (!prev) { E.bDiff.hidden = true; return; }
    E.bDiff.hidden = false;
    E.nDiff.textContent = 'vs ' + prev.day;
    E.diff.replaceChildren();

    const lines = [
      ['Security score', prev.score, entry.score, true],
      ['Issues', prev.issues, entry.issues, false],
      ['Plugin updates', prev.updates || 0, entry.updates || 0, false]
    ];
    let any = false;
    lines.forEach(([label, a, b, higherIsBetter]) => {
      if (a === b) return;
      any = true;
      const better = higherIsBetter ? b > a : b < a;
      const row = el('div', 'dl ' + (better ? 'down' : 'up'));
      row.append(el('span', 'sign', better ? '↓' : '↑'));
      row.append(el('span', 'txt', label + ': ' + a + ' → ' + b));
      row.append(el('span', 'when', prev.day));
      E.diff.append(row);
    });
    if (!any) E.diff.append(el('p', 'gap', 'No change since ' + prev.day + '.'));
  }

  /* ------------------------------------------------------------- assemble */

  let lastEntry = null;

  function renderAll() {
    const P = window.PULSE;
    if (!P.ctx) return;

    const rows = [...P.rows.values()];
    const pending = rows.some(r => r.state === 'pending');
    const issues = rows.filter(P.isIssue).filter(r => !unknown(r))
      .sort((a, b) => (P.RANK[a.state] ?? 9) - (P.RANK[b.state] ?? 9)
        || a.subject.localeCompare(b.subject));

    E.empty.hidden = true;
    E.body.hidden = false;
    syncClassic(P.ctx.host);

    const counts = {
      red: issues.filter(r => r.state === 'red').length,
      amber: issues.filter(r => r.state === 'amber').length,
      info: 0
    };
    const sc = score();

    renderCards(sc, counts);
    renderIssues(issues);
    renderTodo(issues, sc);
    renderPlugins();
    renderStack();
    renderHeaders();
    renderPerf();
    renderContent();
    renderDetail();
    hideEmpty();

    /* Ask once, at the top, and only while there is something to ask for. */
    if (E.upsell) E.upsell.hidden = !!P.ctx.fromAdmin;
    E.note.textContent = P.ctx.fromAdmin
      ? 'Includes wp-admin data' + (P.ctx.adminAt
        ? ' from ' + String(P.ctx.adminAt).replace('T', ' ').slice(0, 16) : '') + '.'
      : 'Public scan only.';

    if (P.ctx.restoredAt) {
      status('Showing your saved scan from '
        + String(P.ctx.restoredAt).replace('T', ' ').slice(0, 16)
        + '. Press Scan again for fresh results.');
    }

    if (!pending) {
      const entry = {
        host: P.ctx.host,
        day: new Date().toISOString().slice(0, 10),
        score: sc.value,
        issues: issues.length,
        updates: (P.ctx.plugins || []).filter(p => p.adminUpdate || p.behind || p.worst).length
      };
      renderDiff(entry);
      saveHist(entry);
      lastEntry = { entry, sc, issues };
    }
    renderHistory();
  }

  /* -------------------------------------------------------------- actions */

  function exportJSON() {
    const P = window.PULSE;
    const out = {
      site: P.ctx.host,
      scannedAt: new Date().toISOString(),
      score: score(),
      rows: [...P.rows.values()].map(r => ({
        id: r.id, subject: r.subject, state: r.state,
        value: r.value, action: r.action, detail: r.detail || undefined
      })),
      plugins: P.ctx.plugins || [],
      headers: P.ctx.headers || {},
      timing: P.ctx.timing || {},
      fromAdmin: !!P.ctx.fromAdmin
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wp-pulse-' + P.ctx.host + '-' + out.scannedAt.slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  E.actions.addEventListener('click', async (e) => {
    const act = e.target.getAttribute && e.target.getAttribute('data-act');
    if (!act) return;
    const P = window.PULSE;
    if (act === 'rescan') {
      P.clearState(P.ctx.host);          // otherwise boot would restore it again
      status('Scanning ' + P.ctx.host + '…');
      return P.run(P.ctx.host);
    }
    if (act === 'json') return exportJSON();
    if (act === 'pdf') return window.print();
    if (act === 'claude') {
      const text = P.reportBlock();
      try { await navigator.clipboard.writeText(text); status('Copied for Claude.', 'ok'); }
      catch { status('Could not copy.', 'bad'); }
      return;
    }
    if (act === 'clear') {
      P.clearState(P.ctx.host);
      status('Cleared the saved scan for ' + P.ctx.host + '.', 'ok');
      return;
    }
    if (act === 'clearall') {
      P.clearState();
      try { localStorage.removeItem('wp-pulse-history'); } catch {}
      E.bHistory.hidden = true;
      status('Cleared all saved scans and history.', 'ok');
      return;
    }
    if (act === 'email') {
      const body = P.reportBlock().slice(0, 1800);
      location.href = 'mailto:?subject=' + enc('WP Pulse — ' + P.ctx.host)
        + '&body=' + enc(body);
    }
  });

  /* ------------------------------------------------------------ pagespeed */

  /* Google's own API, free, CORS-enabled. Deliberately on demand: two requests
     take several seconds each and the unkeyed quota is small, so running it on
     every scan would rate-limit you out of the useful checks. */

  const PSI = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
  const psiKeyEl = $('#psi-key'), psiGo = $('#psi-go'), psiOut = $('#psi-out'), nPsi = $('#n-psi');

  /* Precedence: whatever you last typed, then the local config file. So the
     field is pre-filled on a fresh browser but you can still override it. */
  const cfgKey = (window.PULSE_CONFIG && window.PULSE_CONFIG.psiKey) || '';
  try { psiKeyEl.value = localStorage.getItem('wp-pulse-psi-key') || cfgKey; }
  catch { psiKeyEl.value = cfgKey; }
  if (psiKeyEl.value) psiKeyEl.placeholder = 'API key set';
  psiKeyEl.addEventListener('change', () => {
    try { localStorage.setItem('wp-pulse-psi-key', psiKeyEl.value.trim()); } catch {}
  });

  async function runPsi(strategy, origin, key) {
    const u = PSI + '?url=' + enc(origin) + '&strategy=' + strategy
      + '&category=performance' + (key ? '&key=' + enc(key) : '');
    const r = await fetch(u);
    const b = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = (b && b.error && b.error.message) || ('HTTP ' + r.status);
      return { error: r.status === 429 ? 'Rate limited. Add a free API key.' : msg };
    }
    return read(b);
  }

  /* Field data is what real visitors experienced. Lab data is one synthetic
     run. They disagree often, so both are shown and labelled. */
  function read(b) {
    const L = (b && b.lighthouseResult) || {};
    const A = L.audits || {};
    const F = (b && b.loadingExperience && b.loadingExperience.metrics) || {};
    const val = (k) => (A[k] && A[k].displayValue) || '';
    const field = (k) => {
      const m = F[k];
      if (!m) return null;
      return { p: m.percentile, cat: m.category };
    };
    return {
      score: L.categories && L.categories.performance
        ? Math.round(L.categories.performance.score * 100) : null,
      overall: (b.loadingExperience && b.loadingExperience.overall_category) || '',
      lcpField: field('LARGEST_CONTENTFUL_PAINT_MS'),
      inpField: field('INTERACTION_TO_NEXT_PAINT') || field('EXPERIMENTAL_INTERACTION_TO_NEXT_PAINT'),
      clsField: field('CUMULATIVE_LAYOUT_SHIFT_SCORE'),
      lcpLab: val('largest-contentful-paint'),
      clsLab: val('cumulative-layout-shift'),
      tbtLab: val('total-blocking-time'),
      fcpLab: val('first-contentful-paint')
    };
  }

  const CAT = { FAST: 'ok', AVERAGE: 'amber', SLOW: 'red' };
  const fmtField = (f, unit) => {
    if (!f || f.p == null) return ['no field data', 'miss'];
    const v = unit === 's' ? (f.p / 1000).toFixed(1) + 's'
      : unit === 'cls' ? (f.p / 100).toFixed(2) : f.p + 'ms';
    return [v + '  ' + (f.cat || '').toLowerCase(), CAT[f.cat] || ''];
  };
  const scoreCls = (n) => n == null ? 'miss' : n >= 90 ? 'ok' : n >= 50 ? 'amber' : 'red';

  /* Google's own bands and shapes, so the numbers read exactly as they do in
     PageSpeed Insights and nobody has to translate between the two. */
  const G = { good: '#0cce6b', avg: '#ffa400', poor: '#ff4e42' };
  const gband = (n) => n == null ? null : n >= 90 ? 'good' : n >= 50 ? 'avg' : 'poor';

  function gauge(n) {
    const b = gband(n);
    const col = b ? G[b] : '#9aa0a6';
    const R = 46, CIRC = 2 * Math.PI * R;
    const pct = n == null ? 0 : n / 100;
    const wrap = el('div', 'gauge');
    wrap.innerHTML =
      '<svg viewBox="0 0 112 112" aria-hidden="true">'
      + '<circle cx="56" cy="56" r="' + R + '" fill="none" stroke="' + col
      + '" stroke-opacity=".22" stroke-width="8"/>'
      + '<circle cx="56" cy="56" r="' + R + '" fill="none" stroke="' + col
      + '" stroke-width="8" stroke-linecap="round"'
      + ' stroke-dasharray="' + (CIRC * pct).toFixed(1) + ' ' + CIRC.toFixed(1) + '"'
      + ' transform="rotate(-90 56 56)"/></svg>';
    const num = el('b', null, n == null ? '?' : n);
    num.style.color = col;
    wrap.append(num);
    return wrap;
  }

  /* Google marks good / needs-improvement / poor with a square, a square with
     rounded corners and a triangle. Shape carries the meaning as well as colour,
     which is what makes it readable in greyscale and for colourblind viewers. */
  const SHAPE = { good: 'sq', avg: 'rd', poor: 'tri' };

  function cwvRow(label, f, unit) {
    const wrap = el('div', 'cwv');
    if (!f || f.p == null) {
      wrap.append(el('span', 'sh none'), el('span', 'cl', label),
        el('span', 'cv miss', 'no field data'));
      return wrap;
    }
    const b = f.cat === 'FAST' ? 'good' : f.cat === 'AVERAGE' ? 'avg' : 'poor';
    const v = unit === 's' ? (f.p / 1000).toFixed(1) + ' s'
      : unit === 'cls' ? (f.p / 100).toFixed(2) : f.p + ' ms';
    const sh = el('span', 'sh ' + SHAPE[b]);
    sh.style.color = G[b];
    const cv = el('span', 'cv');
    cv.style.color = G[b];
    cv.textContent = v;
    wrap.append(sh, el('span', 'cl', label), cv);
    return wrap;
  }

  function renderPsi(m, d) {
    psiOut.replaceChildren();

    const grid = el('div', 'psi-grid');
    [['Mobile', m], ['Desktop', d]].forEach(([name, r]) => {
      const col = el('div', 'psi-col');
      col.append(el('div', 'psi-name', name));

      if (r.error) {
        col.append(el('p', 'gap', r.error));
        grid.append(col);
        return;
      }

      col.append(gauge(r.score));
      col.append(el('div', 'psi-sub', 'Performance'));

      const field = [r.lcpField, r.inpField, r.clsField].filter(f => f && f.p != null);
      if (field.length) {
        const passed = field.length === 3 && field.every(f => f.cat === 'FAST');
        const badge = el('div', 'cwv-verdict ' + (passed ? 'pass' : 'fail'),
          'Core Web Vitals assessment: ' + (passed ? 'Passed' : 'Failed'));
        col.append(badge);
      }

      const cw = el('div', 'cwv-list');
      cw.append(cwvRow('Largest Contentful Paint', r.lcpField, 's'));
      cw.append(cwvRow('Interaction to Next Paint', r.inpField, 'ms'));
      cw.append(cwvRow('Cumulative Layout Shift', r.clsField, 'cls'));
      col.append(cw);

      const lab = el('div', 'psi-lab');
      [['LCP', r.lcpLab], ['FCP', r.fcpLab], ['TBT', r.tbtLab], ['CLS', r.clsLab]]
        .forEach(([k, v]) => {
          if (!v) return;
          const l = el('div', 'lab-row');
          l.append(el('span', 'lk', k), el('span', 'lv', v));
          lab.append(l);
        });
      if (lab.children.length) {
        col.append(el('div', 'psi-sub', 'Test run'));
        col.append(lab);
      }
      grid.append(col);
    });
    psiOut.append(grid);

    const errs = [m, d].map((r, i) => r.error ? (i ? 'Desktop: ' : 'Mobile: ') + r.error : '')
      .filter(Boolean);
    psiOut.append(el('p', 'gap', errs.length ? errs.join('   ')
      : 'The three metrics above come from real Chrome visitors over the last 28 days. '
        + 'The test run below is a single simulated load, so it usually looks worse.'));

    nPsi.textContent = 'mobile ' + (m.score == null ? '?' : m.score)
      + ' / desktop ' + (d.score == null ? '?' : d.score);
  }

  psiGo.addEventListener('click', async () => {
    const P = window.PULSE;
    if (!P.ctx) return;
    const origin = P.ctx.origin;
    const key = psiKeyEl.value.trim();

    psiGo.disabled = true;
    psiGo.textContent = 'Running, this takes a few seconds…';
    psiOut.replaceChildren(el('p', 'gap', 'Asking Google about ' + origin + '…'));

    try {
      const [mob, desk] = await Promise.all([
        runPsi('mobile', origin, key),
        runPsi('desktop', origin, key)
      ]);
      renderPsi(mob, desk);
    } catch (e) {
      psiOut.replaceChildren(el('p', 'gap', 'PageSpeed request failed: ' + e.message));
    } finally {
      psiGo.disabled = false;
      psiGo.textContent = 'Run again';
    }
  });

  /* ---------------------------------------------------------------- shell */

  /* Switching views must keep the site you are looking at. */
  function syncClassic(host) {
    const back = $('#classic-link');
    if (back && host) back.href = './?s=' + enc(host);
  }

  function status(msg, kind) {
    E.status.textContent = msg;
    E.status.className = kind || '';
    E.status.hidden = false;
    if (kind) setTimeout(() => { E.status.hidden = true; }, 6000);
  }

  function go(host) {
    if (!host) return;
    E.url.value = host;
    history.replaceState(null, '', '?s=' + enc(host));
    syncClassic(host);
    status('Scanning ' + host + '…');
    window.PULSE.run(host);
    setTimeout(() => { E.status.hidden = true; }, 1500);
  }

  E.form.addEventListener('submit', (e) => { e.preventDefault(); go(E.url.value.trim()); });

  /* The box has to hand the payload to the engine itself. pulse.js listens on
     its own hidden textarea and on real paste events, neither of which fires
     for this one, so without this the box silently did nothing. */
  const take = (text) => {
    let data = null;
    try { data = JSON.parse(text); } catch { return false; }
    if (!data || data.wpPulse !== 1) return false;
    status('Pasted from WP Pulse. Reading the data…');
    window.PULSE.applyAdmin(data);
    return true;
  };
  E.drop.addEventListener('input', () => {
    const t = E.drop.value.trim();
    if (t && take(t)) E.drop.value = '';
  });

  /* pulse.js owns the merge; we only need to know it happened. */
  window.PULSE.onRender.push(renderAll);

  /* Recent list on the empty state */
  (function () {
    const all = window.PULSE.readStore();
    Object.keys(all)
      .sort((a, b) => (all[b].at || '').localeCompare(all[a].at || ''))
      .slice(0, 8)
      .forEach(h => {
        const li = el('li');
        li.append(document.createTextNode(h),
          el('span', 'when', String(all[h].at || '').slice(0, 10)));
        li.addEventListener('click', () => go(h));
        E.recent.append(li);
      });
  })();

  const seed = new URLSearchParams(location.search).get('s');
  if (seed) { E.url.value = seed; } else { E.url.focus(); }

})();
