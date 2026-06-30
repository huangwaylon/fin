// Dependency-free HTTP server: serves the static frontend and proxies the data APIs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as yahoo from './lib/yahoo.js';
import * as sec from './lib/sec.js';
import { history as stooqHistory } from './lib/stooq.js';
import { research, snapshot } from './lib/aggregate.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = process.env.PORT || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  // Prevent path traversal.
  const filePath = normalize(join(PUBLIC, rel));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

// Route table for /api/*. Each handler returns a JSON-serializable value.
const routes = {
  '/api/search': (p) => {
    const q = p.get('q');
    if (!q) throw httpError(400, 'Missing q');
    return yahoo.search(q);
  },
  '/api/research': (p) => {
    const symbol = p.get('symbol');
    if (!symbol) throw httpError(400, 'Missing symbol');
    return research(symbol);
  },
  '/api/snapshot': (p) => {
    const symbol = p.get('symbol');
    if (!symbol) throw httpError(400, 'Missing symbol');
    return snapshot(symbol);
  },
  '/api/history': (p) => {
    const symbol = p.get('symbol');
    if (!symbol) throw httpError(400, 'Missing symbol');
    const range = p.get('range') || '1y';
    const interval = p.get('interval') || '1d';
    return yahoo.chart(symbol, range, interval).catch(async () => {
      // Fallback to Stooq daily data.
      return { fallback: 'stooq', ...(await stooqHistory(symbol)) };
    });
  },
  '/api/filings': (p) => {
    const symbol = p.get('symbol');
    if (!symbol) throw httpError(400, 'Missing symbol');
    return sec.recentFilings(symbol);
  },
  '/api/options': (p) => {
    const symbol = p.get('symbol');
    if (!symbol) throw httpError(400, 'Missing symbol');
    return yahoo.options(symbol);
  },
};

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = url;

  if (pathname.startsWith('/api/')) {
    const handler = routes[pathname];
    if (!handler) return sendJson(res, 404, { error: 'Unknown endpoint' });
    try {
      const data = await handler(searchParams);
      return sendJson(res, 200, data);
    } catch (err) {
      const status = err.status || 502;
      return sendJson(res, status, { error: String(err.message || err) });
    }
  }

  return serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`\n  Stock Research Terminal running:  http://localhost:${PORT}\n`);
  if (!process.env.FINNHUB_API_KEY) {
    console.log('  (Optional) set FINNHUB_API_KEY to enable peer-company data.\n');
  }
});
