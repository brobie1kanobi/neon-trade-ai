import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * CENTRALIZED KRAKEN WEBSOCKET MANAGER - V2 API COMPLIANT
 * 
 * Based on official Kraken docs:
 * - wss://ws.kraken.com/v2 (public - tickers)
 * - wss://ws-auth.kraken.com/v2 (private - balances, executions)
 * 
 * Channels:
 * - ticker: Real-time price data
 * - balances: Account balance snapshots and updates
 * - executions: Order fills and status updates
 */

// GLOBAL STATE - shared across ALL hooks
const GLOBAL_WS_STATE = {
  publicWs: null,
  privateWs: null,
  privateWsBalances: null,
  privateWsOrders: null,
  isPublicConnected: false,
  isPrivateConnected: false,
  isPrivateBalancesConnected: false,
  isPrivateOrdersConnected: false,
  token: null,
  tokenExpiry: 0,
  tokenTrade: null,
  tokenTradeExpiry: 0,
  tokenBalance: null,
  tokenBalanceExpiry: 0,
  reconnectAttempts: 0,
  
  // Data stores
  prices: new Map(),
  balances: new Map(),
  orders: new Map(),
  executions: [],
  
  // Subscription tracking
  activePublicSubs: new Set(),
  activePrivateSubs: new Set(),
  
  // Event emitter
  eventListeners: new Map()
};

const PUBLIC_WS_URL = 'wss://ws.kraken.com/v2';
const PRIVATE_WS_URL = 'wss://ws-auth.kraken.com/v2';
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 3000;
const TOKEN_REFRESH_BUFFER = 60000; // Refresh token 1 minute before expiry

/**
 * Emit custom events to all listeners
 */
function emitEvent(eventName, data) {
  const listeners = GLOBAL_WS_STATE.eventListeners.get(eventName) || [];
  listeners.forEach(callback => {
    try {
      callback(data);
    } catch (e) {
      // Silent error handling for production
    }
  });
}

/**
 * Get or refresh WebSocket token
 */
async function getWebSocketToken(keyType = 'trade') {
  const now = Date.now();
  
  // Return cached token if still valid
  const isTrade = keyType === 'trade';
  const cachedToken = isTrade ? GLOBAL_WS_STATE.tokenTrade : GLOBAL_WS_STATE.tokenBalance;
  const cachedExpiry = isTrade ? GLOBAL_WS_STATE.tokenTradeExpiry : GLOBAL_WS_STATE.tokenBalanceExpiry;
  if (cachedToken && now < (cachedExpiry || 0) - TOKEN_REFRESH_BUFFER) {
    return cachedToken;
  }

  try {
    const response = await base44.functions.invoke('krakenApi', { 
      action: 'getWebSocketUrl',
      payload: { keyType }
    });
    
    const data = response?.data || response;
    
    if (data?.success && data?.token) {
      if (keyType === 'trade') {
        GLOBAL_WS_STATE.tokenTrade = data.token;
        GLOBAL_WS_STATE.tokenTradeExpiry = now + (data.expires_in || 900) * 1000;
      } else {
        GLOBAL_WS_STATE.tokenBalance = data.token;
        GLOBAL_WS_STATE.tokenBalanceExpiry = now + (data.expires_in || 900) * 1000;
      }
      return data.token;
    }
    
    if (data?.connected === false) {
      throw new Error('Kraken account not connected');
    }
    
    throw new Error(data?.error || 'Failed to get WebSocket token');
  } catch (error) {
    throw error;
  }
}

/**
 * Connect to PUBLIC WebSocket (ticker/prices)
 */
function connectPublicWebSocket(priceSymbols = []) {
  if (GLOBAL_WS_STATE.publicWs && GLOBAL_WS_STATE.isPublicConnected) {
    // Already connected, just subscribe to new symbols
    if (priceSymbols.length > 0) {
      subscribeToTicker(priceSymbols);
    }
    return;
  }

  try {
    const ws = new WebSocket(PUBLIC_WS_URL);

    ws.onopen = () => {
      GLOBAL_WS_STATE.isPublicConnected = true;
      emitEvent('publicConnected', {});
      
      // Subscribe to prices if symbols provided
      if (priceSymbols.length > 0) {
        subscribeToTicker(priceSymbols);
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handlePublicMessage(message);
      } catch (e) {
        // Silent parse error
      }
    };

    ws.onerror = (error) => {
      emitEvent('error', { source: 'public', error });
    };

    ws.onclose = () => {
      GLOBAL_WS_STATE.isPublicConnected = false;
      GLOBAL_WS_STATE.publicWs = null;
      emitEvent('publicDisconnected', {});
      
      // Auto-reconnect
      if (GLOBAL_WS_STATE.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        GLOBAL_WS_STATE.reconnectAttempts++;
        setTimeout(() => connectPublicWebSocket(priceSymbols), RECONNECT_DELAY);
      }
    };

    GLOBAL_WS_STATE.publicWs = ws;

  } catch (error) {
    emitEvent('error', { source: 'public', error });
  }
}

