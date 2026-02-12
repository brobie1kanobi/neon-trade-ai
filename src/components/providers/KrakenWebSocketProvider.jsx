import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useKrakenWebSocketManager } from '@/components/hooks/useKrakenWebSocketManager';
import { useSettings } from '@/components/utils/SettingsContext';
import { base44 } from '@/api/base44Client';

// Track last execution timestamp for recovery
let lastExecutionTimestamp = null;

const KrakenWebSocketContext = createContext(null);

export const useKrakenWebSocket = () => {
  const context = useContext(KrakenWebSocketContext);
  if (!context) {
    throw new Error('useKrakenWebSocket must be used within KrakenWebSocketProvider');
  }
  return context;
};

/**
 * Global WebSocket Provider - SINGLE SOURCE OF TRUTH for ALL Kraken REALTIME data
 * 
 * ARCHITECTURE:
 * - WebSocket: LIVE prices, balance updates, order fills, executions
 * - REST API: Initial snapshot, order placement, historical data, recovery
 * 
 * This provider:
 * 1. Maintains WebSocket connections for real-time data
 * 2. Fetches initial REST snapshot on mount (one-time)
 * 3. Updates state from WebSocket deltas (real-time)
 * 4. NEVER polls REST for live data after WebSocket is active
 */
export function KrakenWebSocketProvider({ children }) {
  const { settings, user } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  // Only connect in LIVE mode with authenticated user
  const shouldConnect = !isSimMode && !!user?.email;

  // Initialize WebSocket manager with ALL subscriptions
  const wsManager = useKrakenWebSocketManager({
    subscribeToPrices: shouldConnect,
    priceSymbols: settings?.watched_crypto || [],
    subscribeToBalances: shouldConnect,
    subscribeToOrders: false,
    subscribeToExecutions: shouldConnect
  });

  // CRITICAL: REST API is ONLY for initial snapshot and post-action verification
  // WebSocket handles ALL live data after initial load
  const lastRestCallRef = useRef(0);
  const hasInitialSnapshotRef = useRef(false);
  const MIN_REST_INTERVAL = 30000; // 30 seconds - REST is backup only, not primary data source

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
      // Update execution timestamp for recovery
      lastExecutionTimestamp = new Date().toISOString();
      
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

  // CRITICAL: WebSocket recovery - detect disconnects and recover missed trades
  useEffect(() => {
    if (!shouldConnect) return;
    
    const handleReconnect = async () => {
      if (!lastExecutionTimestamp) return;
      
      console.log('[KrakenWebSocketProvider] WebSocket reconnected - checking for missed trades');
      
      try {
        const recoveryRes = await base44.functions.invoke('wsRecovery', {
          action: 'recoverMissedTrades',
          since_timestamp: lastExecutionTimestamp
        });
        
        const result = recoveryRes?.data || recoveryRes;
        
        if (result?.trades_recovered > 0) {
          console.log(`[KrakenWebSocketProvider] Recovered ${result.trades_recovered} missed trades`);
          // Dispatch event to refresh UI
          window.dispatchEvent(new CustomEvent('kraken:synced', { 
            detail: { recovered: result.trades_recovered } 
          }));
        }
      } catch (e) {
        console.warn('[KrakenWebSocketProvider] Recovery check failed:', e.message);
      }
    };
    
    // Listen for WebSocket reconnect events
    window.addEventListener('kraken:ws-reconnected', handleReconnect);
    
    return () => {
      window.removeEventListener('kraken:ws-reconnected', handleReconnect);
    };
  }, [shouldConnect]);

  // CRITICAL: REST API fetcher - ONLY for initial snapshot and post-action verification
  // After WebSocket is active, this should rarely be called
  const fetchRestData = useCallback(async (force = false) => {
    if (isSimMode) return null;
    
    const now = Date.now();
    const timeSinceLastFetch = now - lastRestCallRef.current;
    
    // CRITICAL: Only fetch if:
    // 1. Force refresh requested (after order placement)
    // 2. Initial snapshot not yet loaded
    // 3. WebSocket disconnected (recovery mode)
    const wsConnected = state.isConnected;
    const needsInitialSnapshot = !hasInitialSnapshotRef.current;
    const isRecoveryMode = !wsConnected && timeSinceLastFetch > MIN_REST_INTERVAL;
    
    if (!force && !needsInitialSnapshot && !isRecoveryMode) {
      console.log('[KrakenWebSocketProvider] Skipping REST - WebSocket is active');
      return null;
    }
    
    // Check if already loading
    let shouldSkip = false;
    setRestData(prev => {
      if (prev.isLoading) {
        shouldSkip = true;
        return prev;
      }
      return { ...prev, isLoading: true, error: null };
    });
    
    if (shouldSkip) {
      console.log('[KrakenWebSocketProvider] REST fetch already in progress');
      return null;
    }
    
    const reason = force ? 'forced' : needsInitialSnapshot ? 'initial snapshot' : 'WS recovery';
    console.log(`[KrakenWebSocketProvider] Fetching REST snapshot (${reason})...`);
    lastRestCallRef.current = now;
    
    try {
      // Fetch balance and orders in parallel
      const [balanceRes, ordersRes] = await Promise.all([
        base44.functions.invoke('getKrakenBalance', {}).catch(e => ({ error: e.message })),
        base44.functions.invoke('krakenApi', { action: 'getOpenOrders' }).catch(e => ({ error: e.message }))
      ]);
      
      const balanceData = balanceRes?.data || balanceRes;
      const ordersData = ordersRes?.data || ordersRes;
      
      // Mark initial snapshot as complete
      if (balanceData?.success) {
        hasInitialSnapshotRef.current = true;
      }
      
      setRestData(prev => ({
        krakenBalance: balanceData?.success ? balanceData : null,
        krakenOrders: ordersData?.orders || [],
        krakenTrades: prev.krakenTrades,
        krakenPnL: prev.krakenPnL,
        lastFetchTime: Date.now(),
        isLoading: false,
        error: balanceData?.error || ordersData?.error || null
      }));
      
      console.log('[KrakenWebSocketProvider] REST snapshot complete - Balance:', !!balanceData?.success, 'Orders:', (ordersData?.orders || []).length);
      
      // Dispatch event for other components
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kraken:snapshot-loaded', { 
          detail: { balance: balanceData, orders: ordersData?.orders } 
        }));
      }
      
      return { krakenBalance: balanceData, krakenOrders: ordersData?.orders || [] };
    } catch (err) {
      console.error('[KrakenWebSocketProvider] REST snapshot error:', err);
      setRestData(prev => ({ ...prev, isLoading: false, error: err.message }));
      return null;
    }
  }, [isSimMode, state.isConnected]);

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

  // CRITICAL: Initial REST snapshot on mount (one-time only)
  // WebSocket handles all subsequent updates
  useEffect(() => {
    if (shouldConnect && !hasInitialSnapshotRef.current && restData.lastFetchTime === 0) {
      const timer = setTimeout(() => {
        console.log('[KrakenWebSocketProvider] Fetching initial REST snapshot...');
        fetchRestData(true);
        // Fetch PnL separately (less critical)
        setTimeout(() => fetchPnL(), 5000);
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [shouldConnect]); // eslint-disable-line react-hooks-deps

  // CRITICAL: NO periodic REST polling - WebSocket handles live data
  // Only fetch PnL periodically (it's not available via WebSocket)
  useEffect(() => {
    if (!shouldConnect) return;
    
    // PnL is the ONLY thing we poll - it's not available via WebSocket
    const pnlInterval = setInterval(() => {
      fetchPnL();
    }, 120000); // 2 minutes
    
    return () => {
      clearInterval(pnlInterval);
    };
  }, [shouldConnect, fetchPnL]);

  // CRITICAL: Recovery mode - if WebSocket disconnects, fall back to REST temporarily
  useEffect(() => {
    if (!shouldConnect) return;
    
    let recoveryInterval = null;
    
    if (!state.isConnected && hasInitialSnapshotRef.current) {
      console.log('[KrakenWebSocketProvider] WebSocket disconnected - entering recovery mode');
      
      // Poll REST every 60s while WebSocket is down
      recoveryInterval = setInterval(() => {
        if (!state.isConnected) {
          console.log('[KrakenWebSocketProvider] Recovery mode - fetching REST data');
          fetchRestData(true);
        }
      }, 60000);
    }
    
    return () => {
      if (recoveryInterval) clearInterval(recoveryInterval);
    };
  }, [shouldConnect, state.isConnected, fetchRestData]);

  // CRITICAL: Listen for trade/order events - fetch REST to verify (one-time)
  // WebSocket will handle subsequent real-time updates
  useEffect(() => {
    const handleOrderPlaced = () => {
      console.log('[KrakenWebSocketProvider] Order placed - verifying via REST');
      // Single REST fetch to verify order was accepted
      setTimeout(() => fetchRestData(true), 2000);
    };
    
    const handleTradeCompleted = () => {
      console.log('[KrakenWebSocketProvider] Trade completed - WebSocket will update balance');
      // Trust WebSocket for balance update, only fetch REST if WS is down
      if (!state.isConnected) {
        setTimeout(() => fetchRestData(true), 2000);
      }
    };
    
    window.addEventListener('kraken:order-placed', handleOrderPlaced);
    window.addEventListener('trade:completed', handleTradeCompleted);
    window.addEventListener('kraken:synced', handleTradeCompleted);
    
    return () => {
      window.removeEventListener('kraken:order-placed', handleOrderPlaced);
      window.removeEventListener('trade:completed', handleTradeCompleted);
      window.removeEventListener('kraken:synced', handleTradeCompleted);
    };
  }, [fetchRestData, state.isConnected]);

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