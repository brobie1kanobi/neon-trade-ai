import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * CENTRALIZED KRAKEN WEBSOCKET MANAGER - FIXED ERROR HANDLING
 */

// GLOBAL STATE
const GLOBAL_WS_STATE = {
  ws: null,
  isConnected: false,
  token: null,
  reconnectAttempts: 0,
  subscribers: new Map(),
  prices: new Map(),
  balances: new Map(),
  orders: new Map(),
  executions: [],
  activeSubscriptions: new Set(),
  eventListeners: new Map()
};

const WS_URL = 'wss://ws.kraken.com/v2';
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;

function emitEvent(eventName, data) {
  const listeners = GLOBAL_WS_STATE.eventListeners.get(eventName) || [];
  listeners.forEach(callback => {
    try {
      callback(data);
    } catch (e) {
      console.error('[KrakenWS] Event error:', e);
    }
  });
}

/**
 * FIXED: Better error handling for WebSocket connection
 */
async function connectWebSocket() {
  if (GLOBAL_WS_STATE.ws && GLOBAL_WS_STATE.isConnected) {
    return;
  }

  try {
    // CRITICAL: Get WebSocket token with error handling
    if (!GLOBAL_WS_STATE.token) {
      const response = await Promise.race([
        base44.functions.invoke('krakenApi', { action: 'getWebSocketUrl' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Token request timeout')), 5000))
      ]);
      
      const data = response?.data || response;
      
      // CRITICAL: Handle not connected gracefully - DON'T retry
      if (!data?.success || !data?.token) {
        if (data?.connected === false) {
          console.warn('[KrakenWS] ⚠️ Account not connected - skipping WebSocket');
          emitEvent('error', { message: 'Account not connected', fatal: true });
          return;
        }
        throw new Error(data?.error || 'No WebSocket token received');
      }
      
      GLOBAL_WS_STATE.token = data.token;
    }

    // Create WebSocket
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      GLOBAL_WS_STATE.isConnected = true;
      GLOBAL_WS_STATE.reconnectAttempts = 0;
      emitEvent('connected', {});
      
      // Resubscribe
      GLOBAL_WS_STATE.activeSubscriptions.forEach(sub => {
        ws.send(JSON.stringify(sub));
      });
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMessage(message);
      } catch (e) {
        console.error('[KrakenWS] Parse error:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('[KrakenWS] Error:', error.message || 'Unknown error');
      emitEvent('error', error);
    };

    ws.onclose = () => {
      GLOBAL_WS_STATE.isConnected = false;
      GLOBAL_WS_STATE.ws = null;
      emitEvent('disconnected', {});
      
      // Auto-reconnect
      if (GLOBAL_WS_STATE.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        GLOBAL_WS_STATE.reconnectAttempts++;
        setTimeout(connectWebSocket, RECONNECT_DELAY);
      }
    };

    GLOBAL_WS_STATE.ws = ws;

  } catch (error) {
    console.error('[KrakenWS] Connect error:', error.message || 'Unknown');
    GLOBAL_WS_STATE.isConnected = false;
    
    // Don't retry if account not connected or token issues
    if (error.message.includes('not connected') || error.message.includes('token')) {
      emitEvent('error', { message: error.message, fatal: true });
      return;
    }
    
    // Retry for other errors
    if (GLOBAL_WS_STATE.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      GLOBAL_WS_STATE.reconnectAttempts++;
      setTimeout(connectWebSocket, RECONNECT_DELAY);
    }
  }
}

function handleMessage(message) {
  const { channel, type, data } = message;

  if (type === 'update') {
    if (channel === 'ticker') handleTickerUpdate(data);
    else if (channel === 'balances') handleBalanceUpdate(data);
    else if (channel === 'executions') handleExecutionUpdate(data);
    else if (channel === 'openOrders') handleOrderUpdate(data);
  } else if (type === 'snapshot') {
    if (channel === 'balances') handleBalanceSnapshot(data);
    else if (channel === 'openOrders') handleOrderSnapshot(data);
  } else if (type === 'error') {
    console.error('[KrakenWS] Subscription error:', message);
  }
}

function handleTickerUpdate(data) {
  data.forEach(ticker => {
    const { symbol, last, bid, ask, change_24h, volume_24h } = ticker;
    GLOBAL_WS_STATE.prices.set(symbol, {
      symbol, price: last, bid, ask, change_24h, volume_24h, timestamp: Date.now()
    });
  });
  emitEvent('pricesUpdated', Object.fromEntries(GLOBAL_WS_STATE.prices));
}

function handleBalanceSnapshot(data) {
  data.forEach(balance => {
    const { asset, balance: amount, available } = balance;
    GLOBAL_WS_STATE.balances.set(asset, {
      asset, balance: parseFloat(amount), available: parseFloat(available), timestamp: Date.now()
    });
  });
  emitEvent('balancesUpdated', Object.fromEntries(GLOBAL_WS_STATE.balances));
}

function handleBalanceUpdate(data) {
  data.forEach(balance => {
    const { asset, balance: amount, available } = balance;
    GLOBAL_WS_STATE.balances.set(asset, {
      asset, balance: parseFloat(amount), available: parseFloat(available), timestamp: Date.now()
    });
  });
  emitEvent('balancesUpdated', Object.fromEntries(GLOBAL_WS_STATE.balances));
}

function handleOrderSnapshot(data) {
  GLOBAL_WS_STATE.orders.clear();
  data.forEach(order => {
    GLOBAL_WS_STATE.orders.set(order.order_id, order);
  });
  emitEvent('ordersUpdated', Object.fromEntries(GLOBAL_WS_STATE.orders));
}

function handleOrderUpdate(data) {
  data.forEach(order => {
    if (order.status === 'closed' || order.status === 'canceled') {
      GLOBAL_WS_STATE.orders.delete(order.order_id);
    } else {
      GLOBAL_WS_STATE.orders.set(order.order_id, order);
    }
  });
  emitEvent('ordersUpdated', Object.fromEntries(GLOBAL_WS_STATE.orders));
}

function handleExecutionUpdate(data) {
  data.forEach(execution => {
    GLOBAL_WS_STATE.executions.push({ ...execution, timestamp: Date.now() });
    if (GLOBAL_WS_STATE.executions.length > 100) {
      GLOBAL_WS_STATE.executions.shift();
    }
  });
  emitEvent('executionReceived', data);
}

function subscribe(channel, params = {}) {
  if (!GLOBAL_WS_STATE.ws || !GLOBAL_WS_STATE.isConnected) {
    return;
  }

  const subscription = {
    method: 'subscribe',
    params: { channel, ...params }
  };

  if (['balances', 'executions', 'openOrders'].includes(channel)) {
    subscription.params.token = GLOBAL_WS_STATE.token;
  }

  GLOBAL_WS_STATE.ws.send(JSON.stringify(subscription));
  GLOBAL_WS_STATE.activeSubscriptions.add(subscription);
}

function unsubscribe(channel, params = {}) {
  if (!GLOBAL_WS_STATE.ws || !GLOBAL_WS_STATE.isConnected) {
    return;
  }

  const unsubscription = {
    method: 'unsubscribe',
    params: { channel, ...params }
  };

  GLOBAL_WS_STATE.ws.send(JSON.stringify(unsubscription));
  GLOBAL_WS_STATE.activeSubscriptions.forEach(sub => {
    if (sub.params.channel === channel) {
      GLOBAL_WS_STATE.activeSubscriptions.delete(sub);
    }
  });
}

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

  useEffect(() => {
    connectWebSocket();
  }, []);

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

  useEffect(() => {
    if (!subscribeToPrices || !isConnected || priceSymbols.length === 0) return;
    
    subscribe('ticker', { symbol: priceSymbols });

    const handlePricesUpdated = (data) => setPrices(data);

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

  useEffect(() => {
    if (!subscribeToBalances || !isConnected) return;
    
    subscribe('balances');

    const handleBalancesUpdated = (data) => setBalances(data);

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

  useEffect(() => {
    if (!subscribeToOrders || !isConnected) return;
    
    subscribe('openOrders');

    const handleOrdersUpdated = (data) => setOrders(data);

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

  useEffect(() => {
    if (!subscribeToExecutions || !isConnected) return;
    
    subscribe('executions');

    const handleExecutionReceived = (data) => setLastExecution(data[0] || null);

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
    subscribe: useCallback((channel, params) => subscribe(channel, params), []),
    unsubscribe: useCallback((channel, params) => unsubscribe(channel, params), []),
    getAllPrices: useCallback(() => Object.fromEntries(GLOBAL_WS_STATE.prices), []),
    getAllBalances: useCallback(() => Object.fromEntries(GLOBAL_WS_STATE.balances), []),
    getAllOrders: useCallback(() => Object.fromEntries(GLOBAL_WS_STATE.orders), [])
  };
}

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