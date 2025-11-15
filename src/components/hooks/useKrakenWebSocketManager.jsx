import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * PRODUCTION KRAKEN WEBSOCKET - WITH AUTO TOKEN REFRESH
 * FIXED: Proper Kraken asset name normalization (XXRP -> XRP)
 */

const GLOBAL_WS_STATE = {
  ws: null,
  isConnected: false,
  token: null,
  tokenExpiry: null,
  reconnectAttempts: 0,
  prices: new Map(),
  balances: new Map(),
  orders: new Map(),
  executions: [],
  activeSubscriptions: new Set(),
  eventListeners: new Map(),
  tokenRefreshInterval: null,
  pendingSubscriptions: []
};

const WS_URL = 'wss://ws.kraken.com/v2';
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;
const TOKEN_REFRESH_INTERVAL = 12 * 60 * 1000;

// CRITICAL: Parse Kraken asset names
function parseKrakenAsset(krakenCode) {
  if (!krakenCode || typeof krakenCode !== 'string') return krakenCode;
  
  let symbol = krakenCode;
  
  // Remove X prefix (but NOT for XRP itself)
  if (krakenCode.startsWith('X') && krakenCode.length > 3 && krakenCode !== 'XRP') {
    symbol = krakenCode.substring(1);
  }
  // Remove Z prefix
  if (krakenCode.startsWith('Z') && krakenCode.length > 3) {
    symbol = krakenCode.substring(1);
  }
  
  // Direct mappings
  const symbolMap = {
    'XXRP': 'XRP',
    'XBT': 'BTC',
    'XXBT': 'BTC',
    'XETH': 'ETH',
    'XXDG': 'DOGE',
    'ZUSD': 'USD',
    'ZEUR': 'EUR'
  };
  
  return symbolMap[krakenCode] || symbol;
}

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

