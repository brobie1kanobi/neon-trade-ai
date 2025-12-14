import React, { createContext, useContext, useEffect, useState } from 'react';
import { useKrakenWebSocketManager } from '@/components/hooks/useKrakenWebSocketManager';
import { useSettings } from '@/components/utils/SettingsContext';

const KrakenWebSocketContext = createContext({
  isConnected: false,
  prices: {},
  balances: {},
  orders: {},
  executions: [],
  usdBalance: 0,
  cryptoHoldingsValue: 0,
  totalPortfolioValue: 0,
  totalAssets: 0,
  refresh: async () => {},
  wsManager: null
});

export const useKrakenWebSocket = () => {
  const context = useContext(KrakenWebSocketContext);
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
  const shouldConnect = !isSimMode && !!user?.email;

  // Initialize WebSocket manager with ALL subscriptions
  let wsManager = null;
  try {
    wsManager = useKrakenWebSocketManager({
      enabled: shouldConnect,
      subscriptions: shouldConnect ? ['ticker', 'openOrders', 'ownTrades', 'balances'] : []
    });
  } catch (err) {
    console.warn('[KrakenWebSocketProvider] Manager initialization error:', err);
  }

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
    if (!shouldConnect || !wsManager) {
      // Keep default state when not connected
      return;
    }

    const updateState = async () => {
      try {
        const isConnected = typeof wsManager.isConnected === 'function' ? wsManager.isConnected() : false;
        const prices = typeof wsManager.getAllPrices === 'function' ? await wsManager.getAllPrices() : {};
        const balances = typeof wsManager.getBalances === 'function' ? await wsManager.getBalances() : {};
        const orders = typeof wsManager.getOpenOrders === 'function' ? await wsManager.getOpenOrders() : {};
        const executions = typeof wsManager.getExecutions === 'function' ? await wsManager.getExecutions() : [];

        // Calculate portfolio metrics
        let usdBalance = 0;
        let cryptoHoldingsValue = 0;
        let totalAssets = 0;

        if (balances && Object.keys(balances).length > 0) {
          // USD balance
          usdBalance = balances['USD']?.available || balances['ZUSD']?.available || 0;
          
          // Calculate crypto holdings value
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

  // Provide refresh function
  const refresh = async () => {
    if (!wsManager) return;
    try {
      if (typeof wsManager.refreshBalances === 'function') {
        await wsManager.refreshBalances();
      }
      if (typeof wsManager.refreshOrders === 'function') {
        await wsManager.refreshOrders();
      }
    } catch (err) {
      console.error('[KrakenWebSocketProvider] Refresh error:', err);
    }
  };

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