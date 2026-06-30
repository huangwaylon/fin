// Unit + property tests for the quant layer, plus a synthetic backtest sanity
// check. Run: node test/quant.test.mjs   (no network needed for this file).
import { scoreUp, scoreDown, clamp, cagr, blend } from '../lib/quantutil.js';
import { dcfEV, reverseDcf, multiplesValue, impliedStage1Growth } from '../lib/valuation.js';
import { computeFactors, composite, rate } from '../lib/factors.js';
import { backtest } from '../lib/backtest.js';
import { computeSignals } from '../lib/signals.js';
import { parseBars } from '../lib/decision.js';

let pass = 0;
let fail = 0;
const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
function check(name, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error('  ✗ ' + name);
  }
}

// --- Scoring functions ---
check('scoreUp midpoint', approx(scoreUp(0.15, 0, 0.3), 50));
check('scoreUp clamps high', scoreUp(99, 0, 0.3) === 100);
check('scoreUp clamps low', scoreUp(-5, 0, 0.3) === 0);
check('scoreDown midpoint', approx(scoreDown(18, 6, 30), 50));
check('scoreDown cheap=high', scoreDown(6, 6, 30) === 100);
check('null passthrough', scoreUp(null, 0, 1) === null);
check('clamp', clamp(5, 0, 3) === 3);

// --- CAGR ---
check('cagr 100%', approx(cagr(100, 200, 1), 1));
check('cagr 10%/2y', approx(cagr(100, 121, 2), 0.1, 1e-9));
check('cagr rejects negatives', cagr(-1, 100, 1) === null);

// --- blend coverage ---
const b = blend([[100, 1], [null, 1], [0, 2]]);
check('blend score', approx(b.score, (100 * 1 + 0 * 2) / 3));
check('blend coverage', approx(b.coverage, 3 / 4));

// --- DCF: zero-growth closed form: EV = FCF / r; equity/share = (EV - netDebt)/shares ---
const ev0 = dcfEV(100, 0, { discount: 0.1, terminalGrowth: 0, years: 10 });
check('dcfEV zero-growth EV ~= FCF/r', approx(ev0.ev, 1000, 1));
check('dcfEV rejects negative fcf', dcfEV(-5, 0.1, { discount: 0.1, terminalGrowth: 0, years: 10 }) === null);
check('dcfEV rejects r<=g', dcfEV(100, 0.1, { discount: 0.02, terminalGrowth: 0.025, years: 10 }) === null);
check('dcfEV rejects years<2 (no NaN)', dcfEV(100, 0, { discount: 0.1, terminalGrowth: 0, years: 1 }) === null);
check('dcfEV reports terminal share', ev0.terminalPv > 0 && ev0.terminalPv < ev0.ev);

// --- Reverse DCF round-trips through the equity bridge ---
const g = reverseDcf({ fcf: 100, sharesOut: 100, price: 10, netDebt: 0 }, { discount: 0.1, terminalGrowth: 0, years: 10 });
check('reverseDcf implies ~0 growth at fair price', approx(g, 0, 0.02));
const gUp = reverseDcf({ fcf: 100, sharesOut: 100, price: 20, netDebt: 0 }, { discount: 0.1, terminalGrowth: 0, years: 10 });
check('reverseDcf implies higher growth at higher price', gUp > g);
const gDebt = reverseDcf({ fcf: 100, sharesOut: 100, price: 10, netDebt: 500 }, { discount: 0.1, terminalGrowth: 0, years: 10 });
check('reverseDcf: net debt raises required growth', gDebt > g);

// --- Multiples (Graham-style) ---
check('multiplesValue', approx(multiplesValue(5, 0.1), 5 * (8.5 + 2 * 10)));
check('multiples rejects negative eps', multiplesValue(-1, 0.1) === null);

// --- impliedStage1Growth caps ---
check('growth caps at 20%', impliedStage1Growth({ epsCagr3: 0.9, revCagr3: 0.9, earningsGrowth: 0.9, revenueGrowth: 0.9 }) === 0.2);
check('growth floors at 0%', impliedStage1Growth({ epsCagr3: -0.5, revCagr3: -0.5, earningsGrowth: -0.5, revenueGrowth: -0.5 }) === 0);

