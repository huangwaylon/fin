// Decode Google News redirect links -> real ft.com URLs, using Google's
// batchexecute endpoint (works from the sandbox; the browser popup can't run
// Google's client-side redirect in the background). Input: fullyear-queue.json.
// Output: fullyear-urls.json = [{url(ft.com), title, date, tags}] + failures.
import { readFileSync, writeFileSync } from 'node:fs';
const UA = 'Mozilla/5.0';
const dir = new URL('../ft-scrape/', import.meta.url).pathname;
const queue = JSON.parse(readFileSync(dir + 'fullyear-queue.json', 'utf8'));

async function get(u, opt = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try { return await fetch(u, { ...opt, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

async function decode(gUrl) {
  const r = await get(gUrl, { headers: { 'User-Agent': UA } });
  const h = await r.text();
  const sg = h.match(/data-n-a-sg="([^"]+)"/);
  const ts = h.match(/data-n-a-ts="([^"]+)"/);
  if (!sg || !ts) return null;
  const gnId = gUrl.split('/articles/')[1].split('?')[0];
  const payload = [[["Fbv4je", JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], gnId, ts[1], sg[1]])]]];
  const body = 'f.req=' + encodeURIComponent(JSON.stringify(payload));
  const br = await get('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
  });
  const bt = await br.text();
  const m = bt.match(/https?:\\?\/\\?\/[^"\\]+/g);
  if (!m) return null;
  const url = m.map((x) => x.replace(/\\/g, '')).find((x) => /ft\.com\/content\/[0-9a-f-]{36}/.test(x));
  return url ? url.split('?')[0] : null;
}

const out = [];
const failed = [];
let done = 0;
const CONC = 8;
let idx = 0;
async function worker() {
  while (idx < queue.length) {
    const i = idx++;
    const item = queue[i];
    try {
      let ft = null;
      if (/ft\.com\/content\/[0-9a-f-]{36}/.test(item.url)) ft = item.url.split('?')[0];
      else if (/news\.google/.test(item.url)) ft = await decode(item.url);
      if (ft) out.push({ url: ft, title: item.title, date: item.date, tags: item.tags });
      else failed.push({ url: item.url, title: item.title });
    } catch (e) {
      failed.push({ url: item.url, title: item.title, err: e.message });
    }
    done++;
    if (done % 100 === 0) {
      console.error(`decoded ${done}/${queue.length} (ok=${out.length} fail=${failed.length})`);
      // checkpoint
      writeFileSync(dir + 'fullyear-urls.json', JSON.stringify({ ok: out.length, failed: failed.length, urls: out, failures: failed }, null, 2));
    }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
// dedupe by ft url
const seen = new Set(); const uniq = [];
for (const r of out.sort((a, b) => new Date(b.date) - new Date(a.date))) { if (seen.has(r.url)) continue; seen.add(r.url); uniq.push(r); }
writeFileSync(dir + 'fullyear-urls.json', JSON.stringify({ ok: uniq.length, failed: failed.length, urls: uniq, failures: failed }, null, 2));
console.error(`\nDONE: ${uniq.length} unique ft.com URLs, ${failed.length} failed`);
