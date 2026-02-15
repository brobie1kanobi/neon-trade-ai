import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useKrakenWebSocketManager } from '@/components/hooks/useKrakenWebSocketManager';
import { useSettings } from '@/components/utils/SettingsContext';
import { base44 } from '@/api/base44Client';
import { invalidateCache } from '@/components/hooks/useDataFetching';

// Track last execution timestamp for recovery
let lastExecutionTimestamp = null;

const KrakenWebSocketContext = createContext(null);

export const useKrakenWebSocket = () => {
  const context = useContext(KrakenWebSocketContext);
  if (!context) {
    throw new Error('useKrakenWebSocket must be used within KrakenWebSocketProvider');
  }
  return context;
};

/**
 * Helper: compute portfolio metrics from raw WS balances + prices.
 * Extracted to avoid duplication between interval and manual refresh.
 */
function computeMetrics(wsManager) {
  const isConnected = !!wsManager.isConnected;
  const prices = wsManager.getAllPrices?.() || {};
  const balances = wsManager.getAllBalances?.() || {};
  const orders = wsManager.getAllOrders?.() || {};
  const executions = wsManager.lastExecution ? [wsManager.lastExecution] : [];

  let usdBalance = 0;
  let cryptoHoldingsValue = 0;
  let totalAssets = 0;

  if (balances && Object.keys(balances).length > 0) {
    usdBalance = balances['USD']?.available || balances['ZUSD']?.available || 0;

    Object.entries(balances).forEach(([asset, balance]) => {
      if (asset === 'USD' || asset === 'ZUSD') return;
      const quantity = balance.available || balance.balance || 0;
      if (quantity <= 0.00001) return;
      const pair = `${asset}/USD`;
      const price = prices[pair]?.price || 0;
      cryptoHoldingsValue += quantity * price;
      totalAssets++;
    });
  }

  return {
    isConnected,
    prices,
    balances,
    orders,
    executions,
    usdBalance,
    cryptoHoldingsValue,
    totalPortfolioValue: usdBalance + cryptoHoldingsValue,
    totalAssets
  };
}

/**
 * Global WebSocket Provider - SINGLE SOURCE OF TRUTH for ALL Kraken data.
 *
 * Data priority (highest to lowest):
 *   1. WebSocket real-time streams (balances, prices)
 *   2. REST snapshot (getKrakenBalance) – initial load & post-trade verification
 *   3. Nothing (show loading / 0)
 *
 * Components consume `useKrakenWebSocket()` and NEVER call REST for balances.
 */
