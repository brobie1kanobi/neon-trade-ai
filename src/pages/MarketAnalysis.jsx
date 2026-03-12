import React, { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TrendingUp, TrendingDown, Activity, RefreshCw, Zap,
  AlertCircle, CheckCircle, Clock, ArrowRight, Brain,
  Flame, Target, Shield, BarChart3, Send } from
"lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useSettings } from "@/components/utils/SettingsContext";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { getRecentAnalysis, setRecentAnalysis } from "@/components/hooks/useGlobalDataStore";

function SignalCard({ signal, onSendToTrader, onManualTrade }) {
  const isStrongBuy = signal.optimal_action === 'strong_buy';
  const isStrongSell = signal.optimal_action === 'strong_sell';
  const isBuy = signal.optimal_action === 'buy';
  const isSell = signal.optimal_action === 'sell';

  const actionColors = {
    strong_buy: 'bg-green-500 text-white',
    buy: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    hold: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    sell: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    strong_sell: 'bg-red-500 text-white'
  };

  const confidenceColor = signal.confidence_score >= 70 ?
  'text-green-500' :
  signal.confidence_score >= 50 ?
  'text-yellow-500' :
  'text-red-500';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl border"
      style={{
        backgroundColor: 'var(--card-bg)',
        borderColor: isStrongBuy || isStrongSell ? 'var(--neon-green)' : 'var(--border-color)'
      }}>

      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {signal.symbol}
          </span>
          <Badge className={actionColors[signal.optimal_action] || actionColors.hold}>
            {signal.optimal_action?.replace('_', ' ').toUpperCase()}
          </Badge>
          {signal.short_term_signal &&
          <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400">
              <Zap className="w-3 h-3 mr-1" />
              Short-term
            </Badge>
          }
        </div>
        <div className="text-right">
          <p className={`text-xl font-bold ${confidenceColor}`}>
            {signal.confidence_score?.toFixed(0)}%
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>confidence</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
        <div>
          <p style={{ color: 'var(--text-secondary)' }}>Current Price</p>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            ${signal.current_price?.toFixed(4) || 'N/A'}
          </p>
        </div>
        <div>
          <p style={{ color: 'var(--text-secondary)' }}>24h Change</p>
          <p className={`font-semibold ${(signal.current_24h_change || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {(signal.current_24h_change || 0) >= 0 ? '+' : ''}{(signal.current_24h_change || 0).toFixed(2)}%
          </p>
        </div>
        <div>
          <p style={{ color: 'var(--text-secondary)' }}>Predicted Move</p>
          <p className={`font-semibold ${(signal.predicted_move_pct || signal.predicted_gain_percent || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {(signal.predicted_move_pct || signal.predicted_gain_percent || 0) >= 0 ? '+' : ''}{(signal.predicted_move_pct || signal.predicted_gain_percent || 0).toFixed(1)}%
          </p>
        </div>
        <div>
          <p style={{ color: 'var(--text-secondary)' }}>Timing</p>
          <p className="font-semibold flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
            <Clock className="w-3 h-3" />
            {signal.timing_window || 'short_term'}
          </p>
        </div>
      </div>

      {signal.entry_zone_low && signal.entry_zone_high &&
      <div className="p-2 rounded-lg mb-3" style={{ backgroundColor: 'var(--secondary-bg)' }}>
          <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Entry Zone</p>
          <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            ${signal.entry_zone_low?.toFixed(4)} - ${signal.entry_zone_high?.toFixed(4)}
          </p>
        </div>
      }

      <div className="flex items-center gap-2 mb-3 text-xs">
        {signal.stop_loss_pct &&
        <Badge variant="outline" className="text-red-500 border-red-500">
            <Shield className="w-3 h-3 mr-1" />
            SL: {signal.stop_loss_pct}%
          </Badge>
        }
        {signal.take_profit_pct &&
        <Badge variant="outline" className="text-green-500 border-green-500">
            <Target className="w-3 h-3 mr-1" />
            TP: {signal.take_profit_pct}%
          </Badge>
        }
        {signal.momentum_strength &&
        <Badge variant="outline">
            <Activity className="w-3 h-3 mr-1" />
            {signal.momentum_strength}
          </Badge>
        }
      </div>

      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        {signal.reasoning || signal.action_reason || 'AI analysis in progress...'}
      </p>

      <div className="flex gap-2">
        {(isStrongBuy || isBuy) && signal.confidence_score >= 70 &&
        <Button
          onClick={() => onSendToTrader(signal)}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
          size="sm">

            <Send className="w-4 h-4 mr-2" />
            Send to Auto-Trader
          </Button>
        }
        <Button
          onClick={() => onManualTrade(signal)}
          variant="outline"
          className="flex-1"
          size="sm">

          <ArrowRight className="w-4 h-4 mr-2" />
          Manual Trade
        </Button>
      </div>
    </motion.div>);

}

function MarketSentimentCard({ intelligence }) {
  if (!intelligence) return null;

  const sentimentScore = intelligence.market_sentiment_score || intelligence.sentiment_score || 50;
  const sentimentLabel = sentimentScore <= 30 ? 'Extreme Fear' :
  sentimentScore <= 50 ? 'Fear' :
  sentimentScore <= 70 ? 'Neutral' :
  sentimentScore <= 90 ? 'Greed' :
  'Extreme Greed';

  const sentimentColor = sentimentScore <= 30 ? 'text-red-500' :
  sentimentScore <= 50 ? 'text-orange-500' :
  sentimentScore <= 70 ? 'text-yellow-500' :
  'text-green-500';

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Brain className="w-5 h-5" style={{ color: 'var(--neon-green)' }} />
          Market Intelligence
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Market Sentiment</p>
            <p className={`text-2xl font-bold ${sentimentColor}`}>{Math.ceil(Number(sentimentScore))}</p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{sentimentLabel}</p>
          </div>
          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Market Regime</p>
            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              {intelligence.market_regime || 'Unknown'}
            </p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {intelligence.momentum_direction || intelligence.trend_strength || 'Analyzing...'}
            </p>
          </div>
        </div>

        {intelligence.short_term_outlook &&
        <div className="p-3 rounded-lg border" style={{ borderColor: 'var(--neon-green)', backgroundColor: 'rgba(57, 255, 20, 0.05)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--neon-green)' }}>Short-Term Outlook (1-6h)</p>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {intelligence.short_term_outlook}
            </p>
          </div>
        }

        {intelligence.trading_recommendation &&
        <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>AI Recommendation</p>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {intelligence.trading_recommendation}
            </p>
          </div>
        }

        {intelligence.hot_signals && intelligence.hot_signals.length > 0 &&
        <div>
            <p className="text-sm font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Flame className="w-4 h-4 text-orange-500" />
              Hot Signals
            </p>
            <div className="space-y-2">
              {intelligence.hot_signals.map((hs, idx) =>
            <div key={idx} className="flex items-center justify-between p-2 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{hs.symbol}</span>
                    <Badge className={hs.signal_type === 'strong_buy' ? 'bg-green-500 text-white' : hs.signal_type === 'strong_sell' ? 'bg-red-500 text-white' : ''}>
                      {hs.signal_type?.replace('_', ' ')}
                    </Badge>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${(hs.predicted_move_pct || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {(hs.predicted_move_pct || 0) >= 0 ? '+' : ''}{hs.predicted_move_pct?.toFixed(1)}%
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{hs.timing}</p>
                  </div>
                </div>
            )}
            </div>
          </div>
        }

        <div className="grid grid-cols-2 gap-2">
          {intelligence.best_opportunities && intelligence.best_opportunities.length > 0 &&
          <div>
              <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Best Opportunities</p>
              <div className="flex flex-wrap gap-1">
                {intelligence.best_opportunities.slice(0, 3).map((sym, idx) =>
              <Badge key={idx} className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    {sym}
                  </Badge>
              )}
              </div>
            </div>
          }
          {intelligence.avoid_list && intelligence.avoid_list.length > 0 &&
          <div>
              <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Avoid</p>
              <div className="flex flex-wrap gap-1">
                {intelligence.avoid_list.slice(0, 3).map((sym, idx) =>
              <Badge key={idx} className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    {sym}
                  </Badge>
              )}
              </div>
            </div>
          }
        </div>
      </CardContent>
    </Card>);

}

const LOADING_MESSAGES = [
"This will take a few seconds to load the analysis...",
"Analyzing current markets, trends and assets...",
"Accessing the moral fabric of the timespace continuum...",
"Questioning everything, leaving no stone unturned...",
"Searching the internet for funny cat pics, er.. I mean, buyable assets...",
"Consulting the crypto oracles...",
"Crunching the numbers and ignoring the noise...",
"Looking for the next moonshot...",
"Calculating optimal entry points...",
"Reading the tea leaves of the blockchain..."];


function LoadingState() {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-4 space-y-8 min-h-[70vh] flex flex-col items-center justify-center">
      <div className="flex flex-col items-center justify-center space-y-6 z-10 w-full max-w-md">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-4 border-gray-200 dark:border-gray-800" />
          <div className="absolute inset-0 rounded-full border-4 animate-spin" style={{ borderColor: 'var(--neon-green)', borderRightColor: 'transparent', borderTopColor: 'transparent' }} />
          <Brain className="absolute inset-0 m-auto w-6 h-6 animate-pulse" style={{ color: 'var(--neon-green)' }} />
        </div>
        
        <div className="h-16 flex items-center justify-center w-full">
          <AnimatePresence mode="wait">
            <motion.p
              key={messageIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.5 }}
              className="text-center font-medium px-4"
              style={{ color: 'var(--text-primary)' }}>

              {LOADING_MESSAGES[messageIndex]}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>

      <div className="w-full space-y-4 opacity-20 pointer-events-none mt-8">
        <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
        <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
      </div>
    </div>);

}

export default function MarketAnalysis() {
  const { settings, user } = useSettings();
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisData, setAnalysisData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // all, strong_signals, buy, sell
  const [selectedSignal, setSelectedSignal] = useState(null);
  const [tradeAmount, setTradeAmount] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  const isSimMode = settings?.sim_trading_mode !== false;

  // Quick fallback if backend analysis times out (Kraken public API)
  const quickFallbackAnalysis = useCallback(async (symbols) => {
    const MAP = { BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD', XRP: 'XXRPZUSD', ADA: 'ADAUSD', DOGE: 'XDGUSD', DOT: 'DOTUSD', LINK: 'LINKUSD', MATIC: 'MATICUSD', AVAX: 'AVAXUSD', UNI: 'UNIUSD', ATOM: 'ATOMUSD', LTC: 'XLTCZUSD', BCH: 'BCHUSD', XLM: 'XXLMZUSD', TRX: 'TRXUSD', SHIB: 'SHIBUSD', PEPE: 'PEPEUSD', HBAR: 'HBARUSD' };
    const syms = (symbols || []).map(s => String(s).toUpperCase()).filter(s => MAP[s]);
    if (syms.length === 0) return { success: true, recommendations: [], market_intelligence: null, analyzed_count: 0, timestamp: new Date().toISOString() };
    const pairs = syms.map(s => MAP[s]).join(',');
    try {
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairs}`, { signal: controller.signal });
      clearTimeout(to);
      const json = await res.json();
      const recs = syms.map(sym => {
        const t = json?.result?.[MAP[sym]];
        const price = parseFloat(t?.c?.[0] || '0');
        const open24h = parseFloat(t?.o || '0');
        const ch = open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;
        const action = ch >= 0 ? 'buy' : 'hold';
        const conf = ch >= 3 ? 65 : ch >= 0 ? 58 : 45;
        return { symbol: sym, confidence_score: conf, predicted_direction: ch >= 0 ? 'up' : 'down', predicted_move_pct: Math.abs(ch), reasoning: 'Heuristic fallback', action, optimal_action: action, timing_window: '4h', stop_loss_pct: 2, take_profit_pct: 3, current_price: price, current_24h_change: ch };
      });
      const avg = recs.reduce((a,r)=>a+(r.current_24h_change||0),0)/recs.length || 0;
      return { success: true, recommendations: recs, market_intelligence: { market_sentiment_score: Math.max(0, Math.min(100, 50 + avg)), market_regime: avg>1? 'risk-on': avg<-1? 'risk-off':'range', volatility_level: Math.abs(avg)>3?'high':Math.abs(avg)>1?'moderate':'low' }, analyzed_count: syms.length, timestamp: new Date().toISOString(), market_summary: 'Fallback analysis based on Kraken 24h change', upcoming_catalysts: [] };
    } catch (_e) {
      return { success: true, recommendations: [], market_intelligence: null, analyzed_count: syms.length, timestamp: new Date().toISOString(), market_summary: 'Fallback analysis unavailable', upcoming_catalysts: [] };
    }
  }, []);

  // Retry if user/settings not yet ready; debounce refresh clicks
  const retryRef = useRef(0);
  const refreshCooldownRef = useRef(0);

  const fetchAnalysis = useCallback(async (force = false) => {
    if (!user?.email) {
      // Wait for auth to resolve, retry a few times with backoff
      if (retryRef.current < 6) {
        const attempt = ++retryRef.current;
        setTimeout(() => fetchAnalysis(force), 400 * attempt);
      }
      return;
    }

    // CROSS-PAGE CHECK: If QuickActions (or earlier visit) already loaded analysis, reuse it
    if (!force) {
      const recent = getRecentAnalysis();
      if (recent) {
        console.log('[MarketAnalysis] Using cross-page cached analysis');
        setAnalysisData(recent);
        setLoading(false);
        setAnalyzing(false);
        return;
      }
    }

    setAnalyzing(true);
    setError(null);

    try {
      // Get user's watchlist symbols
      const watchedCrypto = settings?.watched_crypto || ['BTC', 'ETH', 'SOL', 'XRP', 'ADA'];
      const watchedStocks = settings?.watched_stocks || [];

      // Also include auto-buy preferences
      const autoBuyPrefs = await base44.entities.AutoBuyPreference.filter({
        created_by: user.email,
        enabled: true,
        is_simulation: isSimMode
      }).catch(() => []);

      const autoBuySymbols = autoBuyPrefs.map((p) => p.symbol);
      const allSymbols = [...new Set([...watchedCrypto, ...watchedStocks, ...autoBuySymbols])];

      console.log('[MarketAnalysis] Analyzing symbols:', allSymbols);

      const response = await base44.functions.invoke('analyzeSmallGains', {
        symbols: allSymbols,
        includeMarketIntelligence: true,
        includeTradeHistory: true
      });

      const data = response?.data || response;
      console.log('[MarketAnalysis] Analysis response:', data);

      if (data?.success) {
        setAnalysisData(data);
        setRecentAnalysis(data); // Store for cross-page reuse
      } else {
        throw new Error(data?.error || 'Analysis failed');
      }
    } catch (err) {
      console.error('[MarketAnalysis] Error:', err);
      // Fallback: quick on-client heuristics so page never stays empty
      try {
        const watchedCrypto = settings?.watched_crypto || ['BTC','ETH','SOL','XRP','ADA'];
        const watchedStocks = settings?.watched_stocks || [];
        const autoBuyPrefs = await base44.entities.AutoBuyPreference.filter({ created_by: user?.email, enabled: true, is_simulation: isSimMode }).catch(() => []);
        const allSymbols = [...new Set([...(watchedCrypto||[]), ...(watchedStocks||[]), ...autoBuyPrefs.map(p=>p.symbol)])];
        const fallback = await quickFallbackAnalysis(allSymbols);
        setAnalysisData(fallback);
        setRecentAnalysis(fallback);
        setError(null);
      } catch (_e) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
      setAnalyzing(false);
    }
  }, [user?.email, settings?.watched_crypto, settings?.watched_stocks, isSimMode]);

  const handleRefresh = useCallback(() => {
    const now = Date.now();
    if (now - refreshCooldownRef.current < 3000 || analyzing) return; // 3s cooldown
    refreshCooldownRef.current = now;
    fetchAnalysis(true);
  }, [fetchAnalysis, analyzing]);

  useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  const handleSendToTrader = async (signal) => {
    try {
      // Add to auto-buy preferences if not already there
      const existingPrefs = await base44.entities.AutoBuyPreference.filter({
        created_by: user.email,
        symbol: signal.symbol,
        is_simulation: isSimMode
      });

      if (existingPrefs.length === 0) {
        await base44.entities.AutoBuyPreference.create({
          symbol: signal.symbol,
          asset_type: 'crypto',
          percentage: 15,
          enabled: true,
          is_simulation: isSimMode,
          created_by: user.email
        });
      }

      toast.success(`${signal.symbol} sent to Auto-Trader`, {
        description: `Will auto-trade when conditions are optimal`
      });
    } catch (err) {
      toast.error('Failed to send to auto-trader', { description: err.message });
    }
  };

  const handleManualTrade = (signal) => {
    setSelectedSignal(signal);
    setTradeAmount("");
  };

  const executeTrade = async () => {
    if (!tradeAmount || isNaN(tradeAmount) || Number(tradeAmount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setIsExecuting(true);
    try {
      const amount = Number(tradeAmount);
      const price = selectedSignal.current_price;
      const qty = amount / price;
      const side = selectedSignal.optimal_action?.includes('buy') ? 'buy' : 'sell';

      if (isSimMode) {
        const walletRes = await base44.entities.Wallet.filter({ created_by: user.email });
        let wallet = walletRes[0];

        if (side === 'buy') {
          if (!wallet || wallet.cash_balance < amount) {
            toast.error("Insufficient demo funds");
            setIsExecuting(false);
            return;
          }
          await base44.entities.Wallet.update(wallet.id, { cash_balance: wallet.cash_balance - amount });
        } else {
          const holdingsRes = await base44.entities.Holding.filter({ created_by: user.email, symbol: selectedSignal.symbol, is_simulation: true });
          const holding = holdingsRes[0];
          if (!holding || holding.quantity < qty) {
            toast.error("Insufficient demo holdings");
            setIsExecuting(false);
            return;
          }
          await base44.entities.Wallet.update(wallet.id, { cash_balance: wallet.cash_balance + amount });
          if (holding.quantity - qty <= 0.00001) {
            await base44.entities.Holding.delete(holding.id);
          } else {
            await base44.entities.Holding.update(holding.id, { quantity: holding.quantity - qty });
          }
        }

        if (side === 'buy') {
          const holdingsRes = await base44.entities.Holding.filter({ created_by: user.email, symbol: selectedSignal.symbol, is_simulation: true });
          const holding = holdingsRes[0];
          if (holding) {
            const newQty = holding.quantity + qty;
            const newAvg = (holding.quantity * holding.average_cost_price + amount) / newQty;
            await base44.entities.Holding.update(holding.id, { quantity: newQty, average_cost_price: newAvg });
          } else {
            await base44.entities.Holding.create({
              symbol: selectedSignal.symbol,
              asset_type: 'crypto',
              quantity: qty,
              average_cost_price: price,
              is_simulation: true,
              created_by: user.email
            });
          }
        }

        await base44.entities.Trade.create({
          symbol: selectedSignal.symbol,
          type: side,
          asset_type: 'crypto',
          quantity: qty,
          price: price,
          total_value: amount,
          status: 'executed',
          is_auto_trade: false,
          is_simulation: true,
          created_by: user.email
        });

        toast.success(`✅ SIM ${side.toUpperCase()} Executed`, {
          description: `${side === 'buy' ? 'Bought' : 'Sold'} ${qty.toFixed(4)} ${selectedSignal.symbol}`
        });
      } else {
        // LIVE trade
        if (side === 'buy') {
          const balRes = await base44.functions.invoke('getKrakenBalance', {});
          const bal = balRes?.data || balRes;
          const usdAvail = parseFloat((bal?.available_usd_balance ?? bal?.usd_balance) || 0);
          if (usdAvail < amount) {
            toast.error("Insufficient USD on Kraken", {
              description: `Available: $${usdAvail.toFixed(2)} • Need: $${amount.toFixed(2)}`
            });
            setIsExecuting(false);
            return;
          }
        }

        let __wsToken = null;
        try {
          const __t = await base44.functions.invoke('krakenApi', { action: 'getWebSocketUrl', payload: { keyType: 'trade' } });
          __wsToken = (__t?.data || __t)?.token || null;
        } catch (_) {}

        const response = await base44.functions.invoke('krakenTrade', {
          action: 'place_order',
          symbol: selectedSignal.symbol,
          side: side,
          quantity: qty,
          orderType: 'market',
          wsToken: __wsToken
        });

        const data = response?.data || response;
        if (!data?.success) {
          throw new Error(data?.error || 'Order failed');
        }

        toast.success(`✅ LIVE ${side.toUpperCase()} Executed`, {
          description: `${side === 'buy' ? 'Bought' : 'Sold'} ${qty.toFixed(4)} ${selectedSignal.symbol}`
        });
      }

      setSelectedSignal(null);
    } catch (error) {
      console.error('Execute error:', error);
      toast.error("Order failed", { description: error.message });
    } finally {
      setIsExecuting(false);
    }
  };

  const filteredRecommendations = (analysisData?.recommendations || []).filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'strong_signals') return r.optimal_action === 'strong_buy' || r.optimal_action === 'strong_sell';
    if (filter === 'buy') return r.optimal_action === 'buy' || r.optimal_action === 'strong_buy';
    if (filter === 'sell') return r.optimal_action === 'sell' || r.optimal_action === 'strong_sell';
    return true;
  });

  const strongSignals = (analysisData?.recommendations || []).filter(
    (r) => (r.optimal_action === 'strong_buy' || r.optimal_action === 'strong_sell') && r.confidence_score >= 70
  );

  if (loading && !analysisData) {
    return <LoadingState />;
  }

  return (
    <div className="p-4 space-y-4 pb-24" style={{ backgroundColor: 'var(--primary-bg)' }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between">

        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <BarChart3 className="w-6 h-6" style={{ color: 'var(--neon-green)' }} />
            AI Market Analysis
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Short-term predictions (1-6 hours) with high-probability signals
          </p>
        </div>
        <Button
          onClick={handleRefresh}
          disabled={analyzing}
          variant="outline"
          size="sm">

          <RefreshCw className={`w-4 h-4 mr-2 ${analyzing ? 'animate-spin' : ''}`} />
          {analyzing ? 'Analyzing...' : 'Refresh'}
        </Button>
      </motion.div>

      {error &&
      <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </p>
        </div>
      }

      {/* Strong Signals Alert */}
      {strongSignals.length > 0 &&
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="p-4 rounded-xl border-2"
        style={{
          borderColor: 'var(--neon-green)',
          backgroundColor: 'rgba(57, 255, 20, 0.05)'
        }}>

          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-5 h-5" style={{ color: 'var(--neon-green)' }} />
            <span className="font-bold" style={{ color: 'var(--neon-green)' }}>
              {strongSignals.length} Strong Signal{strongSignals.length > 1 ? 's' : ''} Detected!
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {strongSignals.map((s, idx) =>
          <Badge key={idx} className={s.optimal_action === 'strong_buy' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}>
                {s.symbol}: {s.optimal_action?.replace('_', ' ')} ({s.confidence_score?.toFixed(0)}%)
              </Badge>
          )}
          </div>
        </motion.div>
      }

      {/* Market Intelligence */}
      <MarketSentimentCard intelligence={analysisData?.market_intelligence} />

      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {[
        { value: 'all', label: 'All Signals' },
        { value: 'strong_signals', label: 'Strong Only', icon: Zap },
        { value: 'buy', label: 'Buy Signals', icon: TrendingUp },
        { value: 'sell', label: 'Sell Signals', icon: TrendingDown }].
        map((f) =>
        <Button
          key={f.value}
          onClick={() => setFilter(f.value)}
          variant={filter === f.value ? 'default' : 'outline'}
          size="sm"
          className={filter === f.value ? 'bg-green-600 hover:bg-green-700' : ''}>

            {f.icon && <f.icon className="w-4 h-4 mr-1" />}
            {f.label}
          </Button>
        )}
      </div>

      {/* Recommendations */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          {filter === 'all' ? 'All Analysis' : filter === 'strong_signals' ? 'Strong Signals Only' : filter === 'buy' ? 'Buy Opportunities' : 'Sell Signals'}
          <span className="text-sm font-normal ml-2" style={{ color: 'var(--text-secondary)' }}>
            ({filteredRecommendations.length} results)
          </span>
        </h2>

        <AnimatePresence>
          {filteredRecommendations.length === 0 ?
          <div className="text-center py-8">
              <AlertCircle className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--text-secondary)' }} />
              <p style={{ color: 'var(--text-secondary)' }}>
                No signals match this filter. Try expanding your watchlist or changing the filter.
              </p>
            </div> :

          <div className="grid gap-4 md:grid-cols-2">
              {filteredRecommendations.map((signal, idx) =>
            <SignalCard
              key={`${signal.symbol}-${idx}`}
              signal={signal}
              onSendToTrader={handleSendToTrader}
              onManualTrade={handleManualTrade} />

            )}
            </div>
          }
        </AnimatePresence>
      </div>

      {/* Market Summary */}
      {analysisData?.market_summary &&
      <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Market Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p style={{ color: 'var(--text-primary)' }}>{analysisData.market_summary}</p>
            
            {analysisData.upcoming_catalysts && analysisData.upcoming_catalysts.length > 0 &&
          <div className="mt-4">
                <p className="text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Upcoming Catalysts
                </p>
                <ul className="list-disc list-inside text-sm" style={{ color: 'var(--text-primary)' }}>
                  {analysisData.upcoming_catalysts.map((c, idx) =>
              <li key={idx}>{c}</li>
              )}
                </ul>
              </div>
          }
          </CardContent>
        </Card>
      }

      {/* Last Updated */}
      <p className="text-xs text-center" style={{ color: 'var(--text-secondary)' }}>
        Last analyzed: {analysisData?.timestamp ? new Date(analysisData.timestamp).toLocaleString() : 'N/A'}
        {' • '}{analysisData?.analyzed_count || 0} assets analyzed
      </p>

      {/* Quick Links */}
      <div className="flex gap-2 justify-center">
        <Link to={createPageUrl('AutoTraderProspects')}>
          <Button variant="outline" size="sm">
            <Activity className="w-4 h-4 mr-2" />
            Auto-Trader Prospects
          </Button>
        </Link>
        <Link to={createPageUrl('Portfolio')}>
          <Button variant="outline" size="sm">
            <TrendingUp className="w-4 h-4 mr-2" />
            Portfolio
          </Button>
        </Link>
      </div>

      <Dialog open={!!selectedSignal} onOpenChange={(open) => !open && setSelectedSignal(null)}>
        <DialogContent className="bg-slate-900 p-6 sm:rounded-lg">
          <DialogHeader>
            <DialogTitle>Execute Manual Trade</DialogTitle>
            <DialogDescription>
              Execute a market order for {selectedSignal?.symbol}.
            </DialogDescription>
          </DialogHeader>
          
          {selectedSignal &&
          <div className="space-y-4">
              <div className="bg-slate-800 p-4 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Asset:</span>
                  <span className="font-semibold">{selectedSignal.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Action:</span>
                  <Badge className={selectedSignal.optimal_action?.includes('buy') ? 'bg-green-500' : 'bg-red-500'}>
                    {selectedSignal.optimal_action?.replace('_', ' ').toUpperCase()}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Current Price:</span>
                  <span className="font-semibold">${selectedSignal.current_price?.toFixed(4)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Amount (USD)</Label>
                <Input
                type="number"
                placeholder="Enter USD amount"
                value={tradeAmount}
                onChange={(e) => setTradeAmount(e.target.value)}
                className="bg-slate-950"
                min="0"
                step="any" />

                {tradeAmount && selectedSignal.current_price &&
              <p className="text-xs text-gray-400">
                    ≈ {(Number(tradeAmount) / selectedSignal.current_price).toFixed(6)} {selectedSignal.symbol}
                  </p>
              }
              </div>
            </div>
          }

          <DialogFooter className="bg-transparent flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
            <Button variant="outline" onClick={() => setSelectedSignal(null)} disabled={isExecuting} className="bg-red-600 px-4 py-2 text-sm font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground h-9">
              Cancel
            </Button>
            <Button onClick={executeTrade} disabled={isExecuting || !tradeAmount} className="bg-lime-500 text-primary-foreground px-4 py-2 text-sm font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-9 hover:bg-green-700">
              {isExecuting ?
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Executing...</> :

              <><Zap className="w-4 h-4 mr-2" /> Execute Order</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>);

}