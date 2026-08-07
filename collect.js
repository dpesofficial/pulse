/* WP Pulse — wp-admin collector (bookmarklet source)
   ---------------------------------------------------------------------------
   Runs INSIDE a wp-admin page, in that site's own origin, using the session
   you are already logged into. That is the only reason it can read anything:
   same-origin policy is on our side when the code is already inside.

   Launchable from ANY /wp-admin/* page. It fetches every screen it needs in
   parallel and never navigates, never reloads.

   READ ONLY. This is a hard rule, not a preference:
     - every request is method GET
     - only fixed, plain admin page URLs, never an ?action= URL
     - no form is submitted, no button is clicked, no link is followed
     - nothing is written to the site, its database, or its options
   It collects, shows you what it found, and puts it on your clipboard.
   --------------------------------------------------------------------------- */

(function () {
  'use strict';

  /* Bump whenever the payload shape or a parser changes. A bookmarklet is a
     snapshot taken when you dragged it, so an old one keeps producing old bugs
     silently. Pulse refuses a payload older than it expects. */
  const BM_VERSION = 4;

  /* Fixed list, built here and never read off the page, so a broken or hostile
     admin screen cannot talk us into requesting an action URL. */
  const PAGES = {
    health:  '/wp-admin/site-health.php?tab=debug',
    updates: '/wp-admin/update-core.php',
    plugins: '/wp-admin/plugins.php',
    themes:  '/wp-admin/themes.php',
    users:   '/wp-admin/users.php',
    posts:   '/wp-admin/edit.php',
    pages:   '/wp-admin/edit.php?post_type=page',
    media:   '/wp-admin/upload.php?mode=list',
    spam:    '/wp-admin/edit-comments.php?comment_status=spam'
  };

  /* Slug -> label. Derived from the plugin list, so it costs no extra request. */
  const MAJOR = {
    'woocommerce': 'WooCommerce',
    'elementor': 'Elementor', 'elementor-pro': 'Elementor Pro',
    'advanced-custom-fields': 'ACF', 'advanced-custom-fields-pro': 'ACF Pro',
    'seo-by-rank-math': 'Rank Math', 'seo-by-rank-math-pro': 'Rank Math Pro',
    'wordpress-seo': 'Yoast SEO', 'wordpress-seo-premium': 'Yoast SEO Premium',
    'litespeed-cache': 'LiteSpeed Cache',
    'wp-rocket': 'WP Rocket',
    'wordfence': 'Wordfence',
    'contact-form-7': 'Contact Form 7',
    'gravityforms': 'Gravity Forms',
    'fluentform': 'Fluent Forms',
    'jet-engine': 'JetEngine',
    'sitepress-multilingual-cms': 'WPML', 'wpml-string-translation': 'WPML',
    'polylang': 'Polylang', 'polylang-pro': 'Polylang Pro',
    'redis-cache': 'Redis Object Cache'
  };

  const root = location.origin;
  if (!/\/wp-admin\//.test(location.pathname)) {
    return panel('Not a wp-admin page', 'Open any wp-admin screen and click again.');
  }

  const box = panel('Reading…', 'Fetching admin screens in parallel.');

  /* ---------------------------------------------------------------- fetch -- */

  /* Never throws. A missing capability, a 403, or a bounce to the login screen
     resolves to null and the rest of the run carries on without it. */
  async function page(path) {
    try {
      const r = await fetch(root + path, {
        method: 'GET',                 // never anything else
        credentials: 'same-origin',
        redirect: 'follow',
        headers: { 'accept': 'text/html' }
      });
      if (!r.ok) return null;
      const html = await r.text();
      if (/wp-login\.php|id=["']loginform["']/.test(html.slice(0, 3000))) return null;
      return new DOMParser().parseFromString(html, 'text/html');
    } catch { return null; }
  }

  const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');

  /* -------------------------------------------------------------- parsers -- */

  /* Core version is printed in the admin footer of every admin page, so we have
     it from the page we are standing on without fetching anything. */
  function core(doc) {
    const m = txt(doc.querySelector('#footer-upgrade')).match(/([\d.]+)/);
    return m ? m[1] : '';
  }

  function coreUpdate(doc) {
    if (!doc) return null;
    const t = txt(doc.querySelector('.core-updates'));
    if (/latest version of WordPress/i.test(t)) return null;
    const m = t.match(/version\s+([\d.]+)/i);
    return m ? m[1] : null;
  }

  /* update-core.php lists theme updates that the themes.php grid can miss. */
  function themeUpdateCount(doc) {
    if (!doc) return 0;
    return doc.querySelectorAll('#update-themes-table input[name="checked[]"]').length;
  }

  function plugins(doc) {
    if (!doc) return [];
    const out = [];
    const seen = new Set();
    /* The update-notice row carries data-plugin, data-slug AND the "active"
       class, exactly like the plugin row above it. Counting it inflates both
       the total and the active count by the number of pending updates. */
    doc.querySelectorAll('#the-list tr[data-plugin]:not(.plugin-update-tr)').forEach(tr => {
      const file = tr.getAttribute('data-plugin');
      if (seen.has(file)) return;
      seen.add(file);

      const slug = tr.getAttribute('data-slug') || (file || '').split('/')[0];
      const name = txt(tr.querySelector('.plugin-title strong')) || slug;
      const meta = txt(tr.querySelector('.plugin-version-author-uri'));
      const ver = (meta.match(/Version\s+([\w.\-+]+)/i) || [])[1] || '';

      /* Two traps here. The copy reads "There is a new version of X available.
         View version 6.8.7 details", so a loose match captures "of". And
         plugins inject licence and compatibility notices into the same row
         type, so the row existing does not mean an update exists. */
      let update = null;
      const next = tr.nextElementSibling;
      if (next && next.classList.contains('plugin-update-tr')) {
        const msg = txt(next.querySelector('.update-message, .notice')) || txt(next);
        if (/new version/i.test(msg)) {
          update = (msg.match(/View version\s+([\d][\w.\-+]*)/i)
            || msg.match(/version\s+([\d][\w.\-+]*)\s+details/i)
            || msg.match(/\bversion\s+([\d][\w.\-+]*)/i) || [])[1] || 'available';
        }
      }

      out.push({
        slug, name, version: ver, update,
        active: tr.classList.contains('active'),
        autoUpdate: /Disable auto-updates/i.test(txt(tr.querySelector('.column-auto-updates')))
      });
    });
    return out;
  }

  function themes(doc) {
    if (!doc) return [];
    /* themes.php ships its data as a JS object, far more reliable than
       scraping the grid. Fall back to the DOM if the shape changes. */
    const script = [...doc.querySelectorAll('script')]
      .map(s => s.textContent).find(t => t && t.indexOf('_wpThemeSettings') > -1);
    if (script) {
      const m = script.match(/"themes"\s*:\s*(\[[\s\S]*?\])\s*,\s*"settings"/)
        || script.match(/themes\s*:\s*(\[[\s\S]*?\])\s*,\s*settings/);
      if (m) {
        try {
          return JSON.parse(m[1]).map(t => ({
            slug: t.id, name: t.name, version: t.version, parent: t.parent || null,
            active: !!t.active, update: t.hasUpdate ? (t.update || 'available') : null
          }));
        } catch { /* fall through */ }
      }
    }
    return [...doc.querySelectorAll('.theme')].map(el => ({
      slug: el.getAttribute('data-slug') || '',
      name: txt(el.querySelector('.theme-name')),
      version: txt(el.querySelector('.theme-version')),
      active: el.classList.contains('active'),
      update: el.querySelector('.update-message') ? 'available' : null
    })).filter(t => t.slug);
  }

  /* The list-table subnav carries counts per status, e.g. "Administrator (2)". */
  function counts(doc) {
    const out = {};
    if (!doc) return out;
    doc.querySelectorAll('.subsubsub li').forEach(li => {
      const m = txt(li).match(/^(.+?)\s*\((\d[\d,]*)\)/);
      if (m) out[m[1].toLowerCase().replace(/\s+/g, '_')] = parseInt(m[2].replace(/,/g, ''), 10);
    });
    return out;
  }

  /* "1,519 items" in the table nav. More reliable than subsubsub for media. */
  function total(doc) {
    if (!doc) return null;
    const n = txt(doc.querySelector('.displaying-num')).match(/([\d,]+)/);
    if (n) return parseInt(n[1].replace(/,/g, ''), 10);
    const all = counts(doc);
    return all.all != null ? all.all : (all.mine != null ? all.mine : null);
  }

  /* Site Health's debug tab is one flat set of label/value rows spread across
     its accordion sections. Labels shift between WordPress versions and
     translations, so match loosely, and report what was seen when a lookup
     misses so a blank is diagnosable instead of mysterious. */
  function health(doc) {
    if (!doc) return { rows: {}, reason: 'site-health.php did not load (permission, or removed by a plugin)', sample: [] };

    const rows = {};
    const put = (k, v) => {
      k = String(k).toLowerCase().replace(/\s*:$/, '').trim();
      if (k && v) rows[k] = v;
    };

    const scoped = doc.querySelectorAll(
      '.health-check-table tr, #health-check-debug tr, .health-check-accordion tr');
    (scoped.length ? scoped : doc.querySelectorAll('tr')).forEach(tr => {
      const cells = tr.querySelectorAll('td, th');
      if (cells.length >= 2) put(txt(cells[0]), txt(cells[1]));
    });

    /* Some builds render the same information as definition lists. */
    doc.querySelectorAll('dl').forEach(dl => {
      const dts = dl.querySelectorAll('dt'), dds = dl.querySelectorAll('dd');
      for (let i = 0; i < Math.min(dts.length, dds.length); i++) put(txt(dts[i]), txt(dds[i]));
    });

    const n = Object.keys(rows).length;
    return {
      rows,
      reason: n ? '' : 'debug tab loaded but had no label/value rows',
      sample: Object.keys(rows).slice(0, 12)
    };
  }

  const pick = (rows, ...wants) => {
    /* Exact first. Otherwise 'wp_debug' matches 'wp_debug_log' and reports the
       wrong constant, and every fuzzy lookup becomes a coin toss. */
    for (const w of wants) if (rows[w]) return rows[w];
    for (const w of wants) {
      const k = Object.keys(rows).find(k => k.indexOf(w) > -1);
      if (k && rows[k]) return rows[k];
    }
    return '';
  };
  const num = (v) => (String(v).match(/[\d][\d.]*/) || [''])[0];

  /* ------------------------------------------------------------------ run -- */

  (async function () {
    const keys = Object.keys(PAGES);
    /* Parallel. page() never rejects, so one failed screen cannot stop the rest. */
    const docs = await Promise.all(keys.map(k => page(PAGES[k])));
    const D = {};
    keys.forEach((k, i) => { D[k] = docs[i]; });

    const h = health(D.health);
    const R = h.rows;

    const pluginList = plugins(D.plugins);
    const pluginCounts = counts(D.plugins);
    const themeList = themes(D.themes);
    const userCounts = counts(D.users);
    const activeTheme = themeList.find(t => t.active) || null;

    const major = [];
    const seenMajor = new Set();
    pluginList.forEach(p => {
      const label = MAJOR[p.slug];
      if (label && !seenMajor.has(label)) { seenMajor.add(label); major.push(label); }
    });

    const pluginUpdates = pluginList.filter(p => p.update).length;
    const themeUpdates = themeList.filter(t => t.update).length || themeUpdateCount(D.updates);
    const coreUp = coreUpdate(D.updates);

    const data = {
      wpPulse: 1,
      v: BM_VERSION,
      site: root,
      collected: new Date().toISOString(),

      core: { version: core(document), update: coreUp },

      /* Flat php/db kept for older readers; the detail lives in server{}. */
      php: num(pick(R, 'php version')),
      db: pick(R, 'server version', 'database version', 'mysql version'),

      server: {
        php: num(pick(R, 'php version')),
        phpSapi: pick(R, 'php sapi'),
        database: pick(R, 'server version', 'database version', 'mysql version'),
        databaseExt: pick(R, 'extension'),
        software: pick(R, 'web server', 'httpd software', 'server architecture'),
        curl: pick(R, 'curl version'),
        https: pick(R, 'is this site using https', 'https status',
          'is the connection to wordpress.org secure'),
        timezone: pick(R, 'timezone'),
        language: pick(R, 'site language', 'user language')
      },

      limits: {
        phpMemory: pick(R, 'php memory limit'),
        wpMemory: pick(R, 'wp_memory_limit'),
        maxUpload: pick(R, 'max size of an uploaded file', 'upload_max_filesize'),
        postMax: pick(R, 'php post max size', 'post_max_size'),
        timeLimit: pick(R, 'php time limit', 'max_execution_time'),
        inputVars: pick(R, 'php max input variables')
      },

      status: {
        objectCache: pick(R, 'persistent object cache', 'object cache')
          || (major.includes('Redis Object Cache') ? 'Redis Object Cache plugin active' : ''),
        opcache: pick(R, 'opcache'),
        cron: pick(R, 'disable_wp_cron'),
        permalinks: pick(R, 'permalink structure'),
        multisite: pick(R, 'is this a multisite'),
        registration: pick(R, 'can anyone register')
      },

      constants: {
        WP_DEBUG: pick(R, 'wp_debug'),
        WP_DEBUG_LOG: pick(R, 'wp_debug_log'),
        WP_DEBUG_DISPLAY: pick(R, 'wp_debug_display'),
        SCRIPT_DEBUG: pick(R, 'script_debug'),
        WP_CACHE: pick(R, 'wp_cache'),
        WP_ENVIRONMENT_TYPE: pick(R, 'environment type', 'wp_environment_type')
      },

      plugins: pluginList,
      pluginCounts: pluginCounts,
      themes: themeList,
      activeTheme: activeTheme,
      major: major,

      updates: {
        core: coreUp,
        plugins: pluginUpdates,
        themes: themeUpdates,
        total: (coreUp ? 1 : 0) + pluginUpdates + themeUpdates
      },

      content: {
        posts: total(D.posts),
        pages: total(D.pages),
        media: total(D.media),
        users: userCounts.all != null ? userCounts.all : null
      },

      users: userCounts,
      spam: counts(D.spam).spam || 0,

      /* So a blank is explainable rather than mysterious. */
      diag: {
        healthReason: h.reason,
        healthRows: Object.keys(R).length,
        healthSample: h.sample,
        failed: keys.filter(k => !D[k])
      }
    };

    const json = JSON.stringify(data);
    const copied = await copy(json);

    const c = data.content;
    box.show([
      ['core', data.core.version + (coreUp ? '  → ' + coreUp : '')],
      ['php', data.server.php || '—'],
      ['database', data.server.database || '—'],
      ['plugins', (pluginCounts.all != null ? pluginCounts.all : pluginList.length)
        + (pluginCounts.active != null ? '  ' + pluginCounts.active + ' active' : '')
        + (pluginCounts['must-use'] ? '  +' + pluginCounts['must-use'] + ' mu' : '')],
      ['themes', themeList.length + (activeTheme ? '  ' + activeTheme.name : '')],
      ['updates', data.updates.total],
      ['content', [c.posts, c.pages, c.media].map(v => v == null ? '?' : v).join(' / ')],
      ['users', (userCounts.all || 0)
        + (userCounts.administrator ? '  ' + userCounts.administrator + ' admin' : '')]
    ], copied
      ? 'Copied. Paste into the WP Pulse app.'
      : 'Could not copy. Select the text below and copy it.',
      copied ? '' : json,
      data.diag);
  })();

  /* ------------------------------------------------------------ clipboard -- */

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }

  /* ---------------------------------------------------------------- panel -- */

  function panel(title, note) {
    document.getElementById('wp-pulse-panel')?.remove();

    const d = document.createElement('div');
    d.id = 'wp-pulse-panel';
    /* Material green surface. White on green so it reads at a glance and is
       impossible to mistake for one of wp-admin's own grey notices. */
    d.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'right:20px', 'bottom:20px',
      'width:340px', 'padding:18px 20px',
      'background:#1e7d38', 'color:#fff',
      'border:0', 'border-radius:8px',
      'box-shadow:0 8px 28px rgba(0,0,0,.28)',
      'font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
    ].join(';');

    d.innerHTML = '<div id="wp-pulse-head" style="font-size:12px;letter-spacing:.09em;'
      + 'text-transform:uppercase;color:rgba(255,255,255,.75);margin-bottom:12px;'
      + 'font-weight:600">WP Pulse</div>'
      + '<div id="wp-pulse-body">' + esc(title) + '</div>'
      + '<div id="wp-pulse-note" style="margin-top:12px;padding-top:10px;font-size:13px;'
      + 'border-top:1px solid rgba(255,255,255,.22);color:rgba(255,255,255,.9)">'
      + esc(note) + '</div>';

    document.body.appendChild(d);
    setTimeout(() => d.addEventListener('click', () => d.remove()), 300);

    return {
      show(pairs, note2, raw, diag) {
        d.querySelector('#wp-pulse-body').innerHTML = pairs.map(([k, v]) =>
          '<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0">'
          + '<span style="color:rgba(255,255,255,.8)">' + esc(k) + '</span>'
          + '<span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;'
          + 'font-weight:600;text-align:right">' + esc(String(v)) + '</span></div>').join('');

        const ok = !raw;
        if (ok) d.querySelector('#wp-pulse-head').innerHTML = '&#10003; WP PULSE';
        else d.style.background = '#8c2f28';   // same card, failure state

        const n = d.querySelector('#wp-pulse-note');
        n.textContent = note2;
        n.style.fontWeight = '600';

        /* Only surface diagnostics when something actually went missing. */
        if (diag && (diag.healthReason || (diag.failed || []).length)) {
          const w = document.createElement('div');
          w.style.cssText = 'margin-top:8px;font-size:12px;line-height:1.5;'
            + 'color:rgba(255,255,255,.8);font-weight:400';
          w.textContent = [diag.healthReason,
            (diag.failed || []).length ? 'could not read: ' + diag.failed.join(', ') : '']
            .filter(Boolean).join(' · ');
          d.appendChild(w);
        }

        if (raw) {
          const t = document.createElement('textarea');
          t.value = raw;
          t.style.cssText = 'width:100%;height:70px;margin-top:8px;font-size:11px';
          d.appendChild(t);
          t.select();
        }
        setTimeout(() => d.remove(), raw ? 60000 : 12000);
      }
    };
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
})();