export function KrakenWebSocketProvider({ children }) {
  const { settings, user } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  const shouldConnect = !isSimMode && !!user?.email;

  const wsManager = useKrakenWebSocketManager({
    subscribeToPrices: shouldConnect,
    priceSymbols: settings?.watched_crypto || [],
    subscribeToBalances: shouldConnect,
    subscribeToOrders: false,
    subscribeToExecutions: shouldConnect
  });

  const lastRestCallRef = useRef(0);
  const hasInitialSnapshotRef = useRef(false);
  const MIN_REST_INTERVAL = 30000;

  // ── Merged state: WS real-time + REST snapshot ──
  const [state, setState] = useState({
    isConnected: false,
    prices: {},
    balances: {},
    orders: {},
    executions: [],
    usdBalance: 0,
    cryptoHoldingsValue: 0,
    totalPortfolioValue: 0,
    totalAssets: 0
  });

  const [restData, setRestData] = useState({
    krakenBalance: null,
    krakenPnL: null,
    krakenOrders: [],
    krakenTrades: [],
    lastFetchTime: 0,
    isLoading: false,
    error: null
  });

  // ── Reactive WS state updates via window events (no stale closure) ──
  useEffect(() => {
    if (!shouldConnect) return;

    // Immediate first read
    setState(computeMetrics(wsManager));

    // Listen to WS data events instead of blind interval
    const handleBalanceUpdate = () => setState(computeMetrics(wsManager));
    const handlePriceUpdate = () => setState(computeMetrics(wsManager));

    window.addEventListener('kraken:balance-update', handleBalanceUpdate);
    window.addEventListener('kraken:price-update', handlePriceUpdate);

    // Fallback interval at 5s for connection-state changes
    const interval = setInterval(() => setState(computeMetrics(wsManager)), 5000);

    return () => {
      window.removeEventListener('kraken:balance-update', handleBalanceUpdate);
      window.removeEventListener('kraken:price-update', handlePriceUpdate);
      clearInterval(interval);
    };
  }, [shouldConnect]);

  // ── Manual refresh (WS re-subscribe + immediate state push) ──
  const refresh = useCallback(async () => {
    console.log('[KrakenWSProvider] Manual refresh');
    try {
      await wsManager.refreshBalances?.();
      await wsManager.refreshOrders?.();
      // Allow a tick for WS manager to update its maps
      await new Promise(r => setTimeout(r, 300));
      setState(computeMetrics(wsManager));
    } catch (err) {
      console.error('[KrakenWSProvider] Refresh error:', err);
    }
  }, [wsManager]);

  // ── Trade / sync events: aggressive invalidation ──
  useEffect(() => {
    const handleTradeCompleted = () => {
      console.log('[KrakenWSProvider] Trade completed – invalidating caches');
      lastExecutionTimestamp = new Date().toISOString();
      // Nuke ALL financial caches so no stale data survives
      invalidateCache();
      // Force REST re-fetch (Kraken needs ~2s to settle)
      setTimeout(() => {
        fetchRestData(true);
        refresh();
      }, 2000);
    };

    const handleSync = () => {
      invalidateCache();
      setTimeout(() => {
        fetchRestData(true);
        refresh();
      }, 1500);
    };

    window.addEventListener('trade:completed', handleTradeCompleted);
    window.addEventListener('kraken:synced', handleSync);
    window.addEventListener('kraken:order-placed', () => setTimeout(() => fetchRestData(true), 2000));

    return () => {
      window.removeEventListener('trade:completed', handleTradeCompleted);
      window.removeEventListener('kraken:synced', handleSync);
    };
  }, [refresh]); // fetchRestData added below

  // ── WebSocket reconnect recovery ──
  useEffect(() => {
    if (!shouldConnect) return;

    const handleReconnect = async () => {
      if (!lastExecutionTimestamp) return;
      console.log('[KrakenWSProvider] Reconnected – recovering missed trades');
      try {
        const res = await base44.functions.invoke('wsRecovery', {
          action: 'recoverMissedTrades',
          since_timestamp: lastExecutionTimestamp
        });
        const result = res?.data || res;
        if (result?.trades_recovered > 0) {
          window.dispatchEvent(new CustomEvent('kraken:synced', { detail: { recovered: result.trades_recovered } }));
        }
      } catch (e) {
        console.warn('[KrakenWSProvider] Recovery failed:', e.message);
      }
    };

    window.addEventListener('kraken:ws-reconnected', handleReconnect);
    return () => window.removeEventListener('kraken:ws-reconnected', handleReconnect);
  }, [shouldConnect]);

  // ── REST fetcher ──
  const fetchRestData = useCallback(async (force = false) => {
    if (isSimMode) return null;

    const now = Date.now();
    const timeSinceLastFetch = now - lastRestCallRef.current;
    const needsInitialSnapshot = !hasInitialSnapshotRef.current;
    const isRecoveryMode = !state.isConnected && timeSinceLastFetch > MIN_REST_INTERVAL;

    if (!force && !needsInitialSnapshot && !isRecoveryMode) {
      return null;
    }

    // Prevent concurrent fetches unless forced
    let shouldSkip = false;
    setRestData(prev => {
      if (prev.isLoading && !force) { shouldSkip = true; return prev; }
      return { ...prev, isLoading: true, error: null };
    });
    if (shouldSkip) return null;

    const reason = force ? 'forced' : needsInitialSnapshot ? 'initial' : 'recovery';
    console.log(`[KrakenWSProvider] REST fetch (${reason})`);
    lastRestCallRef.current = now;

    try {
      const [balanceRes, ordersRes] = await Promise.all([
        Promise.race([
          base44.functions.invoke('getKrakenBalance', {}),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
        ]).catch(e => ({ error: e.message, success: false })),
        Promise.race([
          base44.functions.invoke('krakenApi', { action: 'getOpenOrders' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
        ]).catch(e => ({ error: e.message }))
      ]);

      const balanceData = balanceRes?.data || balanceRes;
      const ordersData = ordersRes?.data || ordersRes;
      hasInitialSnapshotRef.current = true;

      setRestData(prev => ({
        krakenBalance: balanceData?.success ? balanceData : prev.krakenBalance,
        krakenOrders: ordersData?.orders || prev.krakenOrders || [],
        krakenTrades: prev.krakenTrades,
        krakenPnL: prev.krakenPnL,
        lastFetchTime: Date.now(),
        isLoading: false,
        error: balanceData?.success ? null : (balanceData?.error || null)
      }));

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kraken:snapshot-loaded', {
          detail: { balance: balanceData, orders: ordersData?.orders }
        }));
      }

      return { krakenBalance: balanceData, krakenOrders: ordersData?.orders || [] };
    } catch (err) {
      console.error('[KrakenWSProvider] REST error:', err);
      hasInitialSnapshotRef.current = true;
      setRestData(prev => ({ ...prev, isLoading: false, error: err.message }));
      return null;
    }
  }, [isSimMode, state.isConnected]);

  // ── PnL fetcher (separate, less frequent) ──
  const fetchPnL = useCallback(async () => {
    if (isSimMode) return;
    try {
      const response = await base44.functions.invoke('getKrakenPnL', {});
      const data = response?.data || response;
      if (data?.success) {
        setRestData(prev => ({ ...prev, krakenPnL: data }));
      }
    } catch (err) {
      console.error('[KrakenWSProvider] PnL error:', err);
    }
  }, [isSimMode]);

  // ── Initial REST snapshot (one-time) ──
  useEffect(() => {
    if (shouldConnect && !hasInitialSnapshotRef.current && restData.lastFetchTime === 0) {
      const timer = setTimeout(() => {
        fetchRestData(true);
        setTimeout(() => fetchPnL(), 5000);
      }, 500);

      const safetyTimer = setTimeout(() => {
        if (!hasInitialSnapshotRef.current) {
          hasInitialSnapshotRef.current = true;
          setRestData(prev => ({ ...prev, isLoading: false }));
        }
      }, 20000);

      return () => { clearTimeout(timer); clearTimeout(safetyTimer); };
    }
  }, [shouldConnect]);

  // ── PnL polling (only thing not available via WS) ──
  useEffect(() => {
    if (!shouldConnect) return;
    const id = setInterval(fetchPnL, 120000);
    return () => clearInterval(id);
  }, [shouldConnect, fetchPnL]);

  // ── Recovery mode: poll REST while WS is down ──
  useEffect(() => {
    if (!shouldConnect || state.isConnected || !hasInitialSnapshotRef.current) return;
    console.log('[KrakenWSProvider] WS down – entering recovery polling');
    const id = setInterval(() => fetchRestData(true), 60000);
    return () => clearInterval(id);
  }, [shouldConnect, state.isConnected, fetchRestData]);

  // ── Derived: best available balance (WS > REST > cached) ──
  // Priority: WS real-time > REST snapshot > 0
  // CRITICAL: Always try to show SOMETHING - don't show $0 if we have any data source
  const wsHasBalances = state.isConnected && Object.keys(state.balances).length > 0;
  const restHasBalance = restData.krakenBalance?.success;
  
  const bestUsdBalance = wsHasBalances && state.usdBalance > 0
    ? state.usdBalance
    : restHasBalance ? (restData.krakenBalance.usd_balance || 0)
    : state.usdBalance || 0; // Last resort: whatever WS has even if 0

  const bestCryptoValue = wsHasBalances && state.cryptoHoldingsValue > 0
    ? state.cryptoHoldingsValue
    : restHasBalance ? (restData.krakenBalance.total_crypto_value_usd || 0)
    : state.cryptoHoldingsValue || 0;

  const bestHoldings = wsHasBalances
    ? Object.entries(state.balances)
        .filter(([a]) => a !== 'USD' && a !== 'ZUSD')
        .filter(([_, b]) => (b.balance || 0) > 0.00001)
        .map(([asset, bal]) => ({
          symbol: asset,
          quantity: bal.balance || 0,
          asset_type: 'crypto',
          current_price_usd: state.prices[`${asset}/USD`]?.price || 0,
          total_value_usd: (bal.balance || 0) * (state.prices[`${asset}/USD`]?.price || 0),
          is_simulation: false
        }))
    : (restData.krakenBalance?.holdings || []).map(h => ({ ...h, is_simulation: false }));

  const hasData = wsHasBalances || restHasBalance;

  const value = {
    ...state,
    // Override with best-available merged values
    usdBalance: bestUsdBalance,
    cryptoHoldingsValue: bestCryptoValue,
    totalPortfolioValue: bestUsdBalance + bestCryptoValue,
    // Derived holdings for consumers
    bestHoldings,
    hasData,
    refresh,
    wsManager,
    krakenBalance: restData.krakenBalance,
    krakenPnL: restData.krakenPnL,
    krakenOrders: restData.krakenOrders,
    krakenTrades: restData.krakenTrades,
    restDataLoading: restData.isLoading,
    restDataError: restData.error,
    lastRestFetchTime: restData.lastFetchTime,
    fetchKrakenData: fetchRestData,
    fetchPnL
  };

  return (
    <KrakenWebSocketContext.Provider value={value}>
      {children}
    </KrakenWebSocketContext.Provider>
  );
}