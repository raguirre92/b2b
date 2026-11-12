// Post-process + create Vercel/Node project files.
import fs from 'node:fs/promises'; import path from 'node:path';
const [,, OUT, NAME, STYLE] = process.argv; const PUB = path.join(OUT, 'public');
async function walk(d) { const o = []; for (const e of await fs.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? o.push(...await walk(p)) : o.push(p); } return o; }
for (const f of (await walk(PUB)).filter(f => f.endsWith('.html'))) {
  let t = await fs.readFile(f, 'utf8');
  // Zyro/Hostinger: ClientHead redirects to canonical when hostname != site domain (would loop on a clone host)
  t = t.replace(/domain&quot;:\[0,&quot;operacionninosdemexico\.com&quot;\]/g, 'domain&quot;:[0,&quot;&quot;]');
  t = t.replace(/<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?challenge-platform[\s\S]*?<\/script>/gi, '');
  // drop Google Tag Manager so clone visits do not pollute the original site's analytics
  t = t.replace(/<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?googletagmanager\.com\/gtm\.js[\s\S]*?<\/script>/gi, '');
  t = t.replace(/<noscript>\s*<iframe[^>]+googletagmanager\.com[\s\S]*?<\/noscript>/gi, '');
  t = t.replace(/<script\b[^>]*id=["']google_gtagjs-js(?:-after|-before)?["'][^>]*>[\s\S]*?<\/script>/gi, '');
  await fs.writeFile(f, t);
}
await fs.writeFile(path.join(PUB, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
const vercel = { framework: null, buildCommand: '', installCommand: '', outputDirectory: 'public', cleanUrls: true, trailingSlash: STYLE === 'dir' ? true : false,
  headers: [{ source: '/(.*)', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }] };
await fs.writeFile(path.join(OUT, 'vercel.json'), JSON.stringify(vercel, null, 2) + '\n');
await fs.writeFile(path.join(OUT, 'package.json'), JSON.stringify({ name: NAME, version: '1.0.0', private: true, type: 'module',
  description: 'Static mirror (clone) generated with Node.js tools in ../tools (mirror.mjs, fill.mjs).',
  scripts: { start: 'node server.mjs', build: 'echo "static site in public/"' }, engines: { node: '>=18' } }, null, 2) + '\n');
await fs.writeFile(path.join(OUT, 'server.mjs'), `// Local static server for the clone: node server.mjs [port]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const PUB = path.join(path.dirname(new URL(import.meta.url).pathname), 'public'); const port = +process.argv[2] || 3000;
const T = { '.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.pdf':'application/pdf','.mp4':'video/mp4','.txt':'text/plain' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const c = [p, p + '.html', path.join(p, 'index.html')];
  for (const x of c) { const fp = path.join(PUB, x); if (fp.startsWith(PUB) && fs.existsSync(fp) && fs.statSync(fp).isFile()) { res.writeHead(200, { 'Content-Type': T[path.extname(fp).toLowerCase()] || 'application/octet-stream' }); return fs.createReadStream(fp).pipe(res); } }
  console.log('404', req.url); res.writeHead(404); res.end('Not found');
}).listen(port, () => console.log('http://localhost:' + port));
`);
await fs.writeFile(path.join(OUT, '.vercelignore'), 'mirror-report.json\nfill-report.json\nnode_modules\n');
console.log('ok');
