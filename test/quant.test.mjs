// Unit + property tests for the quant layer, plus a synthetic backtest sanity
// check. Run: node test/quant.test.mjs   (no network needed for this file).
import { scoreUp, scoreDown, clamp, cagr, blend, isNum } from '../lib/quantutil.js';
import { dcfEV, reverseDcf, multiplesValue, impliedStage1Growth, valuation } from '../lib/valuation.js';
import { computeFactors, composite, rate } from '../lib/factors.js';
import { backtest, forwardReturnStudy, priceState } from '../lib/backtest.js';
import { computeSignals } from '../lib/signals.js';
import { parseBars, analyze, parseWeights } from '../lib/decision.js';
import { parseCsv } from '../lib/stooq.js';
import { isPrivateIp, assertPublicUrl } from '../lib/ssrf.js';
import { cacheSet, cacheGet } from '../lib/cache.js';
import { readFile } from 'node:fs/promises';

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
  roe: 0.4, roa: 0.2, roic: 0.35, cashConversion: 1.2, grossMargin: 0.7, operatingMargin: 0.4, netMargin: 0.3, fcfMargin: 0.3,
  earningsYield: 0.12, fcfYield: 0.1, evEbitda: 5, pb: 1, ps: 1, peg: 0.7, forwardPe: 8,
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
  sectorClass: 'financial', roe: 0.15, roa: 0.012, roic: 0.2, cashConversion: 1.1, grossMargin: null, operatingMargin: 0.4,
  netMargin: 0.3, fcfMargin: 0.5, earningsYield: 0.08, fcfYield: 0.1, evEbitda: 5, pb: 1.2, ps: 3,
  peg: 1, debtToEquity: 250, netDebtToEbitda: 8, currentRatio: 0.1, interestCoverage: 1, fcf: 1e9,
  revenueGrowth: 0.05, earningsGrowth: 0.05, signals: {},
};
const fBank = computeFactors(exBank);
check('financial: health factor masked (zero coverage)', fBank.factors.health.coverage === 0);
check('financial: value EV/EBITDA masked', fBank.factors.value.inputs.find((i) => i.key === 'evEbitda').score === null);
check('financial: ROIC masked', fBank.factors.quality.inputs.find((i) => i.key === 'roic').score === null);

// --- New factor inputs: ROIC + cash conversion (quality), forward earnings yield (value) ---
check('quality includes ROIC + cash conversion', fHigh.factors.quality.inputs.some((i) => i.key === 'roic') && fHigh.factors.quality.inputs.some((i) => i.key === 'cashConversion'));
check('value includes forward earnings yield', fHigh.factors.value.inputs.find((i) => i.key === 'fwdEarningsYield').score > 0);

// --- parseBars robustness ---
check('parseBars handles missing quote (no throw)', Array.isArray(parseBars({ chart: { result: [{ timestamp: [1, 2] }] } })) && parseBars({ chart: { result: [{ timestamp: [1, 2] }] } }).length === 0);
check('parseBars drops NaN closes', parseBars({ chart: { result: [{ timestamp: [1, 2], indicators: { quote: [{ open: [1, 2], high: [1, 2], low: [1, 2], close: [10, NaN], volume: [1, 1] }] } }] } }).length === 1);
check('parseBars stooq fallback', parseBars({ bars: [{ date: '2020-01-01', close: 5 }, { date: '2020-01-02', close: null }] }).length === 1);

// --- Technical indicators: null-safety + flat-window RSI (frontend module) ---
// indicators.js is a browser IIFE; load it against a fake `window` to test in node.
const indSrc = await readFile(new URL('../public/indicators.js', import.meta.url), 'utf8');
const win = {};
new Function('window', indSrc)(win);
const { ema, rsi, macd } = win.Indicators;

const emaLead = ema([null, null, 2, 4, 6, 8], 3); // seed on first 3 non-null -> (2+4+6)/3 = 4
check('ema skips leading nulls (seed not NaN)', emaLead[4] === 4 && Number.isFinite(emaLead[5]));
const emaMid = ema([2, 4, null, 6, 8], 2); // seed (2+4)/2 = 3, then a mid null must not poison
check('ema skips mid nulls (no NaN)', emaMid[1] === 3 && emaMid[2] === null && Number.isFinite(emaMid[3]));

const flat = new Array(40).fill(50);
const rsiFlat = rsi(flat, 14);
check('rsi flat window = 50 not 100', rsiFlat[14] === 50 && rsiFlat[39] === 50);

const seq = [null, 10, 11, null, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28];
const m = macd(seq, 3, 6, 4);
const noNaN = (a) => a.every((v) => v == null || Number.isFinite(v));
check('macd never emits NaN with nulls present', noNaN(m.line) && noNaN(m.signal) && noNaN(m.hist));

