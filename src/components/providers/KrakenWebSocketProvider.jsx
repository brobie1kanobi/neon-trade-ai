import React, { createContext, useContext, useEffect, useState } from 'react';
import { useKrakenWebSocketManager } from '@/components/hooks/useKrakenWebSocketManager';
import { useSettings } from '@/components/utils/SettingsContext';

const KrakenWebSocketContext = createContext(null);

export const useKrakenWebSocket = () => {
  const context = useContext(KrakenWebSocketContext);
  if (!context) {
    throw new Error('useKrakenWebSocket must be used within KrakenWebSocketProvider');
  }
  return context;
};

/**
 * Global WebSocket Provider - maintains a single persistent connection
 * This ensures WebSocket stays active across all pages and components
 */
export function KrakenWebSocketProvider({ children }) {
  const { settings, user } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  // Only connect in LIVE mode with authenticated user
  const shouldConnect = !isSimMode && !!user?.email; // live mode only
  // Force balances subscription even if prices not requested
  const subscribeToPrices = shouldConnect;
  const subscribeToBalances = shouldConnect;
  const subscribeToExecutions = shouldConnect;

  // Initialize WebSocket manager with ALL subscriptions
  const wsManager = useKrakenWebSocketManager({
    subscribeToPrices: shouldConnect,
    priceSymbols: settings?.watched_crypto || [],
    subscribeToBalances: shouldConnect,
    subscribeToOrders: false,
    subscribeToExecutions: shouldConnect
  });

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

  // Update state when WebSocket data changes
  useEffect(() => {
    if (!shouldConnect || !wsManager) return;

    const updateState = async () => {
      try {
        const isConnected = !!wsManager.isConnected;
        const prices = await wsManager.getAllPrices?.() || {};
        const balances = await wsManager.getAllBalances?.() || {};
        const orders = await wsManager.getAllOrders?.() || {};
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

    // Update every 2 seconds
    const interval = setInterval(updateState, 2000);

    return () => clearInterval(interval);
  }, [shouldConnect, wsManager]);

  // Provide refresh function - CRITICAL: Force immediate state update after refresh
  const refresh = async () => {
    if (!wsManager) return;
    console.log('[KrakenWebSocketProvider] Manual refresh requested');
    try {
      await wsManager.refreshBalances?.();
      await wsManager.refreshOrders?.();
      
      // CRITICAL: Force immediate state update after refresh
      const isConnected = wsManager.isConnected?.() || false;
      const prices = await wsManager.getAllPrices?.() || {};
      const balances = await wsManager.getAllBalances?.() || {};
      const orders = await wsManager.getAllOrders?.() || {};
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
  }, [wsManager]);

  const value = {
    ...state,
    refresh,
    wsManager
  };

  return (
    <KrakenWebSocketContext.Provider value={value}>
      {children}
    </KrakenWebSocketContext.Provider>
  );
}