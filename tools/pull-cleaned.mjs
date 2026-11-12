// Mirror an already-cleaned static site, preserving exact URL paths.
// Usage: node pull-cleaned.mjs <origin> <outDir> <pagesJson>
// Check:  node pull-cleaned.mjs --check <localBase> <outDir>
import fs from 'node:fs/promises';
import path from 'node:path';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const ASSET_EXT = /\.(css|js|mjs|json|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|wav|pdf|docx?|xlsx?|pptx?|zip|txt|xml|map|webmanifest)$/i;
const BARE_FILE = /^[\w.+~@%()-]+\.(?:css|js|mjs|json|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|wav|pdf|docx?|xlsx?|pptx?|zip|txt|xml|map|webmanifest)$/i;
const TEXT_EXT = /\.(html|css|js|mjs|json|svg|txt|xml|map)$/i;
const SKIP_PAGE = /^\/(?:wp-admin|wp-login|wp-json|xmlrpc\.php|feed|comments\/feed|cdn-cgi|wp-cron)(?:\/|$)|\/feed\/?$|\/embed\/?$|\/trackback\/?$|\.php$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEnt(s) {
  return s.replace(/&amp;/g, '&').replace(/&#0*38;/g, '&').replace(/&#x2F;/gi, '/').replace(/&quot;/g, '"');
}

function isAssetPath(pathname) {
  if (!pathname || pathname.includes('*') || pathname.endsWith('/')) return false;
  if (SKIP_PAGE.test(pathname)) return false;
  return ASSET_EXT.test(pathname) || pathname.startsWith('/wp-content/') || pathname.startsWith('/wp-includes/') || pathname.startsWith('/_ext/');
}

function dirOf(urlPath) {
  if (urlPath.endsWith('/')) return urlPath;
  const i = urlPath.lastIndexOf('/');
  return urlPath.slice(0, i + 1) || '/';
}

function extract(text, basePath, host, { bare }) {
  const out = [];
  const consider = (raw) => {
    if (!raw) return;
    let s = decodeEnt(String(raw)).trim().replace(/\\\//g, '/');
    if (!s || /^(data:|#|mailto:|tel:|javascript:|blob:)/i.test(s)) return;
    if (BARE_FILE.test(s)) s = dirOf(basePath) + s;
    let u;
    try {
      if (s.startsWith('//')) u = new URL('https:' + s);
      else if (/^https?:/i.test(s)) u = new URL(s);
      else if (s.startsWith('/')) u = new URL(s, 'https://' + host);
      else u = new URL(s, 'https://' + host + dirOf(basePath));
    } catch { return; }
    if (u.host !== host) return;
    let pathname;
    try { pathname = decodeURIComponent(u.pathname); } catch { return; }
    if (!pathname.startsWith('/') || pathname.includes('\0') || pathname.includes('*')) return;
    if (/[${}<>]|\/'|\+/.test(pathname)) return;
    if (pathname.split('/').includes('..')) return;
    pathname = pathname.replace(/\/{2,}/g, '/');
    out.push(pathname);
  };

  for (const m of text.matchAll(/(?:src|href|poster|data-src|data-lazy-src|data-bg|data-background|data-lazyload)\s*=\s*(['"])(.*?)\1/gi)) {
    consider(m[2]);
  }
  for (const m of text.matchAll(/\bcontent\s*=\s*(['"])(.*?)\1/gi)) {
    const v = m[2];
    if (/^(https?:|\/|\.\/|\.\.\/)/i.test(v) || ASSET_EXT.test(v.split(/[?#]/)[0])) consider(v);
  }
  for (const m of text.matchAll(/(?:srcset|data-srcset|imagesrcset)\s*=\s*(['"])(.*?)\1/gi)) {
    for (const part of m[2].split(',')) {
      const u = part.trim().split(/\s+/)[0];
      if (u) consider(u);
    }
  }
  // Case-sensitive so JavaScript `URL(r)` is not treated as a CSS url().
  for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) consider(m[2]);
  for (const m of text.matchAll(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1/gi)) consider(m[2]);
  for (const m of text.matchAll(/["'`]([^"'`\s]{1,240})["'`]/g)) {
    const s = m[1].replace(/\\\//g, '/');
    const looksPath = s.startsWith('/') || s.startsWith('./') || s.startsWith('../') || /^https?:\/\//i.test(s);
    if (looksPath || (bare && BARE_FILE.test(s))) consider(s);
  }
  return out;
}

async function fetchBuf(url) {
  let last = { status: 0, ct: '', buf: null, finalUrl: url, error: 'no response' };
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'es-MX,es;q=0.9' }, redirect: 'follow' });
      if (r.status === 429 || r.status >= 500) {
        last = { status: r.status, ct: '', buf: null, finalUrl: r.url, error: String(r.status) };
        await sleep(700 * (i + 1));
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      return { status: r.status, ct: r.headers.get('content-type') || '', buf, finalUrl: r.url, error: '' };
    } catch (e) {
      last = { status: 0, ct: '', buf: null, finalUrl: url, error: e.message };
      await sleep(500 * (i + 1));
    }
  }
  return last;
}

function inside(root, dest) {
  const resolved = path.resolve(dest);
  return resolved === root || resolved.startsWith(root + path.sep);
}

async function mirror(originArg, outDir, pagesJson) {
  const origin = new URL(originArg).origin;
  const host = new URL(origin).host;
  const pub = path.join(outDir, 'public');
  await fs.mkdir(pub, { recursive: true });
  const reportIn = JSON.parse(await fs.readFile(pagesJson, 'utf8'));
  const pageList = reportIn.pageList || reportIn;
  const q = [];
  const seen = new Set();
  const stats = { pages: 0, assets: 0, bytes: 0, savedPages: [], failedPages: [], failedAssets: [], large: [] };

  function enqueue(pathname, kind) {
    if (!pathname || pathname.includes('*')) return;
    if (kind === 'page') {
      if (SKIP_PAGE.test(pathname) || isAssetPath(pathname)) return;
      if (pathname !== '/' && !pathname.endsWith('/')) pathname += '/';
    } else if (!isAssetPath(pathname) && pathname !== '/robots.txt') return;
    const key = kind + ':' + pathname;
    if (seen.has(key)) return;
    seen.add(key);
    q.push({ pathname, kind });
  }

  function destFor(pathname, kind) {
    const rel = pathname.replace(/^\/+/, '');
    const dest = kind === 'page'
      ? (pathname === '/' ? path.join(pub, 'index.html') : path.join(pub, rel.replace(/\/$/, ''), 'index.html'))
      : path.join(pub, rel);
    if (!inside(pub, dest)) throw new Error('path escape ' + pathname);
    return dest;
  }

  function absorb(text, basePath, allowPages, bare) {
    for (const p of extract(text, basePath, host, { bare })) {
      if (p.length > 300 || p.includes('*')) continue;
      if (isAssetPath(p) || p === '/robots.txt') enqueue(p, 'asset');
      else if (allowPages && !p.startsWith('/wp-content') && !p.startsWith('/wp-includes') && !p.startsWith('/_ext') && !SKIP_PAGE.test(p) && !ASSET_EXT.test(p)) enqueue(p, 'page');
    }
    // Elementor loads some libraries as `${assets}lib/...${'.min'}.js` only after boot.
    const assets = '/wp-content/plugins/elementor/assets/';
    for (const m of text.matchAll(/\$\{n\}([^"'`\s$]+?)\$\{r\}(\.[a-z0-9]+)/g)) enqueue(assets + m[1] + '.min' + m[2], 'asset');
    if (text.includes('custom-lightbox.min.css')) enqueue('/wp-content/uploads/elementor/css/custom-lightbox.min.css', 'asset');
  }

  for (const p of pageList) enqueue(p, 'page');
  enqueue('/robots.txt', 'asset');

  let active = 0;
  async function processItem(item) {
    const url = origin + (item.pathname === '/' ? '/' : item.pathname);
    const res = await fetchBuf(url);
    if (!res.buf || res.status !== 200) {
      const line = `${res.status || res.error} ${item.pathname}`;
      if (item.kind === 'page') stats.failedPages.push(line);
      else stats.failedAssets.push(line);
      console.log('FAIL', item.kind, line);
      return;
    }
    if (item.kind === 'asset' && /text\/html/i.test(res.ct)) {
      stats.failedAssets.push(`html ${item.pathname}`);
      console.log('FAIL asset html', item.pathname);
      return;
    }
    if (item.kind === 'page' && !/html/i.test(res.ct)) {
      stats.failedPages.push(`not-html ${item.pathname}`);
      console.log('FAIL page type', item.pathname, res.ct);
      return;
    }
    let buf = res.buf;
    if (item.kind === 'page') {
      let html = buf.toString('utf8');
      if (!/noindex/i.test(html)) {
        html = html.replace(/<head([^>]*)>/i, '<head$1>\n<meta name="robots" content="noindex,nofollow">');
        buf = Buffer.from(html);
      }
    }
    if (item.pathname === '/robots.txt' && !/Disallow:\s*\//i.test(buf.toString('utf8'))) {
      buf = Buffer.from('User-agent: *\nDisallow: /\n');
    }
    const dest = destFor(item.pathname, item.kind);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf);
    stats.bytes += buf.length;
    if (buf.length >= 100 * 1024 * 1024) stats.large.push({ path: item.pathname, bytes: buf.length });
    if (item.kind === 'page') {
      stats.pages++;
      stats.savedPages.push(item.pathname);
      console.log(`[page ${stats.pages}] ${item.pathname} ${buf.length}`);
      absorb(buf.toString('utf8'), item.pathname, true, false);
    } else {
      stats.assets++;
      if (stats.assets % 25 === 0 || buf.length > 5_000_000) console.log(`[asset ${stats.assets}] ${item.pathname} ${buf.length}`);
      if (TEXT_EXT.test(item.pathname) && buf.length < 20_000_000) {
        const bare = /\.(css|js|mjs|json)$/i.test(item.pathname);
        absorb(buf.toString('utf8'), item.pathname, false, bare);
      }
    }
  }

  while (q.length || active) {
    while (active < 6 && q.length) {
      const item = q.shift();
      active++;
      processItem(item).catch((e) => {
        stats.failedAssets.push(`ERR ${item.pathname} ${e.message}`);
        console.log('ERR', item.pathname, e.message);
      }).finally(() => { active--; });
    }
    await sleep(40);
  }

  const report = {
    origin,
    source: origin,
    date: new Date().toISOString(),
    pages: stats.pages,
    assets: stats.assets,
    bytes: stats.bytes,
    pageList: stats.savedPages,
    requestedPages: pageList,
    failedPages: stats.failedPages,
    failedAssets: stats.failedAssets,
    filesOver100MB: stats.large,
  };
  await fs.writeFile(path.join(outDir, 'mirror-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('DONE pages', stats.pages, 'assets', stats.assets, 'MB', (stats.bytes / 1e6).toFixed(1), 'failedPages', stats.failedPages.length, 'failedAssets', stats.failedAssets.length);
}

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

async function check(base, outDir) {
  const pub = path.join(outDir, 'public');
  const host = new URL(base).host;
  const report = JSON.parse(await fs.readFile(path.join(outDir, 'mirror-report.json'), 'utf8'));
  const pages = report.requestedPages || report.pageList;
  const badPages = [];
  await Promise.all(pages.map(async (p) => {
    const r = await fetch(base.replace(/\/$/, '') + p);
    const html = await r.text();
    const noindex = /noindex/i.test(html);
    if (r.status !== 200 || !noindex) badPages.push(`${r.status} noindex=${noindex} ${p}`);
  }));
  const files = (await walk(pub)).filter((f) => TEXT_EXT.test(f));
  const assets = new Set();
  for (const f of files) {
    const rel = '/' + path.relative(pub, f).split(path.sep).join('/');
    const basePath = rel.endsWith('/index.html') ? rel.slice(0, -'index.html'.length) : rel;
    const text = await fs.readFile(f, 'utf8');
    for (const p of extract(text, basePath, host, { bare: false })) {
      if ((p === '/robots.txt' || isAssetPath(p)) && !p.includes('*') && p.length <= 300) assets.add(p);
    }
  }
  const list = [...assets];
  const badAssets = [];
  let i = 0;
  async function one(p) {
    const r = await fetch(base.replace(/\/$/, '') + encodeURI(p));
    if (r.status !== 200) badAssets.push(`${r.status} ${p}`);
    await r.arrayBuffer();
  }
  const workers = Array.from({ length: 12 }, async () => {
    while (i < list.length) await one(list[i++]);
  });
  await Promise.all(workers);
  const robots = await fetch(base.replace(/\/$/, '') + '/robots.txt');
  const robotsBody = await robots.text();
  console.log(JSON.stringify({
    pages: pages.length,
    badPages,
    assetsChecked: list.length,
    badAssets,
    robotsStatus: robots.status,
    robotsDisallow: /Disallow:\s*\//.test(robotsBody),
  }, null, 2));
  if (badPages.length || badAssets.length || robots.status !== 200) process.exitCode = 1;
}

const [,, a, b, c] = process.argv;
if (a === '--check') await check(b, path.resolve(c));
else await mirror(a, path.resolve(b), path.resolve(c));