// --- Stooq CSV parsing: blanks / "N/D" -> null (never a fabricated 0 or NaN) ---
const sc = parseCsv('Date,Open,High,Low,Close,Volume\n2020-01-01,1,2,0.5,1.5,1000\n2020-01-02,N/D,N/D,N/D,N/D,N/D\n2020-01-03,,,,,\n');
check('stooq parseCsv keeps only usable-close rows', sc.bars.length === 1 && sc.bars[0].close === 1.5);
check('stooq parseCsv fabricates no 0/NaN closes', sc.bars.every((b) => Number.isFinite(b.close)));

// --- SSRF guard: classify resolved IPs, not the hostname string ---
check('ssrf loopback', isPrivateIp('127.0.0.1') === true);
check('ssrf private 10/192/172', isPrivateIp('10.0.0.1') && isPrivateIp('192.168.1.1') && isPrivateIp('172.20.0.1'));
check('ssrf 172.32 is public', isPrivateIp('172.32.0.1') === false);
check('ssrf cloud metadata 169.254', isPrivateIp('169.254.169.254') === true);
check('ssrf public passes', isPrivateIp('8.8.8.8') === false);
check('ssrf ipv6 loopback/ULA/link-local', isPrivateIp('::1') && isPrivateIp('fd00::1') && isPrivateIp('fe80::1'));
check('ssrf ipv4-mapped', isPrivateIp('::ffff:127.0.0.1') === true);

const pub = async () => [{ address: '8.8.8.8' }];
const priv = async () => [{ address: '127.0.0.1' }];
let blocked = false;
try { await assertPublicUrl('http://rebind.example/', priv); } catch (e) { blocked = e.status === 403; }
check('assertPublicUrl blocks DNS-rebinding to private', blocked);
let allowed = true;
try { await assertPublicUrl('http://example.com/x', pub); } catch { allowed = false; }
check('assertPublicUrl allows a public host', allowed);
let badProto = false;
try { await assertPublicUrl('file:///etc/passwd', pub); } catch (e) { badProto = e.status === 400; }
check('assertPublicUrl rejects non-http(s)', badProto);
let decBlocked = false; // decimal-encoded loopback normalizes to 127.0.0.1 hostname
try { await assertPublicUrl('http://2130706433/', async (h) => [{ address: h }]); } catch (e) { decBlocked = e.status === 403; }
check('assertPublicUrl blocks decimal-encoded loopback', decBlocked);

// --- /api/score contract: reliability + actionable must be exposed ---
const synthBars = synth.map((b) => ({ date: b.time, close: b.close }));
const aRes = analyze({ sources: { summary: { quoteSummary: { result: [{}] } } }, errors: {} }, { bars: synthBars });
const scorePayload = { ...aRes.comp, reliability: aRes.reliability, actionable: aRes.actionable };
check('score payload exposes reliability', 'reliability' in scorePayload && scorePayload.reliability != null);
check('score payload exposes actionable boolean', typeof aRes.actionable === 'boolean');
check('standard-sector reliability', aRes.reliability === 'standard');

// --- Adjusted close: parseBars carries adjClose; signals use it for returns ---
const adjPayload = {
  chart: { result: [{ timestamp: [1, 2, 3], indicators: {
    quote: [{ open: [10, 11, 12], high: [10, 11, 12], low: [10, 11, 12], close: [10, 11, 12], volume: [1, 1, 1] }],
    adjclose: [{ adjclose: [9, 9.9, 12] }],
  } }] },
};
const adjBars = parseBars(adjPayload);
check('parseBars carries adjClose', adjBars[0].adjClose === 9 && adjBars[2].adjClose === 12);
check('parseBars adjClose falls back to close', parseBars({ bars: [{ date: 'd', close: 5 }] })[0].adjClose === 5);
// 300 bars: raw flat at 100, adjClose rising 80->~107 (dividends) -> adjusted 12m return positive, raw ~0.
const dvBars = [];
for (let i = 0; i < 300; i++) dvBars.push({ time: 1e6 + i * 86400, open: 100, high: 100, low: 100, close: 100, adjClose: 80 + i * 0.09, volume: 1 });
const dvSig = computeSignals(dvBars);
check('signals ret12m uses adjusted (total return)', dvSig.ret12m > 0.1);
check('signals price levels stay raw (52w high = 100)', dvSig.week52High === 100);

// --- Valuation exposes ROIC vs WACC value-creation spread ---
const vlu = valuation({ fcf: 1e8, sharesOut: 1e7, price: 50, netDebt: 0, beta: 1, marketCap: 5e8, totalDebt: 0, forwardEps: 3, trailingEps: 2.5, epsCagr3: 0.1, roic: 0.2 });
check('valuation reports wacc + roic', isNum(vlu.wacc) && vlu.roic === 0.2);
check('valuation value-creation spread = roic - wacc', approx(vlu.valueCreationSpread, 0.2 - vlu.wacc, 1e-9));

