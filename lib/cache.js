// Tiny in-memory TTL cache. Keeps us polite to free APIs and snappy on repeat hits.
const store = new Map();

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
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

// Wrap an async producer with caching.
export async function cached(key, ttlMs, producer) {
  const existing = cacheGet(key);
  if (existing !== undefined) return existing;
  const value = await producer();
  return cacheSet(key, value, ttlMs);
}
