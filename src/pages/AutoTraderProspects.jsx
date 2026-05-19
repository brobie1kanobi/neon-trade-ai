import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, TrendingUp, AlertCircle, Send, RefreshCw, Lock, CheckCircle, Wifi, Activity, BarChart3, Target, Clock, Zap, TrendingDown, Brain } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter } from
"@/components/ui/dialog";
import { useKrakenWebSocket } from "@/components/providers/KrakenWebSocketProvider";
import { useSettings } from "@/components/utils/SettingsContext";
import { useWallet } from "@/components/hooks/useWallet";

export default function AutoTraderProspects() {
  const navigate = useNavigate();
  const { settings, updateSetting } = useSettings();
  const { isConnected: wsConnected, usdBalance: wsUsdBalance } = useKrakenWebSocket();
  const { wallet } = useWallet();

  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProspect, setSelectedProspect] = useState(null);
  const [executing, setExecuting] = useState(false);
  const [marketIntelligence, setMarketIntelligence] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [serverCash, setServerCash] = useState(null);
  const [assetsValue, setAssetsValue] = useState(0);
  const [totalPortfolioValue, setTotalPortfolioValue] = useState(0);
  const [totalAnalyzed, setTotalAnalyzed] = useState(0);
  const [backendMessage, setBackendMessage] = useState('');
  // Initialize margins from settings context, fall back to defaults
  const [userMargins, setUserMargins] = useState({
    gain_margin: settings?.gain_margin ?? 10,
    loss_margin: settings?.loss_margin ?? 5
  });

  // Update margins when settings load from context
  useEffect(() => {
    if (settings?.gain_margin !== undefined || settings?.loss_margin !== undefined) {
      console.log('[Prospects UI] Settings from context - gain:', settings.gain_margin, 'loss:', settings.loss_margin);
      setUserMargins({
        gain_margin: settings.gain_margin ?? 10,
        loss_margin: settings.loss_margin ?? 5
      });
    }
  }, [settings?.gain_margin, settings?.loss_margin]);

  // Determine mode from settings
  const isSimMode = settings?.sim_trading_mode !== false;

  // Balance display is authoritative from backend prospects (eliminates WS/REST flicker)
  // No separate REST balance polling here.

  // Display cash from backend prospects — serverCash is authoritative for both modes
  const cashAvailable = serverCash ?? (isSimMode ? (wallet?.cash_balance || 0) : 0);

  const fetchProspects = async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) {
        setIsRefreshing(true);
      } else if (prospects.length === 0) {
        setLoading(true);
      }

      const response = await base44.functions.invoke('getAutoTraderProspects', {});
      const data = response?.data || response;

      if (data?.success) {
        setProspects(data.prospects || []);
        setMarketIntelligence(data.market_intelligence || null);
        setServerCash(typeof data.cash_available === 'number' ? data.cash_available : 0);
        setAssetsValue(typeof data.assets_value === 'number' ? data.assets_value : 0);
        setTotalPortfolioValue(typeof data.total_portfolio_value === 'number' ? data.total_portfolio_value : 0);
        setTotalAnalyzed(data.total_analyzed || 0);
        setBackendMessage(data.message || '');
        // Update margins from backend response (authoritative source)
        if (data.user_settings) {
          console.log('[Prospects UI] Got margins from backend:', data.user_settings);
          setUserMargins(data.user_settings);
        }
      }
    } catch (error) {
      console.error('[Prospects] Error:', error);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchProspects();
    // Increase interval to 60 seconds to avoid rate limiting
    const interval = setInterval(() => fetchProspects(false), 60000);
    return () => clearInterval(interval);
  }, []);

  const handleExecuteOrder = async (prospect) => {
    setExecuting(true);
    try {
      const qty = parseFloat(prospect.quantity.toFixed(8));
      const price = prospect.current_price;
      const estimatedCost = qty * price;
      const tpPercent = Math.abs((prospect.user_gain_margin ?? userMargins.gain_margin ?? 10));
      const slPercent = Math.abs((prospect.user_loss_margin ?? userMargins.loss_margin ?? 5));
      const takeProfitPrice = parseFloat((price * (1 + tpPercent / 100)).toFixed(2));
      const stopLossPrice = parseFloat((price * (1 - slPercent / 100)).toFixed(2));
      
      console.log(`[Prospects] Executing BUY with bracket: ${prospect.symbol} qty=${qty} TP=$${takeProfitPrice} SL=$${stopLossPrice}`);
      
      // CRITICAL: Preflight balance check to prevent "Insufficient funds" errors
      try {
        const balRes = await base44.functions.invoke('getKrakenBalance', {});
        const bal = balRes?.data || balRes;
        const usdAvail = parseFloat((bal?.available_usd_balance ?? bal?.usd_balance) || 0);
        const buffer = Math.max(1.0, estimatedCost * 0.02); // 2% or $1 buffer for slippage
        
        console.log(`[Prospects] Balance check: Available $${usdAvail.toFixed(2)}, Need $${(estimatedCost + buffer).toFixed(2)}`);
        
        if (usdAvail < estimatedCost + buffer) {
          toast.error("Insufficient USD on Kraken", {
            description: `Available: $${usdAvail.toFixed(2)} • Need: $${(estimatedCost + buffer).toFixed(2)} (incl. buffer)`
          });
          setExecuting(false);
          return;
        }
      } catch (balErr) {
        console.warn('[Prospects] Balance preflight failed, proceeding cautiously:', balErr?.message);
      }
      
      // Prefetch a trade WS token
      let __wsToken = null;
      try {
        const __t = await base44.functions.invoke('krakenApi', { action: 'getWebSocketUrl', payload: { keyType: 'trade' } });
        __wsToken = (__t?.data || __t)?.token || null;
      } catch (_) {}

      // Step 1: Execute market BUY order
      const buyResponse = await base44.functions.invoke('krakenTrade', {
        action: 'place_order',
        symbol: prospect.symbol,
        side: 'buy',
        quantity: qty,
        orderType: 'market',
        timeInForce: 'ioc',
        wsToken: __wsToken
      });

      const buyData = buyResponse?.data || buyResponse;

      if (!buyData?.success) {
        throw new Error(buyData?.error || 'Buy order failed');
      }
      
      // Use ACTUAL executed quantity from Kraken response (may differ from proposed)
      const actualQty = buyData.executed_qty || buyData.quantity || qty;
      const actualPrice = buyData.avg_price || price;
      const actualTotal = actualQty * actualPrice;
      
      toast.success(`✅ BUY Executed`, {
        description: `Bought ${actualQty.toFixed(4)} ${prospect.symbol} @ $${actualPrice.toFixed(2)} ($${actualTotal.toFixed(2)})`
      });
      
      // CRITICAL: Record the Trade entity so it appears in Orders & History
      try {
        await base44.entities.Trade.create({
          symbol: prospect.symbol,
          type: 'buy',
          asset_type: prospect.asset_type || 'crypto',
          quantity: actualQty,
          price: actualPrice,
          total_value: actualTotal,
          fee: buyData.fee || 0,
          status: 'executed',
          is_auto_trade: true,
          is_simulation: false,
          kraken_order_id: buyData.order_id || null,
          submitted_at: new Date().toISOString(),
          filled_at: new Date().toISOString()
        });
      } catch (tradeErr) {
        console.error('[Prospects] Failed to record Trade entity:', tradeErr);
      }
      
      // Skipping Kraken bracket orders; create app-managed ConditionalOrder instead
      await new Promise(res => setTimeout(res, 500));
      try {
        await base44.entities.ConditionalOrder.create({
          symbol: prospect.symbol,
          asset_type: prospect.asset_type || 'crypto',
          quantity: actualQty,
          purchase_price: actualPrice,
          gain_margin: tpPercent,
          loss_margin: slPercent,
          status: 'active',
          trailing_enabled: settings?.trailing_takeprofit_enabled !== false,
          highest_price: price,
          trailing_margin: settings?.trailing_takeprofit_margin ?? 3,
          is_simulation: false,
          idempotency_key: `manual_${prospect.symbol}_${Date.now()}`,
          trade_id: null
        });
        toast.success(`✅ Protection Set`, {
          description: `Conditional TP @ +${tpPercent}% and SL @ -${slPercent}% will be managed by the app`
        });
      } catch (e) {
        console.error('ConditionalOrder create failed:', e);
        toast.warning('Protection not set', { description: 'Position opened; app-managed TP/SL creation failed' });
      }

      setSelectedProspect(null);
      // Notify other components (e.g., Orders & History) that a trade was completed
      window.dispatchEvent(new CustomEvent('trade:completed', { detail: { symbol: prospect.symbol } }));
      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { type: 'trade', source: 'prospects' } }));
      setTimeout(() => fetchProspects(), 3000);
      
    } catch (error) {
      console.error('Execute error:', error);
      toast.error("Order failed", { description: error.message });
    } finally {
      setExecuting(false);
    }
  };

  // Only show full loading spinner on initial load when no data exists
  if (loading && prospects.length === 0) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-2xl font-bold">Auto-Trader Prospects</h1>
        </div>
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {prospects.length === 0 ?
      <Card className="border-yellow-300">
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-yellow-400" />
            {(totalAnalyzed > 0 || !!backendMessage) ? (
              <>
                <p className="text-gray-500 font-semibold">No Actionable Signals</p>
                <p className="text-sm text-gray-400 mt-2">
                  {totalAnalyzed} asset{totalAnalyzed !== 1 ? 's' : ''} analyzed.
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  {backendMessage || "The AI is waiting for favorable market conditions. Signals refresh automatically."}
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => fetchProspects(true)}
                  disabled={isRefreshing}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                  Refresh Signals
                </Button>
              </>
            ) : (
              <>
                <p className="text-gray-500 font-semibold">No Assets Configured</p>
                <p className="text-sm text-gray-400 mt-2">
                  You need to set up your auto-trading preferences in the Portfolio page first.
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Go to Portfolio → Auto-Buy Preferences to add assets with your desired allocation percentages.
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => navigate('/Portfolio')}>
                  Go to Portfolio Settings
                </Button>
              </>
            )}
          </CardContent>
        </Card> :

      <div className="space-y-3">
          {prospects.map((prospect, idx) =>
        <Card key={idx} className={prospect.is_blocked ? "opacity-75 border-yellow-300" : "border-green-300"}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {prospect.symbol}
                      {prospect.has_existing_position &&
                  <Badge variant="outline" className="text-xs">
                          +{prospect.existing_quantity.toFixed(4)} held
                        </Badge>
                  }
                      {prospect.would_execute_now &&
                  <Badge className="bg-green-500 text-white text-xs">
                          READY
                        </Badge>
                  }
                    </CardTitle>
                    <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                      {prospect.asset_type === "crypto" ? "Cryptocurrency" : "Stock"}
                      {prospect.market_trend !== 0 &&
                  <span className={prospect.market_trend > 0 ? "text-green-600" : "text-red-600"}>
                          {prospect.market_trend > 0 ? "↗" : "↘"} {Math.abs(prospect.market_trend).toFixed(2)}%
                        </span>
                  }
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge className={
                prospect.confidence_score >= 70 ? "bg-green-500" :
                prospect.confidence_score >= 50 ? "bg-yellow-500" :
                "bg-gray-500"
                }>
                      {prospect.confidence_score}% AI Confidence
                    </Badge>
                    <p className="text-xs text-gray-500 mt-1">
                      {prospect.user_allocation_pct || prospect.allocation_percent}% allocation
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Current Price</p>
                    <p className="font-semibold">${prospect.current_price.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Order Size</p>
                    <p className="font-semibold">${prospect.total_value.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Quantity</p>
                    <p className="font-semibold">{prospect.quantity.toFixed(4)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Target Gain</p>
                    <p className="font-semibold text-green-600">+{prospect.user_gain_margin || userMargins.gain_margin}%</p>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 space-y-2">
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        AI Market Analysis
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {prospect.ai_reasoning && prospect.ai_reasoning !== "Awaiting AI analysis" ?
                prospect.ai_reasoning :
                `AI confidence ${prospect.confidence_score}% - analyzing entry opportunity...`}
                      </p>

                      <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                        {prospect.technical_pattern &&
                <Badge variant="outline" className="text-xs flex items-center gap-1">
                            <BarChart3 className="w-3 h-3" />
                            {prospect.technical_pattern}
                          </Badge>
                }
                        {prospect.timing_window &&
                <Badge variant="outline" className="text-xs flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {prospect.timing_window === 'immediate' ? '⚡ Now' : prospect.timing_window === 'short_term' ? '24-48h' : 'Wait'}
                          </Badge>
                }
                        {prospect.optimal_action && prospect.optimal_action !== 'buy' &&
                <Badge className={
                prospect.optimal_action === 'strong_buy' ? 'bg-green-600' :
                prospect.optimal_action === 'sell' ? 'bg-red-500' :
                prospect.optimal_action === 'strong_sell' ? 'bg-red-700' :
                'bg-gray-500'
                }>
                            {prospect.optimal_action.replace('_', ' ')}
                          </Badge>
                }
                      </div>

                      {prospect.entry_zone &&
              <div className="text-xs text-gray-500">
                          <Target className="w-3 h-3 inline mr-1" />
                          Entry Zone: ${prospect.entry_zone.low?.toFixed(2)} - ${prospect.entry_zone.high?.toFixed(2)}
                        </div>
              }

                      <div className="flex gap-4 text-xs">
                        <span className="text-red-500 flex items-center gap-1">
                          <TrendingDown className="w-3 h-3" />
                          SL: -{Math.abs(prospect.user_loss_margin ?? userMargins.loss_margin)}%
                        </span>
                        <span className="text-green-500 flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" />
                          TP: +{Math.abs(prospect.user_gain_margin ?? userMargins.gain_margin)}%
                        </span>
                      </div>
                    </div>

                {prospect.is_blocked ?
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700">
                    <Lock className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">
                        ⏸️ Reconnecting to Websocket...
                      </p>
                      <p className="text-xs text-yellow-600 dark:text-yellow-500">
                        {prospect.block_reason}
                      </p>
                    </div>
                  </div> :

            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              onClick={() => setSelectedProspect(prospect)}
              disabled={isSimMode}>

                    <Send className="w-4 h-4 mr-2" />
                    {isSimMode ? "💎 Demo Mode Only" : "🟢 Execute on Kraken Now"}
                  </Button>
            }
              </CardContent>
            </Card>
        )}
        </div>
      }

      <Dialog open={!!selectedProspect} onOpenChange={(open) => !open && setSelectedProspect(null)}>
        <DialogContent className="bg-slate-900 p-6 fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg">
          <DialogHeader>
            <DialogTitle>Execute Order Manually?</DialogTitle>
            <DialogDescription>
              You're about to manually execute this trade ahead of the auto-trader.
            </DialogDescription>
          </DialogHeader>
          
          {selectedProspect &&
          <div className="space-y-3">
              <div className="bg-slate-700 p-4 rounded-lg dark:bg-gray-900 space-y-2">
                <p className="text-xs text-gray-400 mb-1">Estimated — actual fill may differ at market price</p>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Asset:</span>
                  <span className="font-semibold">{selectedProspect.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Est. Quantity:</span>
                  <span className="font-semibold">~{selectedProspect.quantity.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Current Price:</span>
                  <span className="font-semibold">${selectedProspect.current_price.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Budget:</span>
                  <span className="font-semibold">${selectedProspect.total_value.toFixed(2)}</span>
                </div>
              </div>

              <div className="bg-slate-300 p-3 rounded-lg dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1">
                  ℹ️ Why hasn't this executed yet?
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-500">
                  The auto-trader runs every 90 seconds and prioritizes trades based on AI confidence scores. 
                  This order is queued but hasn't reached the execution threshold yet. Manual execution bypasses 
                  the queue and executes immediately.
                </p>
              </div>
            </div>
          }

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedProspect(null)}
              disabled={executing} className="bg-red-600 text-gray-300 px-4 py-2 text-sm font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border shadow-sm h-9 border-gray-700 hover:bg-gray-800 hover:text-white">
              Cancel
            </Button>
            <Button
              onClick={() => handleExecuteOrder(selectedProspect)}
              disabled={executing} className="bg-primary text-lime-400 px-4 py-2 text-sm font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow hover:bg-primary/90 h-9">
              {executing ?
              <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Executing...
                </> :
              <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Execute Now
                </>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );

}