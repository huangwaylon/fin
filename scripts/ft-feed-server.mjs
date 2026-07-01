// Tiny local helper server for the FT full-year extraction, so the browser can:
//   GET  /uuids      -> the full uuid queue (CORS-open) — no pasting
//   POST /save       -> write a batch of extracted records to disk
// Runs on localhost only; CORS open so the ft.com tab can call it.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const PORT = 8799;
const OUT = '/Users/waylonhuang/Documents/other/stocks/ft-scrape/batches/';
mkdirSync(OUT, { recursive: true });
const uuids = readFileSync('/tmp/uuids.json', 'utf8');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.url === '/uuids') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(uuids);
  }
  if (req.url === '/save' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { name, records } = JSON.parse(body);
        const safe = String(name || 'batch').replace(/[^a-z0-9_-]/gi, '');
        writeFileSync(OUT + safe + '.json', JSON.stringify(records));
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ saved: safe, n: records.length }));
      } catch (e) {
        res.writeHead(400, CORS);
        res.end(String(e.message));
      }
    });
    return;
  }
  res.writeHead(404, CORS);
  res.end('nope');
}).listen(PORT, '127.0.0.1', () => console.error('feed server on http://127.0.0.1:' + PORT));
