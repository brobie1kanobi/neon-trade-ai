import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { getCached, invalidateCache, fetchWithRetry } from './useDataFetching';

/**
 * useWallet Hook
 * Centralized wallet data management with aggressive caching and retry logic
 * 
 * @returns {Object} { wallet, loading, error, refresh, updateBalance }
 */
export function useWallet() {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchWallet = useCallback(async (useCache = true) => {
    setLoading(true);
    setError(null);
    
    try {
      const cacheKey = 'wallet';
      
      let data;
      if (useCache) {
        // Use cached data if available (10 minute TTL)
        data = await getCached(
          cacheKey,
          async () => {
            // Use fetchWithRetry for database timeout resilience
            return await fetchWithRetry(async () => {
              const user = await base44.auth.me();
              const wallets = await base44.entities.Wallet.filter(
                { created_by: user.email },
                '-updated_date',
                1
              );
              return wallets[0] || {
                cash_balance: 10000,
                total_deposits: 0,
                total_withdrawals: 0,
                real_cash_balance: 0,
                real_total_deposits: 0,
                real_total_withdrawals: 0
              };
            }, 5, 3000); // 5 retries, 3 second initial delay
          },
          10 * 60 * 1000 // 10 minute cache (increased from 5)
        );
      } else {
        // Force fresh fetch
        invalidateCache(cacheKey);
        data = await fetchWithRetry(async () => {
          const user = await base44.auth.me();
          const wallets = await base44.entities.Wallet.filter(
            { created_by: user.email },
            '-updated_date',
            1
          );
          return wallets[0] || {
            cash_balance: 10000,
            total_deposits: 0,
            total_withdrawals: 0,
            real_cash_balance: 0,
            real_total_deposits: 0,
            real_total_withdrawals: 0
          };
        }, 5, 3000);
      }
      
      setWallet(data);
      setError(null); // Clear error on success
      return data;
    } catch (err) {
      console.error('[useWallet] Error fetching wallet:', err);
      setError(err);
      // Keep existing wallet on error - don't clear the UI
      return wallet;
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  // Initial fetch on mount
  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  // Listen for wallet updates from other components
  useEffect(() => {
    const handleWalletUpdate = () => {
      fetchWallet(false); // Force refresh on update
    };

    window.addEventListener('wallet:updated', handleWalletUpdate);
    return () => window.removeEventListener('wallet:updated', handleWalletUpdate);
  }, [fetchWallet]);

  const refresh = useCallback(() => fetchWallet(false), [fetchWallet]);

  const updateBalance = useCallback(async (updates) => {
    if (!wallet?.id) return;
    
    try {
      await fetchWithRetry(async () => {
        return await base44.entities.Wallet.update(wallet.id, updates);
      }, 5, 3000);
      
      invalidateCache('wallet');
      await fetchWallet(false);
      window.dispatchEvent(new CustomEvent('wallet:updated'));
    } catch (err) {
      console.error('[useWallet] Error updating balance:', err);
      throw err;
    }
  }, [wallet, fetchWallet]);

  return {
    wallet,
    loading,
    error,
    refresh,
    updateBalance
  };
}