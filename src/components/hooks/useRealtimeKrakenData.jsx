import { useState, useEffect, useCallback } from 'react';
import { useKrakenWebSocketManager } from './useKrakenWebSocketManager';

/**
 * HIGH-LEVEL HOOK: Real-time Kraken Data - PRODUCTION VERSION
 * 
 * NO LOGS - Performance optimized
 * NO THROTTLING - Immediate balance updates
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

  const [data, setData] = useState(() => {
    // Initialize with current WebSocket data if available to prevent flash of zeros
    const usdBalance = wsBalances['USD']?.available || wsBalances['ZUSD']?.available || 0;
    const cryptoHoldingsValue = calculateCryptoValue(wsBalances, wsPrices);
    const totalAssets = Object.keys(wsBalances).filter(asset => {
      if (asset === 'USD' || asset === 'ZUSD') return false;
      const balanceObj = wsBalances[asset];
      const totalBalance = balanceObj?.balance || balanceObj?.available || 0;
      return totalBalance > 0.00001;
    }).length;
    const totalPortfolioValue = usdBalance + cryptoHoldingsValue;

    return {
      balances: wsBalances,
      orders: wsOrders,
      prices: wsPrices,
      usdBalance,
      cryptoHoldingsValue,
      totalAssets,
      totalPortfolioValue,
      lastUpdated: new Date().toISOString()
    };
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Process WebSocket data - NO THROTTLING for immediate updates
  useEffect(() => {
    if (isSimMode) {
      setLoading(false);
      return;
    }

    if (!isConnected) {
      return;
    }

    // CRITICAL: Always process and update, even if balances appear empty
    // This ensures we show "0 assets" correctly when there genuinely are no balances
    // The previous check prevented initial load from working properly

    try {
      // CRITICAL: USD balance is the cash wallet
      const usdBalance = wsBalances['USD']?.available || wsBalances['ZUSD']?.available || 0;

      // CRITICAL: Count TOTAL assets (including those locked in orders)
      // Use balance.balance (total) not just available
      const totalAssets = Object.keys(wsBalances).filter(asset => {
        if (asset === 'USD' || asset === 'ZUSD') return false;
        const balanceObj = wsBalances[asset];
        const totalBalance = balanceObj?.balance || balanceObj?.available || 0;
        return totalBalance > 0.00001;
      }).length;
      
      console.log('[useRealtimeKrakenData] Total assets calculation:', {
        totalAssets,
        allAssets: Object.keys(wsBalances),
        cryptoAssets: Object.keys(wsBalances).filter(k => k !== 'USD' && k !== 'ZUSD'),
        balancesWithValue: Object.entries(wsBalances)
          .filter(([k, v]) => k !== 'USD' && k !== 'ZUSD' && ((v?.balance || v?.available || 0) > 0.00001))
          .map(([k, v]) => ({ asset: k, balance: v?.balance, available: v?.available }))
      });

      // CRITICAL: cryptoHoldingsValue is ONLY crypto assets (NOT including USD)
      // CRITICAL: Use balance.balance which is the TOTAL (including locked in orders)
      // The WebSocket manager sets balance.balance = totalBalance from Kraken
      let cryptoHoldingsValue = 0;

      Object.entries(wsBalances).forEach(([asset, balanceObj]) => {
        if (asset === 'USD' || asset === 'ZUSD') {
          return; // Skip USD - it's cash wallet, not portfolio
        }

        const pairWithUSD = `${asset}/USD`;
        const price = wsPrices[pairWithUSD]?.price || 0;
        
        // Use the total balance (balance.balance includes locked amounts)
        const quantity = balanceObj?.balance || 0;

        if (price > 0 && quantity > 0.00001) {
          cryptoHoldingsValue += quantity * price;
        }
      });

      // totalPortfolioValue = cash + crypto for total balance display
      const totalPortfolioValue = usdBalance + cryptoHoldingsValue;

      // CRITICAL: ALWAYS update state when WebSocket is connected and has data
      // This fixes the issue where "0 assets" wasn't showing until manual refresh
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
// CRITICAL: Use balance.balance which is the TOTAL (including locked in orders)
function calculateCryptoValue(balances, prices) {
  let total = 0;

  Object.entries(balances).forEach(([asset, balanceObj]) => {
    if (asset === 'USD' || asset === 'ZUSD') {
      return; // Skip USD - that's cash wallet
    }
    const pairWithUSD = `${asset}/USD`;
    const price = prices[pairWithUSD]?.price || 0;
    const quantity = balanceObj?.balance || 0;
    
    if (price > 0 && quantity > 0.00001) {
      total += quantity * price;
    }
  });

  return total;
}