// Static file server for the browser tests (Node built-ins only).
// Replaces `py -m http.server`, which on Windows sometimes stalls part-way
// through larger files (the icons) when several requests arrive at once.
// Usage: node tests/e2e/server.mjs <port>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.argv[2] || 8090);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}`));
