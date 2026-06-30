# Architecture

A dependency-free Node HTTP server (`server.js`) serves a plain HTML/CSS/JS frontend
and proxies/aggregates third-party market data, then computes the decision layer on
top of it. No build step, no npm dependencies — `node server.js` and open the page.
The browser code is hand-written ES modules served as static files.

## File map

| File | Role |
| --- | --- |
| `lib/cache.js` | In-memory TTL cache (`cached(key, ttl, producer)`). |
| `lib/yahoo.js` | Yahoo client: cookie+crumb auth, request throttle, search/quoteSummary/chart/options. |
| `lib/sec.js` | SEC EDGAR recent filings. |
| `lib/stooq.js` | Stooq daily history (chart fallback). |
| `lib/finnhub.js` | Finnhub peers (optional; needs `FINNHUB_API_KEY`). |
| `lib/aggregate.js` | Fans out to all sources in parallel; `research()` + `snapshot()`. |
| `lib/extract.js` | Normalizes Yahoo quoteSummary (+ bars) into one flat fundamentals object; classifies sector. |
| `lib/quantutil.js` | Math primitives: `scoreUp/scoreDown`, `blend`, `clamp`, `cagr`, `stdev`, `isNum`, `raw`. |
| `lib/signals.js` | Price-derived signals: SMA/cross, momentum, returns, vol, drawdown. |
| `lib/factors.js` | Six-factor model, composite, rating, conviction, sector masks. |
| `lib/valuation.js` | 2-stage FCFF DCF at WACC, reverse DCF, ROIC vs WACC, Graham cross-check, sensitivity. |
| `lib/backtest.js` | Walk-forward price-signal backtest (total-return) + forward-return study + metrics. |
| `lib/brief.js` | Assembles the machine-readable brief; renders Markdown. |
| `lib/decision.js` | Orchestrator: `analyze()`, `parseBars()`, `parseWeights()`. |
| `lib/news.js` | Google News RSS discovery + full-text article extraction. |
| `server.js` | HTTP server, static serving, `/api/*` route table, SSRF guard. |
| `public/index.html` | App shell. |
| `public/app.js` | Frontend controller (fetches APIs, renders). |
| `public/chart.js` | Price chart rendering. |
| `public/indicators.js` | Client-side indicator overlays. |
| `public/styles.css` | Styling. |

## Data flow

```
/api/research → aggregate.research(symbol)
                   ├─ yahoo.quoteSummary  ├─ yahoo.chart(1y)  ├─ yahoo.options
                   ├─ sec.recentFilings   ├─ finnhub.peers    └─ yahoo.search (news)
```

Decision endpoints reuse that aggregation via `getAnalysis(symbol)` in `server.js`:
fetch `research()` + a 5y daily chart (in parallel) → `decision.analyze()` →
`extract()` → `computeFactors()`/`composite()` + `valuation()` → `buildBrief()`.
One upstream fetch set powers `/api/score`, `/api/valuation`, and `/api/brief`.

| Endpoint | Returns |
| --- | --- |
| `GET /api/research?symbol=` | Raw aggregated sources + per-source errors. |
| `GET /api/snapshot?symbol=` | Lightweight quote row (watchlist/compare). |
| `GET /api/score?symbol=&weights=` | Factor scorecard + composite + rating. |
| `GET /api/valuation?symbol=` | DCF / reverse-DCF / multiples + sensitivity. |
| `GET /api/brief?symbol=&format=json\|md` | Full decision brief (JSON or Markdown). |
| `GET /api/backtest?symbol=&rule=&years=` | Walk-forward signal backtest (10y chart). |
| `GET /api/news?symbol=` | Merged Yahoo + Google News headlines. |
| `GET /api/article?url=` | Full-text article extraction. |
| `GET /api/history\|filings\|options\|search` | Direct source proxies. |

## Resilience & environment

- **Caching:** every upstream call is wrapped in `cached()` with a short TTL (Yahoo
  search/summary/chart 60s, options 5m; Google News 10m; article 30m). In-memory only;
  resets on restart.
- **Error isolation:** `aggregate.research()` uses `Promise.allSettled`-style wrapping
  (`settled()`), so one failing source returns `null` + an error string instead of
  taking down the response. Chart falls back to Stooq if Yahoo fails.
- **Yahoo auth & throttle:** quoteSummary/options need a cookie+crumb pair (fetched and
  cached ~25m); all Yahoo calls funnel through a single-flight queue with a 600ms gap to
  avoid 429s, with crumb-refresh on 401/403 and a backoff retry on 429.
- **User agents:** bare `Mozilla/5.0` for Yahoo; for FT articles, the documented
  Googlebot strategy (`User-Agent: Googlebot`, `Referer: google.com`, consent cookie).
- **Proxy:** Node's global `fetch` honors a corporate proxy only when
  `NODE_USE_ENV_PROXY` is set — required for upstream fetches to work behind one.
- **SSRF guard:** `/api/article` refuses loopback/private/link-local hosts and non-HTTP(S)
  schemes; static serving blocks path traversal.
