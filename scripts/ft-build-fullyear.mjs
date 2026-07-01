// Assemble the full-year FT archive from:
//   - console-extractor part files (ft-fulltext-part-*.json) in ~/Downloads
//   - the MCP batch files already captured (ft-scrape/batches/*.json)
// Joins bodies with fullyear-urls.json (title/date/tags), dedupes by uuid,
// writes ft-scrape/ft-fullyear.{json,md}.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const DIR = '/Users/waylonhuang/Documents/other/stocks/ft-scrape/';
const DL = process.argv[2] || (homedir() + '/Downloads');

const meta = new Map(
  JSON.parse(readFileSync(DIR + 'fullyear-urls.json', 'utf8')).urls.map((u) => {
    const uuid = u.url.split('/content/')[1];
    return [uuid, u];
  })
);

const byUuid = new Map();
function ingest(records, src) {
  for (const r of records || []) {
    if (!r || !r.uuid) continue;
    const prev = byUuid.get(r.uuid);
    // prefer an ok record over a failed one
    if (prev && prev.ok && !r.ok) continue;
    byUuid.set(r.uuid, { ...r, _src: src });
  }
}

// 1. MCP batch files
if (existsSync(DIR + 'batches')) {
  for (const f of readdirSync(DIR + 'batches').filter((f) => f.endsWith('.json'))) {
    let d = JSON.parse(readFileSync(DIR + 'batches/' + f, 'utf8'));
    ingest(Array.isArray(d) ? d : d.records, 'mcp:' + f);
  }
}
// 2. console-extractor parts from Downloads
if (existsSync(DL)) {
  for (const f of readdirSync(DL).filter((f) => /^ft-fulltext-part-.*\.json$/.test(f))) {
    ingest(JSON.parse(readFileSync(DL + '/' + f, 'utf8')), 'console:' + f);
  }
}

const rows = [];
for (const [uuid, r] of byUuid) {
  if (!r.ok || !r.body) continue;
  const m = meta.get(uuid) || {};
  rows.push({
    url: 'https://www.ft.com/content/' + uuid,
    headline: r.headline,
    author: r.author || null,
    date: r.date || m.date || null,
    columns: m.tags && m.tags.length ? m.tags : (r.section ? [r.section] : []),
    words: r.words,
    body: r.body,
  });
}
rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

const attempted = byUuid.size;
const okCount = rows.length;
const totalWords = rows.reduce((s, r) => s + (r.words || 0), 0);
const failedUuids = [...byUuid.values()].filter((r) => !r.ok).map((r) => r.uuid);
const missing = [...meta.keys()].filter((u) => !byUuid.has(u));

writeFileSync(DIR + 'ft-fullyear.json', JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: 'Full text via logged-in Chrome (free-ft); FT analysis columns Unhedged/Lex/The Long View, ~1 year',
  counts: { queued: meta.size, attempted, extracted: okCount, failed: failedUuids.length, missing: missing.length, total_words: totalWords },
  articles: rows,
}, null, 2));

// grouped markdown by month
const byMonth = new Map();
for (const r of rows) { const k = r.date ? r.date.slice(0, 7) : 'undated'; (byMonth.get(k) || byMonth.set(k, []).get(k)).push(r); }
const months = [...byMonth.keys()].sort().reverse();
let md = `# Financial Times — full-text archive (analysis columns, ~1 year)\n\n`;
md += `**${okCount} articles**, ${totalWords.toLocaleString()} words. Columns: Unhedged / Lex / The Long View. Source: logged-in browser (free-ft). Generated ${new Date().toISOString().slice(0, 10)}.\n\n`;
for (const mo of months) {
  const rs = byMonth.get(mo);
  md += `## ${mo} (${rs.length})\n\n`;
  for (const r of rs) {
    md += `### ${r.headline}\n\n*${(r.date || '').slice(0, 10)}${r.author ? ' · ' + r.author : ''}${r.columns.length ? ' · ' + r.columns.join('/') : ''} · ${r.words}w*\n\n<${r.url}>\n\n${r.body.trim()}\n\n---\n\n`;
  }
}
writeFileSync(DIR + 'ft-fullyear.md', md);
console.error(`ft-fullyear: ${okCount} articles, ${totalWords} words | attempted ${attempted}, failed ${failedUuids.length}, not-yet-fetched ${missing.length}`);
