// Shared helpers for the equity research skills.
// Dependency-free (Node 20+ built-ins only). Talks to the local research server.
//
// IMPORTANT: hits localhost only — do NOT set NODE_USE_ENV_PROXY (that would route
// localhost through the sandbox proxy and fail). Plain `node script.mjs` is correct.
//
// Invariants honored: never fabricate. Missing inputs stay `null` and are surfaced,
// never guessed. All scripts emit machine JSON by default; `--md` adds a human view
// rendered from the SAME object (human + machine parity).

export const BASE = process.env.STOCKS_API || 'http://localhost:5173';

export async function api(path) {
  const url = `${BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

// Best-effort fetch: returns {ok, data|error} instead of throwing, so a single
// bad ticker never sinks a whole screen/compare run (fault isolation).
export async function tryApi(path) {
  try { return { ok: true, data: await api(path) }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// ---- price series ----------------------------------------------------------

// Returns { dates:[unix], closes:[number] } using adjusted close when available.
// Drops bars with null close so downstream math is clean.
export async function closes(symbol, range = '5y', interval = '1d') {
  const j = await api(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`);
  const r = j?.chart?.result?.[0];
  if (!r?.timestamp) return { dates: [], closes: [] };
  const adj = r.indicators?.adjclose?.[0]?.adjclose;
  const raw = r.indicators?.quote?.[0]?.close;
  const px = adj || raw || [];
  const dates = [], out = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = px[i];
    if (c != null && isFinite(c)) { dates.push(r.timestamp[i]); out.push(c); }
  }
  return { dates, closes: out };
}

// Align several {dates,closes} series onto their common dates (intersection).
// Returns { dates, series: { SYM: [closes...] } } in date order.
export function alignByDate(map) {
  const syms = Object.keys(map);
  if (!syms.length) return { dates: [], series: {} };
  let common = new Set(map[syms[0]].dates);
  for (const s of syms.slice(1)) common = new Set(map[s].dates.filter(d => common.has(d)));
  const dates = [...common].sort((a, b) => a - b);
  const series = {};
  for (const s of syms) {
    const idx = new Map(map[s].dates.map((d, i) => [d, i]));
    series[s] = dates.map(d => map[s].closes[idx.get(d)]);
  }
  return { dates, series };
}

// ---- statistics ------------------------------------------------------------

export const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
export function std(a) { // sample std
  if (a.length < 2) return NaN;
  const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
export const logReturns = c => c.slice(1).map((p, i) => Math.log(p / c[i]));
export const TRADING_DAYS = 252;

export function annualVol(rets, ppy = TRADING_DAYS) { return std(rets) * Math.sqrt(ppy); }

export function cagr(c, ppy = TRADING_DAYS) {
  if (c.length < 2) return null;
  const years = (c.length - 1) / ppy;
  if (years <= 0) return null;
  return (c[c.length - 1] / c[0]) ** (1 / years) - 1;
}

export function sharpe(rets, rf = 0, ppy = TRADING_DAYS) {
  const s = std(rets); if (!isFinite(s) || s === 0) return null;
  return (mean(rets) * ppy - rf) / (s * Math.sqrt(ppy));
}

export function sortino(rets, rf = 0, ppy = TRADING_DAYS) {
  if (rets.length < 2) return null;
  const down = rets.filter(r => r < 0);
  if (!down.length) return null;
  // Downside deviation: sum of squared downside returns over TOTAL observations
  // (textbook definition; dividing by only the down-day count overstates risk).
  const dd = Math.sqrt(down.reduce((s, x) => s + x * x, 0) / rets.length) * Math.sqrt(ppy);
  if (dd === 0) return null;
  return (mean(rets) * ppy - rf) / dd;
}

export function maxDrawdown(c) {
  if (!c.length) return null; // no data => null, never a fabricated 0
  let peak = -Infinity, mdd = 0;
  for (const p of c) { peak = Math.max(peak, p); mdd = Math.min(mdd, p / peak - 1); }
  return mdd;
}

// 12-1 momentum: return from ~12 months ago to ~1 month ago (an ~11-month span;
// the most recent month is skipped, the standard cross-sectional momentum definition).
export function mom12_1(c, ppy = TRADING_DAYS) {
  const skip = Math.round(ppy / 12), look = ppy;
  if (c.length < look + 1) return null;
  const end = c[c.length - 1 - skip], start = c[c.length - 1 - look];
  if (start == null || end == null) return null;
  return end / start - 1;
}

export function correlation(a, b) {
  const n = Math.min(a.length, b.length); if (n < 2) return NaN;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db);
}

export function covariance(a, b) {
  const n = Math.min(a.length, b.length); if (n < 2) return NaN;
  const ma = mean(a), mb = mean(b);
  let s = 0; for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}

// Cross-sectional z-scores; nulls map to null (kept out of the mean/std).
export function zscores(vals) {
  const ok = vals.filter(v => v != null && isFinite(v));
  const m = mean(ok), s = std(ok);
  return vals.map(v => (v == null || !isFinite(v) || !isFinite(s) || s === 0) ? null : (v - m) / s);
}

// Percentile rank in [0,1]; higher value -> higher rank.
export function pctRanks(vals) {
  const ok = vals.filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
  return vals.map(v => {
    if (v == null || !isFinite(v) || ok.length < 2) return null;
    const below = ok.filter(x => x < v).length;
    return below / (ok.length - 1);
  });
}

// ---- formatting ------------------------------------------------------------

export const r2 = (v, d = 2) => (v == null || !isFinite(v)) ? null : Number(v.toFixed(d));
export const pct = (v, d = 1) => (v == null || !isFinite(v)) ? 'n/a' : `${(v * 100).toFixed(d)}%`;
export const num = (v, d = 2) => (v == null || !isFinite(v)) ? 'n/a' : v.toFixed(d);

// Parse a "key:weight,key:weight" string into {key:number}.
export function parseWeights(str) {
  if (!str) return null;
  const out = {};
  for (const part of str.split(',')) {
    const [k, v] = part.split(':');
    if (k && v != null && isFinite(+v)) out[k.trim()] = +v;
  }
  return Object.keys(out).length ? out : null;
}

// Split a CLI arg list of tickers ("AAPL,MSFT NVDA") into clean uppercased symbols,
// de-duplicated (a repeated ticker would otherwise double-count in risk math).
export function parseTickers(args) {
  const seen = new Set(), out = [];
  for (const a of args) for (const s of a.split(/[,\s]+/)) {
    const t = s.trim().toUpperCase();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

// Read a "--name value" flag. Only consumes the next token as the value if it exists
// and is not itself a flag — so "--range AAPL MSFT" does NOT eat AAPL as the range.
// Returns { present, value, valueIdx } so callers can exclude the value from tickers.
export function getFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return { present: false, value: null, valueIdx: -1 };
  const next = argv[i + 1];
  const hasVal = next != null && !next.startsWith('--');
  return { present: true, value: hasVal ? next : null, valueIdx: hasVal ? i + 1 : -1 };
}

// Tiny markdown table from rows of objects, given column [key,label] pairs.
export function mdTable(rows, cols) {
  const head = `| ${cols.map(c => c[1]).join(' | ')} |`;
  const sep = `| ${cols.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${cols.map(c => {
    const v = row[c[0]];
    return v == null ? 'n/a' : String(v);
  }).join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

export function emit(obj, asMd, mdFn) {
  if (asMd && mdFn) process.stdout.write(mdFn(obj) + '\n');
  else process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}
