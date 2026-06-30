// Decision orchestrator: research payload + price history -> extract -> factors
// -> composite -> valuation -> brief. One entry point reused by every decision
// endpoint so a single upstream fetch powers the whole stack.
import { extract } from './extract.js';
import { computeFactors, composite } from './factors.js';
import { valuation } from './valuation.js';
import { buildBrief } from './brief.js';

// Parse a Yahoo chart payload (or Stooq fallback) into normalized daily bars.
export function parseBars(chartData) {
  const res = chartData?.chart?.result?.[0];
  if (res && res.timestamp) {
    const q = res.indicators?.quote?.[0];
    if (!q) return [];
    return res.timestamp
      .map((t, i) => ({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] }))
      .filter((b) => Number.isFinite(b.close));
  }
  if (chartData && chartData.bars) {
    return chartData.bars
      .map((b) => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }))
      .filter((b) => Number.isFinite(b.close));
  }
  return [];
}

function buildDataQuality(research) {
  const errs = research?.errors || {};
  const out = {};
  for (const k of ['summary', 'chart', 'options', 'filings', 'news', 'peers']) {
    out[k] = errs[k] ? 'error' : research?.sources?.[k] ? 'ok' : 'missing';
  }
  return out;
}

export function analyze(research, chartData, opts = {}) {
  const result = research?.sources?.summary?.quoteSummary?.result?.[0] || {};
  const bars = parseBars(chartData);
  const ex = extract(result, bars);
  const { factors, weights } = computeFactors(ex, opts.weights);
  const comp = composite(factors, weights);
  const val = valuation(ex, opts.valuation);
  const dataQuality = buildDataQuality(research);

  // Top recent headlines for LLM context (titles only; full text via /api/article).
  const news = (research?.sources?.news?.news || []).slice(0, 8).map((n) => ({
    title: n.title,
    publisher: n.publisher || null,
    link: n.link || null,
    published: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString().slice(0, 10) : null,
  }));

  // Reliability gating: the composite is a sound screen for ordinary operating
  // companies, but the model masks key factors for financials/REITs, and a low
  // conviction/coverage result should not carry an action label.
  const reliability = ex.sectorClass === 'standard' ? 'standard' : 'limited';
  const actionable = comp.conviction >= 0.4 && comp.coverage >= 0.5 && reliability === 'standard';
  const modelNotes = [];
  if (ex.sectorClass === 'financial')
    modelNotes.push('Financial-sector company: leverage and cash-flow factors are masked because they are uninformative for banks/insurers. Treat the composite as a partial screen, not a rating.');
  if (ex.sectorClass === 'realestate')
    modelNotes.push('Real-estate / REIT company: earnings-based value metrics are unreliable (the sector trades on FFO/AFFO, which we do not have). Treat the composite as a partial screen.');
  if (reliability === 'standard' && !actionable)
    modelNotes.push('Low conviction or thin data coverage — use as a screen only, not a recommendation.');

  const brief = buildBrief({ ex, factors, weights, comp, valuation: val, dataQuality, reliability, actionable, modelNotes, news });
  return { ex, factors, weights, comp, valuation: val, brief, dataQuality, reliability, actionable, modelNotes };
}

// Parse "quality:0.3,value:0.2,..." into a weights override object.
export function parseWeights(str) {
  if (!str) return undefined;
  const out = {};
  for (const part of str.split(',')) {
    const [k, v] = part.split(':');
    const num = parseFloat(v);
    if (k && Number.isFinite(num)) out[k.trim()] = num;
  }
  return Object.keys(out).length ? out : undefined;
}
