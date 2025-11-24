import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Wallet, UserSettings, Holding, Trade } from '@/entities/all';
import { useRealtimeKrakenData } from '@/components/hooks/useRealtimeKrakenData';
import { usePriceData } from '@/components/hooks/usePriceData';
import { useKrakenData } from '@/components/hooks/useKrakenData';
import { useKrakenPnL } from '@/components/hooks/useKrakenPnL';

/**
 * SINGLE SOURCE OF TRUTH FOR ALL APP DATA
 * Prevents duplicate API calls across pages
 */

const AppDataContext = createContext(null);

export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error('useAppData must be used within AppDataProvider');
  }
  return context;
}

export function AppDataProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [trades, setTrades] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetch, setLastFetch] = useState(0);

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

  // Only use Kraken hooks in LIVE mode
  const { krakenData, loading: krakenLoading, refresh: refreshKraken } = useKrakenData(isSimMode, !isSimMode);
  const { pnlData } = useKrakenPnL(isSimMode);

  // Merge holdings from different sources
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

  const allSymbols = useMemo(() => {
    return [...new Set(effectiveHoldings.map(h => h.symbol))];
  }, [effectiveHoldings]);

  const { priceData, loading: pricesLoading } = usePriceData(allSymbols);

  // Calculate detailed holdings with current prices
  const detailedHoldings = useMemo(() => {
    if (!effectiveHoldings || effectiveHoldings.length === 0) return [];

    return effectiveHoldings.map(holding => {
      let currentPrice = holding.currentPrice || 0;

      if (isSimMode) {
        const priceInfo = priceData?.find(p => p.symbol === holding.symbol);
        currentPrice = priceInfo?.price || priceInfo?.current_price || currentPrice;
      } else if (wsConnected && wsPrices) {
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

  // Calculate cash and portfolio values
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
    if (wsConnected && wsTotalValue >= 0 && wsUsdBalance >= 0) {
      return wsTotalValue - wsUsdBalance;
    }
    return krakenData?.total_crypto_value || detailedHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
  }, [isSimMode, detailedHoldings, wsConnected, wsTotalValue, wsUsdBalance, krakenData]);

  const totalValue = currentCashBalance + currentPortfolioValue;

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

  // SINGLE data fetch function
  const loadData = useCallback(async (force = false) => {
    const now = Date.now();
    
    // Prevent rapid refetches
    if (!force && lastFetch && (now - lastFetch) < 10000) {
      console.log('[AppDataProvider] Skipping fetch, too recent');
      return;
    }

    setIsLoading(true);
    console.log('[AppDataProvider] 🔄 Fetching data...');

    try {
      const currentUser = await base44.auth.me();

      const [userSettingsResult, userWalletArr] = await Promise.all([
        UserSettings.filter({ created_by: currentUser.email }, "-updated_date", 1).catch(() => [{ sim_trading_mode: true }]),
        Wallet.filter({ created_by: currentUser.email }, "-updated_date", 1).catch(() => [])
      ]);

      const isAdmin = (currentUser?.role || '').toLowerCase() === 'admin';
      const isCreator = !!currentUser?.is_creator;
      const currentSettings = userSettingsResult[0] || { sim_trading_mode: true };
      if (!isAdmin && !isCreator) {
        currentSettings.sim_trading_mode = true;
      }

      const effectiveSimMode = currentSettings.sim_trading_mode !== false;

      const [userHoldingsArr, userTradesArr] = await Promise.all([
        Holding.filter({ created_by: currentUser.email, is_simulation: effectiveSimMode }, "-updated_date", 500).catch(() => []),
        Trade.filter({ created_by: currentUser.email, is_simulation: effectiveSimMode }, "-created_date", 200).catch(() => [])
      ]);

      let currentWallet = userWalletArr[0];
      if (!currentWallet) {
        currentWallet = await Wallet.create({
          cash_balance: effectiveSimMode ? 10000 : 0,
          total_deposits: 0,
          total_withdrawals: 0,
          real_cash_balance: 0,
          real_total_deposits: 0,
          real_total_withdrawals: 0,
          created_by: currentUser.email
        });
      }

      setUser(currentUser);
      setSettings(currentSettings);
      setWallet(currentWallet);
      setHoldings(userHoldingsArr);
      setTrades(userTradesArr);
      setLastFetch(Date.now());
      setError(null);

      console.log('[AppDataProvider] ✅ Data loaded');
    } catch (err) {
      console.error('[AppDataProvider] Error:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [lastFetch]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const onDataUpdated = () => {
      console.log('[AppDataProvider] Data update event');
      setTimeout(() => loadData(true), 500);
    };
    window.addEventListener('app:data-updated', onDataUpdated);
    return () => window.removeEventListener('app:data-updated', onDataUpdated);
  }, [loadData]);

  const refresh = useCallback(() => {
    loadData(true);
    if (!isSimMode) {
      wsRefresh();
      refreshKraken();
    }
  }, [loadData, isSimMode, wsRefresh, refreshKraken]);

  const value = {
    user,
    settings,
    wallet,
    holdings: detailedHoldings,
    trades,
    isSimMode,
    currentCashBalance,
    currentPortfolioValue,
    totalValue,
    portfolio24hrChange,
    lifetimeChange,
    wsConnected,
    wsTotalAssets,
    isLoading: isLoading || wsLoading || krakenLoading || pricesLoading,
    error,
    refresh
  };

  return (
    <AppDataContext.Provider value={value}>
      {children}
    </AppDataContext.Provider>
  );
}