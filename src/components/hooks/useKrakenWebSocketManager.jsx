
import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * CENTRALIZED KRAKEN WEBSOCKET MANAGER
 * 
 * Handles ALL Kraken WebSocket v2 subscriptions:
 * - Ticker (prices) - EXISTING
 * - Balances - NEW
 * - Executions (trades) - NEW
 * - Open Orders - NEW
 * 
 * Based on: https://docs.kraken.com/api/docs/websocket-v2/
 */

// GLOBAL STATE - shared across ALL hooks
const GLOBAL_WS_STATE = {
  ws: null,
  isConnected: false,
  token: null,
  reconnectAttempts: 0,
  subscribers: new Map(),
  
  // Data stores
  prices: new Map(),
  balances: new Map(),
  orders: new Map(),
  executions: [],
  
  // Subscription tracking
  activeSubscriptions: new Set(),
  
  // Event emitter
  eventListeners: new Map()
};

const WS_URL = 'wss://ws.kraken.com/v2';
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;

/**
 * Emit custom events to all listeners
 */
function emitEvent(eventName, data) {
  const listeners = GLOBAL_WS_STATE.eventListeners.get(eventName) || [];
  listeners.forEach(callback => {
    try {
      callback(data);
    } catch (e) {
      console.error('[KrakenWSManager] Event callback error:', e);
    }
  });
}

/**
 * Connect to Kraken WebSocket v2
 */
async function connectWebSocket() {
  if (GLOBAL_WS_STATE.ws && GLOBAL_WS_STATE.isConnected) {
    console.log('[KrakenWSManager] Already connected');
    return;
  }

  console.log('[KrakenWSManager] Connecting to Kraken WebSocket v2...');

  try {
    // FIXED: Get WebSocket token with correct action name
    if (!GLOBAL_WS_STATE.token) {
      console.log('[KrakenWSManager] Requesting WebSocket token...');
      
      const response = await base44.functions.invoke('krakenApi', { 
        action: 'getWebSocketUrl'  // ✅ FIXED: Correct action name
      });
      
      const data = response?.data || response;
      
      console.log('[KrakenWSManager] Token response:', { 
        success: data?.success, 
        hasToken: !!data?.token,
        connected: data?.connected 
      });
      
      if (data?.success && data?.token) {
        GLOBAL_WS_STATE.token = data.token;
        console.log('[KrakenWSManager] ✅ Got WebSocket token');
      } else {
        // CRITICAL: Handle "not connected" gracefully
        if (data?.connected === false) {
          console.warn('[KrakenWSManager] ⚠️ Kraken account not connected');
          throw new Error('Kraken account not connected');
        }
        throw new Error(data?.error || 'Failed to get WebSocket token');
      }
    }

    // Create WebSocket connection
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[KrakenWSManager] ✅ WebSocket connected');
      GLOBAL_WS_STATE.isConnected = true;
      GLOBAL_WS_STATE.reconnectAttempts = 0;
      
      emitEvent('connected', {});
      
      // Resubscribe to all active subscriptions
      GLOBAL_WS_STATE.activeSubscriptions.forEach(sub => {
        ws.send(JSON.stringify(sub));
      });
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMessage(message);
      } catch (e) {
        console.error('[KrakenWSManager] Message parse error:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('[KrakenWSManager] WebSocket error:', error);
      emitEvent('error', error);
    };

    ws.onclose = () => {
      console.log('[KrakenWSManager] WebSocket closed');
      GLOBAL_WS_STATE.isConnected = false;
      GLOBAL_WS_STATE.ws = null;
      
      emitEvent('disconnected', {});
      
      // Auto-reconnect
      if (GLOBAL_WS_STATE.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        GLOBAL_WS_STATE.reconnectAttempts++;
        console.log(`[KrakenWSManager] Reconnecting (attempt ${GLOBAL_WS_STATE.reconnectAttempts})...`);
        setTimeout(connectWebSocket, RECONNECT_DELAY);
      }
    };

    GLOBAL_WS_STATE.ws = ws;

  } catch (error) {
    console.error('[KrakenWSManager] Connection error:', error.message);
    GLOBAL_WS_STATE.isConnected = false;
    
    // Don't retry if Kraken not connected
    if (error.message.includes('not connected')) {
      console.warn('[KrakenWSManager] ❌ Kraken not connected - stopping retries');
      emitEvent('error', { message: 'Kraken account not connected', fatal: true });
      return;
    }
    
    // Retry for other errors
    if (GLOBAL_WS_STATE.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      GLOBAL_WS_STATE.reconnectAttempts++;
      setTimeout(connectWebSocket, RECONNECT_DELAY);
    }
  }
}

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(message) {
  const { channel, type, data } = message;

  // Handle different message types
  if (type === 'update') {
    if (channel === 'ticker') {
      handleTickerUpdate(data);
    } else if (channel === 'balances') {
      handleBalanceUpdate(data);
    } else if (channel === 'executions') {
      handleExecutionUpdate(data);
    } else if (channel === 'openOrders') {
      handleOrderUpdate(data);
    }
  } else if (type === 'snapshot') {
    if (channel === 'balances') {
      handleBalanceSnapshot(data);
    } else if (channel === 'openOrders') {
      handleOrderSnapshot(data);
    }
  } else if (type === 'subscribed') {
    console.log('[KrakenWSManager] ✅ Subscribed to', channel);
  } else if (type === 'error') {
    console.error('[KrakenWSManager] Subscription error:', message);
  }
}

