import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Hook to fetch real Kraken PnL data
 */

const GLOBAL_PNL_CACHE = {
  data: null,
  timestamp: 0,
  pendingRequest: null
};

const CACHE_TTL = 60000; // 1 minute cache

export function useKrakenPnL(isSimMode = true) {
  const [pnlData, setPnlData] = useState({
    pnl_24h: 0,
    pnl_lifetime: 0,
    realized_pnl: 0,
    unrealized_pnl: 0
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchPnL = useCallback(async (force = false) => {
    if (isSimMode) {
      setPnlData({ pnl_24h: 0, pnl_lifetime: 0, realized_pnl: 0, unrealized_pnl: 0 });
      return;
    }

    const now = Date.now();
    
    // Use cache if fresh
    if (!force && GLOBAL_PNL_CACHE.data && (now - GLOBAL_PNL_CACHE.timestamp) < CACHE_TTL) {
      setPnlData(GLOBAL_PNL_CACHE.data);
      return;
    }

    // Wait for pending request
    if (GLOBAL_PNL_CACHE.pendingRequest) {
      try {
        const result = await GLOBAL_PNL_CACHE.pendingRequest;
        setPnlData(result);
        return;
      } catch (e) {
        console.error('[useKrakenPnL] Pending request failed:', e);
      }
    }

    setLoading(true);
    setError(null);

    const fetchPromise = (async () => {
      try {
        const response = await Promise.race([
          base44.functions.invoke('getKrakenPnL', {}),
          new Promise((_, reject) => setTimeout(() => reject(new Error('PnL timeout')), 10000))
        ]);

        const data = response?.data || response;

        if (!data?.success) {
          throw new Error(data?.error || 'Failed to fetch PnL');
        }

        const result = {
          pnl_24h: data.pnl_24h || 0,
          pnl_lifetime: data.pnl_lifetime || 0,
          realized_pnl: data.realized_pnl || 0,
          unrealized_pnl: data.unrealized_pnl || 0
        };

        GLOBAL_PNL_CACHE.data = result;
        GLOBAL_PNL_CACHE.timestamp = Date.now();
        GLOBAL_PNL_CACHE.pendingRequest = null;

        return result;
      } catch (err) {
        GLOBAL_PNL_CACHE.pendingRequest = null;
        throw err;
      }
    })();

    GLOBAL_PNL_CACHE.pendingRequest = fetchPromise;

    try {
      const result = await fetchPromise;
      setPnlData(result);
    } catch (err) {
      console.error('[useKrakenPnL] Error:', err.message);
      setError(err.message);
      setPnlData({ pnl_24h: 0, pnl_lifetime: 0, realized_pnl: 0, unrealized_pnl: 0 });
    } finally {
      setLoading(false);
    }
  }, [isSimMode]);

  useEffect(() => {
    fetchPnL();
  }, [fetchPnL]);

  return {
    pnlData,
    loading,
    error,
    refresh: () => fetchPnL(true)
  };
}

export function invalidateKrakenPnLCache() {
  GLOBAL_PNL_CACHE.data = null;
  GLOBAL_PNL_CACHE.timestamp = 0;
  GLOBAL_PNL_CACHE.pendingRequest = null;
}