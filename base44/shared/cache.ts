/**
 * Lightweight shared in-memory TTL cache for backend functions.
 * Each Deno isolate keeps its own Map, so this dedupes calls within the
 * same warm instance — use for short-TTL response caching of expensive
 * read calls (market data, LLM analysis, external APIs).
 */

const store = new Map(); // key -> { data, expiresAt }

/** Get a cached value if present and not expired, else null. */
export function getCached(key) {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  if (hit) store.delete(key);
  return null;
}

/** Store a value under key for ttlMs milliseconds. */
export function setCached(key, data, ttlMs) {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/** Remove a single cached key. */
export function invalidateCached(key) {
  store.delete(key);
}

/** Remove all cached keys starting with prefix (e.g. a per-user namespace). */
export function invalidateByPrefix(prefix) {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

/** Fetch-or-compute helper: returns cached value, else runs fn(), caches, and returns it. */
export async function withCache(key, ttlMs, fn) {
  const cached = getCached(key);
  if (cached !== null) return cached;
  const fresh = await fn();
  setCached(key, fresh, ttlMs);
  return fresh;
}