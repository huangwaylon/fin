// Assemble the final full-text archive from the browser-extracted bodies.
// Joins ft-fulltext-raw.json (headline/author/date/body from the logged-in
// browser) with extract-queue.json (section/column tags + RSS summary).
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('../ft-scrape/', import.meta.url).pathname;

let raw = JSON.parse(readFileSync(dir + 'ft-fulltext-raw.json', 'utf8'));
if (!Array.isArray(raw)) raw = raw.result || raw.value || raw.output || [];
const queue = JSON.parse(readFileSync(dir + 'extract-queue.json', 'utf8'));
const meta = new Map(queue.map((q) => [q.url, q]));

const rows = raw
  .filter((r) => r.ok && r.body)
  .map((r) => {
    const m = meta.get(r.url) || {};
    return {
      url: r.url,
      headline: r.headline,
      author: r.author || null,
      date: r.date || m.date || null,
      columns: m.sections || (r.section ? [r.section] : []),
      summary: m.summary || null,
      words: r.words,
      body: r.body,
    };
  })
  .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

const failed = raw.filter((r) => !r.ok).map((r) => ({ url: r.url, ...(meta.get(r.url) || {}) }));

writeFileSync(
  dir + 'ft-fulltext.json',
  JSON.stringify(
    {
      generated: '2026-07-01',
      source: 'Full text extracted via logged-in Chrome (free-ft), from FT analysis columns',
      window: 'recent ~4 weeks (published >= 2026-06-01)',
      counts: { extracted: rows.length, paywalled_unavailable: failed.length, total_words: rows.reduce((s, r) => s + r.words, 0) },
      articles: rows,
      unavailable: failed,
    },
    null,
    2
  )
);

// Markdown: full readable text, newest first
let md = `# Financial Times — full text (analysis columns, last ~4 weeks)\n\n`;
md += `Extracted 2026-07-01 via logged-in browser. **${rows.length} articles**, ${rows.reduce((s, r) => s + r.words, 0).toLocaleString()} words. Window: published ≥ 2026-06-01. (${failed.length} were paywalled/unavailable — listed at end.)\n\n`;
md += `---\n\n`;
for (const r of rows) {
  const d = r.date ? new Date(r.date).toISOString().slice(0, 10) : '????-??-??';
  md += `## ${r.headline}\n\n`;
  md += `*${d}`;
  if (r.author) md += ` · ${r.author}`;
  if (r.columns?.length) md += ` · ${r.columns.join('/')}`;
  md += ` · ${r.words} words*\n\n`;
  md += `<${r.url}>\n\n`;
  md += r.body.trim() + '\n\n---\n\n';
}
if (failed.length) {
  md += `## Unavailable (paywalled — free-ft rewrite did not apply)\n\n`;
  for (const f of failed) md += `- ${f.title || f.url}${f.date ? ' (' + new Date(f.date).toISOString().slice(0, 10) + ')' : ''} — ${f.url}\n`;
}
writeFileSync(dir + 'ft-fulltext.md', md);
console.error(`Wrote ft-fulltext.json + ft-fulltext.md: ${rows.length} articles, ${rows.reduce((s, r) => s + r.words, 0)} words, ${failed.length} unavailable`);
