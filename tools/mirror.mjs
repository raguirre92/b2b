// Node.js website mirror: crawl same-origin pages, download assets, rewrite URLs to local paths.
// Usage: node mirror.mjs <origin> <outDir> <pageStyle:html|dir>
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';

const [,, ORIGIN_ARG, OUT, PAGE_STYLE = 'dir'] = process.argv;
const ORIGIN = new URL(ORIGIN_ARG).origin;
const HOST = new URL(ORIGIN).host;
const PUB = path.join(OUT, 'public');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const ASSET_EXT = /\.(css|js|mjs|json|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|wav|pdf|docx?|xlsx?|pptx?|zip|txt|xml|map)$/i;
const ASSET_HOSTS = new Set(['assets.zyrosite.com', 'cdn.zyrosite.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 's.w.org', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'secure.gravatar.com', 'i0.wp.com', 'i1.wp.com', 'i2.wp.com']);
const SKIP_HOSTS = new Set(['use.typekit.net', 'p.typekit.net', 'www.googletagmanager.com', 'www.google-analytics.com', 'www.youtube.com', 'youtube.com', 'player.vimeo.com', 'www.google.com', 'maps.googleapis.com', 'connect.facebook.net', 'schema.org', 'www.w3.org', 'yoast.com', 'gmpg.org', 'api.w.org', 'ogp.me']);
const SKIP_PAGE = /^\/(wp-admin|wp-login|wp-json|xmlrpc|feed|comments\/feed|cdn-cgi|wp-cron)|\/feed\/?$|\/embed\/?$|\/trackback\/?$/;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stats = { pages: 0, assets: 0, failed: [], bytes: 0 };
const pageQueue = []; const seenPages = new Set();
const assetMap = new Map(); // remote abs url -> local path (promise)
const failedAssets = new Set();

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'es-MX,es;q=0.9', 'Referer': ORIGIN + '/' }, redirect: 'follow' });
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      return r;
    } catch (e) { await sleep(1000 * (i + 1)); }
  }
  return null;
}

// simple concurrency limiter
let active = 0; const waiters = [];
async function limit(fn) {
  while (active >= 4) await new Promise(r => waiters.push(r));
  active++;
  try { await sleep(120); return await fn(); } finally { active--; waiters.shift()?.(); }
}

function decodeEnt(s) { return s.replace(/&amp;/g, '&').replace(/&#038;/g, '&').replace(/&#x2F;/g, '/').replace(/&quot;|&#34;|&#039;|&#39;/g, '').replace(/^['"]|['"]$/g, ''); }

function localPathFor(u) {
  const url = new URL(u);
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index';
  let ext = path.extname(p);
  if (url.host !== HOST) p = `/_ext/${url.host}${p}`;
  if (url.search && (url.host !== HOST || !ext)) {
    const h = crypto.createHash('md5').update(url.search).digest('hex').slice(0, 10);
    p = ext ? p.slice(0, -ext.length) + '__' + h + ext : p + '__' + h;
  }
  return p;
}

function isAssetUrl(url) {
  if (SKIP_HOSTS.has(url.host)) return false;
  if (url.host === HOST) return ASSET_EXT.test(url.pathname) || url.pathname.startsWith('/wp-content/') || url.pathname.startsWith('/wp-includes/') || /^\/_astro/.test(url.pathname);
  return ASSET_HOSTS.has(url.host) || ASSET_EXT.test(url.pathname);
}

async function writeFile(local, buf) {
  const fp = path.join(PUB, local);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, buf);
}

// Returns local reference (path string) for an absolute asset URL, downloading if needed.
function asset(abs) {
  if (assetMap.has(abs)) return assetMap.get(abs);
  const pr = (async () => {
    const r = await limit(() => get(abs));
    if (!r || !r.ok) { failedAssets.add(`${r ? r.status : 'ERR'} ${abs}`); return null; }
    let local = localPathFor(abs);
    const ct = r.headers.get('content-type') || '';
    if (!path.extname(local)) {
      if (ct.includes('css')) local += '.css'; else if (ct.includes('javascript')) local += '.js';
      else if (ct.includes('font/woff2')) local += '.woff2'; else if (ct.includes('svg')) local += '.svg';
      else if (ct.includes('png')) local += '.png'; else if (ct.includes('jpeg')) local += '.jpg'; else if (ct.includes('webp')) local += '.webp';
    }
    // zyro cdn-cgi/image paths contain commas/equals; keep but they are valid file names
    let buf = Buffer.from(await r.arrayBuffer());
    if (ct.includes('text/css') || local.endsWith('.css')) buf = Buffer.from(await rewriteCss(buf.toString('utf8'), r.url || abs));
    else if (/\.m?js$/.test(local) && new URL(abs).host === HOST) {
      const js = buf.toString('utf8');
      for (const m of js.matchAll(/["'`](\.{1,2}\/[^"'`\s]+?\.(?:m?js|css))["'`]/g)) { try { asset(new URL(m[1], abs).href); } catch {} }
      for (const m of js.matchAll(/["'`](\/[A-Za-z0-9_\-.\/]+?\.(?:m?js|css))["'`]/g)) { try { asset(new URL(m[1], abs).href); } catch {} }
    }
    await writeFile(local, buf);
    stats.assets++; stats.bytes += buf.length;
    return local;
  })();
  assetMap.set(abs, pr);
  return pr;
}

async function rewriteCss(css, base) {
  const refs = new Set();
  css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => { refs.add(u); return m; });
  css.replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, u) => { refs.add(u); return m; });
  const map = {};
  await Promise.all([...refs].map(async u => {
    if (/^(data:|#|about:)/.test(u)) return;
    let abs; try { abs = new URL(decodeEnt(u), base); } catch { return; }
    if (!/^https?:$/.test(abs.protocol) || SKIP_HOSTS.has(abs.host)) return;
    const hash = abs.hash; abs.hash = '';
    const loc = await asset(abs.href);
    if (loc) map[u] = encodeLocal(loc) + hash;
  }));
  css = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => map[u] ? `url("${map[u]}")` : m);
  css = css.replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, u) => map[u] ? `@import "${map[u]}"` : m);
  return css;
}

