// Tiny in-memory TTL cache. Keeps us polite to free APIs and snappy on repeat hits.
// Bounded so attacker-influenced keys (every distinct article URL / news query)
// can't grow it without limit; oldest entries are evicted first (insertion order).
const store = new Map();
const MAX_ENTRIES = 500;

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

export function cacheSet(key, value, ttlMs) {
  store.delete(key); // re-insert so this key moves to the newest position
  store.set(key, { value, expires: Date.now() + ttlMs });
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
  return value;
}

// Wrap an async producer with caching.
export async function cached(key, ttlMs, producer) {
  const existing = cacheGet(key);
  if (existing !== undefined) return existing;
  const value = await producer();
  return cacheSet(key, value, ttlMs);
}
