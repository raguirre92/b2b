// Local static server for the clone: node server.mjs [port]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const PUB = path.join(path.dirname(new URL(import.meta.url).pathname), 'public'); const port = +process.argv[2] || 3000;
const T = { '.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.pdf':'application/pdf','.mp4':'video/mp4','.txt':'text/plain' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const c = [p, p + '.html', path.join(p, 'index.html')];
  for (const x of c) { const fp = path.join(PUB, x); if (fp.startsWith(PUB) && fs.existsSync(fp) && fs.statSync(fp).isFile()) { res.writeHead(200, { 'Content-Type': T[path.extname(fp).toLowerCase()] || 'application/octet-stream' }); return fs.createReadStream(fp).pipe(res); } }
  console.log('404', req.url); res.writeHead(404); res.end('Not found');
}).listen(port, () => console.log('http://localhost:' + port));