/**
 * Handle ticker updates (prices)
 */
function handleTickerUpdate(data) {
  data.forEach(ticker => {
    const { symbol, last, bid, ask, change_24h, volume_24h } = ticker;
    
    GLOBAL_WS_STATE.prices.set(symbol, {
      symbol,
      price: last,
      bid,
      ask,
      change_24h,
      volume_24h,
      timestamp: Date.now()
    });
  });
  
  emitEvent('pricesUpdated', Object.fromEntries(GLOBAL_WS_STATE.prices));
}

/**
 * Handle balance snapshot (full balance data)
 */
function handleBalanceSnapshot(data) {
  console.log('[KrakenWSManager] 💰 Balance snapshot:', data);
  
  data.forEach(balance => {
    const { asset, balance: amount, available } = balance;
    GLOBAL_WS_STATE.balances.set(asset, {
      asset,
      balance: parseFloat(amount),
      available: parseFloat(available),
      timestamp: Date.now()
    });
  });
  
  emitEvent('balancesUpdated', Object.fromEntries(GLOBAL_WS_STATE.balances));
}

/**
 * Handle balance updates (incremental changes)
 */
function handleBalanceUpdate(data) {
  console.log('[KrakenWSManager] 💰 Balance update:', data);
  
  data.forEach(balance => {
    const { asset, balance: amount, available } = balance;
    GLOBAL_WS_STATE.balances.set(asset, {
      asset,
      balance: parseFloat(amount),
      available: parseFloat(available),
      timestamp: Date.now()
    });
  });
  
  emitEvent('balancesUpdated', Object.fromEntries(GLOBAL_WS_STATE.balances));
}

/**
 * Handle order snapshot (full open orders)
 */
function handleOrderSnapshot(data) {
  console.log('[KrakenWSManager] 📋 Orders snapshot:', data);
  
  GLOBAL_WS_STATE.orders.clear();
  data.forEach(order => {
    GLOBAL_WS_STATE.orders.set(order.order_id, order);
  });
  
  emitEvent('ordersUpdated', Object.fromEntries(GLOBAL_WS_STATE.orders));
}

/**
 * Handle order updates (new/changed/closed orders)
 */
function handleOrderUpdate(data) {
  console.log('[KrakenWSManager] 📋 Order update:', data);
  
  data.forEach(order => {
    if (order.status === 'closed' || order.status === 'canceled') {
      GLOBAL_WS_STATE.orders.delete(order.order_id);
    } else {
      GLOBAL_WS_STATE.orders.set(order.order_id, order);
    }
  });
  
  emitEvent('ordersUpdated', Object.fromEntries(GLOBAL_WS_STATE.orders));
}

/**
 * Handle execution updates (trade fills)
 */
