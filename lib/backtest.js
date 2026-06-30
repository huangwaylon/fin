// Walk-forward backtester for PRICE-BASED signals only.
//
// Why price-only: we have full price history but not point-in-time fundamentals,
// so a fundamental-factor backtest would embed look-ahead/restatement bias. Here
// the position for day t+1 is decided using only closes[0..t], then the t->t+1
// return is realized. This makes the test honest, if necessarily descriptive.
import { isNum, mean, stdev } from './quantutil.js';

const RULES = {
  buyhold: () => 1,
  trend: (c, sma200) => (isNum(sma200) && c > sma200 ? 1 : 0),
  mom: (c, sma200, mom) => (isNum(mom) && mom > 0 ? 1 : 0),
  trend_mom: (c, sma200, mom) =>
    isNum(sma200) && isNum(mom) && c > sma200 && mom > 0 ? 1 : 0,
};

function metrics(dailyReturns, rf = 0) {
  const r = dailyReturns.filter(isNum);
  if (r.length < 20) return null;
  let equity = 1;
  let peak = 1;
  let mdd = 0;
  const curve = [equity];
  for (const x of r) {
    equity *= 1 + x;
    curve.push(equity);
    if (equity > peak) peak = equity;
    mdd = Math.min(mdd, equity / peak - 1);
  }
  const years = r.length / 252;
  const cagr = equity ** (1 / years) - 1;
  const vol = stdev(r) * Math.sqrt(252);
  const annMean = mean(r) * 252;
  const downside = r.filter((x) => x < 0);
  const downDev = downside.length ? Math.sqrt(mean(downside.map((x) => x * x))) * Math.sqrt(252) : null;
  const inMarket = r.filter((x) => x !== 0);
  return {
    totalReturn: equity - 1,
    cagr,
    annualVol: vol,
    sharpe: isNum(vol) && vol > 0 ? (annMean - rf) / vol : null,
    sortino: isNum(downDev) && downDev > 0 ? (annMean - rf) / downDev : null,
    maxDrawdown: mdd,
    hitRate: inMarket.length ? inMarket.filter((x) => x > 0).length / inMarket.length : null,
    _curve: curve,
  };
}

export function backtest(bars, { rule = 'trend_mom', years = null, rf = 0 } = {}) {
  // Drop any non-finite closes (the Stooq fallback can carry blanks/NaN) so they
  // can't poison prefix-sum SMAs or forward returns.
  const clean = (bars || []).filter((b) => Number.isFinite(b.close));
  if (clean.length < 300) {
    return { error: 'Need at least ~300 daily bars (warmup + measurement) to backtest.' };
  }
  const decide = RULES[rule] || RULES.trend_mom;
  const closes = clean.map((b) => b.close);
  const n = closes.length;

  // Prefix sums for O(1) SMA.
  const prefix = [0];
  for (let i = 0; i < n; i++) prefix.push(prefix[i] + closes[i]);
  const smaAt = (end, p) => (end + 1 < p ? null : (prefix[end + 1] - prefix[end + 1 - p]) / p);

  // Need 252 bars of warmup for 12–1 momentum.
  const warmup = 252;
  const measuredStart = years ? Math.max(warmup, n - Math.round(years * 252)) : warmup;

  const stratRet = [];
  const benchRet = [];
  const exposure = [];
  const dates = [];

  for (let t = measuredStart; t < n - 1; t++) {
    const c = closes[t];
    const sma200 = smaAt(t, 200);
    const mom = c > 0 && isNum(closes[t - 252]) && closes[t - 252] > 0
      ? closes[t - 21] / closes[t - 252] - 1
      : null;
    const pos = decide(c, sma200, mom);
    const fwd = closes[t + 1] / closes[t] - 1; // realized t->t+1
    stratRet.push(pos * fwd);
    benchRet.push(fwd);
    exposure.push(pos);
    dates.push(clean[t + 1].time);
  }

  const strat = metrics(stratRet, rf);
  const bench = metrics(benchRet, rf);
  if (!strat || !bench) return { error: 'Insufficient measured window.' };

  // Build equity curves aligned to realized dates, downsampled to ~300 points.
  const step = Math.max(1, Math.floor(stratRet.length / 300));
  const curve = [];
  let se = 1;
  let be = 1;
  for (let i = 0; i < stratRet.length; i++) {
    se *= 1 + stratRet[i];
    be *= 1 + benchRet[i];
    if (i % step === 0 || i === stratRet.length - 1) {
      curve.push({ time: dates[i], strategy: +se.toFixed(4), benchmark: +be.toFixed(4) });
    }
  }
  delete strat._curve;
  delete bench._curve;

  return {
    rule,
    rf,
    measuredYears: +(stratRet.length / 252).toFixed(2),
    exposure: +mean(exposure).toFixed(3), // fraction of time in market
    strategy: strat,
    benchmark: bench, // buy & hold of the same asset
    curve,
    caveats: [
      'Price-based signal only; ignores fundamentals, dividends, costs, slippage, and taxes.',
      'Single-name result — not a portfolio strategy and not statistically robust on its own.',
      'Past behavior is descriptive, not predictive.',
    ],
  };
}
