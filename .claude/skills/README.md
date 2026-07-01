# Equity research skills

LLM-invokable research skills wired to this repo's research server (`server.js`). They turn
the raw `/api/*` endpoints into structured, fabrication-free analyses using standard
quant techniques. All emit machine JSON by default and a human view with `--md`
(human + machine parity).

**Prerequisite for every skill:** the server must be running — `npm start`
(http://localhost:5173). Override the base URL with `STOCKS_API`.

| Skill | Use it when | Core technique |
| --- | --- | --- |
| **equity-dossier** | Deep dive / memo on ONE ticker | brief + filings -> standardized decision memo |
| **equity-screen** | Rank / shortlist MANY tickers | cross-sectional factor z-scores, optional weight tilt |
| **equity-compare** | Compare 2+ names side by side | realized risk/return + return correlation matrix |
| **equity-portfolio** | Allocate / size a basket | covariance -> equal / inv-vol / min-variance weights + risk decomposition |

Shared helpers (fetch, price series, statistics, formatting) live in `_shared/quant.mjs`.
Scripts hit **localhost only** — do not set `NODE_USE_ENV_PROXY` (that routes localhost
through the sandbox proxy and fails); plain `node script.mjs` is correct.

## Typical workflow
1. `equity-screen` a candidate universe -> shortlist.
2. `equity-dossier` each survivor -> per-name thesis, valuation, catalysts.
3. `equity-compare` the shortlist -> risk/return + how correlated they are.
4. `equity-portfolio` -> weights and where the risk actually sits.

## Invariants (shared with the repo)
- **No fabrication:** missing data is `null`, never guessed.
- **No look-ahead:** time-series math uses only data <= today.
- **Sector safety:** `reliability: "limited"` (financials/REITs) => screen-only rating; surface it.
- **Fault isolation:** one bad ticker is reported as an error row, never crashes the run.

## Smoke test
    bash .claude/skills/test.sh
