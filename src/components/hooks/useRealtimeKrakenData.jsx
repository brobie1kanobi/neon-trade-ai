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

  const [subscribedPrices, setSubscribedPrices] = useState(new Set(priceSymbols));

  const {
    isConnected,
    prices: wsPrices,
    balances: wsBalances,
    orders: wsOrders,
    lastExecution,
    getAllBalances,
    getAllOrders,
    getAllPrices,
    subscribeToPrices: wsPriceSubscribe
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

  // CRITICAL: Never block loading - start with false if sim mode or has cached data
  const [loading, setLoading] = useState(() => {
    if (isSimMode) return false;
    if (persistedData.current) return false;
    return true;
  });
  const [error, setError] = useState(null);

  // CRITICAL: Dynamically subscribe to prices for ALL assets in balance
  useEffect(() => {
    if (isSimMode || !isConnected || !subscribeToPrices) return;
    if (!wsBalances || Object.keys(wsBalances).length === 0) return;

    const assetsInBalance = Object.keys(wsBalances).filter(asset => {
      if (asset === 'USD' || asset === 'ZUSD') return false;
      const balance = wsBalances[asset]?.balance || 0;
      return balance > 0.00001;
    });

    const newPairs = assetsInBalance.map(asset => `${asset}/USD`);
    const unsubscribedPairs = newPairs.filter(pair => !subscribedPrices.has(pair));

    if (unsubscribedPairs.length > 0) {
      console.log('[useRealtimeKrakenData] 📡 Subscribing to prices for NEW assets:', unsubscribedPairs);
      wsPriceSubscribe(unsubscribedPairs);
      setSubscribedPrices(prev => new Set([...prev, ...unsubscribedPairs]));
    }
  }, [isSimMode, isConnected, subscribeToPrices, wsBalances, wsPriceSubscribe, subscribedPrices]);

  // CRITICAL: Update immediately when WebSocket data changes
  useEffect(() => {
    if (isSimMode) {
      setLoading(false);
      return;
    }

    // CRITICAL: Set loading false even if not connected yet (use cached data)
    if (!isConnected) {
      // Keep showing cached data while reconnecting, but don't block UI
      if (persistedData.current) {
        setLoading(false);
      }
      return;
    }

    try {
      // CRITICAL FIX: Try all possible USD keys
      const usdBalance = wsBalances['USD']?.available 
        || wsBalances['ZUSD']?.available 
        || wsBalances['USD']?.balance
        || wsBalances['ZUSD']?.balance
        || 0;

      console.log('[useRealtimeKrakenData] 💰 USD Balance:', usdBalance.toFixed(2));
      console.log('[useRealtimeKrakenData] 📊 All balances:', Object.keys(wsBalances));

      const totalAssets = Object.keys(wsBalances).filter(asset => {
        if (asset === 'USD' || asset === 'ZUSD') return false;
        const balance = wsBalances[asset]?.balance || 0;
        return balance > 0.00001;
      }).length;

      let totalPortfolioValue = usdBalance;
      let cryptoValue = 0;

      Object.entries(wsBalances).forEach(([asset, balance]) => {
        if (asset === 'USD' || asset === 'ZUSD') return;

        const pairWithUSD = `${asset}/USD`;
        const price = wsPrices[pairWithUSD]?.price || 0;
        const assetBalance = balance.balance || 0;

        if (price > 0 && assetBalance > 0) {
          const value = assetBalance * price;
          cryptoValue += value;
          totalPortfolioValue += value;
          console.log(`[useRealtimeKrakenData] ${asset}: ${assetBalance.toFixed(4)} × $${price.toFixed(2)} = $${value.toFixed(2)}`);
        }
      });

      console.log('[useRealtimeKrakenData] 📈 Total Portfolio:', totalPortfolioValue.toFixed(2), '(Cash:', usdBalance.toFixed(2), '+ Crypto:', cryptoValue.toFixed(2), ')');

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
      console.error('[useRealtimeKrakenData] Error:', err);
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