// Fill pass: find references to local root-relative files that are missing and download them from the origin.
import fs from 'node:fs/promises';
import path from 'node:path';
const [,, ORIGIN, OUT] = process.argv;
const HOST = new URL(ORIGIN).host;
const PUB = path.join(OUT, 'public');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const EXT = /\.(css|js|mjs|json|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|pdf|docx?|xlsx?|pptx?|zip)$/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function walk(d) { const out = []; for (const e of await fs.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) out.push(...await walk(p)); else out.push(p); } return out; }
const exists = p => fs.access(p).then(() => true, () => false);
const tried = new Set(); const failed = []; let got = 0;
async function download(rel) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(ORIGIN + rel, { headers: { 'User-Agent': UA, Referer: ORIGIN + '/' } });
      if (r.status === 404 || r.status === 403 || r.status === 400) { failed.push(`${r.status} ${rel}`); return; }
      if (!r.ok) { await sleep(2000 * (i + 1)); continue; }
      let buf = Buffer.from(await r.arrayBuffer());
      if (/\.(css|js|json)$/i.test(rel)) { let t = buf.toString('utf8'); for (const o of [ORIGIN, 'http://' + HOST]) { t = t.split(o + '/').join('/'); t = t.split(o.replace(/\//g, '\\/') + '\\/').join('\\/'); } buf = Buffer.from(t); }
      const fp = path.join(PUB, decodeURIComponent(rel)); await fs.mkdir(path.dirname(fp), { recursive: true }); await fs.writeFile(fp, buf); got++; return;
    } catch { await sleep(2000 * (i + 1)); }
  }
  failed.push(`ERR ${rel}`);
}
for (let round = 0; round < 6; round++) {
  const files = (await walk(PUB)).filter(f => /\.(html|css|js|mjs)$/.test(f));
  const need = new Set();
  for (const f of files) {
    const t = (await fs.readFile(f, 'utf8'));
    const base = '/' + path.relative(PUB, f).split(path.sep).join('/');
    const refs = [];
    for (const m of t.matchAll(/(?<=["'=(\s,;])(\\?\/(?![\/\\])[A-Za-z0-9_\-.\/%~@\\]+)(?=[?"'\s)#,&])/g)) refs.push(m[1].replace(/\\\//g, '/'));
    if (f.endsWith('.css')) for (const m of t.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) if (!/^(data:|#|https?:|\/\/)/.test(m[1])) refs.push(new URL(m[1], 'http://x' + base).pathname);
    if (/\.m?js$/.test(f) && base.startsWith('/_astro')) for (const m of t.matchAll(/["'`](\.{1,2}\/[^"'`\s]+?\.(?:m?js|css))["'`]/g)) refs.push(new URL(m[1], 'http://x' + base).pathname);
    for (let r of refs) { r = r.split(/[?#]/)[0]; if (!EXT.test(r) || r.startsWith('/_ext/')) continue; if (tried.has(r)) continue; let dec; try { dec = decodeURIComponent(r); } catch { continue; } if (!(await exists(path.join(PUB, dec)))) need.add(r); }
  }
  if (!need.size) break;
  console.log(`round ${round}: missing ${need.size}`);
  const list = [...need]; list.forEach(r => tried.add(r));
  for (let i = 0; i < list.length; i += 2) { await Promise.all(list.slice(i, i + 2).map(download)); await sleep(250); }
}
console.log('downloaded', got, 'still failed', failed.length); console.log(failed.join('\n'));
await fs.writeFile(path.join(OUT, 'fill-report.json'), JSON.stringify({ downloaded: got, failed }, null, 2));
