import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Zap, ArrowUpCircle, ArrowDownCircle, Search, Save, Loader2, Settings as SettingsIcon, Bot, ShoppingCart, ShieldCheck } from "lucide-react";
import { InvokeLLM } from "@/integrations/Core";
import { UserSettings, User, ConditionalOrder, LedgerEntry } from "@/entities/all";
import TradeConfirmationDialog from "./TradeConfirmationDialog";
import AdvancedOrderModal from "./AdvancedOrderModal";
import { base44 } from "@/api/base44Client";
import { notify } from "@/components/utils/notifications";

/**
 * Generate idempotency key for trades
 */
function generateIdempotencyKey(userEmail, symbol, type) {
  const timestamp = Date.now();
  const key = `${userEmail}:${symbol}:${type}:${timestamp}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `manual_${Math.abs(hash)}_${timestamp}`;
}

export default function TradingInterface({ wallet, onTrade, autoTradingEnabled, holdings, isSimMode = true, currentCashBalance }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [quantity, setQuantity] = useState("");
  const [orderType, setOrderType] = useState("buy");
  const [assetType, setAssetType] = useState("crypto");
  const [isExecuting, setIsExecuting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isSellAll, setIsSellAll] = useState(false);
  const [tradeToConfirm, setTradeToConfirm] = useState(null);

  const [gainMargin, setGainMargin] = useState(10);
  const [lossMargin, setLossMargin] = useState(5);
  const [autoExecuteThreshold, setAutoExecuteThreshold] = useState(80);
  const [minSignalConfidence, setMinSignalConfidence] = useState(55);
  const [settings, setSettingsData] = useState(null);

  const [inputMode, setInputMode] = useState('quantity');
  const [currencyAmount, setCurrencyAmount] = useState('');

  const [showAdvancedOrder, setShowAdvancedOrder] = useState(false);
  const [advancedOrderConfig, setAdvancedOrderConfig] = useState(null);

  const availableCash = currentCashBalance !== undefined ? currentCashBalance : isSimMode ? wallet?.cash_balance || 0 : wallet?.real_cash_balance || 0;

  useEffect(() => {
    let cancelled = false;
    const fetchSettings = async () => {
      try {
        const userSettings = await UserSettings.list('-updated_date', 1);
        if (!cancelled && userSettings.length > 0) {
          setSettingsData(userSettings[0]);
          setGainMargin(userSettings[0].gain_margin || 10);
          setLossMargin(userSettings[0].loss_margin || 5);
          setAutoExecuteThreshold(userSettings[0].auto_execute_threshold ?? 80);
          setMinSignalConfidence(userSettings[0].min_signal_confidence ?? 55);
          setInputMode(userSettings[0].default_input_mode || 'quantity');
        }
      } catch (e) {
        console.warn('[TradingInterface] Settings fetch failed:', e.message);
      }
    };
    fetchSettings();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (orderType === 'buy') {
      setIsSellAll(false);
      setQuantity("");
      setCurrencyAmount("");
    }
  }, [orderType]);

  const roundToCents = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  const ownedAsset = useMemo(() => {
    if (selectedAsset && holdings) {
      return holdings.find((h) => h.symbol === selectedAsset.symbol);
    }
    return null;
  }, [selectedAsset, holdings]);

  const topOwnedAssets = useMemo(() => {
    if (!holdings) return [];
    return holdings.
    filter((h) => h.quantity > 0.00001).
    sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0)).
    slice(0, 3);
  }, [holdings]);

  const filteredOwnedAssets = useMemo(() => {
    if (!searchTerm || orderType !== 'sell') return topOwnedAssets;
    return holdings.
    filter((h) => h.quantity > 0.00001).
    filter((h) => h.symbol.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [holdings, searchTerm, orderType, topOwnedAssets]);

  useEffect(() => {
    if (orderType === 'sell' && isSellAll && ownedAsset && selectedAsset) {
      setQuantity(ownedAsset.quantity.toString());
      if (selectedAsset.price) {
        setCurrencyAmount(roundToCents(ownedAsset.quantity * selectedAsset.price).toFixed(2));
      }
    } else if (!isSellAll && orderType === 'sell') {
      setQuantity('');
      setCurrencyAmount('');
    }
  }, [isSellAll, ownedAsset, orderType, selectedAsset]);

  const performLiveSearch = useCallback(async (term, type) => {
    if (!term || term.length < 1) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const { data } = await base44.functions.invoke('getMarketData', {
        action: 'searchAssets',
        payload: { term: term, assetType: type }
      });

      const symbols = data.map((d) => d.symbol);
      const { data: priceData } = await base44.functions.invoke('getMarketData', {
        action: 'getWatchlistData',
        payload: { cryptoSymbols: type === 'crypto' ? symbols : [], stockSymbols: type === 'stocks' ? symbols : [] }
      });

      const resultsWithPrices = data.map((asset) => {
        const pData = priceData.find((p) => p.symbol === asset.symbol);
        return { ...asset, price: pData?.price };
      });

      setSearchResults(resultsWithPrices || []);
    } catch (error) {
      console.error("Asset search failed:", error);
      setSearchResults([]);
    }
    setIsSearching(false);
  }, []);

  useEffect(() => {
    if (searchTerm && orderType === 'buy') {
      const timeoutId = setTimeout(() => {
        performLiveSearch(searchTerm, assetType);
      }, 300);
      return () => clearTimeout(timeoutId);
    } else if (orderType === 'buy') {
      setSearchResults([]);
    }
  }, [searchTerm, performLiveSearch, orderType, assetType]);

  const calculateValues = () => {
    if (!selectedAsset || !selectedAsset.price) return { quantity: 0, totalValue: 0 };

    if (inputMode === 'quantity') {
      const qty = parseFloat(quantity || 0);
      const total = roundToCents(qty * selectedAsset.price);
      return { quantity: qty, totalValue: total };
    } else {
      const currAmt = parseFloat(currencyAmount || 0);
      const total = roundToCents(currAmt);
      const qty = selectedAsset.price > 0 ? total / selectedAsset.price : 0;
      return { quantity: qty, totalValue: total };
    }
  };

  const { quantity: calculatedQuantity, totalValue } = calculateValues();

  const handleSaveMargins = async () => {
    const currentUser = await User.me();
    const updatedSettings = {
      gain_margin: parseFloat(gainMargin),
      loss_margin: parseFloat(lossMargin),
      auto_execute_threshold: autoExecuteThreshold,
      min_signal_confidence: minSignalConfidence,
      default_input_mode: inputMode,
      auto_trading_enabled: true
    };

    if (settings?.id) {
      await UserSettings.update(settings.id, updatedSettings);
      setSettingsData((prev) => ({ ...prev, ...updatedSettings }));
    } else {
      const newSettings = await UserSettings.create({
        ...updatedSettings,
        created_by: currentUser.email
      });
      setSettingsData(newSettings);
    }
    
    notify.success("Trader settings saved", {
      description: "AI trading margins updated successfully"
    });
  };

  const canExecuteTrade = selectedAsset &&
  calculatedQuantity > 0 &&
  totalValue > 0 && (
  orderType === 'sell' ?
  ownedAsset && calculatedQuantity <= ownedAsset.quantity :
  roundToCents(availableCash) + 0.000001 >= roundToCents(totalValue)
  );

  const prepareTrade = async () => {
    if (!canExecuteTrade) return;

    // CRITICAL: Extra guard in LIVE mode - check BEFORE even showing confirmation dialog
    // This prevents users from seeing a confirmation and then getting "insufficient funds" error
    if (!isSimMode && orderType === 'buy') {
      const estCost = roundToCents(totalValue);
      const buffer = Math.max(1.0, estCost * 0.05); // 5% buffer for slippage
      const totalRequired = estCost + buffer;
      
      if (availableCash < totalRequired) {
        notify.error('Insufficient funds for this order', { 
          description: `Available: $${availableCash.toFixed(2)} • Needed: $${totalRequired.toFixed(2)} (incl. 5% buffer for fees)` 
        });
        return;
      }
    }

    // FIXED: ALWAYS include asset_type - get from ownedAsset if selling, otherwise use current assetType
    const effectiveAssetType = orderType === 'sell' && ownedAsset
      ? (ownedAsset.asset_type || 'crypto')
      : assetType;

    const tradeDetails = {
      symbol: selectedAsset.symbol,
      type: orderType,
      asset_type: effectiveAssetType,
      quantity: calculatedQuantity,
      price: selectedAsset.price,
      total_value: roundToCents(totalValue),
      is_auto_trade: false
    };

    console.log('[TradingInterface] Prepared trade:', tradeDetails);
    setTradeToConfirm(tradeDetails);
  };

  const handleConfirmTrade = async (tradeData, setConditional) => {
    setIsExecuting(true);

    const currentUser = await User.me();
    const userSettingsList = await UserSettings.filter({ created_by: currentUser.email });
    const userSettings = userSettingsList[0] || {};

    // OPTIMISTIC UI: Store previous state for potential rollback
    const previousState = {
      selectedAsset: selectedAsset ? { ...selectedAsset } : null,
      searchTerm,
      quantity,
      currencyAmount,
      isSellAll
    };

    // OPTIMISTIC UI: Immediately update UI before API call completes
    // This makes the app feel more responsive on mobile
    const optimisticCashChange = tradeData.type === 'buy' ? -tradeData.total_value : tradeData.total_value;
    
    // Dispatch optimistic update event for wallet/holdings displays
    window.dispatchEvent(new CustomEvent('trade:optimistic', {
      detail: {
        type: tradeData.type,
        symbol: tradeData.symbol,
        quantity: tradeData.quantity,
        total_value: tradeData.total_value,
        cashChange: optimisticCashChange,
        timestamp: Date.now()
      }
    }));

    // Clear form immediately for better UX
    setSelectedAsset(null);
    setSearchTerm("");
    setQuantity("");
    setCurrencyAmount("");
    setIsSellAll(false);

    // Rollback function in case of error
    const rollbackOptimistic = () => {
      setSelectedAsset(previousState.selectedAsset);
      setSearchTerm(previousState.searchTerm);
      setQuantity(previousState.quantity);
      setCurrencyAmount(previousState.currencyAmount);
      setIsSellAll(previousState.isSellAll);
      
      // Dispatch rollback event
      window.dispatchEvent(new CustomEvent('trade:rollback', {
        detail: { timestamp: Date.now() }
      }));
    };

    // Generate idempotency key to prevent duplicate trades
    const idempotencyKey = generateIdempotencyKey(currentUser.email, tradeData.symbol, tradeData.type);
    console.log('[TradingInterface] Generated idempotency key:', idempotencyKey);
    
    // CRITICAL: For LIVE mode, send order directly to Kraken first
    if (!isSimMode) {
      try {
        console.log('[TradingInterface] LIVE mode - sending order to Kraken:', tradeData);
        
        // Run risk engine check before executing
        try {
          const riskResult = await base44.functions.invoke('riskEngine', {
            action: 'evaluateTrade',
            payload: {
              proposedTrade: {
                symbol: tradeData.symbol,
                type: tradeData.type,
                quantity: tradeData.quantity,
                price: tradeData.price,
                total_value: tradeData.total_value,
                is_simulation: false
              },
              portfolioState: null // Will be fetched by risk engine
            }
          });
          
          const risk = riskResult?.data || riskResult;
          
          if (!risk?.approved) {
            const rejection = risk?.rejections?.[0];
            notify.error('Trade rejected by risk engine', {
              description: rejection?.message || 'Risk limits exceeded'
            });
            rollbackOptimistic();
            setIsExecuting(false);
            return;
          }
          
          if (risk?.warnings?.length > 0) {
            risk.warnings.forEach(w => {
              notify.warning(w.rule, { description: w.message });
            });
          }
        } catch (riskErr) {
          console.warn('[TradingInterface] Risk check failed, proceeding:', riskErr.message);
        }

        // CRITICAL: Preflight funds check (LIVE BUY) - MUST pass before any order is sent
        // This is the FIRST LINE OF DEFENSE against "insufficient funds" errors
        if (tradeData.type === 'buy') {
          const estCost = Number(tradeData.total_value || (tradeData.quantity * tradeData.price) || 0);
          const buffer = Math.max(1.0, estCost * 0.05); // 5% or $1 buffer for slippage + fees
          const totalRequired = estCost + buffer;
          
          // First check: UI-displayed available cash (quick fail)
          if (availableCash < totalRequired) {
            notify.error('Insufficient funds', {
              description: `Available: $${availableCash.toFixed(2)} • Needed: $${totalRequired.toFixed(2)} (incl. fees)`
            });
            rollbackOptimistic();
            setIsExecuting(false);
            return;
          }
          
          // Second check: Fresh Kraken balance (authoritative)
          try {
            const balRes = await base44.functions.invoke('getKrakenBalance', {});
            const bal = balRes?.data || balRes;
            // CRITICAL: Use available_usd_balance which excludes funds locked in open orders
            const usdAvail = parseFloat(bal?.available_usd_balance ?? bal?.usd_balance ?? 0);
            
            console.log(`[TradingInterface] Preflight check: UI shows $${availableCash.toFixed(2)}, Kraken has $${usdAvail.toFixed(2)}, need $${totalRequired.toFixed(2)}`);
            
            if (usdAvail < totalRequired) {
              notify.error('Insufficient USD on Kraken', {
                description: `Available: $${usdAvail.toFixed(2)} • Needed: $${totalRequired.toFixed(2)} (incl. 5% buffer)`
              });
              rollbackOptimistic();
              setIsExecuting(false);
              return;
            }
          } catch (e) {
            // If we can't verify Kraken balance, use UI cash as fallback
            console.warn('[TradingInterface] Balance preflight failed:', e?.message);
            if (availableCash < totalRequired) {
              notify.error('Insufficient funds (verification failed)', {
                description: `Available: $${availableCash.toFixed(2)} • Needed: $${totalRequired.toFixed(2)}`
              });
              rollbackOptimistic();
              setIsExecuting(false);
              return;
            }
          }
        }
        
        // Preflight holdings check (LIVE SELL) against Kraken asset balance
        if (tradeData.type === 'sell') {
          try {
            const balRes = await base44.functions.invoke('getKrakenBalance', {});
            const bal = balRes?.data || balRes;
            const holdings = bal?.holdings || {};
            
            // Find matching asset (handle Kraken naming: BTC, XBT, etc.)
            const symbol = tradeData.symbol.toUpperCase();
            const assetBalance = holdings[symbol]?.quantity || holdings[`X${symbol}`]?.quantity || 0;
            
            console.log(`[TradingInterface] SELL preflight: ${symbol} owned=${assetBalance}, selling=${tradeData.quantity}`);
            
            if (assetBalance < tradeData.quantity - 1e-8) {
              notify.error(`Insufficient ${symbol} on Kraken`, {
                description: `Available: ${assetBalance.toFixed(6)} • Trying to sell: ${tradeData.quantity.toFixed(6)}`
              });
              setIsExecuting(false);
              return;
            }
          } catch (e) {
            console.warn('[TradingInterface] Holdings preflight failed, proceeding:', e?.message || e);
          }
        }

        // Prefetch a trade WS token to ensure Trade key usage and reduce rate limits
        let __wsToken = null;
        try {
          const __t = await base44.functions.invoke('krakenApi', { action: 'getWebSocketUrl', payload: { keyType: 'trade' } });
          __wsToken = (__t?.data || __t)?.token || null;
        } catch (_) {}
        
        const krakenResponse = await base44.functions.invoke('krakenTrade', {
          action: 'place_order',
          symbol: tradeData.symbol,
          side: tradeData.type, // 'buy' or 'sell'
          quantity: tradeData.quantity,
          orderType: 'market',
          wsToken: __wsToken
        });

        const krakenData = krakenResponse?.data || krakenResponse;
        console.log('[TradingInterface] Kraken response:', krakenData);

        if (!krakenData?.success) {
          throw new Error(krakenData?.error || 'Kraken order failed');
        }

        const krakenOrderId = krakenData.order_id || krakenData.txid || null;
const exchangeQty = typeof krakenData?.executed_qty === 'number' ? krakenData.executed_qty : (typeof krakenData?.quantity === 'number' ? krakenData.quantity : undefined);

        // Use exchange-confirmed values (quantity may be adjusted to minimums)
        let recordedQty = (typeof exchangeQty === 'number') ? exchangeQty : tradeData.quantity;
        let recordedPrice = tradeData.price;
        let recordedTotal = roundToCents(recordedQty * recordedPrice);

        // CRITICAL: Try to resolve exact fills from Kraken for precise price, quantity, and cost
        // Kraken may return different values due to partial fills, price slippage, or minimums
        try {
          // Small delay to allow Kraken to process the trade
          await new Promise(res => setTimeout(res, 1000));
          
          const histRes = await base44.functions.invoke('krakenApi', { action: 'getTradesHistory' });
          const histData = histRes?.data || histRes;
          const tradesArr = histData?.trades || [];
          
          console.log('[TradingInterface] Looking for trade with ordertxid:', krakenOrderId);
          
          // Find the matching trade - Kraken links trades to orders via ordertxid
          const match = tradesArr.find(t => t.ordertxid === krakenOrderId) || 
                        tradesArr.find(t => t.order_id === krakenOrderId);
          
          if (match) {
            // CRITICAL: Use EXACT values from Kraken - these are the ACTUAL executed values
            // - vol: actual quantity executed (may differ from requested due to minimums/partials)
            // - price: actual execution price (may differ due to slippage)
            // - cost: actual USD value (vol * price, this is the real cash impact)
            const exactQty = parseFloat(match.vol);
            const exactPrice = parseFloat(match.price);
            const exactCost = parseFloat(match.cost);
            
            console.log('[TradingInterface] Kraken fill found:', {
              requested: { qty: recordedQty, price: recordedPrice, total: recordedTotal },
              actual: { qty: exactQty, price: exactPrice, cost: exactCost }
            });
            
            // Use EXACT Kraken values - these are what actually happened
            if (exactQty > 0) recordedQty = exactQty;
            if (exactPrice > 0) recordedPrice = exactPrice;
            if (exactCost > 0) {
              recordedTotal = roundToCents(exactCost);
            } else {
              // Fallback: calculate from qty * price if cost is missing
              recordedTotal = roundToCents(recordedQty * recordedPrice);
            }
            
            console.log('[TradingInterface] Using Kraken exact values:', {
              qty: recordedQty, price: recordedPrice, total: recordedTotal
            });
          } else {
            console.warn('[TradingInterface] No matching trade found in Kraken history for order:', krakenOrderId);
            // Fallback: calculate total from qty * price
            recordedTotal = roundToCents(recordedQty * recordedPrice);
          }
        } catch (e) {
          console.warn('[TradingInterface] Could not resolve fill details:', e?.message || e);
          // Fallback: ensure total is calculated
          recordedTotal = roundToCents(recordedQty * recordedPrice);
        }

        // Inform user if exchange adjusted the quantity
        if (Math.abs(recordedQty - tradeData.quantity) > 1e-8) {
          notify.info('Quantity adjusted to exchange minimum', {
            description: `Requested ${tradeData.quantity.toFixed(6)} → Executed ${recordedQty.toFixed(6)}`
          });
        }

        notify.success("🟢 LIVE Order Executed", {
          description: `${tradeData.type === 'buy' ? 'Bought' : 'Sold'} ${recordedQty.toFixed(4)} ${tradeData.symbol} on Kraken`,
          duration: 5000,
          data: { trade: { ...tradeData, quantity: recordedQty, price: recordedPrice, total_value: recordedTotal } },
          dedupKey: `${tradeData.type}:${tradeData.symbol}`
        });

        // CRITICAL: Record trade directly in DB - bypass onTrade validation for LIVE mode
        // Kraken already validated the order, so we trust it
        console.log('[TradingInterface] Recording LIVE trade in DB:', { ...tradeData, quantity: recordedQty, price: recordedPrice, total_value: recordedTotal });
        
        await base44.entities.Trade.create({
          symbol: tradeData.symbol,
          type: tradeData.type,
          asset_type: tradeData.asset_type,
          quantity: recordedQty,
          price: recordedPrice,
          total_value: recordedTotal,
          is_auto_trade: false,
          is_simulation: false,
          status: 'filled',
          idempotency_key: idempotencyKey,
          kraken_order_id: krakenOrderId,
          submitted_at: new Date().toISOString(),
          filled_at: new Date().toISOString(),
          created_by: currentUser.email
        });
        
        // Create LedgerEntry for audit trail
        try {
          await LedgerEntry.create({
            asset_symbol: tradeData.symbol,
            entry_type: tradeData.type === 'buy' ? 'trade_buy' : 'trade_sell',
            quantity_delta: tradeData.type === 'buy' ? recordedQty : -recordedQty,
            cash_delta: tradeData.type === 'buy' ? -recordedTotal : recordedTotal,
            unit_price: recordedPrice,
            reference_type: 'trade',
            reference_id: krakenOrderId,
            idempotency_key: `${idempotencyKey}_ledger`,
            kraken_txid: krakenOrderId,
            is_simulation: false,
            created_by: currentUser.email
          });
        } catch (ledgerErr) {
          console.warn('[TradingInterface] Failed to create ledger entry:', ledgerErr.message);
        }

        console.log('[TradingInterface] ✅ LIVE trade recorded in DB');

        // Dispatch event for UI refresh
        window.dispatchEvent(new CustomEvent('trade:completed', {
          detail: { timestamp: Date.now(), trade: tradeData }
        }));

        // CRITICAL: For LIVE buys with conditional orders, place REAL Kraken stop-loss orders
        // Also create local tracking record for the auto-trader
        if (tradeData.type === 'buy' && setConditional) {
          try {
            // Calculate stop-loss and take-profit prices
            const stopLossPrice = tradeData.price * (1 - parseFloat(lossMargin) / 100);
            const takeProfitPrice = tradeData.price * (1 + parseFloat(gainMargin) / 100);

            console.log('[TradingInterface] Placing Kraken stop-loss order:', {
              symbol: tradeData.symbol,
              quantity: tradeData.quantity,
              stopPrice: stopLossPrice
            });

            // Place REAL Kraken stop-loss order
            let stopLossOrderId = null;
            try {
              const stopLossResponse = await base44.functions.invoke('krakenTrade', {
                action: 'place_order',
                symbol: tradeData.symbol,
                side: 'sell',
                quantity: tradeData.quantity,
                orderType: 'stop-loss',
                stopPrice: stopLossPrice,
                timeInForce: 'gtc',
                wsToken: __wsToken
              });

              const slData = stopLossResponse?.data || stopLossResponse;
              if (slData?.success) {
                stopLossOrderId = slData.order_id || slData.txid;
                console.log('[TradingInterface] ✅ Kraken stop-loss order placed:', stopLossOrderId);
                
                notify.success("🟢 LIVE Stop-Loss Set", {
                  description: `SL @ $${stopLossPrice.toFixed(2)} (-${lossMargin}%) on Kraken`,
                  duration: 3000,
                  dedupKey: `sl:${tradeData.symbol}`
                });
              } else {
                console.warn('[TradingInterface] Stop-loss order failed:', slData?.error);
              }
            } catch (slError) {
              console.error('[TradingInterface] Stop-loss order error:', slError.message);
              // Don't fail the whole flow - we still have local tracking
            }

            // Also create local conditional order for app-based monitoring (backup/trailing)
            const conditionalOrder = await ConditionalOrder.create({
              symbol: tradeData.symbol,
              asset_type: tradeData.asset_type || 'crypto',
              quantity: tradeData.quantity,
              purchase_price: tradeData.price,
              gain_margin: parseFloat(gainMargin),
              loss_margin: parseFloat(lossMargin),
              trailing_enabled: true,
              trailing_margin: parseFloat(lossMargin),
              highest_price: tradeData.price,
              status: 'active',
              is_simulation: false,
              idempotency_key: `${idempotencyKey}_conditional`,
              kraken_order_id: krakenOrderId,
              kraken_sl_order_id: stopLossOrderId || null,
              trade_id: krakenOrderId,
              created_by: currentUser.email
            });

            console.log('[TradingInterface] ✅ Created LIVE conditional order:', conditionalOrder);

            notify.success("🤖 Auto-Trader Monitoring", {
              description: `TP: +${gainMargin}% | SL: -${lossMargin}% ${stopLossOrderId ? '(Kraken SL active)' : '(trailing enabled)'}`,
              duration: 3000
            });

            if (!autoTradingEnabled) {
              if (settings?.id) {
                await UserSettings.update(settings.id, { auto_trading_enabled: true });
              } else {
                await UserSettings.create({ auto_trading_enabled: true, created_by: currentUser.email });
              }
            }
          } catch (e) {
            console.error("[TradingInterface] Failed to create conditional order:", e);
            notify.error("Warning: Trade executed but auto-sell not set", {
              description: "You may need to manually sell this position"
            });
          }
        }

      } catch (krakenError) {
        console.error('[TradingInterface] Kraken order failed:', krakenError);
        
        // ROLLBACK optimistic update on error
        rollbackOptimistic();
        
        notify.error("🔴 LIVE Order Failed", {
          description: krakenError.message || 'Failed to execute order on Kraken',
          duration: 10000,
          data: { error: krakenError.message },
          dedupKey: `${tradeData.type}:${tradeData.symbol}`
        });
        
        // Record failed order in database so it appears in "Failed Orders" list
        try {
          await ConditionalOrder.create({
            symbol: tradeData.symbol,
            asset_type: tradeData.asset_type || 'crypto',
            quantity: tradeData.quantity,
            purchase_price: tradeData.price,
            gain_margin: parseFloat(gainMargin),
            loss_margin: parseFloat(lossMargin),
            status: 'failed',
            is_simulation: false,
            error_message: krakenError.message || 'Failed to execute order on Kraken',
            created_by: currentUser.email
          });
          // Dispatch event to refresh orders list
          window.dispatchEvent(new CustomEvent('trade:failed'));
        } catch (logErr) {
          console.error("Failed to log failed order:", logErr);
        }

        setIsExecuting(false);
        return; // Don't continue if Kraken order failed
      }
    } else {
      // SIM MODE: Execute locally only
      try {
        await onTrade(tradeData);

        if (tradeData.type === 'buy' && setConditional) {
          try {
            await ConditionalOrder.create({
              symbol: tradeData.symbol,
              asset_type: tradeData.asset_type || 'crypto',
              quantity: tradeData.quantity,
              purchase_price: tradeData.price,
              gain_margin: parseFloat(gainMargin),
              loss_margin: parseFloat(lossMargin),
              trailing_enabled: true,
              trailing_margin: parseFloat(lossMargin),
              highest_price: tradeData.price,
              status: 'active',
              is_simulation: true,
              created_by: currentUser.email
            });

            if (!autoTradingEnabled) {
              if (settings?.id) {
                await UserSettings.update(settings.id, { auto_trading_enabled: true });
              } else {
                await UserSettings.create({ auto_trading_enabled: true, created_by: currentUser.email });
              }
            }
          } catch (e) {
            console.error("Failed to create conditional order:", e);
          }
        }
      } catch (simError) {
        console.error('[TradingInterface] SIM trade failed:', simError);
        // ROLLBACK optimistic update on error
        rollbackOptimistic();
        notify.error("Trade Failed", {
          description: simError.message || 'Failed to execute simulation trade'
        });
        setIsExecuting(false);
        return;
      }
    }

    const notificationsEnabled = userSettings.notifications_enabled === true;
    const tradeNotificationsEnabled = userSettings.notifications_on_trade === true;
    const appInBackground = typeof document !== 'undefined' && document.visibilityState === "hidden";

    if (notificationsEnabled && tradeNotificationsEnabled && appInBackground) {
      if (typeof base44 !== 'undefined' && base44.functions && typeof base44.functions.invoke === 'function') {
        base44.functions.invoke("pushNotifications", {
          action: "sendNotification",
          payload: {
            title: `${isSimMode ? '💎' : '🟢 LIVE'} Trade Executed • ${tradeData.symbol}`,
            body: `${tradeData.type === "buy" ? "Bought" : "Sold"} ${tradeData.quantity.toFixed(4)} @ $${tradeData.price.toFixed(2)}`,
            data: { type: "trade", symbol: tradeData.symbol }
          }
        }).catch((err) => {
          console.error('[PORTFOLIO] Push notification error:', err);
        });
      }
    }

    setTradeToConfirm(null);
    // Form already cleared optimistically at start
    setIsExecuting(false);
    
    // Dispatch final confirmation event
    window.dispatchEvent(new CustomEvent('trade:confirmed', {
      detail: { timestamp: Date.now(), trade: tradeData }
    }));
  };

  const handleAdvancedOrder = () => {
    if (!selectedAsset || calculatedQuantity <= 0) {
      notify.error("Please select an asset and enter quantity");
      return;
    }

    setAdvancedOrderConfig({
      asset: selectedAsset,
      side: orderType,
      quantity: calculatedQuantity,
      asset_type: assetType,
    });
    setShowAdvancedOrder(true);
  };

  const handleExecuteAdvancedOrder = async (orderConfig) => {
    if (isSimMode) {
      notify.error("Advanced orders only available in LIVE mode", {
        description: "Switch to live trading to use advanced order types"
      });
      return;
    }

    setIsExecuting(true);

    try {
      console.log('[TradingInterface] Executing advanced order:', orderConfig);

      // Prefetch a Trade WS token
      let __wsToken = null;
      try {
        const __t = await base44.functions.invoke('krakenApi', { action: 'getWebSocketUrl', payload: { keyType: 'trade' } });
        __wsToken = (__t?.data || __t)?.token || null;
      } catch (_) {}

      const response = await base44.functions.invoke('krakenTrade', {
        action: 'place_order',
        ...orderConfig,
        wsToken: __wsToken
      });

      const data = response?.data || response;

      if (!data?.success) {
        throw new Error(data?.error || 'Order failed');
      }

      console.log('[TradingInterface] ✅ Advanced order placed:', data);

      await onTrade({
        symbol: orderConfig.symbol,
        type: orderConfig.side,
        asset_type: orderConfig.asset_type || 'crypto', // Ensure asset_type is always set, fallback to 'crypto'
        quantity: orderConfig.quantity,
        price: orderConfig.limitPrice || selectedAsset.price || 0,
        total_value: orderConfig.quantity * (orderConfig.limitPrice || selectedAsset.price || 0),
        is_auto_trade: false
      });

      notify.success("🟢 LIVE Order Placed", {
        description: `${orderConfig.orderType} ${orderConfig.side} order for ${orderConfig.quantity} ${orderConfig.symbol}`,
        duration: 5000,
        data: { order: orderConfig },
        dedupKey: `${orderConfig.side}:${orderConfig.symbol}`
      });

      setSelectedAsset(null);
      setSearchTerm("");
      setQuantity("");
      setCurrencyAmount("");
      setShowAdvancedOrder(false);
      setAdvancedOrderConfig(null);

    } catch (error) {
      console.error('[TradingInterface] Advanced order error:', error);
      notify.error("Order Failed", {
        description: error.message || "Failed to place order on Kraken",
        data: { error: error.message }
      });
      
      // Record failed advanced order
      try {
        const currentUser = await User.me();
        await ConditionalOrder.create({
          symbol: orderConfig.symbol,
          asset_type: orderConfig.asset_type || 'crypto',
          quantity: orderConfig.quantity,
          purchase_price: orderConfig.limitPrice || selectedAsset?.price || 0,
          gain_margin: parseFloat(gainMargin),
          loss_margin: parseFloat(lossMargin),
          status: 'failed',
          is_simulation: false,
          error_message: error.message || 'Failed to execute advanced order',
          created_by: currentUser.email
        });
        // Dispatch event to refresh orders list
        window.dispatchEvent(new CustomEvent('trade:failed'));
      } catch (logErr) {
        console.error("Failed to log failed advanced order:", logErr);
      }
      
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <>
      <AdvancedOrderModal
        isOpen={showAdvancedOrder}
        onClose={() => {
          setShowAdvancedOrder(false);
          setAdvancedOrderConfig(null);
        }}
        asset={advancedOrderConfig?.asset}
        side={advancedOrderConfig?.side}
        quantity={advancedOrderConfig?.quantity}
        assetType={advancedOrderConfig?.asset_type}
        onExecute={handleExecuteAdvancedOrder}
      />

      {tradeToConfirm &&
      <TradeConfirmationDialog
        isOpen={!!tradeToConfirm}
        onClose={() => setTradeToConfirm(null)}
        tradeDetails={tradeToConfirm}
        onConfirm={handleConfirmTrade}
        isSimMode={isSimMode} />
      }

      {/* SECTION 1: TRADER SETTINGS */}
      <Card className="border-2" style={{ 
        backgroundColor: 'var(--card-bg)', 
        borderColor: 'var(--neon-green)',
        borderStyle: 'dashed'
      }}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Bot className="w-5 h-5 neon-text" />
              AI Trader Settings
            </CardTitle>
            {autoTradingEnabled &&
            <Badge className="bg-green-100 text-green-800 border-green-200">
              AI Trading Active
            </Badge>
            }
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-700 dark:text-blue-400">
                💡 These margins control when the AI automatically sells your assets to lock in profits or cut losses.
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="gain-margin">Profit Target %</Label>
                <Input
                  id="gain-margin"
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={gainMargin}
                  onChange={(e) => setGainMargin(e.target.value)}
                  placeholder="10.0"
                />
                <p className="text-xs text-gray-500 mt-1">
                  AI sells when price gains {gainMargin}%
                </p>
              </div>
              <div>
                <Label htmlFor="loss-margin">Stop Loss %</Label>
                <Input
                  id="loss-margin"
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={lossMargin}
                  onChange={(e) => setLossMargin(e.target.value)}
                  placeholder="5.0"
                />
                <p className="text-xs text-gray-500 mt-1">
                  AI sells when price drops {lossMargin}%
                </p>
              </div>
            </div>

            {/* Auto-Execute Threshold Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Auto-Execute Threshold</Label>
                <span className="text-sm font-mono font-bold neon-text">{autoExecuteThreshold}%</span>
              </div>
              <Slider
                value={[autoExecuteThreshold]}
                onValueChange={([v]) => setAutoExecuteThreshold(v)}
                min={50}
                max={100}
                step={5}
                className="w-full"
              />
              <p className="text-xs text-gray-500">
                AI only auto-executes trades when confidence is ≥ {autoExecuteThreshold}%
              </p>
            </div>

            {/* Min Signal Confidence Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Min Signal Confidence</Label>
                <span className="text-sm font-mono font-bold neon-text">{minSignalConfidence}%</span>
              </div>
              <Slider
                value={[minSignalConfidence]}
                onValueChange={([v]) => setMinSignalConfidence(v)}
                min={30}
                max={90}
                step={5}
                className="w-full"
              />
              <p className="text-xs text-gray-500">
                Only show signals with confidence ≥ {minSignalConfidence}%
              </p>
            </div>
            
            <Button 
              onClick={handleSaveMargins} 
              className="w-full neon-glow bg-green-600 hover:bg-green-700"
            >
              <Save className="w-4 h-4 mr-2" />
              Save Trader Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 2: MANUAL TRADE */}
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <ShoppingCart className="w-5 h-5" />
              Manual Trade
            </CardTitle>
            {isSimMode &&
            <Badge variant="outline" className="text-xs">
              Demo Mode
            </Badge>
            }
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={assetType} onValueChange={(val) => {setAssetType(val);setSearchTerm('');setSelectedAsset(null);setSearchResults([]);setQuantity('');setCurrencyAmount('');}}>
            <TabsList className="grid w-full grid-cols-2" style={{ backgroundColor: 'var(--secondary-bg)' }}>
              <TabsTrigger value="crypto">Crypto</TabsTrigger>
              <TabsTrigger value="stocks">Stocks</TabsTrigger>
            </TabsList>
            
            <TabsContent value={assetType} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <Button
                  variant={orderType === 'buy' ? 'default' : 'outline'}
                  className={`${orderType === 'buy' ? 'neon-glow bg-green-600 hover:bg-green-700' : ''}`}
                  onClick={() => setOrderType('buy')}>
                  <ArrowUpCircle className="w-4 h-4 mr-2" />
                  Buy
                </Button>
                <Button
                  variant={orderType === 'sell' ? 'default' : 'outline'}
                  className={`${orderType === 'sell' ? 'bg-red-600 hover:bg-red-700' : ''}`}
                  onClick={() => setOrderType('sell')}>
                  <ArrowDownCircle className="w-4 h-4 mr-2" />
                  Sell
                </Button>
              </div>
              
              {selectedAsset ?
              <div className="p-3 flex items-center justify-between rounded-lg bg-green-900/20 border border-green-500">
                <div>
                  <p className="font-bold">{selectedAsset.symbol}</p>
                  <p className="text-xs text-gray-400">{selectedAsset.name}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => {setSelectedAsset(null);setSearchTerm('');setSearchResults([]);setQuantity('');setCurrencyAmount('');}}>Change</Button>
              </div> :

              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <Input
                    placeholder={orderType === 'sell' ? `Search your ${assetType}...` : `Search for ${assetType}... (e.g. BTC, ETH, AAPL)`}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                  {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />}
                  
                  {orderType === 'buy' && searchResults.length > 0 &&
                  <div className="absolute z-10 w-full mt-1 bg-[var(--card-bg)] border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {searchResults.map((asset) =>
                      <div key={asset.symbol} onClick={() => {setSelectedAsset(asset);setSearchResults([]);setSearchTerm('');setQuantity('');setCurrencyAmount('');}}
                      className="p-3 hover:bg-[var(--secondary-bg)] cursor-pointer flex justify-between">
                        <span>{asset.symbol} - {asset.name}</span>
                        <span className="font-bold">
                          {asset.price != null ? `$${asset.price.toFixed(2)}` : 'N/A'}
                        </span>
                      </div>
                    )}
                  </div>
                  }
                  
                  {orderType === 'buy' && searchTerm && !isSearching && searchResults.length === 0 &&
                  <div className="absolute z-10 w-full mt-1 bg-[var(--card-bg)] border rounded-lg shadow-lg">
                    <div className="p-3 text-center text-sm text-gray-400">No results found.</div>
                  </div>
                  }
                </div>
                
                {orderType === 'sell' &&
                <div className="space-y-1">
                  {!searchTerm && <p className="text-xs text-gray-400 px-2">Your top assets:</p>}
                  {(searchTerm ? filteredOwnedAssets : topOwnedAssets).map((asset) =>
                    <div key={asset.symbol}
                    onClick={() => {
                      // FIXED: Pass asset_type from holding when selling
                      setSelectedAsset({
                        symbol: asset.symbol,
                        name: asset.symbol,
                        price: asset.currentPrice || asset.average_cost_price || 0,
                        asset_type: asset.asset_type || 'crypto' // Add asset_type here
                      });
                      setSearchTerm('');
                      setQuantity('');
                      setCurrencyAmount('');
                    }}
                    className="p-3 hover:bg-[var(--secondary-bg)] cursor-pointer flex justify-between rounded-lg border"
                    style={{ borderColor: 'var(--border-color)' }}>
                      <div>
                        <span className="font-medium">{asset.symbol}</span>
                        <p className="text-xs text-gray-400">
                          Current Price: ${(asset.currentPrice || asset.average_cost_price || 0).toFixed(2)}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="font-bold">{(asset.quantity || 0).toFixed(4)}</span>
                        <p className="text-xs text-gray-400">
                          ${(asset.currentValue || asset.quantity * asset.average_cost_price || 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  )}
                  {(searchTerm ? filteredOwnedAssets : topOwnedAssets).length === 0 &&
                  <p className="text-center text-sm p-2 text-gray-400">
                    {searchTerm ? 'No matching assets found' : 'No assets to sell'}
                  </p>
                  }
                </div>
                }
              </div>
              }

              {orderType === 'sell' && ownedAsset &&
              <div className="flex items-center space-x-2 my-2 py-2">
                <Checkbox
                  id="sell-all"
                  checked={isSellAll}
                  onCheckedChange={setIsSellAll}
                />
                <label
                  htmlFor="sell-all"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Sell all ({ownedAsset.quantity.toFixed(4)} {ownedAsset.symbol})
                </label>
              </div>
              }

              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Input by:
                </span>
                <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                  <button
                    type="button"
                    className={`px-3 py-1 text-xs rounded transition-colors ${
                    inputMode === 'quantity' ?
                    'bg-green-600 text-white' :
                    'text-gray-600 dark:text-gray-400'}`
                    }
                    onClick={() => {setInputMode('quantity');setCurrencyAmount('');}}>
                    Quantity
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1 text-xs rounded transition-colors ${
                    inputMode === 'currency' ?
                    'bg-green-600 text-white' :
                    'text-gray-600 dark:text-gray-400'}`
                    }
                    onClick={() => {setInputMode('currency');setQuantity('');}}>
                    Currency
                  </button>
                </div>
              </div>

              {inputMode === 'quantity' ?
              <Input
                type="number"
                placeholder="Quantity"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                min="0"
                disabled={isSellAll && orderType === 'sell'}
                step="any"
              /> :
              <Input
                type="number"
                placeholder="USD Amount"
                value={currencyAmount}
                onChange={(e) => setCurrencyAmount(e.target.value)}
                min="0"
                disabled={isSellAll && orderType === 'sell'}
                step="any"
              />
              }

              {selectedAsset && (inputMode === 'quantity' ? quantity : currencyAmount) &&
              <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span style={{ color: 'var(--text-secondary)' }}>Quantity:</span>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      {calculatedQuantity.toFixed(6)} {selectedAsset.symbol}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span style={{ color: 'var(--text-secondary)' }}>Total Value:</span>
                    <span className="font-bold text-lg neon-text">
                      ${totalValue.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span style={{ color: 'var(--text-secondary)' }}>Available Cash:</span>
                    <span style={{ color: 'var(--text-primary)' }}>
                      ${availableCash.toFixed(2)}
                    </span>
                  </div>
                  {!isSimMode && orderType === 'buy' &&
                  <div className="flex justify-between items-center">
                    <span style={{ color: 'var(--text-secondary)' }}>Credits Cost:</span>
                    <span style={{ color: 'var(--text-primary)' }}>
                      1 credit ($0.01)
                    </span>
                  </div>
                  }
                </div>
              </div>
              }

              <div className="grid grid-cols-2 gap-3">
                <Button
                  className={`${canExecuteTrade ? 'neon-glow bg-green-600 hover:bg-green-700' : ''}`}
                  disabled={!canExecuteTrade || isExecuting}
                  onClick={prepareTrade}>
                  {isExecuting ? 'Executing...' : `Quick ${orderType === 'buy' ? 'Buy' : 'Sell'}`}
                </Button>

                {!isSimMode && (
                  <Button
                    variant="outline"
                    disabled={!canExecuteTrade || isExecuting}
                    onClick={handleAdvancedOrder}
                    className="border-blue-500 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                    <SettingsIcon className="w-4 h-4 mr-2" />
                    Advanced
                  </Button>
                )}
              </div>

              {orderType === 'buy' && roundToCents(totalValue) > roundToCents(availableCash) &&
              <p className="text-red-500 text-sm text-center">
                {isSimMode ?
                'Insufficient funds. Add money to your wallet first.' :
                'Insufficient real funds. Add money to your account.'
                }
              </p>
              }
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </>
  );
}