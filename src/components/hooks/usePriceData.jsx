import { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useKrakenWebSocket } from './useKrakenWebSocket';
import { useSettings } from '../utils/SettingsContext';

/**
 * CRITICAL FIX: Single global request manager - NO DUPLICATES
 */

const GLOBAL_REQUEST_MANAGER = {
  cache: new Map(),
  inflightRequest: null,
  lastRequestTime: 0,
  pendingSymbols: new Set(),
  subscribers: new Map(),
  requestTimer: null
};

const CACHE_TTL = 120000; // 2 minutes
const MIN_REQUEST_INTERVAL = 2000; // Minimum 2 seconds between requests

function notifySubscribers(data) {
  GLOBAL_REQUEST_MANAGER.subscribers.forEach((callback) => {
    callback(data);
  });
}

async function executeSingleRequest() {
  if (GLOBAL_REQUEST_MANAGER.inflightRequest) {
    console.log('[usePriceData] ⚠️ Request already in flight, waiting...');
    return GLOBAL_REQUEST_MANAGER.inflightRequest;
  }

  const symbols = Array.from(GLOBAL_REQUEST_MANAGER.pendingSymbols);
  GLOBAL_REQUEST_MANAGER.pendingSymbols.clear();

  if (symbols.length === 0) return;

  const now = Date.now();
  const timeSinceLastRequest = now - GLOBAL_REQUEST_MANAGER.lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`[usePriceData] ⏰ Waiting ${waitTime}ms before next request`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  console.log('[usePriceData] 🚀 SINGLE request for', symbols.length, 'symbols');
  GLOBAL_REQUEST_MANAGER.lastRequestTime = Date.now();

  const cryptoSymbols = [];
  const stockSymbols = [];

  symbols.forEach(sym => {
    const upper = sym.toUpperCase();
    if (['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'META', 'NVDA'].includes(upper)) {
      stockSymbols.push(upper);
    } else {
      cryptoSymbols.push(upper);
    }
  });

  const requestPromise = (async () => {
    try {
      const response = await Promise.race([
        base44.functions.invoke('getMarketData', {
          action: 'getWatchlistData',
          payload: { cryptoSymbols, stockSymbols }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000))
      ]);

      const data = Array.isArray(response?.data) ? response.data : [];
      
      // Cache ALL symbols
      const cacheTime = Date.now();
      data.forEach(item => {
        GLOBAL_REQUEST_MANAGER.cache.set(item.symbol, {
          data: item,
          timestamp: cacheTime
        });
      });
      
      // Also cache empty results for symbols that weren't found
      symbols.forEach(sym => {
        if (!data.find(d => d.symbol.toUpperCase() === sym.toUpperCase())) {
          GLOBAL_REQUEST_MANAGER.cache.set(sym, {
            data: null,
            timestamp: cacheTime
          });
        }
      });

      notifySubscribers(data);
      console.log('[usePriceData] ✅ Request complete:', data.length, 'prices');
      
      return data;
    } catch (error) {
      console.error('[usePriceData] ❌ Request error:', error.message);
      notifySubscribers([]);
      return [];
    } finally {
      GLOBAL_REQUEST_MANAGER.inflightRequest = null;
    }
  })();

  GLOBAL_REQUEST_MANAGER.inflightRequest = requestPromise;
  return requestPromise;
}

function scheduleRequest() {
  if (GLOBAL_REQUEST_MANAGER.requestTimer) {
    clearTimeout(GLOBAL_REQUEST_MANAGER.requestTimer);
  }

  GLOBAL_REQUEST_MANAGER.requestTimer = setTimeout(() => {
    executeSingleRequest();
  }, 100); // Very short delay to batch rapid calls
}

function requestPrices(symbols) {
  if (!symbols || symbols.length === 0) return;

  const now = Date.now();
  let needsFetch = false;

  symbols.forEach(symbol => {
    const cached = GLOBAL_REQUEST_MANAGER.cache.get(symbol);
    if (!cached || (now - cached.timestamp) > CACHE_TTL) {
      GLOBAL_REQUEST_MANAGER.pendingSymbols.add(symbol);
      needsFetch = true;
    }
  });

  if (needsFetch) {
    scheduleRequest();
  }
}

export function usePriceData(symbols = []) {
  const { settings } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  const [priceData, setPriceData] = useState([]);
  const [loading, setLoading] = useState(false);
  const subscriberIdRef = useRef(Symbol());

  const { 
    prices: wsPrices, 
    isConnected: wsConnected,
    getAllPrices: wsGetAllPrices 
  } = useKrakenWebSocket(symbols, !isSimMode && symbols.length > 0);

  const convertWSToREST = useCallback(() => {
    if (!wsPrices || Object.keys(wsPrices).length === 0) return [];
    
    return Object.values(wsPrices).map(ws => ({
      symbol: ws.symbol,
      price: ws.price,
      current_price: ws.price,
      change_24h_percent: ws.change_24h,
      price_change_percentage_24h: ws.change_24h
    }));
  }, [wsPrices]);

  // Subscribe to global updates (SIM MODE ONLY)
  useEffect(() => {
    if (!isSimMode || symbols.length === 0) return;

    const handleUpdate = (data) => {
      const filtered = data.filter(item => 
        symbols.some(s => s.toUpperCase() === (item.symbol || '').toUpperCase())
      );
      
      if (filtered.length > 0) {
        setPriceData(filtered);
        setLoading(false);
      }
    };

    const id = subscriberIdRef.current;
    GLOBAL_REQUEST_MANAGER.subscribers.set(id, handleUpdate);

    // Check cache immediately
    const cached = [];
    let allCached = true;
    const now = Date.now();

    symbols.forEach(symbol => {
      const entry = GLOBAL_REQUEST_MANAGER.cache.get(symbol);
      if (entry && (now - entry.timestamp) < CACHE_TTL && entry.data) {
        cached.push(entry.data);
      } else {
        allCached = false;
      }
    });

    if (cached.length > 0) {
      setPriceData(cached);
      setLoading(false);
    }

    if (!allCached) {
      setLoading(true);
      requestPrices(symbols);
    }

    return () => {
      GLOBAL_REQUEST_MANAGER.subscribers.delete(id);
    };
  }, [symbols.join(','), isSimMode]);

  // LIVE MODE: Use WebSocket
  useEffect(() => {
    if (!isSimMode && wsPrices && Object.keys(wsPrices).length > 0) {
      const wsData = convertWSToREST();
      setPriceData(wsData);
      setLoading(false);
    }
  }, [isSimMode, wsPrices, convertWSToREST]);

  const refresh = useCallback(() => {
    if (isSimMode) {
      // Clear cache for these symbols
      symbols.forEach(symbol => GLOBAL_REQUEST_MANAGER.cache.delete(symbol));
      setLoading(true);
      requestPrices(symbols);
      return Promise.resolve();
    } else {
      const wsData = convertWSToREST();
      setPriceData(wsData);
      return Promise.resolve(wsData);
    }
  }, [isSimMode, symbols, convertWSToREST]);

  return {
    priceData,
    loading: isSimMode ? loading : !wsConnected,
    refresh,
    isRealtime: !isSimMode && wsConnected
  };
}

export function invalidatePriceCache() {
  console.log('[usePriceData] 🗑️ Clearing ALL cache');
  GLOBAL_REQUEST_MANAGER.cache.clear();
  GLOBAL_REQUEST_MANAGER.pendingSymbols.clear();
  if (GLOBAL_REQUEST_MANAGER.requestTimer) {
    clearTimeout(GLOBAL_REQUEST_MANAGER.requestTimer);
    GLOBAL_REQUEST_MANAGER.requestTimer = null;
  }
}