---
name: equity-screen
description: >-
  Rank or shortlist MANY tickers on factor scores (quality/value/growth/momentum),
  optionally tilted by your own factor weights. Use when the user wants to screen, rank,
  or shortlist a list of stocks to find the best ("rank these", "top quality names").
  Requires the server running (npm start). Outputs ranked JSON, or --md for a table.
allowed-tools:
  - Bash
---

# equity-screen

Cross-sectional factor ranking over a list of tickers, using `/api/score`.

## Prerequisite
Server running: `npm start` (http://localhost:5173). `STOCKS_API` overrides the base URL.

## Run
From the repo root:

    node .claude/skills/equity-screen/scripts/screen.mjs <TICKERS...> [--weights k:w,...] [--md]

- Tickers: space- or comma-separated (`AAPL MSFT NVDA` or `"AAPL,MSFT,NVDA"`).
- `--weights` (optional): tilt the ranking, e.g. `--weights quality:0.5,value:0.3,growth:0.2`.
  Keys: `quality`, `value`, `growth`, `health`, `momentum`, `shareholderYield`.

Examples:

    node .claude/skills/equity-screen/scripts/screen.mjs AAPL MSFT NVDA V LLY --md
    node .claude/skills/equity-screen/scripts/screen.mjs "AAPL,MSFT,NVDA" --weights quality:0.6,value:0.4 --md

## Technique
- Default ranks by the server **composite**.
- With `--weights`, each factor is **z-scored cross-sectionally** across the supplied names,
  then combined by your weights (a tilted-z score). This reflects YOUR preference and is
  relative to the set you pass — a different universe changes the z-scores.
- `pctile` is the percentile rank of the ranking score within the set.

## Conventions
- Missing factor data => `null`, never guessed; a bad ticker is isolated (`error` set) and
  does not sink the run.
- `reliability: "limited"` (financials/REITs) means the rating is screen-only — flag it.
- Screening narrows a universe; deep-dive the survivors with **equity-dossier** and study
  their joint risk with **equity-compare** / **equity-portfolio**.
