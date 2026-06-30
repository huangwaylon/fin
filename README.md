# Stock Research Terminal

Multi-source equity **research and decision-support** — for senior analysts and LLMs alike.
It gathers structured data from several providers and turns it into a transparent decision
layer: a factor scorecard, a valuation, signal/backtest evidence, and a machine-readable brief.

> For research and educational use. Data is third-party and may be delayed or incomplete.
> **Not investment advice.** A human is always the decision-maker.

## Two pillars

1. **Gather** — quotes, full financial statements, valuation, analyst ratings, earnings,
   ownership/insiders, options, SEC filings, and multi-source news (Yahoo + Google News,
   with full-text article extraction).
2. **Decide** — a six-factor scorecard (quality · value · growth · health · momentum ·
   shareholder yield), an FCFF DCF + reverse DCF + multiples cross-check, walk-forward
   price-signal backtests, and a structured **brief an LLM can consume** (`/api/brief`).

## Quickstart

```bash
npm start     # http://localhost:5173 — no install needed (Node 20+ built-ins only)
```

No `npm install`: the server uses only Node's standard library. The frontend is plain
HTML/CSS/JS with no build step. Optionally set `FINNHUB_API_KEY` for peer data.

## Documentation

| Doc | What's in it |
| --- | --- |
| [Methodology](docs/METHODOLOGY.md) | The factor model, valuation, backtest, and **known limitations** |
| [Architecture](docs/ARCHITECTURE.md) | Code map and data flow |
| [API reference](docs/API.md) | Every `/api/*` endpoint |
| [Analyst + LLM playbook](docs/PLAYBOOK.md) | A daily-use walkthrough for forming and validating a long-term thesis |

## Data sources

| Source | Provides | Key |
| --- | --- | --- |
| Yahoo Finance | Quotes, history, statements, valuation, analysts, earnings, insiders, ownership, options, news | No |
| SEC EDGAR | Regulatory filings (10-K, 10-Q, 8-K, Form 4) | No |
| Google News | Multi-publisher headline discovery | No |
| Stooq | Daily OHLCV fallback | No |
| Finnhub | Peer companies | Optional |

## Decision layer at a glance

- **Score** 0–100 → rating (Strong Buy / Buy / Hold / Reduce / Avoid), with **conviction** and
  **data coverage**. Financials and REITs are flagged `reliability: limited` ("screen only").
- **Valuation:** 2-stage FCFF DCF discounted at WACC with a net-debt bridge, a reverse DCF
  (market-implied growth), and a Graham multiples cross-check, plus a sensitivity grid.
- **Backtest:** walk-forward, look-ahead-free price-signal rules vs buy-and-hold — descriptive
  risk context, not a buy signal.

## Principles

Transparency (every score traces to its inputs) · no fabrication (missing data is `null`, never
guessed) · no look-ahead · the UI and the machine brief render from the same computed object.
