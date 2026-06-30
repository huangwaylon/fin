# Methodology

How the decision layer turns aggregated data into a score, a fair value, signals,
and a backtest. Everything here is as implemented in `lib/*.js`; nothing is
aspirational.

## Principles

1. **Transparency.** Every score traces to its inputs and the exact piecewise-linear
   formula. No fitted weights, no black boxes.
2. **No fabrication.** Missing data is `null`, never guessed. It lowers *conviction*
   and *coverage*; it does not default to a neutral score.
3. **No look-ahead.** Any time-series value at time *t* uses only data ≤ *t*; enforced
   in the backtester (position at *t*, return realized *t→t+1*).
4. **Human + machine parity.** UI and the JSON/Markdown brief render from the *same*
   computed object, so a person and an LLM see identical numbers.
5. **Long-term orientation.** Factors, anchors, and weights favor durable quality,
   sane valuation, and multi-year trend over short-term noise.

## Factor model (`lib/factors.js`)

Six factors, each scored 0–100 from its inputs via piecewise-linear maps:
`scoreUp(x, lo, hi)` (higher is better, 0 at `lo`, 100 at `hi`) and
`scoreDown(x, lo, hi)` (lower is better, 100 at `lo`, 0 at `hi`). Anchors are
absolute thresholds, not cross-sectional ranks.

| Factor | Input (key) | Map | lo → hi | Input wt |
| --- | --- | --- | --- | --- |
| **Quality** | ROE | up | 0 → 0.30 | .18 |
| | ROA | up | 0 → 0.15 | .10 |
| | ROIC | up | 0.08 → 0.30 | .14 |
| | Gross margin | up | 0.10 → 0.60 | .12 |
| | Operating margin | up | 0 → 0.30 | .12 |
| | Net margin | up | 0 → 0.25 | .12 |
| | FCF margin | up | 0 → 0.25 | .12 |
| | Cash conversion (CFO/NI) | up | 0.60 → 1.20 | .10 |
| **Value** | Earnings yield (1/PE) | up | 0 → 0.10 | .25 |
| | Forward earnings yield (1/fwdPE) | up | 0 → 0.10 | .15 |
| | FCF yield | up | 0 → 0.08 | .20 |
| | EV/EBITDA | down | 6 → 30 | .20 |
| | Price/Book | down | 1 → 12 | .08 |
| | Price/Sales | down | 1 → 15 | .07 |
| | PEG | down | 0.8 → 3 | .05 |
| **Growth** | Revenue CAGR (Ny) | up | 0 → 0.25 | .25 |
| | EPS CAGR (Ny) | up | 0 → 0.30 | .25 |
| | Revenue growth YoY | up | 0 → 0.25 | .20 |
| | Earnings growth YoY | up | 0 → 0.30 | .20 |
| | Forward EPS growth | up | 0 → 0.25 | .10 |
| **Health** | Debt/Equity (%) | down | 0 → 150 | .25 |
| | Net debt/EBITDA | down | 0 → 4 | .25 |
| | Current ratio | up | 1 → 3 | .20 |
| | Interest coverage | up | 2 → 15 | .20 |
| | FCF positive | 100/0 flag | — | .10 |
| **Momentum** | 12–1 month return | up | −0.20 → 0.40 | .35 |
| | 6-month return | up | −0.15 → 0.30 | .25 |
| | Price vs 200d SMA | up | −0.15 → 0.20 | .25 |
| | 52-week range position | up | 0.20 → 0.95 | .15 |
| **Shareholder yield** | Dividend + net buyback yield | up | 0 → 0.08 | .80 |
| | Payout sustainability | down | 0.30 → 1.0 | .20 |

Notes: `debtToEquity` arrives from Yahoo as a percentage (79.5 = 0.795×). Forward EPS
growth = `forwardEps/trailingEps − 1`; forward earnings yield = `1/forwardPE` (cross-checks
trailing earnings yield and dampens the cyclical "cheap on peak earnings" trap). Shareholder
yield = dividend yield + average buyback yield (repurchases averaged over available annual
cash flows; clamped to a sane range). **ROIC** = `EBIT·(1−21%) / (totalDebt + bookEquity)`,
with `bookEquity ≈ marketCap/P/B` and EBIT derived from `operatingMargin × revenue` (Yahoo's
income-statement `ebit`/`operatingIncome` fields are often sparse/zero); null when book equity
is unavailable or invested capital is non-positive, so a buyback-thinned equity never prints an
absurd ROIC. **Cash conversion** = `operatingCashFlow / netIncome` (earnings-quality / accruals
check). Dividend yield is normalized to a fraction (a value > 1 is treated as a percent).

