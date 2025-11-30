import { useState, useEffect, useCallback, useRef } from 'react';
import { useKrakenWebSocketManager } from './useKrakenWebSocketManager';
import { base44 } from '@/api/base44Client';

/**
 * HIGH-LEVEL HOOK: Real-time Kraken Data - PRODUCTION VERSION
 * 
 * CRITICAL: This hook provides LIVE portfolio data from Kraken
 * - Fetches initial data from REST API on mount
 * - Updates in real-time via WebSocket
 * - NEVER shows sim data in live mode
 */

export function useRealtimeKrakenData(options = {}) {
  const {
    subscribeToPrices = true,
    priceSymbols = ['BTC/USD', 'ETH/USD', 'SOL/USD'],
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
    totalAssets: 0,
    totalPortfolioValue: 0,
    lastUpdated: null
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const initialFetchDoneRef = useRef(false);

  const lastUpdateRef = useRef(0);
  const UPDATE_THROTTLE = 1000; // Reduced from 2000ms for faster updates

  // CRITICAL: Fetch initial data from REST API when in LIVE mode
  useEffect(() => {
    if (isSimMode || initialFetchDoneRef.current) {
      setLoading(false);
      return;
    }

    const fetchInitialData = async () => {
      try {
        console.log('[useRealtimeKrakenData] Fetching initial Kraken data...');
        
        const response = await base44.functions.invoke('krakenApi', { action: 'getBalance' });
        const result = response?.data || response;
        
        if (result?.success && result?.balances) {
          const krakenBalances = result.balances;
          
          // Convert to our format
          const formattedBalances = {};
          let usdBal = 0;
          let assetCount = 0;
          
          Object.entries(krakenBalances).forEach(([asset, amount]) => {
            const numAmount = parseFloat(amount) || 0;
            
            // Normalize asset names (ZUSD -> USD, XXBT -> BTC, etc.)
            let normalizedAsset = asset;
            if (asset === 'ZUSD') normalizedAsset = 'USD';
            else if (asset === 'XXBT') normalizedAsset = 'BTC';
            else if (asset === 'XETH') normalizedAsset = 'ETH';
            else if (asset.startsWith('X') || asset.startsWith('Z')) {
              normalizedAsset = asset.substring(1);
            }
            
            formattedBalances[normalizedAsset] = {
              asset: normalizedAsset,
              balance: numAmount,
              available: numAmount,
              timestamp: Date.now()
            };
            
            if (normalizedAsset === 'USD') {
              usdBal = numAmount;
            } else if (numAmount > 0.00001) {
              assetCount++;
            }
          });

          console.log('[useRealtimeKrakenData] Initial balances:', { usdBal, assetCount, assets: Object.keys(formattedBalances) });

          // Calculate portfolio value using market prices
          let portfolioValue = usdBal;
          
          // Fetch prices for assets we have
          const cryptoSymbols = Object.keys(formattedBalances).filter(a => a !== 'USD' && formattedBalances[a].balance > 0.00001);
          
          if (cryptoSymbols.length > 0) {
            try {
              const priceRes = await base44.functions.invoke('getMarketData', {
                action: 'getWatchlistData',
                payload: { cryptoSymbols, stockSymbols: [] }
              });
              
              const prices = priceRes?.data || [];
              
              cryptoSymbols.forEach(asset => {
                const priceData = prices.find(p => (p.symbol || '').toUpperCase() === asset.toUpperCase());
                const price = priceData?.price || priceData?.current_price || 0;
                
                if (price > 0) {
                  portfolioValue += formattedBalances[asset].balance * price;
                }
              });
            } catch (priceErr) {
              console.error('[useRealtimeKrakenData] Price fetch error:', priceErr);
            }
          }

          setData({
            balances: formattedBalances,
            orders: {},
            prices: {},
            usdBalance: usdBal,
            totalAssets: assetCount,
            totalPortfolioValue: portfolioValue,
            lastUpdated: new Date().toISOString()
          });
          
          initialFetchDoneRef.current = true;
          setLoading(false);
          setError(null);
          
          console.log('[useRealtimeKrakenData] ✅ Initial data loaded:', { usdBal, assetCount, portfolioValue });
        }
      } catch (err) {
        console.error('[useRealtimeKrakenData] Initial fetch error:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    fetchInitialData();
  }, [isSimMode]);

  // Process WebSocket data updates
  useEffect(() => {
    if (isSimMode) {
      setLoading(false);
      return;
    }

    // Skip if no WebSocket data yet
    if (!isConnected || Object.keys(wsBalances).length === 0) {
      return;
    }

    const now = Date.now();
    if (now - lastUpdateRef.current < UPDATE_THROTTLE) {
      return;
    }
    lastUpdateRef.current = now;

    try {
      const usdBalance = wsBalances['USD']?.available || wsBalances['ZUSD']?.available || 0;

      const totalAssets = Object.keys(wsBalances).filter(asset => {
        if (asset === 'USD' || asset === 'ZUSD') return false;
        const balance = wsBalances[asset]?.balance || 0;
        return balance > 0.00001;
      }).length;

      let totalPortfolioValue = usdBalance;

      Object.entries(wsBalances).forEach(([asset, balance]) => {
        if (asset === 'USD' || asset === 'ZUSD') {
          return;
        }

        const pairWithUSD = `${asset}/USD`;
        const price = wsPrices[pairWithUSD]?.price || 0;

        if (price > 0) {
          totalPortfolioValue += balance.balance * price;
        }
      });

      setData(prev => ({
        balances: wsBalances,
        orders: wsOrders,
        prices: wsPrices,
        usdBalance,
        totalAssets,
        totalPortfolioValue: totalPortfolioValue > 0 ? totalPortfolioValue : prev.totalPortfolioValue,
        lastUpdated: new Date().toISOString()
      }));

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

  const refresh = useCallback(async () => {
    if (isSimMode) return;

    // Try WebSocket data first
    const currentBalances = getAllBalances();
    const currentOrders = getAllOrders();
    const currentPrices = getAllPrices();

    if (Object.keys(currentBalances).length > 0) {
      setData({
        balances: currentBalances,
        orders: currentOrders,
        prices: currentPrices,
        usdBalance: currentBalances['USD']?.available || currentBalances['ZUSD']?.available || 0,
        totalAssets: Object.keys(currentBalances).filter(k => 
          k !== 'USD' && k !== 'ZUSD' && (currentBalances[k]?.balance || 0) > 0.00001
        ).length,
        totalPortfolioValue: calculatePortfolioValue(currentBalances, currentPrices),
        lastUpdated: new Date().toISOString()
      });
      return;
    }

    // Fallback: Fetch from REST API
    try {
      const response = await base44.functions.invoke('krakenApi', { action: 'getBalance' });
      const result = response?.data || response;
      
      if (result?.success && result?.balances) {
        const krakenBalances = result.balances;
        const formattedBalances = {};
        let usdBal = 0;
        let assetCount = 0;
        
        Object.entries(krakenBalances).forEach(([asset, amount]) => {
          const numAmount = parseFloat(amount) || 0;
          let normalizedAsset = asset;
          if (asset === 'ZUSD') normalizedAsset = 'USD';
          else if (asset === 'XXBT') normalizedAsset = 'BTC';
          else if (asset === 'XETH') normalizedAsset = 'ETH';
          else if (asset.startsWith('X') || asset.startsWith('Z')) {
            normalizedAsset = asset.substring(1);
          }
          
          formattedBalances[normalizedAsset] = {
            asset: normalizedAsset,
            balance: numAmount,
            available: numAmount,
            timestamp: Date.now()
          };
          
          if (normalizedAsset === 'USD') {
            usdBal = numAmount;
          } else if (numAmount > 0.00001) {
            assetCount++;
          }
        });

        // Calculate portfolio value
        let portfolioValue = usdBal;
        const cryptoSymbols = Object.keys(formattedBalances).filter(a => a !== 'USD' && formattedBalances[a].balance > 0.00001);
        
        if (cryptoSymbols.length > 0) {
          try {
            const priceRes = await base44.functions.invoke('getMarketData', {
              action: 'getWatchlistData',
              payload: { cryptoSymbols, stockSymbols: [] }
            });
            
            const prices = priceRes?.data || [];
            cryptoSymbols.forEach(asset => {
              const priceData = prices.find(p => (p.symbol || '').toUpperCase() === asset.toUpperCase());
              const price = priceData?.price || 0;
              if (price > 0) {
                portfolioValue += formattedBalances[asset].balance * price;
              }
            });
          } catch (e) {
            console.error('[useRealtimeKrakenData] Refresh price error:', e);
          }
        }

        setData({
          balances: formattedBalances,
          orders: {},
          prices: {},
          usdBalance: usdBal,
          totalAssets: assetCount,
          totalPortfolioValue: portfolioValue,
          lastUpdated: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error('[useRealtimeKrakenData] Refresh error:', err);
    }
  }, [isSimMode, getAllBalances, getAllOrders, getAllPrices]);

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