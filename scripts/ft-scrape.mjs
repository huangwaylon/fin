// FT financial-analysis catalog scraper (discovery-only, dependency-free).
//
// Why this shape: FT article BODY text is 403-blocked from datacenter IPs by
// FT's WAF (confirmed from this sandbox), so we cannot pull full text here.
// But two public discovery channels DO work:
//   1. FT section RSS feeds  -> title + description + author + date (last ~month)
//   2. Google News RSS with after:/before: date operators -> title + date + link,
//      sliceable month-by-month, which lets us go back a full year.
//
// We slice the window [1 year ago .. today] into monthly buckets, query the FT
// analysis columns (Unhedged, Lex, The Long View, markets analysis) per month,
// enrich recent items with the richer RSS metadata, dedupe by title, and emit a
// JSON + Markdown catalog. No fabrication: missing fields are null.
import { writeFileSync, mkdirSync } from 'node:fs';

const UA = 'Mozilla/5.0';
const OUT_DIR = new URL('../ft-scrape/', import.meta.url).pathname;
const TODAY = new Date('2026-07-01T00:00:00Z');
const START = new Date('2025-07-01T00:00:00Z');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, headers = { 'User-Agent': UA }) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, { headers, signal: ac.signal, redirect: 'follow' });
    const body = r.ok ? await r.text() : '';
    return { status: r.status, body };
  } catch (e) {
    return { status: 'ERR:' + e.message, body: '' };
  } finally {
    clearTimeout(t);
  }
}