/**
 * Connect to PRIVATE WebSocket (balances, executions)
 */
async function connectPrivateBalancesWebSocket() {
  if (GLOBAL_WS_STATE.privateWsBalances && GLOBAL_WS_STATE.isPrivateBalancesConnected) {
    return;
  }

  try {
    // Get fresh token using BALANCE key only (avoid consuming trade key rate limits)
    const token = await getWebSocketToken('balance');

    const ws = new WebSocket(PRIVATE_WS_URL);

    ws.onopen = () => {
      GLOBAL_WS_STATE.isPrivateBalancesConnected = true;
      emitEvent('privateConnected', {});
      
      // Subscribe to balances only (balance key)
      subscribeToBalances(ws, token);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handlePrivateMessage(message);
      } catch (e) {
        // Silent parse error
      }
    };

    ws.onerror = (error) => {
      emitEvent('error', { source: 'private', error });
    };

    ws.onclose = () => {
      GLOBAL_WS_STATE.isPrivateBalancesConnected = false;
      GLOBAL_WS_STATE.privateWsBalances = null;
      emitEvent('privateDisconnected', {});
      
      if (GLOBAL_WS_STATE.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        GLOBAL_WS_STATE.reconnectAttempts++;
        setTimeout(() => connectPrivateBalancesWebSocket(), RECONNECT_DELAY);
      }
    };

    GLOBAL_WS_STATE.privateWsBalances = ws;

  } catch (error) {
    if (error.message && error.message.includes('not connected')) {
      emitEvent('error', { message: 'Kraken account not connected', fatal: true });
      return;
    }
    
    if (GLOBAL_WS_STATE.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      GLOBAL_WS_STATE.reconnectAttempts++;
      setTimeout(() => connectPrivateBalancesWebSocket(), RECONNECT_DELAY);
    }
  }
}

/**
 * Subscribe to ticker channel (prices)
 * Format per Kraken v2 docs
 */
async function connectPrivateOrdersWebSocket() {
  if (GLOBAL_WS_STATE.privateWsOrders && GLOBAL_WS_STATE.isPrivateOrdersConnected) {
    return;
  }
  try {
    const token = await getWebSocketToken('trade');
    const ws = new WebSocket(PRIVATE_WS_URL);
    ws.onopen = () => {
      GLOBAL_WS_STATE.isPrivateOrdersConnected = true;
      emitEvent('privateConnected', {});
      // Subscribe to executions only (trade key)
      subscribeToExecutions(ws, token);
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handlePrivateMessage(message);
      } catch (e) {
        // Silent parse error
      }
    };
    ws.onerror = (error) => {
      emitEvent('error', { source: 'private-orders', error });
    };
    ws.onclose = () => {
      GLOBAL_WS_STATE.isPrivateOrdersConnected = false;
      GLOBAL_WS_STATE.privateWsOrders = null;
      emitEvent('privateDisconnected', {});
      if (GLOBAL_WS_STATE.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        GLOBAL_WS_STATE.reconnectAttempts++;
        setTimeout(() => connectPrivateOrdersWebSocket(), RECONNECT_DELAY);
      }
    };
    GLOBAL_WS_STATE.privateWsOrders = ws;
  } catch (error) {
    if (GLOBAL_WS_STATE.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      GLOBAL_WS_STATE.reconnectAttempts++;
      setTimeout(() => connectPrivateOrdersWebSocket(), RECONNECT_DELAY);
    }
  }
}

function subscribeToTicker(symbols) {
  const ws = GLOBAL_WS_STATE.publicWs;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const subscription = {
    method: 'subscribe',
    params: {
      channel: 'ticker',
      symbol: symbols
    }
  };

  ws.send(JSON.stringify(subscription));
  GLOBAL_WS_STATE.activePublicSubs.add(JSON.stringify({ channel: 'ticker', symbols }));
}