function handleExecutionUpdate(data) {
  console.log('[KrakenWSManager] ✅ Execution:', data);
  
  data.forEach(execution => {
    GLOBAL_WS_STATE.executions.push({
      ...execution,
      timestamp: Date.now()
    });
    
    // Keep only last 100 executions
    if (GLOBAL_WS_STATE.executions.length > 100) {
      GLOBAL_WS_STATE.executions.shift();
    }
  });
  
  emitEvent('executionReceived', data);
}

/**
 * Subscribe to a channel
 */
function subscribe(channel, params = {}) {
  if (!GLOBAL_WS_STATE.ws || !GLOBAL_WS_STATE.isConnected) {
    console.warn('[KrakenWSManager] Not connected, queuing subscription');
    return;
  }

  const subscription = {
    method: 'subscribe',
    params: {
      channel,
      ...params
    }
  };

  // Add token for authenticated channels
  if (['balances', 'executions', 'openOrders'].includes(channel)) {
    subscription.params.token = GLOBAL_WS_STATE.token;
  }

  console.log('[KrakenWSManager] Subscribing to', channel);
  GLOBAL_WS_STATE.ws.send(JSON.stringify(subscription));
  GLOBAL_WS_STATE.activeSubscriptions.add(subscription);
}

/**
 * Unsubscribe from a channel
 */
function unsubscribe(channel, params = {}) {
  if (!GLOBAL_WS_STATE.ws || !GLOBAL_WS_STATE.isConnected) {
    return;
  }

  const unsubscription = {
    method: 'unsubscribe',
    params: {
      channel,
      ...params
    }
  };

  GLOBAL_WS_STATE.ws.send(JSON.stringify(unsubscription));
  
  // Remove from active subscriptions
  GLOBAL_WS_STATE.activeSubscriptions.forEach(sub => {
    if (sub.params.channel === channel) {
      GLOBAL_WS_STATE.activeSubscriptions.delete(sub);
    }
  });
}

/**
 * React hook for using the WebSocket manager
 */
