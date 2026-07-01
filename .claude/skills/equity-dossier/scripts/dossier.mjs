#!/usr/bin/env node
// equity-dossier: standardized single-ticker decision memo from the research server.
//
// Usage:
//   node dossier.mjs NVDA [--md]
//
// Technique: pull the full decision brief (scorecard + DCF/reverse-DCF valuation +
// price signals + bull/bear) and recent SEC filings, then assemble a consistent memo:
// rating & conviction, valuation gap, momentum/risk, catalysts, and an explicit
// "what would change the thesis" derived from the bear case. Nothing is fabricated;
// missing fields stay null and lower the implied confidence.

import { api, tryApi, r2, pct, num, emit } from '../../_shared/quant.mjs';

const argv = process.argv.slice(2);
const asMd = argv.includes('--md');
const sym = (argv.find(a => !a.startsWith('--')) || '').toUpperCase();
if (!sym) { console.error('usage: node dossier.mjs <ticker> [--md]'); process.exit(1); }

let brief;
try {
  brief = await api(`/api/brief?symbol=${encodeURIComponent(sym)}&format=json`);
} catch (e) {
  process.stdout.write(JSON.stringify({ skill: 'equity-dossier', symbol: sym, ok: false, error: String(e.message || e), hint: 'Is the server running? npm start' }, null, 2) + '\n');
  process.exit(1);
}
const filingsRes = await tryApi(`/api/filings?symbol=${encodeURIComponent(sym)}`);

const sc = brief.scorecard || {};
const val = brief.valuation || {};
const sig = brief.signals || {};

// Recent filings as catalysts (best-effort across possible shapes).
let filings = [];
if (filingsRes.ok) {
  const f = filingsRes.data;
  const arr = Array.isArray(f) ? f : (f.filings || f.recent || f.results || []);
  filings = (Array.isArray(arr) ? arr : []).slice(0, 6).map(x => ({
    form: x.form ?? x.type ?? null, date: x.date ?? x.filingDate ?? x.filed ?? null,
    title: x.title ?? x.description ?? null,
  }));
}

const memo = {
  skill: 'equity-dossier',
  symbol: brief.symbol ?? sym, name: brief.name ?? null, asOf: brief.asOf ?? null,
  sector: brief.sector ?? null, price: brief.price ?? null,
  reliability: brief.reliability ?? null, modelNotes: brief.modelNotes ?? [],
  decision: {
    rating: sc.rating ?? null, composite: r2(sc.composite, 1), conviction: sc.conviction ?? null,
    actionable: sc.actionable ?? null, coverage: sc.coverage ?? null,
    factors: Object.fromEntries(Object.entries(sc.factors || {}).map(([k, v]) => [k, r2(v.score, 0)])),
  },
  valuation: {
    blendedFairValue: r2(val.blendedFairValue, 2), dcfValue: r2(val.dcfValue, 2),
    multiplesValue: r2(val.multiplesValue, 2), marginOfSafety: r2(val.marginOfSafety, 3),
    impliedGrowth: r2(val.impliedGrowth, 3), analystUpside: r2(val.analystUpside, 3),
    model: val.assumptions?.model ?? null, discountRate: r2(val.assumptions?.discountRate, 3),
  },
  signals: {
    trend: sig.trend ?? null, mom12_1: r2(sig.mom12_1, 3), annualVol: r2(sig.annualVol, 3),
    maxDrawdown: r2(sig.maxDrawdown, 3), week52pos: r2(sig.week52pos, 2),
  },
  bull: brief.bull ?? [], bear: brief.bear ?? [], flags: brief.flags ?? [],
  catalysts: { news: (brief.news || []).slice(0, 5), filings },
  whatWouldChangeThesis: brief.bear ?? [],
  dataQuality: brief.dataQuality ?? null,
  disclaimer: brief.disclaimer ?? 'Research/decision-support only. Not investment advice.',
};

emit(memo, asMd, o => {
  const d = o.decision, v = o.valuation, s = o.signals;
  const f = Object.entries(d.factors).map(([k, x]) => `${k} ${x}`).join(' · ');
  const lines = [
    `# ${o.symbol} — ${o.name || ''}  ($${num(o.price)})`,
    `*${o.sector || '?'} · as of ${o.asOf || '?'} · reliability: ${o.reliability || '?'}*`,
    '',
    `## Decision`,
    `**${d.rating || '?'}** · composite ${num(d.composite, 1)}/100 · conviction ${num(d.conviction)} · actionable: ${d.actionable}`,
    `Factors: ${f || 'n/a'}`,
    '',
    `## Valuation`,
    `Fair value $${num(v.blendedFairValue)} (DCF $${num(v.dcfValue)}, multiples $${num(v.multiplesValue)}) · margin of safety ${pct(v.marginOfSafety)}`,
    `Reverse-DCF implied growth ${pct(v.impliedGrowth)} · analyst upside ${pct(v.analystUpside)} · ${v.model || ''}`,
    '',
    `## Signals`,
    `Trend ${s.trend || '?'} · 12-1 momentum ${pct(s.mom12_1)} · annual vol ${pct(s.annualVol)} · max drawdown ${pct(s.maxDrawdown)} · 52w position ${num(s.week52pos)}`,
    '',
    `## Bull`, ...(o.bull.length ? o.bull.map(b => `- ${b}`) : ['- (none)']),
    '', `## Bear / what would change the thesis`, ...(o.bear.length ? o.bear.map(b => `- ${b}`) : ['- (none)']),
    '', `## Catalysts`,
    `News: ${(o.catalysts.news || []).map(x => x.title).filter(Boolean).slice(0, 3).join(' | ') || '(none)'}`,
    `Filings: ${(o.catalysts.filings || []).map(x => `${x.form || '?'} ${x.date || ''}`).join(', ') || '(none)'}`,
    '', `_${o.disclaimer}_`,
  ];
  return lines.join('\n');
});
