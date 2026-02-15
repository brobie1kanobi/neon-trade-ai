import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { getCached, invalidateCache, fetchWithRetry } from './useDataFetching';

/**
 * useHoldings Hook
 * Centralized holdings data management with aggressive caching and retry logic
 * 
 * @param {boolean} isSimMode - Whether to fetch simulation or real holdings
 * @returns {Object} { holdings, loading, error, refresh, updateHolding }
 */
export function useHoldings(isSimMode = true) {
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHoldings = useCallback(async (useCache = true) => {
    setLoading(true);
    setError(null);
    
    try {
      const cacheKey = `holdings:${isSimMode ? 'sim' : 'real'}`;
      
      let data;
      if (useCache) {
        data = await getCached(
          cacheKey,
          async () => {
            // Use fetchWithRetry for database timeout resilience
            return await fetchWithRetry(async () => {
              const user = await base44.auth.me();
              return await base44.entities.Holding.filter(
                { created_by: user.email, is_simulation: isSimMode },
                '-updated_date',
                500
              );
            }, 5, 3000); // 5 retries, 3 second initial delay
          },
          10 * 60 * 1000 // 10 minute cache (increased from 3)
        );
      } else {
        invalidateCache(cacheKey);
        data = await fetchWithRetry(async () => {
          const user = await base44.auth.me();
          return await base44.entities.Holding.filter(
            { created_by: user.email, is_simulation: isSimMode },
            '-updated_date',
            500
          );
        }, 5, 3000);
      }
      
      setHoldings(data || []);
      setError(null); // Clear error on success
      return data || [];
    } catch (err) {
      console.error('[useHoldings] Error fetching holdings:', err);
      setError(err);
      // Keep existing holdings on error - don't clear the UI
      return holdings;
    } finally {
      setLoading(false);
    }
  }, [isSimMode, holdings]);

  // CRITICAL: When isSimMode changes, invalidate cache and re-fetch
  useEffect(() => {
    invalidateCache(`holdings:sim`);
    invalidateCache(`holdings:real`);
    fetchHoldings(false);
  }, [isSimMode]);

  // Listen for holdings updates
  useEffect(() => {
    const handleHoldingUpdate = (event) => {
      const { source } = event.detail || {};
      if (source !== 'useHoldings') {
        fetchHoldings(false);
      }
    };

    window.addEventListener('app:data-updated', handleHoldingUpdate);
    return () => window.removeEventListener('app:data-updated', handleHoldingUpdate);
  }, [fetchHoldings]);

  const refresh = useCallback(() => fetchHoldings(false), [fetchHoldings]);

  const updateHolding = useCallback(async (holdingId, updates) => {
    try {
      await fetchWithRetry(async () => {
        return await base44.entities.Holding.update(holdingId, updates);
      }, 5, 3000);
      
      invalidateCache(`holdings:${isSimMode ? 'sim' : 'real'}`);
      await fetchHoldings(false);
      
      window.dispatchEvent(new CustomEvent('app:data-updated', {
        detail: { type: 'holding', source: 'useHoldings' }
      }));
    } catch (err) {
      console.error('[useHoldings] Error updating holding:', err);
      throw err;
    }
  }, [isSimMode, fetchHoldings]);

  return {
    holdings,
    loading,
    error,
    refresh,
    updateHolding
  };
}