
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { DollarSign, Activity, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query"; // Added useQuery
import { base44 } from "@/api/base44Client";

// Import entities used directly by useAutoTrader
import { ConditionalOrder, AutoBuyPreference } from "@/entities/all";

// Import centralized hooks with direct file paths
import { invalidateCache } from "@/components/hooks/useDataFetching";
import { invalidatePriceCache } from "@/components/hooks/usePriceData"; // Added invalidatePriceCache
import { useRealtimeKrakenData } from "@/components/hooks/useRealtimeKrakenData";
import { useSettings } from "@/components/utils/SettingsContext"; // Updated import path style
import { useKrakenPnL } from "@/components/hooks/useKrakenPnL"; // Added useKrakenPnL

import BalanceCard from "@/components/dashboard/BalanceCard"; // Updated import path style
import RecentTrades from "@/components/dashboard/RecentTrades"; // Updated import path style
import PerformanceChart from "@/components/dashboard/PerformanceChart"; // Updated import path style
import QuickActions from "@/components/dashboard/QuickActions"; // Updated import path style
import TradeDetailsModal from "@/components/dashboard/TradeDetailsModal"; // Updated import path style
import CryptoMarketOverview from "@/components/dashboard/CryptoMarketOverview"; // Updated import path style
import CryptoPriceChart from "@/components/dashboard/CryptoPriceChart"; // Updated import path style
import StockPriceChart from "@/components/dashboard/StockPriceChart"; // Updated import path style

const useAutoTrader = (settings, user, onTrade, wallet, holdings, lifetimeChange, isSimMode) => {
  const isRunningRef = useRef(false);
  const lastRunRef = useRef(0);
  const backoffUntilRef = useRef(0);
  const nextOrdersCheckAtRef = useRef(0);
  const failureCountRef = useRef(0);
  const lowBalanceNotifiedRef = useRef(false);
  const highestPriceCache = useRef(new Map());
  const batchQueueRef = useRef({ creates: [], updates: [], lastFlush: Date.now() });

  const flushBatchQueue = useCallback(async () => {
    const queue = batchQueueRef.current;
    if (queue.creates.length === 0 && queue.updates.length === 0) return;
    const createsToProcess = [...queue.creates];
    const updatesToProcess = [...queue.updates];
    queue.creates = [];
    queue.updates = [];
    queue.lastFlush = Date.now();
    try {
      if (createsToProcess.length > 0) await ConditionalOrder.bulkCreate(createsToProcess);
      if (updatesToProcess.length > 0) {
        await Promise.all(updatesToProcess.map(({ id, data }) => ConditionalOrder.update(id, data)));
      }
      failureCountRef.current = 0;
    } catch (e) {
      console.error('[AutoTrader] Batch error:', e);
      const msg = (e && (e.message || e.toString())) || "";
      if (e?.response?.status === 429 || /429|rate limit/i.test(msg)) {
        failureCountRef.current++;
        backoffUntilRef.current = Date.now() + (Math.min(60, Math.pow(2, failureCountRef.current) * 5) * 60 * 1000);
      }
    }
  }, []);

  const queueOrderCreate = useCallback((orderData) => {
    batchQueueRef.current.creates.push(orderData);
  }, []);

  const queueOrderUpdate = useCallback((orderId, updateData) => {
    const existing = batchQueueRef.current.updates.findIndex(u => u.id === orderId);
    if (existing >= 0) {
      batchQueueRef.current.updates[existing].data = { ...batchQueueRef.current.updates[existing].data, ...updateData };
    } else {
      batchQueueRef.current.updates.push({ id: orderId, data: updateData });
    }
  }, []);

  useEffect(() => {
    if (!settings?.auto_trading_enabled || !user?.email) {
      return () => flushBatchQueue();
    }

    const checkAndFlushBatch = () => {
      const queue = batchQueueRef.current;
      const totalOps = queue.creates.length + queue.updates.length;
      const timeSinceFlush = Date.now() - queue.lastFlush;
      if (totalOps >= 20 || (totalOps > 0 && timeSinceFlush >= 60000)) {
        flushBatchQueue();
      }
    };

    const fetchQuotes = async ({ stockSymbols = [], cryptoSymbols = [] }) => {
      try {
        const res = await base44.functions.invoke('getMarketData', {
          action: 'getWatchlistData',
          payload: { stockSymbols, cryptoSymbols }
        });
        const data = Array.isArray(res?.data) ? res.data : [];
        failureCountRef.current = 0;
        return data.map(d => ({ symbol: (d.symbol || "").toUpperCase(), price: typeof d.price === "number" ? d.price : null, changePct: typeof d.change === "number" ? d.change : null }));
      } catch (e) {
        const msg = (e && (e.message || e.toString())) || "";
        if (e?.response?.status === 429 || /429|rate limit/i.test(msg)) {
          failureCountRef.current++;
          backoffUntilRef.current = Date.now() + (Math.min(60, Math.pow(2, failureCountRef.current) * 5) * 60 * 1000);
        }
        return [];
      }
    };

    const performRuleBasedTrade = async () => {
      if (!settings?.auto_trading_enabled || isRunningRef.current) return;
      const nowTs = Date.now();
      if (nowTs < backoffUntilRef.current || (lastRunRef.current && nowTs - lastRunRef.current < 300000)) return;
      isRunningRef.current = true;
      try {
        const freshWallets = await base44.entities.Wallet.filter({ created_by: user.email }, "-updated_date", 1);
        const freshWallet = freshWallets[0];
        if (!freshWallet) return;
        const cashAvailable = isSimMode ? (freshWallet.cash_balance || 0) : (freshWallet.real_cash_balance || 0);
        if (cashAvailable < 0) {
          try {
            const settingsRecords = await base44.entities.UserSettings.filter({ created_by: user.email });
            if (settingsRecords[0]) await base44.entities.UserSettings.update(settingsRecords[0].id, { auto_trading_enabled: false });
          } catch (e) {}
          toast.error("🚨 Auto-Trader Emergency Stop", { description: `Wallet balance is negative ($${cashAvailable.toFixed(2)}). Auto-trading has been disabled. Please reconcile your wallet.`, duration: 10000 });
          if (settings?.notifications_enabled === true) {
            base44.functions.invoke("pushNotifications", { action: "sendNotification", payload: { title: "🚨 Auto-Trader Emergency Stop", body: `Wallet balance is negative ($${cashAvailable.toFixed(2)}). Auto-trading disabled.`, data: { type: "emergency_stop" } } }).catch(() => {});
          }
          return;
        }
        if (cashAvailable < 1) return;
        const isLowBalance = cashAvailable < 10;
        let activeOrders = [];
        if (nowTs >= nextOrdersCheckAtRef.current) {
          activeOrders = await ConditionalOrder.filter({ created_by: user.email, status: "active" });
          nextOrdersCheckAtRef.current = nowTs + 5 * 60 * 1000;
        }
        const stockSymbolsForOrders = [...new Set(activeOrders.filter(o => o.asset_type === "stock" || o.asset_type === "stocks").map(o => (o.symbol || "").toUpperCase()))];
        const cryptoSymbolsForOrders = [...new Set(activeOrders.filter(o => o.asset_type === "crypto").map(o => (o.symbol || "").toUpperCase()))];
        let quoteListForOrders = [];
        if (stockSymbolsForOrders.length || cryptoSymbolsForOrders.length) {
          quoteListForOrders = await fetchQuotes({ stockSymbols: stockSymbolsForOrders, cryptoSymbols: cryptoSymbolsForOrders });
        }
        const freshHoldings = await base44.entities.Holding.filter({ created_by: user.email, is_simulation: isSimMode });
        for (const order of activeOrders) {
          const symU = (order.symbol || "").toUpperCase();
          const priceData = quoteListForOrders.find(p => p.symbol === symU);
          if (!priceData || typeof priceData.price !== "number" || priceData.price <= 0) continue;
          const currentPrice = priceData.price;
          const actualHolding = freshHoldings.find(h => (h.symbol || "").toUpperCase() === symU && h.is_simulation === isSimMode);
          if (!actualHolding) {
            queueOrderUpdate(order.id, { status: "cancelled" });
            continue;
          }
          let sellQuantity = order.quantity;
          if (sellQuantity > actualHolding.quantity) {
            sellQuantity = actualHolding.quantity;
            queueOrderUpdate(order.id, { quantity: sellQuantity });
          }
          if (sellQuantity <= 0) {
            queueOrderUpdate(order.id, { status: "cancelled" });
            continue;
          }
          const trailingEnabled = order.trailing_enabled !== false;
          const trailingMargin = typeof order.trailing_margin === "number" && order.trailing_margin > 0 ? order.trailing_margin : (typeof settings?.loss_margin === "number" ? settings.loss_margin : 5);
          let updatedHighest = order.highest_price || order.purchase_price;
          if (trailingEnabled && currentPrice > (order.highest_price || 0)) {
            const cachedHighest = highestPriceCache.current.get(order.id) || order.highest_price || 0;
            const priceChangePercent = cachedHighest > 0 ? ((currentPrice - cachedHighest) / cachedHighest) * 100 : 0;
            if (priceChangePercent > 1) {
              updatedHighest = currentPrice;
              queueOrderUpdate(order.id, { highest_price: updatedHighest });
              highestPriceCache.current.set(order.id, updatedHighest);
            } else {
              updatedHighest = cachedHighest || order.highest_price || order.purchase_price;
            }
          }
          const gainPrice = order.purchase_price * (1 + order.gain_margin / 100);
          const lossPrice = order.purchase_price * (1 - order.loss_margin / 100);
          const trailingStop = trailingEnabled ? updatedHighest * (1 - trailingMargin / 100) : null;
          let shouldSell = false;
          let tradeType = "";
          if (currentPrice <= lossPrice) { shouldSell = true; tradeType = "stop-loss"; }
          else if (trailingEnabled && updatedHighest > order.purchase_price && currentPrice <= trailingStop) { shouldSell = true; tradeType = "trailing-stop"; }
          else if (!trailingEnabled && currentPrice >= gainPrice) { shouldSell = true; tradeType = "take-profit"; }
          if (shouldSell) {
            const tradeDetails = { symbol: symU, type: "sell", asset_type: order.asset_type, quantity: sellQuantity, price: currentPrice, total_value: sellQuantity * currentPrice, is_auto_trade: true };
            try {
              if (!isSimMode) {
                try {
                  const krakenResponse = await Promise.race([
                    base44.functions.invoke('krakenTrade', { action: 'place_order', symbol: symU, side: 'sell', quantity: sellQuantity, orderType: 'market' }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Trade execution timeout')), 15000))
                  ]);
                  if (!krakenResponse?.data?.success) throw new Error(krakenResponse?.data?.error || 'Kraken trade failed');
                  toast.success("🟢 LIVE Auto-Sell Executed", { description: `Sold ${sellQuantity.toFixed(4)} ${symU} @ $${currentPrice.toFixed(2)} on Kraken`, duration: 5000 });
                  await base44.entities.Trade.create({ ...tradeDetails, is_simulation: false, created_by: user.email, status: 'executed' });
                } catch (krakenError) {
                  const isRateLimit = krakenError.message && /rate limit|429/i.test(krakenError.message);
                  if (isRateLimit) {
                    failureCountRef.current++;
                    backoffUntilRef.current = Date.now() + (Math.min(30, Math.pow(2, failureCountRef.current) * 2) * 60 * 1000);
                  }
                  toast.error("🔴 LIVE Trade Failed", { description: `Failed to sell ${symU} on Kraken: ${krakenError.message}`, duration: 10000 });
                  continue;
                }
              } else {
                await onTrade(tradeDetails);
                toast.success("🤖 Auto-Trade Executed", { description: `Sold ${tradeDetails.quantity.toFixed(4)} ${tradeDetails.symbol} @ $${tradeDetails.price.toFixed(2)} (${tradeType}).` });
              }
              queueOrderUpdate(order.id, { status: "executed" });
              highestPriceCache.current.delete(order.id);
              if (settings?.notifications_enabled === true) {
                base44.functions.invoke("pushNotifications", { action: "sendNotification", payload: { title: `${!isSimMode ? '🟢 LIVE' : '💎'} Auto-Sell Executed • ${symU}`, body: `${tradeType.replace("-", " ")}: Sold ${sellQuantity.toFixed(4)} at $${currentPrice.toFixed(2)}`, data: { type: "trade", symbol: symU, tradeType: "sell", reason: tradeType, live: !isSimMode } } }).catch(() => {});
              }
            } catch (tradeError) {
              console.error(`Failed to execute sell for ${symU}:`, tradeError);
              toast.error(`${!isSimMode ? '🟢 LIVE' : '💎'} Auto-trade failed`, { description: `Failed to sell ${symU}. Please try manually.` });
            }
          }
          checkAndFlushBatch();
        }
        await flushBatchQueue();
        if (!settings?.auto_trading_enabled || isLowBalance) {
          if (isLowBalance && !lowBalanceNotifiedRef.current) {
            if (settings?.notifications_enabled === true) {
              base44.functions.invoke("pushNotifications", { action: "sendNotification", payload: { title: "Auto-Trader: Sell-Only Mode", body: `Cash balance is low ($${cashAvailable.toFixed(2)}). Auto-buying paused until balance exceeds $10.`, data: { type: "low_balance" } } }).catch(() => {});
            }
            lowBalanceNotifiedRef.current = true;
          }
          return;
        }
        if (cashAvailable >= 10 && lowBalanceNotifiedRef.current) lowBalanceNotifiedRef.current = false;
        const prefs = await AutoBuyPreference.filter({ created_by: user.email, is_simulation: isSimMode, enabled: true }, "-created_date", 30);
        if (prefs.length === 0) return;
        const cryptoPrefs = [...new Set(prefs.filter(p => p.asset_type === "crypto").map(p => String(p.symbol || "").toUpperCase().trim()))];
        const stockPrefs = [...new Set(prefs.filter(p => p.asset_type === "stock").map(p => String(p.symbol || "").toUpperCase().trim()))];
        const quotesForBuy = await fetchQuotes({ stockSymbols: stockPrefs, cryptoSymbols: cryptoPrefs });
        if (!Array.isArray(quotesForBuy) || quotesForBuy.length === 0) return;
        const isCashBuildUpMode = lifetimeChange?.percentage >= 10;
        let remainingCash = isCashBuildUpMode ? cashAvailable * 0.2 : cashAvailable * 0.8;
        if (remainingCash <= 1.0) return;
        let analysisMap = {};
        try {
          const llm = await base44.integrations.Core.InvokeLLM({
            prompt: `You are an automated market analysis bot. Goal: proactive buy signals. Margins: gain=${settings?.gain_margin ?? 10}% loss=${settings?.loss_margin ?? 5}%\nSymbols:\n${JSON.stringify(quotesForBuy.map(q => ({ symbol: q.symbol, price: q.price, change24h: q.changePct })))}\nReturn confidence 0-1 for each.`,
            response_json_schema: { type: "object", properties: { recommendations: { type: "array", items: { type: "object", properties: { symbol: { type: "string" }, action: { type: "string", enum: ["buy", "hold", "sell"] }, confidence: { type: "number" } }, required: ["symbol", "confidence"] } } } }
          });
          const recs = Array.isArray(llm?.recommendations) ? llm.recommendations : [];
          analysisMap = recs.reduce((acc, r) => {
            acc[(r.symbol || "").toUpperCase()] = { confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)), action: (r.action || "buy").toLowerCase() };
            return acc;
          }, {});
        } catch (_e) {console.error('[AutoTrader] LLM analysis error:', _e);}
        for (const p of prefs) {
          if (!settings?.auto_trading_enabled) break;
          const sym = (p.symbol || "").toUpperCase();
          const q = quotesForBuy.find(x => x.symbol === sym);
          const price = typeof q?.price === "number" ? q.price : null;
          if (!price || price <= 0) continue;
          const currentWallets = await base44.entities.Wallet.filter({ created_by: user.email }, "-updated_date", 1);
          const currentWallet = currentWallets[0];
          const actualCash = isSimMode ? (currentWallet?.cash_balance || 0) : (currentWallet?.real_cash_balance || 0);
          remainingCash = Math.min(remainingCash, isCashBuildUpMode ? actualCash * 0.2 : actualCash * 0.8);
          if (remainingCash < 1.0) break;
          const rec = analysisMap[sym] || { confidence: 0.55, action: "buy" };
          if (rec.action === "hold" || rec.action === "sell") continue;
          const basePct = Math.max(10, Number(p.percentage) || 10) / 100;
          const multiplier = Math.min(1.5, 0.5 + rec.confidence);
          const fraction = Math.max(0.05, Math.min(0.3, basePct * multiplier));
          let spend = remainingCash * fraction;
          const minSpendTarget = Math.max(2, Math.min(10, price * 0.05));
          if (spend < minSpendTarget && remainingCash >= minSpendTarget) spend = Math.min(remainingCash, minSpendTarget);
          spend = Math.min(spend, remainingCash * 0.95);
          if (spend < 1.0) continue;
          const qty = spend / price;
          const held = (Array.isArray(holdings) ? holdings : []).find(h => (h.symbol || "").toUpperCase() === sym && h.is_simulation === isSimMode);
          const scaleInFactor = held ? 0.6 : 1.0;
          const finalQty = qty * scaleInFactor;
          const total = finalQty * price;
          if (total > remainingCash + 1e-6 || total < 1.0 || total > actualCash) continue;
          const tradeDetails = { symbol: sym, type: "buy", asset_type: p.asset_type, quantity: finalQty, price, total_value: total, is_auto_trade: true };
          try {
            if (!isSimMode) {
              try {
                const krakenResponse = await Promise.race([
                  base44.functions.invoke('krakenTrade', { action: 'place_order', symbol: sym, side: 'buy', quantity: finalQty, orderType: 'market' }),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Trade execution timeout')), 15000))
                ]);
                if (!krakenResponse?.data?.success) throw new Error(krakenResponse?.data?.error || 'Kraken trade failed');
                toast.success("🟢 LIVE Auto-Buy Executed", { description: `Bought ${finalQty.toFixed(4)} ${sym} @ $${price.toFixed(2)} on Kraken`, duration: 5000 });
                await base44.entities.Trade.create({ ...tradeDetails, is_simulation: false, created_by: user.email, status: 'executed' });
              } catch (krakenError) {
                console.error(`[AutoTrader] Kraken buy failed:`, krakenError);
                const isRateLimit = krakenError.message && /rate limit|429/i.test(krakenError.message);
                if (isRateLimit) {
                  failureCountRef.current++;
                  backoffUntilRef.current = Date.now() + (Math.min(30, Math.pow(2, failureCountRef.current) * 2) * 60 * 1000);
                }
                toast.error("🔴 LIVE Trade Failed", { description: `Failed to buy ${sym} on Kraken: ${krakenError.message}`, duration: 10000 });
                break;
              }
            } else {
              await onTrade(tradeDetails);
            }
            remainingCash = Math.max(0, remainingCash - total);
            if (remainingCash < 1.0) break;
            queueOrderCreate({ symbol: sym, asset_type: p.asset_type, quantity: finalQty, purchase_price: price, gain_margin: parseFloat(settings?.gain_margin ?? 10), loss_margin: parseFloat(settings?.loss_margin ?? 5), status: "active", created_by: user.email });
            nextOrdersCheckAtRef.current = Math.min(nextOrdersCheckAtRef.current, Date.now() + 2 * 60 * 1000);
          } catch (buyError) {
            console.error(`Failed to execute buy for ${sym}:`, buyError);
            console.log('[AutoTrader] Stopping auto-buys due to trade error');
            break;
          }
          checkAndFlushBatch();
        }
        await flushBatchQueue();
      } catch (e) {
        const msg = (e && (e.message || e.toString())) || "";
        if (e?.response?.status === 429 || /429|rate limit/i.test(msg)) {
          failureCountRef.current++;
          const backoffMinutes = Math.min(60, Math.pow(2, failureCountRef.current) * 5);
          backoffUntilRef.current = Date.now() + (backoffMinutes * 60 * 1000);
        } else {
          console.error("Auto-trader error:", e);
        }
      } finally {
        isRunningRef.current = false;
        lastRunRef.current = Date.now();
        await flushBatchQueue();
      }
    };
    performRuleBasedTrade();
    const interval = setInterval(performRuleBasedTrade, 300000);
    const flushCheckInterval = setInterval(checkAndFlushBatch, 30000);
    return () => {
      if (interval) clearInterval(interval);
      if (flushCheckInterval) clearInterval(flushCheckInterval);
      flushBatchQueue();
    };
  }, [settings, user, onTrade, wallet, holdings, flushBatchQueue, queueOrderCreate, queueOrderUpdate, lifetimeChange, isSimMode]);
};

