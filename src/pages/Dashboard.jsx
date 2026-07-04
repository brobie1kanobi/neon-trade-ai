import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { DollarSign, Activity } from "lucide-react";
import { createPageUrl } from "@/utils";
import { motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSettings } from "../components/utils/SettingsContext";
import { base44 } from "@/api/base44Client";

// useAutoTrader now delegates to backend - no direct entity imports needed

// Import centralized hooks with direct file paths
import { useWallet } from "@/components/hooks/useWallet";
import { useTrades } from "@/components/hooks/useTrades";
import { useHoldings } from "@/components/hooks/useHoldings";
import { useUser } from "@/components/hooks/useUser";
import { invalidateCache } from "@/components/hooks/useDataFetching";
import { usePriceData } from "@/components/hooks/usePriceData";
import { useKrakenWebSocket } from "@/components/providers/KrakenWebSocketProvider";
import { useBracketOrderSync } from "@/components/hooks/useBracketOrderSync";
import { useConditionalOrderMonitor } from "@/components/hooks/useConditionalOrderMonitor";

import BalanceCard from "../components/dashboard/BalanceCard";
import RecentTrades from "../components/dashboard/RecentTrades";
import PerformanceChart from "../components/dashboard/PerformanceChart";
import QuickActions from "../components/dashboard/QuickActions";
import TradeDetailsModal from "../components/dashboard/TradeDetailsModal";
import CryptoMarketOverview from "../components/dashboard/CryptoMarketOverview";
import CryptoPriceChart from "../components/dashboard/CryptoPriceChart";
import StockPriceChart from "../components/dashboard/StockPriceChart";


/**
 * useAutoTrader - CENTRALIZED BACKEND TRIGGER
 * 
 * All trade execution logic now lives in the backend `runAutoTrader` function.
 * This hook ONLY triggers the backend at a controlled interval and displays results.
 * This eliminates duplicate orders caused by both frontend and backend placing trades.
 */
/**
 * useAutoTrader — SINGLETON trigger for the backend auto-trader.
 *
 * Cooldown is enforced at THREE levels to prevent rapid-fire runs:
 * 1. Module-level state (survives React re-renders within a single tab)
 * 2. localStorage (coordinates across multiple browser tabs)
 * 3. Backend-side cooldown (rejects runs < 4 min after the last completed one)
 */
const AUTO_TRADER_COOLDOWN_MS = 300000; // 5 minutes between runs
const AUTO_TRADER_INTERVAL_MS = 300000; // 5 minute polling interval
const LS_KEY = 'autoTrader_lastRunTs';

// Module-level state (per-tab singleton)
let _atIsRunning = false;
let _atMountCount = 0;

function getLastRunTs() {
  try {
    return parseInt(localStorage.getItem(LS_KEY) || '0', 10) || 0;
  } catch { return 0; }
}
function setLastRunTs(ts) {
  try { localStorage.setItem(LS_KEY, String(ts)); } catch {}
}

const useAutoTrader = (settings, user) => {
  useEffect(() => {
    if (!settings?.auto_trading_enabled || !user?.email) return;

    _atMountCount++;
    const thisMountId = _atMountCount;

    const triggerBackendAutoTrader = async () => {
      if (_atIsRunning) return;
      const now = Date.now();
      const lastRun = getLastRunTs();
      if (lastRun && (now - lastRun) < AUTO_TRADER_COOLDOWN_MS) {
        console.log(`[AutoTrader] Cooldown active (${Math.round((AUTO_TRADER_COOLDOWN_MS - (now - lastRun)) / 1000)}s remaining)`);
        return;
      }
      _atIsRunning = true;
      // Optimistically stamp BEFORE the call so other tabs see it immediately
      setLastRunTs(now);

      console.log('[AutoTrader] Triggering backend runAutoTrader...');

      try {
        const response = await base44.functions.invoke('runAutoTrader', {});
        const data = response?.data || response;

        console.log('[AutoTrader] Backend response:', {
          success: data?.success,
          trades_count: data?.trades_count,
          mode: data?.mode,
          message: data?.message
        });

        if (data?.trades_count > 0) {
          const modeLabel = data.mode === 'live' ? '🟢 LIVE' : '💎 SIM';
          toast.success(`${modeLabel} Auto-Trader: ${data.trades_count} trade(s) executed`, {
            description: data.trades?.map(t => `${t.symbol} @ $${t.price?.toFixed(2)}`).join(', ') || '',
            duration: 5000
          });

          invalidateCache();
          window.dispatchEvent(new CustomEvent('trade:completed', { detail: { timestamp: Date.now() } }));
        }
      } catch (e) {
        const msg = (e?.message || e?.toString()) || '';
        console.error('[AutoTrader] Backend trigger failed:', msg);
      } finally {
        _atIsRunning = false;
        setLastRunTs(Date.now());
      }
    };

    // First mount: 15s delay. Re-mounts: defer to next interval tick.
    const initialDelay = thisMountId === 1 ? 15000 : AUTO_TRADER_COOLDOWN_MS;
    const mountDelay = setTimeout(triggerBackendAutoTrader, initialDelay);

    const interval = setInterval(triggerBackendAutoTrader, AUTO_TRADER_INTERVAL_MS);
    return () => { clearTimeout(mountDelay); clearInterval(interval); };
  }, [settings?.auto_trading_enabled, user?.email]);
};

