import { useState, useEffect, useCallback, useRef } from 'react';
import { useKrakenWebSocketManager } from './useKrakenWebSocketManager';

/**
 * PRODUCTION VERSION: Instant display with localStorage persistence
 * NO throttling on display updates - show immediately
 */

// CRITICAL: Global localStorage persistence
const PERSISTENT_CACHE_KEY = 'kraken_balance_cache';

function loadPersistedData() {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(PERSISTENT_CACHE_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    const age = Date.now() - (parsed.timestamp || 0);
    // Allow stale data up to 24 hours for immediate display
    if (age < 24 * 60 * 60 * 1000) {
      console.log('[useRealtimeKrakenData] ✅ Loaded persisted data, age:', (age / 1000).toFixed(0), 's');
      return parsed.data;
    }
  } catch (e) {
    console.warn('[useRealtimeKrakenData] Failed to load persisted data:', e);
  }
  return null;
}

function persistData(data) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PERSISTENT_CACHE_KEY, JSON.stringify({
      data,
      timestamp: Date.now()
    }));
  } catch (e) {
    console.warn('[useRealtimeKrakenData] Failed to persist data:', e);
  }
}

export function useRealtimeKrakenData(options = {}) {
  const {
    subscribeToPrices = true,
    priceSymbols = ['BTC/USD', 'ETH/USD', 'SOL/USD'],
    subscribeToBalances = true,
    subscribeToOrders = true,
    subscribeToExecutions = true,
    isSimMode = false
  } = options;

  const {
    isConnected,
    prices: wsPrices,
    balances: wsBalances,
    orders: wsOrders,
    lastExecution,
    getAllBalances,
    getAllOrders,
    getAllPrices
  } = useKrakenWebSocketManager({
    subscribeToPrices: subscribeToPrices && !isSimMode,
    priceSymbols,
    subscribeToBalances: subscribeToBalances && !isSimMode,
    subscribeToOrders: subscribeToOrders && !isSimMode,
    subscribeToExecutions: subscribeToExecutions && !isSimMode
  });

  // CRITICAL: Initialize with persisted data immediately
  const persistedData = useRef(loadPersistedData());
  
  const [data, setData] = useState(() => {
    if (persistedData.current) {
      console.log('[useRealtimeKrakenData] 🚀 IMMEDIATE DISPLAY from cache');
      return persistedData.current;
    }
    return {
      balances: {},
      orders: {},
      prices: {},
      usdBalance: 0,
      totalAssets: 0,
      totalPortfolioValue: 0,
      lastUpdated: null
    };
  });

  const [loading, setLoading] = useState(!persistedData.current);
  const [error, setError] = useState(null);

  // CRITICAL: NO throttling - update immediately on every change
  useEffect(() => {
    if (isSimMode) {
      setLoading(false);
      return;
    }

    if (!isConnected) {
      // Keep showing cached data while reconnecting
      return;
    }

    try {
      // CRITICAL FIX: Calculate usdBalance from wsBalances
      const usdBalance = wsBalances['USD']?.available || wsBalances['ZUSD']?.available || 0;

      const totalAssets = Object.keys(wsBalances).filter(asset => {
        if (asset === 'USD' || asset === 'ZUSD') return false;
        const balance = wsBalances[asset]?.balance || 0;
        return balance > 0.00001;
      }).length;

      let totalPortfolioValue = usdBalance;

      Object.entries(wsBalances).forEach(([asset, balance]) => {
        if (asset === 'USD' || asset === 'ZUSD') return;

        const pairWithUSD = `${asset}/USD`;
        const price = wsPrices[pairWithUSD]?.price || 0;

        if (price > 0) {
          totalPortfolioValue += balance.balance * price;
        }
      });

      const newData = {
        balances: wsBalances,
        orders: wsOrders,
        prices: wsPrices,
        usdBalance,
        totalAssets,
        totalPortfolioValue,
        lastUpdated: new Date().toISOString()
      };

      setData(newData);
      setLoading(false);
      setError(null);

      // CRITICAL: Persist immediately for next page load
      persistData(newData);

    } catch (err) {
      setError(err.message);
    }
  }, [isSimMode, isConnected, wsBalances, wsOrders, wsPrices]);

  // Handle executions
  useEffect(() => {
    if (lastExecution) {
      window.dispatchEvent(new CustomEvent('kraken:trade-executed', {
        detail: lastExecution
      }));

      window.dispatchEvent(new CustomEvent('app:data-updated', {
        detail: { 
          type: 'trade-execution', 
          source: 'kraken-ws',
          data: lastExecution 
        }
      }));
    }
  }, [lastExecution]);

  const refresh = useCallback(() => {
    const currentBalances = getAllBalances();
    const currentOrders = getAllOrders();
    const currentPrices = getAllPrices();

    const newData = {
      balances: currentBalances,
      orders: currentOrders,
      prices: currentPrices,
      usdBalance: currentBalances['USD']?.available || 0,
      totalAssets: Object.keys(currentBalances).filter(k => 
        k !== 'USD' && k !== 'ZUSD' && (currentBalances[k]?.balance || 0) > 0.00001
      ).length,
      totalPortfolioValue: calculatePortfolioValue(currentBalances, currentPrices),
      lastUpdated: new Date().toISOString()
    };

    setData(newData);
    persistData(newData);
  }, [getAllBalances, getAllOrders, getAllPrices]);

  return {
    isConnected: !isSimMode && isConnected,
    loading,
    error,
    data,
    balances: data.balances,
    orders: data.orders,
    prices: data.prices,
    usdBalance: data.usdBalance,
    totalAssets: data.totalAssets,
    totalPortfolioValue: data.totalPortfolioValue,
    lastUpdated: data.lastUpdated,
    refresh
  };
}

function calculatePortfolioValue(balances, prices) {
  let total = 0;

  Object.entries(balances).forEach(([asset, balance]) => {
    if (asset === 'USD' || asset === 'ZUSD') {
      total += balance.available || 0;
    } else {
      const pairWithUSD = `${asset}/USD`;
      const price = prices[pairWithUSD]?.price || 0;
      if (price > 0) {
        total += balance.balance * price;
      }
    }
  });

  return total;
}

// Export function to clear persisted cache
export function clearKrakenPersistedCache() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(PERSISTENT_CACHE_KEY);
  }
}