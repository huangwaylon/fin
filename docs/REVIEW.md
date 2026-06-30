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
