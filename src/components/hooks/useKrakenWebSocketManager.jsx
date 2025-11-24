import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * PRODUCTION KRAKEN WEBSOCKET - FIXED asset normalization & conditional orders
 */

// CRITICAL: Normalize Kraken asset codes (XXRP → XRP, XXBT → BTC)
function normalizeKrakenSymbol(symbol) {
  if (!symbol) return symbol;
  
  let normalized = symbol;
  
  // Remove X/Z prefixes
  if (symbol.startsWith('X') && symbol.length > 3) {
    normalized = symbol.substring(1);
  }
  if (symbol.startsWith('Z') && symbol.length > 3) {
    normalized = symbol.substring(1);
  }
  
  // Map to standard symbols
  const map = {
    'XBT': 'BTC',
    'XDG': 'DOGE',
    'XRP': 'XRP',
    'ETH': 'ETH',
    'SOL': 'SOL',
    'ADA': 'ADA',
    'DOT': 'DOT',
    'DOGE': 'DOGE',
    'LINK': 'LINK',
    'USD': 'USD'
  };
  
  return map[normalized] || normalized;
}

// CRITICAL: Global singleton state to prevent duplicate connections
let globalConnectLock = false;
let globalTokenLock = false;

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
  pendingSubscriptions: [],
  pendingTokenRequest: null,
  isConnecting: false
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

async function refreshToken() {
  // CRITICAL: Check if we already have a valid token (valid for at least 30 more seconds)
  if (GLOBAL_WS_STATE.token && GLOBAL_WS_STATE.tokenExpiry && Date.now() < GLOBAL_WS_STATE.tokenExpiry - 30000) {
    console.log('[KrakenWS] ✅ Using existing valid token');
    return true;
  }

  // CRITICAL: If there's already a pending request, wait for it instead of creating a new one
  if (GLOBAL_WS_STATE.pendingTokenRequest) {
    console.log('[KrakenWS] ⏳ Waiting for existing pending token request...');
    try {
      return await GLOBAL_WS_STATE.pendingTokenRequest;
    } catch (e) {
      console.warn('[KrakenWS] Pending request failed:', e.message);
      // Fall through to create new request
    }
  }

  // CRITICAL: Global lock to prevent duplicate token requests
  if (globalTokenLock) {
    console.log('[KrakenWS] 🔒 Token request blocked - lock active');
    // Wait briefly and check if token was obtained
    await new Promise(resolve => setTimeout(resolve, 500));
    return GLOBAL_WS_STATE.token ? true : false;
  }

  globalTokenLock = true;

  const tokenPromise = (async () => {
    try {
      console.log('[KrakenWS] 🔄 Fetching WebSocket token (single request)...');
      
      const response = await Promise.race([
        base44.functions.invoke('krakenApi', { action: 'getWebSocketUrl' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Token timeout')), 10000))
      ]);
      
      const data = response?.data || response;
      
      if (data?.success && data?.token) {
        GLOBAL_WS_STATE.token = data.token;
        GLOBAL_WS_STATE.tokenExpiry = Date.now() + (data.expires_in || 900) * 1000;
        console.log('[KrakenWS] ✅ Token obtained, expires in', data.expires_in || 900, 's');
        return true;
      }
      
      console.warn('[KrakenWS] Token response invalid:', data?.error || 'No token');
      return false;
    } catch (error) {
      console.error('[KrakenWS] Token fetch failed:', error.message);
      return false;
    } finally {
      GLOBAL_WS_STATE.pendingTokenRequest = null;
      globalTokenLock = false;
    }
  })();

  GLOBAL_WS_STATE.pendingTokenRequest = tokenPromise;
  return tokenPromise;
}

// REMOVED: No automatic token refresh - only refresh on connection failure

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
  // CRITICAL: Global lock prevents ANY duplicate connections
  if (globalConnectLock) {
    console.log('[KrakenWS] 🔒 Connection blocked - already in progress globally');
    return;
  }

  if (GLOBAL_WS_STATE.isConnecting) {
    console.log('[KrakenWS] ⏳ Connection already in progress');
    return;
  }

  if (GLOBAL_WS_STATE.ws && GLOBAL_WS_STATE.isConnected) {
    console.log('[KrakenWS] ✅ Already connected');
    return;
  }

  globalConnectLock = true;
  GLOBAL_WS_STATE.isConnecting = true;

  try {
    // Only fetch token if missing (NOT on expiry - WebSocket stays connected)
    if (!GLOBAL_WS_STATE.token) {
      console.log('[KrakenWS] No token found, fetching initial token...');
      const refreshed = await refreshToken();
      if (!refreshed) {
        GLOBAL_WS_STATE.isConnecting = false;
        globalConnectLock = false;
        emitEvent('error', { message: 'Account not connected', fatal: true });
        return;
      }
    } else {
      console.log('[KrakenWS] ✅ Using existing token');
    }

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[KrakenWS] ✅ Connected');
      GLOBAL_WS_STATE.isConnected = true;
      GLOBAL_WS_STATE.isConnecting = false;
      globalConnectLock = false;
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
      GLOBAL_WS_STATE.isConnecting = false;
      globalConnectLock = false;
      GLOBAL_WS_STATE.ws = null;
      emitEvent('disconnected', {});
      
      if (GLOBAL_WS_STATE.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        GLOBAL_WS_STATE.reconnectAttempts++;
        console.log('[KrakenWS] 🔄 Reconnecting in', RECONNECT_DELAY / 1000, 's (attempt', GLOBAL_WS_STATE.reconnectAttempts, '/', MAX_RECONNECT_ATTEMPTS, ')');
        setTimeout(connectWebSocket, RECONNECT_DELAY);
      }
    };

    GLOBAL_WS_STATE.ws = ws;

  } catch (error) {
    console.error('[KrakenWS] Connect error:', error.message);
    GLOBAL_WS_STATE.isConnected = false;
    GLOBAL_WS_STATE.isConnecting = false;
    globalConnectLock = false;
    
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
    const normalized = normalizeKrakenSymbol(symbol);
    GLOBAL_WS_STATE.prices.set(normalized, {
      symbol: normalized, price: last, bid, ask, change_24h, volume_24h, timestamp: Date.now()
    });
  });
  emitEvent('pricesUpdated', Object.fromEntries(GLOBAL_WS_STATE.prices));
}

