// Static file server for local use and Node hosting (npm start).
// Port: PORT, otherwise the first argument, otherwise 3000.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'public');
const rawPort = process.env.PORT || process.argv[2] || '3000';
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Invalid port: ' + rawPort);
  process.exit(1);
}
// html pages (false) or directory indexes (true). finalize.mjs rewrites this flag.
const trailingSlash = true;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
};
const ROBOTS = 'noindex, nofollow';
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Robots-Tag': ROBOTS,
};

function inside(rel) {
  const fp = path.resolve(PUB, rel);
  if (fp !== PUB && !fp.startsWith(PUB + path.sep)) return null;
  return fp;
}

function openFile(rel) {
  const fp = inside(rel);
  if (!fp) return null;
  try {
    return fs.statSync(fp).isFile() ? fp : null;
  } catch {
    return null;
  }
}

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY, ...headers });
  res.end(body);
}

function redirect(res, location) {
  send(res, 308, { Location: location });
}

function serve(req, res, fp) {
  const type = TYPES[path.extname(fp).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { ...SECURITY, 'Content-Type': type });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(fp);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const server = http.createServer((req, res) => {
  let pathname;
  let search = '';
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    pathname = decodeURIComponent(url.pathname);
    search = url.search;
  } catch {
    return send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad request');
  }

  if (pathname.endsWith('/index.html')) {
    const dir = pathname.slice(0, -'index.html'.length);
    const dest = trailingSlash || dir === '/' ? dir : dir.slice(0, -1);
    return redirect(res, (dest || '/') + search);
  }
  if (pathname.endsWith('.html')) {
    const bare = pathname.slice(0, -'.html'.length);
    return redirect(res, (bare || '/') + search);
  }

  if (pathname.length > 1 && pathname.endsWith('/')) {
    if (!trailingSlash) return redirect(res, pathname.slice(0, -1) + search);
  } else if (trailingSlash && pathname !== '/') {
    const rel = pathname.replace(/^\/+/, '');
    if (openFile(path.join(rel, 'index.html'))) return redirect(res, pathname + '/' + search);
  }

  const rel = pathname.replace(/^\/+/, '');
  const candidates = [];
  if (rel && !rel.endsWith('/')) candidates.push(rel, rel + '.html');
  candidates.push(path.join(rel, 'index.html'));
  for (const relPath of candidates) {
    const fp = openFile(relPath);
    if (fp) return serve(req, res, fp);
  }
  console.log('404', req.url);
  send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
});

server.listen(port, '0.0.0.0', () => {
  console.log('http://localhost:' + port);
});
