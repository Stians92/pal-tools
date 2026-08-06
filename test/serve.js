// Minimal static file server for testing (no dependencies).
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let f = path.normalize(path.join(root, urlPath));
  if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (urlPath === '/' || urlPath === '') f = path.join(root, 'test', 'browser-test.html');
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(f);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});
server.listen(8765, '127.0.0.1', () => console.log('serving on http://127.0.0.1:8765'));
