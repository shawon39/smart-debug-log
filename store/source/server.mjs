// Static server for the screenshot scenes. Serves the repository root, plus the real
// dashboard and popup pages with the mock chrome API injected:
//   /mock/dashboard.html?host=...   /mock/popup.html
// Usage: node store/source/server.mjs [port]   (default 8765)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.argv[2]) || 8765;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2'
};
const MOCK_SCRIPTS = '<script src="/store/source/mock/mock-org.js"></script><script src="/store/source/mock/chrome-shim.js"></script><script src="/store/source/mock/scenes.js"></script>';

function injectMock(file, baseHref) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return html.replace('<head>', `<head>\n<base href="${baseHref}">${MOCK_SCRIPTS}`);
}

export function startServer(port = PORT) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/mock/dashboard.html') {
        res.writeHead(200, { 'Content-Type': TYPES['.html'] });
        return res.end(injectMock('dashboard.html', '/'));
      }
      if (url.pathname === '/mock/popup.html') {
        res.writeHead(200, { 'Content-Type': TYPES['.html'] });
        return res.end(injectMock('popup/popup.html', '/popup/'));
      }
      const filePath = path.join(ROOT, decodeURIComponent(url.pathname));
      if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().then(() => console.log(`Serving ${ROOT} on http://127.0.0.1:${PORT}`));
}
