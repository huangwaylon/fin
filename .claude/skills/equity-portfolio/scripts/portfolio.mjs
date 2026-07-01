#!/usr/bin/env node
// equity-portfolio: build a weighted basket from a shortlist + report risk structure.
//
// Usage:
//   node portfolio.mjs AAPL MSFT NVDA V [--method invvol|equal|minvar] [--range 3y] [--md]
//
// Technique: from aligned daily returns build the covariance matrix, then weight by
//   equal      -> 1/N
//   invvol     -> inverse annualized vol (risk-parity-lite, the default)
//   minvar     -> long-only minimum-variance via projected gradient descent
// Reports portfolio vol, realized CAGR, Sharpe, diversification ratio, and each
// holding's risk contribution. No look-ahead: stats are realized over the window.

import {
  closes, alignByDate, parseTickers, getFlag, logReturns, cagr, annualVol, std,
  covariance, sharpe, maxDrawdown, r2, pct, num, mdTable, emit, TRADING_DAYS,
} from '../../_shared/quant.mjs';

const argv = process.argv.slice(2);
const asMd = argv.includes('--md');
const mFlag = getFlag(argv, '--method');
const METHODS = ['invvol', 'equal', 'minvar'];
const method = mFlag.value || 'invvol';
if (!METHODS.includes(method)) { console.error(`--method must be one of ${METHODS.join('|')}`); process.exit(1); }
const rFlag = getFlag(argv, '--range');
const range = rFlag.value || '3y';
const skip = new Set([mFlag.valueIdx, rFlag.valueIdx].filter(i => i >= 0));
const tickers = parseTickers(argv.filter((a, i) => !a.startsWith('--') && !skip.has(i)));

if (tickers.length < 2) { console.error('usage: node portfolio.mjs <tickers...> [--method invvol|equal|minvar] [--range 3y] [--md]'); process.exit(1); }

const priceMap = {};
await Promise.all(tickers.map(async s => { try { priceMap[s] = await closes(s, range); } catch { priceMap[s] = { dates: [], closes: [] }; } }));
const syms = tickers.filter(s => (priceMap[s]?.closes?.length || 0) > 30);
if (syms.length < 2) { console.error('Not enough price history for >=2 names.'); process.exit(1); }

const aligned = alignByDate(Object.fromEntries(syms.map(s => [s, priceMap[s]])));
const rets = syms.map(s => logReturns(aligned.series[s]));
const n = syms.length;

// Covariance matrix (daily), annualized, with a tiny ridge on the diagonal so a
// near-singular matrix (collinear names, or fewer bars than assets) stays stable.
const rawCov = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => covariance(rets[i], rets[j]) * TRADING_DAYS));
const trace = rawCov.reduce((s, _r, i) => s + rawCov[i][i], 0);
const ridge = (trace / n) * 1e-6;
const cov = rawCov.map((row, i) => row.map((v, j) => i === j ? v + ridge : v));
const thinData = aligned.dates.length < 2 * n; // warn if window is short relative to # names
const vols = syms.map((_, i) => Math.sqrt(cov[i][i]));

function portVol(w) {
  let v = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += w[i] * w[j] * cov[i][j];
  return Math.sqrt(Math.max(v, 0));
}

let w;
if (method === 'equal') w = Array(n).fill(1 / n);
else if (method === 'minvar') {
  // Long-only min-variance via projected gradient descent on wᵀΣw over the simplex.
  // Step size scaled to the problem (1/largest diagonal proxy for the spectral norm),
  // with an early stop when weights stop moving.
  w = Array(n).fill(1 / n);
  const maxDiag = Math.max(...cov.map((r, i) => r[i]), 1e-9);
  const lr = 1 / (2 * maxDiag);
  for (let it = 0; it < 5000; it++) {
    const grad = w.map((_, i) => 2 * cov[i].reduce((s, cij, j) => s + cij * w[j], 0));
    const nw = projectSimplex(w.map((wi, i) => wi - lr * grad[i]));
    const move = Math.sqrt(nw.reduce((s, x, i) => s + (x - w[i]) ** 2, 0));
    w = nw;
    if (move < 1e-9) break;
  }
} else { // invvol (default)
  const inv = vols.map(v => v > 0 ? 1 / v : 0);
  const s = inv.reduce((a, b) => a + b, 0) || 1;
  w = inv.map(x => x / s);
}

