// Post-process HTML and write the Node project files for a static clone.
import fs from 'node:fs/promises'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const [,, OUT, NAME, STYLE] = process.argv; const PUB = path.join(OUT, 'public');
const TOOLS = path.dirname(fileURLToPath(import.meta.url));
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
const trailingSlash = STYLE === 'dir';
const serverSrc = await fs.readFile(path.join(TOOLS, '..', 'server.mjs'), 'utf8');
if (!/const trailingSlash = (true|false);/.test(serverSrc)) throw new Error('server.mjs is missing the trailingSlash flag');
await fs.writeFile(path.join(OUT, 'server.mjs'), serverSrc.replace(/const trailingSlash = (true|false);/, `const trailingSlash = ${trailingSlash};`));
await fs.writeFile(path.join(OUT, 'package.json'), JSON.stringify({ name: NAME, version: '1.0.0', private: true, type: 'module',
  description: 'Copia estática de staging de back2back.mx. Se regenera con las herramientas en tools/.',
  scripts: { start: 'node server.mjs', build: 'echo "static site in public/"' }, engines: { node: '>=18' } }, null, 2) + '\n');
await fs.rm(path.join(OUT, 'vercel.json'), { force: true });
await fs.rm(path.join(OUT, '.vercelignore'), { force: true });
await fs.rm(path.join(OUT, '.vercel'), { recursive: true, force: true });
const gi = path.join(OUT, '.gitignore');
try {
  const lines = (await fs.readFile(gi, 'utf8')).split('\n').filter((line) => line.trim() !== '.vercel' && line.trim() !== '.vercel/');
  let next = lines.join('\n');
  if (next && !next.endsWith('\n')) next += '\n';
  await fs.writeFile(gi, next);
} catch { /* no gitignore in this output tree */ }
console.log('ok');
