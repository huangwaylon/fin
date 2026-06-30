// Valuation engine.
//
// Model: a 2-stage DCF on free cash flow to the FIRM (FCFF), discounted at WACC,
// then bridged to equity by subtracting net debt and dividing by shares. Growth
// fades linearly from a stage-1 estimate to a terminal rate. We also expose a
// reverse DCF (market-implied growth) and a Graham-style multiples cross-check.
// Every assumption is returned alongside the output; nothing is hidden.
//
// Why these choices (see code-review notes): discounting Yahoo's reported FCF at a
// single cost of equity with no debt bridge over-values levered firms. Treating it
// as FCFF + WACC + net-debt bridge, with a beta-driven cost of equity, is the
// internally consistent version. It is still an approximation — long-term value is
// dominated by the terminal assumption, which we report as `terminalValueShare`.
import { isNum, clamp, mean } from './quantutil.js';

const DEFAULTS = {
  riskFree: 0.04,
  equityPremium: 0.05,
  terminalGrowth: 0.025,
  years: 10,
  taxRate: 0.21,
  creditSpread: 0.02,
};

export function costOfEquity(beta, p = DEFAULTS) {
  const b = isNum(beta) ? clamp(beta, 0.5, 2.0) : 1; // CAPM, beta clamped for sanity
  return p.riskFree + b * p.equityPremium;
}

export function wacc(ex, ke, p = DEFAULTS) {
  const E = ex.marketCap;
  const D = ex.totalDebt;
  if (!isNum(E) || !isNum(D) || E + D <= 0) return ke; // no debt info -> cost of equity
  const kd = (p.riskFree + p.creditSpread) * (1 - p.taxRate);
  const wE = E / (E + D);
  return clamp(wE * ke + (1 - wE) * kd, 0.06, 0.14);
}

// 2-stage DCF on FCFF -> enterprise value (PV of all FCFF). Returns { ev, terminalPv }.
export function dcfEV(fcf, g1, { discount: r, terminalGrowth: gT, years: N }) {
  if (!isNum(fcf) || fcf <= 0 || !isNum(g1) || !isNum(r) || r <= gT || N < 2) return null;
  let cf = fcf;
  let pv = 0;
  for (let t = 1; t <= N; t++) {
    const g = g1 + ((gT - g1) * (t - 1)) / (N - 1); // linear fade (N>=2 guaranteed)
    cf *= 1 + g;
    pv += cf / (1 + r) ** t;
  }
  const terminalPv = ((cf * (1 + gT)) / (r - gT)) / (1 + r) ** N;
  return { ev: pv + terminalPv, terminalPv };
}

// Bridge enterprise value to equity value per share (EV - net debt) / shares.
function perShare(evObj, ex) {
  if (!evObj || !isNum(ex.sharesOut) || ex.sharesOut <= 0) return null;
  const equity = evObj.ev - (isNum(ex.netDebt) ? ex.netDebt : 0);
  return equity / ex.sharesOut;
}

// Blend available growth signals into one stage-1 growth assumption (floored at 0,
// capped at 20% for long-term sanity).
export function impliedStage1Growth(ex) {
  const candidates = [ex.epsCagr3, ex.revCagr3, ex.earningsGrowth, ex.revenueGrowth].filter(isNum);
  const fwd =
    isNum(ex.forwardEps) && isNum(ex.trailingEps) && ex.trailingEps > 0
      ? ex.forwardEps / ex.trailingEps - 1
      : null;
  if (isNum(fwd)) candidates.push(fwd);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a - b);
  return clamp(candidates[Math.floor(candidates.length / 2)], 0, 0.2);
}

// Reverse DCF: stage-1 growth that the current price implies (via the equity bridge).
export function reverseDcf(ex, params) {
  const { fcf, sharesOut, price, netDebt } = ex;
  if (!isNum(fcf) || fcf <= 0 || !isNum(sharesOut) || sharesOut <= 0 || !isNum(price) || price <= 0)
    return null;
  const targetEV = price * sharesOut + (isNum(netDebt) ? netDebt : 0);
  const evAt = (g) => {
    const o = dcfEV(fcf, g, params);
    return o ? o.ev : null;
  };
  let lo = -0.1;
  let hi = 0.6;
  if (!isNum(evAt(lo)) || !isNum(evAt(hi))) return null;
  if (evAt(lo) > targetEV) return lo;
  if (evAt(hi) < targetEV) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (evAt(mid) < targetEV) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Graham-style multiples value (forward EPS x (8.5 + 2g)). Reported as an
// independent CROSS-CHECK only — deliberately NOT blended into the fair value.
export function multiplesValue(forwardEps, g1) {
  if (!isNum(forwardEps) || forwardEps <= 0 || !isNum(g1)) return null;
  const pe = clamp(8.5 + 2 * (g1 * 100), 5, 45);
  return forwardEps * pe;
}

export function valuation(ex, opts = {}) {
  const p = { ...DEFAULTS, ...opts };
  const ke = costOfEquity(ex.beta, p);
  const discount = wacc(ex, ke, p);
  const params = { discount, terminalGrowth: p.terminalGrowth, years: p.years };

  const g1 = impliedStage1Growth(ex);
  const evObj = dcfEV(ex.fcf, g1, params);
  const dcfValue = perShare(evObj, ex);
  const multValue = multiplesValue(ex.forwardEps, g1);
  const impliedGrowth = reverseDcf(ex, params);
  const marginOfSafety =
    isNum(dcfValue) && isNum(ex.price) && ex.price > 0 ? dcfValue / ex.price - 1 : null;
  const terminalValueShare =
    evObj && isNum(evObj.ev) && evObj.ev > 0 ? evObj.terminalPv / evObj.ev : null;

  // 3x3 sensitivity on discount rate and stage-1 growth -> per-share fair value.
  const sensitivity = [];
  if (isNum(g1)) {
    for (const dr of [-0.01, 0, 0.01]) {
      const row = [];
      for (const dg of [-0.02, 0, 0.02]) {
        const gg = clamp(g1 + dg, -0.1, 0.5);
        row.push({
          discount: discount + dr,
          growth: gg,
          value: perShare(dcfEV(ex.fcf, gg, { ...params, discount: discount + dr }), ex),
        });
      }
      sensitivity.push(row);
    }
  }

  return {
    assumptions: {
      stage1Growth: g1,
      terminalGrowth: p.terminalGrowth,
      discountRate: discount,
      costOfEquity: ke,
      beta: ex.beta,
      years: p.years,
      terminalValueShare,
      model: '2-stage FCFF DCF discounted at WACC, net-debt bridge to equity',
    },
    dcfValue, // primary fair value
    multiplesValue: multValue, // independent cross-check, NOT blended
    blendedFairValue: dcfValue, // fair value = DCF (multiples kept separate by design)
    marginOfSafety,
    impliedGrowth,
    analystUpside: ex.analystUpside,
    sensitivity,
  };
}
