import { useState, useEffect, useCallback, useRef } from 'react';
import { useKrakenWebSocketManager } from './useKrakenWebSocketManager';

/**
 * HIGH-LEVEL HOOK: Real-time Kraken Data - PRODUCTION VERSION
 * 
 * NO LOGS - Performance optimized
 */

export function useRealtimeKrakenData(options = {}) {
  const {
    subscribeToPrices = true,
    priceSymbols = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD', 'DOT/USD', 'DOGE/USD', 'LTC/USD', 'BCH/USD', 'LINK/USD', 'UNI/USD', 'MATIC/USD', 'ATOM/USD', 'TRX/USD', 'AVAX/USD'],
    subscribeToBalances = true,
    subscribeToOrders = true,
    subscribeToExecutions = true,
    isSimMode = false
  } = options;

  // WebSocket connection
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
    cryptoHoldingsValue: 0,
    totalAssets: 0,
    totalPortfolioValue: 0,
    lastUpdated: null
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const lastUpdateRef = useRef(0);
  const UPDATE_THROTTLE = 2000;

  // Process WebSocket data
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
      // CRITICAL: USD balance is the cash wallet
      const usdBalance = wsBalances['USD']?.available || wsBalances['ZUSD']?.available || 0;

      const totalAssets = Object.keys(wsBalances).filter(asset => {
        if (asset === 'USD' || asset === 'ZUSD') return false;
        const balance = wsBalances[asset]?.balance || 0;
        return balance > 0.00001;
      }).length;

      // CRITICAL: cryptoHoldingsValue is ONLY crypto assets (NOT including USD)
      let cryptoHoldingsValue = 0;

      Object.entries(wsBalances).forEach(([asset, balance]) => {
        if (asset === 'USD' || asset === 'ZUSD') {
          return; // Skip USD - it's cash wallet, not portfolio
        }

        const pairWithUSD = `${asset}/USD`;
        const price = wsPrices[pairWithUSD]?.price || 0;

        if (price > 0) {
          cryptoHoldingsValue += balance.balance * price;
        }
      });

      // totalPortfolioValue = cash + crypto for total balance display
      const totalPortfolioValue = usdBalance + cryptoHoldingsValue;

      setData({
        balances: wsBalances,
        orders: wsOrders,
        prices: wsPrices,
        usdBalance,              // Cash Wallet
        cryptoHoldingsValue,     // Portfolio (crypto only)
        totalAssets,
        totalPortfolioValue,     // Total Balance (cash + crypto)
        lastUpdated: new Date().toISOString()
      });

      setLoading(false);
      setError(null);

    } catch (err) {
      setError(err.message);
    }
  }, [isSimMode, isConnected, wsBalances, wsOrders, wsPrices]);

  // Handle new executions
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

    const usdBalance = currentBalances['USD']?.available || currentBalances['ZUSD']?.available || 0;
    const cryptoHoldingsValue = calculateCryptoValue(currentBalances, currentPrices);

    setData({
      balances: currentBalances,
      orders: currentOrders,
      prices: currentPrices,
      usdBalance,
      cryptoHoldingsValue,
      totalAssets: Object.keys(currentBalances).filter(k => 
        k !== 'USD' && k !== 'ZUSD' && (currentBalances[k]?.balance || 0) > 0.00001
      ).length,
      totalPortfolioValue: usdBalance + cryptoHoldingsValue,
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
    cryptoHoldingsValue: data.cryptoHoldingsValue,
    totalAssets: data.totalAssets,
    totalPortfolioValue: data.totalPortfolioValue,
    lastUpdated: data.lastUpdated,
    refresh
  };
}

// Calculate only crypto holdings value (excludes USD cash)
function calculateCryptoValue(balances, prices) {
  let total = 0;

  Object.entries(balances).forEach(([asset, balance]) => {
    if (asset === 'USD' || asset === 'ZUSD') {
      return; // Skip USD - that's cash wallet
    }
    const pairWithUSD = `${asset}/USD`;
    const price = prices[pairWithUSD]?.price || 0;
    if (price > 0) {
      total += balance.balance * price;
    }
  });

  return total;
}