// GLOBAL TRADE LOCK: Prevent simultaneous trades (used by handleTradeExecuted for manual trades)
if (typeof window !== 'undefined') {
  window.__tradeLock = window.__tradeLock || {
    isLocked: false,
    queue: [],
    lastTrade: null
  };
}

export default function Dashboard() {
  const { settings, isLoading: settingsLoading } = useSettings();
  const location = useLocation();
  
  // CRITICAL: Derive sim mode from SettingsContext - single source of truth
  // Use null while loading to prevent rendering with wrong mode
  const isSimMode = settings ? (settings.sim_trading_mode !== false) : null;
  const { wallet, loading: walletLoading, refresh: refreshWallet } = useWallet();
  const { trades, loading: tradesLoading, addTrade } = useTrades(isSimMode);
  const { holdings, loading: holdingsLoading, refresh: refreshHoldings } = useHoldings(isSimMode);
  const { user } = useUser();
  
  // CRITICAL: Use global WebSocket provider (single source of truth for live data)
  const {
    isConnected: wsConnectedFromProvider,
    usdBalance: wsUsdBalance,
    cryptoHoldingsValue: wsCryptoValue,
    totalPortfolioValue: wsTotalValue,
    totalAssets: wsTotalAssets,
    balances: wsBalances,
    prices: wsPrices,
    wsManager,
    bestHoldings: providerBestHoldings,
    hasData: providerHasData,
    krakenBalance: providerKrakenBalance,
    krakenPnL: providerKrakenPnL,
    restDataLoading: providerLoading,
    fetchKrakenData,
    fetchPnL: providerFetchPnL,
    wsUpdateCounter
  } = useKrakenWebSocket();
  
  // CRITICAL: Also check global window state - provider React state can be stale
  const wsConnected = wsConnectedFromProvider || (typeof window !== 'undefined' && window.__krakenWsConnected);
  // Consider REST snapshot as the source of truth; show UI only after it loads
  const hasKrakenSnapshot = !isSimMode && !!(providerKrakenBalance && providerKrakenBalance.connected);
  
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [change24h, setChange24h] = useState({ value: 0, percentage: 0 });
  const [portfolioMarketValue, setPortfolioMarketValue] = useState(0);
  const [chartSelection, setChartSelection] = useState({ assetType: "crypto", symbol: null });
  const [realized24h, setRealized24h] = useState({ value: 0, percentage: 0 });
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const [startY, setStartY] = useState(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [enrichedHoldings, setEnrichedHoldings] = useState([]);
  const [lifetimeChange, setLifetimeChange] = useState({ value: 0, percentage: 0 });
  
  // Provider now exposes merged best-available data (WS > REST).
  // No local krakenApiBalances state needed – derive directly from provider.

  // effectiveHoldings: provider merges REST > WS > DB (REST is authoritative)
  const effectiveHoldings = React.useMemo(() => {
    if (isSimMode) return holdings;
    // LIVE: Provider has merged REST (authoritative) + WS (fallback) into bestHoldings
    if (providerBestHoldings && providerBestHoldings.length > 0) {
      return providerBestHoldings;
    }
    // Final fallback: live DB holdings only
    return holdings.filter(h => h.is_simulation === false);
  }, [isSimMode, holdings, providerBestHoldings]);

  const allSymbols = React.useMemo(() => {
    const holdingSyms = effectiveHoldings.map(h => (h.symbol || "").toUpperCase());
    const watchedSyms = (settings?.watched_crypto || []).map(s => (s || "").toUpperCase());
    return [...new Set([...holdingSyms, ...watchedSyms])];
  }, [effectiveHoldings, settings?.watched_crypto]);
  
  // Ensure WebSocket is subscribed to all relevant tickers (holdings + watchlist)
  React.useEffect(() => {
    if (!wsConnected || !wsManager) return;
    const toPair = (s) => (typeof s === 'string' && s.includes('/') ? s : `${String(s || '').toUpperCase()}/USD`);
    const symbols = allSymbols.map(toPair);
    if (symbols.length > 0) {
      wsManager.subscribe('ticker', { symbols });
    }
  }, [wsConnected, wsManager, allSymbols.join(',')]);

  const { priceData, loading: pricesLoading, refresh: refreshPrices } = usePriceData(allSymbols);

  const isLoading = walletLoading || tradesLoading || holdingsLoading || pricesLoading;

  useEffect(() => {
    const cryptoSym = (settings?.watched_crypto && settings.watched_crypto[0]) || "BTC";
    setChartSelection({ assetType: "crypto", symbol: cryptoSym });
  }, [settings]);

  useEffect(() => {
    const handler = (e) => {
      const det = e.detail || {};
      const { assetType, symbol } = det;
      if (assetType && symbol) setChartSelection({ assetType, symbol });
    };
    window.addEventListener("dashboard:chart-symbol", handler);
    return () => window.removeEventListener("dashboard:chart-symbol", handler);
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const timestamp = urlParams.get("t");

    if (timestamp) {
      invalidateCache();
      
      setTimeout(() => {
        refreshWallet();
        refreshHoldings();
        refreshPrices();
      }, 100);
      
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [location.search, refreshWallet, refreshHoldings, refreshPrices]);

  useEffect(() => {
    const handleDataRefresh = () => {
      setTimeout(() => {
        refreshWallet();
        refreshHoldings();
        refreshPrices();
      }, 500);
    };

    // CRITICAL: Also listen for Kraken order fill/cancel events from WebSocket
    // These fire when TP/SL orders execute on Kraken, even if the app didn't initiate them
    const handleKrakenOrderEvent = () => {
      console.log('[Dashboard] Kraken order event – refreshing all data');
      invalidateCache();
      setTimeout(() => {
        refreshWallet();
        refreshHoldings();
        refreshPrices();
        if (!isSimMode && fetchKrakenData) {
          fetchKrakenData(true);
        }
      }, 2000);
    };

    window.addEventListener('kraken:synced', handleDataRefresh);
    window.addEventListener('trade:completed', handleDataRefresh);
    window.addEventListener('kraken:order-filled', handleKrakenOrderEvent);
    window.addEventListener('kraken:order-canceled', handleKrakenOrderEvent);
    // NOTE: Do NOT listen to 'kraken:balance-update' here — it fires every ~10s
    // from the WS provider and causes flickering by triggering DB refetches that
    // return different values than the WS-computed ones. The provider context
    // already pushes live balance data via its state; DB data is only needed
    // on actual trade/sync events.
    
    return () => {
      window.removeEventListener('kraken:synced', handleDataRefresh);
      window.removeEventListener('trade:completed', handleDataRefresh);
      window.removeEventListener('kraken:order-filled', handleKrakenOrderEvent);
      window.removeEventListener('kraken:order-canceled', handleKrakenOrderEvent);
    };
  }, [refreshWallet, refreshHoldings, refreshPrices, isSimMode, fetchKrakenData]);

  const handleTouchStart = (e) => setStartY(e.touches[0].clientY);

  const handleTouchMove = (e) => {
    const currentY = e.touches[0].clientY;
    const distance = currentY - startY;
    if (distance > 0 && window.scrollY === 0) {
      setPullDistance(Math.min(distance, 100));
      e.preventDefault();
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance > 60) {
      setIsPullRefreshing(true);
      invalidateCache();
      const refreshPromises = [
        refreshWallet(),
        refreshHoldings(),
        refreshPrices()
      ];
      Promise.all(refreshPromises).finally(() => {
        setIsPullRefreshing(false);
        setPullDistance(0);
      });
    } else {
      setPullDistance(0);
    }
  };

  const handleTradeExecuted = useCallback(
    async (tradeData) => {
      if (!user?.email) return;

      const tradeLock = window.__tradeLock;
      const isSimModeLocal = settings?.sim_trading_mode === true;
      const tradeType = (tradeData.type || "").toLowerCase();

      if (tradeLock.lastTrade) {
        const timeSince = Date.now() - tradeLock.lastTrade.timestamp;
        const isSameSymbol = tradeLock.lastTrade.symbol === tradeData.symbol;
        const isSameType = tradeLock.lastTrade.type === tradeType;
        const isSameAmount = Math.abs(tradeLock.lastTrade.total_value - (tradeData.total_value || 0)) < 0.01;
        
        if (timeSince < 5000 && isSameSymbol && isSameType && isSameAmount) {
          toast.error("Duplicate trade blocked", {
            description: `${tradeData.symbol} ${tradeType} was just executed`
          });
          return;
        }
      }

      if (tradeLock.isLocked) {
        return new Promise((resolve) => {
          tradeLock.queue.push({ tradeData, resolve });
        });
      }

      tradeLock.isLocked = true;

      try {
        const freshWallets = await base44.entities.Wallet.filter({ created_by: user.email }, "-updated_date", 1);
        const freshWallet = freshWallets[0];
        
        if (!freshWallet) {
          throw new Error("Wallet not found");
        }

        const currentCash = isSimModeLocal 
          ? (freshWallet.cash_balance || 0) 
          : (freshWallet.real_cash_balance || 0);

        const totalCost = Number(tradeData.total_value || (tradeData.quantity * tradeData.price) || 0);

        if (totalCost <= 0 || !isFinite(totalCost)) {
          toast.error("Trade rejected - Invalid amount");
          return;
        }

        const correctedTradeData = {
          ...tradeData,
          is_simulation: isSimModeLocal,
          created_by: user.email,
          status: "executed",
          total_value: totalCost
        };

        if (tradeType === "buy") {
          if (totalCost > currentCash + 0.01) {
            toast.error("Trade rejected - Insufficient funds", {
              description: `Need $${totalCost.toFixed(2)}, but only $${currentCash.toFixed(2)} available`
            });
            return;
          }

          const projectedBalance = currentCash - totalCost;
          if (projectedBalance < -0.01) {
            toast.error("Trade rejected", {
              description: "This would cause a negative balance"
            });
            return;
          }
        }

        if (tradeType === "sell") {
          const freshHoldings = await base44.entities.Holding.filter({
            created_by: user.email,
            is_simulation: isSimModeLocal
          });
          
          const holding = freshHoldings.find(
            h => (h.symbol || "").toUpperCase() === (correctedTradeData.symbol || "").toUpperCase()
          );

          if (!holding) {
            toast.error("Trade rejected - No holdings", {
              description: `You don't own any ${correctedTradeData.symbol}`
            });
            return;
          }

          if (holding.quantity < correctedTradeData.quantity) {
            toast.error("Trade rejected - Insufficient holdings", {
              description: `You only own ${holding.quantity.toFixed(4)} ${correctedTradeData.symbol}`
            });
            return;
          }
        }

        tradeLock.lastTrade = {
          symbol: correctedTradeData.symbol,
          type: tradeType,
          total_value: totalCost,
          timestamp: Date.now()
        };

        await addTrade(correctedTradeData);

        let newCash = currentCash;
        if (tradeType === "buy") {
          newCash = currentCash - totalCost;
        } else if (tradeType === "sell") {
          newCash = currentCash + totalCost;
        }

        if (newCash < -0.01) {
          throw new Error(`CRITICAL: Trade would cause negative balance: ${newCash.toFixed(2)}`);
        }

        newCash = Math.max(0, newCash);

        const walletUpdate = isSimModeLocal 
          ? { cash_balance: newCash }
          : { real_cash_balance: newCash };

        await base44.entities.Wallet.update(freshWallet.id, walletUpdate);

        const currentHoldings = await base44.entities.Holding.filter({
          created_by: user.email,
          is_simulation: isSimModeLocal
        });

        const existingHolding = currentHoldings.find(
          (h) => 
            (h.symbol || "").toUpperCase() === (correctedTradeData.symbol || "").toUpperCase()
        );

        if (tradeType === "buy") {
          if (existingHolding) {
            const newQuantity = (existingHolding.quantity || 0) + correctedTradeData.quantity;
            const oldTotalCost = (existingHolding.average_cost_price || 0) * (existingHolding.quantity || 0);
            const newTotalCost = oldTotalCost + tradeData.quantity * tradeData.price;
            const newAverageCost = newQuantity > 0 ? newTotalCost / newQuantity : existingHolding.average_cost_price;

            await base44.entities.Holding.update(existingHolding.id, {
              quantity: newQuantity,
              average_cost_price: newAverageCost,
            });
          } else {
            await base44.entities.Holding.create({
              symbol: correctedTradeData.symbol,
              asset_type: correctedTradeData.asset_type,
              quantity: correctedTradeData.quantity,
              average_cost_price: correctedTradeData.price,
              is_simulation: isSimModeLocal,
              created_by: user.email,
            });
          }
        } else if (tradeType === "sell") {
          if (!existingHolding) {
            throw new Error(`Holding not found for ${correctedTradeData.symbol}`);
          }

          const newQuantity = (existingHolding.quantity || 0) - correctedTradeData.quantity;

          if (newQuantity <= 0.00001) {
            try {
              await base44.entities.Holding.delete(existingHolding.id);
            } catch (_e) {}
          } else {
            try {
              await base44.entities.Holding.update(existingHolding.id, { quantity: newQuantity });
            } catch (_e) {}
          }
        }

        invalidateCache();
        
        const refreshPromises = [
          refreshWallet(),
          refreshHoldings(),
          refreshPrices()
        ];
        await Promise.all(refreshPromises);

        window.dispatchEvent(new CustomEvent('trade:completed', {
          detail: { timestamp: Date.now(), trade: correctedTradeData }
        }));

        const notificationsEnabled = settings?.notifications_enabled === true;
        const appInBackground = document.visibilityState === "hidden";

        if (notificationsEnabled && appInBackground) {
          const actionWord = tradeType === "buy" ? "Bought" : "Sold";
          base44.functions.invoke("pushNotifications", {
            action: "sendNotification",
            payload: { 
              title: `Trade Executed • ${correctedTradeData.symbol}`,
              body: `${actionWord} ${correctedTradeData.quantity.toFixed(4)} @ $${correctedTradeData.price.toFixed(2)}`,
              data: { type: "trade", symbol: correctedTradeData.symbol }
            },
          }).catch((err) => {});
        }

        const actionWord = tradeType === "buy" ? "Bought" : "Sold";
        const modeLabel = isSimModeLocal ? "💎 Demo" : "🟢 LIVE";
        toast.success(`${modeLabel} ${correctedTradeData.quantity.toFixed(4)} ${correctedTradeData.symbol} ${actionWord}`, {
          description: `@ $${correctedTradeData.price.toFixed(2)} • Total: $${totalCost.toFixed(2)}`
        });

      } catch (error) {
        
        const errorMessage = error?.message || "Unknown error occurred";
        
        if (errorMessage.includes("negative balance")) {
          toast.error("Trade failed - Would cause negative balance", {
            description: "Please check your available funds and try again"
          });
        } else if (errorMessage.includes("not found")) {
          toast.error("Trade failed - Asset position changed", {
            description: "The asset was sold in another transaction. Please refresh."
          });
        } else {
          toast.error("Trade execution failed", {
            description: errorMessage
          });
        }
        
        try {
          await base44.functions.invoke("reconcileWallet", { mode: isSimModeLocal ? "sim" : "real" });
        } catch (_e) {}
        
        invalidateCache();
        const refreshPromises = [
          refreshWallet(),
          refreshHoldings(),
          refreshPrices()
        ];
        await Promise.all(refreshPromises);
      } finally {
        tradeLock.isLocked = false;
        
        if (tradeLock.queue.length > 0) {
          const next = tradeLock.queue.shift();
          setTimeout(() => {
            handleTradeExecuted(next.tradeData).then(next.resolve);
          }, 1000);
        }
      }
    },
    [user, settings, addTrade, refreshWallet, refreshHoldings, refreshPrices]
  );

  useAutoTrader(settings, user);

  // CRITICAL: Bracket order synchronization - cancels paired orders when one is filled
  useBracketOrderSync(isSimMode, user?.email);
  
  // CRITICAL: Real-time TP/SL monitoring - checks conditional orders against live prices every ~30s
  useConditionalOrderMonitor(user?.email);
  
  // CRITICAL: Use PnL from provider (already fetched, no duplicate call)
  const krakenPnL = React.useMemo(() => {
    if (isSimMode || !providerKrakenPnL?.success) return null;
    return {
      pnl_24h: providerKrakenPnL.pnl_24h || 0,
      pnl_lifetime: providerKrakenPnL.pnl_lifetime || 0,
      realized_pnl: providerKrakenPnL.realized_pnl || 0,
      unrealized_pnl: providerKrakenPnL.unrealized_pnl || 0
    };
  }, [isSimMode, providerKrakenPnL]);

  const handleSelectTrade = (trade) => setSelectedTrade(trade);
  const handleCloseModal = () => setSelectedTrade(null);

  const compute24hChange = useCallback(() => {
    if (!Array.isArray(effectiveHoldings) || effectiveHoldings.length === 0) {
      setChange24h({ value: 0, percentage: 0 });
      setPortfolioMarketValue(0);
      setEnrichedHoldings([]);
      return;
    }

    // CRITICAL: In LIVE mode, REST API is authoritative - don't override with WebSocket
    // The effectiveHoldings already prioritizes REST API data

    // SIM MODE: Use price data
    const quotes = priceData || [];

    if (quotes.length === 0 && effectiveHoldings.length > 0) {
      setEnrichedHoldings(effectiveHoldings.map(h => ({
        ...h,
        currentPrice: h.current_price_usd || h.average_cost_price || 0
      })));
      setPortfolioMarketValue(effectiveHoldings.reduce((sum, h) => sum + (h.quantity || 0) * (h.current_price_usd || h.average_cost_price || 0), 0));
      setChange24h({ value: 0, percentage: 0 });
      return;
    }

    let currentHoldingsValue = 0;
    let prevHoldingsValue = 0;
    
    const updatedEnrichedHoldings = effectiveHoldings.map((h) => {
      const q = quotes.find((d) => (d.symbol || "").toUpperCase() === (h.symbol || "").toUpperCase());
      const currentPrice = q?.price ?? q?.current_price ?? h.current_price_usd ?? h.average_cost_price ?? 0;
      const pctRaw = q?.price_change_percentage_24h ?? q?.change_24h_percent ?? q?.percent_change_24h ?? q?.change ?? 0;
      const pct = typeof pctRaw === "string" ? parseFloat(pctRaw.replace("%", "")) : (typeof pctRaw === "number" ? pctRaw : 0);
      const qty = h.quantity || 0;
      const valueNow = qty * currentPrice;
      const prevPrice = (currentPrice > 0 && pct > -100) ? currentPrice / (1 + pct / 100) : currentPrice;
      const valuePrev = qty * prevPrice;

      currentHoldingsValue += valueNow;
      prevHoldingsValue += valuePrev;
      
      return { ...h, currentPrice };
    });
    
    setEnrichedHoldings(updatedEnrichedHoldings);
    setPortfolioMarketValue(currentHoldingsValue);

    const cash = isSimMode 
      ? (wallet?.cash_balance || 0) 
      : (hasKrakenSnapshot 
          ? (providerKrakenBalance?.available_usd_balance ?? providerKrakenBalance?.total_usd_balance ?? 0)
          : wsUsdBalance);
    const totalDelta = currentHoldingsValue - prevHoldingsValue;
    const prevTotal = (cash || 0) + prevHoldingsValue;
    const pctChange = prevTotal > 0 ? (totalDelta / prevTotal) * 100 : 0;

    setChange24h({ value: totalDelta, percentage: pctChange });
  }, [effectiveHoldings, wallet, priceData, isSimMode, wsUsdBalance]);

  useEffect(() => {
    compute24hChange();
  }, [compute24hChange]);

  useEffect(() => {
    const isSimModeLocal = settings?.sim_trading_mode !== false;
    
    // CRITICAL: For LIVE mode, use REAL Kraken PnL from getKrakenPnL endpoint
    if (!isSimModeLocal) {
      if (!krakenPnL) {
        // Wait for provider PnL to avoid flicker from SIM calculations
        setRealized24h({ value: 0, percentage: 0 });
        setLifetimeChange({ value: 0, percentage: 0 });
        return;
      }
      // 24h realized PnL from Kraken trades
      const realized24hValue = krakenPnL.pnl_24h || 0;
      const realized24hPct = krakenPnL.realized_pnl > 0 ? (realized24hValue / krakenPnL.realized_pnl) * 100 : 0;
      setRealized24h({ value: realized24hValue, percentage: realized24hPct });
      
      // Lifetime PnL = realized + unrealized from Kraken
      const lifetimePnLValue = krakenPnL.pnl_lifetime || 0;
      // Calculate percentage based on current portfolio value
      const currentValue = wsCryptoValue > 0 ? wsCryptoValue : portfolioMarketValue;
      const costBasis = currentValue - lifetimePnLValue;
      const lifetimePct = costBasis > 0 ? (lifetimePnLValue / costBasis) * 100 : 0;
      
      setLifetimeChange({ value: lifetimePnLValue, percentage: lifetimePct });
      return;
    }
    
    // SIM MODE: Calculate from local trades
    if (!Array.isArray(trades) || trades.length === 0) {
      setRealized24h({ value: 0, percentage: 0 });
      setLifetimeChange({ value: 0, percentage: 0 });
      return;
    }

    const ms24h = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const relevant = trades
      .filter(t => t.is_simulation === isSimModeLocal)
      .slice()
      .sort((a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime());

    const state = new Map();
    let realizedSum = 0;
    let soldCostSum = 0;

    for (const t of relevant) {
      const sym = (t.symbol || "").toUpperCase();
      const qty = Number(t.quantity) || 0;
      const price = Number(t.price) || 0;
      const rec = state.get(sym) || { qty: 0, avgCost: 0 };

      if ((t.type || "").toLowerCase() === "buy") {
        const newQty = rec.qty + qty;
        const oldCost = rec.avgCost * rec.qty;
        const newCost = oldCost + qty * price;
        const newAvg = newQty > 0 ? newCost / newQty : rec.avgCost;
        state.set(sym, { qty: newQty, avgCost: newAvg });
      } else if ((t.type || "").toLowerCase() === "sell") {
        const realized = (price - (rec.avgCost || 0)) * qty;

        const ts = new Date(t.created_date).getTime();
        if (now - ts <= ms24h) {
          realizedSum += realized;
          soldCostSum += (rec.avgCost || 0) * qty;
        }

        const newQty = rec.qty - qty;
        if (newQty <= 0.0000001) {
          state.delete(sym);
        } else {
          state.set(sym, { qty: newQty, avgCost: rec.avgCost });
        }
      }
    }

    const pct = soldCostSum > 0 ? (realizedSum / soldCostSum) * 100 : 0;
    setRealized24h({ value: realizedSum, percentage: pct });

    // SIM MODE: Calculate lifetime PnL from trades
    const stateLifetime = new Map();
    let lifetimeRealizedPnL = 0;
    let totalCostBasisInvested = 0;
    
    for (const t of relevant) {
      const sym = (t.symbol || "").toUpperCase();
      const qty = Number(t.quantity) || 0;
      const price = Number(t.price) || 0;
      const rec = stateLifetime.get(sym) || { qty: 0, avgCost: 0 };

      if ((t.type || "").toLowerCase() === "buy") {
        const newQty = rec.qty + qty;
        const oldCost = rec.avgCost * rec.qty;
        const newCost = oldCost + qty * price;
        const newAvg = newQty > 0 ? newCost / newQty : rec.avgCost;
        stateLifetime.set(sym, { qty: newQty, avgCost: newAvg });
        totalCostBasisInvested += qty * price;
      } else if ((t.type || "").toLowerCase() === "sell") {
        const realizedPnL = (price - (rec.avgCost || 0)) * qty;
        lifetimeRealizedPnL += realizedPnL;

        const newQty = rec.qty - qty;
        if (newQty <= 0.0000001) {
          stateLifetime.delete(sym);
        } else {
          stateLifetime.set(sym, { qty: newQty, avgCost: rec.avgCost });
        }
      }
    }
    
    let remainingCostBasis = 0;
    stateLifetime.forEach((rec) => {
      remainingCostBasis += rec.qty * rec.avgCost;
    });
    
    const currentMarketValue = Number(portfolioMarketValue || 0);
    const unrealizedPnL = currentMarketValue - remainingCostBasis;
    const lifetimePnL = lifetimeRealizedPnL + unrealizedPnL;
    const lifetimePct = totalCostBasisInvested > 0 ? (lifetimePnL / totalCostBasisInvested) * 100 : 0;
    
    setLifetimeChange({ value: lifetimePnL, percentage: lifetimePct });

  }, [trades, settings, portfolioMarketValue, isSimMode, wsCryptoValue, krakenPnL]);

  useEffect(() => {
    const handleTradeCompleted = () => {
      compute24hChange();
    };

    window.addEventListener('trade:completed', handleTradeCompleted);
    return () => window.removeEventListener('trade:completed', handleTradeCompleted);
  }, [compute24hChange]);

  // Trigger initial REST fetch if provider hasn't loaded yet (one-time only)
  const dashboardFetchAttemptedRef = React.useRef(false);
  React.useEffect(() => {
    if (!isSimMode && !providerHasData && !providerLoading && fetchKrakenData && !dashboardFetchAttemptedRef.current) {
      dashboardFetchAttemptedRef.current = true;
      console.log('[Dashboard] LIVE mode - triggering Kraken data fetch');
      fetchKrakenData(true);
    }
  }, [isSimMode, providerHasData, providerLoading, fetchKrakenData]);

  // CRITICAL: In LIVE mode, use provider's best-available values (REST > WS > 0)
  // Provider already merges REST snapshot (authoritative) + WS real-time (fallback)
  // wsUpdateCounter is included so these re-derive on every WS balance/price push
  const currentCashBalance = React.useMemo(() => {
    if (isSimMode) return wallet?.cash_balance || 0;
    // LIVE: REST snapshot is the stable source; only use WS if no snapshot yet
    if (hasKrakenSnapshot) return providerKrakenBalance?.available_usd_balance ?? providerKrakenBalance?.total_usd_balance ?? 0;
    return wsUsdBalance || 0;
  }, [isSimMode, wallet?.cash_balance, hasKrakenSnapshot, providerKrakenBalance, wsUsdBalance]);

  const liveBalancesLoading = !isSimMode && !(hasKrakenSnapshot || (wsConnected && wsBalances && Object.keys(wsBalances || {}).length > 0));

  const currentPortfolioValue = React.useMemo(() => {
    if (isSimMode) return portfolioMarketValue;
    // LIVE: Use REST snapshot as the stable baseline.
    // Only layer on WS prices when ALL holdings can be priced (avoids flicker
    // when WS has prices for some holdings but not others → partial $0 → jump).
    const restTotal = providerKrakenBalance?.total_crypto_value_usd ?? 0;
    if (hasKrakenSnapshot && providerBestHoldings?.length > 0) {
      let liveTotal = 0;
      let allPriced = true;
      for (const h of providerBestHoldings) {
        const qty = h.quantity || 0;
        if (qty <= 0.00001) continue;
        const wsPair = `${h.symbol}/USD`;
        const livePrice = wsPrices?.[wsPair]?.price || 0;
        const snapshotPrice = h.current_price_usd || 0;
        const bestPrice = livePrice || snapshotPrice;
        if (bestPrice <= 0) { allPriced = false; break; }
        liveTotal += qty * bestPrice;
      }
      // Only use the live-recomputed total if every holding had a valid price;
      // otherwise stick with the REST snapshot to avoid jarring drops.
      return allPriced && liveTotal > 0 ? liveTotal : restTotal;
    }
    return restTotal || wsCryptoValue || 0;
  }, [isSimMode, portfolioMarketValue, hasKrakenSnapshot, providerKrakenBalance, providerBestHoldings, wsPrices, wsCryptoValue]);
    
  // Total Balance = Cash + Portfolio (crypto)
  // CRITICAL: Always sum cash + live-recomputed portfolio to stay in sync with price updates
  const totalBalance = React.useMemo(() => {
    return currentCashBalance + currentPortfolioValue;
  }, [currentCashBalance, currentPortfolioValue]);

  // Live mode uses provider's best-available data (WS > REST), no special zero-handling needed

  // CRITICAL: Don't render with wrong mode - wait for settings
  if (isSimMode === null || settingsLoading) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[60vh]" style={{ backgroundColor: 'var(--primary-bg)' }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-green-400 rounded-full animate-spin mx-auto mb-3" style={{ borderTopColor: 'var(--neon-green)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="p-4 space-y-6 pb-8 relative"
      style={{ backgroundColor: "var(--primary-bg)" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {(pullDistance > 0 || isPullRefreshing) && (
        <div
          className="absolute top-0 left-1/2 transform -translate-x-1/2 flex flex-col items-center z-50"
          style={{
            transform: `translateX(-50%) translateY(${Math.min(pullDistance - 20, 40)}px)`,
            opacity: pullDistance / 60,
          }}
        >
          <div
            className={`w-8 h-8 border-2 border-green-400 rounded-full flex items-center justify-center ${isPullRefreshing ? "animate-spin" : ""}`}
            style={{ borderTopColor: "var(--neon-green)" }}
          ></div>
          <span className="text-xs mt-1 neon-text" style={{ color: "var(--neon-green)" }}>
            {isPullRefreshing ? "Refreshing..." : pullDistance > 60 ? "Release to refresh" : "Pull to refresh"}
          </span>
        </div>
      )}

      <TradeDetailsModal trade={selectedTrade} isOpen={!!selectedTrade} onClose={handleCloseModal} />

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center py-4">
        <h2 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>
          Welcome back{user?.full_name ? `, ${user.full_name.split(" ")[0]}` : ""}!
        </h2>
        <p style={{ color: "var(--text-secondary)"}}>
          Trading in {isSimMode ? "simulation" : "live"} mode 🚀 Try out our AI market analysis!
          {!isSimMode && wsConnected && <span className="text-green-500"> • WebSocket Active 🟢</span>}
        </p>
      </motion.div>

      <div className="grid grid-cols-1 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <BalanceCard
            title="Total Balance"
            amount={balanceVisible ? (totalBalance ?? 0) : null}
            change={change24h}
            onToggleVisibility={() => setBalanceVisible(!balanceVisible)}
            isVisible={balanceVisible}
            isPrimary={true}
            isSimMode={isSimMode}
            changeLabel="24h PnL"
            isLoading={liveBalancesLoading}
          />
        </motion.div>

        <div className="grid grid-cols-2 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <BalanceCard
              title="Cash Wallet"
              amount={balanceVisible ? (currentCashBalance ?? 0) : null}
              change={lifetimeChange}
              icon={DollarSign}
              isVisible={balanceVisible}
              isSimMode={isSimMode}
              changeLabel="Lifetime PnL"
              linkTo={createPageUrl("Wallet")}
              isLoading={liveBalancesLoading}
            />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <BalanceCard
              title="Portfolio"
              amount={balanceVisible ? (currentPortfolioValue ?? 0) : null}
              change={lifetimeChange}
              icon={Activity}
              isVisible={balanceVisible}
              isSimMode={isSimMode}
              changeLabel="Live Lifetime"
              linkTo={createPageUrl("Portfolio")}
              isLoading={liveBalancesLoading}
            />
          </motion.div>
        </div>
      </div >

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <QuickActions />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
        <CryptoMarketOverview />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
        {chartSelection.assetType === "crypto" ? (
          <CryptoPriceChart symbol={chartSelection.symbol || "BTC"} />
        ) : (
          <StockPriceChart symbol={chartSelection.symbol || "AAPL"} />
        )}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
        <PerformanceChart trades={trades} holdings={enrichedHoldings} wallet={wallet} isSimMode={isSimMode} krakenPnL={krakenPnL} />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
        <RecentTrades trades={trades} onTradeSelect={handleSelectTrade} />
      </motion.div>
    </div >
  );
}