async function refreshToken() {
  try {
    console.log('[KrakenWS] 🔄 Refreshing WebSocket token...');
    
    const response = await Promise.race([
      base44.functions.invoke('krakenApi', { action: 'getWebSocketUrl' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Token timeout')), 5000))
    ]);
    
    const data = response?.data || response;
    
    if (data?.success && data?.token) {
      GLOBAL_WS_STATE.token = data.token;
      GLOBAL_WS_STATE.tokenExpiry = Date.now() + (data.expires_in || 900) * 1000;
      console.log('[KrakenWS] ✅ Token refreshed');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('[KrakenWS] Token refresh failed:', error.message);
    return false;
  }
}

function setupTokenRefresh() {
  if (GLOBAL_WS_STATE.tokenRefreshInterval) {
    clearInterval(GLOBAL_WS_STATE.tokenRefreshInterval);
  }
  
  GLOBAL_WS_STATE.tokenRefreshInterval = setInterval(async () => {
    const refreshed = await refreshToken();
    
    if (refreshed && GLOBAL_WS_STATE.ws && GLOBAL_WS_STATE.isConnected) {
      console.log('[KrakenWS] Reconnecting with fresh token...');
      GLOBAL_WS_STATE.ws.close();
      await new Promise(resolve => setTimeout(resolve, 1000));
      connectWebSocket();
    }
  }, TOKEN_REFRESH_INTERVAL);
}

// CRITICAL: Safe send that checks ready state
function safeSend(message) {
  if (!GLOBAL_WS_STATE.ws) {
    GLOBAL_WS_STATE.pendingSubscriptions.push(message);
    return false;
  }

  if (GLOBAL_WS_STATE.ws.readyState === WebSocket.OPEN) {
    GLOBAL_WS_STATE.ws.send(JSON.stringify(message));
    return true;
  } else if (GLOBAL_WS_STATE.ws.readyState === WebSocket.CONNECTING) {
    GLOBAL_WS_STATE.pendingSubscriptions.push(message);
    return false;
  }
  
  return false;
}

async function connectWebSocket() {
  if (GLOBAL_WS_STATE.ws && GLOBAL_WS_STATE.isConnected) {
    return;
  }

  try {
    if (!GLOBAL_WS_STATE.token || (GLOBAL_WS_STATE.tokenExpiry && Date.now() >= GLOBAL_WS_STATE.tokenExpiry)) {
      const refreshed = await refreshToken();
      if (!refreshed) {
        emitEvent('error', { message: 'Account not connected', fatal: true });
        return;
      }
    }

    if (!GLOBAL_WS_STATE.tokenRefreshInterval) {
      setupTokenRefresh();
    }

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[KrakenWS] ✅ Connected');
      GLOBAL_WS_STATE.isConnected = true;
      GLOBAL_WS_STATE.reconnectAttempts = 0;
      emitEvent('connected', {});
      
      setTimeout(() => {
        if (GLOBAL_WS_STATE.pendingSubscriptions.length > 0) {
          GLOBAL_WS_STATE.pendingSubscriptions.forEach(sub => safeSend(sub));
          GLOBAL_WS_STATE.pendingSubscriptions = [];
        }
        
        GLOBAL_WS_STATE.activeSubscriptions.forEach(sub => safeSend(sub));
      }, 100);
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
      console.error('[KrakenWS] Error:', error.message || 'Unknown');
      emitEvent('error', error);
    };

    ws.onclose = () => {
      GLOBAL_WS_STATE.isConnected = false;
      GLOBAL_WS_STATE.ws = null;
      emitEvent('disconnected', {});
      
      if (GLOBAL_WS_STATE.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        GLOBAL_WS_STATE.reconnectAttempts++;
        setTimeout(connectWebSocket, RECONNECT_DELAY);
      }
    };

    GLOBAL_WS_STATE.ws = ws;

  } catch (error) {
    console.error('[KrakenWS] Connect error:', error.message);
    GLOBAL_WS_STATE.isConnected = false;
    
    if (error.message.includes('not connected') || error.message.includes('token')) {
      emitEvent('error', { message: error.message, fatal: true });
      return;
    }
    
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
    // CRITICAL: Normalize asset names
    const normalizedAsset = parseKrakenAsset(asset);
    GLOBAL_WS_STATE.balances.set(normalizedAsset, {
      asset: normalizedAsset,
      balance: parseFloat(amount),
      available: parseFloat(available),
      timestamp: Date.now()
    });
  });
  emitEvent('balancesUpdated', Object.fromEntries(GLOBAL_WS_STATE.balances));
}

function handleBalanceUpdate(data) {
  data.forEach(balance => {
    const { asset, balance: amount, available } = balance;
    // CRITICAL: Normalize asset names
    const normalizedAsset = parseKrakenAsset(asset);
    GLOBAL_WS_STATE.balances.set(normalizedAsset, {
      asset: normalizedAsset,
      balance: parseFloat(amount),
      available: parseFloat(available),
      timestamp: Date.now()
    });
  });
  emitEvent('balancesUpdated', Object.fromEntries(GLOBAL_WS_STATE.balances));
}

function handleOrderSnapshot(data) {
  GLOBAL_WS_STATE.orders.clear();
  data.forEach(order => {
    // CRITICAL: Normalize symbol in orders
    const normalizedOrder = {
      ...order,
      symbol: parseKrakenAsset(order.symbol?.split('/')[0])
    };
    GLOBAL_WS_STATE.orders.set(order.order_id, normalizedOrder);
  });
  emitEvent('ordersUpdated', Object.fromEntries(GLOBAL_WS_STATE.orders));
}

function handleOrderUpdate(data) {
  data.forEach(order => {
    if (order.status === 'closed' || order.status === 'canceled') {
      GLOBAL_WS_STATE.orders.delete(order.order_id);
    } else {
      // CRITICAL: Normalize symbol in orders
      const normalizedOrder = {
        ...order,
        symbol: parseKrakenAsset(order.symbol?.split('/')[0])
      };
      GLOBAL_WS_STATE.orders.set(order.order_id, normalizedOrder);
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
  const subscription = {
    method: 'subscribe',
    params: { channel, ...params }
  };

  if (['balances', 'executions', 'openOrders'].includes(channel)) {
    subscription.params.token = GLOBAL_WS_STATE.token;
  }

  const sent = safeSend(subscription);
  
  if (sent || GLOBAL_WS_STATE.ws?.readyState === WebSocket.CONNECTING) {
    GLOBAL_WS_STATE.activeSubscriptions.add(subscription);
  }
}

function unsubscribe(channel, params = {}) {
  const unsubscription = {
    method: 'unsubscribe',
    params: { channel, ...params }
  };

  safeSend(unsubscription);
  
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
  if (GLOBAL_WS_STATE.tokenRefreshInterval) {
    clearInterval(GLOBAL_WS_STATE.tokenRefreshInterval);
    GLOBAL_WS_STATE.tokenRefreshInterval = null;
  }
  
  if (GLOBAL_WS_STATE.ws) {
    GLOBAL_WS_STATE.ws.close();
    GLOBAL_WS_STATE.ws = null;
  }
  
  GLOBAL_WS_STATE.isConnected = false;
  GLOBAL_WS_STATE.token = null;
  GLOBAL_WS_STATE.tokenExpiry = null;
  GLOBAL_WS_STATE.prices.clear();
  GLOBAL_WS_STATE.balances.clear();
  GLOBAL_WS_STATE.orders.clear();
  GLOBAL_WS_STATE.executions = [];
  GLOBAL_WS_STATE.activeSubscriptions.clear();
  GLOBAL_WS_STATE.eventListeners.clear();
  GLOBAL_WS_STATE.pendingSubscriptions = [];
}