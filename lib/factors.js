// Factor model. Each factor is scored 0–100 from its inputs via the transparent
// piecewise-linear functions in quantutil. Anchors below are documented, absolute
// thresholds chosen for long-term quality investing (not cross-sectional ranks).
import { scoreUp, scoreDown, blend, isNum, stdev } from './quantutil.js';

export const DEFAULT_WEIGHTS = {
  quality: 0.22,
  value: 0.2,
  growth: 0.18,
  health: 0.15,
  momentum: 0.15,
  shareholderYield: 0.1,
};

// Build a factor result from [key, label, value, score, weight] rows.
function factor(rows) {
  const { score, coverage } = blend(rows.map((r) => [r[3], r[4]]));
  return {
    score,
    coverage,
    inputs: rows.map(([key, label, value, s, weight]) => ({ key, label, value, score: s, weight })),
  };
}

// Inputs that are meaningless or misleading for certain sectors. We mask them to
// null so they neither score nor inflate coverage — financials run on leverage by
// design, and REIT earnings/book value are distorted by depreciation accounting.
const SECTOR_MASKS = {
  financial: ['evEbitda', 'netDebtToEbitda', 'currentRatio', 'interestCoverage', 'debtToEquity', 'fcfYield', 'fcfMargin', 'fcf', 'roic', 'cashConversion'],
  realestate: ['earningsYield', 'peg', 'netDebtToEbitda', 'debtToEquity', 'roic', 'cashConversion'],
};

function maskForSector(ex) {
  const keys = SECTOR_MASKS[ex.sectorClass];
  if (!keys) return ex;
  const masked = { ...ex };
  for (const k of keys) masked[k] = null;
  return masked;
}

