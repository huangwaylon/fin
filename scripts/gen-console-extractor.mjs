// Generates ft-scrape/console-extractor.js — a self-contained script the user
// pastes into their Chrome DevTools console (on any ft.com page) to extract the
// full-year analysis queue in one unattended run. No MCP / no 180s cap.
import { readFileSync, writeFileSync } from 'node:fs';
const uuids = JSON.parse(readFileSync('/tmp/uuids.json', 'utf8'));

const script = `/* ============================================================
   FT full-year analysis full-text extractor (personal research)
   HOW TO USE:
   1. Open any article on www.ft.com in this logged-in Chrome
      (free-ft extension active). Open DevTools (Cmd+Opt+J) → Console.
   2. Paste this whole script, press Enter.
   3. Click the green "▶ Start FT extraction" button that appears
      (the click is required so Chrome lets it open the worker tab).
   4. Leave the tab in the FOREGROUND and let it run (~60-90 min).
      It downloads ft-fulltext-part-N.json files as it goes and a
      final one at the end. Resumable: re-running skips done articles.
   ============================================================ */
(() => {
  const QUEUE = ${JSON.stringify(uuids)};
  const PART_SIZE = 300;         // download a part every N extracted
  const MAX_WAIT_MS = 9000;      // per-article render wait
  const POLL = 200;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let done = {};
  try { done = JSON.parse(localStorage.getItem('ftDoneAll') || '{}'); } catch (e) {}

  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;background:#0a0a0a;color:#0f0;font:13px monospace;padding:12px 16px;border:1px solid #0f0;border-radius:6px;max-width:340px;box-shadow:0 4px 20px rgba(0,0,0,.5)';
  ui.innerHTML = '<b>FT extractor</b><br>Queue: ' + QUEUE.length + ' · already done: ' + Object.keys(done).length + '<br><button id="ftgo" style="margin-top:8px;background:#0f0;color:#000;border:0;padding:6px 12px;font-weight:bold;cursor:pointer;border-radius:4px">▶ Start FT extraction</button><div id="ftlog" style="margin-top:8px;white-space:pre-wrap;color:#9f9"></div>';
  document.body.appendChild(ui);
  const log = (m) => { document.getElementById('ftlog').textContent = m; console.log('[ft] ' + m); };

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
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  async function run() {
    document.getElementById('ftgo').remove();
    const win = window.open('about:blank', 'ftworker');
    if (!win) { log('POPUP BLOCKED — allow popups for ft.com and re-run.'); return; }
    const todo = QUEUE.filter((u) => !done[u]);
    let part = [], partNo = 1, ok = 0, n = 0; const t0 = Date.now();
    for (const uuid of todo) {
      win.location.href = 'https://www.ft.com/content/' + uuid;
      let art = null; const s0 = Date.now();
      while (Date.now() - s0 < MAX_WAIT_MS) {
        await sleep(POLL);
        try { if (win.location.href.includes(uuid) && win.document.readyState !== 'loading') art = grab(win.document, uuid); } catch (e) {}
        if (art && art.body && art.body.length > 150) break;
      }
      const rec = art ? { uuid, ok: true, headline: (art.headline || '').trim(), author: art.author, date: art.date, section: art.section, words: art.body.trim().split(/\\s+/).length, body: art.body } : { uuid, ok: false };
      part.push(rec); if (rec.ok) ok++;
      done[uuid] = 1; n++;
      if (n % 10 === 0) { localStorage.setItem('ftDoneAll', JSON.stringify(done));
        const rate = (Date.now() - t0) / n; const eta = Math.round((todo.length - n) * rate / 60000);
        log(n + '/' + todo.length + ' · ok=' + ok + ' · ~' + eta + 'min left'); }
      if (part.length >= PART_SIZE) { download(part, 'ft-fulltext-part-' + partNo + '.json'); partNo++; part = []; }
      await sleep(120);
    }
    localStorage.setItem('ftDoneAll', JSON.stringify(done));
    if (part.length) download(part, 'ft-fulltext-part-' + partNo + '.json');
    win.close();
    log('DONE. extracted ' + n + ' (ok=' + ok + '). Check your Downloads for ft-fulltext-part-*.json');
  }
  document.getElementById('ftgo').onclick = run;
})();`;

writeFileSync('/Users/waylonhuang/Documents/other/stocks/ft-scrape/console-extractor.js', script);
console.error('wrote ft-scrape/console-extractor.js (' + (script.length / 1024).toFixed(0) + ' KB, ' + uuids.length + ' uuids)');
