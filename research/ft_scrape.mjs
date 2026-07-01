// FT financial-analysis discovery: pull Unhedged + other FT analysis columns via
// RSS (clean dated ft.com links) and Google News RSS (supplementary), dedupe,
// keep the last 365 days, sort newest-first. Then attempt full-text extraction on
// a sample via the project's FT-aware extractArticle to see if the WAF lets us.
import { writeFileSync } from 'node:fs';
import { extractArticle } from '../lib/news.js';

const UA = { 'User-Agent': 'Mozilla/5.0' };
const NOW = Date.parse('2026-07-01T00:00:00Z');
const YEAR_AGO = NOW - 365 * 864e5;

// FT section/column feeds relevant to financial analysis (pattern: /<section>?format=rss).
const FT_FEEDS = {
  Unhedged: 'https://www.ft.com/unhedged?format=rss',
  Markets: 'https://www.ft.com/markets?format=rss',
  Lex: 'https://www.ft.com/lex?format=rss',
  'The Long View': 'https://www.ft.com/the-long-view?format=rss',
  Companies: 'https://www.ft.com/companies?format=rss',
  'Global Economy': 'https://www.ft.com/global-economy?format=rss',
  'Capital Markets': 'https://www.ft.com/capital-markets?format=rss',
  Equities: 'https://www.ft.com/equities?format=rss',
  'Fund Management': 'https://www.ft.com/fund-management?format=rss',
  Opinion: 'https://www.ft.com/opinion?format=rss',
};

// Google News RSS queries (recency-biased, links are google-wrapped) for extra coverage.
const GN_QUERIES = [
  '"Unhedged" site:ft.com',
  '"Lex" site:ft.com markets',
  'site:ft.com Robert Armstrong Unhedged',
  'site:ft.com Katie Martin markets',
  'site:ft.com equities analysis',
];

const dec = (s) => String(s || '')
  .replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .trim();

function parseRss(xml, source) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const b = m[1];
    const tag = (t) => { const mm = b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return mm ? dec(mm[1]) : null; };
    const pub = tag('pubDate');
    return { title: tag('title'), link: tag('link'), published: pub ? new Date(Date.parse(pub)).toISOString() : null, ts: pub ? Date.parse(pub) : null, source };
  }).filter((i) => i.title && i.link);
}

async function get(url) {
  const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.text();
}

const items = [];
const coverage = {};
for (const [name, url] of Object.entries(FT_FEEDS)) {
  try { const it = parseRss(await get(url), `ft:${name}`); items.push(...it); coverage[name] = it.length; }
  catch (e) { coverage[name] = `ERR ${e.message}`; }
}
for (const q of GN_QUERIES) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const it = parseRss(await get(url), 'google-news').map((i) => ({ ...i, query: q }));
    items.push(...it);
  } catch { /* optional */ }
}

// Dedupe by normalized title; keep the item with a clean ft.com link if available.
const byKey = new Map();
for (const it of items) {
  const key = it.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
  const isFt = /(^|\.)ft\.com/.test(it.link);
  const prev = byKey.get(key);
  if (!prev || (isFt && !/(^|\.)ft\.com/.test(prev.link))) byKey.set(key, it);
}
let all = [...byKey.values()];
const undated = all.filter((i) => !i.ts).length;
all = all.filter((i) => i.ts == null || (i.ts >= YEAR_AGO && i.ts <= NOW + 864e5))
  .sort((a, b) => (b.ts || 0) - (a.ts || 0));

// Month histogram of dated items.
const hist = {};
for (const i of all) if (i.ts) { const m = i.published.slice(0, 7); hist[m] = (hist[m] || 0) + 1; }

writeFileSync(new URL('./ft_articles.json', import.meta.url), JSON.stringify({ generatedFor: '2026-07-01', count: all.length, coverage, monthHistogram: hist, items: all }, null, 2));

console.log('Feed coverage (items parsed):', JSON.stringify(coverage));
console.log(`\nTotal unique articles (<=1y): ${all.length}  (undated kept: ${undated})`);
console.log('By month:', JSON.stringify(hist));
const ftClean = all.filter((i) => /(^|\.)ft\.com/.test(i.link));
console.log(`Clean ft.com links: ${ftClean.length}; google-wrapped: ${all.length - ftClean.length}`);
const dates = all.filter((i) => i.ts).map((i) => i.ts);
if (dates.length) console.log(`Date span actually reached: ${new Date(Math.min(...dates)).toISOString().slice(0,10)} … ${new Date(Math.max(...dates)).toISOString().slice(0,10)}`);

// Extraction attempt on up to 3 Unhedged ft.com articles (honest WAF check).
const sample = ftClean.filter((i) => /unhedged/i.test(i.source) || /unhedged/i.test(i.link)).slice(0, 3);
console.log(`\nExtraction attempt on ${sample.length} Unhedged article(s):`);
for (const s of sample) {
  try { const a = await extractArticle(s.link); console.log(`  ${a.ok ? 'OK ' + (a.text ? a.text.length + ' chars' : '') : 'FAIL ' + (a.status || a.error)}  — ${s.title.slice(0, 70)}`); }
  catch (e) { console.log(`  ERR ${String(e.message).slice(0, 50)} — ${s.title.slice(0, 60)}`); }
}
