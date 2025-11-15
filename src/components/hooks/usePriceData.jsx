import { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useKrakenWebSocket } from './useKrakenWebSocket';
import { useSettings } from '../utils/SettingsContext';

/**
 * Centralized price data hook - FIXED VERSION
 * CRITICAL: Aggressive caching and deduplication to prevent excessive API calls
 */

// GLOBAL CACHE - shared across ALL component instances
const globalPriceCache = {
  data: null,
  timestamp: 0,
  pendingRequest: null,
  subscribers: new Set()
};

const CACHE_TTL = 120000; // INCREASED to 2 minutes
const MIN_REQUEST_INTERVAL = 5000; // Minimum 5 seconds between requests

let lastRequestTime = 0;

export function usePriceData(symbols = []) {
  const { settings } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  const [priceData, setPriceData] = useState(globalPriceCache.data || []);
  const [loading, setLoading] = useState(false);
  const subscriberIdRef = useRef(Symbol());

  const { 
    prices: wsPrices, 
    isConnected: wsConnected,
    getAllPrices: wsGetAllPrices 
  } = useKrakenWebSocket(symbols, !isSimMode && symbols.length > 0);

  const fetchPricesREST = useCallback(async (force = false) => {
    const now = Date.now();
    
    // CRITICAL: Rate limiting - prevent requests within 5 seconds
    if (!force && (now - lastRequestTime) < MIN_REQUEST_INTERVAL) {
      console.log('[usePriceData] Rate limited, using cache');
      return globalPriceCache.data || [];
    }
    
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
    lastRequestTime = now;

    try {
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

      const fetchPromise = Promise.race([
        base44.functions.invoke('getMarketData', {
          action: 'getWatchlistData',
          payload: { cryptoSymbols, stockSymbols }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000))
      ]).then(response => {
        const data = Array.isArray(response?.data) ? response.data : [];
        
        globalPriceCache.data = data;
        globalPriceCache.timestamp = Date.now();
        globalPriceCache.pendingRequest = null;
        
        globalPriceCache.subscribers.forEach(callback => callback(data));
        
        console.log('[usePriceData] Fetched', data.length, 'REST prices');
        return data;
      }).catch(error => {
        console.error('[usePriceData] REST Error:', error);
        globalPriceCache.pendingRequest = null;
        return globalPriceCache.data || [];
      });

      globalPriceCache.pendingRequest = fetchPromise;
      
      const data = await fetchPromise;
      setPriceData(data);
      return data;
      
    } finally {
      setLoading(false);
    }
  }, [symbols.join(',')]);

  const convertWSToREST = useCallback(() => {
    if (!wsPrices || Object.keys(wsPrices).length === 0) {
      return [];
    }
    
    return Object.values(wsPrices).map(ws => ({
      symbol: ws.symbol,
      price: ws.price,
      current_price: ws.price,
      change_24h_percent: ws.change_24h,
      price_change_percentage_24h: ws.change_24h
    }));
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

  // Main data fetching logic - DEBOUNCED
  const fetchTimeoutRef = useRef(null);
  useEffect(() => {
    if (!symbols || symbols.length === 0) {
      return;
    }

    // Clear existing timeout
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    if (isSimMode) {
      // DEBOUNCE: Wait 2 seconds before fetching
      fetchTimeoutRef.current = setTimeout(() => {
        fetchPricesREST();
      }, 2000);
    } else {
      // LIVE MODE: Use WebSocket
      const wsData = convertWSToREST();
      if (wsData.length > 0) {
        setPriceData(wsData);
      }
    }

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, [symbols.join(','), isSimMode, fetchPricesREST, convertWSToREST, wsConnected]);

  // Update when WebSocket prices change (LIVE mode only)
  useEffect(() => {
    if (!isSimMode && wsPrices && Object.keys(wsPrices).length > 0) {
      const wsData = convertWSToREST();
      setPriceData(wsData);
    }
  }, [isSimMode, wsPrices, convertWSToREST]);

  const refresh = useCallback(() => {
    if (isSimMode) {
      return fetchPricesREST(true);
    } else {
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

export function getPriceForSymbol(symbol) {
  if (!globalPriceCache.data) return null;
  return globalPriceCache.data.find(p => 
    (p.symbol || '').toUpperCase() === (symbol || '').toUpperCase()
  );
}

export function invalidatePriceCache() {
  console.log('[usePriceData] Invalidating price cache');
  globalPriceCache.data = null;
  globalPriceCache.timestamp = 0;
  globalPriceCache.pendingRequest = null;
  lastRequestTime = 0;
}