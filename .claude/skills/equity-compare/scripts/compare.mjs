#!/usr/bin/env node
// equity-compare: head-to-head risk/return + correlation matrix for N tickers.
//
// Usage:
//   node compare.mjs AAPL MSFT NVDA [--range 5y] [--md]
//
// Technique: pull aligned adjusted-close history, compute per-name CAGR, annualized
// vol, Sharpe, Sortino, max drawdown, 12-1 momentum, and the pairwise daily-return
// correlation matrix (diversification view). Snapshot/score endpoints add valuation
// and factor context. All from data <= today; no look-ahead.

import {
  tryApi, closes, alignByDate, parseTickers, getFlag, logReturns, cagr, annualVol,
  sharpe, sortino, maxDrawdown, mom12_1, correlation, r2, pct, num, mdTable, emit,
} from '../../_shared/quant.mjs';

const argv = process.argv.slice(2);
const asMd = argv.includes('--md');
const rFlag = getFlag(argv, '--range');
const range = rFlag.value || '5y';
const tickers = parseTickers(argv.filter((a, i) => !a.startsWith('--') && i !== rFlag.valueIdx));

if (tickers.length < 2) { console.error('usage: node compare.mjs <ticker> <ticker> [...] [--range 5y] [--md]'); process.exit(1); }

// Fetch price series + lightweight fundamentals in parallel.
const priceMap = {};
const meta = {};
await Promise.all(tickers.map(async sym => {
  try { priceMap[sym] = await closes(sym, range); } catch { priceMap[sym] = { dates: [], closes: [] }; }
  const snap = await tryApi(`/api/snapshot?symbol=${encodeURIComponent(sym)}`);
  meta[sym] = snap.ok ? snap.data : {};
}));

const usable = tickers.filter(s => (priceMap[s]?.closes?.length || 0) > 30);
const aligned = alignByDate(Object.fromEntries(usable.map(s => [s, priceMap[s]])));

// Per-name stats use the COMMON aligned window so the table and the correlation
// matrix describe the same period (a name with too little history is flagged).
const stats = tickers.map(sym => {
  const inWindow = usable.includes(sym);
  const c = inWindow ? aligned.series[sym] : (priceMap[sym]?.closes || []);
  const m = meta[sym] || {};
  const rets = c.length > 2 ? logReturns(c) : [];
  return {
    symbol: sym, name: m.name ?? null, price: m.price ?? null, windowed: inWindow,
    pe: m.pe ?? null, forwardPe: m.forwardPe ?? null, beta: m.beta ?? null,
    cagr: r2(cagr(c), 3), annualVol: r2(annualVol(rets), 3), sharpe: r2(sharpe(rets), 2),
    sortino: r2(sortino(rets), 2), maxDrawdown: r2(maxDrawdown(c), 3),
    mom12_1: r2(mom12_1(c), 3), bars: c.length,
  };
});

// Correlation matrix on aligned daily log returns.
const retSeries = {};
for (const s of usable) retSeries[s] = logReturns(aligned.series[s]);
const corr = {};
for (const a of usable) { corr[a] = {}; for (const b of usable) corr[a][b] = r2(correlation(retSeries[a], retSeries[b]), 2); }
const avgPairCorr = (() => {
  const vals = [];
  for (let i = 0; i < usable.length; i++) for (let j = i + 1; j < usable.length; j++) vals.push(corr[usable[i]][usable[j]]);
  return vals.length ? r2(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : null;
})();

const result = {
  skill: 'equity-compare', range, alignedBars: aligned.dates.length,
  stats, correlation: corr, avgPairwiseCorrelation: avgPairCorr,
  note: 'Returns from adjusted close over the COMMON aligned window, annualized (252d), rf=0. Stats and correlation share that window. CAGR is realized over the window (not a forecast). windowed=false => insufficient common history; stats fall back to the name\'s own series and it is excluded from the correlation matrix.',
};

emit(result, asMd, o => {
  const sr = o.stats.map(s => ({
    symbol: s.symbol, cagr: pct(s.cagr), vol: pct(s.annualVol), sharpe: num(s.sharpe),
    maxDD: pct(s.maxDrawdown), mom: pct(s.mom12_1), beta: num(s.beta), pe: num(s.pe, 1),
  }));
  const cols = [['symbol', 'Ticker'], ['cagr', 'CAGR'], ['vol', 'Vol'], ['sharpe', 'Sharpe'],
    ['maxDD', 'MaxDD'], ['mom', 'Mom12-1'], ['beta', 'Beta'], ['pe', 'P/E']];
  let out = `# equity-compare (range=${o.range}, aligned ${o.alignedBars} bars)\n\n` + mdTable(sr, cols);
  if (usable.length) {
    out += `\n\n## Correlation (daily returns)\n\n`;
    out += `| | ${usable.join(' | ')} |\n| ${['---', ...usable.map(() => '---')].join(' | ')} |\n`;
    out += usable.map(a => `| **${a}** | ${usable.map(b => o.correlation[a][b]).join(' | ')} |`).join('\n');
    out += `\n\nAvg pairwise correlation: **${o.avgPairwiseCorrelation}**`;
  }
  return out + `\n\n_${o.note}_`;
});
