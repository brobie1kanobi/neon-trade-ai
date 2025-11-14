import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { getCached, invalidateCache, fetchWithRetry } from './useDataFetching';

/**
 * useTrades Hook
 * Centralized trades data management with aggressive caching and retry logic
 * 
 * @param {boolean} isSimMode - Whether to fetch simulation or real trades
 * @returns {Object} { trades, loading, error, refresh, addTrade }
 */
export function useTrades(isSimMode = true) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchTrades = useCallback(async (useCache = true) => {
    setLoading(true);
    setError(null);
    
    try {
      const cacheKey = `trades:${isSimMode ? 'sim' : 'real'}`;
      
      let data;
      if (useCache) {
        data = await getCached(
          cacheKey,
          async () => {
            // Use fetchWithRetry for database timeout resilience
            return await fetchWithRetry(async () => {
              const user = await base44.auth.me();
              return await base44.entities.Trade.filter(
                { created_by: user.email, is_simulation: isSimMode },
                '-created_date',
                200
              );
            }, 5, 3000); // 5 retries, 3 second initial delay
          },
          10 * 60 * 1000 // 10 minute cache (increased from 3)
        );
      } else {
        invalidateCache(cacheKey);
        data = await fetchWithRetry(async () => {
          const user = await base44.auth.me();
          return await base44.entities.Trade.filter(
            { created_by: user.email, is_simulation: isSimMode },
            '-created_date',
            200
          );
        }, 5, 3000);
      }
      
      setTrades(data || []);
      setError(null); // Clear error on success
      return data || [];
    } catch (err) {
      console.error('[useTrades] Error fetching trades:', err);
      setError(err);
      // Keep existing trades on error - don't clear the UI
      return trades;
    } finally {
      setLoading(false);
    }
  }, [isSimMode, trades]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  // Listen for trade updates
  useEffect(() => {
    const handleTradeUpdate = (event) => {
      const { source } = event.detail || {};
      if (source !== 'useTrades') {
        fetchTrades(false);
      }
    };

    window.addEventListener('app:data-updated', handleTradeUpdate);
    return () => window.removeEventListener('app:data-updated', handleTradeUpdate);
  }, [fetchTrades]);

  const refresh = useCallback(() => fetchTrades(false), [fetchTrades]);

  const addTrade = useCallback(async (tradeData) => {
    try {
      const newTrade = await fetchWithRetry(async () => {
        const user = await base44.auth.me();
        return await base44.entities.Trade.create({
          ...tradeData,
          created_by: user.email,
          is_simulation: isSimMode
        });
      }, 5, 3000);
      
      invalidateCache(`trades:${isSimMode ? 'sim' : 'real'}`);
      await fetchTrades(false);
      
      window.dispatchEvent(new CustomEvent('app:data-updated', {
        detail: { type: 'trade', source: 'useTrades' }
      }));
      
      return newTrade;
    } catch (err) {
      console.error('[useTrades] Error adding trade:', err);
      throw err;
    }
  }, [isSimMode, fetchTrades]);

  return {
    trades,
    loading,
    error,
    refresh,
    addTrade
  };
}