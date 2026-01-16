import React, { useState, useEffect, useCallback } from "react";
import { Trade, Wallet, UserSettings, User, Holding } from "@/entities/all";
import { motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import { InvokeLLM } from "@/integrations/Core"; 

import PortfolioSummary from "../components/portfolio/PortfolioSummary";
import AssetAllocation from "../components/portfolio/AssetAllocation";
import TradingInterface from "../components/portfolio/TradingInterface";
import OrdersAndHistory from "../components/portfolio/OrdersAndHistory";
import DataSync from "../components/portfolio/DataSync";
import { base44 } from "@/api/base44Client";
import AutoBuyPreferences from "../components/portfolio/AutoBuyPreferences";
import AutoTraderHealth from "../components/settings/AutoTraderHealth";
import EmergencyRepair from "../components/wallet/EmergencyRepair";

import { usePriceData } from "@/components/hooks/usePriceData";
import { useBracketOrderSync } from "@/components/hooks/useBracketOrderSync";
import { useKrakenWebSocket } from "@/components/providers/KrakenWebSocketProvider";



export default function Portfolio() {
  const [trades, setTrades] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [settings, setSettings] = useState(null);
  const [user, setUser] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [detailedHoldings, setDetailedHoldings] = useState([]);
  const [isCalculatingValue, setIsCalculatingValue] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showDataSync, setShowDataSync] = useState(false);
  const [portfolio24hrChange, setPortfolio24hrChange] = useState({ value: 0, percentage: 0 });
  const [lifetimeChange, setLifetimeChange] = useState({ value: 0, percentage: 0 });
  const location = useLocation();

  const [error, setError] = useState(null);

  // CRITICAL: Determine sim mode FIRST
  const isSimMode = settings ? (settings.sim_trading_mode !== false) : false;

  // CRITICAL: Use global WebSocket connection
  const {
    isConnected: wsConnected,
    usdBalance: wsUsdBalance,
    cryptoHoldingsValue: wsCryptoValue,
    balances: wsBalances,
    prices: wsPrices
  } = useKrakenWebSocket();

  // LIVE mode: fetch Kraken balance directly (no client cache)
  const [krakenData, setKrakenData] = useState(null);
  const [krakenLoading, setKrakenLoading] = useState(false);
  const fetchKrakenLive = useCallback(async () => {
    if (isSimMode) return;
    setKrakenLoading(true);
    try {
      const res = await base44.functions.invoke('getKrakenBalance', {});
      const data = res?.data || res;
      setKrakenData(data?.success ? data : null);
    } finally {
      setKrakenLoading(false);
    }
  }, [isSimMode]);

  useEffect(() => {
    if (!isSimMode) fetchKrakenLive();
  }, [isSimMode, fetchKrakenLive]);

  useEffect(() => {
    const handler = () => fetchKrakenLive();
    window.addEventListener('trade:completed', handler);
    window.addEventListener('kraken:synced', handler);
    return () => {
      window.removeEventListener('trade:completed', handler);
      window.removeEventListener('kraken:synced', handler);
    };
  }, [fetchKrakenLive]);

  // CRITICAL: Bracket order sync - auto-cancels paired orders when one is filled
  useBracketOrderSync(isSimMode, user?.email);

  const loadData = useCallback(async (force = false) => {
    setIsLoading(true);
    console.log('[Portfolio] Fetching fresh data (no cache)...');
    try {
      const [currentUser, userSettingsResult, userWalletArr, userTradesArr, userHoldingsArr] = await Promise.all([
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
      const currentSettings = userSettingsResult[0] || { sim_trading_mode: true };
      if (!isAdmin && !isCreator) currentSettings.sim_trading_mode = true;

      const effectiveSimMode = currentSettings.sim_trading_mode !== false;
      let currentWallet = userWalletArr[0];

      // Wallet initialization logic retained
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
        } else if (!currentWallet.last_cash_build_up_time || (Date.now() - currentWallet.last_cash_build_up_time) >= cashBuildUpInterval) {
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

      setUser(currentUser);
      setSettings(currentSettings);
      setWallet(currentWallet);
      setTrades(userTradesArr);
      setHoldings(userHoldingsArr);
      setShowDataSync(effectiveSimMode && userTradesArr.length > 0 && userHoldingsArr.length === 0);
      setError(null);
    } catch (err) {
      console.error('[Portfolio] Loading error:', err);
      setError('Failed to load portfolio data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const onDataUpdated = () => {
      // Reload fresh data (no cache)
      loadData(true);
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
      // SIM MODE: Use local holdings
      return holdings;
    } else {
      // LIVE MODE: Use Kraken holdings if available
      if (krakenData?.holdings && krakenData.holdings.length > 0) {
        console.log('[Portfolio] Using Kraken holdings in LIVE mode:', krakenData.holdings.length);
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
      } else {
        console.log('[Portfolio] No Kraken holdings, using local (empty)');
        return holdings;
      }
    }
  }, [isSimMode, holdings, krakenData]);

  // Get all symbols for price fetching
  const allSymbols = React.useMemo(() => {
    return [...new Set(effectiveHoldings.map(h => h.symbol))];
  }, [effectiveHoldings]);

  const { priceData, loading: pricesLoading } = usePriceData(allSymbols);

  // Calculate detailed holdings with prices
  useEffect(() => {
    if (!effectiveHoldings || effectiveHoldings.length === 0) {
        console.log('[Portfolio] No holdings to process');
        setDetailedHoldings([]);
        setPortfolio24hrChange({ value: 0, percentage: 0 });
        setLifetimeChange({ value: 0, percentage: 0 });
        setIsCalculatingValue(false);
        return;
    }

    setIsCalculatingValue(true);

    try {
        console.log('[Portfolio] Processing', effectiveHoldings.length, 'holdings with', priceData?.length || 0, 'prices');

        // If LIVE mode and Kraken data already has prices, use them directly
        if (!isSimMode && krakenData?.holdings) {
          const updated = effectiveHoldings.map(h => ({
            ...h,
            currentPrice: h.currentPrice || h.average_cost_price,
            currentValue: h.currentValue || (h.quantity * h.average_cost_price),
            costBasis: h.costBasis || (h.quantity * h.average_cost_price),
            gainLoss: h.gainLoss || 0,
            gainLossPercent: h.gainLossPercent || 0
          }));
          
          setDetailedHoldings(updated);
          
          const currentTotalValue = updated.reduce((sum, h) => sum + h.currentValue, 0);
          const totalCostBasis = updated.reduce((sum, h) => sum + h.costBasis, 0);
          
          // Calculate lifetime PnL
          const lifetimePnL = currentTotalValue - totalCostBasis;
          const lifetimePct = totalCostBasis > 0 ? (lifetimePnL / totalCostBasis) * 100 : 0;
          
          setLifetimeChange({ value: lifetimePnL, percentage: lifetimePct });
          setPortfolio24hrChange({ value: 0, percentage: 0 }); // TODO: Calculate from Kraken if available
          
          console.log('[Portfolio] LIVE calculated:', {
            totalValue: currentTotalValue.toFixed(2),
            costBasis: totalCostBasis.toFixed(2),
            pnl: lifetimePnL.toFixed(2)
          });
          
        } else {
          // SIM MODE: Fetch prices and calculate
          const updatedHoldings = effectiveHoldings.map(holding => {
              const priceInfo = priceData?.find(p => p.symbol === holding.symbol);
              const currentPrice = priceInfo?.price || priceInfo?.current_price || holding.average_cost_price || 0;
              const currentValue = holding.quantity * currentPrice;
              const costBasis = holding.quantity * holding.average_cost_price;
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
          
          setDetailedHoldings(updatedHoldings);

          const currentTotalValue = updatedHoldings.reduce((sum, h) => sum + h.currentValue, 0);
          
          // Calculate 24h change
          let totalDelta24h = 0;
          updatedHoldings.forEach(h => {
              const priceInfo = priceData?.find(p => p.symbol === h.symbol);
              const pctRaw = priceInfo?.price_change_percentage_24h ?? priceInfo?.change ?? 0;
              const pct = typeof pctRaw === 'string' ? parseFloat(String(pctRaw).replace('%', '')) : (typeof pctRaw === 'number' ? pctRaw : 0);
              totalDelta24h += (h.currentValue || 0) * (pct / 100);
          });
          const prevTotal = currentTotalValue - totalDelta24h;
          const pct24h = prevTotal > 0 ? (totalDelta24h / prevTotal) * 100 : 0;
          setPortfolio24hrChange({ value: totalDelta24h, percentage: pct24h });

          // Calculate lifetime PnL
          const totalBuyCost = trades.filter(t => t.type === 'buy' && t.is_simulation === isSimMode).reduce((sum, t) => sum + (t.total_value || 0), 0);
          const totalSellProceeds = trades.filter(t => t.type === 'sell' && t.is_simulation === isSimMode).reduce((sum, t) => sum + (t.total_value || 0), 0);
          const lifetimePnL = totalSellProceeds + currentTotalValue - totalBuyCost;
          const lifetimePct = totalBuyCost > 0 ? (lifetimePnL / totalBuyCost) * 100 : 0;
          setLifetimeChange({ value: lifetimePnL, percentage: lifetimePct });
        }
    } catch (err) {
        console.error("[Portfolio] Failed to calculate values:", err);
    } finally {
        setIsCalculatingValue(false);
    }
  }, [effectiveHoldings, priceData, trades, isSimMode, krakenData]);

  // CRITICAL: For LIVE mode, fetch REAL PnL from Kraken via getKrakenPnL endpoint
  const [krakenPnL, setKrakenPnL] = React.useState(null);
  
  React.useEffect(() => {
    if (isSimMode) {
      setKrakenPnL(null);
      return;
    }
    
    const fetchKrakenPnL = async () => {
      try {
        const response = await base44.functions.invoke('getKrakenPnL', {});
        const data = response?.data || response;
        
        if (data?.success) {
          setKrakenPnL(data);
          
          // Update 24h and Lifetime changes from REAL Kraken data
          const pnl24h = data.pnl_24h || 0;
          const lifetimePnL = data.pnl_lifetime || 0;
          
          // Calculate percentages based on current portfolio value
          const currentValue = wsCryptoValue > 0 ? wsCryptoValue : 
            (krakenData?.total_crypto_value || effectiveHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0));
          const costBasis = currentValue - lifetimePnL;
          const lifetimePct = costBasis > 0 ? (lifetimePnL / costBasis) * 100 : 0;
          
          setLifetimeChange({ value: lifetimePnL, percentage: lifetimePct });
          setPortfolio24hrChange({ value: pnl24h, percentage: costBasis > 0 ? (pnl24h / costBasis) * 100 : 0 });
          
          console.log('[Portfolio] Kraken PnL updated:', {
            pnl_24h: pnl24h.toFixed(2),
            lifetime: lifetimePnL.toFixed(2),
            lifetimePct: lifetimePct.toFixed(2)
          });
        }
      } catch (err) {
        console.error('[Portfolio] Kraken PnL fetch failed:', err);
      }
    };
    
    fetchKrakenPnL();
    
    // Refresh every 60 seconds
    const interval = setInterval(fetchKrakenPnL, 60000);
    return () => clearInterval(interval);
  }, [isSimMode, wsCryptoValue, krakenData, effectiveHoldings]);

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

      await loadData(true);
      
      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { type: 'trade', source: 'portfolio' } }));
      
      if (!tradeIsSimMode) {
        fetchKrakenLive();
      }
    } catch (err) {
      console.error("Error executing trade:", err);
      await loadData(true);
      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { type: 'trade_error', source: 'portfolio' } }));
    }
  };

  const handleSyncComplete = () => {
    setShowDataSync(false);
    loadData(true); // Force fresh load
    if (!isSimMode) {
      fetchKrakenLive();
    }
  };

  // CRITICAL: Use REST API (krakenData) as PRIMARY source - it's most reliable
  // WebSocket can return stale/zero data
  // krakenData uses getKrakenBalance which now calls BalanceEx to get TOTAL (including locked orders)
  const currentCashBalance = isSimMode 
    ? (wallet?.cash_balance || 0) 
    : (
        // REST API first (krakenData from useKrakenData hook)
        // This now includes locked amounts via BalanceEx
        (krakenData?.usd_balance > 0) ? krakenData.usd_balance :
        // WebSocket fallback
        (wsConnected && wsUsdBalance > 0) ? wsUsdBalance :
        // Wallet DB last resort
        (wallet?.real_cash_balance || 0)
      );
    
  const currentPortfolioValue = isSimMode
    ? detailedHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0)
    : (
        // REST API first (krakenData from useKrakenData hook)
        // Use total_crypto_value_usd - this now includes locked amounts via BalanceEx
        (krakenData?.total_crypto_value_usd > 0) ? krakenData.total_crypto_value_usd :
        // Fallback to old field name
        (krakenData?.total_crypto_value > 0) ? krakenData.total_crypto_value :
        // WebSocket fallback
        (wsConnected && wsCryptoValue > 0) ? wsCryptoValue :
        // Calculated from holdings last resort
        detailedHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0)
      );

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
          isLoading={isCalculatingValue || krakenLoading}
          isSimMode={isSimMode}
          change24hr={portfolio24hrChange}
          lifetimeChange={lifetimeChange}
          onSyncClick={() => {
            if (!isSimMode) {
              fetchKrakenLive();
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
          isLoading={isCalculatingValue || krakenLoading || pricesLoading}
        />
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

      {/* Auto-Trader Status - Below Auto-Buy Preferences */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
        <AutoTraderHealth />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <OrdersAndHistory 
          trades={trades} 
          isSimMode={isSimMode}
          onRefresh={() => {
            loadData(true);
          }}
        />
      </motion.div>
    </div>
  );
}