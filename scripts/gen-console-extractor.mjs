// Generates ft-scrape/console-extractor.js — a crash-safe browser-console
// extractor for the full-year FT analysis queue.
// Robustness fixes over v1: every record is written to IndexedDB immediately
// (survives tab close, no 5MB cap), resume skips only uuids already stored WITH
// a body (failures are retried), and a "Download all" button + window.__ftDump()
// let you export everything collected so far at any moment.
import { readFileSync, writeFileSync } from 'node:fs';
const uuids = JSON.parse(readFileSync('/tmp/uuids.json', 'utf8'));

const script = `/* ============================================================
   FT full-year analysis full-text extractor v2 (personal research)
   1. Open any www.ft.com article in this logged-in Chrome (free-ft on).
      DevTools (Cmd+Opt+J) -> Console. Paste this whole script, Enter.
   2. Click "> Start / Resume". Click "v Download all" whenever you want a
      JSON of everything collected so far (also auto-downloads at the end).
   3. Keep the tab in the FOREGROUND while running (~60-90 min for the full
      queue). Safe to stop/close: progress is saved in IndexedDB; re-paste
      and Start to resume. window.__ftDump() also downloads on demand.
   ============================================================ */
(() => {
  const QUEUE = ${JSON.stringify(uuids)};
  const MAX_WAIT_MS = 9000, POLL = 200, GAP = 120;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- IndexedDB (crash-safe store) ----
  const DB = 'ftx';
  const openDB = () => new Promise((res, rej) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore('a', { keyPath: 'uuid' });
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  const idbPut = (db, rec) => new Promise((res, rej) => { const t = db.transaction('a', 'readwrite'); t.objectStore('a').put(rec); t.oncomplete = res; t.onerror = () => rej(t.error); });
  const idbAll = (db) => new Promise((res, rej) => { const r = db.transaction('a', 'readonly').objectStore('a').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  let db;
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;background:#0a0a0a;color:#0f0;font:13px monospace;padding:12px 16px;border:1px solid #0f0;border-radius:6px;max-width:360px;box-shadow:0 4px 20px rgba(0,0,0,.5)';
  ui.innerHTML = '<b>FT extractor v2</b><br><div id="ftstat">init…</div>' +
    '<button id="ftgo" style="margin-top:8px;background:#0f0;color:#000;border:0;padding:6px 12px;font-weight:bold;cursor:pointer;border-radius:4px">▶ Start / Resume</button> ' +
    '<button id="ftdl" style="margin-top:8px;background:#09f;color:#fff;border:0;padding:6px 12px;font-weight:bold;cursor:pointer;border-radius:4px">⤓ Download all</button>' +
    '<div id="ftlog" style="margin-top:8px;white-space:pre-wrap;color:#9f9"></div>';
  document.body.appendChild(ui);
  const log = (m) => { document.getElementById('ftlog').textContent = m; console.log('[ft] ' + m); };
  const stat = (m) => { document.getElementById('ftstat').textContent = m; };

  const grab = (doc, uuid) => {
    const canon = doc.querySelector('link[rel="canonical"]')?.href || doc.querySelector('meta[property="og:url"]')?.content || '';
    if (!canon.includes(uuid)) return null;
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try { const d = JSON.parse(s.textContent);
        for (const n of (Array.isArray(d) ? d : (d['@graph'] || [d]))) {
          if (n && n.articleBody) return { headline: n.headline, author: n.author ? (Array.isArray(n.author) ? n.author.map(a => a.name).filter(Boolean).join(', ') : n.author.name) : null, date: n.datePublished, section: n.articleSection || null, body: n.articleBody };
        }
      } catch (e) {}
    }
    return null;
  };
  const download = (obj, name) => {
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };
  const dumpAll = async () => { const all = await idbAll(db); download(all, 'ft-fullyear-all.json'); log('downloaded ' + all.length + ' records -> ft-fullyear-all.json'); return all.length; };
  window.__ftDump = dumpAll;

  let running = false;
  async function run() {
    if (running) return; running = true;
    document.getElementById('ftgo').disabled = true;
    const existing = await idbAll(db);
    const haveBody = new Set(existing.filter(r => r.ok).map(r => r.uuid));
    const todo = QUEUE.filter(u => !haveBody.has(u));
    const win = window.open('about:blank', 'ftworker');
    if (!win) { log('POPUP BLOCKED — allow popups for ft.com, then click Start again.'); running = false; document.getElementById('ftgo').disabled = false; return; }
    let n = 0, ok = 0; const t0 = Date.now();
    for (const uuid of todo) {
      win.location.href = 'https://www.ft.com/content/' + uuid;
      let art = null; const s0 = Date.now();
      while (Date.now() - s0 < MAX_WAIT_MS) {
        await sleep(POLL);
        try { if (win.location.href.includes(uuid) && win.document.readyState !== 'loading') art = grab(win.document, uuid); } catch (e) {}
        if (art && art.body && art.body.length > 150) break;
      }
      const rec = art ? { uuid, ok: true, headline: (art.headline || '').trim(), author: art.author, date: art.date, section: art.section, words: art.body.trim().split(/\\s+/).length, body: art.body } : { uuid, ok: false };
      try { await idbPut(db, rec); } catch (e) { log('IDB write failed: ' + e.message); }
      n++; if (rec.ok) ok++;
      if (n % 5 === 0) { const rate = (Date.now() - t0) / n, eta = Math.round((todo.length - n) * rate / 60000);
        stat('done ' + (haveBody.size + n) + '/' + QUEUE.length + ' · this run ' + n + '/' + todo.length + ' · ok ' + ok + ' · ~' + eta + 'min left'); }
      await sleep(GAP);
    }
    win.close();
    log('RUN COMPLETE. this run: ' + n + ' (ok ' + ok + '). Click "Download all" (auto-downloading now).');
    await dumpAll();
    running = false; document.getElementById('ftgo').disabled = false;
  }

  openDB().then(async (d) => { db = d; const all = await idbAll(db); const okN = all.filter(r => r.ok).length;
    stat('queue ' + QUEUE.length + ' · already stored ' + okN + ' (of ' + all.length + ' attempted)'); log('ready.'); });
  document.getElementById('ftgo').onclick = run;
  document.getElementById('ftdl').onclick = dumpAll;
})();`;

writeFileSync('/Users/waylonhuang/Documents/other/stocks/ft-scrape/console-extractor.js', script);
console.error('wrote ft-scrape/console-extractor.js v2 (' + (script.length / 1024).toFixed(0) + ' KB, ' + uuids.length + ' uuids)');