function projectSimplex(v) {
  const u = [...v].sort((a, b) => b - a);
  let css = 0, rho = -1;
  for (let i = 0; i < u.length; i++) { css += u[i]; if (u[i] + (1 - css) / (i + 1) > 0) rho = i; }
  const cssR = u.slice(0, rho + 1).reduce((a, b) => a + b, 0);
  const theta = (cssR - 1) / (rho + 1);
  return v.map(x => Math.max(x - theta, 0));
}

// Portfolio realized series (rebalanced-weight approximation: weighted daily returns).
const T = rets[0].length;
const portRets = Array.from({ length: T }, (_, t) => syms.reduce((s, _s, i) => s + w[i] * rets[i][t], 0));
const portCloses = [1]; for (const r of portRets) portCloses.push(portCloses[portCloses.length - 1] * Math.exp(r));

const pv = portVol(w);
const weightedAvgVol = syms.reduce((s, _s, i) => s + w[i] * vols[i], 0);
const diversificationRatio = pv > 0 ? weightedAvgVol / pv : null;

// Risk contribution_i = w_i * (Cov*w)_i / portVol
const cw = syms.map((_, i) => cov[i].reduce((s, cij, j) => s + cij * w[j], 0));
const riskContrib = syms.map((_, i) => pv > 0 ? (w[i] * cw[i]) / (pv * pv) : null);

const holdings = syms.map((s, i) => ({
  symbol: s, weight: r2(w[i], 4), annualVol: r2(vols[i], 3),
  riskContribPct: r2(riskContrib[i], 4), soloCagr: r2(cagr(aligned.series[s]), 3),
}));

const result = {
  skill: 'equity-portfolio', method, range, alignedBars: aligned.dates.length, holdings,
  portfolio: {
    annualVol: r2(pv, 3), realizedCagr: r2(cagr(portCloses), 3),
    sharpe: r2(sharpe(portRets), 2), maxDrawdown: r2(maxDrawdown(portCloses), 3),
    diversificationRatio: r2(diversificationRatio, 2),
  },
  warnings: thinData ? [`Only ${aligned.dates.length} common bars for ${n} names — covariance estimate is noisy.`] : [],
  note: 'Covariance annualized (252d, tiny ridge on diagonal) from aligned daily log returns. invvol=risk-parity-lite; minvar=long-only projected-gradient min-variance. Portfolio stats apply the final weights retroactively with daily rebalancing — they are IN-SAMPLE (weights derived from this same window) and realized, NOT an out-of-sample backtest or forecast. Equal-risk would imply riskContribPct ~ 1/N.',
};

emit(result, asMd, o => {
  const cols = [['symbol', 'Ticker'], ['weight', 'Weight'], ['annualVol', 'Vol'],
    ['riskContribPct', 'RiskContrib'], ['soloCagr', 'SoloCAGR']];
  const rows = o.holdings.map(h => ({ symbol: h.symbol, weight: pct(h.weight), annualVol: pct(h.annualVol), riskContribPct: pct(h.riskContribPct), soloCagr: pct(h.soloCagr) }));
  const p = o.portfolio;
  return `# equity-portfolio (${o.method}, range=${o.range})\n\n` + mdTable(rows, cols) +
    `\n\n**Portfolio:** vol ${pct(p.annualVol)} · realized CAGR ${pct(p.realizedCagr)} · Sharpe ${num(p.sharpe)} · maxDD ${pct(p.maxDrawdown)} · diversification ratio ${num(p.diversificationRatio)}` +
    `\n\n_${o.note}_`;
});
