# CLAUDE.md

Operational guide for working on this repo with Claude Code.

## What this is
A multi-source equity **research + decision-support** tool for humans and LLMs.
A dependency-free Node server (`server.js`) proxies/aggregates data and computes a
quant decision layer; the frontend (`public/`) is plain HTML/CSS/JS with no build step.

## Run
```bash
npm start                  # http://localhost:5173  (no `npm install` — Node 20+ built-ins only)
npm run dev                # auto-reload
node test/quant.test.mjs   # unit + backtest sanity tests (no network)
```
Optional: set `FINNHUB_API_KEY` to enable peer-company data.

## Environment gotchas (matter in this sandbox)
- **Proxy:** Node's `fetch` ignores `HTTP_PROXY`. The npm scripts set `NODE_USE_ENV_PROXY=1` so fetch
  uses the env proxy. Required behind the sandbox proxy; a harmless no-op without one. To run `node`
  directly here, prefix with that flag.
- **Yahoo User-Agent:** use a bare `Mozilla/5.0`. A long Chrome UA gets HTTP 429 from Yahoo via the proxy.
- **Allowlist:** outbound domains live in `~/.claude/apple/dangerous_allowed_domains.csv`; append new data hosts.
- **FT:** article extraction applies the free-ft "Googlebot" header strategy. FT's WAF blocks datacenter
  IPs, so it only succeeds from a normal IP.

## Layout
- `lib/` — data clients (`yahoo`, `sec`, `stooq`, `finnhub`) + `aggregate`, and the decision layer
  (`extract`, `quantutil`, `signals`, `factors`, `valuation`, `backtest`, `brief`, `decision`, `news`).
- `server.js` — static serving + `/api/*` routes (`getAnalysis` reuses cached research + chart).
- `public/` — `app.js` (tabs), `chart.js`, `indicators.js`, `styles.css`.
- `docs/` — methodology, architecture, API, playbook.

## Endpoints
`search`, `research`, `snapshot`, `history`, `filings`, `options`, `score`, `valuation`,
`brief` (json|md), `backtest`, `news`, `article`. See `docs/API.md`.

## Invariants (do not break)
- **No fabrication:** missing data is `null`, never guessed; it lowers conviction.
- **No look-ahead:** time-series math at time *t* uses only data ≤ *t* (enforced in `backtest.js`).
- **Human + machine parity:** the UI and `/api/brief` render from the same computed object.
- **Sector safety:** financials/REITs mask inapplicable factors and return `reliability: 'limited'`
  (rating shown as "screen only"). Keep that gating intact.
- Dependency-free, plain ES modules. Re-run `node test/quant.test.mjs` after changing the quant layer.