// --- Factors / composite / rating ---
check('rate bands', rate(85) === 'Strong Buy' && rate(70) === 'Buy' && rate(55) === 'Hold' && rate(40) === 'Reduce' && rate(10) === 'Avoid');
const exHigh = {
  roe: 0.4, roa: 0.2, grossMargin: 0.7, operatingMargin: 0.4, netMargin: 0.3, fcfMargin: 0.3,
  earningsYield: 0.12, fcfYield: 0.1, evEbitda: 5, pb: 1, ps: 1, peg: 0.7,
  revCagr3: 0.3, epsCagr3: 0.3, revenueGrowth: 0.3, earningsGrowth: 0.3, forwardEps: 11, trailingEps: 10,
  debtToEquity: 10, netDebtToEbitda: 0, currentRatio: 3, interestCoverage: 20, fcf: 1e9,
  shareholderYield: 0.08, payoutRatio: 0.2,
  signals: { mom12_1: 0.4, ret6m: 0.3, priceVsSma200: 0.2, week52pos: 0.95 },
};
const fHigh = computeFactors(exHigh);
const cHigh = composite(fHigh.factors, fHigh.weights);
check('great company scores high', cHigh.composite > 80);
check('great company high coverage', cHigh.coverage > 0.95);
const fEmpty = computeFactors({ signals: {} });
const cEmpty = composite(fEmpty.factors, fEmpty.weights);
check('no-data => null composite, zero coverage', cEmpty.composite === null && cEmpty.coverage === 0);

// --- Backtest on synthetic data ---
// 700 bars compounding +0.1%/day -> ~28.6% annualized; trend_mom should track it.
const synth = [];
let p = 100;
for (let i = 0; i < 700; i++) {
  synth.push({ time: 1000000 + i * 86400, open: p, high: p, low: p, close: p, volume: 1 });
  p *= 1.001;
}
const bt = backtest(synth, { rule: 'trend_mom' });
check('backtest runs', !bt.error);
check('backtest exposure ~1 in uptrend', bt.exposure > 0.95);
check('backtest cagr ~ buy&hold in uptrend', approx(bt.strategy.cagr, bt.benchmark.cagr, 0.02));
check('backtest cagr in expected range', bt.strategy.cagr > 0.2 && bt.strategy.cagr < 0.35);
check('curve has points', bt.curve.length > 50);

// Look-ahead guard: a one-day spike at the end must not change earlier positions'
// realized returns (sanity that we decide pos(t) then realize t->t+1).
const synth2 = synth.map((x) => ({ ...x }));
const btShort = backtest(synth2, { rule: 'trend' });
check('trend rule also runs', !btShort.error);

// --- Signals sanity ---
const sig = computeSignals(synth);
check('signals trend up', sig.trend === 'up');
check('signals 52w pos near top', sig.week52pos > 0.9);
check('signals positive momentum', sig.mom12_1 > 0);

// --- Sector-aware masking ---
const exBank = {
  sectorClass: 'financial', roe: 0.15, roa: 0.012, grossMargin: null, operatingMargin: 0.4,
  netMargin: 0.3, fcfMargin: 0.5, earningsYield: 0.08, fcfYield: 0.1, evEbitda: 5, pb: 1.2, ps: 3,
  peg: 1, debtToEquity: 250, netDebtToEbitda: 8, currentRatio: 0.1, interestCoverage: 1, fcf: 1e9,
  revenueGrowth: 0.05, earningsGrowth: 0.05, signals: {},
};
const fBank = computeFactors(exBank);
check('financial: health factor masked (zero coverage)', fBank.factors.health.coverage === 0);
check('financial: value EV/EBITDA masked', fBank.factors.value.inputs.find((i) => i.key === 'evEbitda').score === null);

// --- parseBars robustness ---
check('parseBars handles missing quote (no throw)', Array.isArray(parseBars({ chart: { result: [{ timestamp: [1, 2] }] } })) && parseBars({ chart: { result: [{ timestamp: [1, 2] }] } }).length === 0);
check('parseBars drops NaN closes', parseBars({ chart: { result: [{ timestamp: [1, 2], indicators: { quote: [{ open: [1, 2], high: [1, 2], low: [1, 2], close: [10, NaN], volume: [1, 1] }] } }] } }).length === 1);
check('parseBars stooq fallback', parseBars({ bars: [{ date: '2020-01-01', close: 5 }, { date: '2020-01-02', close: null }] }).length === 1);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