const dec = (s) =>
  String(s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();

// Google News stuffs an <a href=…> anchor into <description>; that's not a
// summary. Strip tags and reject anything that isn't real prose (no-fabrication:
// we return null rather than pass off a link as a summary).
function cleanDesc(raw, title) {
  const txt = dec(String(raw || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (!txt || txt.length < 25) return null;
  if (/^https?:\/\//.test(txt)) return null;
  if (norm(txt) === norm(title)) return null; // just the headline repeated
  return txt;
}

function parseItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const g = (t) => {
      const mm = m[1].match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'));
      return mm ? dec(mm[1]) : null;
    };
    const title = g('title');
    return {
      title,
      description: cleanDesc(g('description'), title),
      link: g('link'),
      pubDate: g('pubDate'),
      author: g('dc:creator') || g('author'),
      source: g('source'),
    };
  });
}

// Google News appends " - <Publisher>" to titles; strip a trailing FT/publisher tag.
function cleanTitle(t) {
  if (!t) return t;
  return t.replace(/\s*-\s*(Financial Times|FT|AFR|Bloomberg|Reuters)\s*$/i, '').trim();
}
const norm = (t) => cleanTitle(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function inWindow(d) {
  const t = new Date(d).getTime();
  return t >= START.getTime() && t < TODAY.getTime();
}

// Skip section/landing/fund pages and PR-wire / regulatory filings that leak in
// via the broad "markets" query — these are machine-posted to FT.com but are not
// journalism/analysis.
const PR_RE =
  /company announcement|form 8\.3|form 8\.5|net asset value|total voting rights|transaction in own shares|holding\(s\) in company|director\/pdmr|block listing|- ft\.com$|posting of|result of agm|dividend declaration|notice of results/i;
function isJunk(title) {
  const n = norm(title);
  if (!n || n === 'unhedged' || n === 'lex' || n === 'financial times' || n === 'the long view') return true;
  if (/\bfund\b.*(class|accumulating|distributing)/.test(n)) return true;
  if (PR_RE.test(title)) return true;
  return false;
}

const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

// --- 1. Month-sliced Google News discovery across the analysis columns ---
const COLUMNS = [
  { tag: 'Unhedged', q: 'site:ft.com Unhedged' },
  { tag: 'Lex', q: 'site:ft.com Lex' },
  { tag: 'The Long View', q: 'site:ft.com "The Long View"' },
  { tag: 'Markets analysis', q: 'site:ft.com markets analysis' },
];

const byKey = new Map(); // normalized title -> record

function add(rec, tag) {
  if (!rec.title || isJunk(rec.title)) return;
  if (rec.pubDate && !inWindow(rec.pubDate)) return;
  const key = norm(rec.title);
  const existing = byKey.get(key);
  const clean = cleanTitle(rec.title);
  if (existing) {
    if (!existing.tags.includes(tag)) existing.tags.push(tag);
    if (!existing.author && rec.author) existing.author = rec.author;
    if (!existing.date && rec.pubDate) existing.date = rec.pubDate;
    return;
  }
  byKey.set(key, {
    title: clean,
    date: rec.pubDate || null,
    link: rec.link || null,
    author: rec.author || null,
    // Google News <description> just repeats the headline; real summaries only
    // come from the FT section-feed enrichment pass below.
    description: null,
    publisher: rec.source || null,
    tags: [tag],
  });
}

// Build monthly windows.
const windows = [];
{
  let cur = new Date(START);
  while (cur.getTime() < TODAY.getTime()) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const end = next.getTime() < TODAY.getTime() ? next : TODAY;
    windows.push([new Date(cur), end]);
    cur = next;
  }
}

const iso = (d) => d.toISOString().slice(0, 10);
let reqCount = 0;
for (const [a, b] of windows) {
  for (const col of COLUMNS) {
    const query = `${col.q} after:${iso(a)} before:${iso(b)}`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const { status, body } = await get(url);
    const items = parseItems(body);
    let kept = 0;
    for (const it of items) {
      const before = byKey.size;
      add(it, col.tag);
      if (byKey.size > before) kept++;
    }
    reqCount++;
    console.error(`[${ym(a)}] ${col.tag}: ${status} raw=${items.length} newUnique=${kept}`);
    await sleep(250);
  }
}

// --- 2. Enrich with current FT section RSS feeds (rich description + author) ---
const FEEDS = [
  'https://www.ft.com/unhedged?format=rss',
  'https://www.ft.com/markets?format=rss',
  'https://www.ft.com/companies?format=rss',
  'https://www.ft.com/opinion?format=rss',
  'https://www.ft.com/lex?format=rss',
  'https://www.ft.com/global-economy?format=rss',
];
for (const feed of FEEDS) {
  const { status, body } = await get(feed);
  const items = parseItems(body);
  console.error(`[feed] ${feed.replace('https://www.ft.com/', '')}: ${status} items=${items.length}`);
  for (const it of items) {
    if (!it.title || isJunk(it.title)) continue;
    const key = norm(it.title);
    const rec = byKey.get(key);
    if (rec) {
      // enrich existing: prefer direct ft.com link + real description/author
      if (it.link && /ft\.com/.test(it.link)) rec.link = it.link;
      if (it.description) rec.description = it.description;
      if (it.author) rec.author = it.author;
    } else if (it.pubDate && inWindow(it.pubDate)) {
      byKey.set(key, {
        title: cleanTitle(it.title),
        date: it.pubDate,
        link: it.link || null,
        author: it.author || null,
        description: it.description || null,
        publisher: 'Financial Times',
        tags: ['Section feed'],
      });
    }
  }
  await sleep(200);
}

// --- 3. Sort, categorize, write outputs ---
const all = [...byKey.values()].sort(
  (x, y) => new Date(y.date || 0) - new Date(x.date || 0)
);

mkdirSync(OUT_DIR, { recursive: true });
const stamp = TODAY.toISOString().slice(0, 10);
writeFileSync(
  `${OUT_DIR}ft-analysis-catalog.json`,
  JSON.stringify(
    {
      generated: stamp,
      window: { from: iso(START), to: iso(TODAY) },
      note:
        'FT article body text is 403-blocked from datacenter IPs (WAF); this is a discovery catalog (title/date/link/summary) built from FT section RSS + month-sliced Google News RSS.',
      googleNewsRequests: reqCount,
      count: all.length,
      articles: all,
    },
    null,
    2
  )
);

// group by month for the markdown
const byMonth = new Map();
for (const a of all) {
  const key = a.date ? ym(new Date(a.date)) : 'undated';
  if (!byMonth.has(key)) byMonth.set(key, []);
  byMonth.get(key).push(a);
}
const months = [...byMonth.keys()].sort().reverse();
const counts = COLUMNS.map((c) => `${c.tag}: ${all.filter((a) => a.tags.includes(c.tag)).length}`);
let md = `# Financial Times — Analysis catalog (${iso(START)} → ${iso(TODAY)})\n\n`;
md += `Generated ${stamp}. **${all.length}** unique articles discovered across ${windows.length} monthly slices.\n\n`;
md += `> Body text is not included: FT's WAF returns HTTP 403 to this datacenter IP. This is a discovery catalog (title, date, summary, link) from FT section RSS feeds + month-sliced Google News RSS. Links via Google News redirect to ft.com (paywalled).\n\n`;
md += `**Column coverage:** ${counts.join(' · ')}\n\n`;
for (const mo of months) {
  const rows = byMonth.get(mo);
  md += `## ${mo} (${rows.length})\n\n`;
  for (const a of rows) {
    const d = a.date ? new Date(a.date).toISOString().slice(0, 10) : '????-??-??';
    md += `- **${d}** · [${a.tags.join(', ')}] ${a.title}`;
    if (a.author) md += ` — _${a.author}_`;
    md += `\n`;
    if (a.description) md += `  - ${a.description}\n`;
    if (a.link) md += `  - ${a.link}\n`;
  }
  md += `\n`;
}
writeFileSync(`${OUT_DIR}ft-analysis-catalog.md`, md);
console.error(`\nDONE: ${all.length} unique articles -> ${OUT_DIR}`);
console.error(`Column coverage: ${counts.join(' | ')}`);
