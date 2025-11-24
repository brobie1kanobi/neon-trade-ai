import { useState, useEffect, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Wallet, UserSettings, Holding, Trade } from '@/entities/all';
import { useRealtimeKrakenData } from './useRealtimeKrakenData';
import { usePriceData } from './usePriceData';

// CRITICAL: Global cache to prevent duplicate requests
const GLOBAL_CACHE = {
  data: null,
  timestamp: 0,
  inFlight: null
};

const CACHE_TTL = 30000; // 30 seconds

export function usePortfolioData() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [trades, setTrades] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const isSimMode = settings?.sim_trading_mode !== false;

  // Get WebSocket data for live mode
  const {
    usdBalance: wsUsdBalance,
    totalPortfolioValue: wsTotalValue,
    totalAssets: wsTotalAssets,
    balances: wsBalances,
    prices: wsPrices,
    isConnected: wsConnected,
    loading: wsLoading,
    refresh: wsRefresh
  } = useRealtimeKrakenData({
    subscribeToPrices: true,
    priceSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD', 'DOGE/USD', 'DOT/USD', 'LINK/USD', 'LTC/USD', 'XLM/USD', 'AVAX/USD', 'MATIC/USD', 'ATOM/USD', 'UNI/USD', 'AAVE/USD'],
    subscribeToBalances: !isSimMode,
    subscribeToOrders: false,
    subscribeToExecutions: false,
    isSimMode
  });

  // CRITICAL: Build holdings ONLY from WebSocket data (no duplicate API calls)
  const effectiveHoldings = useMemo(() => {
    if (isSimMode) {
      return holdings;
    }

    // LIVE MODE: Use WebSocket holdings ONLY
    if (wsConnected && wsBalances && Object.keys(wsBalances).length > 0) {
      const wsHoldings = Object.entries(wsBalances)
        .filter(([asset, data]) => {
          if (asset === 'USD' || asset === 'ZUSD') return false;
          return data.balance > 0.00001;
        })
        .map(([asset, data]) => {
          const pair = `${asset}/USD`;
          const currentPrice = wsPrices?.[pair]?.price || 0;
          const currentValue = data.balance * currentPrice;

          return {
            symbol: asset,
            quantity: data.balance,
            average_cost_price: 0,
            asset_type: 'crypto',
            currentPrice: currentPrice,
            costBasis: 0,
            currentValue: currentValue,
            gainLoss: 0,
            gainLossPercent: 0,
            is_simulation: false
          };
        });

      if (wsHoldings.length > 0) {
        return wsHoldings;
      }
    }

    return holdings;
  }, [isSimMode, holdings, wsConnected, wsBalances, wsPrices]);

  // Get all symbols for price fetching
  const allSymbols = useMemo(() => {
    return [...new Set(effectiveHoldings.map(h => h.symbol))];
  }, [effectiveHoldings]);

  const { priceData, loading: pricesLoading } = usePriceData(allSymbols);

  // CRITICAL: Calculate detailed holdings with current prices (SAME LOGIC AS ASSET ALLOCATION)
  const detailedHoldings = useMemo(() => {
    if (!effectiveHoldings || effectiveHoldings.length === 0) return [];

    return effectiveHoldings.map(holding => {
      let currentPrice = holding.currentPrice || 0;

      // For SIM mode, use priceData
      if (isSimMode) {
        const priceInfo = priceData?.find(p => p.symbol === holding.symbol);
        currentPrice = priceInfo?.price || priceInfo?.current_price || currentPrice;
      }
      // For LIVE mode, use WebSocket prices
      else if (wsConnected && wsPrices) {
        const pair = `${holding.symbol}/USD`;
        currentPrice = wsPrices[pair]?.price || currentPrice;
      }

      const currentValue = holding.quantity * currentPrice;
      const costBasis = holding.costBasis || (holding.quantity * (holding.average_cost_price || 0));
      const gainLoss = currentValue - costBasis;
      const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;

      return {
        ...holding,
        currentPrice,
        currentValue,
        costBasis,
        gainLoss,
        gainLossPercent
      };
    });
  }, [effectiveHoldings, isSimMode, wsConnected, wsPrices, priceData]);

  // CRITICAL: Calculate cash and portfolio values - USE SAME LOGIC AS ASSET ALLOCATION
  const currentCashBalance = useMemo(() => {
    if (isSimMode) {
      return wallet?.cash_balance || 0;
    }
    // LIVE MODE: Prefer WebSocket USD balance
    if (wsConnected && wsBalances) {
      const usdBal = wsBalances['USD']?.balance || wsBalances['ZUSD']?.balance || 0;
      if (usdBal > 0) return usdBal;
    }
    return wsUsdBalance >= 0 ? wsUsdBalance : (wallet?.real_cash_balance || 0);
  }, [isSimMode, wallet, wsConnected, wsBalances, wsUsdBalance]);

  const currentPortfolioValue = useMemo(() => {
    // CRITICAL: Calculate from detailedHoldings (same source as Asset Allocation)
    return detailedHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
  }, [detailedHoldings]);

  const totalValue = currentCashBalance + currentPortfolioValue;

  // PnL - simplified (no separate API call)
  const portfolio24hrChange = useMemo(() => {
    return { value: 0, percentage: 0 };
  }, []);

  const lifetimeChange = useMemo(() => {
    return { value: 0, percentage: 0 };
  }, []);

  // Load data function with better error handling
  const loadData = useCallback(async (force = false) => {
    const now = Date.now();

    // Use cache if available and fresh
    if (!force && GLOBAL_CACHE.data && (now - GLOBAL_CACHE.timestamp) < CACHE_TTL) {
      console.log('[usePortfolioData] Using cached data');
      setUser(GLOBAL_CACHE.data.user);
      setSettings(GLOBAL_CACHE.data.settings);
      setWallet(GLOBAL_CACHE.data.wallet);
      setHoldings(GLOBAL_CACHE.data.holdings);
      setTrades(GLOBAL_CACHE.data.trades);
      setIsLoading(false);
      return;
    }

    // Wait for in-flight request
    if (GLOBAL_CACHE.inFlight) {
      console.log('[usePortfolioData] Waiting for in-flight request');
      try {
        const result = await GLOBAL_CACHE.inFlight;
        setUser(result.user);
        setSettings(result.settings);
        setWallet(result.wallet);
        setHoldings(result.holdings);
        setTrades(result.trades);
        setIsLoading(false);
        return;
      } catch (e) {
        GLOBAL_CACHE.inFlight = null;
      }
    }

    setIsLoading(true);
    console.log('[usePortfolioData] Fetching fresh data');

    const fetchPromise = (async () => {
      try {
        // Fetch user first (critical)
        const currentUser = await Promise.race([
          base44.auth.me(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 5000))
        ]);

        // Fetch settings and wallet in parallel
        const [userSettingsResult, userWalletArr] = await Promise.all([
          UserSettings.filter({ created_by: currentUser.email }, "-updated_date", 1).catch(err => {
            console.warn('[usePortfolioData] Settings failed:', err);
            return [{ sim_trading_mode: true }];
          }),
          Wallet.filter({ created_by: currentUser.email }, "-updated_date", 1).catch(err => {
            console.warn('[usePortfolioData] Wallet failed:', err);
            return [];
          })
        ]);

        const isAdmin = (currentUser?.role || '').toLowerCase() === 'admin';
        const isCreator = !!currentUser?.is_creator;
        const isAdminOrCreator = isAdmin || isCreator;

        const currentSettings = userSettingsResult[0] || { sim_trading_mode: true };
        if (!isAdminOrCreator) {
          currentSettings.sim_trading_mode = true;
        }

        const effectiveSimMode = currentSettings.sim_trading_mode !== false;

        // Fetch holdings and trades with better timeout handling
        const [userHoldingsArr, userTradesArr] = await Promise.all([
          Promise.race([
            Holding.filter({ created_by: currentUser.email, is_simulation: effectiveSimMode }, "-updated_date", 500),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Holdings timeout')), 15000))
          ]).catch(err => {
            console.warn('[usePortfolioData] Holdings failed:', err.message);
            setError(err.message);
            return [];
          }),
          Promise.race([
            Trade.filter({ created_by: currentUser.email, is_simulation: effectiveSimMode }, "-created_date", 200),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Trades timeout')), 15000))
          ]).catch(err => {
            console.warn('[usePortfolioData] Trades failed:', err.message);
            return [];
          })
        ]);

        // Create wallet if needed
        let currentWallet = userWalletArr[0];
        if (effectiveSimMode && !currentWallet) {
          currentWallet = await Wallet.create({
            cash_balance: 10000,
            total_deposits: 0,
            total_withdrawals: 0,
            real_cash_balance: 0,
            real_total_deposits: 0,
            real_total_withdrawals: 0,
            created_by: currentUser.email
          });
        } else if (!currentWallet) {
          currentWallet = await Wallet.create({
            cash_balance: 0,
            total_deposits: 0,
            total_withdrawals: 0,
            real_cash_balance: 0,
            real_total_deposits: 0,
            real_total_withdrawals: 0,
            created_by: currentUser.email
          });
        }

        const result = {
          user: currentUser,
          settings: currentSettings,
          wallet: currentWallet,
          holdings: userHoldingsArr,
          trades: userTradesArr
        };

        GLOBAL_CACHE.data = result;
        GLOBAL_CACHE.timestamp = Date.now();
        GLOBAL_CACHE.inFlight = null;

        return result;
      } catch (err) {
        GLOBAL_CACHE.inFlight = null;
        throw err;
      }
    })();

    GLOBAL_CACHE.inFlight = fetchPromise;

    try {
      const result = await fetchPromise;
      setUser(result.user);
      setSettings(result.settings);
      setWallet(result.wallet);
      setHoldings(result.holdings);
      setTrades(result.trades);
      if (result.holdings.length > 0 || result.trades.length > 0) {
        setError(null);
      }
    } catch (err) {
      console.error('[usePortfolioData] Error:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  // Listen for data updates
  useEffect(() => {
    const onDataUpdated = () => {
      GLOBAL_CACHE.data = null;
      GLOBAL_CACHE.timestamp = 0;
      setTimeout(() => loadData(true), 900);
    };
    window.addEventListener('app:data-updated', onDataUpdated);
    return () => window.removeEventListener('app:data-updated', onDataUpdated);
  }, []);

  const refresh = useCallback(() => {
    GLOBAL_CACHE.data = null;
    GLOBAL_CACHE.timestamp = 0;
    loadData(true);
    if (!isSimMode) {
      wsRefresh();
    }
  }, [loadData, isSimMode, wsRefresh]);

  return {
    // Core data
    user,
    settings,
    wallet,
    holdings: detailedHoldings,
    trades,
    isSimMode,

    // Calculated values
    currentCashBalance,
    currentPortfolioValue,
    totalValue,
    portfolio24hrChange,
    lifetimeChange,

    // WebSocket data
    wsConnected,
    wsTotalAssets,

    // States - CRITICAL: Only block on core data loading, not prices
    isLoading: isLoading,
    error,

    // Actions
    refresh
  };
}

export function invalidatePortfolioCache() {
  GLOBAL_CACHE.data = null;
  GLOBAL_CACHE.timestamp = 0;
  GLOBAL_CACHE.inFlight = null;
}