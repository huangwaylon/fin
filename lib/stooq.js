// Stooq client — free daily OHLCV history with no key. Used as a fallback when
// Yahoo's chart endpoint is unavailable.
import { cached } from './cache.js';

function toStooqSymbol(symbol) {
  // Stooq expects e.g. "aapl.us" for US listings.
  const s = symbol.toLowerCase();
  return s.includes('.') ? s : `${s}.us`;
}

export async function history(symbol) {
  const sym = toStooqSymbol(symbol);
  return cached(`stooq:${sym}`, 60 * 60 * 1000, async () => {
    const res = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`);
    if (!res.ok) throw new Error(`Stooq ${res.status}`);
    const text = await res.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2 || !lines[0].startsWith('Date')) {
      return { source: 'stooq', bars: [] };
    }
    const bars = lines.slice(1).map((line) => {
      const [date, open, high, low, close, volume] = line.split(',');
      return {
        date,
        open: +open,
        high: +high,
        low: +low,
        close: +close,
        volume: +volume,
      };
    });
    return { source: 'stooq', bars };
  });
}
