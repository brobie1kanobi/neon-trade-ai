import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { getCached, invalidateCache } from './useDataFetching';

/**
 * useUser Hook
 * Centralized user data management with caching
 * 
 * @returns {Object} { user, loading, error, refresh, updateUser }
 */
export function useUser() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchUser = useCallback(async (useCache = true) => {
    setLoading(true);
    setError(null);
    
    try {
      const cacheKey = 'user';
      
      let data;
      if (useCache) {
        data = await getCached(
          cacheKey,
          async () => await base44.auth.me(),
          10 * 60 * 1000 // 10 minute cache - user data changes infrequently
        );
      } else {
        invalidateCache(cacheKey);
        data = await base44.auth.me();
      }
      
      setUser(data);
      return data;
    } catch (err) {
      console.error('[useUser] Error fetching user:', err);
      setError(err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const refresh = useCallback(() => fetchUser(false), [fetchUser]);

  const updateUser = useCallback(async (updates) => {
    try {
      await base44.auth.updateMe(updates);
      invalidateCache('user');
      await fetchUser(false);
    } catch (err) {
      console.error('[useUser] Error updating user:', err);
      throw err;
    }
  }, [fetchUser]);

  return {
    user,
    loading,
    error,
    refresh,
    updateUser
  };
}