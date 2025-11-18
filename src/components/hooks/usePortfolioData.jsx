import { useState, useEffect, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Wallet, UserSettings, Holding, Trade } from '@/entities/all';
import { useRealtimeKrakenData } from './useRealtimeKrakenData';
import { usePriceData } from './usePriceData';
import { useKrakenData } from './useKrakenData';
import { useKrakenPnL } from './useKrakenPnL';

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
    priceSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD'],
    subscribeToBalances: !isSimMode,
    subscribeToOrders: false,
    subscribeToExecutions: false,
    isSimMode
  });

  const { krakenData, loading: krakenLoading, refresh: refreshKraken } = useKrakenData(isSimMode, true);
  const { pnlData } = useKrakenPnL(isSimMode);

  // CRITICAL: Merge holdings from different sources
  const effectiveHoldings = useMemo(() => {
    if (isSimMode) {
      return holdings;
    }

    // LIVE MODE: Use WebSocket holdings if available
    if (wsConnected && wsBalances && Object.keys(wsBalances).length > 0) {
      const wsHoldings = Object.entries(wsBalances)
        .filter(([asset, data]) => {
          if (asset === 'USD' || asset === 'ZUSD') return false;
          return data.balance > 0.00001;
        })
        .map(([asset, data]) => {
          const pair = `${asset}/USD`;
          const currentPrice = wsPrices?.[pair]?.price || 0;

          return {
            symbol: asset,
            quantity: data.balance,
            average_cost_price: 0,
            asset_type: 'crypto',
            currentPrice: currentPrice,
            costBasis: 0,
            currentValue: data.balance * currentPrice,
            gainLoss: 0,
            gainLossPercent: 0,
            is_simulation: false
          };
        });

      if (wsHoldings.length > 0) {
        return wsHoldings;
      }
    }

    // Fallback to Kraken API holdings
    if (krakenData?.holdings && krakenData.holdings.length > 0) {
      return krakenData.holdings.map(kh => ({
        symbol: kh.symbol,
        quantity: kh.quantity,
        average_cost_price: kh.avg_cost || kh.current_price_usd || 0,
        asset_type: 'crypto',
        currentPrice: kh.current_price_usd,
        costBasis: (kh.avg_cost || kh.current_price_usd) * kh.quantity,
        currentValue: kh.total_value_usd,
        gainLoss: kh.unrealized_pnl || 0,
        gainLossPercent: kh.pnl_percent || 0,
        is_simulation: false
      }));
    }

    return holdings;
  }, [isSimMode, holdings, wsConnected, wsBalances, wsPrices, krakenData]);

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

  // CRITICAL: Calculate cash and portfolio values
  const currentCashBalance = useMemo(() => {
    if (isSimMode) {
      return wallet?.cash_balance || 0;
    }
    return (wsConnected && wsUsdBalance >= 0) ? wsUsdBalance : (krakenData?.usd_balance || wallet?.real_cash_balance || 0);
  }, [isSimMode, wallet, wsConnected, wsUsdBalance, krakenData]);

  const currentPortfolioValue = useMemo(() => {
    if (isSimMode) {
      return detailedHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
    }
    // LIVE MODE: Use WebSocket total - cash
    if (wsConnected && wsTotalValue >= 0) {
      return wsTotalValue - (wsUsdBalance || 0);
    }
    // Fallback to Kraken API
    return krakenData?.total_crypto_value || detailedHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
  }, [isSimMode, detailedHoldings, wsConnected, wsTotalValue, wsUsdBalance, krakenData]);

  const totalValue = currentCashBalance + currentPortfolioValue;

  // CRITICAL: Calculate PnL
  const portfolio24hrChange = useMemo(() => {
    return {
      value: pnlData.pnl_24h || 0,
      percentage: totalValue > 0 ? (pnlData.pnl_24h / totalValue * 100) : 0
    };
  }, [pnlData.pnl_24h, totalValue]);

  const lifetimeChange = useMemo(() => {
    return {
      value: pnlData.pnl_lifetime || 0,
      percentage: totalValue > 0 ? (pnlData.pnl_lifetime / totalValue * 100) : 0
    };
  }, [pnlData.pnl_lifetime, totalValue]);

  // Load data function
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
        const [currentUser, userSettingsResult, userWalletArr, userHoldingsArr, userTradesArr] = await Promise.all([
          Promise.race([
            base44.auth.me(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 5000))
          ]),
          Promise.race([
            (async () => {
              const u = await base44.auth.me();
              return UserSettings.filter({ created_by: u.email }, "-updated_date", 1);
            })(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Settings timeout')), 5000))
          ]),
          Promise.race([
            (async () => {
              const u = await base44.auth.me();
              return Wallet.filter({ created_by: u.email }, "-updated_date", 1);
            })(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Wallet timeout')), 5000))
          ]),
          Promise.race([
            (async () => {
              const u = await base44.auth.me();
              const s = await UserSettings.filter({ created_by: u.email }, "-updated_date", 1);
              const simMode = s[0]?.sim_trading_mode !== false;
              return Holding.filter({ created_by: u.email, is_simulation: simMode }, "-updated_date", 500);
            })(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Holdings timeout')), 8000))
          ]),
          Promise.race([
            (async () => {
              const u = await base44.auth.me();
              const s = await UserSettings.filter({ created_by: u.email }, "-updated_date", 1);
              const simMode = s[0]?.sim_trading_mode !== false;
              return Trade.filter({ created_by: u.email, is_simulation: simMode }, "-created_date", 200);
            })(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Trades timeout')), 8000))
          ])
        ]);

        const isAdmin = (currentUser?.role || '').toLowerCase() === 'admin';
        const isCreator = !!currentUser?.is_creator;
        const isAdminOrCreator = isAdmin || isCreator;

        const currentSettings = userSettingsResult[0] || { sim_trading_mode: true };
        if (!isAdminOrCreator) {
          currentSettings.sim_trading_mode = true;
        }

        let currentWallet = userWalletArr[0];
        const effectiveSimMode = currentSettings.sim_trading_mode !== false;

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
      setError(null);
    } catch (err) {
      console.error('[usePortfolioData] Error:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for data updates
  useEffect(() => {
    const onDataUpdated = () => {
      GLOBAL_CACHE.data = null;
      GLOBAL_CACHE.timestamp = 0;
      setTimeout(() => loadData(true), 900);
    };
    window.addEventListener('app:data-updated', onDataUpdated);
    return () => window.removeEventListener('app:data-updated', onDataUpdated);
  }, [loadData]);

  const refresh = useCallback(() => {
    GLOBAL_CACHE.data = null;
    GLOBAL_CACHE.timestamp = 0;
    loadData(true);
    if (!isSimMode) {
      wsRefresh();
      refreshKraken();
    }
  }, [loadData, isSimMode, wsRefresh, refreshKraken]);

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

    // States
    isLoading: isLoading || wsLoading || krakenLoading || pricesLoading,
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