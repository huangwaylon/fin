#!/usr/bin/env node
// equity-screen: rank a universe of tickers cross-sectionally on factor scores.
//
// Usage:
//   node screen.mjs AAPL MSFT NVDA ...            # rank by composite
//   node screen.mjs "AAPL,MSFT,NVDA" --weights quality:0.4,value:0.3,growth:0.3
//   node screen.mjs ... --md                      # markdown table
//
// Technique: pull /api/score per name, then z-score each factor cross-sectionally
// and rank. With --weights, build a tilted composite from the z-scored factors so
// the ranking reflects YOUR factor preference rather than the server default.

import { tryApi, parseTickers, parseWeights, getFlag, zscores, pctRanks, r2, mdTable, emit } from '../../_shared/quant.mjs';

const argv = process.argv.slice(2);
const asMd = argv.includes('--md');
const wFlag = getFlag(argv, '--weights');
const weights = wFlag.present ? parseWeights(wFlag.value) : null;
const tickers = parseTickers(argv.filter((a, i) => !a.startsWith('--') && i !== wFlag.valueIdx));

if (!tickers.length) { console.error('usage: node screen.mjs <tickers...> [--weights q:..,v:..] [--md]'); process.exit(1); }

const FACTORS = ['quality', 'value', 'growth', 'health', 'momentum', 'shareholderYield'];

const rows = [];
for (const sym of tickers) {
  const res = await tryApi(`/api/score?symbol=${encodeURIComponent(sym)}`);
  if (!res.ok) { rows.push({ symbol: sym, error: res.error, factors: {} }); continue; }
  const d = res.data;
  const f = {};
  for (const k of FACTORS) f[k] = d.factors?.[k]?.score ?? null;
  rows.push({
    symbol: sym, name: d.name ?? null, price: d.price ?? null,
    composite: d.composite ?? null, rating: d.rating ?? null,
    conviction: d.conviction ?? null, reliability: d.reliability ?? null,
    factors: f,
  });
}

// Cross-sectional z-scores per factor (computed only over names that have data).
const zByFactor = {};
for (const k of FACTORS) zByFactor[k] = zscores(rows.map(r => r.factors[k]));

// Tilted score: weighted sum of factor z-scores when weights given, else server composite.
const wsum = weights ? Object.values(weights).reduce((a, b) => a + Math.abs(b), 0) || 1 : 1;
rows.forEach((row, i) => {
  if (weights) {
    let s = 0, used = 0;
    for (const k of FACTORS) {
      const z = zByFactor[k][i];
      if (z != null && weights[k] != null) { s += (weights[k] / wsum) * z; used += Math.abs(weights[k]) / wsum; }
    }
    row.tiltedZ = used > 0 ? r2(s, 3) : null;
  }
  row.rankScore = weights ? row.tiltedZ : row.composite;
});

// Cross-sectional percentile of the ranking score.
const pr = pctRanks(rows.map(r => r.rankScore));
rows.forEach((r, i) => { r.pctile = pr[i] == null ? null : r2(pr[i], 3); });

const ranked = [...rows].sort((a, b) => (b.rankScore ?? -Infinity) - (a.rankScore ?? -Infinity));
ranked.forEach((r, i) => { r.rank = r.rankScore == null ? null : i + 1; });

const result = {
  skill: 'equity-screen',
  basis: weights ? { method: 'tilted-z', weights } : { method: 'server-composite' },
  count: tickers.length,
  ranked: ranked.map(r => ({
    rank: r.rank, symbol: r.symbol, name: r.name, rating: r.rating,
    rankScore: r2(r.rankScore, 2), pctile: r.pctile, composite: r2(r.composite, 1),
    quality: r2(r.factors.quality, 0), value: r2(r.factors.value, 0),
    growth: r2(r.factors.growth, 0), health: r2(r.factors.health, 0),
    momentum: r2(r.factors.momentum, 0), shareholderYield: r2(r.factors.shareholderYield, 0),
    conviction: r.conviction, reliability: r.reliability, error: r.error,
  })),
  note: 'Factor scores 0-100. tilted-z ranks by weighted cross-sectional z-scores. Missing data => null (never guessed). reliability=limited => financials/REITs (screen only).',
};

emit(result, asMd, o => {
  const cols = [['rank', '#'], ['symbol', 'Ticker'], ['rating', 'Rating'],
    ['rankScore', 'Score'], ['pctile', 'Pctile'], ['quality', 'Q'], ['value', 'V'],
    ['growth', 'G'], ['health', 'H'], ['momentum', 'M'], ['shareholderYield', 'Y'],
    ['reliability', 'Rel']];
  return `# equity-screen (${o.basis.method}, n=${o.count})\n\n` + mdTable(o.ranked, cols) +
    `\n\n_${o.note}_`;
});
