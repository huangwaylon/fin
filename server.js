// Dependency-free HTTP server: serves the static frontend and proxies the data APIs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as yahoo from './lib/yahoo.js';
import * as sec from './lib/sec.js';
import { history as stooqHistory } from './lib/stooq.js';
import { research, snapshot } from './lib/aggregate.js';
import { analyze, parseBars, parseWeights } from './lib/decision.js';
import { backtest } from './lib/backtest.js';
import { briefToMarkdown } from './lib/brief.js';
import { mergedNews, extractArticle } from './lib/news.js';

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

// Fetch the aggregated research + price history (both cached) and run the full
// decision analysis. Shared by every decision endpoint.
async function getAnalysis(symbol, searchParams) {
  const [researchData, chartData] = await Promise.all([
    research(symbol),
    yahoo
      .chart(symbol, '5y', '1d')
      .catch(async () => ({ fallback: 'stooq', ...(await stooqHistory(symbol)) }))
      .catch(() => null),
  ]);
  const weights = parseWeights(searchParams.get('weights'));
  return analyze(researchData, chartData, { weights });
}

// Route table for /api/*. Each handler returns a JSON-serializable value, or a
// { __raw, __type } envelope to send a non-JSON body.
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

  // --- Decision-support endpoints ---
  '/api/score': async (p) => {
    const symbol = requireSymbol(p);
    const a = await getAnalysis(symbol, p);
    return { symbol: a.ex.symbol, name: a.ex.name, price: a.ex.price, ...a.comp, factors: a.factors, weights: a.weights };
  },
  '/api/valuation': async (p) => {
    const symbol = requireSymbol(p);
    const a = await getAnalysis(symbol, p);
    return { symbol: a.ex.symbol, name: a.ex.name, price: a.ex.price, valuation: a.valuation };
  },
  '/api/brief': async (p) => {
    const symbol = requireSymbol(p);
    const a = await getAnalysis(symbol, p);
    if ((p.get('format') || 'json') === 'md') {
      return { __raw: briefToMarkdown(a.brief), __type: 'text/markdown; charset=utf-8' };
    }
    return a.brief;
  },
  '/api/backtest': async (p) => {
    const symbol = requireSymbol(p);
    const rule = p.get('rule') || 'trend_mom';
    const years = p.get('years') ? Number(p.get('years')) : null;
    const chartData = await yahoo
      .chart(symbol, '10y', '1d')
      .catch(async () => ({ fallback: 'stooq', ...(await stooqHistory(symbol)) }));
    return { symbol: symbol.toUpperCase(), ...backtest(parseBars(chartData), { rule, years }) };
  },

  // --- News & research extraction ---
  '/api/news': async (p) => {
    const symbol = requireSymbol(p);
    const r = await research(symbol);
    const items = await mergedNews(symbol, r?.sources?.news?.news || []);
    return { symbol: symbol.toUpperCase(), count: items.length, items };
  },
  '/api/article': async (p) => {
    const url = p.get('url');
    if (!url) throw httpError(400, 'Missing url');
    assertPublicUrl(url);
    return extractArticle(url);
  },
};

// Refuse to fetch private / loopback addresses (basic SSRF guard) since the
// article endpoint fetches user-supplied URLs server-side.
function assertPublicUrl(u) {
  let h;
  try {
    h = new URL(u).hostname;
  } catch {
    throw httpError(400, 'Invalid url');
  }
  if (!/^https?:$/.test(new URL(u).protocol)) throw httpError(400, 'Only http(s) URLs allowed');
  if (
    /^(localhost|0\.0\.0\.0)$/.test(h) ||
    h === '::1' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  ) {
    throw httpError(403, 'Refusing to fetch a private address');
  }
}

function requireSymbol(p) {
  const symbol = p.get('symbol');
  if (!symbol) throw httpError(400, 'Missing symbol');
  return symbol;
}

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
      if (data && data.__raw !== undefined) {
        res.writeHead(200, { 'Content-Type': data.__type || 'text/plain', 'Cache-Control': 'no-store' });
        return res.end(data.__raw);
      }
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
