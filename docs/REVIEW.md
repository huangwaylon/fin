# Code & Methodology Review

**Scope:** full codebase + analytical methodology, judged as decision support for **1-year+ buy-and-hold** equity purchases.
**Method:** parallel senior review (data integrity · backtest · server/security · quant core), each finding verified against source; a feasibility/scope panel then triaged the fix list before implementation.

> An earlier pass reviewed the tool against a *6–12 month* horizon. At a 1yr+ horizon the
> headline horizon-fit critiques invert: the DCF anchor, quality/value tilt, and modest
> momentum weight are the *right* shape. This review focuses on what actually decides
> multi-year outcomes — total return, durability, and cycle risk — and on security hardening.

---

## 1. Verdict

The engineering is clean and the methodology is honest: no fabrication, no look-ahead, every
assumption exposed, sector-aware masking for financials/REITs. For a multi-year holder the
orientation is sound. This pass closed the gaps that bite hardest over multi-year holds and
hardened the article-fetch path.

## 2. Implemented in this pass

**Analytical**

- **Total return (adjusted close).** `parseBars` now carries Yahoo's dividend/split-adjusted
  `adjclose`. Returns/momentum/volatility/drawdown (signals + backtest) use it; price *levels*
  (SMAs, 52w hi/lo, candles) stay raw. Previously every "return" was a price-return understating
  total return — the single biggest distortion for a dividend-paying compounder.
- **ROIC vs WACC value creation.** New `roic` quality input and a `valueCreationSpread = ROIC − WACC`
  in the valuation, with bull/risk flags. EBIT is derived from `operatingMargin × revenue`
  (Yahoo's `ebit`/`operatingIncome` come back sparse/zero); book equity from `marketCap/P-B`.
- **Earnings quality.** New `cashConversion` (CFO/NI) quality input + a weak-conversion flag.
- **Cycle defense.** New forward-earnings-yield value input, and a "net margin vs its own
  multi-year average" peak-earnings flag.
- **Forward-holding-period study.** `/api/backtest` now returns the distribution of forward
  1/2/3-year total returns, overall and conditional on entry-day trend/momentum state — the
  question a 1yr+ holder actually asks. Sortino fixed to the all-observations denominator;
  Sharpe/Sortino use a 4% risk-free rate.
- **Guards.** Dividend-yield scale normalization, buyback-yield clamp, `quoteAsOf` stamp.

**Security / robustness**

- **SSRF redirect re-validation** — `/api/article` follows redirects manually and re-runs the
  guard on every hop (closes the public→private redirect bypass).
- **IP classifier hardened** — IPv6 default-deny outside global-unicast `2000::/3`, with embedded
  IPv4 (mapped/6to4) decoded; IPv4 multicast/broadcast blocked.
- **Bounded cache** (LRU-by-insertion, 500 entries) — attacker-influenced keys can't grow it.
- **Article body cap** (4 MB streamed) — prevents memory exhaustion.
- **Misc** — static-path prefix fix, `years`/`weights` validation, `javascript:`/`data:` href
  scheme guard in the UI.
- **Residual (accepted):** true DNS-rebinding TOCTOU needs socket-IP pinning (a dependency);
  documented in `lib/ssrf.js`, mitigated by per-hop re-validation.

## 3. Known-good (verified, unchanged)

- No-look-ahead is real (`backtest.js`: decide from `closes[0..t]`, realize `t→t+1`).
- No fabrication: `blend()` propagates coverage and never zero-fills; missing inputs stay null.
- Valuation internally consistent (FCFF + WACC + net-debt bridge, beta/WACC clamped, multiples
  kept separate from fair value, sensitivity grid + `terminalValueShare` exposed).
- Sector masking for financials/REITs correctly gated and reaches the screen.
- XSS: `esc()` applied consistently across `innerHTML` sinks.

## 4. Deferred (see METHODOLOGY v2 roadmap)

- Sector-relative / peer-normalized scoring (absolute anchors remain regime-sensitive).
- Valuation vs the company's own history; probabilistic fair-value range.
- Transaction-cost/turnover modeling and confidence intervals on the timing backtest.
- Negative-FCF normalized DCF base (cut deliberately — would require fabricating a path to profit).
- Portfolio context: correlation, sizing, exposure.

All changes covered by `node test/quant.test.mjs` (86 pass) and a live server smoke test.

---

## Pass 2 — lessons from the historical backtesting exercise

A study across **515 current S&P 500 + Nasdaq-100 constituents** (~47k monthly obs, 2017-2025)
plus index-level SPY/VOO/QQQ tested price-signal hypotheses against forward 1/2/3-year returns
(harness in `research/`). What it taught us, and what we shipped in response:

**Lessons**

1. **Survivorship bias dominates single-name factor tests.** On *current* constituents, low-vol
   "lost" to high-vol by ~49% and far-from-high beat near-high — the inversion of well-documented
   premia is the tell. Conditioning on current membership = conditioning on survival.
2. **Absolute numbers mislead; benchmark-relative is the honest frame.** At the index level
   (no single-name survivorship), buy-and-hold *beat* the `trend_mom` timing rule on return
   (SPY 15.2% vs 11.0% CAGR; QQQ 21.5% vs 14.4%); timing only cut drawdown/vol.
3. **Long horizon is the real edge.** Forward win-rate rose 84%→100% (1y→3y) and downside
   compressed with horizon.
4. **Overlapping windows + one regime ≠ statistical significance.**

**Shipped this pass (all dependency-free, tested — `npm test`, 98 pass):**

- `priceState` shared helper — one look-ahead-free definition of the trend/momentum signal for
  both the backtest and the forward study (kills triplicated math).
- **Benchmark-relative `benchmark` block** in the brief (stock vs SPY/QQQ trailing CAGR/vol/DD +
  excess) — surfaces the opportunity cost of single-name selection.
- **Backtest honesty:** B&H-vs-timing `verdict`, `turnover`, a 10 bps/flip cost (strategy now net),
  and typed `warnings`.
- **`effectiveN` + `lowConfidence`** on the forward-return study; **`holdingPeriod`** distribution
  promoted into the brief.
- Typed machine-readable `warnings` (absolute-anchors, single-regime/survivorship) in the brief.
- `AbortSignal` fetch timeouts in the Yahoo/Stooq clients; `npm test` script.

**Deferred (documented in METHODOLOGY v2 roadmap, with rationale):** SEC XBRL point-in-time
fundamentals (the highest-value next step — `filed`-date gating enables a *real* factor
backtest); historical index membership for survivorship de-biasing; FRED macro (allowlist-blocked
here); productionized cross-sectional study module; block-bootstrap CIs; expected-return
decomposition. The honest constraint: free *delisted-price* data doesn't exist, so studies can be
made survivorship-*aware* but not survivorship-*free*.