/**
 * Subscribe to balances channel
 * Requires token per Kraken v2 docs
 */
function subscribeToBalances(ws, token) {
  if (!token) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const subscription = {
    method: 'subscribe',
    params: {
      channel: 'balances',
      token: token,
      snapshot: true
    }
  };

  ws.send(JSON.stringify(subscription));
  GLOBAL_WS_STATE.activePrivateSubs.add('balances');
}

/**
 * Subscribe to executions channel
 * Requires token per Kraken v2 docs
 */
function subscribeToExecutions(ws, token) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const subscription = {
    method: 'subscribe',
    params: {
      channel: 'executions',
      token: token,
      snap_orders: true,
      snap_trades: true
    }
  };

  ws.send(JSON.stringify(subscription));
  GLOBAL_WS_STATE.activePrivateSubs.add('executions');
}

/**
 * Handle PUBLIC WebSocket messages
 */
function handlePublicMessage(message) {
  const { channel, type, data } = message;

  // Handle subscription acknowledgments
  if (message.method === 'subscribe') {
    if (message.success) {
      // Subscription confirmed
    } else if (message.error) {
      emitEvent('error', { channel, error: message.error });
    }
    return;
  }

  // Handle ticker updates
  if (channel === 'ticker') {
    if (type === 'update' && Array.isArray(data)) {
      data.forEach(ticker => {
        const { symbol, last, bid, ask, change, change_pct, volume } = ticker;
        
        GLOBAL_WS_STATE.prices.set(symbol, {
          symbol,
          price: parseFloat(last) || 0,
          bid: parseFloat(bid) || 0,
          ask: parseFloat(ask) || 0,
          change_24h: parseFloat(change_pct) || 0,
          volume_24h: parseFloat(volume) || 0,
          timestamp: Date.now()
        });
      });
      
      emitEvent('pricesUpdated', Object.fromEntries(GLOBAL_WS_STATE.prices));
    }
  }
}

/**
 * Handle PRIVATE WebSocket messages
 */