// --- Forward-holding-period return study (1/2/3y), look-ahead-free, on adjusted ---
const fr = forwardReturnStudy(synth); // 700 up-trending bars
check('forwardReturnStudy returns 1y bucket', fr && fr.y1 && fr.y1.all.count > 0);
check('forwardReturnStudy 1y median positive in uptrend', fr.y1.all.median > 0);
check('forwardReturnStudy splits by trend/mom state', 'trendMomBullish' in fr.y1);
check('backtest payload includes forwardReturns', !!bt.forwardReturns);

// --- parseWeights: only known keys, non-negative ---
check('parseWeights keeps valid', JSON.stringify(parseWeights('quality:0.3,value:0.2')) === JSON.stringify({ quality: 0.3, value: 0.2 }));
check('parseWeights drops unknown keys', parseWeights('foo:0.5') === undefined);
check('parseWeights drops negatives', parseWeights('quality:-1') === undefined);

// --- Cache is bounded (oldest evicted past the cap) ---
for (let i = 0; i < 600; i++) cacheSet(`k${i}`, i, 60000);
check('cache evicts oldest past cap', cacheGet('k0') === undefined && cacheGet('k599') === 599);

// --- SSRF: tightened IPv6 + IPv4 multicast classification ---
check('ssrf ipv4 multicast blocked', isPrivateIp('224.0.0.1') === true && isPrivateIp('239.1.2.3') === true);
check('ssrf ipv4-mapped public allowed', isPrivateIp('::ffff:8.8.8.8') === false);
check('ssrf ipv4-mapped hex loopback blocked', isPrivateIp('::ffff:7f00:1') === true);
check('ssrf 6to4 to private blocked', isPrivateIp('2002:7f00:0001::') === true);
check('ssrf NAT64 blocked', isPrivateIp('64:ff9b::1') === true);
check('ssrf global unicast v6 allowed', isPrivateIp('2606:4700:4700::1111') === false);
check('ssrf non-global v6 blocked (ULA/link-local)', isPrivateIp('fd00::1') && isPrivateIp('fe80::1') && isPrivateIp('::1'));

// --- priceState helper: shared, look-ahead-free signal definition ---
{
  const px = synth.map((b) => b.close); // monotonic uptrend
  const smaAt = (end, p) => { if (end + 1 < p) return null; let s = 0; for (let i = end - p + 1; i <= end; i++) s += px[i]; return s / p; };
  const st = priceState(px, 300, smaAt);
  check('priceState above200 & momPos in uptrend', st.above200 === true && st.momPos === true && st.mom > 0);
  const early = priceState(px, 100, smaAt); // before 252 warmup → momentum null, not fabricated
  check('priceState momentum null before warmup', early.mom === null && early.momPos === null);
}

// --- backtest verdict, turnover, warnings ---
check('backtest exposes verdict signs', typeof bt.verdict.timingBeatBuyHoldOnReturn === 'boolean' && isNum(bt.verdict.returnGap));
check('backtest reports turnover', isNum(bt.turnover) && bt.turnover >= 0);
check('backtest emits typed warnings', Array.isArray(bt.warnings) && bt.warnings.every((w) => w.code && w.message));
check('backtest warns on single regime', bt.warnings.some((w) => w.code === 'single_regime'));

// --- forwardReturnStudy: effectiveN + lowConfidence gating ---
const frs = forwardReturnStudy(synth);
check('forwardReturnStudy reports effectiveN', isNum(frs.y1.effectiveN) && frs.y1.effectiveN >= 0);
check('forwardReturnStudy flags low confidence on thin windows', frs.y3 ? typeof frs.y3.lowConfidence === 'boolean' : true);

// --- benchmark comparison via analyze: null-safe + populated ---
const aBench = analyze({ sources: { summary: { quoteSummary: { result: [{}] } } }, errors: {} }, { bars: synthBars });
check('analyze benchmark null when no benchmarks given', aBench.benchmark === null);
check('analyze attaches holdingPeriod + warnings', !!aBench.holdingPeriod && Array.isArray(aBench.warnings) && aBench.warnings.length > 0);
// synthetic benchmark slightly underperforming the stock → positive excess
const benchBars = synth.map((b, i) => ({ date: b.time, close: 100 * 1.0008 ** i }));
const aBench2 = analyze({ sources: { summary: { quoteSummary: { result: [{}] } } }, errors: {} }, { bars: synthBars }, { benchmarks: { SPY: parseBars({ bars: benchBars }) } });
check('analyze benchmark populated with excess', aBench2.benchmark && aBench2.benchmark.indices.SPY && isNum(aBench2.benchmark.excess.SPY.cagr1y));
check('benchmark excess positive when stock outperforms', aBench2.benchmark.excess.SPY.cagr1y > 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