export function computeFactors(exRaw, weightsOverride) {
  const ex = maskForSector(exRaw);
  const yrs = exRaw.cagrYears ? `${exRaw.cagrYears}y` : 'multi-yr';
  const fwdGrowth =
    isNum(ex.forwardEps) && isNum(ex.trailingEps) && ex.trailingEps > 0
      ? ex.forwardEps / ex.trailingEps - 1
      : null;
  const fcfPositive = isNum(ex.fcf) ? (ex.fcf > 0 ? 100 : 0) : null;
  // 1/forwardPE — forward earnings yield. Cross-checks trailing earnings yield and
  // dampens the cyclical "cheap on peak trailing earnings" trap for a long-term buyer.
  const fwdEarningsYield = isNum(ex.forwardPe) && ex.forwardPe > 0 ? 1 / ex.forwardPe : null;

  const quality = factor([
    ['roe', 'Return on equity', ex.roe, scoreUp(ex.roe, 0, 0.3), 0.18],
    ['roa', 'Return on assets', ex.roa, scoreUp(ex.roa, 0, 0.15), 0.1],
    ['roic', 'Return on invested capital', ex.roic, scoreUp(ex.roic, 0.08, 0.3), 0.14],
    ['grossMargin', 'Gross margin', ex.grossMargin, scoreUp(ex.grossMargin, 0.1, 0.6), 0.12],
    ['operatingMargin', 'Operating margin', ex.operatingMargin, scoreUp(ex.operatingMargin, 0, 0.3), 0.12],
    ['netMargin', 'Net margin', ex.netMargin, scoreUp(ex.netMargin, 0, 0.25), 0.12],
    ['fcfMargin', 'FCF margin', ex.fcfMargin, scoreUp(ex.fcfMargin, 0, 0.25), 0.12],
    ['cashConversion', 'Cash conversion (CFO/NI)', ex.cashConversion, scoreUp(ex.cashConversion, 0.6, 1.2), 0.1],
  ]);

  const value = factor([
    ['earningsYield', 'Earnings yield', ex.earningsYield, scoreUp(ex.earningsYield, 0, 0.1), 0.25],
    ['fwdEarningsYield', 'Forward earnings yield', fwdEarningsYield, scoreUp(fwdEarningsYield, 0, 0.1), 0.15],
    ['fcfYield', 'FCF yield', ex.fcfYield, scoreUp(ex.fcfYield, 0, 0.08), 0.2],
    ['evEbitda', 'EV/EBITDA', ex.evEbitda, scoreDown(ex.evEbitda, 6, 30), 0.2],
    ['pb', 'Price/Book', ex.pb, scoreDown(ex.pb, 1, 12), 0.08],
    ['ps', 'Price/Sales', ex.ps, scoreDown(ex.ps, 1, 15), 0.07],
    ['peg', 'PEG ratio', ex.peg, scoreDown(ex.peg, 0.8, 3), 0.05],
  ]);

  const growth = factor([
    ['revCagr3', `Revenue CAGR (${yrs})`, ex.revCagr3, scoreUp(ex.revCagr3, 0, 0.25), 0.25],
    ['epsCagr3', `EPS CAGR (${yrs})`, ex.epsCagr3, scoreUp(ex.epsCagr3, 0, 0.3), 0.25],
    ['revenueGrowth', 'Revenue growth (YoY)', ex.revenueGrowth, scoreUp(ex.revenueGrowth, 0, 0.25), 0.2],
    ['earningsGrowth', 'Earnings growth (YoY)', ex.earningsGrowth, scoreUp(ex.earningsGrowth, 0, 0.3), 0.2],
    ['fwdGrowth', 'Forward EPS growth', fwdGrowth, scoreUp(fwdGrowth, 0, 0.25), 0.1],
  ]);

  // debtToEquity arrives as a percentage from Yahoo (79.5 == 0.795x).
  const health = factor([
    ['debtToEquity', 'Debt/Equity', ex.debtToEquity, scoreDown(ex.debtToEquity, 0, 150), 0.25],
    ['netDebtToEbitda', 'Net debt/EBITDA', ex.netDebtToEbitda, scoreDown(ex.netDebtToEbitda, 0, 4), 0.25],
    ['currentRatio', 'Current ratio', ex.currentRatio, scoreUp(ex.currentRatio, 1, 3), 0.2],
    ['interestCoverage', 'Interest coverage', ex.interestCoverage, scoreUp(ex.interestCoverage, 2, 15), 0.2],
    ['fcfPositive', 'FCF positive', isNum(ex.fcf) ? ex.fcf : null, fcfPositive, 0.1],
  ]);

  const s = ex.signals || {};
  const momentum = factor([
    ['mom12_1', '12–1 month momentum', s.mom12_1, scoreUp(s.mom12_1, -0.2, 0.4), 0.35],
    ['ret6m', '6-month return', s.ret6m, scoreUp(s.ret6m, -0.15, 0.3), 0.25],
    ['priceVsSma200', 'Price vs 200d SMA', s.priceVsSma200, scoreUp(s.priceVsSma200, -0.15, 0.2), 0.25],
    ['week52pos', '52-week range position', s.week52pos, scoreUp(s.week52pos, 0.2, 0.95), 0.15],
  ]);

  // Payout sustainability: lower payout = more room. Skipped when no dividend data.
  const payoutScore = isNum(ex.payoutRatio) ? scoreDown(ex.payoutRatio, 0.3, 1.0) : null;
  const shareholderYield = factor([
    ['shareholderYield', 'Shareholder yield', ex.shareholderYield, scoreUp(ex.shareholderYield, 0, 0.08), 0.8],
    ['payoutRatio', 'Payout sustainability', ex.payoutRatio, payoutScore, 0.2],
  ]);

  const factors = { quality, value, growth, health, momentum, shareholderYield };
  const weights = { ...DEFAULT_WEIGHTS, ...(weightsOverride || {}) };

  return { factors, weights };
}

// Combine factor scores into a composite, rating, and conviction.
export function composite(factors, weights) {
  const rows = Object.entries(weights).map(([k, w]) => [factors[k]?.score ?? null, w]);
  const { score, coverage } = blend(rows);

  const present = Object.values(factors)
    .map((f) => f.score)
    .filter(isNum);
  const dispersion = present.length >= 2 ? stdev(present) : null;

  // Conviction (0–1): rewards data coverage, penalizes factor disagreement.
  let conviction = coverage;
  if (isNum(dispersion)) conviction *= 1 - Math.min(dispersion / 40, 0.5);
  conviction = isNum(conviction) ? Math.max(0, Math.min(1, conviction)) : 0;

  return { composite: score, rating: rate(score), conviction, coverage, dispersion };
}

export function rate(score) {
  if (!isNum(score)) return 'No rating';
  if (score >= 80) return 'Strong Buy';
  if (score >= 65) return 'Buy';
  if (score >= 50) return 'Hold';
  if (score >= 35) return 'Reduce';
  return 'Avoid';
}
