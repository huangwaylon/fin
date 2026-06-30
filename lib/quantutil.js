// Shared quant utilities: scoring functions and small stats helpers.
// Scoring functions map a raw metric onto a 0–100 scale via documented,
// piecewise-linear anchors so every score is transparent and reproducible.

// Unwrap Yahoo's { raw, fmt } wrappers.
export const raw = (x) => (x && typeof x === 'object' && 'raw' in x ? x.raw : x ?? null);

export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Map x in [lo, hi] -> [0, 100]; higher x scores higher. Returns null if x null.
export function scoreUp(x, lo, hi) {
  if (!isNum(x)) return null;
  return clamp(((x - lo) / (hi - lo)) * 100, 0, 100);
}

// Map x in [lo, hi] -> [100, 0]; lower x scores higher (cheaper/safer is better).
export function scoreDown(x, lo, hi) {
  if (!isNum(x)) return null;
  return clamp(((hi - x) / (hi - lo)) * 100, 0, 100);
}

// Average of the non-null scores, weighted. Each entry: [score|null, weight].
// Returns { score, coverage } where coverage is the weight fraction that had data.
export function blend(entries) {
  let wsum = 0;
  let acc = 0;
  let covered = 0;
  let total = 0;
  for (const [score, weight] of entries) {
    total += weight;
    if (isNum(score)) {
      acc += score * weight;
      wsum += weight;
      covered += weight;
    }
  }
  return {
    score: wsum > 0 ? acc / wsum : null,
    coverage: total > 0 ? covered / total : 0,
  };
}

export function mean(arr) {
  const a = arr.filter(isNum);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}

export function stdev(arr) {
  const a = arr.filter(isNum);
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

// Compound annual growth rate between an earliest and latest value over `years`.
// Returns null if signs make the ratio meaningless (e.g. negative earnings).
export function cagr(earliest, latest, years) {
  if (!isNum(earliest) || !isNum(latest) || years <= 0) return null;
  if (earliest <= 0 || latest <= 0) return null;
  return (latest / earliest) ** (1 / years) - 1;
}

export const pctRank = (x, lo, hi) => (isNum(x) ? clamp((x - lo) / (hi - lo), 0, 1) : null);
