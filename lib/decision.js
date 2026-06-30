// Decision orchestrator: research payload + price history -> extract -> factors
// -> composite -> valuation -> brief. One entry point reused by every decision
// endpoint so a single upstream fetch powers the whole stack.
import { extract } from './extract.js';
import { computeFactors, composite, DEFAULT_WEIGHTS } from './factors.js';
import { valuation } from './valuation.js';
import { buildBrief } from './brief.js';
import { forwardReturnStudy } from './backtest.js';
import { annualVol, maxDrawdown } from './signals.js';
import { isNum } from './quantutil.js';

// Parse a Yahoo chart payload (or Stooq fallback) into normalized daily bars.
// We keep BOTH the raw `close` (for candles and real price levels) and the
// dividend/split-adjusted `adjClose` (for return/momentum/backtest math). Yahoo
// returns the adjusted series alongside quote when `events=div,split` is set;
// when it is absent (Stooq fallback), adjClose falls back to raw close.
export function parseBars(chartData) {
  const res = chartData?.chart?.result?.[0];
  if (res && res.timestamp) {
    const q = res.indicators?.quote?.[0];
    if (!q) return [];
    const adj = res.indicators?.adjclose?.[0]?.adjclose;
    return res.timestamp
      .map((t, i) => ({
        time: t,
        open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i],
        adjClose: adj && Number.isFinite(adj[i]) ? adj[i] : q.close[i],
      }))
      .filter((b) => Number.isFinite(b.close));
  }
  if (chartData && chartData.bars) {
    return chartData.bars
      .map((b) => ({
        time: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
        adjClose: Number.isFinite(b.adjClose) ? b.adjClose : b.close,
      }))
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

  // Forward holding-period return distribution (look-ahead-free) and how the name
  // stacks up against the index it would otherwise be bought instead of. These turn
  // a point score into the distribution-and-opportunity-cost view a 1yr+ holder needs.
  const holdingPeriod = forwardReturnStudy(bars);
  const benchmark = benchmarkComparison(bars, opts.benchmarks);

  // Machine-readable honesty flags so a consumer (UI/LLM) can't misread the numbers.
  const warnings = [
    { code: 'absolute_anchors', message: 'Factor scores use absolute thresholds, not benchmark/sector-relative ranks. Compare returns to the benchmark block before concluding the stock is attractive.' },
  ];
  if (holdingPeriod)
    warnings.push({ code: 'single_regime_survivorship', message: 'Holding-period history is one surviving name over a single recent regime; it is descriptive, not a forecast, and is conditioned on the company not having been delisted.' });

  const brief = buildBrief({ ex, factors, weights, comp, valuation: val, dataQuality, reliability, actionable, modelNotes, news, holdingPeriod, benchmark, warnings });
  return { ex, factors, weights, comp, valuation: val, brief, dataQuality, reliability, actionable, modelNotes, holdingPeriod, benchmark, warnings };
}

// Trailing total-return stats (adjusted close) for a name and the index benchmarks
// it competes with — the opportunity-cost view. CAGRs are annualized over matched
// look-backs; vol/drawdown over the last ~3y. Returns null benchmarks on missing
// data (never fabricated). `benchmarks` is { LABEL: bars[] }.
function benchmarkComparison(stockBars, benchmarks) {
  if (!benchmarks || !stockBars?.length) return null;
  const trailing = (bars) => {
    const px = (bars || []).map((b) => (isNum(b.adjClose) ? b.adjClose : b.close)).filter(isNum);
    const n = px.length;
    if (n < 252) return null;
    const cagr = (days) => (n > days && px[n - 1 - days] > 0 ? (px[n - 1] / px[n - 1 - days]) ** (252 / days) - 1 : null);
    const w = px.slice(Math.max(0, n - 756));
    return { cagr1y: cagr(252), cagr3y: cagr(756), cagr5y: cagr(1260), vol: annualVol(w), maxDrawdown: maxDrawdown(w), bars: n };
  };
  const stock = trailing(stockBars);
  if (!stock) return null;
  const out = { note: 'Trailing total return vs index (the default alternative to a single name). Excess = stock − index; not risk-adjusted alpha.', stock, indices: {}, excess: {} };
  for (const [label, bars] of Object.entries(benchmarks)) {
    const t = trailing(bars);
    if (!t) continue;
    out.indices[label] = t;
    out.excess[label] = {
      cagr1y: isNum(stock.cagr1y) && isNum(t.cagr1y) ? +(stock.cagr1y - t.cagr1y).toFixed(4) : null,
      cagr3y: isNum(stock.cagr3y) && isNum(t.cagr3y) ? +(stock.cagr3y - t.cagr3y).toFixed(4) : null,
      cagr5y: isNum(stock.cagr5y) && isNum(t.cagr5y) ? +(stock.cagr5y - t.cagr5y).toFixed(4) : null,
    };
  }
  return Object.keys(out.indices).length ? out : null;
}

// Parse "quality:0.3,value:0.2,..." into a weights override object. Only known
// factor keys with finite, non-negative values are accepted; anything else is
// ignored so a malformed/hostile query can't invert or blow up the composite.
export function parseWeights(str) {
  if (!str) return undefined;
  const allowed = new Set(Object.keys(DEFAULT_WEIGHTS));
  const out = {};
  for (const part of str.split(',')) {
    const [k, v] = part.split(':');
    const key = k && k.trim();
    const num = parseFloat(v);
    if (key && allowed.has(key) && Number.isFinite(num) && num >= 0) out[key] = num;
  }
  return Object.keys(out).length ? out : undefined;
}
