
import React, { useState, useEffect, useCallback } from "react";
import { Trade, Wallet, UserSettings, User, Holding } from "@/entities/all";
import { motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import { InvokeLLM } from "@/integrations/Core"; 

import PortfolioSummary from "../components/portfolio/PortfolioSummary";
import AssetAllocation from "../components/portfolio/AssetAllocation";
import TradingInterface from "../components/portfolio/TradingInterface";
import TradeHistory from "../components/portfolio/TradeHistory";
import DataSync from "../components/portfolio/DataSync";
import OpenAndConditionalOrders from "../components/portfolio/OpenAndConditionalOrders";
import { base44 } from "@/api/base44Client";
import AutoBuyPreferences from "../components/portfolio/AutoBuyPreferences";
import EmergencyRepair from "../components/wallet/EmergencyRepair";
import { useKrakenData } from "@/components/hooks/useKrakenData";
import { usePriceData } from "@/components/hooks/usePriceData";
import { useRealtimeKrakenData } from "@/components/hooks/useRealtimeKrakenData";

// GLOBAL CACHE to prevent duplicate API calls
if (typeof window !== 'undefined') {
  window.__portfolioCache = window.__portfolioCache || {
    data: null,
    timestamp: 0,
    inFlight: null
  };
}

const CACHE_TTL = 30000; // 30 seconds

export default function Portfolio() {
  const [trades, setTrades] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [settings, setSettings] = useState(null);
  const [user, setUser] = useState(null);
  const [holdings, setHoldings] = useState([]);
  // detailedHoldings is now a useMemo, no longer a state variable directly set by an effect.
  // const [detailedHoldings, setDetailedHoldings] = useState([]);
  const [isCalculatingValue, setIsCalculatingValue] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showDataSync, setShowDataSync] = useState(false);
  const [portfolio24hrChange, setPortfolio24hrChange] = useState({ value: 0, percentage: 0 });
  const [lifetimeChange, setLifetimeChange] = useState({ value: 0, percentage: 0 });
  const location = useLocation();

  const [error, setError] = useState(null);

  // CRITICAL: Determine sim mode FIRST
  const isSimMode = settings?.sim_trading_mode !== false;

  // CRITICAL: Use Kraken data in LIVE mode
  const { krakenData, loading: krakenLoading, error: krakenError, refresh: refreshKraken } = useKrakenData(isSimMode, true);

  // CRITICAL: Get WebSocket real-time data
  const { 
    usdBalance: wsUsdBalance,
    totalPortfolioValue: wsTotalValue,
    totalAssets: wsTotalAssets,
    balances: wsBalances,
    prices: wsPrices, // Added wsPrices from useRealtimeKrakenData
    isConnected: wsConnected,
    loading: wsLoading
  } = useRealtimeKrakenData({
    subscribeToPrices: true,
    priceSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD'],
    subscribeToBalances: !isSimMode,
    subscribeToOrders: false,
    subscribeToExecutions: false,
    isSimMode
  });

  const loadData = useCallback(async (force = false) => {
    const cache = window.__portfolioCache;
    const now = Date.now();

    // CRITICAL: Use cache if available and fresh
    if (!force && cache.data && (now - cache.timestamp) < CACHE_TTL) {
      console.log('[Portfolio] Using cached data (age:', Math.floor((now - cache.timestamp) / 1000), 'sec)');
      
      setUser(cache.data.user);
      setSettings(cache.data.settings);
      setWallet(cache.data.wallet);
      setTrades(cache.data.trades);
      setHoldings(cache.data.holdings);
      setShowDataSync(cache.data.showDataSync);
      setIsLoading(false);
      return;
    }

    // CRITICAL: If request is already in flight, wait for it
    if (cache.inFlight) {
      console.log('[Portfolio] Request in flight, waiting...');
      try {
        const result = await cache.inFlight;
        setUser(result.user);
        setSettings(result.settings);
        setWallet(result.wallet);
        setTrades(result.trades);
        setHoldings(result.holdings);
        setShowDataSync(result.showDataSync);
        setIsLoading(false);
        return;
      } catch (e) {
        console.error('[Portfolio] In-flight request failed:', e);
        // If in-flight failed, clear it to allow new attempts
        cache.inFlight = null;
        throw e; // Re-throw to be caught by the outer try-catch
      }
    }

    setIsLoading(true);
    console.log('[Portfolio] Fetching fresh data...');

    // Create the fetch promise
    const fetchPromise = (async () => {
      try {
        // FIXED: Increased timeouts from 2s to 8s for heavy queries
        const [currentUser, userSettingsResult, userWalletArr, userTradesArr, userHoldingsArr] = await Promise.all([
          Promise.race([
            base44.auth.me(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 5000))
          ]),
          
          Promise.race([
            (async () => {
              const u = await base44.auth.me(); // This will execute base44.auth.me() again
              return UserSettings.filter({ created_by: u.email }, "-updated_date", 1);
            })(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Settings timeout')), 5000))
          ]),
          
          Promise.race([
            (async () => {
              const u = await base44.auth.me(); // This will execute base44.auth.me() again
              return Wallet.filter({ created_by: u.email }, "-updated_date", 1);
            })(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Wallet timeout')), 5000))
          ]),
          
          Promise.race([
            (async () => {
              const u = await base44.auth.me();
              const s = await UserSettings.filter({ created_by: u.email }, "-updated_date", 1);
              const simMode = s[0]?.sim_trading_mode !== false;
              return Trade.filter({ created_by: u.email, is_simulation: simMode }, "-created_date", 200);
            })(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Trades timeout')), 8000))
          ]),
          
          Promise.race([
            (async () => {
              const u = await base44.auth.me();
              const s = await UserSettings.filter({ created_by: u.email }, "-updated_date", 1);
              const simMode = s[0]?.sim_trading_mode !== false;
              return Holding.filter({ created_by: u.email, is_simulation: simMode }, "-updated_date", 500);
            })(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Holdings timeout')), 8000))
          ])
        ]);

        const isAdmin = (currentUser?.role || '').toLowerCase() === 'admin';
        const isCreator = !!currentUser?.is_creator;
        const isAdminOrCreator = isAdmin || isCreator;

        const currentSettings = userSettingsResult[0] || { sim_trading_mode: true };
        if (!isAdminOrCreator) {
          currentSettings.sim_trading_mode = true;
        }

        const effectiveSimMode = currentSettings.sim_trading_mode !== false;

        let currentWallet = userWalletArr[0];

        // Handle wallet initialization for sim mode
        if (effectiveSimMode) {
          const cashBuildUpInterval = 24 * 60 * 60 * 1000;
          const cashBuildUpAmount = 1000;
          const currentTime = Date.now();

          if (!currentWallet) {
            currentWallet = {
              cash_balance: 10000 + cashBuildUpAmount,
              total_deposits: 0,
              total_withdrawals: 0,
              real_cash_balance: 0,
              real_total_deposits: 0,
              real_total_withdrawals: 0,
              last_cash_build_up_time: currentTime,
              created_by: currentUser.email
            };
            const newWallet = await Wallet.create(currentWallet);
            currentWallet = newWallet;
          } else if (!currentWallet.last_cash_build_up_time || (currentTime - currentWallet.last_cash_build_up_time) >= cashBuildUpInterval) {
            currentWallet.cash_balance = (currentWallet.cash_balance || 0) + cashBuildUpAmount;
            currentWallet.last_cash_build_up_time = currentTime;
            await Wallet.update(currentWallet.id, { 
              cash_balance: currentWallet.cash_balance, 
              last_cash_build_up_time: currentWallet.last_cash_build_up_time 
            });
          }
        } else if (!currentWallet) {
            currentWallet = {
              cash_balance: 0,
              total_deposits: 0,
              total_withdrawals: 0,
              real_cash_balance: 0,
              real_total_deposits: 0,
              real_total_withdrawals: 0,
              created_by: currentUser.email
            };
            const newWallet = await Wallet.create(currentWallet);
            currentWallet = newWallet;
        }

        console.log('[Portfolio] Loaded:', {
          holdings: userHoldingsArr.length,
          trades: userTradesArr.length,
          mode: effectiveSimMode ? 'sim' : 'real'
        });

        const result = {
          user: currentUser,
          settings: currentSettings,
          wallet: currentWallet,
          trades: userTradesArr,
          holdings: userHoldingsArr,
          showDataSync: effectiveSimMode && userTradesArr.length > 0 && userHoldingsArr.length === 0
        };

        // Update cache
        cache.data = result;
        cache.timestamp = Date.now();
        cache.inFlight = null;

        return result;

      } catch (err) {
        cache.inFlight = null;
        throw err;
      }
    })();

    // Store in-flight request
    cache.inFlight = fetchPromise;

    try {
      const result = await fetchPromise;
      
      setUser(result.user);
      setSettings(result.settings);
      setWallet(result.wallet);
      setTrades(result.trades);
      setHoldings(result.holdings);
      setShowDataSync(result.showDataSync);
      setError(null);

    } catch (err) {
      console.error('[Portfolio] Loading error:', err);
      
      const status = err?.response?.status || err?.status || 0;
      const message = err?.message || '';
      
      if (status === 429 || message.includes('429') || message.toLowerCase().includes('rate limit')) {
        setError('Rate limit reached. Using cached data if available. Please wait a moment.');
        
        // Try to use cached data even if stale
        if (cache.data) {
          console.log('[Portfolio] Rate limited, using stale cache');
          setUser(cache.data.user);
          setSettings(cache.data.settings);
          setWallet(cache.data.wallet);
          setTrades(cache.data.trades);
          setHoldings(cache.data.holdings);
          setShowDataSync(cache.data.showDataSync);
        }
        
        // Auto-retry after 60 seconds
        setTimeout(() => {
          console.log('[Portfolio] Auto-retrying after rate limit...');
          cache.data = null; // Invalidate cache for retry
          cache.timestamp = 0;
          loadData(false);
        }, 60000);
      } else {
        setError('Failed to load portfolio data. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []); // Dependencies are empty as it fetches all data internally

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const onDataUpdated = () => {
      // Invalidate cache on data update
      window.__portfolioCache.data = null;
      window.__portfolioCache.timestamp = 0;
      
      if (typeof window !== 'undefined') {
        if (window.__portfolioRefreshTimeout) {
          clearTimeout(window.__portfolioRefreshTimeout);
        }
        window.__portfolioRefreshTimeout = setTimeout(() => {
          console.log('[Portfolio] Data updated event, reloading...');
          loadData(true); // Force a fresh load
          window.__portfolioRefreshTimeout = null;
        }, 900);
      } else {
        loadData(true); // Force a fresh load
      }
    };
    window.addEventListener('app:data-updated', onDataUpdated);
    return () => {
      window.removeEventListener('app:data-updated', onDataUpdated);
      if (typeof window !== 'undefined' && window.__portfolioRefreshTimeout) {
        clearTimeout(window.__portfolioRefreshTimeout);
        window.__portfolioRefreshTimeout = null;
      }
    }
  }, [loadData]);

  // CRITICAL: Merge holdings from Kraken (if LIVE mode) with local holdings (if SIM mode)
  const effectiveHoldings = React.useMemo(() => {
    if (isSimMode) {
      return holdings;
    } else {
      // LIVE MODE: Use WebSocket holdings if available
      if (wsConnected && wsBalances && Object.keys(wsBalances).length > 0) {
        const wsHoldings = Object.entries(wsBalances)
          .filter(([asset, data]) => {
            if (asset === 'USD' || asset === 'ZUSD') return false;
            return data.balance > 0.00001;
          })
          .map(([asset, data]) => {
            // Get price from WebSocket prices
            const pair = `${asset}/USD`;
            const currentPrice = wsPrices?.[pair]?.price || 0; // Use wsPrices for current price
            
            return {
              symbol: asset,
              quantity: data.balance,
              average_cost_price: 0, // We don't have historical cost basis from WebSocket for this source
              asset_type: 'crypto',
              currentPrice: currentPrice,
              costBasis: 0, // No cost basis from WebSocket balance feed
              currentValue: data.balance * currentPrice,
              gainLoss: 0,
              gainLossPercent: 0,
              is_simulation: false
            };
          });
        
        if (wsHoldings.length > 0) {
          console.log('[Portfolio] Using WebSocket holdings:', wsHoldings.length);
          return wsHoldings;
        }
      }
      
      // Fallback to Kraken API holdings
      if (krakenData?.holdings && krakenData.holdings.length > 0) {
        console.log('[Portfolio] Using Kraken API holdings:', krakenData.holdings.length);
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
      
      console.log('[Portfolio] No WebSocket or Kraken API holdings, using local (empty)');
      return holdings; // Fallback to local holdings (which might be empty)
    }
  }, [isSimMode, holdings, wsConnected, wsBalances, wsPrices, krakenData]); // Added wsPrices to dependencies

  // Get all symbols for price fetching
  const allSymbols = React.useMemo(() => {
    return [...new Set(effectiveHoldings.map(h => h.symbol))];
  }, [effectiveHoldings]);

  const { priceData, loading: pricesLoading } = usePriceData(allSymbols);

  // CRITICAL: Calculate detailed holdings with current prices
  const detailedHoldings = React.useMemo(() => {
    if (!effectiveHoldings || effectiveHoldings.length === 0) return [];

    return effectiveHoldings.map(holding => {
      let currentPrice = holding.currentPrice || 0; // Start with price already in effectiveHolding (from Kraken API or WS if applicable)
      
      // For SIM mode, use priceData (from usePriceData hook)
      if (isSimMode) {
        const priceInfo = priceData?.find(p => p.symbol === holding.symbol);
        currentPrice = priceInfo?.price || priceInfo?.current_price || currentPrice;
      }
      // For LIVE mode, if currentPrice was not already set by WS in effectiveHoldings, and wsPrices is available, use it.
      // This ensures that `currentPrice` from WS is prioritized.
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

  // CRITICAL: Calculate 24hr and lifetime PnL based on detailed holdings
  useEffect(() => {
    if (!detailedHoldings || detailedHoldings.length === 0) {
      setPortfolio24hrChange({ value: 0, percentage: 0 });
      setLifetimeChange({ value: 0, percentage: 0 });
      setIsCalculatingValue(false);
      return;
    }

    setIsCalculatingValue(true);

    try {
      const currentTotalValue = detailedHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
      let total24hrChangeValue = 0;
      
      // Calculate 24h change
      if (isSimMode) {
        detailedHoldings.forEach(h => {
          const priceInfo = priceData?.find(p => p.symbol === h.symbol);
          const pctRaw = priceInfo?.price_change_percentage_24h ?? priceInfo?.change ?? 0;
          const pct = typeof pctRaw === 'string' ? parseFloat(String(pctRaw).replace('%', '')) : (typeof pctRaw === 'number' ? pctRaw : 0);
          // If current value is available, apply percentage change to it to estimate 24hr change value
          total24hrChangeValue += (h.currentValue || 0) * (pct / 100);
        });
      } else {
        // For LIVE mode, try to get 24hr change from krakenData if available
        if (krakenData?.portfolio_24hr_change_usd !== undefined) {
          total24hrChangeValue = krakenData.portfolio_24hr_change_usd;
        } else {
          // If not in krakenData, try to calculate from individual holdings if they have 24h price change info from WS
          detailedHoldings.forEach(h => {
            const priceInfo = wsPrices?.[`${h.symbol}/USD`];
            const pctRaw = priceInfo?.change_24h_percent ?? 0; // Assuming WS prices might have 24h percentage change
            const pct = typeof pctRaw === 'string' ? parseFloat(String(pctRaw).replace('%', '')) : (typeof pctRaw === 'number' ? pctRaw : 0);
            total24hrChangeValue += (h.currentValue || 0) * (pct / 100);
          });
        }
      }

      const prevTotal24hr = currentTotalValue - total24hrChangeValue;
      const pct24h = prevTotal24hr > 0 ? (total24hrChangeValue / prevTotal24hr) * 100 : 0;
      setPortfolio24hrChange({ value: total24hrChangeValue, percentage: pct24h });

      // Calculate lifetime PnL
      let lifetimePnLValue = 0;
      let totalBuyCost = 0;

      if (isSimMode) {
        // In sim mode, calculate based on trades and current holdings
        totalBuyCost = trades.filter(t => t.type === 'buy' && t.is_simulation === isSimMode).reduce((sum, t) => sum + (t.total_value || 0), 0);
        const totalSellProceeds = trades.filter(t => t.type === 'sell' && t.is_simulation === isSimMode).reduce((sum, t) => sum + (t.total_value || 0), 0);
        lifetimePnLValue = totalSellProceeds + currentTotalValue - totalBuyCost;
      } else {
        // In live mode, use krakenData's total PnL if available
        if (krakenData?.total_unrealized_pnl_usd !== undefined) {
          lifetimePnLValue = krakenData.total_unrealized_pnl_usd;
          // Use Kraken's total cost basis or sum from detailed holdings if not available
          totalBuyCost = krakenData.total_cost_basis_usd || detailedHoldings.reduce((sum, h) => sum + (h.costBasis || 0), 0);
        } else {
          // If not from Kraken, sum up individual holding PnLs
          lifetimePnLValue = detailedHoldings.reduce((sum, h) => sum + (h.gainLoss || 0), 0);
          totalBuyCost = detailedHoldings.reduce((sum, h) => sum + (h.costBasis || 0), 0);
        }
      }

      const lifetimePct = totalBuyCost > 0 ? (lifetimePnLValue / totalBuyCost) * 100 : 0;
      setLifetimeChange({ value: lifetimePnLValue, percentage: lifetimePct });

    } catch (err) {
      console.error("[Portfolio] Failed to calculate PnL values:", err);
      setPortfolio24hrChange({ value: 0, percentage: 0 });
      setLifetimeChange({ value: 0, percentage: 0 });
    } finally {
      setIsCalculatingValue(false);
    }
  }, [detailedHoldings, isSimMode, priceData, krakenData, wsPrices, trades]); // Dependencies adjusted

  const executeTrade = async (tradeData) => {
    const tradeIsSimMode = isSimMode;

    try {
      await Trade.create({
        ...tradeData,
        status: 'executed',
        created_by: user.email,
        is_simulation: tradeIsSimMode
      });

      const freshHoldings = await Holding.filter({ created_by: user.email, is_simulation: tradeIsSimMode });
      const existingHolding = freshHoldings.find(h => h.symbol === tradeData.symbol);

      if (tradeData.type === 'buy') {
          if (existingHolding) {
              const newQuantity = existingHolding.quantity + tradeData.quantity;
              const oldTotalCost = existingHolding.average_cost_price * existingHolding.quantity;
              const newTotalCost = oldTotalCost + tradeData.total_value;
              const newAverageCost = newTotalCost / newQuantity;

              await Holding.update(existingHolding.id, {
                  quantity: newQuantity,
                  average_cost_price: newAverageCost
              });
          } else {
              await Holding.create({
                  symbol: tradeData.symbol,
                  asset_type: tradeData.asset_type,
                  quantity: tradeData.quantity,
                  average_cost_price: tradeData.price,
                  created_by: user.email,
                  is_simulation: tradeIsSimMode
              });
          }
      } else {
          if (existingHolding) {
              const newQuantity = existingHolding.quantity - tradeData.quantity;

              if (newQuantity <= 0.00001) {
                  await Holding.delete(existingHolding.id);
              } else {
                  await Holding.update(existingHolding.id, { quantity: newQuantity });
              }
          } else {
              throw new Error(`Cannot sell ${tradeData.symbol} - not found in holdings`);
          }
      }

      let updateData = {};
      
      if (tradeIsSimMode) {
        const newCashBalance = wallet.cash_balance - tradeData.total_value;
        updateData = { cash_balance: Math.max(0, newCashBalance) };
      } else {
        const newRealCashBalance = wallet.real_cash_balance - tradeData.total_value;
        updateData = { real_cash_balance: Math.max(0, newRealCashBalance) };
      }
      
      if (wallet?.id) {
        await Wallet.update(wallet.id, updateData);
      } else {
        const newWalletData = {
          cash_balance: tradeIsSimMode ? Math.max(0, updateData.cash_balance || 0) : 0,
          total_deposits: 0,
          total_withdrawals: 0,
          real_cash_balance: tradeIsSimMode ? 0 : Math.max(0, updateData.real_cash_balance || 0),
          real_total_deposits: 0,
          real_total_withdrawals: 0,
          created_by: user.email
        };
        await Wallet.create(newWalletData);
      }

      // Invalidate cache and reload
      window.__portfolioCache.data = null;
      window.__portfolioCache.timestamp = 0;
      await loadData(true);
      
      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { type: 'trade', source: 'portfolio' } }));
      
      if (!tradeIsSimMode) {
        refreshKraken();
      }
    } catch (err) {
      console.error("Error executing trade:", err);
      await loadData(true);
      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { type: 'trade_error', source: 'portfolio' } }));
    }
  };

  const handleSyncComplete = () => {
    setShowDataSync(false);
    window.__portfolioCache.data = null; // Invalidate cache
    window.__portfolioCache.timestamp = 0;
    loadData(true); // Force fresh load
    if (!isSimMode) {
      refreshKraken();
    }
  };

  // CRITICAL: Calculate cash and portfolio values correctly
  const currentCashBalance = React.useMemo(() => {
    if (isSimMode) {
      return wallet?.cash_balance || 0;
    }
    // LIVE MODE: Use WebSocket balance first, then Kraken API, then DB
    return (wsConnected && wsUsdBalance >= 0) ? wsUsdBalance : (krakenData?.usd_balance || wallet?.real_cash_balance || 0);
  }, [isSimMode, wallet, wsConnected, wsUsdBalance, krakenData]);
    
  const currentPortfolioValue = React.useMemo(() => {
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

  if (isLoading && !wallet && !user) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-48 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
        <div className="h-64 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
        <div className="h-96 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-8" style={{ backgroundColor: 'var(--primary-bg)' }}>
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4"
          role="alert"
        >
          <strong className="font-bold">Error!</strong>
          <span className="block sm:inline"> {error}</span>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <EmergencyRepair 
          wallet={wallet} 
          isSimMode={isSimMode}
          onRepairComplete={() => {
            window.__portfolioCache.data = null;
            window.__portfolioCache.timestamp = 0;
            setTimeout(() => loadData(true), 500);
          }}
        />
      </motion.div>

      {showDataSync && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <DataSync onSyncComplete={handleSyncComplete} />
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <PortfolioSummary
          wallet={wallet}
          trades={trades}
          currentPortfolioValue={currentPortfolioValue}
          isLoading={isCalculatingValue || krakenLoading || pricesLoading || wsLoading}
          isSimMode={isSimMode}
          change24hr={portfolio24hrChange}
          lifetimeChange={lifetimeChange}
          onSyncClick={() => {
            if (!isSimMode) {
              refreshKraken();
            } else {
              setShowDataSync(true);
            }
          }}
          krakenData={krakenData}
        />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <AssetAllocation
          allocations={detailedHoldings}
          isLoading={isCalculatingValue || krakenLoading || pricesLoading || wsLoading}
        />
      </motion.div>
      
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <OpenAndConditionalOrders />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <TradingInterface
          wallet={wallet}
          onTrade={executeTrade}
          autoTradingEnabled={settings?.auto_trading_enabled || false}
          holdings={detailedHoldings}
          isSimMode={isSimMode}
          currentCashBalance={currentCashBalance}
        />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
        <AutoBuyPreferences />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <TradeHistory trades={trades} />
      </motion.div>
    </div>
  );
}
