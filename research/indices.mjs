import * as yahoo from '../lib/yahoo.js';
import { parseBars } from '../lib/decision.js';
import { backtest } from '../lib/backtest.js';
const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
for (const sym of ['SPY', 'VOO', 'QQQ']) {
  const bars = parseBars(await yahoo.chart(sym, '10y', '1d'));
  const bh = backtest(bars, { rule: 'buyhold' });
  const tm = backtest(bars, { rule: 'trend_mom' });
  const tr = backtest(bars, { rule: 'trend' });
  const f = bh.forwardReturns;
  console.log(`\n### ${sym}  (${bars.length} bars, ${bh.measuredYears}y measured)`);
  console.log(`  Buy&hold:  CAGR ${pct(bh.benchmark.cagr)}  vol ${pct(bh.benchmark.annualVol)}  Sharpe ${bh.benchmark.sharpe.toFixed(2)}  maxDD ${pct(bh.benchmark.maxDrawdown)}`);
  console.log(`  trend_mom: CAGR ${pct(tm.strategy.cagr)}  vol ${pct(tm.strategy.annualVol)}  Sharpe ${tm.strategy.sharpe.toFixed(2)}  maxDD ${pct(tm.strategy.maxDrawdown)}  exposure ${pct(tm.exposure)}`);
  console.log(`  trend:     CAGR ${pct(tr.strategy.cagr)}  vol ${pct(tr.strategy.annualVol)}  Sharpe ${tr.strategy.sharpe.toFixed(2)}  maxDD ${pct(tr.strategy.maxDrawdown)}  exposure ${pct(tr.exposure)}`);
  if (f) for (const k of ['y1','y2','y3']) if (f[k]) {
    const a = f[k].all, b = f[k].trendMomBullish, n = f[k].trendMomBearish;
    console.log(`  fwd ${k}: all med ${pct(a.median)} (%pos ${pct(a.pctPositive)})  | entered bullish med ${pct(b?.median)} (%pos ${pct(b?.pctPositive)})  | bearish med ${pct(n?.median)} (%pos ${pct(n?.pctPositive)})`);
  }
}