function handleBalanceSnapshot(data) {
  data.forEach(balance => {
    const { asset, balance: amount, available } = balance;
    const normalized = normalizeKrakenSymbol(asset);
    GLOBAL_WS_STATE.balances.set(normalized, {
      asset: normalized, balance: parseFloat(amount), available: parseFloat(available), timestamp: Date.now()
    });
  });
  emitEvent('balancesUpdated', Object.fromEntries(GLOBAL_WS_STATE.balances));
}

function handleBalanceUpdate(data) {
  data.forEach(balance => {
    const { asset, balance: amount, available } = balance;
    const normalized = normalizeKrakenSymbol(asset);
    GLOBAL_WS_STATE.balances.set(normalized, {
      asset: normalized, balance: parseFloat(amount), available: parseFloat(available), timestamp: Date.now()
    });
  });
  emitEvent('balancesUpdated', Object.fromEntries(GLOBAL_WS_STATE.balances));
}

function handleOrderSnapshot(data) {
  GLOBAL_WS_STATE.orders.clear();
  data.forEach(order => {
    // CRITICAL: Normalize symbol in order
    const normalizedOrder = {
      ...order,
      symbol: normalizeKrakenSymbol(order.symbol)
    };
    GLOBAL_WS_STATE.orders.set(order.order_id, normalizedOrder);
  });
  emitEvent('ordersUpdated', Object.fromEntries(GLOBAL_WS_STATE.orders));
}

function handleOrderUpdate(data) {
  data.forEach(order => {
    const normalizedOrder = {
      ...order,
      symbol: normalizeKrakenSymbol(order.symbol)
    };
    
    if (order.status === 'closed' || order.status === 'canceled') {
      GLOBAL_WS_STATE.orders.delete(order.order_id);
    } else {
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
    // CRITICAL: Only connect once globally
    if (!GLOBAL_WS_STATE.isConnected && !GLOBAL_WS_STATE.isConnecting) {
      connectWebSocket();
    }
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

  const subscribeToNewPrices = useCallback((symbols) => {
    if (!isConnected || !symbols || symbols.length === 0) return;
    subscribe('ticker', { symbol: symbols });
  }, [isConnected]);

  return {
    isConnected,
    prices,
    balances,
    orders,
    lastExecution,
    subscribe: useCallback((channel, params) => subscribe(channel, params), []),
    unsubscribe: useCallback((channel, params) => unsubscribe(channel, params), []),
    subscribeToPrices: subscribeToNewPrices,
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
  GLOBAL_WS_STATE.tokenExpiry = null;
  GLOBAL_WS_STATE.prices.clear();
  GLOBAL_WS_STATE.balances.clear();
  GLOBAL_WS_STATE.orders.clear();
  GLOBAL_WS_STATE.executions = [];
  GLOBAL_WS_STATE.activeSubscriptions.clear();
  GLOBAL_WS_STATE.eventListeners.clear();
  GLOBAL_WS_STATE.pendingSubscriptions = [];
}