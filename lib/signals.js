// Price-derived signals: trend, momentum, volatility, drawdown.
// Operates on daily OHLCV bars [{ time, open, high, low, close, adjClose, volume }].
// Convention: point-to-point RETURNS (momentum, multi-month returns, drawdown,
// volatility) use the dividend/split-adjusted close so they reflect TOTAL return
// — the number a 1yr+ holder actually earns. Price LEVELS and level-crossing
// signals (SMAs, golden/death cross, 52-week hi/lo, trend) use the raw close so
// the displayed levels match the real quote. All computations use only past data
// relative to each point (no look-ahead).
import { isNum, mean, stdev, clamp } from './quantutil.js';

const TD = { '1m': 21, '3m': 63, '6m': 126, '12m': 252 }; // trading-day windows

function smaAt(closes, end, period) {
  if (end + 1 < period) return null;
  let s = 0;
  for (let i = end - period + 1; i <= end; i++) s += closes[i];
  return s / period;
}

export function ret(closes, days) {
  const n = closes.length;
  if (n <= days) return null;
  const a = closes[n - 1 - days];
  const b = closes[n - 1];
  return isNum(a) && isNum(b) && a > 0 ? b / a - 1 : null;
}

export function maxDrawdown(closes) {
  let peak = -Infinity;
  let mdd = 0;
  for (const c of closes) {
    if (!isNum(c)) continue;
    if (c > peak) peak = c;
    if (peak > 0) mdd = Math.min(mdd, c / peak - 1);
  }
  return mdd; // negative number, e.g. -0.32
}

export function annualVol(closes) {
  const rets = [];
  for (let i = 1; i < closes.length; i++) {
    if (isNum(closes[i]) && isNum(closes[i - 1]) && closes[i - 1] > 0) {
      rets.push(closes[i] / closes[i - 1] - 1);
    }
  }
  const sd = stdev(rets);
  return isNum(sd) ? sd * Math.sqrt(252) : null;
}

export function computeSignals(bars) {
  if (!bars || bars.length < 30) return null;
  const valid = bars.filter((b) => isNum(b.close));
  const closes = valid.map((b) => b.close); // raw — price levels & trend
  const adj = valid.map((b) => (isNum(b.adjClose) ? b.adjClose : b.close)); // total return — returns
  const n = closes.length;
  if (n < 30) return null;
  const last = closes[n - 1];

  const sma50 = smaAt(closes, n - 1, 50);
  const sma200 = smaAt(closes, n - 1, 200);
  const sma50Prev = smaAt(closes, n - 11, 50);
  const sma200Prev = smaAt(closes, n - 11, 200);

  let cross = null;
  if (isNum(sma50) && isNum(sma200) && isNum(sma50Prev) && isNum(sma200Prev)) {
    if (sma50Prev <= sma200Prev && sma50 > sma200) cross = 'golden'; // bullish, recent
    else if (sma50Prev >= sma200Prev && sma50 < sma200) cross = 'death';
  }

  // 52-week range position (raw price levels)
  const window = closes.slice(Math.max(0, n - 252));
  const hi = Math.max(...window);
  const lo = Math.min(...window);
  const week52pos = hi > lo ? clamp((last - lo) / (hi - lo), 0, 1) : null;

  // 12–1 momentum: total return from ~12 months ago to ~1 month ago (adjusted)
  let mom12_1 = null;
  if (n > TD['12m']) {
    const a = adj[n - 1 - TD['12m']];
    const b = adj[n - 1 - TD['1m']];
    if (isNum(a) && isNum(b) && a > 0) mom12_1 = b / a - 1;
  }

  return {
    nBars: n,
    last,
    sma50,
    sma200,
    priceVsSma200: isNum(sma200) && sma200 > 0 ? last / sma200 - 1 : null,
    priceVsSma50: isNum(sma50) && sma50 > 0 ? last / sma50 - 1 : null,
    trend: isNum(sma200) ? (last > sma200 ? 'up' : 'down') : null,
    cross,
    ret1m: ret(adj, TD['1m']),
    ret3m: ret(adj, TD['3m']),
    ret6m: ret(adj, TD['6m']),
    ret12m: ret(adj, TD['12m']),
    mom12_1,
    week52High: hi,
    week52Low: lo,
    week52pos,
    annualVol: annualVol(adj),
    maxDrawdown: maxDrawdown(adj),
  };
}
