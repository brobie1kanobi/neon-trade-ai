import { useCallback, useEffect, useRef } from 'react';
import { useKrakenWebSocket } from '@/components/providers/KrakenWebSocketProvider';

/**
 * useKrakenRealtime Hook - PURE WEBSOCKET DATA CONSUMER
 * 
 * This hook provides REAL-TIME data from WebSocket streams ONLY.
 * It does NOT make any REST API calls.
 * 
 * Use this for:
 * - Live price updates
 * - Balance change notifications
 * - Order fill/status events
 * - Execution events
 * 
 * DO NOT use this for:
 * - Initial data load (use REST snapshot)
 * - Historical data
 * - Placing/canceling orders (use REST API)
 */
export function useKrakenRealtime(options = {}) {
  const {
    onPriceUpdate,
    onBalanceUpdate,
    onOrderFilled,
    onOrderCanceled,
    onExecution,
    symbols = []
  } = options;

  const callbacksRef = useRef({
    onPriceUpdate,
    onBalanceUpdate,
    onOrderFilled,
    onOrderCanceled,
    onExecution
  });

  // Keep callbacks ref updated
  useEffect(() => {
    callbacksRef.current = {
      onPriceUpdate,
      onBalanceUpdate,
      onOrderFilled,
      onOrderCanceled,
      onExecution
    };
  }, [onPriceUpdate, onBalanceUpdate, onOrderFilled, onOrderCanceled, onExecution]);

  // Get WebSocket state from provider
  const {
    isConnected,
    prices: wsPrices,
    balances: wsBalances,
    orders: wsOrders,
    wsManager
  } = useKrakenWebSocket();

  // Subscribe to requested symbols for ticker updates
  useEffect(() => {
    if (!isConnected || !wsManager || symbols.length === 0) return;

    // Convert symbols to Kraken pairs (e.g., BTC -> BTC/USD)
    const pairs = symbols.map(s => {
      const sym = String(s).toUpperCase();
      return sym.includes('/') ? sym : `${sym}/USD`;
    });

    console.log('[useKrakenRealtime] Subscribing to ticker for:', pairs);
    wsManager.subscribe?.('ticker', { symbols: pairs });
  }, [isConnected, wsManager, symbols.join(',')]);

  // Listen for WebSocket events
  useEffect(() => {
    // Price updates
    const handlePriceUpdate = (event) => {
      if (callbacksRef.current.onPriceUpdate) {
        callbacksRef.current.onPriceUpdate(event.detail);
      }
    };

    // Balance updates
    const handleBalanceUpdate = (event) => {
      if (callbacksRef.current.onBalanceUpdate) {
        callbacksRef.current.onBalanceUpdate(event.detail);
      }
    };

    // Order filled
    const handleOrderFilled = (event) => {
      if (callbacksRef.current.onOrderFilled) {
        callbacksRef.current.onOrderFilled(event.detail);
      }
    };

    // Order canceled
    const handleOrderCanceled = (event) => {
      if (callbacksRef.current.onOrderCanceled) {
        callbacksRef.current.onOrderCanceled(event.detail);
      }
    };

    // Register event listeners
    window.addEventListener('kraken:price-update', handlePriceUpdate);
    window.addEventListener('kraken:balance-update', handleBalanceUpdate);
    window.addEventListener('kraken:order-filled', handleOrderFilled);
    window.addEventListener('kraken:order-canceled', handleOrderCanceled);

    return () => {
      window.removeEventListener('kraken:price-update', handlePriceUpdate);
      window.removeEventListener('kraken:balance-update', handleBalanceUpdate);
      window.removeEventListener('kraken:order-filled', handleOrderFilled);
      window.removeEventListener('kraken:order-canceled', handleOrderCanceled);
    };
  }, []);

  // Convert WebSocket prices to standard format
  const getPriceForSymbol = useCallback((symbol) => {
    if (!wsPrices) return null;
    
    const sym = String(symbol).toUpperCase();
    const pair = sym.includes('/') ? sym : `${sym}/USD`;
    
    return wsPrices[pair] || null;
  }, [wsPrices]);

  // Convert WebSocket balances to standard format
  const getBalanceForAsset = useCallback((asset) => {
    if (!wsBalances) return null;
    
    const assetKey = String(asset).toUpperCase();
    return wsBalances[assetKey] || wsBalances[`Z${assetKey}`] || wsBalances[`X${assetKey}`] || null;
  }, [wsBalances]);

  // Get all current prices
  const getAllPrices = useCallback(() => {
    if (!wsPrices) return {};
    return { ...wsPrices };
  }, [wsPrices]);

  // Get all current balances
  const getAllBalances = useCallback(() => {
    if (!wsBalances) return {};
    return { ...wsBalances };
  }, [wsBalances]);

  // Get all open orders
  const getOpenOrders = useCallback(() => {
    if (!wsOrders) return {};
    return { ...wsOrders };
  }, [wsOrders]);

  return {
    // Connection state
    isConnected,
    
    // Real-time data
    prices: wsPrices || {},
    balances: wsBalances || {},
    orders: wsOrders || {},
    
    // Helper functions
    getPriceForSymbol,
    getBalanceForAsset,
    getAllPrices,
    getAllBalances,
    getOpenOrders,
    
    // WebSocket manager for manual subscriptions
    wsManager
  };
}

/**
 * Helper to check if WebSocket data is fresh
 * Data older than 30 seconds should trigger a REST refresh
 */
export function isWebSocketDataFresh(timestamp, maxAgeMs = 30000) {
  if (!timestamp) return false;
  return (Date.now() - timestamp) < maxAgeMs;
}