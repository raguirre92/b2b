// Load each page in headless Chrome, scroll, record failed/404 requests, screenshot clone vs original.
import { chromium } from 'playwright-core'; import fs from 'node:fs/promises';
const [,, BASE, ORIGIN, PAGES_JSON, SHOTDIR, MODE = 'local'] = process.argv;
const pages = JSON.parse(await fs.readFile(PAGES_JSON, 'utf8'));
await fs.mkdir(SHOTDIR, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });
if (MODE === 'orig') { const host = new URL(BASE).host; await ctx.route(u => u.host === host, async route => { try { const r = await fetch(route.request().url(), { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept': route.request().headers()['accept'] || '*/*' } }); await route.fulfill({ status: r.status, headers: { 'content-type': r.headers.get('content-type') || '' }, body: Buffer.from(await r.arrayBuffer()) }); } catch { await route.abort(); } }); }
const results = [];
for (const p of pages) {
  const page = await ctx.newPage(); const bad = [];
  page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', r => bad.push(`FAIL ${r.url()} ${r.failure()?.errorText}`));
  let status = 0; try { const r = await page.goto(BASE + p, { waitUntil: 'load', timeout: 40000 }); status = r?.status(); } catch (e) { status = 'timeout'; }
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); }).catch(() => {});
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => ({ title: document.title, h: document.body.scrollHeight, imgs: [...document.images].length, broken: [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.src).map(i => i.src).slice(0, 10) })).catch(() => ({}));
  const slug = (p.replace(/[\/]+/g, '_') || 'home').replace(/^_|_$/g, '') || 'home';
  await page.screenshot({ path: `${SHOTDIR}/${MODE}-${slug}.png`, fullPage: true }).catch(() => {});
  results.push({ path: p, status, ...info, bad: [...new Set(bad)] });
  console.log(status, p, 'h=' + info.h, 'imgs=' + info.imgs, 'broken=' + (info.broken || []).length, 'bad=' + new Set(bad).size);
  await page.close(); if (process.env.PAUSE) await new Promise(r => setTimeout(r, +process.env.PAUSE));
}
await fs.writeFile(`${SHOTDIR}/${MODE}-results.json`, JSON.stringify(results, null, 2));
await browser.close();
