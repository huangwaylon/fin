// Build a clean list of recent (last ~4 weeks) FT article URLs from section RSS
// feeds. RSS gives direct ft.com/content/<uuid> URLs + title + date + summary,
// which we need for per-article browser navigation (Google-redirect links don't
// carry the uuid). Output: ft-scrape/recent-urls.json
import { writeFileSync } from 'node:fs';
const UA = 'Mozilla/5.0';
const SINCE = new Date('2026-06-01T00:00:00Z').getTime();
const FEEDS = {
  Unhedged: 'https://www.ft.com/unhedged?format=rss',
  Lex: 'https://www.ft.com/lex?format=rss',
  Markets: 'https://www.ft.com/markets?format=rss',
  Companies: 'https://www.ft.com/companies?format=rss',
  Opinion: 'https://www.ft.com/opinion?format=rss',
  'Global economy': 'https://www.ft.com/global-economy?format=rss',
};
const dec = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
async function get(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
  try { const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ac.signal }); return r.ok ? await r.text() : ''; }
  catch { return ''; } finally { clearTimeout(t); }
}
const byUrl = new Map();
for (const [section, feed] of Object.entries(FEEDS)) {
  const xml = await get(feed);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  let kept = 0;
  for (const m of items) {
    const g = (t) => { const mm = m[1].match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return mm ? dec(mm[1]) : null; };
    const link = g('link'); const date = g('pubDate');
    if (!link || !/ft\.com\/content\//.test(link)) continue;
    if (date && new Date(date).getTime() < SINCE) continue;
    const url = link.split('?')[0];
    if (byUrl.has(url)) { if (!byUrl.get(url).sections.includes(section)) byUrl.get(url).sections.push(section); continue; }
    byUrl.set(url, { url, title: g('title'), date, summary: g('description'), sections: [section] });
    kept++;
  }
  console.error(`${section}: ${items.length} items, ${kept} kept (>= 2026-06-01)`);
}
const list = [...byUrl.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
writeFileSync(new URL('../ft-scrape/recent-urls.json', import.meta.url).pathname, JSON.stringify(list, null, 2));
console.error(`\nTOTAL unique recent URLs: ${list.length}`);
list.forEach((a, i) => console.error(`${i + 1}. [${a.sections.join('/')}] ${new Date(a.date).toISOString().slice(0, 10)} ${a.title}`));
