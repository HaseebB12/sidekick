'use strict';

/**
 * Zero-dependency static server for the browser preview of Sidekick.
 *
 *   npm run web   →   http://localhost:5173
 *
 * It serves the project root, so the browser build loads exactly the same
 * renderer files (src/renderer/**) and character art (assets/**) the Electron
 * app does. The only thing that changes is which bridge backs them.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  } catch {
    return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain' });
  }

  if (urlPath === '/') urlPath = '/web/index.html';

  const filePath = path.join(ROOT, urlPath);
  // Never serve outside the project root.
  if (!filePath.startsWith(ROOT)) {
    return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      return send(res, 404, `Not found: ${urlPath}`, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    send(res, 200, data, { 'Content-Type': type });
  });
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Sidekick — browser preview');
  console.log(`  →  http://localhost:${PORT}`);
  console.log('');
  console.log('  Note: this is the review build. The real global hotkey, the');
  console.log('  transparent always-on-top overlay and silent full-screen capture');
  console.log('  only exist in the Electron app (npm start).');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is busy. Try: set PORT=5174 && npm run web`);
    process.exit(1);
  }
  throw err;
});
