import { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useKrakenWebSocket } from '@/components/providers/KrakenWebSocketProvider';
import { useSettings } from '../utils/SettingsContext';

/**
 * Centralized price data hook - ARCHITECTURE COMPLIANT
 * 
 * LIVE MODE: WebSocket ONLY for real-time prices (no REST polling)
 * SIM MODE: REST API with caching (no WebSocket)
 * 
 * This hook NEVER polls REST for live prices in LIVE mode.
 */

// GLOBAL CACHE - shared across all component instances
const globalPriceCache = {
  data: null,
  timestamp: 0,
  pendingRequest: null,
  subscribers: new Set()
};

const CACHE_TTL = 60000; // 1 minute cache for REST API

export function usePriceData(symbols = []) {
  const { settings } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  const [priceData, setPriceData] = useState(globalPriceCache.data || []);
  const [loading, setLoading] = useState(false);
  const subscriberIdRef = useRef(Symbol());

  // WebSocket for LIVE mode - use SHARED provider (no args, no duplicate connections)
  const { 
    prices: wsPrices, 
    isConnected: wsConnected
  } = useKrakenWebSocket();

  // REST API fetch for SIM mode
  const fetchPricesREST = useCallback(async (force = false) => {
    const now = Date.now();
    
    // Return cached data if fresh
    if (!force && globalPriceCache.data && (now - globalPriceCache.timestamp) < CACHE_TTL) {
      console.log('[usePriceData] Using cached REST data');
      return globalPriceCache.data;
    }

    // If there's already a pending request, wait for it
    if (globalPriceCache.pendingRequest) {
      console.log('[usePriceData] Waiting for pending REST request');
      return globalPriceCache.pendingRequest;
    }

    // No symbols? Return empty
    if (!symbols || symbols.length === 0) {
      return [];
    }

    console.log('[usePriceData] Fetching REST prices for', symbols.length, 'symbols');
    setLoading(true);

    try {
      // Separate crypto and stocks
      const cryptoSymbols = [];
      const stockSymbols = [];
      
      symbols.forEach(sym => {
        if (sym && typeof sym === 'string') {
          const upper = sym.toUpperCase();
          if (['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'META', 'NVDA'].includes(upper)) {
            stockSymbols.push(upper);
          } else {
            cryptoSymbols.push(upper);
          }
        }
      });

      // Create the fetch promise with 10-second timeout
      const fetchPromise = Promise.race([
        base44.functions.invoke('getMarketData', {
          action: 'getWatchlistData',
          payload: { cryptoSymbols, stockSymbols }
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Price fetch timeout')), 10000)
        )
      ]).then(response => {
        const data = Array.isArray(response?.data) ? response.data : [];
        
        // Update global cache
        globalPriceCache.data = data;
        globalPriceCache.timestamp = Date.now();
        globalPriceCache.pendingRequest = null;
        
        // Notify all subscribers
        globalPriceCache.subscribers.forEach(callback => callback(data));
        
        console.log('[usePriceData] Fetched', data.length, 'REST prices');
        return data;
      }).catch(error => {
        console.error('[usePriceData] REST Error:', error);
        globalPriceCache.pendingRequest = null;
        
        // Return stale cache on error if available
        if (globalPriceCache.data) {
          console.log('[usePriceData] Using stale cache due to error');
          return globalPriceCache.data;
        }
        return [];
      });

      // Store pending request
      globalPriceCache.pendingRequest = fetchPromise;
      
      const data = await fetchPromise;
      setPriceData(data);
      return data;
      
    } finally {
      setLoading(false);
    }
  }, [symbols.join(',')]);

  // Convert WebSocket prices to REST format
  // Provider prices are keyed like 'BTC/USD' -> { price, symbol, change_24h }
  const convertWSToREST = useCallback(() => {
    if (!wsPrices || Object.keys(wsPrices).length === 0) {
      return [];
    }
    
    return Object.entries(wsPrices).map(([pair, ws]) => {
      // Extract base symbol from pair (e.g., 'BTC/USD' -> 'BTC')
      const baseSymbol = pair.includes('/') ? pair.split('/')[0] : (ws.symbol || pair);
      return {
        symbol: baseSymbol,
        price: ws.price,
        current_price: ws.price,
        change_24h_percent: ws.change_24h,
        price_change_percentage_24h: ws.change_24h
      };
    });
  }, [wsPrices]);

  // Subscribe to global REST updates (for SIM mode)
  useEffect(() => {
    if (isSimMode) {
      const handleUpdate = (data) => {
        setPriceData(data);
      };
      
      globalPriceCache.subscribers.add(handleUpdate);
      
      return () => {
        globalPriceCache.subscribers.delete(handleUpdate);
      };
    }
  }, [isSimMode]);

  // Main data fetching logic
  useEffect(() => {
    if (!symbols || symbols.length === 0) {
      return;
    }

    if (isSimMode) {
      // SIM MODE: Use REST API with caching
      fetchPricesREST();
    } else {
      // LIVE MODE: WebSocket ONLY - NO REST POLLING
      // Prices come from WebSocket updates, not fetches
      console.log('[usePriceData] LIVE mode - WebSocket active, no REST polling');
      
      // Use current WebSocket data if available
      const wsData = convertWSToREST();
      if (wsData.length > 0) {
        setPriceData(wsData);
      }
      // If no WS data yet, wait for WebSocket to connect and push updates
    }
  }, [symbols.join(','), isSimMode, fetchPricesREST, convertWSToREST]);

  // Update when WebSocket prices change (LIVE mode only)
  useEffect(() => {
    if (!isSimMode && wsPrices && Object.keys(wsPrices).length > 0) {
      const wsData = convertWSToREST();
      setPriceData(wsData);
      console.log('[usePriceData] WebSocket update:', Object.keys(wsPrices).length, 'symbols');
    }
  }, [isSimMode, wsPrices, convertWSToREST]);

  const refresh = useCallback(() => {
    if (isSimMode) {
      return fetchPricesREST(true);
    } else {
      // For WebSocket, just convert current prices
      const wsData = convertWSToREST();
      setPriceData(wsData);
      return Promise.resolve(wsData);
    }
  }, [isSimMode, fetchPricesREST, convertWSToREST]);

  return {
    priceData,
    loading: isSimMode ? loading : !wsConnected,
    refresh,
    isRealtime: !isSimMode && wsConnected
  };
}

// Helper function to get price for specific symbol
export function getPriceForSymbol(symbol) {
  if (!globalPriceCache.data) return null;
  return globalPriceCache.data.find(p => 
    (p.symbol || '').toUpperCase() === (symbol || '').toUpperCase()
  );
}

// Helper to invalidate cache (call after Kraken sync)
export function invalidatePriceCache() {
  console.log('[usePriceData] Invalidating price cache');
  globalPriceCache.data = null;
  globalPriceCache.timestamp = 0;
  globalPriceCache.pendingRequest = null;
}