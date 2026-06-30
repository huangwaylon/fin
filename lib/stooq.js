// Stooq client — free daily OHLCV history with no key. Used as a fallback when
// Yahoo's chart endpoint is unavailable.
import { cached } from './cache.js';

function toStooqSymbol(symbol) {
  // Stooq expects e.g. "aapl.us" for US listings.
  const s = symbol.toLowerCase();
  return s.includes('.') ? s : `${s}.us`;
}

// Parse a non-finite-safe number: blank fields and Stooq's "N/D" become null
// rather than 0 (a fabricated price) or NaN (which poisons sums/CAGR downstream).
function num(v) {
  if (v == null || v === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}

// Parse Stooq's CSV body into normalized bars. Exported for offline testing.
export function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2 || !lines[0].startsWith('Date')) {
    return { source: 'stooq', bars: [] };
  }
  const bars = lines
    .slice(1)
    .map((line) => {
      const [date, open, high, low, close, volume] = line.split(',');
      return { date, open: num(open), high: num(high), low: num(low), close: num(close), volume: num(volume) };
    })
    .filter((b) => b.close != null); // a row with no usable close is unusable
  return { source: 'stooq', bars };
}

export async function history(symbol) {
  const sym = toStooqSymbol(symbol);
  return cached(`stooq:${sym}`, 60 * 60 * 1000, async () => {
    const res = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Stooq ${res.status}`);
    return parseCsv(await res.text());
  });
}
