import { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useKrakenWebSocket } from './useKrakenWebSocket';
import { useSettings } from '../utils/SettingsContext';

/**
 * FIXED: Global request batching to prevent duplicate calls
 */

// GLOBAL STATE - shared across ALL instances
const GLOBAL_STATE = {
  cache: new Map(),
  pendingBatch: null,
  batchTimer: null,
  symbolQueue: new Set(),
  subscribers: new Map()
};

const CACHE_TTL = 120000; // 2 minutes
const BATCH_DELAY = 500; // Wait 500ms to collect all symbol requests

function notifySubscribers(symbols, data) {
  symbols.forEach(symbol => {
    const subs = GLOBAL_STATE.subscribers.get(symbol) || new Set();
    subs.forEach(callback => callback(data));
  });
}

async function executeBatch() {
  if (GLOBAL_STATE.symbolQueue.size === 0) return;
  
  const symbols = Array.from(GLOBAL_STATE.symbolQueue);
  GLOBAL_STATE.symbolQueue.clear();
  
  console.log('[usePriceData] Executing batch for', symbols.length, 'symbols');
  
  try {
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
    
    const response = await Promise.race([
      base44.functions.invoke('getMarketData', {
        action: 'getWatchlistData',
        payload: { cryptoSymbols, stockSymbols }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Batch timeout')), 8000))
    ]);
    
    const data = Array.isArray(response?.data) ? response.data : [];
    
    // Cache individual symbols
    const now = Date.now();
    data.forEach(item => {
      GLOBAL_STATE.cache.set(item.symbol, {
        data: item,
        timestamp: now
      });
    });
    
    // Notify all subscribers
    notifySubscribers(symbols, data);
    
    console.log('[usePriceData] Batch complete:', data.length, 'prices');
    
  } catch (error) {
    console.error('[usePriceData] Batch error:', error.message);
    notifySubscribers(symbols, []);
  } finally {
    GLOBAL_STATE.pendingBatch = null;
  }
}

function scheduleBatch() {
  if (GLOBAL_STATE.batchTimer) {
    clearTimeout(GLOBAL_STATE.batchTimer);
  }
  
  GLOBAL_STATE.batchTimer = setTimeout(() => {
    executeBatch();
  }, BATCH_DELAY);
}

function requestSymbols(symbols) {
  if (!symbols || symbols.length === 0) return;
  
  let needsRefetch = false;
  const now = Date.now();
  
  symbols.forEach(symbol => {
    const cached = GLOBAL_STATE.cache.get(symbol);
    if (!cached || (now - cached.timestamp) > CACHE_TTL) {
      GLOBAL_STATE.symbolQueue.add(symbol);
      needsRefetch = true;
    }
  });
  
  if (needsRefetch) {
    scheduleBatch();
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

  // Subscribe to updates for specific symbols
  useEffect(() => {
    if (!isSimMode || symbols.length === 0) return;
    
    const id = subscriberIdRef.current;
    
    const handleUpdate = (data) => {
      const filtered = data.filter(item => 
        symbols.some(s => s.toUpperCase() === (item.symbol || '').toUpperCase())
      );
      setPriceData(filtered);
      setLoading(false);
    };
    
    symbols.forEach(symbol => {
      if (!GLOBAL_STATE.subscribers.has(symbol)) {
        GLOBAL_STATE.subscribers.set(symbol, new Set());
      }
      GLOBAL_STATE.subscribers.get(symbol).add(handleUpdate);
    });
    
    // Check if we have cached data
    const now = Date.now();
    const cachedData = [];
    let needsFetch = false;
    
    symbols.forEach(symbol => {
      const cached = GLOBAL_STATE.cache.get(symbol);
      if (cached && (now - cached.timestamp) < CACHE_TTL) {
        cachedData.push(cached.data);
      } else {
        needsFetch = true;
      }
    });
    
    if (cachedData.length > 0) {
      setPriceData(cachedData);
      setLoading(false);
    }
    
    if (needsFetch) {
      setLoading(true);
      requestSymbols(symbols);
    }
    
    return () => {
      symbols.forEach(symbol => {
        const subs = GLOBAL_STATE.subscribers.get(symbol);
        if (subs) {
          subs.delete(handleUpdate);
          if (subs.size === 0) {
            GLOBAL_STATE.subscribers.delete(symbol);
          }
        }
      });
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
      symbols.forEach(symbol => GLOBAL_STATE.cache.delete(symbol));
      setLoading(true);
      requestSymbols(symbols);
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

export function getPriceForSymbol(symbol) {
  const cached = GLOBAL_STATE.cache.get(symbol);
  return cached?.data || null;
}

export function invalidatePriceCache() {
  console.log('[usePriceData] Invalidating price cache');
  GLOBAL_STATE.cache.clear();
  GLOBAL_STATE.symbolQueue.clear();
  if (GLOBAL_STATE.batchTimer) {
    clearTimeout(GLOBAL_STATE.batchTimer);
    GLOBAL_STATE.batchTimer = null;
  }
}