# Research harness (offline studies)

Scripts that reuse the product's own libs (`../lib`) to test price-signal hypotheses against
forward 1/2/3-year returns. Not part of the server; run with `NODE_USE_ENV_PROXY=1 node …`.

- `fetch.mjs` — pulls ~10y daily bars for S&P 500 + Nasdaq-100 constituents (Wikipedia + the
  datasets S&P 500 CSV), caching one resumable JSON per ticker into `data/` (gitignored, ~39MB).
- `analyze.mjs` — pooled forward-return + cross-sectional quintile study across the universe.
- `indices.mjs` — index-level backtest (SPY/VOO/QQQ): buy-and-hold vs the timing rules.

**Survivorship caveat (load-bearing):** the universe is *current* constituents, so cross-sectional
single-name results are survivorship-biased — "beaten-down but still in the index" is conditioned
on recovery. Lean on the index-level (`indices.mjs`) and relative reads, not absolute single-name
returns. See `../docs/REVIEW.md` (Pass 2) for the findings and what they drove in the product.
