import { useState, useEffect, useCallback, useRef } from 'react';
import { useKrakenWebSocketManager } from './useKrakenWebSocketManager';

/**
 * HIGH-LEVEL HOOK: Real-time Kraken Data - PRODUCTION VERSION
 * FIXED: Proper Kraken asset name parsing (XXRP -> XRP)
 */

// CRITICAL: Parse Kraken asset names to standard symbols
function parseKrakenAsset(krakenCode) {
  if (!krakenCode || typeof krakenCode !== 'string') return krakenCode;
  
  let symbol = krakenCode;
  
  // Remove Kraken prefixes (but NOT for XRP itself)
  if (krakenCode.startsWith('X') && krakenCode.length > 3 && krakenCode !== 'XRP') {
    symbol = krakenCode.substring(1);
  }
  if (krakenCode.startsWith('Z') && krakenCode.length > 3) {
    symbol = krakenCode.substring(1);
  }
  
  // Map special cases
  const symbolMap = {
    'XXRP': 'XRP',
    'XBT': 'BTC',
    'XXBT': 'BTC',
    'XETH': 'ETH',
    'XXDG': 'DOGE',
    'ZUSD': 'USD',
    'ZEUR': 'EUR'
  };
  
  return symbolMap[krakenCode] || symbol;
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

  const [data, setData] = useState({
    balances: {},
    orders: {},
    prices: {},
    usdBalance: 0,
    totalAssets: 0,
    totalPortfolioValue: 0,
    lastUpdated: null
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const lastUpdateRef = useRef(0);
  const UPDATE_THROTTLE = 3000;

  // Process WebSocket data with throttling
  useEffect(() => {
    if (isSimMode) {
      setLoading(false);
      return;
    }

    if (!isConnected) {
      return;
    }

    const now = Date.now();
    if (now - lastUpdateRef.current < UPDATE_THROTTLE) {
      return;
    }
    lastUpdateRef.current = now;

    try {
      // CRITICAL: Parse USD balance with proper key handling
      const rawUsdBalance = wsBalances['USD']?.available || wsBalances['ZUSD']?.available || 0;
      const usdBalance = typeof rawUsdBalance === 'number' ? rawUsdBalance : parseFloat(rawUsdBalance || 0);

      // CRITICAL: Normalize balance keys (XXRP -> XRP)
      const normalizedBalances = {};
      Object.entries(wsBalances).forEach(([key, value]) => {
        const normalizedKey = parseKrakenAsset(key);
        normalizedBalances[normalizedKey] = value;
      });

      // Count non-USD assets
      const totalAssets = Object.keys(normalizedBalances).filter(asset => {
        if (asset === 'USD' || asset === 'EUR') return false;
        const balance = normalizedBalances[asset]?.balance || 0;
        return balance > 0.00001;
      }).length;

      let totalPortfolioValue = usdBalance;

      // Calculate portfolio value with normalized symbols
      Object.entries(normalizedBalances).forEach(([asset, balance]) => {
        if (asset === 'USD' || asset === 'EUR') {
          return;
        }

        const pairWithUSD = `${asset}/USD`;
        const price = wsPrices[pairWithUSD]?.price || 0;

        if (price > 0 && balance?.balance) {
          totalPortfolioValue += balance.balance * price;
        }
      });

      setData({
        balances: normalizedBalances,
        orders: wsOrders,
        prices: wsPrices,
        usdBalance,
        totalAssets,
        totalPortfolioValue,
        lastUpdated: new Date().toISOString()
      });

      setLoading(false);
      setError(null);

    } catch (err) {
      console.error('[useRealtimeKrakenData] Error:', err);
      setError(err.message);
    }
  }, [isSimMode, isConnected, wsBalances, wsOrders, wsPrices]);

  // Handle new executions with debouncing
  const executionTimeoutRef = useRef(null);
  useEffect(() => {
    if (lastExecution) {
      if (executionTimeoutRef.current) {
        clearTimeout(executionTimeoutRef.current);
      }

      executionTimeoutRef.current = setTimeout(() => {
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
      }, 1000);
    }

    return () => {
      if (executionTimeoutRef.current) {
        clearTimeout(executionTimeoutRef.current);
      }
    };
  }, [lastExecution]);

  const refresh = useCallback(() => {
    const currentBalances = getAllBalances();
    const currentOrders = getAllOrders();
    const currentPrices = getAllPrices();

    // Normalize balances
    const normalizedBalances = {};
    Object.entries(currentBalances).forEach(([key, value]) => {
      const normalizedKey = parseKrakenAsset(key);
      normalizedBalances[normalizedKey] = value;
    });

    const usdBal = normalizedBalances['USD']?.available || 0;

    setData({
      balances: normalizedBalances,
      orders: currentOrders,
      prices: currentPrices,
      usdBalance: usdBal,
      totalAssets: Object.keys(normalizedBalances).filter(k => 
        k !== 'USD' && k !== 'EUR' && (normalizedBalances[k]?.balance || 0) > 0.00001
      ).length,
      totalPortfolioValue: calculatePortfolioValue(normalizedBalances, currentPrices),
      lastUpdated: new Date().toISOString()
    });
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
    if (asset === 'USD' || asset === 'EUR') {
      total += balance.available || 0;
    } else {
      const pairWithUSD = `${asset}/USD`;
      const price = prices[pairWithUSD]?.price || 0;
      if (price > 0 && balance?.balance) {
        total += balance.balance * price;
      }
    }
  });

  return total;
}