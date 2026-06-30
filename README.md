# Stock Research Terminal

A multi-source stock analysis and research dashboard. Search any ticker to pull a
full research dossier — price action and technicals, fundamentals, analyst ratings,
earnings, ownership/insiders, options, news, and SEC filings — aggregated from
several free data sources.

## Run

```bash
npm start          # starts on http://localhost:5173
# or, with auto-reload during development:
npm run dev
```

No `npm install` is required — the server uses only Node's built-in modules
(Node 20+). The frontend is plain HTML/CSS/JS with no build step.

### Optional: peer companies

Peer-company data comes from Finnhub, which needs a free API key. Without it,
everything else works and the peers section is simply hidden.

```bash
FINNHUB_API_KEY=your_key npm start
```

## Data sources

| Source        | Provides                                                            | Key needed |
| ------------- | ------------------------------------------------------------------- | ---------- |
| Yahoo Finance | Quotes, OHLCV history, full financial statements, valuation, analyst ratings, earnings, insiders, ownership, options, news | No (handled server-side via cookie+crumb) |
| SEC EDGAR     | Regulatory filings (10-K, 10-Q, 8-K, Form 4, …)                     | No (descriptive User-Agent only) |
| Stooq         | Daily OHLCV history (fallback when Yahoo is unavailable)            | No |
| Finnhub       | Peer companies                                                      | Optional |

## How it works

- **`server.js`** — dependency-free HTTP server. Serves the static frontend from
  `public/` and exposes `/api/*` endpoints that proxy and aggregate the data
  sources (this is what gets around browser CORS, Yahoo's crumb auth, and SEC's
  User-Agent requirement).
- **`lib/`** — one client per data source plus a TTL cache (`cache.js`) and the
  parallel aggregator (`aggregate.js`).
- **`public/`** — the UI. `app.js` is the application logic, `chart.js` wraps
  TradingView's lightweight-charts, and `indicators.js` computes SMA/EMA/RSI/MACD/
  Bollinger Bands.

### API endpoints

| Endpoint                                   | Returns                                       |
| ------------------------------------------ | --------------------------------------------- |
| `GET /api/search?q=`                       | Ticker / company search                       |
| `GET /api/research?symbol=`                | Full aggregated dossier (one call, all sources) |
| `GET /api/snapshot?symbol=`                | Compact metrics for watchlist / compare rows  |
| `GET /api/history?symbol=&range=&interval=`| OHLCV bars for charting                       |
| `GET /api/filings?symbol=`                 | SEC EDGAR filings                             |
| `GET /api/options?symbol=`                 | Options chain                                 |

## Notes

- Watchlist and per-ticker research notes are stored in your browser's
  `localStorage` — they never leave your machine.
- Responses are cached in-memory for ~1 minute to stay polite to the free APIs.
- This is for research and educational use. Data is provided by third parties
  and may be delayed or incomplete. Not investment advice.
```
