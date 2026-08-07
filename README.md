# WP Pulse

Paste a WordPress URL. Get a ranked list of what is wrong with the site in about a minute.

No accounts, no API keys, no credentials, no database. Static files plus one small proxy.

**Live:** https://dpesofficial.github.io/pulse/

---

## Run it locally

```bash
node server.js
```

Then open <http://localhost:8787>. No `npm install`, no dependencies, Node built-ins only.

## The two halves

**The public scan** needs nothing. It reads the site the way a visitor would, then asks
three free public sources about what it found: `api.wordpress.org` for latest versions,
`wpvulnerability.net` for known security holes with CVSS scores, and Cloudflare DNS.
That answers 9 of the 15 checklist points on any URL, including a prospect's.

**The bookmarklet** covers what only a logged-in admin can see. Drag it once from
`/install.html`, then click it on any wp-admin screen. It reads nine admin pages in
parallel and copies the result; paste it back and the gaps fill in. That takes it to
14 of 15.

It is read-only by construction: every request is a `GET` to a fixed admin page with no
action parameter, and it never submits a form, clicks a button or follows a link. Source
is `collect.js`, unminified. The bookmarklet is built from that exact file at page
load, so what you can read is what runs.

## Two views

| | |
|---|---|
| `/` | Classic. Ranked issues, then site facts. The fast read. |
| `/v2.html` | Dashboard. Security score with visible deductions, plugin table with CVE counts, security headers, scan history, exports, PageSpeed on demand. |

Both render from the same engine, so they cannot disagree about a site's state.

## Configuration

Copy `config.local.example.js` to `config.local.js` and add a free
[PageSpeed Insights](https://developers.google.com/speed/insights/v5/get-started)
API key. That file is gitignored, because a Google key in a public repo is a key anyone
can spend.

For the proxy, deploy `worker.js` as a Cloudflare Worker (free tier, 100k requests
a day) and paste its URL into the app's `⋯` settings. Without it you lose the checks that
need the page HTML: meta, schema, tracking tags, robots, sitemap, security headers.

## What it will not do

- **It never logs in.** Anything behind wp-admin is asked for, never guessed.
- **It never writes.** Every request is a `GET`.
- **It never invents a finding.** If a fetch is blocked, the affected checks say so
  rather than reporting "missing".

## Files

| | |
|---|---|
| `index.html` | Classic view |
| `v2.html` | Dashboard view |
| `pulse.js` | The engine, all checks |
| `pulse-v2.js` | Dashboard renderer |
| `collect.js` | Bookmarklet source |
| `install.html` | Builds the bookmarklet from `collect.js` at page load |
| `server.js` | Local dev server and proxy. Not deployed. |
| `worker.js` | Cloudflare Worker proxy |
