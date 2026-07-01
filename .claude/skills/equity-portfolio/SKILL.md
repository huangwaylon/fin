---
name: equity-portfolio
description: >-
  Allocate weights across a shortlist (equal, inverse-volatility, or minimum-variance)
  and decompose portfolio risk — vol, realized CAGR/Sharpe, max drawdown, diversification
  ratio, and per-holding risk contribution. Use when the user wants to size positions or
  build a basket from a set of stocks. Requires the server running (npm start). Outputs
  JSON, or --md for a table.
allowed-tools:
  - Bash
---

# equity-portfolio

Position sizing + portfolio risk decomposition over a shortlist, from aligned daily
returns (`/api/history`).

## Prerequisite
Server running: `npm start` (http://localhost:5173). `STOCKS_API` overrides the base URL.

## Run
From the repo root:

    node .claude/skills/equity-portfolio/scripts/portfolio.mjs <TICKERS...> [--method invvol|equal|minvar] [--range 3y] [--md]

- `--method` (default `invvol`):
  - `equal`  — 1/N.
  - `invvol` — inverse annualized vol (risk-parity-lite); calmer names get more weight.
  - `minvar` — long-only minimum-variance via projected-gradient descent (uses the full
    covariance matrix, so correlations matter, not just vols).
- `--range` default `3y`.

Example: `node .claude/skills/equity-portfolio/scripts/portfolio.mjs GOOGL V NVDA LLY MSFT --method minvar --md`

## Technique (realized over the window — not a forecast)
- Annualized **covariance matrix** from aligned daily log returns.
- **Diversification ratio** = (weighted-avg vol) / (portfolio vol); >1 means diversification
  is working (the higher the better).
- **Risk contribution** per holding sums to 100%; equal-risk would be ~1/N each — large gaps
  flag a concentrated risk source even when dollar weights look balanced.

## Conventions
- Weights are long-only and sum to 1.
- Realized stats describe the historical window only — do not present them as expected returns.
- Pair with **equity-compare** to inspect the underlying correlations, and **equity-screen**
  to choose which names belong in the basket.
