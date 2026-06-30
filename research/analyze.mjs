// Universe study: test price-signal hypotheses against forward 1/2/3-year TOTAL
// returns, pooled across S&P 500 + Nasdaq-100 constituents. No fundamentals (so
// no look-ahead/restatement bias); every state at t uses only data <= t and
// forward returns use t..t+H. Survivorship caveat: current constituents only —
// so ABSOLUTE returns are upward-biased; lean on RELATIVE (quintile-spread) reads.
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('./data/', import.meta.url).pathname;
const { sp500, ndx } = JSON.parse(readFileSync(new URL('./membership.json', import.meta.url)));
const spSet = new Set(sp500), ndxSet = new Set(ndx);

const Y = 252;
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

// ---- helpers ----
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = (a) => quant(a, 0.5);
function quant(a, p) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}
const pctPos = (a) => (a.length ? a.filter((x) => x > 0).length / a.length : null);
const pct = (x, dp = 1) => (x == null ? '—' : (x * 100).toFixed(dp) + '%');

// ---- build observations ----
// obs: { sym, ym, inSp, inNdx, above200, momPos, mom, vol, w52, r1, r2, r3 }
const obs = [];
for (const f of files) {
  const sym = f.replace('.json', '');
  let bars;
  try { bars = JSON.parse(readFileSync(DIR + f)); } catch { continue; }
  if (!Array.isArray(bars) || bars.length < 300) continue;
  const t = bars.map((b) => b[0]);
  const px = bars.map((b) => b[1]);
  const n = px.length;
  const prefix = [0];
  for (let i = 0; i < n; i++) prefix.push(prefix[i] + px[i]);
  const sma = (end, p) => (end + 1 < p ? null : (prefix[end + 1] - prefix[end + 1 - p]) / p);
  const inSp = spSet.has(sym), inNdx = ndxSet.has(sym);

  for (let i = Y; i + Y < n; i += 21) { // monthly sampling, need >=1y prior and >=1y forward
    if (!(px[i] > 0)) continue;
    const sma200 = sma(i, 200);
    const mom = px[i - Y] > 0 ? px[i - 21] / px[i - Y] - 1 : null; // 12-1
    // trailing 126d annualized vol
    let rs = [];
    for (let k = i - 126 + 1; k <= i; k++) if (k > 0 && px[k - 1] > 0) rs.push(px[k] / px[k - 1] - 1);
    const vol = rs.length > 30 ? stdev(rs) * Math.sqrt(252) : null;
    // 52w position
    const win = px.slice(i - Y, i + 1);
    const hi = Math.max(...win), lo = Math.min(...win);
    const w52 = hi > lo ? (px[i] - lo) / (hi - lo) : null;
    const r1 = px[i + Y] / px[i] - 1;
    const r2 = i + 2 * Y < n ? px[i + 2 * Y] / px[i] - 1 : null;
    const r3 = i + 3 * Y < n ? px[i + 3 * Y] / px[i] - 1 : null;
    const d = new Date(t[i] * 1000);
    const ym = d.getUTCFullYear() * 12 + d.getUTCMonth();
    obs.push({ sym, ym, inSp, inNdx,
      above200: sma200 != null ? px[i] > sma200 : null,
      momPos: mom != null ? mom > 0 : null, mom, vol, w52, r1, r2, r3 });
  }
}
function stdev(a) { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); }

console.log(`\nLoaded ${files.length} tickers → ${obs.length} monthly observations (10y window).`);
console.log(`Date span: ${ymStr(Math.min(...obs.map((o) => o.ym)))} … ${ymStr(Math.max(...obs.map((o) => o.ym)))}`);
function ymStr(ym) { return `${Math.floor(ym / 12)}-${String((ym % 12) + 1).padStart(2, '0')}`; }

// ---- universe slicer ----
const UNIV = { 'S&P 500 (VOO/SPY)': (o) => o.inSp, 'Nasdaq-100 (QQQ)': (o) => o.inNdx };

