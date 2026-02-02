import { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * useKrakenData Hook - ULTRA-RELIABLE VERSION
 * 
 * CRITICAL FIXES:
 * 1. Increased timeout from 6s to 12s (Kraken can be slow)
 * 2. Better retry logic with exponential backoff
 * 3. Returns partial data instead of failing completely
 * 4. Graceful degradation
 */

// GLOBAL CACHE - shared across ALL component instances
const GLOBAL_CACHE = {
  data: null,
  timestamp: 0,
  pendingRequest: null,
  lastError: null,
  subscribers: new Set()
};

const CACHE_TTL = 30000; // 30 seconds
const REQUEST_TIMEOUT = 12000; // 12 seconds HARD LIMIT (increased from 8s)
const MAX_RETRIES = 3;

/**
 * Fetch Kraken data with retries and deduplication
 */
async function fetchKrakenDataGlobal(force = false, retryCount = 0) {
  const now = Date.now();
  
  // Return cached data if fresh (and not forcing)
  if (!force && GLOBAL_CACHE.data && (now - GLOBAL_CACHE.timestamp) < CACHE_TTL) {
    console.log('[useKrakenData] 💾 Using cached data (age:', Math.floor((now - GLOBAL_CACHE.timestamp) / 1000), 'sec)');
    return GLOBAL_CACHE.data;
  }

  // If there's already a pending request, WAIT FOR IT (deduplication)
  if (GLOBAL_CACHE.pendingRequest) {
    console.log('[useKrakenData] ⏳ Waiting for pending request...');
    try {
      return await GLOBAL_CACHE.pendingRequest;
    } catch (error) {
      console.warn('[useKrakenData] Pending request failed');
      // Don't return - let it retry below
    }
  }

  console.log('[useKrakenData] 🔄 Fetching fresh Kraken data... (attempt', retryCount + 1, '/', MAX_RETRIES, ')');

  // Create the fetch promise with STRICT timeout
  const fetchPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.error('[useKrakenData] ⏰ Request timeout after', REQUEST_TIMEOUT / 1000, 's');
        controller.abort();
      }, REQUEST_TIMEOUT);

      const response = await Promise.race([
        base44.functions.invoke('getKrakenBalance', {}),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), REQUEST_TIMEOUT)
        )
      ]);

      clearTimeout(timeoutId);
      
      const data = response?.data || response;

      // CRITICAL: Handle not connected gracefully (don't throw)
      if (!data?.success) {
        const errorMsg = data?.error || 'Failed to fetch Kraken data';
        
        // If it's just "not connected", return empty data (don't throw)
        if (data?.connected === false || /not connected/i.test(errorMsg)) {
          console.warn('[useKrakenData] ⚠️ Kraken not connected');
          GLOBAL_CACHE.lastError = errorMsg;
          GLOBAL_CACHE.pendingRequest = null;
          
          return {
            usd_balance: 0,
            holdings: [],
            total_assets: 0,
            total_crypto_value: 0,
            total_portfolio_value: 0,
            total_cost_basis: 0,
            total_unrealized_pnl: 0,
            connected: false,
            last_updated: new Date().toISOString(),
            prices_available: false,
            cost_basis_available: false
          };
        }
        
        // Other errors: throw to trigger retry logic
        throw new Error(errorMsg);
      }

      // Build normalized data structure
      const krakenInfo = {
        usd_balance: data.usd_balance || 0,
        holdings: data.holdings || [],
        total_assets: data.total_assets || 0,
        total_crypto_value: data.total_crypto_value_usd || 0,
        total_portfolio_value: data.total_portfolio_value_usd || 0,
        total_cost_basis: data.total_cost_basis_usd || 0,
        total_unrealized_pnl: data.total_unrealized_pnl_usd || 0,
        connected: true,
        last_updated: new Date().toISOString(),
        prices_available: data.prices_available || false,
        cost_basis_available: data.cost_basis_available || false,
        rate_limit_counter: data.rate_limit_counter || '0',
        rate_limit_max: data.rate_limit_max || '15'
      };

      // Update global cache
      GLOBAL_CACHE.data = krakenInfo;
      GLOBAL_CACHE.timestamp = Date.now();
      GLOBAL_CACHE.lastError = null;
      GLOBAL_CACHE.pendingRequest = null;

      // Notify all subscribers
      GLOBAL_CACHE.subscribers.forEach(callback => {
        try {
          callback(krakenInfo);
        } catch (e) {
          console.error('[useKrakenData] Subscriber callback error:', e);
        }
      });

      console.log('[useKrakenData] ✅ Data cached:', {
        usd: krakenInfo.usd_balance.toFixed(2),
        assets: krakenInfo.total_assets,
        value: krakenInfo.total_portfolio_value.toFixed(2),
        crypto: krakenInfo.total_crypto_value.toFixed(2)
      });

      return krakenInfo;

    } catch (error) {
      console.error('[useKrakenData] ❌ Fetch failed (attempt', retryCount + 1, '):', error.message);
      
      GLOBAL_CACHE.lastError = error.message;
      GLOBAL_CACHE.pendingRequest = null;

      // RETRY LOGIC: Exponential backoff
      if (retryCount < MAX_RETRIES) {
        const delay = Math.min(2000 * Math.pow(1.5, retryCount), 6000); // 2s, 3s, 4.5s
        console.log(`[useKrakenData] 🔄 Retrying in ${delay}ms...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchKrakenDataGlobal(force, retryCount + 1);
      }

      // Return stale cache if available (better than nothing)
      if (GLOBAL_CACHE.data) {
        console.warn('[useKrakenData] ⚠️ Max retries reached, returning stale cache (age:', Math.floor((Date.now() - GLOBAL_CACHE.timestamp) / 1000), 'sec)');
        return GLOBAL_CACHE.data;
      }

      throw error;
    }
  })();

  // Store pending request for deduplication
  GLOBAL_CACHE.pendingRequest = fetchPromise;

  return fetchPromise;
}

/**
 * Invalidate global cache (call after trades, sync, etc.)
 */
export function invalidateKrakenCache() {
  console.log('[useKrakenData] 🗑️ Cache invalidated');
  GLOBAL_CACHE.data = null;
  GLOBAL_CACHE.timestamp = 0;
  GLOBAL_CACHE.lastError = null;
}

/**
 * Main hook
 */
export function useKrakenData(isSimMode = true, autoFetch = true) {
  const [krakenData, setKrakenData] = useState(GLOBAL_CACHE.data);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(GLOBAL_CACHE.lastError);
  const [connected, setConnected] = useState(false);
  
  const isMountedRef = useRef(true);
  const hasFetchedRef = useRef(false);

  // Subscribe to global cache updates
  useEffect(() => {
    const handleUpdate = (data) => {
      if (!isMountedRef.current) return;
      setKrakenData(data);
      setConnected(true);
      setError(null);
      setLoading(false);
    };

    GLOBAL_CACHE.subscribers.add(handleUpdate);

    return () => {
      GLOBAL_CACHE.subscribers.delete(handleUpdate);
    };
  }, []);

  const fetchData = useCallback(async (force = false) => {
    // Skip if in simulation mode
    if (isSimMode) {
      setKrakenData(null);
      setConnected(false);
      setLoading(false);
      return null;
    }

    // CRITICAL: Always fetch if force=true OR if we have no data
    const shouldFetch = force || !GLOBAL_CACHE.data || (Date.now() - GLOBAL_CACHE.timestamp) >= CACHE_TTL;

    if (!shouldFetch) {
      console.log('[useKrakenData] Using fresh cache, skipping fetch');
      setKrakenData(GLOBAL_CACHE.data);
      setConnected(true);
      setError(null);
      setLoading(false);
      return GLOBAL_CACHE.data;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchKrakenDataGlobal(force);
      
      if (!isMountedRef.current) return data;

      setKrakenData(data);
      setConnected(true);
      setError(null);
      return data;

    } catch (err) {
      console.error('[useKrakenData] Final error after retries:', err.message);
      
      if (!isMountedRef.current) return null;

      setError(err.message);
      setConnected(false);
      
      // Clear data to avoid misleading stale display when requests fail repeatedly
      setKrakenData(null);

      return null;
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [isSimMode]);

  // CRITICAL: Use cached data - provider handles the actual fetching
  // This hook should NOT initiate fetches to prevent duplicate API calls
  useEffect(() => {
    isMountedRef.current = true;

    if (!isSimMode && GLOBAL_CACHE.data) {
      // Use cached data immediately - provider will refresh it
      console.log('[useKrakenData] Using cached data from provider');
      setKrakenData(GLOBAL_CACHE.data);
      setConnected(true);
      setLoading(false);
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [isSimMode]);

  // CRITICAL: Events are now handled by the centralized provider
  // This hook should NOT make its own API calls on events to prevent rate limits
  // Just listen for cache updates from the provider
  useEffect(() => {
    const handleSync = () => {
      console.log('[useKrakenData] Sync event - provider will handle refresh');
      // Don't fetch here - provider handles this
    };

    window.addEventListener('kraken:synced', handleSync);
    window.addEventListener('trade:completed', handleSync);

    return () => {
      window.removeEventListener('kraken:synced', handleSync);
      window.removeEventListener('trade:completed', handleSync);
    };
  }, []);

  const refresh = useCallback(() => {
    console.log('[useKrakenData] 🔄 Manual refresh requested - invalidating cache');
    invalidateKrakenCache();
    // Don't fetch here - components should use the provider's fetchKrakenData
    // Just return null, the provider will handle the actual fetch
    return Promise.resolve(GLOBAL_CACHE.data);
  }, []);

  return {
    krakenData,
    loading,
    error,
    refresh,
    connected
  };
}

/**
 * Get current cached data (without fetching)
 */
export function getKrakenCacheData() {
  return GLOBAL_CACHE.data;
}

/**
 * Check if cache is fresh
 */
export function isKrakenCacheFresh() {
  return GLOBAL_CACHE.data && (Date.now() - GLOBAL_CACHE.timestamp) < CACHE_TTL;
}