**Factor score** = coverage-weighted blend of present inputs (`blend`); each factor
also reports `coverage` = fraction of its inputs present.

**Composite** = weighted blend of factor scores. Default weights (long-term tilt):

| quality | value | growth | health | momentum | shareholderYield |
| --- | --- | --- | --- | --- | --- |
| 0.22 | 0.20 | 0.18 | 0.15 | 0.15 | 0.10 |

Overridable per request (`?weights=quality:0.3,value:0.2,...`).

**Rating bands:** ≥80 Strong Buy · 65–79 Buy · 50–64 Hold · 35–49 Reduce · <35 Avoid.
No rating when the composite is null.

**Conviction (0–1)** = `coverage × (1 − min(dispersion/40, 0.5))`, where dispersion is
the stdev of present factor scores (null if <2 factors). Rewards data coverage,
penalizes factor disagreement; clamped to [0, 1].

### Sector awareness

Standard quality/value/leverage metrics break for some sectors, so we mask the
inapplicable inputs to `null` (they neither score nor inflate coverage):

| Sector class | Masked inputs |
| --- | --- |
| `financial` (banks, insurance, capital markets) | evEbitda, netDebtToEbitda, currentRatio, interestCoverage, debtToEquity, fcfYield, fcfMargin, fcf, roic, cashConversion |
| `realestate` (REITs) | earningsYield, peg, netDebtToEbitda, debtToEquity, roic, cashConversion |

For any non-`standard` sector, `reliability = 'limited'` and a model note is attached.
A result is flagged **`actionable`** only when:

```
conviction ≥ 0.4  AND  coverage ≥ 0.5  AND  sectorClass == 'standard'
```

Non-actionable briefs render the rating as "screen only — not actionable".

## Valuation (`lib/valuation.js`)

**2-stage FCFF DCF discounted at WACC.** Discount free cash flow to the firm, fade
growth linearly from a stage-1 estimate `g1` to terminal `gT` over N years, then bridge
to equity: `(EV − netDebt) / sharesOut`.

- **Cost of equity** (CAPM): `riskFree + β·ERP`, with β clamped to [0.5, 2.0] (β=1 if
  missing).
- **WACC:** market-cap/debt weighted blend of cost of equity and after-tax cost of debt
  `(riskFree + creditSpread)·(1 − taxRate)`, clamped to **[6%, 14%]**. Falls back to cost
  of equity when debt info is absent.
- **Stage-1 growth `g1`:** median of available signals (EPS/rev CAGR, YoY rev/earnings
  growth, forward EPS growth), clamped to **[0, 20%]**.
- **Terminal value:** Gordon growth on the faded final-year FCF.

Defaults: `riskFree 4%, ERP 5%, terminalGrowth 2.5%, years 10, taxRate 21%,
creditSpread 2%`.

**`terminalValueShare`** (= terminal PV / EV) is reported so the reader can see how much
of the value rests on the terminal assumption.

**Reverse DCF** solves (via bisection) the stage-1 growth the *current price* implies
through the same equity bridge — "market-implied growth" — to gauge optimism vs our `g1`.

**Value creation (ROIC vs WACC).** The valuation also reports `roic`, `wacc`, and their
spread `valueCreationSpread = ROIC − WACC`. A sustained positive spread is the core
durability test for a multi-year hold; a negative spread raises a risk flag (the business
earns below its cost of capital). ROIC is a rough screen (see factor notes) and gates a
flag, not the composite.

**Graham multiples cross-check:** `forwardEps × clamp(8.5 + 2·(g1·100), 5, 45)`. Reported
as an **independent cross-check only — deliberately NOT blended** into the fair value.
`blendedFairValue == dcfValue`.

**Margin of safety** = `dcfValue/price − 1`. A **3×3 sensitivity grid** varies discount
rate (±1pp) and stage-1 growth (±2pp).