export function useKrakenWebSocketManager(options = {}) {
  const {
    subscribeToPrices = false,
    priceSymbols = [],
    subscribeToBalances = false,
    subscribeToOrders = false,
    subscribeToExecutions = false
  } = options;

  const [isConnected, setIsConnected] = useState(GLOBAL_WS_STATE.isConnected);
  const [prices, setPrices] = useState({});
  const [balances, setBalances] = useState({});
  const [orders, setOrders] = useState({});
  const [lastExecution, setLastExecution] = useState(null);

  const subscriberIdRef = useRef(Symbol());

  // Connect on mount
  useEffect(() => {
    connectWebSocket();
  }, []);

  // Handle connection state changes
  useEffect(() => {
    const handleConnected = () => setIsConnected(true);
    const handleDisconnected = () => setIsConnected(false);

    GLOBAL_WS_STATE.eventListeners.set('connected', [
      ...(GLOBAL_WS_STATE.eventListeners.get('connected') || []),
      handleConnected
    ]);

    GLOBAL_WS_STATE.eventListeners.set('disconnected', [
      ...(GLOBAL_WS_STATE.eventListeners.get('disconnected') || []),
      handleDisconnected
    ]);

    return () => {
      // Cleanup
      const connectedListeners = GLOBAL_WS_STATE.eventListeners.get('connected') || [];
      GLOBAL_WS_STATE.eventListeners.set('connected', 
        connectedListeners.filter(cb => cb !== handleConnected)
      );

      const disconnectedListeners = GLOBAL_WS_STATE.eventListeners.get('disconnected') || [];
      GLOBAL_WS_STATE.eventListeners.set('disconnected', 
        disconnectedListeners.filter(cb => cb !== handleDisconnected)
      );
    };
  }, []);

  // Subscribe to prices
  useEffect(() => {
    if (!subscribeToPrices || !isConnected || priceSymbols.length === 0) {
      return;
    }

    console.log('[KrakenWSManager] Subscribing to prices for', priceSymbols.length, 'symbols');
    
    subscribe('ticker', {
      symbol: priceSymbols
    });

    const handlePricesUpdated = (data) => {
      setPrices(data);
    };

    GLOBAL_WS_STATE.eventListeners.set('pricesUpdated', [
      ...(GLOBAL_WS_STATE.eventListeners.get('pricesUpdated') || []),
      handlePricesUpdated
    ]);

    return () => {
      const listeners = GLOBAL_WS_STATE.eventListeners.get('pricesUpdated') || [];
      GLOBAL_WS_STATE.eventListeners.set('pricesUpdated', 
        listeners.filter(cb => cb !== handlePricesUpdated)
      );
    };
  }, [subscribeToPrices, isConnected, priceSymbols.join(',')]);

  // Subscribe to balances
  useEffect(() => {
    if (!subscribeToBalances || !isConnected) {
      return;
    }

    console.log('[KrakenWSManager] Subscribing to balances');
    
    subscribe('balances');

    const handleBalancesUpdated = (data) => {
      setBalances(data);
    };

    GLOBAL_WS_STATE.eventListeners.set('balancesUpdated', [
      ...(GLOBAL_WS_STATE.eventListeners.get('balancesUpdated') || []),
      handleBalancesUpdated
    ]);

    return () => {
      const listeners = GLOBAL_WS_STATE.eventListeners.get('balancesUpdated') || [];
      GLOBAL_WS_STATE.eventListeners.set('balancesUpdated', 
        listeners.filter(cb => cb !== handleBalancesUpdated)
      );
    };
  }, [subscribeToBalances, isConnected]);

  // Subscribe to orders
  useEffect(() => {
    if (!subscribeToOrders || !isConnected) {
      return;
    }

    console.log('[KrakenWSManager] Subscribing to orders');
    
    subscribe('openOrders');

    const handleOrdersUpdated = (data) => {
      setOrders(data);
    };

    GLOBAL_WS_STATE.eventListeners.set('ordersUpdated', [
      ...(GLOBAL_WS_STATE.eventListeners.get('ordersUpdated') || []),
      handleOrdersUpdated
    ]);

    return () => {
      const listeners = GLOBAL_WS_STATE.eventListeners.get('ordersUpdated') || [];
      GLOBAL_WS_STATE.eventListeners.set('ordersUpdated', 
        listeners.filter(cb => cb !== handleOrdersUpdated)
      );
    };
  }, [subscribeToOrders, isConnected]);

  // Subscribe to executions
  useEffect(() => {
    if (!subscribeToExecutions || !isConnected) {
      return;
    }

    console.log('[KrakenWSManager] Subscribing to executions');
    
    subscribe('executions');

    const handleExecutionReceived = (data) => {
      setLastExecution(data[0] || null);
    };

    GLOBAL_WS_STATE.eventListeners.set('executionReceived', [
      ...(GLOBAL_WS_STATE.eventListeners.get('executionReceived') || []),
      handleExecutionReceived
    ]);

    return () => {
      const listeners = GLOBAL_WS_STATE.eventListeners.get('executionReceived') || [];
      GLOBAL_WS_STATE.eventListeners.set('executionReceived', 
        listeners.filter(cb => cb !== handleExecutionReceived)
      );
    };
  }, [subscribeToExecutions, isConnected]);

  return {
    isConnected,
    prices,
    balances,
    orders,
    lastExecution,
    
    // Manual subscription methods
    subscribe: useCallback((channel, params) => subscribe(channel, params), []),
    unsubscribe: useCallback((channel, params) => unsubscribe(channel, params), []),
    
    // Get current data
    getAllPrices: useCallback(() => Object.fromEntries(GLOBAL_WS_STATE.prices), []),
    getAllBalances: useCallback(() => Object.fromEntries(GLOBAL_WS_STATE.balances), []),
    getAllOrders: useCallback(() => Object.fromEntries(GLOBAL_WS_STATE.orders), [])
  };
}

/**
 * Disconnect and cleanup
 */
export function disconnectKrakenWebSocket() {
  if (GLOBAL_WS_STATE.ws) {
    GLOBAL_WS_STATE.ws.close();
    GLOBAL_WS_STATE.ws = null;
  }
  
  GLOBAL_WS_STATE.isConnected = false;
  GLOBAL_WS_STATE.token = null;
  GLOBAL_WS_STATE.prices.clear();
  GLOBAL_WS_STATE.balances.clear();
  GLOBAL_WS_STATE.orders.clear();
  GLOBAL_WS_STATE.executions = [];
  GLOBAL_WS_STATE.activeSubscriptions.clear();
  GLOBAL_WS_STATE.eventListeners.clear();
}
