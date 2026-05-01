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

import EmergencyRepair from "../components/wallet/EmergencyRepair";

import { usePriceData } from "@/components/hooks/usePriceData";
import { useBracketOrderSync } from "@/components/hooks/useBracketOrderSync";
import { useKrakenWebSocket } from "@/components/providers/KrakenWebSocketProvider";
import { useSettings } from "@/components/utils/SettingsContext";
import { getRecent, setRecent } from "@/components/hooks/useGlobalDataStore";



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

  // CRITICAL: Use SettingsContext as THE source of truth for mode
  // This prevents pages from incorrectly defaulting to sim mode during rate limits
  const { settings: ctxSettings, isLoading: ctxSettingsLoading } = useSettings();
  const isSimMode = ctxSettings ? (ctxSettings.sim_trading_mode !== false) : null;

  // CRITICAL: Use CENTRALIZED WebSocket provider - single source of truth for ALL Kraken data
  // WebSocket = live data, REST snapshot = initial load only
  const {
    isConnected: wsConnected,
    usdBalance: wsUsdBalance,
    cryptoHoldingsValue: wsCryptoValue,
    balances: wsBalances,
    prices: wsPrices,
    // REST snapshot data (initial load + recovery only)
    krakenBalance,
    krakenPnL,
    krakenOrders,
    restDataLoading: krakenLoading,
    fetchKrakenData
  } = useKrakenWebSocket();

  // CRITICAL: krakenData from provider's REST snapshot (initial load)
  // Live updates come from WebSocket (wsBalances, wsPrices)
  const krakenData = krakenBalance;

  // CRITICAL: Bracket order sync - auto-cancels paired orders when one is filled
  useBracketOrderSync(isSimMode, user?.email);

  const loadData = useCallback(async (force = false) => {
    // CRITICAL: Don't load data until we know the mode
    if (isSimMode === null) return;

    // CROSS-PAGE CHECK: If Dashboard just loaded everything, reuse it
    const walletKey = 'wallet';
    const tradeKey = `trades_${isSimMode ? 'sim' : 'real'}`;
    const holdingKey = `holdings_${isSimMode ? 'sim' : 'real'}`;
    
    if (!force) {
      const recentWallet = getRecent(walletKey);
      const recentTrades = getRecent(tradeKey);
      const recentHoldings = getRecent(holdingKey);
      
      if (recentWallet && recentTrades && recentHoldings) {
        console.log('[Portfolio] Using cross-page cached data (< 15s old)');
        const currentUser = await base44.auth.me();
        setUser(currentUser);
        setSettings(ctxSettings);
        setWallet(recentWallet);
        setTrades(recentTrades);
        setHoldings(recentHoldings);
        setShowDataSync(isSimMode && recentTrades.length > 0 && recentHoldings.length === 0);
        setError(null);
        setIsLoading(false);
        return;
      }
    }
    
    setIsLoading(true);
    console.log('[Portfolio] Fetching fresh data, isSimMode:', isSimMode);
    try {
      const currentUser = await Promise.race([
        base44.auth.me(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 5000))
      ]);

      // CRITICAL: Use isSimMode from SettingsContext - don't re-fetch settings
      const [userWalletArr, userTradesArr, userHoldingsArr] = await Promise.all([
        Wallet.filter({ created_by: currentUser.email }, "-updated_date", 1),
        Trade.filter({ created_by: currentUser.email, is_simulation: isSimMode }, "-created_date", 200),
        Holding.filter({ created_by: currentUser.email, is_simulation: isSimMode }, "-updated_date", 500)
      ]);

      const effectiveSimMode = isSimMode;
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
      setSettings(ctxSettings);
      setWallet(currentWallet);
      setTrades(userTradesArr);
      setHoldings(userHoldingsArr);
      // Store for cross-page reuse
      setRecent('wallet', currentWallet);
      setRecent(`trades_${isSimMode ? 'sim' : 'real'}`, userTradesArr);
      setRecent(`holdings_${isSimMode ? 'sim' : 'real'}`, userHoldingsArr);
      setShowDataSync(effectiveSimMode && userTradesArr.length > 0 && userHoldingsArr.length === 0);
      setError(null);
    } catch (err) {
      console.error('[Portfolio] Loading error:', err);
      setError('Failed to load portfolio data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [isSimMode, ctxSettings]);

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

  // CRITICAL: Build holdings - REST API is PRIMARY in LIVE mode (has accurate prices + cost basis)
  // WebSocket only has raw quantities without prices - not useful for display
  const effectiveHoldings = React.useMemo(() => {
    if (isSimMode) {
      return holdings;
    } else {
      // LIVE MODE: REST snapshot is PRIMARY (has accurate prices from Kraken Ticker API)
      if (krakenData?.success && krakenData?.holdings && krakenData.holdings.length > 0) {
        console.log('[Portfolio] Using REST snapshot holdings (authoritative)');
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
      // Fallback to WebSocket (only has quantities, prices may be 0 or stale)
      if (wsConnected && wsBalances && Object.keys(wsBalances).length > 0) {
        console.log('[Portfolio] Using WebSocket balances (fallback - no REST data yet)');
        return Object.entries(wsBalances)
          .filter(([asset]) => asset !== 'USD' && asset !== 'ZUSD')
          .filter(([_, balance]) => (balance.balance || 0) > 0.00001)
          .map(([asset, balance]) => {
            const pair = `${asset}/USD`;
            const priceInfo = wsPrices?.[pair];
            const price = priceInfo?.price || 0;
            const qty = balance.balance || 0;
            
            return {
              symbol: asset,
              quantity: qty,
              average_cost_price: price,
              asset_type: 'crypto',
              currentPrice: price,
              costBasis: qty * price,
              currentValue: qty * price,
              gainLoss: 0,
              gainLossPercent: 0,
              is_simulation: false
            };
          });
      }
      // Final fallback: DB holdings for LIVE mode only
      return holdings.filter(h => h.is_simulation === false);
    }
  }, [isSimMode, holdings, wsConnected, wsBalances, wsPrices, krakenData]);

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
          
          // CRITICAL: Only set PnL here if krakenPnL is NOT available
          // When krakenPnL is available, the dedicated useEffect below handles it with accurate data
          if (!krakenPnL?.success) {
            const currentTotalValue = updated.reduce((sum, h) => sum + h.currentValue, 0);
            const totalCostBasis = updated.reduce((sum, h) => sum + h.costBasis, 0);
            
            const lifetimePnL = currentTotalValue - totalCostBasis;
            const lifetimePct = totalCostBasis > 0 ? (lifetimePnL / totalCostBasis) * 100 : 0;
            
            setLifetimeChange({ value: lifetimePnL, percentage: lifetimePct });
            setPortfolio24hrChange({ value: 0, percentage: 0 });
            
            console.log('[Portfolio] LIVE calculated (no krakenPnL):', {
              totalValue: currentTotalValue.toFixed(2),
              costBasis: totalCostBasis.toFixed(2),
              pnl: lifetimePnL.toFixed(2)
            });
          }
          
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
  }, [effectiveHoldings, priceData, trades, isSimMode, krakenData, krakenPnL]);

  // CRITICAL: Use centralized PnL from provider - no direct API calls needed
  React.useEffect(() => {
    if (isSimMode || !krakenPnL?.success) return;
    
    const pnl24h = krakenPnL.pnl_24h || 0;
    const lifetimePnL = krakenPnL.pnl_lifetime || 0;
    
    // Calculate percentages based on current portfolio value
    const currentValue = wsCryptoValue > 0 ? wsCryptoValue : 
      (krakenData?.total_crypto_value || effectiveHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0));
    const costBasis = currentValue - lifetimePnL;
    const lifetimePct = costBasis > 0 ? (lifetimePnL / costBasis) * 100 : 0;
    
    setLifetimeChange({ value: lifetimePnL, percentage: lifetimePct });
    setPortfolio24hrChange({ value: pnl24h, percentage: costBasis > 0 ? (pnl24h / costBasis) * 100 : 0 });
    
    console.log('[Portfolio] Kraken PnL from provider:', {
      pnl_24h: pnl24h.toFixed(2),
      lifetime: lifetimePnL.toFixed(2)
    });
  }, [isSimMode, krakenPnL, wsCryptoValue, krakenData, effectiveHoldings]);

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
        fetchKrakenData(true);
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
      fetchKrakenData(true);
    }
  };

  // CRITICAL: Provider priority is REST > WS > DB
  // REST API (getKrakenBalance) returns accurate prices+balances, WS only has raw quantities
  const currentCashBalance = isSimMode
    ? (wallet?.cash_balance || 0)
    : (wsUsdBalance > 0 ? wsUsdBalance : (wallet?.real_cash_balance || 0));
    
  const currentPortfolioValue = isSimMode
    ? detailedHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0)
    : (wsCryptoValue > 0
        ? wsCryptoValue
        : detailedHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0));

  if (isSimMode === null || ctxSettingsLoading || (isLoading && !wallet && !user)) {
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
              fetchKrakenData(true);
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