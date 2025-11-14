
import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Kraken WebSocket Hook
 * Manages real-time price updates via WebSocket connection
 * FIXED: Prevents sending messages before connection is ready
 */

// Global WebSocket state - shared across all instances
const globalWS = {
  connection: null,
  subscribers: new Set(),
  priceData: new Map(),
  isConnected: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,
  reconnectTimeout: null,
  messageQueue: [], // Queue for messages to send once connected
  lastLogTime: 0 // FIXED: Throttle logs to prevent spam
};

export function useKrakenWebSocket(symbols = [], enabled = false) {
  const [prices, setPrices] = useState({});
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const subscriberIdRef = useRef(Symbol());
  const requestedSymbolsRef = useRef(new Set());

  // FIXED: Throttled logging (max once per 10 seconds)
  const throttledLog = useCallback((message, ...args) => {
    const now = Date.now();
    // Only log if 10 seconds have passed or if it's an important, immediate log (like connection status)
    // For specific messages, we might want to log immediately (e.g., initial connect/disconnect).
    // For this implementation, we'll follow the outline and apply a blanket throttle.
    if (now - globalWS.lastLogTime > 10000 || !message.includes('Sent') && !message.includes('Not ready')) {
      console.log(message, ...args);
      globalWS.lastLogTime = now;
    }
    // Override: Always log crucial connection events immediately.
    if (message.includes('Connected') || message.includes('Disconnected') || message.includes('error')) {
      console.log(message, ...args);
    }
  }, []);

  // Helper to check if WebSocket is ready
  const isWebSocketReady = useCallback(() => {
    return globalWS.connection && 
           globalWS.connection.readyState === WebSocket.OPEN && 
           globalWS.isConnected;
  }, []);

  // Send message (with queue support)
  const sendMessage = useCallback((message) => {
    if (isWebSocketReady()) {
      try {
        globalWS.connection.send(JSON.stringify(message));
        throttledLog('[KrakenWS] ✅ Sent:', message.action, message.symbols);
      } catch (err) {
        console.error('[KrakenWS] Send error:', err);
        // Add to queue if send fails
        globalWS.messageQueue.push(message);
      }
    } else {
      throttledLog('[KrakenWS] Not ready, queueing message:', message.action);
      globalWS.messageQueue.push(message);
    }
  }, [isWebSocketReady, throttledLog]);

  // Process queued messages
  const processQueue = useCallback(() => {
    if (!isWebSocketReady() || globalWS.messageQueue.length === 0) {
      return;
    }

    throttledLog('[KrakenWS] Processing', globalWS.messageQueue.length, 'queued messages');
    
    const queue = [...globalWS.messageQueue];
    globalWS.messageQueue = [];
    
    queue.forEach(message => {
      try {
        globalWS.connection.send(JSON.stringify(message));
        // No throttledLog here, as it's part of a batch process and sendMessage already logs.
        // If needed, could add a specific log for queued messages.
      } catch (err) {
        console.error('[KrakenWS] Failed to send queued message:', err);
      }
    });
  }, [isWebSocketReady, throttledLog]);

  // Initialize WebSocket connection
  const connect = useCallback(async () => {
    if (globalWS.connection) {
      // Check if existing connection is usable
      if (globalWS.connection.readyState === WebSocket.OPEN) {
        throttledLog('[KrakenWS] Already connected');
        return;
      } else if (globalWS.connection.readyState === WebSocket.CONNECTING) {
        throttledLog('[KrakenWS] Connection in progress, waiting...');
        return;
      } else {
        // Close dead connection
        throttledLog('[KrakenWS] Closing dead connection');
        globalWS.connection.close();
        globalWS.connection = null;
      }
    }

    try {
      throttledLog('[KrakenWS] Getting WebSocket URL...');
      
      // Get WebSocket URL from backend
      const response = await base44.functions.invoke('krakenApi', {
        action: 'getWebSocketUrl'
      });

      const wsUrl = response?.data?.wsUrl || response?.wsUrl;
      
      if (!wsUrl) {
        throw new Error('No WebSocket URL received');
      }

      throttledLog('[KrakenWS] Connecting to:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      globalWS.connection = ws;

      ws.onopen = () => {
        console.log('[KrakenWS] ✅ Connected'); // Always log this important event
        globalWS.isConnected = true;
        globalWS.reconnectAttempts = 0;
        setIsConnected(true);
        setError(null);
        
        // Notify all subscribers
        globalWS.subscribers.forEach(callback => {
          callback({ type: 'connected' });
        });

        // Process any queued messages
        setTimeout(() => {
          processQueue();
        }, 100); // Small delay to ensure connection is fully ready
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle price updates
          if (data.type === 'price') {
            const { symbol, price, change_24h } = data;
            
            globalWS.priceData.set(symbol, {
              symbol,
              price,
              change_24h,
              timestamp: Date.now()
            });
            
            // Notify all subscribers
            globalWS.subscribers.forEach(callback => {
              callback({ type: 'price', data });
            });
          }
          
          // Handle subscription confirmations
          if (data.type === 'subscribed') {
            throttledLog('[KrakenWS] Subscribed to:', data.symbols);
          }
          
        } catch (err) {
          console.error('[KrakenWS] Message parse error:', err);
        }
      };

      ws.onerror = (errorEvent) => {
        // FIXED: Only log once to prevent spam
        // WebSocket onerror receives an Event object, not an Error
        // Log the event details if available
        if (errorEvent && errorEvent.type) {
          throttledLog('[KrakenWS] Connection error (type:', errorEvent.type, ')');
        } else {
          throttledLog('[KrakenWS] Connection error');
        }
        
        setError('WebSocket connection error');
        
        // Don't close here - let onclose handle it
      };

      ws.onclose = () => {
        // FIXED: Only log disconnect once
        console.log('[KrakenWS] Disconnected'); // Always log this important event
        globalWS.isConnected = false;
        globalWS.connection = null;
        setIsConnected(false);
        
        // Notify all subscribers
        globalWS.subscribers.forEach(callback => {
          callback({ type: 'disconnected' });
        });
        
        // FIXED: More aggressive reconnection with longer delays
        if (globalWS.subscribers.size > 0 && globalWS.reconnectAttempts < globalWS.maxReconnectAttempts) {
          globalWS.reconnectAttempts++;
          const delay = Math.min(2000 * Math.pow(1.5, globalWS.reconnectAttempts), 60000); // Start at 2s, 1.5x backoff, max 60s
          
          throttledLog(`[KrakenWS] Reconnecting in ${delay}ms (attempt ${globalWS.reconnectAttempts})`);
          
          globalWS.reconnectTimeout = setTimeout(() => {
            if (globalWS.subscribers.size > 0) {
              connect();
            }
          }, delay);
        } else if (globalWS.reconnectAttempts >= globalWS.maxReconnectAttempts) {
          setError('Maximum reconnection attempts reached');
        }
      };

    } catch (err) {
      console.error('[KrakenWS] Connect error:', err);
      setError(err.message);
      globalWS.connection = null;
      globalWS.isConnected = false;
    }
  }, [processQueue, throttledLog]);

  // Subscribe to symbols
  const subscribe = useCallback((symbolsToSubscribe) => {
    if (!symbolsToSubscribe || symbolsToSubscribe.length === 0) {
      return;
    }

    const newSymbols = symbolsToSubscribe.filter(
      sym => !requestedSymbolsRef.current.has(sym)
    );

    if (newSymbols.length === 0) {
      return;
    }

    throttledLog('[KrakenWS] Subscribing to:', newSymbols);
    
    // Use sendMessage which handles queueing
    sendMessage({
      action: 'subscribe',
      symbols: newSymbols
    });

    newSymbols.forEach(sym => requestedSymbolsRef.current.add(sym));
  }, [sendMessage, throttledLog]);

  // Unsubscribe from symbols
  const unsubscribe = useCallback((symbolsToUnsubscribe) => {
    if (!symbolsToUnsubscribe || symbolsToUnsubscribe.length === 0) {
      return;
    }

    throttledLog('[KrakenWS] Unsubscribing from:', symbolsToUnsubscribe);
    
    sendMessage({
      action: 'unsubscribe',
      symbols: symbolsToUnsubscribe
    });

    symbolsToUnsubscribe.forEach(sym => requestedSymbolsRef.current.delete(sym));
  }, [sendMessage, throttledLog]);

  // Subscribe to updates
  useEffect(() => {
    // subscriberIdRef.current is not used here but kept for consistency if future needs arise.
    // const subscriberId = subscriberIdRef.current; 
    
    const handleUpdate = (message) => {
      if (message.type === 'price') {
        setPrices(prev => ({
          ...prev,
          [message.data.symbol]: message.data
        }));
      } else if (message.type === 'connected') {
        setIsConnected(true);
        // Re-subscribe to symbols on connection
        if (symbols.length > 0) {
          // Wait a bit for connection to fully stabilize
          setTimeout(() => {
            subscribe(symbols);
          }, 200);
        }
      } else if (message.type === 'disconnected') {
        setIsConnected(false);
      }
    };
    
    globalWS.subscribers.add(handleUpdate);
    
    return () => {
      globalWS.subscribers.delete(handleUpdate);
    };
  }, [symbols, subscribe]);

  // Connect and subscribe on mount
  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Check if we need to connect
    const needsConnection = !globalWS.connection || 
                           globalWS.connection.readyState === WebSocket.CLOSED ||
                           globalWS.connection.readyState === WebSocket.CLOSING;

    if (needsConnection) {
      throttledLog('[KrakenWS] Initiating connection...');
      connect();
    } else if (globalWS.connection.readyState === WebSocket.OPEN && symbols.length > 0) {
      // Already connected, subscribe immediately
      throttledLog('[KrakenWS] Already connected, subscribing...');
      subscribe(symbols);
    } else if (globalWS.connection.readyState === WebSocket.CONNECTING && symbols.length > 0) {
      // Connection in progress, queue subscription
      throttledLog('[KrakenWS] Connection in progress, queueing subscription...');
      globalWS.messageQueue.push({
        action: 'subscribe',
        symbols: symbols
      });
    }

    // Cleanup: only disconnect if this is the last subscriber
    return () => {
      if (symbols.length > 0 && isWebSocketReady()) {
        unsubscribe(symbols);
      }
      
      // If no more subscribers, close connection after delay
      setTimeout(() => {
        if (globalWS.subscribers.size === 0 && globalWS.connection) {
          throttledLog('[KrakenWS] No more subscribers, closing connection');
          globalWS.connection.close();
          globalWS.connection = null;
          globalWS.isConnected = false;
          globalWS.messageQueue = [];
          // Clear any pending reconnect attempt if connection is explicitly closed
          if (globalWS.reconnectTimeout) {
            clearTimeout(globalWS.reconnectTimeout);
            globalWS.reconnectTimeout = null;
          }
          globalWS.reconnectAttempts = 0; // Reset reconnect attempts
        }
      }, 1000); // 1 second delay to allow for quick re-subscriptions
    };
  }, [enabled, symbols.join(','), connect, subscribe, unsubscribe, isWebSocketReady, throttledLog]);

  // Get current price for symbol
  const getPriceForSymbol = useCallback((symbol) => {
    return globalWS.priceData.get(symbol) || null;
  }, []);

  // Get all prices
  const getAllPrices = useCallback(() => {
    return Array.from(globalWS.priceData.values());
  }, []);

  return {
    prices,
    isConnected,
    error,
    connect,
    subscribe,
    unsubscribe,
    getPriceForSymbol,
    getAllPrices
  };
}

// Helper to check if WebSocket is available
export function isKrakenWebSocketAvailable() {
  return typeof WebSocket !== 'undefined';
}

// Helper to close global connection (for logout/cleanup)
export function closeKrakenWebSocket() {
  if (globalWS.connection) {
    console.log('[KrakenWS] Force closing global WebSocket connection');
    globalWS.connection.close();
    globalWS.connection = null;
    globalWS.isConnected = false;
  }
  if (globalWS.reconnectTimeout) {
    clearTimeout(globalWS.reconnectTimeout);
    globalWS.reconnectTimeout = null;
  }
  globalWS.priceData.clear();
  globalWS.subscribers.clear();
  globalWS.reconnectAttempts = 0;
  globalWS.messageQueue = [];
  globalWS.lastLogTime = 0; // Reset log throttle
}