function dist(rows, key) {
  const a = rows.map((o) => o[key]).filter((x) => x != null);
  const ann = key === 'r2' ? a.map((x) => (1 + x) ** (1 / 2) - 1) : key === 'r3' ? a.map((x) => (1 + x) ** (1 / 3) - 1) : a;
  return { n: a.length, median: median(a), mean: mean(a), pctPos: pctPos(a), p10: quant(a, 0.1), cagr: mean(ann) };
}
function line(label, d) {
  return `    ${label.padEnd(26)} n=${String(d.n).padStart(6)}  median ${pct(d.median).padStart(7)}  mean ${pct(d.mean).padStart(7)}  %pos ${pct(d.pctPos, 0).padStart(5)}  p10 ${pct(d.p10).padStart(8)}  CAGR ${pct(d.cagr).padStart(7)}`;
}

// ===== H1/H3: trend & momentum STATE → forward returns (pooled) =====
console.log('\n=================  H1/H3 — Trend & momentum filter → forward TOTAL return  =================');
for (const [uname, sel] of Object.entries(UNIV)) {
  const u = obs.filter(sel);
  console.log(`\n  ${uname}  (${u.length} obs)`);
  for (const [h, hl] of [['r1', '1y'], ['r2', '2y'], ['r3', '3y']]) {
    console.log(`   ${hl} forward:`);
    console.log(line('all entries', dist(u, h)));
    console.log(line('above 200d SMA', dist(u.filter((o) => o.above200), h)));
    console.log(line('below 200d SMA', dist(u.filter((o) => o.above200 === false), h)));
    console.log(line('above200 & 12-1 mom>0', dist(u.filter((o) => o.above200 && o.momPos), h)));
    console.log(line('below200 or mom<0', dist(u.filter((o) => !(o.above200 && o.momPos)), h)));
  }
}

// ===== cross-sectional quintiles (rank within each month → nets out market direction) =====
function quintileStudy(signalKey, fwd, sel, higherFirst = true) {
  // group by month; within month rank tickers by signal into 5 bins; collect fwd returns
  const byMonth = new Map();
  for (const o of obs) {
    if (!sel(o) || o[signalKey] == null || o[fwd] == null) continue;
    if (!byMonth.has(o.ym)) byMonth.set(o.ym, []);
    byMonth.get(o.ym).push(o);
  }
  const qSums = [[], [], [], [], []];
  let months = 0;
  for (const [, rows] of byMonth) {
    if (rows.length < 20) continue;
    months++;
    const sorted = [...rows].sort((a, b) => (higherFirst ? b[signalKey] - a[signalKey] : a[signalKey] - b[signalKey]));
    const per = sorted.length / 5;
    for (let q = 0; q < 5; q++) {
      const slice = sorted.slice(Math.floor(q * per), Math.floor((q + 1) * per));
      qSums[q].push(mean(slice.map((o) => o[fwd])));
    }
  }
  return { months, q: qSums.map((m) => mean(m)) };
}
function quintLine(name, sel) {
  console.log(`\n  ${name}`);
  for (const [sig, label, hf] of [['mom', '12-1 momentum (Q1=highest)', true], ['w52', '52w-high proximity (Q1=nearest high)', true], ['vol', 'volatility (Q1=lowest vol)', false]]) {
    const r = quintileStudy(sig, 'r1', sel, hf);
    const q = r.q.map((x) => pct(x).padStart(8)).join(' ');
    const spread = r.q[0] != null && r.q[4] != null ? r.q[0] - r.q[4] : null;
    console.log(`   ${label.padEnd(38)} Q1${q}   [Q1−Q5 ${pct(spread)}]  (${r.months} months)`);
  }
}
console.log('\n=================  H2/H4/H5 — Cross-sectional quintiles → mean 1y forward return  =================');
console.log('  (ranked within each calendar month, then averaged across months — nets out market direction)');
console.log('  Columns: Q1 Q2 Q3 Q4 Q5');
for (const [uname, sel] of Object.entries(UNIV)) quintLine(uname, sel);

console.log('\nCaveats: current-constituent universe (survivorship → absolute returns biased high);');
console.log('overlapping forward windows are autocorrelated; price-signal only (no fundamentals).');
