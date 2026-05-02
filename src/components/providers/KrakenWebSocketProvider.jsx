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
 * Helper: compute portfolio metrics from GLOBAL WS state directly.
 * CRITICAL: Reads from GLOBAL_WS_STATE, not from React state (avoids stale closures).
 */
function computeMetricsFromGlobal() {
  // Read connection state directly from global singleton - NOT from React state
  const isConnected = !!(
    (typeof window !== 'undefined' && window.__krakenWsConnected) ||
    false
  );
  
  // Read data from global Maps directly
  const prices = {};
  const balances = {};
  const orders = {};

  // Access window globals set by the WS manager
  if (typeof window !== 'undefined') {
    // Prices from global
    if (window.__krakenWsPrices) {
      Object.assign(prices, window.__krakenWsPrices);
    }
    // Balances from global
    if (window.__krakenWsBalances) {
      Object.assign(balances, window.__krakenWsBalances);
    }
    // Orders from global
    if (window.__krakenWsOrders) {
      Object.assign(orders, window.__krakenWsOrders);
    }
  }

  let usdBalance = 0;
  let cryptoHoldingsValue = 0;
  let totalAssets = 0;

  if (balances && Object.keys(balances).length > 0) {
    usdBalance = balances['USD']?.balance || balances['USD']?.available || balances['ZUSD']?.balance || balances['ZUSD']?.available || 0;

    Object.entries(balances).forEach(([asset, balance]) => {
      if (asset === 'USD' || asset === 'ZUSD') return;
      const quantity = balance.balance || balance.available || 0;
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
    executions: [],
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
    // Delay executions subscription to avoid rate limits at boot; we'll trigger via refreshOrders after first snapshot
    subscribeToExecutions: false
  });

  const lastRestCallRef = useRef(0);
  const hasInitialSnapshotRef = useRef(false);
  const ordersSubscribedRef = useRef(false);
  const restInFlightRef = useRef(false);
  const MIN_REST_INTERVAL = 60000; // Increased from 30s to 60s to reduce rate limits

  // CRITICAL: Counter that increments on every WS balance/price update.
  // Components that depend on live data can include this in their deps to re-render.
  const [wsUpdateCounter, setWsUpdateCounter] = useState(0);

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

  // Prevent SIM bleed: when switching into LIVE mode, clear any page-level cached wallet
  useEffect(() => {
    if (shouldConnect && typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('wallet:updated')); // force wallet hooks to refetch
      } catch (_) {}
    }
  }, [shouldConnect]);

  const [restData, setRestData] = useState({
    krakenBalance: null,
    krakenPnL: null,
    krakenOrders: [],
    krakenTrades: [],
    lastFetchTime: 0,
    isLoading: false,
    error: null
  });

  // ── Reactive WS state updates via window events ──
  // CRITICAL: Only runs in LIVE mode (shouldConnect = !isSimMode && !!user)
  // SIM mode should NEVER listen for Kraken WS events
  useEffect(() => {
    if (!shouldConnect) return;

    // Immediate first read
    setState(computeMetricsFromGlobal());

    const handleUpdate = () => {
      setState(computeMetricsFromGlobal());
      setWsUpdateCounter(c => c + 1);
    };

    window.addEventListener('kraken:balance-update', handleUpdate);
    window.addEventListener('kraken:price-update', handleUpdate);
    window.addEventListener('kraken:connected', handleUpdate);
    window.addEventListener('kraken:disconnected', handleUpdate);

    // Fallback interval at 10s for connection-state changes
    const interval = setInterval(() => setState(computeMetricsFromGlobal()), 10000);

    return () => {
      window.removeEventListener('kraken:balance-update', handleUpdate);
      window.removeEventListener('kraken:price-update', handleUpdate);
      window.removeEventListener('kraken:connected', handleUpdate);
      window.removeEventListener('kraken:disconnected', handleUpdate);
      clearInterval(interval);
    };
  }, [shouldConnect]);

  // ── Manual refresh (WS re-subscribe + immediate state push) ──
  const refresh = useCallback(async () => {
    console.log('[KrakenWSProvider] Manual refresh');
    try {
      await wsManager.refreshBalances?.();
      await wsManager.refreshOrders?.();
      await new Promise(r => setTimeout(r, 500));
      setState(computeMetricsFromGlobal());
    } catch (err) {
      console.error('[KrakenWSProvider] Refresh error:', err);
    }
  }, [wsManager]);

  // Refs to hold latest callback references (avoids "before initialization" errors)
  const fetchRestDataRef = useRef(null);
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  // ── Trade / sync events: aggressive invalidation ──
  useEffect(() => {
    const handleTradeCompleted = () => {
      console.log('[KrakenWSProvider] Trade completed – invalidating caches');
      lastExecutionTimestamp = new Date().toISOString();
      invalidateCache();
      setTimeout(() => {
        fetchRestDataRef.current?.(true);
        refreshRef.current?.();
      }, 2000);

    };

    const handleSync = () => {
      invalidateCache();
      setTimeout(() => {
        fetchRestDataRef.current?.(true);
        refreshRef.current?.();
      }, 1500);
    };

    const handleOrderPlaced = () => {
      setTimeout(() => fetchRestDataRef.current?.(true), 2000);
    };

    const handleOrderFilled = () => {
      console.log('[KrakenWSProvider] Order filled on Kraken – refreshing balances');
      invalidateCache();
      setTimeout(() => {
        fetchRestDataRef.current?.(true);
        refreshRef.current?.();
      }, 1500);
    };

    window.addEventListener('trade:completed', handleTradeCompleted);
    window.addEventListener('kraken:synced', handleSync);
    window.addEventListener('kraken:order-placed', handleOrderPlaced);
    window.addEventListener('kraken:order-filled', handleOrderFilled);
    window.addEventListener('kraken:order-canceled', handleOrderFilled);

    return () => {
      window.removeEventListener('trade:completed', handleTradeCompleted);
      window.removeEventListener('kraken:synced', handleSync);
      window.removeEventListener('kraken:order-placed', handleOrderPlaced);
      window.removeEventListener('kraken:order-filled', handleOrderFilled);
      window.removeEventListener('kraken:order-canceled', handleOrderFilled);
    };
  }, []);

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

  // ── REST fetcher (LIVE mode ONLY - never fires in SIM mode) ──
  const fetchRestData = useCallback(async (force = false) => {
    if (isSimMode || !shouldConnect) return null;

    if (restInFlightRef.current) { return null; }
    const now = Date.now();
    const timeSinceLastFetch = now - lastRestCallRef.current;
    const needsInitialSnapshot = !hasInitialSnapshotRef.current;
    const isRecoveryMode = !state.isConnected && timeSinceLastFetch > MIN_REST_INTERVAL;

    if (!force && !needsInitialSnapshot && !isRecoveryMode) {
      return null;
    }
    restInFlightRef.current = true;

    setRestData(prev => ({ ...prev, isLoading: true, error: null }));

    const reason = force ? 'forced' : needsInitialSnapshot ? 'initial' : 'recovery';
    console.log(`[KrakenWSProvider] REST fetch (${reason}) at ${new Date().toISOString()}`);
    lastRestCallRef.current = now;

    try {
      // Fetch BALANCE snapshot first to reduce rate-limit pressure; defer orders subscription
      const balanceRes = await Promise.race([
        base44.functions.invoke('getKrakenBalance', {}),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Balance fetch timeout')), 25000))
      ]).catch(e => {
        console.warn('[KrakenWSProvider] Balance fetch failed:', e.message);
        return { error: e.message, success: false };
      });

      const balanceData = balanceRes?.data || balanceRes;
      hasInitialSnapshotRef.current = true;
      
      console.log('[KrakenWSProvider] REST snapshot complete - Balance:', balanceData?.success, 'USD:', balanceData?.usd_balance);

      setRestData(prev => ({
        krakenBalance: balanceData?.success ? balanceData : prev.krakenBalance,
        krakenOrders: prev.krakenOrders || [],
        krakenTrades: prev.krakenTrades,
        krakenPnL: prev.krakenPnL,
        lastFetchTime: Date.now(),
        isLoading: false,
        error: balanceData?.success ? null : (balanceData?.error || null)
      }));

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kraken:snapshot-loaded', {
          detail: { balance: balanceData, orders: null }
        }));
      }

      // After first successful snapshot, delay subscribe to executions to avoid rate limits at boot
      if (!ordersSubscribedRef.current && wsManager?.refreshOrders) {
        ordersSubscribedRef.current = true;
        setTimeout(() => {
          try { wsManager.refreshOrders?.(); } catch (_) {}
        }, 5000);
      }

      restInFlightRef.current = false;
      return { krakenBalance: balanceData };
    } catch (err) {
      console.error('[KrakenWSProvider] REST error:', err);
      hasInitialSnapshotRef.current = true;
      setRestData(prev => ({ ...prev, isLoading: false, error: err.message }));
      restInFlightRef.current = false;
      return null;
    }
  }, [isSimMode, state.isConnected]);

  // Keep ref in sync so event handlers always call the latest version
  useEffect(() => { fetchRestDataRef.current = fetchRestData; }, [fetchRestData]);

  // ── PnL fetcher (LIVE mode ONLY) ──
  const fetchPnL = useCallback(async () => {
    if (isSimMode || !shouldConnect) return;
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
      // Fetch REST data immediately - it's our AUTHORITATIVE source for accurate balances
      const timer = setTimeout(() => {
        if (!hasInitialSnapshotRef.current) {
          fetchRestData(true);
          setTimeout(() => fetchPnL(), 5000);
        }
      }, 300); // Faster first snapshot to populate balances quickly

      // Safety: don't stay in loading forever
      const safetyTimer = setTimeout(() => {
        if (!hasInitialSnapshotRef.current) {
          console.log('[KrakenWSProvider] Safety timeout - marking snapshot complete');
          hasInitialSnapshotRef.current = true;
          setRestData(prev => ({ ...prev, isLoading: false }));
        }
      }, 15000);

      return () => { clearTimeout(timer); clearTimeout(safetyTimer); };
    }
  }, [shouldConnect]);

  // ── PnL polling (only thing not available via WS) - every 5 min ──
  useEffect(() => {
    if (!shouldConnect) return;
    const id = setInterval(fetchPnL, 300000);
    return () => clearInterval(id);
  }, [shouldConnect, fetchPnL]);

  // ── Recovery mode: poll REST while WS is down (conservative, 5 min) ──
  // CRITICAL: Only in LIVE mode (shouldConnect already gates on !isSimMode)
  useEffect(() => {
    if (!shouldConnect || state.isConnected || !hasInitialSnapshotRef.current) return;
    console.log('[KrakenWSProvider] WS down – entering recovery polling (every 5 min)');
    const id = setInterval(() => fetchRestData(true), 300000);
    return () => clearInterval(id);
  }, [shouldConnect, state.isConnected, fetchRestData]);

  // ── Derived: best available balance (WS > REST > cached) ──
  // Priority: WS real-time > REST snapshot > 0
  // CRITICAL: Use global window state for connection check (not stale React state)
  const wsActuallyConnected = !!(state.isConnected || (typeof window !== 'undefined' && window.__krakenWsConnected));
  const wsHasBalances = wsActuallyConnected && Object.keys(state.balances).length > 0;
  const restHasBalance = restData.krakenBalance?.success;
  
  // CRITICAL: Best-available balance logic
  // REST API (getKrakenBalance) is AUTHORITATIVE for initial load & cost basis.
  // HOWEVER, once WS is connected and pushing balance/price updates, WS values
  // are MORE CURRENT than the (potentially stale) REST snapshot.
  // Priority: WS real-time (if connected & has data) > REST snapshot > 0
  
  const bestUsdBalance = wsHasBalances
    ? state.usdBalance
    : restHasBalance 
      ? (restData.krakenBalance.usd_balance || 0)
      : 0;

  const bestCryptoValue = wsHasBalances
    ? state.cryptoHoldingsValue
    : restHasBalance 
      ? (restData.krakenBalance.total_crypto_value_usd || 0)
      : 0;

  const bestHoldings = restHasBalance
    ? (restData.krakenBalance?.holdings || []).map(h => ({ ...h, is_simulation: false }))
    : wsHasBalances
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
      : [];

  const hasData = !!(restHasBalance || wsHasBalances);

  const value = {
    ...state,
    // CRITICAL: Counter that increments on every WS event — use in dependency arrays
    wsUpdateCounter,
    // Override connection status with global check
    isConnected: wsActuallyConnected,
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