function encodeLocal(p) { return p.split('/').map(s => encodeURIComponent(s).replace(/%2C/g, ',').replace(/%3D/g, '=')).join('/'); }

function pageFile(pathname) {
  let p = decodeURIComponent(pathname);
  if (p === '/' || p === '') return '/index.html';
  if (PAGE_STYLE === 'html') return p.replace(/\/$/, '') + '.html';
  return (p.endsWith('/') ? p : p + '/') + 'index.html';
}

function enqueuePage(href, base) {
  let u; try { u = new URL(decodeEnt(href), base); } catch { return; }
  if (u.host !== HOST && u.host !== 'www.' + HOST) return;
  if (!/^https?:$/.test(u.protocol)) return;
  if (u.search || SKIP_PAGE.test(u.pathname) || ASSET_EXT.test(u.pathname) || u.pathname.startsWith('/wp-content/')) return;
  const key = u.pathname;
  if (seenPages.has(key)) return;
  seenPages.add(key); pageQueue.push(ORIGIN + key);
}

async function processPage(url) {
  const r = await limit(() => get(url));
  if (!r) { stats.failed.push(`ERR page ${url}`); return; }
  const finalUrl = new URL(r.url || url);
  if (!r.ok) { stats.failed.push(`${r.status} page ${url}`); return; }
  if (!(r.headers.get('content-type') || '').includes('html')) return;
  if (finalUrl.host !== HOST) return;
  let html = await r.text();
  const $ = cheerio.load(html, { decodeEntities: false });
  $('a[href]').each((_, a) => enqueuePage($(a).attr('href'), finalUrl));

  // Collect candidate asset URLs from attributes (handles relative paths)
  const cands = new Set();
  const addSrcset = v => v.split(/,\s+/).forEach(part => { const u = part.trim().split(/\s+/)[0]; if (u) cands.add(u); });
  $('[src],[href],[srcset],[data-src],[data-srcset],[data-lazy-src],[data-bg],[poster],[data-background]').each((_, el) => {
    const $el = $(el);
    for (const at of ['src', 'data-src', 'data-lazy-src', 'data-bg', 'poster', 'data-background']) { const v = $el.attr(at); if (v) cands.add(v); }
    for (const at of ['srcset', 'data-srcset', 'imagesrcset']) { const v = $el.attr(at); if (v) addSrcset(v); }
    if (el.tagName === 'link' || el.tagName === 'script') { const v = $el.attr('href'); if (v) cands.add(v); }
    if (el.tagName === 'a') { const v = $el.attr('href'); if (v && ASSET_EXT.test(v.split(/[?#]/)[0]) && !/\.(html?|php)$/i.test(v)) cands.add(v); }
  });
  // absolute URLs anywhere in text (inline JSON, styles)
  for (const m of html.matchAll(/https?:\/\/(?:(?!&quot;|&#34;|&#039;)[^\s"'<>()`\\])+/g)) cands.add(m[0].replace(/[,;]+$/, ''));
  for (const m of html.matchAll(/(?<=["'=(\s,;])\/(?![\/\\])[A-Za-z0-9_\-.\/%~@]+\.(?:js|mjs|css|png|jpe?g|gif|webp|svg|woff2?|ttf|ico|pdf|mp4)(?=[?"'\s)#,&])/g)) cands.add(m[0]);
  for (const m of html.matchAll(/https?:(?:\\\/){2}(?:[^\s"'<>()`\\]|\\\/)+/g)) cands.add(m[0]);
  for (const m of html.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) cands.add(m[2]);

  const repl = new Map();
  await Promise.all([...cands].map(async raw => {
    const escaped = raw.includes('\\/');
    let s = decodeEnt(escaped ? raw.replace(/\\\//g, '/') : raw);
    if (/^(data:|#|mailto:|tel:|javascript:)/.test(s)) return;
    let abs; try { abs = new URL(s, finalUrl); } catch { return; }
    if (!/^https?:$/.test(abs.protocol)) return;
    if (abs.host === 'www.' + HOST) abs.host = HOST;
    abs.hash = '';
    if (!isAssetUrl(abs)) return;
    const loc = await asset(abs.href);
    if (!loc) return;
    let ref = encodeLocal(loc);
    if (escaped) ref = ref.replace(/\//g, '\\/');
    repl.set(raw, ref);
  }));
  // replace longest first to avoid partial overlaps
  const keys = [...repl.keys()].sort((a, b) => b.length - a.length);
  for (const k of keys) html = html.split(k).join(repl.get(k));
  // remaining same-origin absolute URLs (page links) -> root-relative
  for (const o of [ORIGIN, 'http://' + HOST, 'https://www.' + HOST, 'http://www.' + HOST]) {
    html = html.split(o + '/').join('/').split(o + '"').join('/"');
    const esc = o.replace(/\//g, '\\/');
    html = html.split(esc + '\\/').join('\\/').split(esc + '"').join('\\/"');
  }
  // noindex
  html = html.replace(/<meta[^>]+name=["']robots["'][^>]*>/gi, '');
  html = html.replace(/<head([^>]*)>/i, `<head$1>\n<meta name="robots" content="noindex,nofollow">`);
  await writeFile(pageFile(finalUrl.pathname), Buffer.from(html));
  stats.pages++;
  console.log(`[page ${stats.pages}] ${finalUrl.pathname} (${repl.size} refs)`);
}

async function seedSitemaps(u, depth = 0) {
  if (depth > 2) return;
  const r = await get(u); if (!r || !r.ok) return;
  const xml = await r.text();
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const loc = decodeEnt(m[1]);
    if (/\.xml$/i.test(loc)) await seedSitemaps(loc, depth + 1); else enqueuePage(loc, ORIGIN);
  }
}

await fs.mkdir(PUB, { recursive: true });
enqueuePage('/', ORIGIN);
for (const sm of ['/sitemap.xml', '/sitemap_index.xml']) await seedSitemaps(ORIGIN + sm);
console.log('seeded pages:', pageQueue.length);
while (pageQueue.length) {
  const batch = pageQueue.splice(0, 3);
  await Promise.all(batch.map(processPage));
}
await Promise.all([...assetMap.values()]);
await fs.writeFile(path.join(OUT, 'mirror-report.json'), JSON.stringify({ origin: ORIGIN, date: new Date().toISOString(), pages: stats.pages, assets: stats.assets, bytes: stats.bytes, pageList: [...seenPages], failedPages: stats.failed, failedAssets: [...failedAssets] }, null, 2));
console.log('DONE pages', stats.pages, 'assets', stats.assets, 'MB', (stats.bytes / 1e6).toFixed(1), 'failedPages', stats.failed.length, 'failedAssets', failedAssets.size);
