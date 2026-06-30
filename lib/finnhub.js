// Finnhub client — optional. Provides peer companies and basic profile data.
// Enabled only when FINNHUB_API_KEY is set in the environment; otherwise calls
// resolve to null and the UI simply hides those sections.
import { cached } from './cache.js';

const KEY = process.env.FINNHUB_API_KEY || '';
export const finnhubEnabled = Boolean(KEY);

async function get(path) {
  if (!KEY) return null;
  const res = await fetch(`https://finnhub.io/api/v1${path}&token=${KEY}`);
  if (!res.ok) throw new Error(`Finnhub ${res.status}`);
  return res.json();
}

export function peers(symbol) {
  if (!KEY) return Promise.resolve(null);
  return cached(`fh:peers:${symbol}`, 6 * 60 * 60 * 1000, () =>
    get(`/stock/peers?symbol=${encodeURIComponent(symbol)}`)
  );
}
