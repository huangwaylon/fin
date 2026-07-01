---
name: equity-dossier
description: >-
  Deep-dive decision memo for ONE stock — rating, DCF/reverse-DCF valuation gap,
  momentum/risk signals, bull/bear, and catalysts from news + SEC filings. Use when the
  user wants to analyze a single ticker in depth or asks "should I buy X". Requires the
  server running (npm start). Outputs JSON, or --md for a human memo.
allowed-tools:
  - Bash
---

# equity-dossier

A consistent, fabrication-free decision memo for one ticker, assembled from the research
server's `/api/brief` (scorecard + valuation + signals + bull/bear) plus recent `/api/filings`.

## Prerequisite
The server must be running: `npm start` (http://localhost:5173). Set `STOCKS_API` to override the base URL.

## Run
From the repo root:

    node .claude/skills/equity-dossier/scripts/dossier.mjs <TICKER>        # JSON
    node .claude/skills/equity-dossier/scripts/dossier.mjs <TICKER> --md   # human memo

Example: `node .claude/skills/equity-dossier/scripts/dossier.mjs NVDA --md`

## What it returns
- **decision** — rating, composite (0-100), conviction, per-factor scores.
- **valuation** — blended fair value, DCF vs multiples cross-check, margin of safety,
  reverse-DCF implied growth, analyst upside.
- **signals** — trend, 12-1 momentum, annualized vol, max drawdown, 52-week position.
- **bull / bear** — and the bear list is echoed as *what would change the thesis*.
- **catalysts** — recent news headlines + recent SEC filings.

## Conventions (do not break)
- Missing inputs are `null`, never guessed — they lower implied confidence.
- `reliability: "limited"` => financials/REITs (rating is screen-only); surface that caveat.
- DCF margin of safety is often deeply negative for high-growth names (conservative DCF) —
  read it alongside reverse-DCF implied growth, don't treat it as a sell trigger alone.
- For a multi-name comparison use **equity-compare**; to rank a universe use **equity-screen**.