function handlePrivateMessage(message) {
  const { channel, type, data } = message;

  // Handle subscription acknowledgments
  if (message.method === 'subscribe') {
    if (message.success) {
      // Subscription confirmed
    } else if (message.error) {
      emitEvent('error', { channel, error: message.error });
    }
    return;
  }

  // Handle balances
  if (channel === 'balances') {
    if (type === 'snapshot' && Array.isArray(data)) {
      // CRITICAL: Parse balance snapshot per Kraken v2 WebSocket format
      // The WebSocket returns balance objects with asset, balance (available), and wallets
      // NOTE: WebSocket "balance" field is AVAILABLE only, NOT total
      // For total balance including locked, we must use REST API (BalanceEx)
      data.forEach(balanceItem => {
        const { asset, balance: availableBalance, wallets } = balanceItem;
        
        // WebSocket balance = available only (NOT including locked in orders)
        // This is DIFFERENT from REST API BalanceEx which has "total" field
        let available = parseFloat(availableBalance) || 0;
        
        // For WebSocket, we only get available balance
        // DO NOT use this as total - it will undercount assets in pending orders
        GLOBAL_WS_STATE.balances.set(asset, {
          asset,
          balance: available,  // WebSocket only gives available
          available: available,
          timestamp: Date.now()
        });
      });
      
      emitEvent('balancesUpdated', Object.fromEntries(GLOBAL_WS_STATE.balances));
    } else if (type === 'update' && Array.isArray(data)) {
      // CRITICAL: Handle balance updates (trades, deposits, withdrawals)
      data.forEach(update => {
        const { asset, balance: newBalance } = update;
        
        GLOBAL_WS_STATE.balances.set(asset, {
          asset,
          balance: parseFloat(newBalance) || 0,
          available: parseFloat(newBalance) || 0,
          timestamp: Date.now()
        });
      });
      
      emitEvent('balancesUpdated', Object.fromEntries(GLOBAL_WS_STATE.balances));
    }
  }

  // Handle executions (order fills and status)
  if (channel === 'executions') {
    if ((type === 'snapshot' || type === 'update') && Array.isArray(data)) {
      data.forEach(execution => {
        const { exec_type, order_id, exec_id, symbol, side, order_qty, cum_qty, avg_price, last_qty, last_price } = execution;
        
        // Track orders
        if (order_id) {
          if (exec_type === 'filled' || exec_type === 'canceled' || exec_type === 'expired') {
            GLOBAL_WS_STATE.orders.delete(order_id);
            
            // CRITICAL: When an order is filled/canceled/expired, emit event for bracket order cleanup
            if (exec_type === 'filled') {
              const filledData = {
                order_id,
                symbol,
                side,
                quantity: cum_qty || order_qty,
                price: avg_price || last_price,
                exec_type,
                timestamp: Date.now()
              };
              emitEvent('orderFilled', filledData);
              
              // CRITICAL: Dispatch window event for useBracketOrderSync hook
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('kraken:order-filled', { detail: filledData }));
              }
            } else if (exec_type === 'canceled' || exec_type === 'expired') {
              const canceledData = {
                order_id,
                symbol,
                side,
                exec_type,
                timestamp: Date.now()
              };
              emitEvent('orderCanceled', canceledData);
              
              // CRITICAL: Dispatch window event for useBracketOrderSync hook
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('kraken:order-canceled', { detail: canceledData }));
              }
            }
          } else {
            GLOBAL_WS_STATE.orders.set(order_id, {
              order_id,
              symbol,
              side,
              order_qty,
              filled_qty: cum_qty || 0,
              avg_price: avg_price || 0,
              status: exec_type,
              timestamp: Date.now()
            });
          }
        }
        
        // Track executions (fills)
        if (exec_type === 'trade' || exec_type === 'filled') {
          const executionRecord = {
            exec_id,
            order_id,
            symbol,
            side,
            quantity: last_qty || cum_qty || order_qty,
            price: last_price || avg_price,
            exec_type,
            timestamp: Date.now()
          };
          
          GLOBAL_WS_STATE.executions.push(executionRecord);
          
          // Keep only last 100 executions
          if (GLOBAL_WS_STATE.executions.length > 100) {
            GLOBAL_WS_STATE.executions.shift();
          }
          
          emitEvent('executionReceived', [executionRecord]);
        }
      });
      
      emitEvent('ordersUpdated', Object.fromEntries(GLOBAL_WS_STATE.orders));
    }
  }
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

  const [isConnected, setIsConnected] = useState(
    GLOBAL_WS_STATE.isPublicConnected || GLOBAL_WS_STATE.isPrivateBalancesConnected || GLOBAL_WS_STATE.isPrivateOrdersConnected
  );
  const [prices, setPrices] = useState({});
  const [balances, setBalances] = useState({});
  const [orders, setOrders] = useState({});
  const [lastExecution, setLastExecution] = useState(null);

  const subscriberIdRef = useRef(Symbol());
  const connectAttemptedRef = useRef(false);

  // Connect on mount
  useEffect(() => {
    if (connectAttemptedRef.current) return;
    connectAttemptedRef.current = true;

    // Connect to public WebSocket if price subscription requested
    if (subscribeToPrices) {
      connectPublicWebSocket(priceSymbols);
    }

    // Connect to private WebSocket if any private subscription requested
    if (subscribeToBalances) {
      connectPrivateBalancesWebSocket();
    }
    if (subscribeToExecutions) {
      connectPrivateOrdersWebSocket();
    }
  }, []);

  // Handle connection state changes
  useEffect(() => {
    const handlePublicConnected = () => {
      setIsConnected(true);
      GLOBAL_WS_STATE.reconnectAttempts = 0;
    };
    
    const handlePrivateConnected = () => {
      setIsConnected(true);
      GLOBAL_WS_STATE.reconnectAttempts = 0;
    };
    
    const handlePublicDisconnected = () => {
      if (!GLOBAL_WS_STATE.isPrivateBalancesConnected && !GLOBAL_WS_STATE.isPrivateOrdersConnected) {
        setIsConnected(false);
      }
    };
    
    const handlePrivateDisconnected = () => {
      if (!GLOBAL_WS_STATE.isPublicConnected && !GLOBAL_WS_STATE.isPrivateBalancesConnected && !GLOBAL_WS_STATE.isPrivateOrdersConnected) {
        setIsConnected(false);
      }
    };

    // Add listeners
    const addListener = (event, handler) => {
      const listeners = GLOBAL_WS_STATE.eventListeners.get(event) || [];
      GLOBAL_WS_STATE.eventListeners.set(event, [...listeners, handler]);
    };

    addListener('publicConnected', handlePublicConnected);
    addListener('privateConnected', handlePrivateConnected);
    addListener('publicDisconnected', handlePublicDisconnected);
    addListener('privateDisconnected', handlePrivateDisconnected);

    return () => {
      // Cleanup listeners
      const removeListener = (event, handler) => {
        const listeners = GLOBAL_WS_STATE.eventListeners.get(event) || [];
        GLOBAL_WS_STATE.eventListeners.set(event, listeners.filter(cb => cb !== handler));
      };

      removeListener('publicConnected', handlePublicConnected);
      removeListener('privateConnected', handlePrivateConnected);
      removeListener('publicDisconnected', handlePublicDisconnected);
      removeListener('privateDisconnected', handlePrivateDisconnected);
    };
  }, []);

  // Subscribe to price updates
  useEffect(() => {
    if (!subscribeToPrices) return;

    const handlePricesUpdated = (data) => {
      setPrices(data);
    };

    const listeners = GLOBAL_WS_STATE.eventListeners.get('pricesUpdated') || [];
    GLOBAL_WS_STATE.eventListeners.set('pricesUpdated', [...listeners, handlePricesUpdated]);

    // Subscribe to new symbols if already connected
    if (GLOBAL_WS_STATE.isPublicConnected && priceSymbols.length > 0) {
      subscribeToTicker(priceSymbols);
    }

    return () => {
      const currentListeners = GLOBAL_WS_STATE.eventListeners.get('pricesUpdated') || [];
      GLOBAL_WS_STATE.eventListeners.set('pricesUpdated', 
        currentListeners.filter(cb => cb !== handlePricesUpdated)
      );
    };
  }, [subscribeToPrices, priceSymbols.join(',')]);

  // Subscribe to balance updates
  useEffect(() => {
    if (!subscribeToBalances) return;

    const handleBalancesUpdated = (data) => {
      setBalances(data);
    };

    const listeners = GLOBAL_WS_STATE.eventListeners.get('balancesUpdated') || [];
    GLOBAL_WS_STATE.eventListeners.set('balancesUpdated', [...listeners, handleBalancesUpdated]);

    return () => {
      const currentListeners = GLOBAL_WS_STATE.eventListeners.get('balancesUpdated') || [];
      GLOBAL_WS_STATE.eventListeners.set('balancesUpdated', 
        currentListeners.filter(cb => cb !== handleBalancesUpdated)
      );
    };
  }, [subscribeToBalances]);

  // Subscribe to order updates
  useEffect(() => {
    if (!subscribeToOrders) return;

    const handleOrdersUpdated = (data) => {
      setOrders(data);
    };

    const listeners = GLOBAL_WS_STATE.eventListeners.get('ordersUpdated') || [];
    GLOBAL_WS_STATE.eventListeners.set('ordersUpdated', [...listeners, handleOrdersUpdated]);

    return () => {
      const currentListeners = GLOBAL_WS_STATE.eventListeners.get('ordersUpdated') || [];
      GLOBAL_WS_STATE.eventListeners.set('ordersUpdated', 
        currentListeners.filter(cb => cb !== handleOrdersUpdated)
      );
    };
  }, [subscribeToOrders]);

  // Subscribe to execution updates
  useEffect(() => {
    if (!subscribeToExecutions) return;

    const handleExecutionReceived = (data) => {
      setLastExecution(data[0] || null);
    };

    const listeners = GLOBAL_WS_STATE.eventListeners.get('executionReceived') || [];
    GLOBAL_WS_STATE.eventListeners.set('executionReceived', [...listeners, handleExecutionReceived]);

    return () => {
      const currentListeners = GLOBAL_WS_STATE.eventListeners.get('executionReceived') || [];
      GLOBAL_WS_STATE.eventListeners.set('executionReceived', 
        currentListeners.filter(cb => cb !== handleExecutionReceived)
      );
    };
  }, [subscribeToExecutions]);

  // Proactive token refresh + watchdog reconnect
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        // Refresh tokens and re-subscribe if private connections are alive
        if (GLOBAL_WS_STATE.isPrivateBalancesConnected && GLOBAL_WS_STATE.privateWsBalances?.readyState === WebSocket.OPEN) {
          const balToken = await getWebSocketToken('balance');
          subscribeToBalances(GLOBAL_WS_STATE.privateWsBalances, balToken);
        }
        if (GLOBAL_WS_STATE.isPrivateOrdersConnected && GLOBAL_WS_STATE.privateWsOrders?.readyState === WebSocket.OPEN) {
          const tradeToken = await getWebSocketToken('trade');
          subscribeToExecutions(GLOBAL_WS_STATE.privateWsOrders, tradeToken);
        }
      } catch {}
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      // If disconnected, try reconnecting automatically
      if (subscribeToPrices && !GLOBAL_WS_STATE.isPublicConnected) {
        connectPublicWebSocket(priceSymbols);
      }
      if (subscribeToBalances && !GLOBAL_WS_STATE.isPrivateBalancesConnected) {
        GLOBAL_WS_STATE.reconnectAttempts = 0;
        connectPrivateBalancesWebSocket();
      }
      if (subscribeToExecutions && !GLOBAL_WS_STATE.isPrivateOrdersConnected) {
        GLOBAL_WS_STATE.reconnectAttempts = 0;
        connectPrivateOrdersWebSocket();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [subscribeToPrices, subscribeToBalances, subscribeToOrders, subscribeToExecutions, priceSymbols.join(',')]);

  const refreshBalances = useCallback(async () => {
    try {
      if (!GLOBAL_WS_STATE.privateWsBalances || GLOBAL_WS_STATE.privateWsBalances.readyState !== WebSocket.OPEN) {
        await connectPrivateBalancesWebSocket();
      }
      let token;
      try { token = await getWebSocketToken('balance'); } catch (_e) { token = await getWebSocketToken('trade'); }
      if (GLOBAL_WS_STATE.privateWsBalances && token) {
        subscribeToBalances(GLOBAL_WS_STATE.privateWsBalances, token);
      }
    } catch (_) {}
  }, []);

  const refreshOrders = useCallback(async () => {
    try {
      if (!GLOBAL_WS_STATE.privateWsOrders || GLOBAL_WS_STATE.privateWsOrders.readyState !== WebSocket.OPEN) {
        await connectPrivateOrdersWebSocket();
      }
      const token = await getWebSocketToken('trade');
      if (GLOBAL_WS_STATE.privateWsOrders && token) {
        subscribeToExecutions(GLOBAL_WS_STATE.privateWsOrders, token);
      }
    } catch (_) {}
  }, []);

  return {
    isConnected,
    prices,
    balances,
    orders,
    lastExecution,
    
    // Manual subscription methods
    subscribe: useCallback((channel, params) => {
      if (channel === 'ticker' && GLOBAL_WS_STATE.publicWs) {
        subscribeToTicker(params?.symbols || []);
      }
    }, []),
    
    unsubscribe: useCallback((channel) => {
      // Unsubscribe logic if needed
    }, []),
    
    // Get current data
    getAllPrices: useCallback(() => Object.fromEntries(GLOBAL_WS_STATE.prices), []),
    getAllBalances: useCallback(() => Object.fromEntries(GLOBAL_WS_STATE.balances), []),
    getAllOrders: useCallback(() => Object.fromEntries(GLOBAL_WS_STATE.orders), []),
    refreshBalances,
    refreshOrders
  };
}

