import { useState, useCallback, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * useKrakenSnapshot Hook - REST API DATA FETCHER
 * 
 * This hook handles SNAPSHOT data from Kraken REST API.
 * It is used for:
 * - Initial data load on app start
 * - Authoritative balance verification
 * - Historical data (trades, deposits, withdrawals)
 * - Recovery after WebSocket disconnect
 * 
 * This hook does NOT:
 * - Poll for live price updates (use WebSocket)
 * - Subscribe to real-time balance changes (use WebSocket)
 * 
 * CRITICAL: This should only be called:
 * 1. On initial app load
 * 2. After WebSocket reconnection (to re-sync)
 * 3. After placing/canceling orders (to verify)
 * 4. On manual user refresh
 */

// Global snapshot cache - prevents duplicate fetches across components
const SNAPSHOT_CACHE = {
  balance: { data: null, timestamp: 0 },
  orders: { data: null, timestamp: 0 },
  trades: { data: null, timestamp: 0 },
  pnl: { data: null, timestamp: 0 },
  isLoading: false,
  lastError: null
};

// Minimum time between REST calls (to prevent rate limits)
const MIN_FETCH_INTERVAL = 15000; // 15 seconds

/**
 * Fetch Kraken balance snapshot (REST API)
 * Returns balances, holdings, and portfolio value
 */
async function fetchBalanceSnapshot(force = false) {
  const now = Date.now();
  
  // Return cached if fresh and not forced
  if (!force && SNAPSHOT_CACHE.balance.data && (now - SNAPSHOT_CACHE.balance.timestamp) < MIN_FETCH_INTERVAL) {
    console.log('[useKrakenSnapshot] Using cached balance snapshot');
    return SNAPSHOT_CACHE.balance.data;
  }
  
  console.log('[useKrakenSnapshot] Fetching REST balance snapshot...');
  
  try {
    const response = await base44.functions.invoke('getKrakenBalance', {});
    const data = response?.data || response;
    
    if (data?.success) {
      SNAPSHOT_CACHE.balance = { data, timestamp: now };
      console.log('[useKrakenSnapshot] Balance snapshot fetched:', {
        usd: data.usd_balance?.toFixed(2),
        crypto: data.total_crypto_value_usd?.toFixed(2),
        assets: data.total_assets
      });
    }
    
    return data;
  } catch (error) {
    console.error('[useKrakenSnapshot] Balance fetch error:', error);
    SNAPSHOT_CACHE.lastError = error.message;
    return SNAPSHOT_CACHE.balance.data; // Return stale cache on error
  }
}

/**
 * Fetch open orders snapshot (REST API)
 */
async function fetchOrdersSnapshot(force = false) {
  const now = Date.now();
  
  if (!force && SNAPSHOT_CACHE.orders.data && (now - SNAPSHOT_CACHE.orders.timestamp) < MIN_FETCH_INTERVAL) {
    console.log('[useKrakenSnapshot] Using cached orders snapshot');
    return SNAPSHOT_CACHE.orders.data;
  }
  
  console.log('[useKrakenSnapshot] Fetching REST orders snapshot...');
  
  try {
    const response = await base44.functions.invoke('krakenApi', { 
      action: 'getOpenOrders' 
    });
    const data = response?.data || response;
    
    if (data?.success) {
      SNAPSHOT_CACHE.orders = { data, timestamp: now };
      console.log('[useKrakenSnapshot] Orders snapshot fetched:', data.orders?.length || 0, 'orders');
    }
    
    return data;
  } catch (error) {
    console.error('[useKrakenSnapshot] Orders fetch error:', error);
    return SNAPSHOT_CACHE.orders.data;
  }
}

/**
 * Fetch trade history (REST API)
 */
async function fetchTradesSnapshot(force = false) {
  const now = Date.now();
  
  // Trade history doesn't change frequently - cache for 60s
  if (!force && SNAPSHOT_CACHE.trades.data && (now - SNAPSHOT_CACHE.trades.timestamp) < 60000) {
    console.log('[useKrakenSnapshot] Using cached trades snapshot');
    return SNAPSHOT_CACHE.trades.data;
  }
  
  console.log('[useKrakenSnapshot] Fetching REST trades history...');
  
  try {
    const response = await base44.functions.invoke('krakenApi', { 
      action: 'getTradesHistory' 
    });
    const data = response?.data || response;
    
    if (data?.success) {
      SNAPSHOT_CACHE.trades = { data, timestamp: now };
      console.log('[useKrakenSnapshot] Trades snapshot fetched:', data.trades?.length || 0, 'trades');
    }
    
    return data;
  } catch (error) {
    console.error('[useKrakenSnapshot] Trades fetch error:', error);
    return SNAPSHOT_CACHE.trades.data;
  }
}

/**
 * Fetch PnL data (REST API)
 */
async function fetchPnLSnapshot(force = false) {
  const now = Date.now();
  
  // PnL can be cached longer - 2 minutes
  if (!force && SNAPSHOT_CACHE.pnl.data && (now - SNAPSHOT_CACHE.pnl.timestamp) < 120000) {
    console.log('[useKrakenSnapshot] Using cached PnL snapshot');
    return SNAPSHOT_CACHE.pnl.data;
  }
  
  console.log('[useKrakenSnapshot] Fetching REST PnL data...');
  
  try {
    const response = await base44.functions.invoke('getKrakenPnL', {});
    const data = response?.data || response;
    
    if (data?.success) {
      SNAPSHOT_CACHE.pnl = { data, timestamp: now };
      console.log('[useKrakenSnapshot] PnL snapshot fetched');
    }
    
    return data;
  } catch (error) {
    console.error('[useKrakenSnapshot] PnL fetch error:', error);
    return SNAPSHOT_CACHE.pnl.data;
  }
}

/**
 * Main hook
 */
export function useKrakenSnapshot(options = {}) {
  const { autoFetch = false, isSimMode = true } = options;
  
  const [balance, setBalance] = useState(SNAPSHOT_CACHE.balance.data);
  const [orders, setOrders] = useState(SNAPSHOT_CACHE.orders.data);
  const [trades, setTrades] = useState(SNAPSHOT_CACHE.trades.data);
  const [pnl, setPnL] = useState(SNAPSHOT_CACHE.pnl.data);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const hasFetchedRef = useRef(false);

  // Fetch all snapshot data
  const fetchAll = useCallback(async (force = false) => {
    if (isSimMode) {
      console.log('[useKrakenSnapshot] Skipping - sim mode');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // Fetch in parallel
      const [balanceData, ordersData] = await Promise.all([
        fetchBalanceSnapshot(force),
        fetchOrdersSnapshot(force)
      ]);
      
      setBalance(balanceData);
      setOrders(ordersData);
      
      // PnL is less critical - fetch separately
      fetchPnLSnapshot(force).then(pnlData => setPnL(pnlData));
      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isSimMode]);

  // Fetch just balance (for quick refresh)
  const refreshBalance = useCallback(async () => {
    if (isSimMode) return null;
    const data = await fetchBalanceSnapshot(true);
    setBalance(data);
    return data;
  }, [isSimMode]);

  // Fetch just orders
  const refreshOrders = useCallback(async () => {
    if (isSimMode) return null;
    const data = await fetchOrdersSnapshot(true);
    setOrders(data);
    return data;
  }, [isSimMode]);

  // Fetch trade history
  const refreshTrades = useCallback(async () => {
    if (isSimMode) return null;
    const data = await fetchTradesSnapshot(true);
    setTrades(data);
    return data;
  }, [isSimMode]);

  // Fetch PnL
  const refreshPnL = useCallback(async () => {
    if (isSimMode) return null;
    const data = await fetchPnLSnapshot(true);
    setPnL(data);
    return data;
  }, [isSimMode]);

  // Initial fetch on mount (if autoFetch enabled)
  useEffect(() => {
    if (autoFetch && !isSimMode && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchAll(false);
    }
  }, [autoFetch, isSimMode, fetchAll]);

  // Listen for events that should trigger a snapshot refresh
  useEffect(() => {
    if (isSimMode) return;
    
    const handleTradeCompleted = () => {
      console.log('[useKrakenSnapshot] Trade completed - refreshing balance');
      // Wait 2 seconds for Kraken to process
      setTimeout(() => refreshBalance(), 2000);
    };
    
    const handleWsReconnected = () => {
      console.log('[useKrakenSnapshot] WebSocket reconnected - re-syncing');
      fetchAll(true);
    };
    
    window.addEventListener('trade:completed', handleTradeCompleted);
    window.addEventListener('kraken:ws-reconnected', handleWsReconnected);
    
    return () => {
      window.removeEventListener('trade:completed', handleTradeCompleted);
      window.removeEventListener('kraken:ws-reconnected', handleWsReconnected);
    };
  }, [isSimMode, refreshBalance, fetchAll]);

  return {
    // Snapshot data
    balance,
    orders,
    trades,
    pnl,
    
    // Loading state
    loading,
    error,
    
    // Refresh functions
    fetchAll,
    refreshBalance,
    refreshOrders,
    refreshTrades,
    refreshPnL,
    
    // Cache timestamps
    balanceTimestamp: SNAPSHOT_CACHE.balance.timestamp,
    ordersTimestamp: SNAPSHOT_CACHE.orders.timestamp,
    tradesTimestamp: SNAPSHOT_CACHE.trades.timestamp,
    pnlTimestamp: SNAPSHOT_CACHE.pnl.timestamp
  };
}

/**
 * Invalidate all snapshot caches
 * Call this after major state changes (e.g., order placed, deposit made)
 */
export function invalidateSnapshotCache() {
  console.log('[useKrakenSnapshot] Invalidating all caches');
  SNAPSHOT_CACHE.balance = { data: null, timestamp: 0 };
  SNAPSHOT_CACHE.orders = { data: null, timestamp: 0 };
  SNAPSHOT_CACHE.trades = { data: null, timestamp: 0 };
  SNAPSHOT_CACHE.pnl = { data: null, timestamp: 0 };
}

/**
 * Get cached balance without triggering fetch
 */
export function getCachedBalance() {
  return SNAPSHOT_CACHE.balance.data;
}

/**
 * Get cached orders without triggering fetch
 */
export function getCachedOrders() {
  return SNAPSHOT_CACHE.orders.data;
}