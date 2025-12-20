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
  const { settings } = useSettings();
  const { isConnected: wsConnected, usdBalance: wsUsdBalance } = useKrakenWebSocket();
  const { wallet } = useWallet();

  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProspect, setSelectedProspect] = useState(null);
  const [executing, setExecuting] = useState(false);
  const [marketIntelligence, setMarketIntelligence] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [krakenRestBalance, setKrakenRestBalance] = useState(0);
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

  // Fetch Kraken balance via REST API as fallback when WebSocket isn't providing data
  useEffect(() => {
    if (isSimMode) return;
    
    const fetchKrakenBalance = async () => {
      try {
        const response = await base44.functions.invoke('getKrakenBalance', {});
        const data = response?.data || response;
        if (data?.success && data?.connected) {
          setKrakenRestBalance(data.usd_balance || 0);
        }
      } catch (e) {
        console.error('[Prospects] Kraken balance fetch error:', e);
      }
    };
    
    // Fetch if WebSocket balance is not available
    if (!wsConnected || wsUsdBalance <= 0) {
      fetchKrakenBalance();
    }
  }, [isSimMode, wsConnected, wsUsdBalance]);

  // Calculate cash balance - prioritize WebSocket, then REST API, then wallet DB
  const cashAvailable = isSimMode 
    ? (wallet?.cash_balance || 0)
    : (wsConnected && wsUsdBalance > 0 ? wsUsdBalance : (krakenRestBalance > 0 ? krakenRestBalance : (wallet?.real_cash_balance || 0)));

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
    const interval = setInterval(() => fetchProspects(false), 30000);
    return () => clearInterval(interval);
  }, []);

  const handleExecuteOrder = async (prospect) => {
    setExecuting(true);
    try {
      // Execute the trade via krakenTrade function
      const response = await base44.functions.invoke('krakenTrade', {
        action: 'place_order',
        symbol: prospect.symbol,
        side: 'buy',
        quantity: parseFloat(prospect.quantity.toFixed(8)),
        orderType: 'market',
        timeInForce: 'ioc'
      });

      const data = response?.data || response;

      if (data?.success) {
        toast.success(`✅ Order Executed`, {
          description: `Bought ${prospect.quantity.toFixed(4)} ${prospect.symbol} @ $${prospect.current_price.toFixed(2)}`
        });

        setSelectedProspect(null);
        setTimeout(() => fetchProspects(), 2000);
      } else {
        throw new Error(data?.error || 'Order failed');
      }
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
      </div>);

  }

  return (
    <div className="p-4 space-y-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-2xl font-bold">Auto-Trader Prospects</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchProspects(true)} disabled={isRefreshing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Updating...' : 'Refresh'}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Available Cash</span>
            <div className="text-right">
              <p className="font-semibold text-lg">${cashAvailable.toFixed(2)}</p>
              <div className="flex items-center gap-2 justify-end">
                <Badge variant="outline" className={isSimMode ? "text-xs" : "text-xs bg-green-50 text-green-700 border-green-200"}>
                  {isSimMode ? "💎 Demo" : "🟢 LIVE"}
                </Badge>
                {!isSimMode && wsConnected &&
                <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200 flex items-center gap-1">
                    <Wifi className="w-3 h-3" />
                    Live
                  </Badge>
                }
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {prospects.length === 0 ?
      <Card className="border-red-300">
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
            <p className="text-gray-500 font-semibold">Unable to generate prospects</p>
            <p className="text-sm text-gray-400 mt-2">
              The AI analyzer couldn't find any tradeable assets with current market data.
            </p>
            <p className="text-xs text-gray-400 mt-2">
              This usually means market data APIs are temporarily unavailable. Try refreshing in a moment.
            </p>
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
                        {prospect.ai_reasoning && prospect.ai_reasoning !== "Awaiting AI analysis" 
                          ? prospect.ai_reasoning 
                          : `AI confidence ${prospect.confidence_score}% - analyzing entry opportunity...`}
                      </p>

                      {/* Enhanced Intelligence Display */}
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
                          SL: -{prospect.user_loss_margin || userMargins.loss_margin}%
                        </span>
                        <span className="text-green-500 flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" />
                          TP: +{prospect.user_gain_margin || userMargins.gain_margin}%
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Execute Order Manually?</DialogTitle>
            <DialogDescription>
              You're about to manually execute this trade ahead of the auto-trader.
            </DialogDescription>
          </DialogHeader>
          
          {selectedProspect &&
          <div className="space-y-3">
              <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Asset:</span>
                  <span className="font-semibold">{selectedProspect.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Quantity:</span>
                  <span className="font-semibold">{selectedProspect.quantity.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Price:</span>
                  <span className="font-semibold">${selectedProspect.current_price.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Total:</span>
                  <span className="font-semibold">${selectedProspect.total_value.toFixed(2)}</span>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
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
              disabled={executing}>

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
    </div>);

}