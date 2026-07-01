---
name: equity-compare
description: >-
  Side-by-side risk/return for 2+ tickers plus a return-correlation matrix — CAGR,
  annualized vol, Sharpe/Sortino, max drawdown, 12-1 momentum, beta/PE, and pairwise
  correlations (diversification view). Use when the user wants to compare specific stocks
  head-to-head or check how correlated a set is. Requires the server running (npm start).
  Outputs JSON, or --md for tables.
allowed-tools:
  - Bash
---

# equity-compare

Side-by-side risk/return statistics plus a correlation matrix, computed from aligned
adjusted-close history (`/api/history`) and `/api/snapshot` fundamentals.

## Prerequisite
Server running: `npm start` (http://localhost:5173). `STOCKS_API` overrides the base URL.

## Run
From the repo root:

    node .claude/skills/equity-compare/scripts/compare.mjs <TICKERS...> [--range 5y] [--md]

`--range` accepts Yahoo ranges (`1y`, `2y`, `5y`, `10y`, `max`); default `5y`.

Example: `node .claude/skills/equity-compare/scripts/compare.mjs GOOGL V NVDA LLY --md`

## Technique (all realized over the window — not forecasts)
- **CAGR** from first/last adjusted close; **annualized vol** = daily-return std x sqrt(252).
- **Sharpe/Sortino** at rf=0; **max drawdown** from the equity curve; **12-1 momentum**.
- **Correlation matrix** on common-date daily log returns (series are intersected on dates
  so every pair is measured over the same bars), plus the average pairwise correlation —
  lower means more diversification benefit.

## Conventions
- Adjusted close handles splits/dividends; no look-ahead (stats use data <= today only).
- Names with <30 bars are dropped from the correlation matrix but still shown in stats.
- To turn a compared set into weighted positions, use **equity-portfolio**.
