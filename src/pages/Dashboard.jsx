import React, { useState, useEffect, useCallback, useRef } from "react";
import { DollarSign, Activity } from "lucide-react";
import { createPageUrl } from "@/utils";
import { motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSettings } from "../components/utils/SettingsContext";
import { base44 } from "@/api/base44Client";

// Import entities used directly by useAutoTrader
import { ConditionalOrder, AutoBuyPreference } from "@/entities/all";

// Import centralized hooks with direct file paths
import { useWallet } from "@/components/hooks/useWallet";
import { useTrades } from "@/components/hooks/useTrades";
import { useHoldings } from "@/components/hooks/useHoldings";
import { useUser } from "@/components/hooks/useUser";
import { invalidateCache } from "@/components/hooks/useDataFetching";
import { usePriceData } from "@/components/hooks/usePriceData";
import { useKrakenWebSocket } from "@/components/providers/KrakenWebSocketProvider";
import { useBracketOrderSync } from "@/components/hooks/useBracketOrderSync";
import { useKrakenPnL } from "@/components/hooks/useKrakenPnL";

import BalanceCard from "../components/dashboard/BalanceCard";
import RecentTrades from "../components/dashboard/RecentTrades";
import PerformanceChart from "../components/dashboard/PerformanceChart";
import QuickActions from "../components/dashboard/QuickActions";
import TradeDetailsModal from "../components/dashboard/TradeDetailsModal";
import CryptoMarketOverview from "../components/dashboard/CryptoMarketOverview";
import CryptoPriceChart from "../components/dashboard/CryptoPriceChart";
import StockPriceChart from "../components/dashboard/StockPriceChart";

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
      // Reduce cooldown to 90 seconds for faster response
      if (nowTs < backoffUntilRef.current || (lastRunRef.current && nowTs - lastRunRef.current < 90000)) return;
      isRunningRef.current = true;
      
      console.log('[AutoTrader] Starting trade cycle - isSimMode:', isSimMode);
      
      try {
        // CRITICAL: For LIVE mode, fetch Kraken balances directly
        let krakenHoldings = [];
        let krakenCashBalance = 0;
        
        if (!isSimMode) {
          try {
            console.log('[AutoTrader] Fetching Kraken balances...');
            const krakenResponse = await Promise.race([
              base44.functions.invoke('getKrakenBalance', {}),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Kraken balance timeout')), 15000))
            ]);
            
            const krakenData = krakenResponse?.data || krakenResponse;
            console.log('[AutoTrader] Kraken response:', JSON.stringify(krakenData));
            
            if (krakenData?.success && krakenData?.connected) {
              krakenCashBalance = krakenData.usd_balance || 0;
              krakenHoldings = (krakenData.holdings || []).filter(h => h.quantity > 0.00001);
              console.log('[AutoTrader] Kraken cash:', krakenCashBalance, 'holdings:', krakenHoldings.length);
            }
          } catch (krakenError) {
            console.error('[AutoTrader] Kraken fetch error:', krakenError.message);
          }
        }
        
        const freshWallets = await base44.entities.Wallet.filter({ created_by: user.email }, "-updated_date", 1);
        const freshWallet = freshWallets[0];
        if (!freshWallet && isSimMode) return;
        
        // Use Kraken balance for LIVE mode, wallet for SIM mode
        let cashAvailable = isSimMode 
          ? (freshWallet?.cash_balance || 0) 
          : (krakenCashBalance > 0 ? krakenCashBalance : (freshWallet?.real_cash_balance || 0));

        console.log('[AutoTrader] Cash available:', cashAvailable);

        // CRITICAL: Allow negative balance check to be more lenient - only stop if SEVERELY negative
        if (cashAvailable < -100) {
          try {
            const settingsRecords = await base44.entities.UserSettings.filter({ created_by: user.email });
            if (settingsRecords[0]) await base44.entities.UserSettings.update(settingsRecords[0].id, { auto_trading_enabled: false });
          } catch (e) {}
          toast.error("🚨 Auto-Trader Emergency Stop", { description: `Wallet balance is severely negative ($${cashAvailable.toFixed(2)}). Auto-trading has been disabled. Please reconcile your wallet.`, duration: 10000 });
          if (settings?.notifications_enabled === true) {
            base44.functions.invoke("pushNotifications", { action: "sendNotification", payload: { title: "🚨 Auto-Trader Emergency Stop", body: `Wallet balance is severely negative ($${cashAvailable.toFixed(2)}). Auto-trading disabled.`, data: { type: "emergency_stop" } } }).catch(() => {});
          }
          return;
        }

        // Normalize small negative balances to zero
        if (cashAvailable < 0) {
          cashAvailable = 0;
        }
        // CRITICAL: Low balance no longer blocks sell orders - only affects buying
        const isLowBalance = cashAvailable < 1;
        // CRITICAL: Always fetch active orders to check for holdings without orders
        let activeOrders = await ConditionalOrder.filter({ created_by: user.email, status: "active", is_simulation: isSimMode });
        nextOrdersCheckAtRef.current = nowTs + 5 * 60 * 1000;
        
        console.log('[AutoTrader] Active orders:', activeOrders.length);

        // CRITICAL: For LIVE mode, use Kraken holdings; for SIM mode, use DB holdings
        let freshHoldings;
        if (!isSimMode && krakenHoldings.length > 0) {
          // Convert Kraken holdings to app format
          freshHoldings = krakenHoldings.map(h => ({
            symbol: h.symbol,
            quantity: h.quantity,
            average_cost_price: h.cost_basis_per_unit || h.current_price || 0,
            asset_type: 'crypto',
            is_simulation: false,
            created_by: user.email
          }));
          console.log('[AutoTrader] Using Kraken holdings:', freshHoldings.length);
        } else {
          freshHoldings = await base44.entities.Holding.filter({ created_by: user.email, is_simulation: isSimMode });
          console.log('[AutoTrader] Using DB holdings:', freshHoldings.length);
        }

        // Find holdings that don't have active conditional orders
        const holdingsWithoutOrders = freshHoldings.filter(holding => {
          const symU = (holding.symbol || "").toUpperCase();
          const hasOrder = activeOrders.some(order => (order.symbol || "").toUpperCase() === symU);
          return !hasOrder && (holding.quantity || 0) > 0.00001;
        });

        console.log('[AutoTrader] Holdings without orders:', holdingsWithoutOrders.length);

        // Auto-create conditional orders for holdings without them
        if (holdingsWithoutOrders.length > 0) {
          console.log('[AutoTrader] Creating conditional orders for', holdingsWithoutOrders.length, 'holdings');

          for (const holding of holdingsWithoutOrders) {
            const symU = (holding.symbol || "").toUpperCase();
            let purchasePrice = holding.average_cost_price || 0;

            // CRITICAL: For LIVE mode, if no cost basis, fetch current market price
            if (purchasePrice <= 0 && !isSimMode) {
              try {
                const priceRes = await base44.functions.invoke('getMarketData', {
                  action: 'getWatchlistData',
                  payload: { cryptoSymbols: [symU], stockSymbols: [] }
                });
                const priceData = Array.isArray(priceRes?.data) ? priceRes.data : [];
                const found = priceData.find(p => (p.symbol || "").toUpperCase() === symU);
                if (found?.price > 0) {
                  purchasePrice = found.price;
                  console.log('[AutoTrader] Fetched market price for', symU, ':', purchasePrice);
                }
              } catch (priceError) {
                console.error('[AutoTrader] Price fetch error for', symU, ':', priceError.message);
              }
            }

            // Skip if we still don't have a valid price
            if (purchasePrice <= 0) {
              console.log('[AutoTrader] Skipping', symU, '- no valid purchase price');
              continue;
            }

            const newOrder = {
              symbol: symU,
              asset_type: holding.asset_type || "crypto",
              quantity: holding.quantity,
              purchase_price: purchasePrice,
              gain_margin: parseFloat(settings?.gain_margin ?? 10),
              loss_margin: parseFloat(settings?.loss_margin ?? 5),
              trailing_enabled: true,
              trailing_margin: parseFloat(settings?.loss_margin ?? 5),
              highest_price: purchasePrice,
              status: "active",
              is_simulation: isSimMode,
              created_by: user.email
            };

            // CRITICAL: In LIVE mode, place REAL Kraken stop-loss AND take-profit orders for existing holdings
            if (!isSimMode) {
              console.log('[AutoTrader] 🟢 LIVE MODE - Placing REAL Kraken bracket orders for existing holding:', symU);

              // CRITICAL: Fetch current price to check if we're in profit
              let currentPrice = 0;
              try {
                const priceRes = await base44.functions.invoke('getMarketData', {
                  action: 'getWatchlistData',
                  payload: { cryptoSymbols: [symU], stockSymbols: [] }
                });
                const priceData = Array.isArray(priceRes?.data) ? priceRes.data : [];
                const found = priceData.find(p => (p.symbol || "").toUpperCase() === symU);
                currentPrice = found?.price || 0;
                console.log('[AutoTrader] Current price for', symU, ':', currentPrice, '| Cost:', purchasePrice);
              } catch (priceError) {
                console.error('[AutoTrader] Price fetch error for', symU, ':', priceError.message);
              }

              const lossMargin = parseFloat(settings?.loss_margin ?? 5);
              const gainMargin = parseFloat(settings?.gain_margin ?? 10);
              const stopLossPrice = parseFloat((purchasePrice * (1 - lossMargin / 100)).toFixed(2));
              const takeProfitPrice = parseFloat((purchasePrice * (1 + gainMargin / 100)).toFixed(2));
              const qty = parseFloat(holding.quantity.toFixed(8));

              // CRITICAL: Only place TP if current price >= cost (at or above break-even)
              const isAtBreakEven = currentPrice >= purchasePrice;
              console.log('[AutoTrader] Break-even check:', isAtBreakEven ? 'YES ✓' : 'NO ✗', '- Current:', currentPrice, 'Cost:', purchasePrice);

              let stopLossOrderId = null;
              let takeProfitOrderId = null;

              console.log('[AutoTrader] Bracket order params:', { symbol: symU, quantity: qty, stopLossPrice, takeProfitPrice, purchasePrice });

              // CRITICAL: Check minimum order sizes before sending to Kraken
              const minOrderSizes = {
                'BTC': 0.0001, 'ETH': 0.005, 'SOL': 0.1, 'XRP': 10.0, 'ADA': 10.0,
                'DOT': 0.5, 'DOGE': 50.0, 'LINK': 0.5, 'UNI': 0.5, 'MATIC': 10.0,
                'ATOM': 0.5, 'AVAX': 0.1, 'BCH': 0.002, 'LTC': 0.04, 'TRX': 50.0,
                'SHIB': 100000.0, 'XLM': 20.0, 'ALGO': 10.0, 'FIL': 0.2, 'NEAR': 1.0,
                'BABY': 100.0, 'FLOKI': 5000.0, 'WIF': 1.0, 'BONK': 100000.0, 'PEPE': 500000.0
              };

              const minQty = minOrderSizes[symU] || 0.00001;
              if (qty < minQty) {
                console.log('[AutoTrader] Skipping', symU, '- quantity', qty, 'below minimum', minQty);
                // Skip entirely - don't create orders for positions too small
                continue;
              }

              // CRITICAL: Only send bracket orders if at break-even or better
              if (!isAtBreakEven) {
                console.log('[AutoTrader] ⚠️ Skipping TP order - asset below break-even. Only placing SL.');
                // Place only stop-loss for underwater positions
                try {
                  const slResponse = await Promise.race([
                    base44.functions.invoke('krakenTrade', { 
                      action: 'place_order', 
                      symbol: symU, 
                      side: 'sell', 
                      quantity: qty, 
                      orderType: 'stop-loss',
                      stopPrice: stopLossPrice,
                      timeInForce: 'gtc'
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Stop-loss timeout')), 30000))
                  ]);

                  const slData = slResponse?.data || slResponse;
                  if (slData?.success) {
                    stopLossOrderId = slData.order_id;
                    console.log('[AutoTrader] ✅ Stop-loss only placed:', stopLossOrderId);
                  } else {
                    console.error('[AutoTrader] SL Failed:', slData?.error);
                  }
                } catch (slError) {
                  console.error('[AutoTrader] Stop-loss Error:', slError.message);
                }
              } else {
                // At break-even or profitable - place both TP and SL
                console.log('[AutoTrader] 📤 Sending BRACKET orders for', symU);
                console.log('[AutoTrader] TP:', takeProfitPrice.toFixed(2), 'SL:', stopLossPrice.toFixed(2));

                try {
                  const bracketResponse = await Promise.race([
                    base44.functions.invoke('krakenTrade', { 
                      action: 'place_bracket_orders', 
                      symbol: symU, 
                      quantity: qty, 
                      takeProfitPrice: takeProfitPrice,
                      stopLossPrice: stopLossPrice
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Bracket order timeout')), 60000))
                  ]);

                  const bracketData = bracketResponse?.data || bracketResponse;
                  console.log('[AutoTrader] Bracket Response:', JSON.stringify(bracketData));

                  if (bracketData?.tp_success) {
                    takeProfitOrderId = bracketData.tp_order_id;
                    console.log('[AutoTrader] ✅ Take-profit placed:', takeProfitOrderId);
                  } else {
                    console.error('[AutoTrader] TP Failed:', bracketData?.tp_error);
                  }

                  if (bracketData?.sl_success) {
                    stopLossOrderId = bracketData.sl_order_id;
                    console.log('[AutoTrader] ✅ Stop-loss placed:', stopLossOrderId);
                  } else {
                    console.error('[AutoTrader] SL Failed:', bracketData?.sl_error);
                  }
                } catch (bracketError) {
                  console.error('[AutoTrader] Bracket Error:', bracketError.message);
                }
              }

              // Determine success status and create local tracking
              const hasSL = !!stopLossOrderId;
              const hasTP = !!takeProfitOrderId;
              const krakenOrderIds = [stopLossOrderId, takeProfitOrderId].filter(Boolean).join(',');

              if (hasSL || hasTP) {
                toast.success(`🟢 LIVE Bracket Orders Set for ${symU}`, { 
                  description: `${hasSL ? `SL @ $${stopLossPrice.toFixed(2)} (-${lossMargin}%)` : 'SL failed'}${hasSL && hasTP ? ' • ' : ''}${hasTP ? `TP @ $${takeProfitPrice.toFixed(2)} (+${gainMargin}%)` : 'TP failed'}`,
                  duration: 4000
                });

                // Create local tracking order with Kraken order IDs
                const createdOrder = await ConditionalOrder.create({
                  ...newOrder,
                  kraken_order_id: krakenOrderIds,
                  closure_reason: null,
                  error_message: (!hasSL || !hasTP) ? `Partial bracket: ${!hasSL ? 'SL failed' : ''}${!hasSL && !hasTP ? ', ' : ''}${!hasTP ? 'TP failed' : ''}` : null
                });

                activeOrders.push({ ...newOrder, id: createdOrder?.id, kraken_order_id: krakenOrderIds });

                if (settings?.notifications_enabled === true) {
                  base44.functions.invoke("pushNotifications", { 
                    action: "sendNotification", 
                    payload: { 
                      title: `🟢 LIVE Bracket Orders Active • ${symU}`, 
                      body: `SL @ $${stopLossPrice.toFixed(2)} (-${lossMargin}%) | TP @ $${takeProfitPrice.toFixed(2)} (+${gainMargin}%)`,
                      data: { type: "bracket_orders_set", symbol: symU, live: true, kraken_order_ids: krakenOrderIds }
                    } 
                  }).catch(() => {});
                }

                // CRITICAL: Wait 2 seconds before processing next holding
                console.log('[AutoTrader] ⏳ Waiting 2 seconds before next holding...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                // Both failed - log but don't create local fallback
                console.error('[AutoTrader] Both bracket orders failed for', symU);
                }
                } else {
              // SIM MODE: Create local order only
              try {
                const createdOrder = await ConditionalOrder.create(newOrder);
                console.log('[AutoTrader] ✅ Created SIM conditional order for', symU, '- qty:', holding.quantity, 'price:', purchasePrice, 'id:', createdOrder?.id);

                activeOrders.push({ ...newOrder, id: createdOrder?.id });

                if (settings?.notifications_enabled === true) {
                  base44.functions.invoke("pushNotifications", { 
                    action: "sendNotification", 
                    payload: { 
                      title: `🤖 Auto-Trader Activated`, 
                      body: `Now monitoring ${symU} for sell conditions (TP: +${settings?.gain_margin ?? 10}%, SL: -${settings?.loss_margin ?? 5}%)`,
                      data: { type: "auto_order_created", symbol: symU, live: false }
                    } 
                  }).catch(() => {});
                }

                toast.success(`🤖 Monitoring ${symU}`, { 
                  description: `Created sell order: TP +${settings?.gain_margin ?? 10}%, SL -${settings?.loss_margin ?? 5}%`,
                  duration: 3000
                });
              } catch (createError) {
                console.error('[AutoTrader] Failed to create order for', symU, ':', createError.message);
              }
            }
          }
        }

        const stockSymbolsForOrders = [...new Set(activeOrders.filter(o => o.asset_type === "stock" || o.asset_type === "stocks").map(o => (o.symbol || "").toUpperCase()))];
        const cryptoSymbolsForOrders = [...new Set(activeOrders.filter(o => o.asset_type === "crypto").map(o => (o.symbol || "").toUpperCase()))];

        // For LIVE mode, also fetch prices for holdings to enable liquidation
        const holdingSymbols = [...new Set(freshHoldings.map(h => (h.symbol || "").toUpperCase()))];
        const allCryptoSymbols = [...new Set([...cryptoSymbolsForOrders, ...holdingSymbols])];

        console.log('[AutoTrader] Fetching prices for symbols:', allCryptoSymbols);

        let quoteListForOrders = [];
        if (stockSymbolsForOrders.length || allCryptoSymbols.length) {
          quoteListForOrders = await fetchQuotes({ stockSymbols: stockSymbolsForOrders, cryptoSymbols: allCryptoSymbols });
          console.log('[AutoTrader] Got quotes:', quoteListForOrders.length);
        }

        // CRITICAL: Calculate total portfolio value for LIVE mode liquidation logic
        const totalHoldingsValue = freshHoldings.reduce((sum, h) => {
          const sym = (h.symbol || "").toUpperCase();
          const priceData = quoteListForOrders.find(p => p.symbol === sym);
          return sum + ((h.quantity || 0) * (priceData?.price || 0));
        }, 0);

        const totalPortfolioValue = cashAvailable + totalHoldingsValue;
        const isAbove500 = totalPortfolioValue >= 500;

        // NOTE: Auto-liquidation removed to prevent 3rd order conflicts
        // Only TP and SL bracket orders should be placed for holdings

        // CRITICAL: Don't return early just because cash is low
        // The bot should ALWAYS check sell conditions on active orders
        // Only skip buy operations when cash is low
        console.log('[AutoTrader] Processing', activeOrders.length, 'active orders for sell conditions');
        
        for (const order of activeOrders) {
          const symU = (order.symbol || "").toUpperCase();
          const priceData = quoteListForOrders.find(p => p.symbol === symU);
          
          if (!priceData || typeof priceData.price !== "number" || priceData.price <= 0) {
            console.log('[AutoTrader] No price data for', symU);
            continue;
          }
          
          const currentPrice = priceData.price;
          const actualHolding = freshHoldings.find(h => (h.symbol || "").toUpperCase() === symU);
          
          if (!actualHolding) {
            console.log('[AutoTrader] No holding found for', symU, '- cancelling order');
            if (order.id) {
              queueOrderUpdate(order.id, { status: "cancelled" });
            }
            continue;
          }
          
          console.log('[AutoTrader] Checking', symU, '- price:', currentPrice, 'purchase:', order.purchase_price, 'qty:', actualHolding.quantity);
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

          // ENHANCED: Trailing take-profit for locking in gains
          const trailingTakeProfitEnabled = settings?.trailing_takeprofit_enabled !== false;
          const trailingTakeProfitMargin = typeof settings?.trailing_takeprofit_margin === "number" ? settings.trailing_takeprofit_margin : 3;

          let updatedHighest = order.highest_price || order.purchase_price;
          if (currentPrice > (order.highest_price || 0)) {
            const cachedHighest = highestPriceCache.current.get(order.id) || order.highest_price || 0;
            const priceChangePercent = cachedHighest > 0 ? ((currentPrice - cachedHighest) / cachedHighest) * 100 : 0;
            if (priceChangePercent > 0.5) {
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

          // ENHANCED: Trailing take-profit logic - lock in gains when price rises then drops
          const inProfit = updatedHighest > order.purchase_price * 1.02; // At least 2% profit before activating
          const trailingTakeProfit = trailingTakeProfitEnabled && inProfit ? updatedHighest * (1 - trailingTakeProfitMargin / 100) : null;

          let shouldSell = false;
          let tradeType = "";

          // Priority order: stop-loss > trailing take-profit > trailing stop-loss > static take-profit
          if (currentPrice <= lossPrice) { 
            shouldSell = true; 
            tradeType = "stop-loss"; 
          }
          else if (trailingTakeProfitEnabled && trailingTakeProfit && currentPrice <= trailingTakeProfit && currentPrice > order.purchase_price) { 
            shouldSell = true; 
            tradeType = "trailing-take-profit"; 
          }
          else if (trailingEnabled && updatedHighest > order.purchase_price && currentPrice <= trailingStop) { 
            shouldSell = true; 
            tradeType = "trailing-stop"; 
          }
          else if (!trailingTakeProfitEnabled && currentPrice >= gainPrice) { 
            shouldSell = true; 
            tradeType = "take-profit"; 
          }
          if (shouldSell) {
            console.log('[AutoTrader] ⚡ SELL TRIGGERED for', symU, '-', tradeType, '- qty:', sellQuantity, '@ $', currentPrice);

            const tradeDetails = { symbol: symU, type: "sell", asset_type: order.asset_type || "crypto", quantity: sellQuantity, price: currentPrice, total_value: sellQuantity * currentPrice, is_auto_trade: true };

            // CRITICAL: In LIVE mode, ALL sells MUST go through Kraken - no local-only orders
            if (!isSimMode) {
              console.log('[AutoTrader] 🟢 LIVE MODE - Sending REAL sell order to Kraken for', symU);
              try {
                const krakenResponse = await Promise.race([
                  base44.functions.invoke('krakenTrade', { 
                    action: 'place_order', 
                    symbol: symU, 
                    side: 'sell', 
                    quantity: parseFloat(sellQuantity.toFixed(8)), 
                    orderType: 'market',
                    timeInForce: 'ioc'
                  }),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Trade execution timeout')), 30000))
                ]);
                
                console.log('[AutoTrader] Kraken response:', JSON.stringify(krakenResponse));
                const krakenData = krakenResponse?.data || krakenResponse;
                
                if (!krakenData?.success) {
                  throw new Error(krakenData?.error || 'Kraken trade failed - no success flag');
                }

                const krakenOrderId = krakenData.order_id || krakenData.txid || null;

                console.log('[AutoTrader] ✅ LIVE sell executed on Kraken -', symU, 'order ID:', krakenOrderId);
                
                toast.success("🟢 LIVE Auto-Sell Executed", { 
                  description: `Sold ${sellQuantity.toFixed(4)} ${symU} @ $${currentPrice.toFixed(2)} on Kraken (Order: ${krakenOrderId || 'submitted'})`, 
                  duration: 5000 
                });
                
                // Record trade in local DB for history
                const profitAmount = (currentPrice - order.purchase_price) * sellQuantity;
                await base44.entities.Trade.create({ 
                  ...tradeDetails, 
                  is_simulation: false, 
                  created_by: user.email, 
                  status: 'executed',
                  kraken_order_id: krakenOrderId
                });

                // Mark conditional order as executed with Kraken ID and closure reason
                if (order.id) {
                  await ConditionalOrder.update(order.id, { 
                    status: "executed", 
                    kraken_order_id: krakenOrderId,
                    closure_reason: `${tradeType} triggered: Sold ${sellQuantity.toFixed(4)} ${symU} @ $${currentPrice.toFixed(2)} on Kraken. Order ID: ${krakenOrderId || 'N/A'}`,
                    error_message: null
                  });
                }

                highestPriceCache.current.delete(order.id);

                // ENHANCED: Auto-reinvest profits
                if (profitAmount > 0) {
                  const reinvestPct = typeof settings?.reinvest_profit_percentage === "number" ? settings.reinvest_profit_percentage : 80;
                  const reinvestAmount = (profitAmount * reinvestPct) / 100;

                  if (reinvestAmount >= 1) {
                    console.log('[AutoTrader] 💰 Profit reinvestment:', reinvestAmount.toFixed(2), '(', reinvestPct, '% of', profitAmount.toFixed(2), ')');

                    if (settings?.notifications_enabled === true) {
                      base44.functions.invoke("pushNotifications", { 
                        action: "sendNotification", 
                        payload: { 
                          title: `💰 Profit Reinvestment Ready`, 
                          body: `$${reinvestAmount.toFixed(2)} from ${symU} sale will be reinvested automatically`,
                          data: { type: "profit_reinvest", amount: reinvestAmount }
                        } 
                      }).catch(() => {});
                    }
                  }
                }
                
                if (settings?.notifications_enabled === true) {
                  base44.functions.invoke("pushNotifications", { 
                    action: "sendNotification", 
                    payload: { 
                      title: `🟢 LIVE Auto-Sell Executed • ${symU}`, 
                      body: `${tradeType.replace("-", " ")}: Sold ${sellQuantity.toFixed(4)} at $${currentPrice.toFixed(2)} on Kraken`,
                      data: { type: "trade", symbol: symU, tradeType: "sell", reason: tradeType, live: true, kraken_order_id: krakenOrderId }
                    } 
                  }).catch(() => {});
                }
              } catch (krakenError) {
                const errorMsg = krakenError.message || 'Unknown Kraken error';
                console.error('[AutoTrader] ❌ Kraken sell failed:', errorMsg);
                const isRateLimit = errorMsg && /rate limit|429/i.test(errorMsg);
                if (isRateLimit) {
                  failureCountRef.current++;
                  backoffUntilRef.current = Date.now() + (Math.min(30, Math.pow(2, failureCountRef.current) * 2) * 60 * 1000);
                }
                
                // Store the error in the order for display
                if (order.id) {
                  await ConditionalOrder.update(order.id, { 
                    error_message: `Kraken sell failed: ${errorMsg}`,
                    closure_reason: `${tradeType} triggered but Kraken order failed: ${errorMsg}`
                  }).catch(() => {});
                }
                
                toast.error("🔴 LIVE Trade Failed", { 
                  description: `Failed to sell ${symU} on Kraken: ${errorMsg}`, 
                  duration: 10000 
                });
                // DO NOT execute locally - in LIVE mode, only Kraken orders count
                continue;
              }
            } else {
              // SIM MODE: Execute locally only
              try {
                const profitAmount = (currentPrice - order.purchase_price) * sellQuantity;
                await onTrade(tradeDetails);
                toast.success("🤖 Auto-Trade Executed", { 
                  description: `Sold ${tradeDetails.quantity.toFixed(4)} ${tradeDetails.symbol} @ $${tradeDetails.price.toFixed(2)} (${tradeType}).` 
                });
                queueOrderUpdate(order.id, { status: "executed" });
                highestPriceCache.current.delete(order.id);

                // ENHANCED: Auto-reinvest profits in SIM mode
                if (profitAmount > 0) {
                  const reinvestPct = typeof settings?.reinvest_profit_percentage === "number" ? settings.reinvest_profit_percentage : 80;
                  const reinvestAmount = (profitAmount * reinvestPct) / 100;

                  if (reinvestAmount >= 1) {
                    console.log('[AutoTrader] 💰 SIM Profit reinvestment:', reinvestAmount.toFixed(2), '(', reinvestPct, '% of', profitAmount.toFixed(2), ')');
                  }
                }
                
                if (settings?.notifications_enabled === true) {
                  base44.functions.invoke("pushNotifications", { 
                    action: "sendNotification", 
                    payload: { 
                      title: `💎 Auto-Sell Executed • ${symU}`, 
                      body: `${tradeType.replace("-", " ")}: Sold ${sellQuantity.toFixed(4)} at $${currentPrice.toFixed(2)}`,
                      data: { type: "trade", symbol: symU, tradeType: "sell", reason: tradeType, live: false }
                    } 
                  }).catch(() => {});
                }
              } catch (tradeError) {
                console.error(`Failed to execute sell for ${symU}:`, tradeError);
                toast.error("💎 Auto-trade failed", { description: `Failed to sell ${symU}. Please try manually.` });
              }
            }
          }
          checkAndFlushBatch();
        }
        await flushBatchQueue();

        // CRITICAL: Continue to buying logic - don't return early just because of low balance
        // The sell orders above have already been processed
        if (!settings?.auto_trading_enabled) {
          return;
        }

        // Notify user if in low balance mode (but don't stop completely)
        if (isLowBalance && !lowBalanceNotifiedRef.current) {
          if (settings?.notifications_enabled === true) {
            base44.functions.invoke("pushNotifications", { action: "sendNotification", payload: { title: "Auto-Trader: Limited Buy Mode", body: `Cash balance is low ($${cashAvailable.toFixed(2)}). Auto-buying limited until balance increases.`, data: { type: "low_balance" } } }).catch(() => {});
          }
          lowBalanceNotifiedRef.current = true;
        }
        if (cashAvailable >= 1 && lowBalanceNotifiedRef.current) lowBalanceNotifiedRef.current = false;

        // CRITICAL: Skip buy operations if cash is too low, but don't skip entirely
        if (cashAvailable < 1) {
          console.log('[AutoTrader] Skipping buy operations - cash too low:', cashAvailable.toFixed(2));
          return;
        }

        const prefs = await AutoBuyPreference.filter({ created_by: user.email, is_simulation: isSimMode, enabled: true }, "-created_date", 30);
        if (prefs.length === 0) return;
        const cryptoPrefs = [...new Set(prefs.filter(p => p.asset_type === "crypto").map(p => String(p.symbol || "").toUpperCase().trim()))];
        const stockPrefs = [...new Set(prefs.filter(p => p.asset_type === "stock").map(p => String(p.symbol || "").toUpperCase().trim()))];
        const quotesForBuy = await fetchQuotes({ stockSymbols: stockPrefs, cryptoSymbols: cryptoPrefs });
        if (!Array.isArray(quotesForBuy) || quotesForBuy.length === 0) return;
        // CRITICAL: Aggressive trading mode enabled
        // Below $500: build capital with 40% of cash
        // Above $500: full trading mode with 85% of cash for maximum returns
        const isCashBuildUpMode = totalPortfolioValue < 500;
        let remainingCash = isCashBuildUpMode ? cashAvailable * 0.4 : cashAvailable * 0.85;
        if (remainingCash <= 1.0) return;
        
        // CRITICAL: Use new "Small Gains" LLM for conservative, high-probability trades
        let analysisMap = {};
        try {
          console.log('[AutoTrader] Calling Small Gains Analyzer...');
          const smartAnalysis = await base44.functions.invoke('analyzeSmallGains', {
            symbols: cryptoPrefs.concat(stockPrefs)
          });
          
          const smartData = smartAnalysis?.data || smartAnalysis;
          console.log('[AutoTrader] Small Gains response:', JSON.stringify(smartData));
          
          if (smartData?.success && Array.isArray(smartData?.recommendations)) {
            // Convert recommendations to analysis map format
            analysisMap = smartData.recommendations.reduce((acc, r) => {
              const confidence = (r.confidence_score || 60) / 100; // Convert 0-100 to 0-1
              acc[(r.symbol || "").toUpperCase()] = { 
                confidence: Math.max(0, Math.min(1, confidence)),
                action: (r.action || "buy").toLowerCase(),
                predictedGain: r.predicted_gain_percent || 10,
                reasoning: r.reasoning || ''
              };
              return acc;
            }, {});
            console.log('[AutoTrader] Smart analysis generated', Object.keys(analysisMap).length, 'recommendations');
          } else {
            console.log('[AutoTrader] No smart recommendations, using default confidence');
          }
        } catch (_e) {
          console.error('[AutoTrader] Small Gains analysis error:', _e);
        }
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
          const rec = analysisMap[sym] || { confidence: 0.6, action: "buy" };
          if (rec.action === "hold" || rec.action === "sell") continue;
          const basePct = Math.max(15, Number(p.percentage) || 15) / 100;
          const multiplier = Math.min(2.0, 0.6 + rec.confidence * 1.4);
          const fraction = Math.max(0.08, Math.min(0.45, basePct * multiplier));
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
          // CRITICAL: In LIVE mode, ALL buys MUST go through Kraken - no local-only orders
          if (!isSimMode) {
            console.log('[AutoTrader] 🟢 LIVE MODE - Sending REAL buy order to Kraken for', sym);
            try {
              const krakenResponse = await Promise.race([
                base44.functions.invoke('krakenTrade', { 
                  action: 'place_order', 
                  symbol: sym, 
                  side: 'buy', 
                  quantity: parseFloat(finalQty.toFixed(8)), 
                  orderType: 'market',
                  timeInForce: 'ioc'
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Trade execution timeout')), 20000))
              ]);
              
              const krakenData = krakenResponse?.data || krakenResponse;
              console.log('[AutoTrader] Kraken buy response:', JSON.stringify(krakenData));
              
              if (!krakenData?.success) {
                throw new Error(krakenData?.error || 'Kraken trade failed');
              }

              const krakenBuyOrderId = krakenData.order_id || krakenData.txid || null;
              console.log('[AutoTrader] ✅ LIVE buy executed on Kraken -', sym, 'order ID:', krakenBuyOrderId);

              toast.success("🟢 LIVE Auto-Buy Executed", { 
                description: `Bought ${finalQty.toFixed(4)} ${sym} @ $${price.toFixed(2)} on Kraken (Order: ${krakenBuyOrderId || 'submitted'})`, 
                duration: 5000 
              });
              
              // Record trade in local DB for history
              await base44.entities.Trade.create({ 
                ...tradeDetails, 
                is_simulation: false, 
                created_by: user.email, 
                status: 'executed',
                kraken_order_id: krakenBuyOrderId
              });

              remainingCash = Math.max(0, remainingCash - total);
              
              // CRITICAL: Place REAL Kraken bracket orders (stop-loss AND take-profit) for this buy
              const lossMargin = parseFloat(settings?.loss_margin ?? 5);
              const gainMargin = parseFloat(settings?.gain_margin ?? 10);
              const stopLossPrice = parseFloat((price * (1 - lossMargin / 100)).toFixed(2));
              const takeProfitPrice = parseFloat((price * (1 + gainMargin / 100)).toFixed(2));
              const orderQty = parseFloat(finalQty.toFixed(8));

              let stopLossOrderId = null;
              let takeProfitOrderId = null;

              // CRITICAL: Check minimum order sizes before sending bracket orders
              const minOrderSizesForBuy = {
                'BTC': 0.0001, 'ETH': 0.005, 'SOL': 0.1, 'XRP': 10.0, 'ADA': 10.0,
                'DOT': 0.5, 'DOGE': 50.0, 'LINK': 0.5, 'UNI': 0.5, 'MATIC': 10.0,
                'ATOM': 0.5, 'AVAX': 0.1, 'BCH': 0.002, 'LTC': 0.04, 'TRX': 50.0,
                'SHIB': 100000.0, 'XLM': 20.0, 'ALGO': 10.0, 'FIL': 0.2, 'NEAR': 1.0,
                'BABY': 100.0, 'FLOKI': 5000.0, 'WIF': 1.0, 'BONK': 100000.0, 'PEPE': 500000.0
              };

              const minQtyForBracket = minOrderSizesForBuy[sym] || 0.00001;
              const skipBracketOrders = orderQty < minQtyForBracket;

              if (skipBracketOrders) {
                console.log('[AutoTrader] Skipping bracket orders for', sym, '- quantity', orderQty, 'below minimum', minQtyForBracket);
              } else {
                // CRITICAL: Use single WebSocket connection for both bracket orders
                console.log('[AutoTrader] 📤 Sending BRACKET orders for', sym);
                console.log('[AutoTrader] TP:', takeProfitPrice.toFixed(2), 'SL:', stopLossPrice.toFixed(2));

                try {
                  const bracketResponse = await Promise.race([
                    base44.functions.invoke('krakenTrade', { 
                      action: 'place_bracket_orders', 
                      symbol: sym, 
                      quantity: orderQty, 
                      takeProfitPrice: takeProfitPrice,
                      stopLossPrice: stopLossPrice
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Bracket order timeout')), 60000))
                  ]);

                  const bracketData = bracketResponse?.data || bracketResponse;
                  console.log('[AutoTrader] Bracket Response:', JSON.stringify(bracketData));

                  if (bracketData?.tp_success) {
                    takeProfitOrderId = bracketData.tp_order_id;
                    console.log('[AutoTrader] ✅ Take-profit placed:', takeProfitOrderId);
                  } else {
                    console.error('[AutoTrader] TP Failed:', bracketData?.tp_error);
                  }

                  if (bracketData?.sl_success) {
                    stopLossOrderId = bracketData.sl_order_id;
                    console.log('[AutoTrader] ✅ Stop-loss placed:', stopLossOrderId);
                  } else {
                    console.error('[AutoTrader] SL Failed:', bracketData?.sl_error);
                  }
                } catch (bracketError) {
                  console.error('[AutoTrader] Bracket Error:', bracketError.message);
                }
              }

              const hasSL = !!stopLossOrderId;
              const hasTP = !!takeProfitOrderId;
              const krakenOrderIds = [stopLossOrderId, takeProfitOrderId].filter(Boolean).join(',');

              if (hasTP || hasSL) {
                toast.success("🟢 Bracket Orders Set", { 
                  description: `${hasTP ? `TP @ $${takeProfitPrice.toFixed(2)} (+${gainMargin}%)` : ''}${hasTP && hasSL ? ' • ' : ''}${hasSL ? `SL @ $${stopLossPrice.toFixed(2)} (-${lossMargin}%)` : ''}`,
                  duration: 3000 
                });
                
                // CRITICAL: Wait 2 seconds before next operation
                console.log('[AutoTrader] ⏳ Waiting 2 seconds after bracket orders...');
                await new Promise(resolve => setTimeout(resolve, 2000));
              }

              // Create local conditional order for trailing stop monitoring (backup)
              queueOrderCreate({ 
                symbol: sym, 
                asset_type: p.asset_type, 
                quantity: finalQty, 
                purchase_price: price, 
                gain_margin: gainMargin, 
                loss_margin: lossMargin,
                trailing_enabled: true,
                trailing_margin: lossMargin,
                highest_price: price,
                status: "active", 
                created_by: user.email, 
                is_simulation: false,
                kraken_order_id: krakenOrderIds || krakenBuyOrderId
              });
              
              nextOrdersCheckAtRef.current = Math.min(nextOrdersCheckAtRef.current, Date.now() + 2 * 60 * 1000);
              
              if (remainingCash < 1.0) break;
              
            } catch (krakenError) {
              console.error(`[AutoTrader] ❌ Kraken buy failed:`, krakenError.message);
              const isRateLimit = krakenError.message && /rate limit|429/i.test(krakenError.message);
              if (isRateLimit) {
                failureCountRef.current++;
                backoffUntilRef.current = Date.now() + (Math.min(30, Math.pow(2, failureCountRef.current) * 2) * 60 * 1000);
              }
              toast.error("🔴 LIVE Trade Failed", { 
                description: `Failed to buy ${sym} on Kraken: ${krakenError.message}`, 
                duration: 10000 
              });
              // DO NOT create local order - in LIVE mode, only Kraken orders count
              break;
            }
          } else {
            // SIM MODE: Execute locally only
            try {
              await onTrade(tradeDetails);
              remainingCash = Math.max(0, remainingCash - total);
              
              queueOrderCreate({ 
                symbol: sym, 
                asset_type: p.asset_type, 
                quantity: finalQty, 
                purchase_price: price, 
                gain_margin: parseFloat(settings?.gain_margin ?? 10), 
                loss_margin: parseFloat(settings?.loss_margin ?? 5),
                trailing_enabled: true,
                trailing_margin: parseFloat(settings?.loss_margin ?? 5),
                highest_price: price,
                status: "active", 
                created_by: user.email, 
                is_simulation: true
              });
              
              nextOrdersCheckAtRef.current = Math.min(nextOrdersCheckAtRef.current, Date.now() + 2 * 60 * 1000);
              
              if (remainingCash < 1.0) break;
            } catch (buyError) {
              console.error(`Failed to execute buy for ${sym}:`, buyError);
              console.log('[AutoTrader] Stopping auto-buys due to trade error');
              break;
            }
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
    // Run immediately on mount
    console.log('[AutoTrader] Hook initialized - running first trade cycle');
    performRuleBasedTrade();

    // Run every 90 seconds for aggressive live trading
    const interval = setInterval(performRuleBasedTrade, 90000);
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
  const { settings } = useSettings();
  const location = useLocation();
  
  const isSimMode = settings?.sim_trading_mode === true;
  const { wallet, loading: walletLoading, refresh: refreshWallet } = useWallet();
  const { trades, loading: tradesLoading, addTrade } = useTrades(isSimMode);
  const { holdings, loading: holdingsLoading, refresh: refreshHoldings } = useHoldings(isSimMode);
  const { user } = useUser();
  
  // CRITICAL: Use global WebSocket connection
  const {
    isConnected: wsConnected,
    usdBalance: wsUsdBalance,
    cryptoHoldingsValue: wsCryptoValue,
    totalPortfolioValue: wsTotalValue,
    totalAssets: wsTotalAssets,
    balances: wsBalances,
    prices: wsPrices
  } = useKrakenWebSocket();
  
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
  
  // CRITICAL: Cache last known good balances to prevent showing $0 during API failures
  const lastKnownBalancesRef = React.useRef({
    cash: null,
    portfolio: null,
    total: null
  });
  
  // CRITICAL: Fetch Kraken balances via REST API as fallback for LIVE mode
  const [krakenApiBalances, setKrakenApiBalances] = React.useState({
    usdBalance: 0,
    cryptoValue: 0,
    totalValue: 0,
    holdings: [],
    costBasis: 0,
    unrealizedPnL: 0,
    loaded: false
  });
  
  // Fetch Kraken balance from REST API (fallback when WebSocket not connected)
  React.useEffect(() => {
    if (isSimMode) return;
    
    const fetchKrakenBalance = async () => {
      try {
        const response = await base44.functions.invoke('getKrakenBalance', {});
        const data = response?.data || response;
        
        if (data?.success && data?.connected) {
          const newBalances = {
            usdBalance: data.usd_balance || 0,
            cryptoValue: data.total_crypto_value_usd || 0,
            totalValue: data.total_portfolio_value_usd || 0,
            holdings: data.holdings || [],
            costBasis: data.total_cost_basis_usd || 0,
            unrealizedPnL: data.total_unrealized_pnl_usd || 0,
            loaded: true
          };
          setKrakenApiBalances(newBalances);
          
          // Also cache these values
          if (newBalances.usdBalance > 0 || newBalances.cryptoValue > 0) {
            lastKnownBalancesRef.current = {
              cash: newBalances.usdBalance,
              portfolio: newBalances.cryptoValue,
              total: newBalances.totalValue
            };
          }
        }
      } catch (err) {
        console.error('[Dashboard] Kraken balance fetch failed:', err);
      }
    };
    
    // Fetch immediately
    fetchKrakenBalance();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchKrakenBalance, 30000);
    return () => clearInterval(interval);
  }, [isSimMode]);

  // CRITICAL: Build effective holdings from WebSocket in LIVE mode
  const effectiveHoldings = React.useMemo(() => {
    if (isSimMode) {
      return holdings;
    } else {
      // LIVE MODE: Use WebSocket balances if connected
      if (wsConnected && wsBalances && Object.keys(wsBalances).length > 0) {
        return Object.entries(wsBalances)
          .filter(([asset]) => asset !== 'USD' && asset !== 'ZUSD')
          .filter(([_, balance]) => (balance.balance || 0) > 0.00001)
          .map(([asset, balance]) => {
            const pair = `${asset}/USD`;
            const priceInfo = wsPrices[pair];
            
            return {
              symbol: asset,
              quantity: balance.balance || 0,
              average_cost_price: priceInfo?.price || 0,
              asset_type: 'crypto',
              current_price_usd: priceInfo?.price || 0,
              total_value_usd: (balance.balance || 0) * (priceInfo?.price || 0),
              is_simulation: false
            };
          });
      } else {
        return holdings;
      }
    }
  }, [isSimMode, holdings, wsConnected, wsBalances, wsPrices]);

  const allSymbols = React.useMemo(() => {
    return [...new Set(effectiveHoldings.map(h => (h.symbol || "").toUpperCase()))];
  }, [effectiveHoldings]);
  
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

    window.addEventListener('kraken:synced', handleDataRefresh);
    window.addEventListener('trade:completed', handleDataRefresh);
    
    return () => {
      window.removeEventListener('kraken:synced', handleDataRefresh);
      window.removeEventListener('trade:completed', handleDataRefresh);
    };
  }, [refreshWallet, refreshHoldings, refreshPrices]);

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

  useAutoTrader(settings, user, handleTradeExecuted, wallet, effectiveHoldings, lifetimeChange, isSimMode);

  // CRITICAL: Bracket order synchronization - cancels paired orders when one is filled
  useBracketOrderSync(isSimMode, user?.email);
  
  // CRITICAL: Fetch REAL Kraken PnL data for LIVE mode
  const { pnlData: krakenPnL, refresh: refreshKrakenPnL } = useKrakenPnL(isSimMode);

  const handleSelectTrade = (trade) => setSelectedTrade(trade);
  const handleCloseModal = () => setSelectedTrade(null);

  const compute24hChange = useCallback(() => {
    if (!Array.isArray(effectiveHoldings) || effectiveHoldings.length === 0) {
      setChange24h({ value: 0, percentage: 0 });
      setPortfolioMarketValue(0);
      setEnrichedHoldings([]);
      return;
    }

    // CRITICAL: Use WebSocket data in LIVE mode
    if (!isSimMode && wsConnected && wsTotalValue >= 0) {
      setPortfolioMarketValue(wsTotalValue);
      setEnrichedHoldings(effectiveHoldings); 
      setChange24h({ value: 0, percentage: 0 });
      return;
    }

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

    const cash = isSimMode ? (wallet?.cash_balance || 0) : (wsUsdBalance || wallet?.real_cash_balance || 0);
    const totalDelta = currentHoldingsValue - prevHoldingsValue;
    const prevTotal = (cash || 0) + prevHoldingsValue;
    const pctChange = prevTotal > 0 ? (totalDelta / prevTotal) * 100 : 0;

    setChange24h({ value: totalDelta, percentage: pctChange });
  }, [effectiveHoldings, wallet, settings, priceData, isSimMode, wsConnected, wsTotalValue, wsUsdBalance]);

  useEffect(() => {
    if (effectiveHoldings.length > 0 && (priceData?.length > 0 || (wsConnected && wsTotalValue >= 0)) || effectiveHoldings.length === 0) {
      compute24hChange();
    }
  }, [compute24hChange, effectiveHoldings, priceData, wsConnected, wsTotalValue]);

  useEffect(() => {
    const isSimModeLocal = settings?.sim_trading_mode !== false;
    
    // CRITICAL: For LIVE mode, use REAL Kraken PnL from getKrakenPnL endpoint
    if (!isSimModeLocal && krakenPnL) {
      // 24h realized PnL from Kraken trades
      const realized24hValue = krakenPnL.pnl_24h || 0;
      const realized24hPct = krakenPnL.realized_pnl > 0 ? (realized24hValue / krakenPnL.realized_pnl) * 100 : 0;
      setRealized24h({ value: realized24hValue, percentage: realized24hPct });
      
      // Lifetime PnL = realized + unrealized from Kraken
      const lifetimePnLValue = krakenPnL.pnl_lifetime || 0;
      // Calculate percentage based on current portfolio value
      const currentValue = (wsConnected && wsCryptoValue > 0) ? wsCryptoValue :
        (krakenApiBalances.loaded && krakenApiBalances.cryptoValue > 0) ? krakenApiBalances.cryptoValue :
        portfolioMarketValue;
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

  }, [trades, settings, portfolioMarketValue, isSimMode, wsTotalValue, wsConnected, wsCryptoValue, krakenApiBalances, krakenPnL]);

  useEffect(() => {
    const handleTradeCompleted = () => {
      compute24hChange();
    };

    window.addEventListener('trade:completed', handleTradeCompleted);
    return () => window.removeEventListener('trade:completed', handleTradeCompleted);
  }, [compute24hChange]);

  // CRITICAL: Use WebSocket balances in LIVE mode with REST API fallback
  // Priority: WebSocket (if connected AND value > 0) > REST API > Wallet DB > Cache
  // MUST MATCH PortfolioSummary logic exactly for consistency!
  
  // Cash Wallet = USD balance from Kraken
  const rawCashBalance = isSimMode 
    ? (wallet?.cash_balance || 0) 
    : (
        // WebSocket first - only if connected AND has a positive balance
        (wsConnected && wsUsdBalance > 0) ? wsUsdBalance :
        // REST API fallback
        (krakenApiBalances.loaded && krakenApiBalances.usdBalance > 0) ? krakenApiBalances.usdBalance :
        // Wallet DB last resort
        (wallet?.real_cash_balance || 0)
      );
  
  // Portfolio = ONLY crypto holdings (NOT including cash)
  // CRITICAL: Match PortfolioSummary's effectivePortfolioValue calculation exactly
  // PortfolioSummary uses: wsConnected && wsCryptoValue > 0 ? wsCryptoValue : currentPortfolioValue
  const rawPortfolioValue = isSimMode
    ? portfolioMarketValue
    : (
        // WebSocket first - only if connected AND has a positive value
        (wsConnected && wsCryptoValue > 0) ? wsCryptoValue :
        // REST API fallback
        (krakenApiBalances.loaded && krakenApiBalances.cryptoValue > 0) ? krakenApiBalances.cryptoValue :
        // Calculated from holdings last resort
        portfolioMarketValue
      );
    
  // Update cache when we have valid data
  React.useEffect(() => {
    if (rawCashBalance > 0) {
      lastKnownBalancesRef.current.cash = rawCashBalance;
    }
    if (rawPortfolioValue > 0) {
      lastKnownBalancesRef.current.portfolio = rawPortfolioValue;
    }
    if (rawCashBalance > 0 || rawPortfolioValue > 0) {
      lastKnownBalancesRef.current.total = (lastKnownBalancesRef.current.cash || 0) + (lastKnownBalancesRef.current.portfolio || 0);
    }
  }, [rawCashBalance, rawPortfolioValue]);
  
  // Use cached values if current values are zero but we had data before
  const currentCashBalance = rawCashBalance > 0 
    ? rawCashBalance 
    : (lastKnownBalancesRef.current.cash ?? 0);
    
  const currentPortfolioValue = rawPortfolioValue > 0 
    ? rawPortfolioValue 
    : (lastKnownBalancesRef.current.portfolio ?? 0);
    
  // Total Balance = Cash + Portfolio (crypto)
  const totalBalance = currentCashBalance + currentPortfolioValue;

  const hasRealCash = Number(wallet?.real_cash_balance || 0) > 0 || (wsConnected && wsUsdBalance > 0);
  const hasRealHoldings = (Array.isArray(holdings) && holdings.some(h => h.is_simulation === false)) || (wsConnected && wsTotalAssets > 0);
  const hasRealTrades = Array.isArray(trades) && trades.some(t => t.is_simulation === false);
  const showZerosInLive = !isSimMode && !hasRealCash && !hasRealHoldings && !hasRealTrades;

  if (isLoading && !wallet && !user && trades.length === 0 && effectiveHoldings.length === 0) {
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
            changeLabel="24h Realized PnL (sales)"
          />
        </motion.div>

        <div className="grid grid-cols-2 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <BalanceCard
              title="Cash Wallet"
              amount={balanceVisible ? (showZerosInLive ? 0 : currentCashBalance) : null}
              icon={DollarSign}
              isVisible={balanceVisible}
              isSimMode={isSimMode}
              changeLabel="Live Lifetime"
              linkTo={createPageUrl("Wallet")}
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
              changeLabel="Live Lifetime"
              linkTo={createPageUrl("Portfolio")}
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