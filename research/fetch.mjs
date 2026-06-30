// Historical-data fetcher for the universe study. Pulls ~10y daily bars for
// S&P 500 + Nasdaq-100 constituents via the project's Yahoo client (throttled),
// caching each ticker to disk so the run is resumable and analysis is offline.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import * as yahoo from '../lib/yahoo.js';
import { history as stooqHistory } from '../lib/stooq.js';
import { parseBars } from '../lib/decision.js';

const DIR = new URL('./data/', import.meta.url);
const dataDir = DIR.pathname;
mkdirSync(dataDir, { recursive: true });

async function sp500() {
  const t = await (await fetch('https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv')).text();
  return t.trim().split('\n').slice(1).map((l) => l.split(',')[0].trim()).filter(Boolean);
}
async function nasdaq100() {
  const h = await (await fetch('https://en.wikipedia.org/wiki/Nasdaq-100', { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  const i = h.search(/id="?constituents/i);
  const seg = h.slice(i, i + 40000);
  // First <td> of each row is the ticker (plain text, no link).
  return [...seg.matchAll(/<tr[^>]*>\s*<td[^>]*>([A-Z][A-Z.]{0,5})<\/td>/g)].map((m) => m[1]);
}

const norm = (s) => s.replace(/\./g, '-').toUpperCase(); // BRK.B -> BRK-B for Yahoo

async function getBars(sym) {
  try {
    const c = await yahoo.chart(sym, '10y', '1d');
    const b = parseBars(c);
    if (b.length > 300) return b;
  } catch { /* fall through */ }
  try {
    const b = parseBars({ ...(await stooqHistory(sym)) });
    if (b.length > 300) return b;
  } catch { /* fall through */ }
  return null;
}

const [sp, ndx] = await Promise.all([sp500(), nasdaq100()]);
const spSet = new Set(sp.map(norm));
const ndxSet = new Set(ndx.map(norm));
const all = [...new Set([...spSet, ...ndxSet])];
writeFileSync(new URL('./membership.json', import.meta.url), JSON.stringify({ sp500: [...spSet], ndx: [...ndxSet] }));
console.log(`Universe: ${spSet.size} S&P500, ${ndxSet.size} Nasdaq-100, ${all.length} unique.`);

let done = 0, ok = 0, failed = [];
for (const sym of all) {
  const f = `${dataDir}${sym}.json`;
  done++;
  if (existsSync(f)) { ok++; continue; }
  const bars = await getBars(sym);
  if (!bars) { failed.push(sym); }
  else {
    ok++;
    // store compact: [unixTime, adjClose]  (adj already falls back to close in parseBars)
    writeFileSync(f, JSON.stringify(bars.map((b) => [b.time, +b.adjClose])));
  }
  if (done % 25 === 0) console.log(`  ${done}/${all.length} (ok ${ok}, failed ${failed.length})`);
}
writeFileSync(new URL('./failures.json', import.meta.url), JSON.stringify(failed));
console.log(`DONE: ${ok}/${all.length} cached, ${failed.length} failed: ${failed.slice(0, 30).join(',')}${failed.length > 30 ? '…' : ''}`);
