/**
 * Global Cross-Page Data Store
 * 
 * Prevents duplicate API calls when navigating between Dashboard, Portfolio, and Wallet.
 * Each data category is timestamped when fetched, so pages can skip re-fetching
 * if another page already loaded the same data within a configurable window.
 * 
 * Default TTL: 15 seconds for "recent" checks, longer for entity caches.
 * Manual refreshes bypass this store entirely.
 */

const RECENT_THRESHOLD_MS = 15000; // 15 seconds - if data is newer than this, skip re-fetch
const ANALYSIS_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes for market analysis

// Singleton on window to survive React re-renders and page transitions
if (typeof window !== 'undefined' && !window.__ntDataStore) {
  window.__ntDataStore = {
    // Entity data caches with timestamps
    wallet: { data: null, ts: 0 },
    trades_sim: { data: null, ts: 0 },
    trades_real: { data: null, ts: 0 },
    holdings_sim: { data: null, ts: 0 },
    holdings_real: { data: null, ts: 0 },
    kraken_trades: { data: null, ts: 0 },
    portfolio_value_sim: { data: null, ts: 0 },
    
    // Market analysis cache (analyzeSmallGains results)
    market_analysis: { data: null, ts: 0 },
    
    // Market data (watchlist prices) - supplements CryptoMarketOverview
    market_prices: { data: null, ts: 0 },
  };
}

function getStore() {
  if (typeof window === 'undefined') return {};
  return window.__ntDataStore;
}

/**
 * Check if a data category was recently fetched (within threshold).
 * Returns the cached data if fresh, or null if stale/missing.
 */
export function getRecent(key, thresholdMs = RECENT_THRESHOLD_MS) {
  const store = getStore();
  const entry = store[key];
  if (!entry || !entry.data) return null;
  if (Date.now() - entry.ts > thresholdMs) return null;
  return entry.data;
}

/**
 * Store data for a category with current timestamp.
 */
export function setRecent(key, data) {
  const store = getStore();
  store[key] = { data, ts: Date.now() };
}

/**
 * Invalidate a specific key or all keys.
 */
export function invalidateRecent(key = null) {
  const store = getStore();
  if (key) {
    if (store[key]) {
      store[key] = { data: null, ts: 0 };
    }
  } else {
    Object.keys(store).forEach(k => {
      store[k] = { data: null, ts: 0 };
    });
  }
}

/**
 * Get the timestamp of when a key was last set.
 */
export function getTimestamp(key) {
  const store = getStore();
  return store[key]?.ts || 0;
}

/**
 * Check if market analysis data is fresh (5-min TTL).
 * Used by both QuickActions (sets) and MarketAnalysis page (reads).
 */
export function getRecentAnalysis() {
  return getRecent('market_analysis', ANALYSIS_THRESHOLD_MS);
}

export function setRecentAnalysis(data) {
  setRecent('market_analysis', data);
}