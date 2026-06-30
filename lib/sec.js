// SEC EDGAR client — pulls regulatory filings (10-K, 10-Q, 8-K, Form 4, etc.).
// SEC requires a descriptive User-Agent and rate-limits to ~10 req/s.
import { cached } from './cache.js';

const UA = 'stock-research-terminal/1.0 (research use; contact: local@localhost)';

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`SEC ${res.status} for ${url}`);
  return res.json();
}

// Ticker -> CIK map. ~10k entries, refreshed daily.
async function tickerMap() {
  return cached('sec:tickers', 24 * 60 * 60 * 1000, async () => {
    const data = await get('https://www.sec.gov/files/company_tickers.json');
    const map = new Map();
    for (const row of Object.values(data)) {
      map.set(String(row.ticker).toUpperCase(), {
        cik: String(row.cik_str).padStart(10, '0'),
        name: row.title,
      });
    }
    return map;
  });
}

export async function cikFor(symbol) {
  const map = await tickerMap();
  return map.get(symbol.toUpperCase()) || null;
}

// Most recent filings for a ticker.
export async function recentFilings(symbol, limit = 25) {
  const entry = await cikFor(symbol);
  if (!entry) return { found: false, filings: [] };

  return cached(`sec:filings:${entry.cik}`, 30 * 60 * 1000, async () => {
    const data = await get(`https://data.sec.gov/submissions/CIK${entry.cik}.json`);
    const r = data.filings?.recent || {};
    const out = [];
    const n = r.accessionNumber?.length || 0;
    for (let i = 0; i < n && out.length < limit; i++) {
      const accession = r.accessionNumber[i].replace(/-/g, '');
      const primary = r.primaryDocument[i];
      out.push({
        form: r.form[i],
        filingDate: r.filingDate[i],
        reportDate: r.reportDate[i] || null,
        primaryDescription: r.primaryDocDescription?.[i] || '',
        url:
          primary &&
          `https://www.sec.gov/Archives/edgar/data/${Number(entry.cik)}/${accession}/${primary}`,
      });
    }
    return {
      found: true,
      cik: entry.cik,
      name: entry.name || data.name,
      sic: data.sicDescription,
      filings: out,
    };
  });
}
