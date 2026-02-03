import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useKrakenWebSocketManager } from '@/components/hooks/useKrakenWebSocketManager';
import { useSettings } from '@/components/utils/SettingsContext';
import { base44 } from '@/api/base44Client';

const KrakenWebSocketContext = createContext(null);

export const useKrakenWebSocket = () => {
  const context = useContext(KrakenWebSocketContext);
  if (!context) {
    throw new Error('useKrakenWebSocket must be used within KrakenWebSocketProvider');
  }
  return context;
};

/**
 * Global WebSocket Provider - SINGLE SOURCE OF TRUTH for ALL Kraken data
 * This ensures WebSocket stays active across all pages and components
 * CRITICAL: All Kraken API calls should go through this provider to prevent rate limits
 */
export function KrakenWebSocketProvider({ children }) {
  const { settings, user } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  // Only connect in LIVE mode with authenticated user
  const shouldConnect = !isSimMode && !!user?.email; // live mode only

  // Initialize WebSocket manager with ALL subscriptions
  const wsManager = useKrakenWebSocketManager({
    subscribeToPrices: shouldConnect,
    priceSymbols: settings?.watched_crypto || [],
    subscribeToBalances: shouldConnect,
    subscribeToOrders: false,
    subscribeToExecutions: shouldConnect
  });

  // CRITICAL: Global rate limiter - prevents ALL Kraken REST API calls from exceeding limits
  const lastRestCallRef = useRef(0);
  const restCallQueueRef = useRef([]);
  const isProcessingQueueRef = useRef(false);
  const MIN_REST_INTERVAL = 10000; // Minimum 10 seconds between REST API calls (increased from 5s)

  const [state, setState] = useState({
    isConnected: false,
    prices: {},
    balances: {},
    orders: {},
    executions: [],
    usdBalance: 0,
    cryptoHoldingsValue: 0,
    totalPortfolioValue: 0,
    totalAssets: 0
  });

  // CRITICAL: Centralized REST API data - fetched once and shared across all components
  const [restData, setRestData] = useState({
    krakenBalance: null,
    krakenPnL: null,
    krakenOrders: [],
    krakenTrades: [],
    lastFetchTime: 0,
    isLoading: false,
    error: null
  });

  // Update state when WebSocket data changes
  // CRITICAL: Reduced frequency from 2s to 5s to prevent excessive updates
  useEffect(() => {
    if (!shouldConnect) return;

    const updateState = () => {
      try {
        const isConnected = !!wsManager.isConnected;
        const prices = wsManager.getAllPrices?.() || {};
        const balances = wsManager.getAllBalances?.() || {};
        const orders = wsManager.getAllOrders?.() || {};
        const executions = wsManager.lastExecution ? [wsManager.lastExecution] : [];

        // Calculate portfolio metrics
        let usdBalance = 0;
        let cryptoHoldingsValue = 0;
        let totalAssets = 0;

        if (balances && Object.keys(balances).length > 0) {
          // USD balance - WebSocket only returns available, not locked
          usdBalance = balances['USD']?.available || balances['ZUSD']?.available || 0;
          
          // Calculate crypto holdings value
          // NOTE: WebSocket balance.balance is AVAILABLE only (NOT including locked in orders)
          // This will be LESS than REST API total when assets are in pending sell orders
          Object.entries(balances).forEach(([asset, balance]) => {
            if (asset === 'USD' || asset === 'ZUSD') return;
            
            // Use available balance from WebSocket
            const quantity = balance.available || balance.balance || 0;
            if (quantity <= 0.00001) return;
            
            const pair = `${asset}/USD`;
            const priceInfo = prices[pair];
            const price = priceInfo?.price || 0;
            
            cryptoHoldingsValue += quantity * price;
            totalAssets++;
          });
        }

        const totalPortfolioValue = usdBalance + cryptoHoldingsValue;

        setState({
          isConnected,
          prices,
          balances,
          orders,
          executions,
          usdBalance,
          cryptoHoldingsValue,
          totalPortfolioValue,
          totalAssets
        });
      } catch (err) {
        console.error('[KrakenWebSocketProvider] State update error:', err);
      }
    };

    // Update immediately
    updateState();

    // CRITICAL: Reduced from 2s to 5s to prevent excessive state updates and re-renders
    const interval = setInterval(updateState, 5000);

    return () => clearInterval(interval);
  }, [shouldConnect]); // CRITICAL: Removed wsManager from deps to prevent infinite loop

  // Provide refresh function - CRITICAL: Force immediate state update after refresh
  const refresh = async () => {
    console.log('[KrakenWebSocketProvider] Manual refresh requested');
    try {
      await wsManager.refreshBalances?.();
      await wsManager.refreshOrders?.();
      
      // CRITICAL: Force immediate state update after refresh
      const isConnected = !!wsManager.isConnected;
      const prices = wsManager.getAllPrices?.() || {};
      const balances = wsManager.getAllBalances?.() || {};
      const orders = wsManager.getAllOrders?.() || {};
      const executions = wsManager.lastExecution ? [wsManager.lastExecution] : [];

      // Recalculate portfolio metrics
      let usdBalance = 0;
      let cryptoHoldingsValue = 0;
      let totalAssets = 0;

      if (balances && Object.keys(balances).length > 0) {
        usdBalance = balances['USD']?.available || balances['ZUSD']?.available || 0;
        
        Object.entries(balances).forEach(([asset, balance]) => {
          if (asset === 'USD' || asset === 'ZUSD') return;
          
          const quantity = balance.balance || 0;
          if (quantity <= 0.00001) return;
          
          const pair = `${asset}/USD`;
          const priceInfo = prices[pair];
          const price = priceInfo?.price || 0;
          
          cryptoHoldingsValue += quantity * price;
          totalAssets++;
        });
      }

      const totalPortfolioValue = usdBalance + cryptoHoldingsValue;

      setState({
        isConnected,
        prices,
        balances,
        orders,
        executions,
        usdBalance,
        cryptoHoldingsValue,
        totalPortfolioValue,
        totalAssets
      });
      
      console.log('[KrakenWebSocketProvider] Refresh complete - USD:', usdBalance.toFixed(2), 'Crypto:', cryptoHoldingsValue.toFixed(2));
    } catch (err) {
      console.error('[KrakenWebSocketProvider] Refresh error:', err);
    }
  };

  // CRITICAL: Listen for trade completion events and auto-refresh
  useEffect(() => {
    const handleTradeCompleted = () => {
      console.log('[KrakenWebSocketProvider] Trade completed event received');
      // Small delay to allow Kraken to process the trade
      setTimeout(() => {
        refresh();
      }, 1500);
    };

    window.addEventListener('trade:completed', handleTradeCompleted);
    window.addEventListener('kraken:synced', handleTradeCompleted);
    
    return () => {
      window.removeEventListener('trade:completed', handleTradeCompleted);
      window.removeEventListener('kraken:synced', handleTradeCompleted);
    };
  }, []); // Empty deps - refresh is stable

  // CRITICAL: Centralized REST API fetcher - ALL components should use this instead of direct calls
  const fetchRestData = useCallback(async (force = false) => {
    if (isSimMode) return null;
    
    const now = Date.now();
    
    // Use ref to check timing without triggering re-renders
    const timeSinceLastFetch = now - lastRestCallRef.current;
    
    // CRITICAL: Enforce minimum interval between REST calls to prevent rate limits
    if (!force && timeSinceLastFetch < MIN_REST_INTERVAL) {
      console.log('[KrakenWebSocketProvider] Skipping REST fetch - too soon (', Math.round(timeSinceLastFetch / 1000), 's ago)');
      return null;
    }
    
    // Check if already loading using functional update pattern
    let shouldSkip = false;
    setRestData(prev => {
      if (prev.isLoading) {
        shouldSkip = true;
        return prev;
      }
      return { ...prev, isLoading: true, error: null };
    });
    
    if (shouldSkip) {
      console.log('[KrakenWebSocketProvider] REST fetch already in progress, skipping');
      return null;
    }
    
    console.log('[KrakenWebSocketProvider] Fetching centralized REST data...');
    lastRestCallRef.current = now;
    
    try {
      // Fetch balance and orders in parallel (but NOT PnL - too expensive)
      const [balanceRes, ordersRes] = await Promise.all([
        base44.functions.invoke('getKrakenBalance', {}).catch(e => ({ error: e.message })),
        base44.functions.invoke('krakenApi', { action: 'getOpenOrders' }).catch(e => ({ error: e.message }))
      ]);
      
      const balanceData = balanceRes?.data || balanceRes;
      const ordersData = ordersRes?.data || ordersRes;
      
      setRestData(prev => ({
        krakenBalance: balanceData?.success ? balanceData : null,
        krakenOrders: ordersData?.orders || [],
        krakenTrades: prev.krakenTrades, // Keep existing trades
        krakenPnL: prev.krakenPnL, // Keep existing PnL
        lastFetchTime: Date.now(),
        isLoading: false,
        error: balanceData?.error || ordersData?.error || null
      }));
      
      console.log('[KrakenWebSocketProvider] REST data updated - Balance:', !!balanceData?.success, 'Orders:', (ordersData?.orders || []).length);
      
      return { krakenBalance: balanceData, krakenOrders: ordersData?.orders || [] };
    } catch (err) {
      console.error('[KrakenWebSocketProvider] REST fetch error:', err);
      setRestData(prev => ({ ...prev, isLoading: false, error: err.message }));
      return null;
    }
  }, [isSimMode]);

  // CRITICAL: Fetch PnL separately and less frequently (every 60s)
  const fetchPnL = useCallback(async () => {
    if (isSimMode) return;
    
    try {
      const response = await base44.functions.invoke('getKrakenPnL', {});
      const data = response?.data || response;
      
      if (data?.success) {
        setRestData(prev => ({
          ...prev,
          krakenPnL: data
        }));
        console.log('[KrakenWebSocketProvider] PnL updated:', data.pnl_lifetime?.toFixed(2));
      }
    } catch (err) {
      console.error('[KrakenWebSocketProvider] PnL fetch error:', err);
    }
  }, [isSimMode]);

  // CRITICAL: Initial fetch on mount (only once)
  useEffect(() => {
    if (shouldConnect && restData.lastFetchTime === 0) {
      console.log('[KrakenWebSocketProvider] Initial REST data fetch');
      fetchRestData(true);
      // Fetch PnL after a delay to spread out API calls
      setTimeout(() => fetchPnL(), 3000);
    }
  }, [shouldConnect]); // eslint-disable-line react-hooks/exhaustive-deps

  // CRITICAL: Periodic refresh - every 60 seconds for balance, 2 minutes for PnL
  // Reduced frequency to prevent rate limits - WebSocket provides real-time updates anyway
  useEffect(() => {
    if (!shouldConnect) return;
    
    const balanceInterval = setInterval(() => {
      fetchRestData(false);
    }, 60000); // 60 seconds (was 30s)
    
    const pnlInterval = setInterval(() => {
      fetchPnL();
    }, 120000); // 2 minutes (was 60s)
    
    return () => {
      clearInterval(balanceInterval);
      clearInterval(pnlInterval);
    };
  }, [shouldConnect, fetchRestData, fetchPnL]);

  // CRITICAL: Listen for trade events and refresh data (with throttling)
  useEffect(() => {
    const handleTradeEvent = () => {
      console.log('[KrakenWebSocketProvider] Trade event - scheduling REST refresh');
      // Wait 2 seconds for Kraken to process the trade
      setTimeout(() => {
        fetchRestData(true);
      }, 2000);
    };
    
    window.addEventListener('trade:completed', handleTradeEvent);
    window.addEventListener('kraken:synced', handleTradeEvent);
    
    return () => {
      window.removeEventListener('trade:completed', handleTradeEvent);
      window.removeEventListener('kraken:synced', handleTradeEvent);
    };
  }, [fetchRestData]);

  const value = {
    ...state,
    refresh,
    wsManager,
    // CRITICAL: Expose centralized REST data for all components
    krakenBalance: restData.krakenBalance,
    krakenPnL: restData.krakenPnL,
    krakenOrders: restData.krakenOrders,
    krakenTrades: restData.krakenTrades,
    restDataLoading: restData.isLoading,
    restDataError: restData.error,
    lastRestFetchTime: restData.lastFetchTime,
    // Expose the fetch function for manual refresh (but it enforces rate limits)
    fetchKrakenData: fetchRestData,
    fetchPnL
  };

  return (
    <KrakenWebSocketContext.Provider value={value}>
      {children}
    </KrakenWebSocketContext.Provider>
  );
}