/**
 * Disconnect and cleanup
 */
export function disconnectKrakenWebSocket() {
  if (GLOBAL_WS_STATE.publicWs) {
    GLOBAL_WS_STATE.publicWs.close();
    GLOBAL_WS_STATE.publicWs = null;
  }
  
  if (GLOBAL_WS_STATE.privateWsBalances) {
    GLOBAL_WS_STATE.privateWsBalances.close();
    GLOBAL_WS_STATE.privateWsBalances = null;
  }
  if (GLOBAL_WS_STATE.privateWsOrders) {
    GLOBAL_WS_STATE.privateWsOrders.close();
    GLOBAL_WS_STATE.privateWsOrders = null;
  }
  
  GLOBAL_WS_STATE.isPublicConnected = false;
  GLOBAL_WS_STATE.isPrivateBalancesConnected = false;
  GLOBAL_WS_STATE.isPrivateOrdersConnected = false;
  GLOBAL_WS_STATE.tokenTrade = null;
  GLOBAL_WS_STATE.tokenTradeExpiry = 0;
  GLOBAL_WS_STATE.tokenBalance = null;
  GLOBAL_WS_STATE.tokenBalanceExpiry = 0;
  GLOBAL_WS_STATE.prices.clear();
  GLOBAL_WS_STATE.balances.clear();
  GLOBAL_WS_STATE.orders.clear();
  GLOBAL_WS_STATE.executions = [];
  GLOBAL_WS_STATE.activePublicSubs.clear();
  GLOBAL_WS_STATE.activePrivateSubs.clear();
  GLOBAL_WS_STATE.eventListeners.clear();
}