// GLOBAL TRADE LOCK: Prevent simultaneous trades
if (typeof window !== 'undefined') {
  window.__tradeLock = window.__tradeLock || {
    isLocked: false,
    queue: [],
    lastTrade: null
  };
}

export default function Dashboard() {
  const { settings, user, isLoading: settingsLoading } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;

  const [selectedTrade, setSelectedTrade] = useState(null);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [selectedChartAsset, setSelectedChartAsset] = useState(null);
  const [selectedChartType, setSelectedChartType] = useState('crypto');

  const [pullDistance, setPullDistance] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const touchStartY = useRef(0);

  // CRITICAL: Use WebSocket data for LIVE mode
  const { 
    usdBalance: wsUsdBalance,
    totalPortfolioValue: wsTotalValue,
    balances: wsBalances,
    prices: wsPrices,
    isConnected: wsConnected,
    totalAssets: wsTotalAssets,
    refresh: wsRefresh
  } = useRealtimeKrakenData({
    subscribeToPrices: true,
    priceSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD'],
    subscribeToBalances: !isSimMode,
    subscribeToOrders: false,
    subscribeToExecutions: false,
    isSimMode
  });

  // CRITICAL: Fetch REAL Kraken PnL
  const { pnlData, isLoading: pnlLoading, refresh: refreshPnL } = useKrakenPnL(isSimMode);

  const { data: wallet, refetch: refetchWallet, isLoading: walletLoading } = useQuery({
    queryKey: ['wallet', user?.email],
    queryFn: async () => {
      const wallets = await base44.entities.Wallet.filter({ created_by: user.email });
      return wallets[0] || null;
    },
    enabled: !!user?.email,
    staleTime: 30000
  });

  const { data: trades = [], refetch: refetchTrades, isLoading: tradesLoading } = useQuery({
    queryKey: ['trades', user?.email, isSimMode],
    queryFn: async () => {
      return await base44.entities.Trade.filter({
        created_by: user.email,
        is_simulation: isSimMode
      });
    },
    enabled: !!user?.email,
    initialData: [],
    staleTime: 30000
  });

  const { data: holdings = [], refetch: refetchHoldings, isLoading: holdingsLoading } = useQuery({
    queryKey: ['holdings', user?.email, isSimMode],
    queryFn: async () => {
      return await base44.entities.Holding.filter({
        created_by: user.email,
        is_simulation: isSimMode
      });
    },
    enabled: !!user?.email,
    initialData: [],
    staleTime: 30000
  });

  // CRITICAL: Calculate current holdings from WebSocket in LIVE mode
  const currentHoldings = useMemo(() => {
    if (isSimMode) {
      return holdings;
    }
    
    // LIVE MODE: Use WebSocket balances
    if (wsConnected && wsBalances && Object.keys(wsBalances).length > 0) {
      const wsHoldings = Object.entries(wsBalances)
        .filter(([asset, data]) => {
          if (asset === 'USD' || asset === 'ZUSD') return false;
          return data.balance > 0.00001;
        })
        .map(([asset, data]) => {
          const pair = `${asset}/USD`;
          const currentPrice = wsPrices[pair]?.price || 0;
          const costBasis = data.balance * currentPrice; // Use current price as cost basis since we don't have historical data
          
          return {
            symbol: asset,
            quantity: data.balance,
            average_cost_price: currentPrice,
            currentPrice: currentPrice,
            currentValue: data.balance * currentPrice,
            costBasis: costBasis,
            gainLoss: 0,
            gainLossPercent: 0,
            asset_type: 'crypto',
            is_simulation: false
          };
        });
      
      if (wsHoldings.length > 0) {
        return wsHoldings;
      }
    }
    
    return holdings;
  }, [isSimMode, holdings, wsConnected, wsBalances, wsPrices]);

  // CRITICAL: Calculate values from WebSocket
  const currentCashBalance = useMemo(() => {
    if (isSimMode) {
      return wallet?.cash_balance || 0;
    }
    return wsConnected && wsUsdBalance >= 0 ? wsUsdBalance : (wallet?.real_cash_balance || 0);
  }, [isSimMode, wallet, wsConnected, wsUsdBalance]);

  const currentPortfolioValue = useMemo(() => {
    if (isSimMode) {
      return currentHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
    }
    return wsConnected && wsTotalValue >= 0 ? (wsTotalValue - (wsUsdBalance || 0)) : currentHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
  }, [isSimMode, currentHoldings, wsConnected, wsTotalValue, wsUsdBalance]);

  const totalBalance = currentCashBalance + currentPortfolioValue;

  // CRITICAL: Use REAL Kraken PnL data instead of calculated values
  const realized24h = {
    value: pnlData?.pnl_24h || 0,
    percentage: (pnlData?.total_value_24h_ago > 0 && pnlData?.pnl_24h !== undefined)
      ? (pnlData.pnl_24h / pnlData.total_value_24h_ago) * 100
      : 0
  };

  const lifetimeChange = {
    value: pnlData?.pnl_lifetime || 0,
    percentage: (pnlData?.initial_capital > 0 && pnlData?.pnl_lifetime !== undefined)
      ? (pnlData.pnl_lifetime / pnlData.initial_capital) * 100
      : 0
  };

  const hasRealCash = Number(wallet?.real_cash_balance || 0) > 0 || (wsConnected && wsUsdBalance > 0);
  const hasRealHoldings = (Array.isArray(holdings) && holdings.some(h => h.is_simulation === false)) || (wsConnected && wsTotalAssets > 0);
  const hasRealTrades = Array.isArray(trades) && trades.some(t => t.is_simulation === false);
  const showZerosInLive = !isSimMode && !hasRealCash && !hasRealHoldings && !hasRealTrades;

  const isLoading = settingsLoading || walletLoading || tradesLoading || holdingsLoading || pnlLoading;

  useEffect(() => {
    const cryptoSym = (settings?.watched_crypto && settings.watched_crypto[0]) || "BTC";
    setSelectedChartAsset(cryptoSym);
    setSelectedChartType("crypto");
  }, [settings]);

  useEffect(() => {
    const handler = (e) => {
      const det = e.detail || {};
      const { assetType, symbol } = det;
      if (assetType && symbol) {
        setSelectedChartType(assetType);
        setSelectedChartAsset(symbol);
      }
    };
    window.addEventListener("dashboard:chart-symbol", handler);
    return () => window.removeEventListener("dashboard:chart-symbol", handler);
  }, []);

  // Removed useEffect for location.search / timestamp as useQuery handles cache.

  useEffect(() => {
    const handleRefreshEvents = () => {
      // Trigger all relevant refetches
      invalidateCache(); // Invalidate general base44 cache
      invalidatePriceCache(); // Invalidate price data cache for any manual price fetches
      refetchWallet();
      refetchHoldings();
      refetchTrades();
      wsRefresh(); // Refresh WebSocket data
      refreshPnL(); // Refresh PnL data
    };

    window.addEventListener('kraken:synced', handleRefreshEvents);
    window.addEventListener('trade:completed', handleRefreshEvents); // Listen to our own custom event as well

    return () => {
      window.removeEventListener('kraken:synced', handleRefreshEvents);
      window.removeEventListener('trade:completed', handleRefreshEvents);
    };
  }, [refetchWallet, refetchHoldings, refetchTrades, wsRefresh, refreshPnL]);


  const handleTouchStart = (e) => touchStartY.current = e.touches[0].clientY;

  const handleTouchMove = (e) => {
    const currentY = e.touches[0].clientY;
    const distance = currentY - touchStartY.current;
    if (distance > 0 && window.scrollY === 0) {
      setPullDistance(Math.min(distance, 100));
      e.preventDefault();
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance > 60) {
      setIsPullRefreshing(true);
      invalidateCache();
      invalidatePriceCache(); // Invalidate any price caches
      const refreshPromises = [
        refetchWallet(),
        refetchHoldings(),
        refetchTrades(),
        wsRefresh(), // Trigger WebSocket refresh
        refreshPnL(), // Trigger PnL refresh
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
      const isSimModeLocal = settings?.sim_trading_mode !== false;
      const tradeType = (tradeData.type || "").toLowerCase();

      // CRITICAL FIX: Stricter duplicate detection with 10-second window
      if (tradeLock.lastTrade) {
        const timeSince = Date.now() - tradeLock.lastTrade.timestamp;
        const isSameSymbol = tradeLock.lastTrade.symbol === tradeData.symbol;
        const isSameType = tradeLock.lastTrade.type === tradeType;
        const isSameQuantity = Math.abs(tradeLock.lastTrade.quantity - (tradeData.quantity || 0)) < 0.000001; // Added quantity check
        const isSameAmount = Math.abs(tradeLock.lastTrade.total_value - (tradeData.total_value || 0)) < 0.01;

        // CRITICAL: Block duplicate trades within 10 seconds with same parameters
        if (timeSince < 10000 && isSameSymbol && isSameType && isSameQuantity && isSameAmount) {
          console.error('[Dashboard] 🚫 DUPLICATE TRADE BLOCKED:', {
            symbol: tradeData.symbol,
            type: tradeType,
            timeSince: `${(timeSince / 1000).toFixed(1)}s`,
            lastTradeTimestamp: tradeLock.lastTrade.timestamp,
            currentTradeTimestamp: Date.now()
          });

          toast.error("Duplicate trade blocked", {
            description: `${tradeData.symbol} ${tradeType} was just executed ${(timeSince / 1000).toFixed(1)}s ago`
          });
          return;
        }
      }

      // CRITICAL FIX: If another trade is being processed, queue this one
      if (tradeLock.isLocked) {
        console.log('[Dashboard] Trade locked, queueing current trade...');
        return new Promise((resolve) => {
          tradeLock.queue.push({ tradeData, resolve });
        });
      }

      tradeLock.isLocked = true;

      try {
        // Use refetch for the freshest wallet data
        const { data: freshWallet } = await refetchWallet();

        if (!freshWallet) {
          throw new Error("Wallet not found");
        }

        const currentCash = isSimModeLocal
          ? (freshWallet.cash_balance || 0)
          : (freshWallet.real_cash_balance || 0);

        const totalCost = Number(tradeData.total_value || (tradeData.quantity * tradeData.price) || 0);

        if (totalCost <= 0 || !isFinite(totalCost)) {
          toast.error("Trade rejected - Invalid amount");
          tradeLock.isLocked = false; // UNLOCK on early exit
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
            tradeLock.isLocked = false; // UNLOCK on early exit
            return;
          }

          const projectedBalance = currentCash - totalCost;
          if (projectedBalance < -0.01) {
            toast.error("Trade rejected", {
              description: "This would cause a negative balance"
            });
            tradeLock.isLocked = false; // UNLOCK on early exit
            return;
          }
        }

        if (tradeType === "sell") {
          // Use refetch for the freshest holdings data
          const { data: freshHoldings } = await refetchHoldings();

          const holding = freshHoldings.find(
            h => (h.symbol || "").toUpperCase() === (correctedTradeData.symbol || "").toUpperCase()
          );

          if (!holding) {
            toast.error("Trade rejected - No holdings", {
              description: `You don't own any ${correctedTradeData.symbol}`
            });
            tradeLock.isLocked = false; // UNLOCK on early exit
            return;
          }

          if (holding.quantity < correctedTradeData.quantity) {
            toast.error("Trade rejected - Insufficient holdings", {
              description: `You only own ${holding.quantity.toFixed(4)} ${correctedTradeData.symbol}`
            });
            tradeLock.isLocked = false; // UNLOCK on early exit
            return;
          }
        }

        // CRITICAL: Record BEFORE execution to prevent duplicates
        tradeLock.lastTrade = {
          symbol: correctedTradeData.symbol,
          type: tradeType,
          quantity: correctedTradeData.quantity, // Added quantity to lastTrade for stricter check
          total_value: totalCost,
          timestamp: Date.24();
        };

        // Add trade via addTrade (this should ideally trigger a refetchTrades or update trades cache)
        await base44.entities.Trade.create(correctedTradeData);

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

        // Fetch current holdings again after wallet update for accurate state.
        const { data: currentHoldingsAfterTrade } = await refetchHoldings();

        const existingHolding = currentHoldingsAfterTrade.find(
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

        // Invalidate all relevant caches and refetch data
        invalidateCache();
        invalidatePriceCache(); // Invalidate price data as holdings changed
        const refreshPromises = [
          refetchWallet(),
          refetchHoldings(),
          refetchTrades(),
          wsRefresh(), // Refresh WebSocket data
          refreshPnL() // Refresh PnL data
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
        invalidatePriceCache();
        const refreshPromises = [
          refetchWallet(),
          refetchHoldings(),
          refetchTrades(),
          wsRefresh(), // Refresh WebSocket data
          refreshPnL() // Refresh PnL data
        ];
        await Promise.all(refreshPromises);
      } finally {
        tradeLock.isLocked = false;

        if (tradeLock.queue.length > 0) {
          const next = tradeLock.queue.shift();
          // Added a small delay to prevent immediate re-locking, giving the UI a moment
          setTimeout(() => {
            handleTradeExecuted(next.tradeData).then(next.resolve);
          }, 1000);
        }
      }
    },
    [user, settings, refetchWallet, refetchHoldings, refetchTrades, wsRefresh, refreshPnL]
  );

  useAutoTrader(settings, user, handleTradeExecuted, wallet, currentHoldings, lifetimeChange, isSimMode);

  const handleSelectTrade = (trade) => setSelectedTrade(trade);
  const handleCloseModal = () => setSelectedTrade(null);

  if (isLoading && !wallet && !user && trades.length === 0 && currentHoldings.length === 0) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
        <div className="h-48 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
        <div className="h-64 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
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
            amount={balanceVisible ? (showZerosInLive ? 0 : totalBalance) : null}
            change={showZerosInLive ? { value: 0, percentage: 0 } : realized24h}
            onToggleVisibility={() => setBalanceVisible(!balanceVisible)}
            isVisible={balanceVisible}
            isPrimary={true}
            isSimMode={isSimMode}
            changeLabel="24h Realized PnL (Kraken)"
            wallet={wallet}
            balanceType="total"
            krakenPnL={pnlData}
          />
        </motion.div>

        <div className="grid grid-cols-2 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <BalanceCard
              title="Cash Wallet"
              amount={balanceVisible ? (showZerosInLive ? 0 : currentCashBalance) : null}
              change={showZerosInLive ? { value: 0, percentage: 0 } : lifetimeChange}
              icon={DollarSign}
              isVisible={balanceVisible}
              isSimMode={isSimMode}
              changeLabel="Lifetime PnL (Kraken)"
              wallet={wallet}
              balanceType="cash"
              krakenPnL={pnlData}
            />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <BalanceCard
              title="Portfolio"
              amount={balanceVisible ? (showZerosInLive ? 0 : currentPortfolioValue) : null}
              change={showZerosInLive ? { value: 0, percentage: 0 } : lifetimeChange}
              icon={Activity}
              isVisible={balanceVisible}
              isSimMode={isSimMode}
              changeLabel="Lifetime PnL (Kraken)"
              wallet={wallet}
              balanceType="portfolio"
              krakenPnL={pnlData}
            />
          </motion.div>
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <QuickActions />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
        <CryptoMarketOverview />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
        {selectedChartType === "crypto" ? (
          <CryptoPriceChart symbol={selectedChartAsset || "BTC"} />
        ) : (
          <StockPriceChart symbol={selectedChartAsset || "AAPL"} />
        )}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
        <PerformanceChart trades={trades} holdings={currentHoldings} wallet={wallet} isSimMode={isSimMode} krakenPnL={pnlData} />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
        <RecentTrades trades={trades} onTradeSelect={handleSelectTrade} />
      </motion.div>
    </div>
  );
}