## Signals & risk (`lib/signals.js`)

Computed from daily closes (look-ahead-free): 50/200-day SMA and golden/death cross
state; 12–1 month momentum; 1/3/6/12-month returns; annualized volatility (daily stdev
× √252); max drawdown; 52-week range position; trend = price vs 200d SMA. Feeds the
momentum factor and the risk panel.

**Total-return convention.** Point-to-point *returns* (12–1 momentum, 1/3/6/12-month
returns, volatility, max drawdown) use the dividend/split-**adjusted** close, so they
reflect the total return a holder actually earns — material over multi-year horizons.
Price *levels* and level-crossing signals (SMAs, golden/death cross, 52-week high/low,
trend) use the **raw** close so displayed levels match the real quote. The adjusted series
comes from Yahoo's `adjclose`; it falls back to raw close on the Stooq path (which carries
no dividend adjustment).

## Backtest (`lib/backtest.js`)

Walk-forward, **price-signal only** (we have full price history but not point-in-time
fundamentals, which would embed look-ahead/restatement bias; signals are price-derived,
returns are total-return via adjusted close). Rules:

| Rule | Long (position 1) when |
| --- | --- |
| `buyhold` | always |
| `trend` | close > 200d SMA |
| `mom` | 12–1 momentum > 0 |
| `trend_mom` (default) | close > 200d SMA AND 12–1 momentum > 0 |

Otherwise flat (position 0). **Look-ahead-free:** position for *t→t+1* uses only
`closes[0..t]`; the *t→t+1* return is then realized. Requires ≥300 daily bars (252 warmup
+ measurement); endpoint pulls ~10y daily. Returns use the **adjusted** close (total
return). Metrics: total return, CAGR, annualized vol, Sharpe, Sortino, max drawdown, hit
rate, exposure (time in market), all vs buy-and-hold of the same asset. Sharpe/Sortino use
a 4% annual risk-free rate; Sortino's downside deviation is taken over **all** observations
(target 0), the standard convention. Honest caveats are returned in the payload: it is a
daily-rebalanced *timing* rule (not a buy-and-hold), single-name, ignores costs/slippage/
taxes, and is descriptive, not predictive.

**Forward-holding-period study (`forwardReturns`).** Because a daily-flip timing rule is the
wrong question for a multi-year buyer, the backtest payload also reports the **distribution
of forward 1/2/3-year total returns** (median, p25/p75, min/max, % positive), overall and
conditional on the entry-day state (above 200d SMA *and* positive 12–1 momentum, vs not).
This is what a 1yr+ holder actually faces. Windows overlap, so it is autocorrelated — read
it as descriptive, not as i.i.d. significance.

## Known limitations

Use this tool as a **screen with a human in the loop**, not an oracle.

- **Absolute anchors are sector-blind beyond the two masked sectors.** Utilities and deep
  cyclicals are scored on the same thresholds as everyone else. Trailing multiples are
  pro-cyclical — a cyclical at peak earnings can screen "cheap" exactly when it is most
  dangerous. The forward-earnings-yield input and the margin-vs-history flag (current net
  margin vs its own multi-year average) mitigate but do not eliminate this.
- **Single-name backtest** has no transaction costs/slippage, no confidence intervals, and
  no survivorship correction; it describes one ticker's past, not an edge. The
  forward-return study uses overlapping (autocorrelated) windows.
- **DCF terminal value dominates** long-term value (hence `terminalValueShare`); small
  changes in `gT`/discount swing the answer. The sensitivity grid is the honest reading.
  The DCF returns null for negative-FCF names rather than inventing a normalized base.
- **ROIC is approximate** — book equity is inferred from `marketCap/P-B` and EBIT from
  `operatingMargin × revenue`; it gates a flag, not the score.
- **No moat / qualitative / portfolio / position-sizing analysis.** No competitive,
  management, or regulatory judgment; no correlation or sizing across holdings.

### v2 roadmap

- Sector-relative ranking (peer-normalized factor scores).
- Valuation vs the company's *own* history (not just absolute anchors).
- Scenario / probabilistic valuation (distribution of fair values, not a point).
- Transaction-cost / turnover modeling on the timing backtest.
- Portfolio context (correlation, sizing, exposure).
- Backtest confidence intervals / significance testing.
