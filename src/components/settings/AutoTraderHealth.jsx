import React, { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertCircle, CheckCircle, TrendingUp, AlertTriangle, Power, RefreshCw, Wifi, HelpCircle, ArrowRight, Link as LinkIcon, XCircle } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { notify } from "@/components/utils/notifications";
import { useSettings } from "@/components/utils/SettingsContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";
import { KrakenConnection, AutoBuyPreference, ConditionalOrder, Trade } from "@/entities/all";
import { useKrakenWebSocket } from "@/components/providers/KrakenWebSocketProvider";

export default function AutoTraderHealth() {
  const { settings, user } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [operationalIssues, setOperationalIssues] = useState([]);
  const [prerequisites, setPrerequisites] = useState({
    krakenConnected: true,
    autoTradingEnabled: false,
    hasAutoBuyPrefs: true,
    hasBalance: true
  });
  const [prerequisitesLoaded, setPrerequisitesLoaded] = useState(false);
  const [activeOrderCount, setActiveOrderCount] = useState(0);
  const [trades24h, setTrades24h] = useState({ total: 0, buys: 0, sells: 0, volume: 0 });
  const [lastCheckTime, setLastCheckTime] = useState(null);

  // PRIMARY DATA SOURCE: KrakenWebSocketProvider — it already merges WS + REST
  const wsProvider = useKrakenWebSocket();
  const {
    isConnected: wsConnected,
    usdBalance: wsUsdBalance,
    cryptoHoldingsValue: wsCryptoValue,
    totalPortfolioValue: wsTotalValue,
    krakenBalance: restSnapshot,
    krakenOrders: restOrders,
    hasData: providerHasData,
    orders: wsOrders,
    refresh: refreshProvider
  } = wsProvider;

  // Derive effective balance from the provider (already best-available logic)
  const effectiveBalance = wsTotalValue || 0;
  const effectiveCash = wsUsdBalance || 0;
  const effectiveAssets = wsCryptoValue || 0;

  // Kraken is connected if the provider says so OR we have any data at all
  const isKrakenConnected = wsConnected || providerHasData || effectiveBalance > 0 || 
    (restSnapshot?.success === true);

  // Count open orders from provider (REST snapshot or WS)
  useEffect(() => {
    let count = 0;
    if (!isSimMode) {
      // From REST snapshot (authoritative)
      if (restOrders && restOrders.length > 0) {
        count = restOrders.length;
      }
      // From WS orders as fallback
      else if (wsConnected && wsOrders && typeof wsOrders === 'object') {
        count = Object.values(wsOrders).filter(o => {
          const volume = parseFloat(o.vol) || o.volume || 0;
          return volume > 0.00001;
        }).length;
      }
    }
    setActiveOrderCount(count);
  }, [restOrders, wsOrders, wsConnected, isSimMode]);

  // Fetch 24h auto-trade stats from DB
  const fetchTradeStats = useCallback(async () => {
    if (!user?.email) return;
    try {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [recentTrades, recentExecutedOrders] = await Promise.all([
        Trade.filter({
          created_by: user.email,
          is_simulation: isSimMode,
          is_auto_trade: true
        }, "-created_date", 200),
        ConditionalOrder.filter({
          created_by: user.email,
          status: 'executed',
          is_simulation: isSimMode
        }, "-updated_date", 200)
      ]);

      const last24hTrades = recentTrades.filter(t => new Date(t.created_date) >= yesterday);
      const buyTrades = last24hTrades.filter(t => t.type === 'buy');
      const sellTrades = last24hTrades.filter(t => t.type === 'sell');

      const last24hExecutedOrders = recentExecutedOrders.filter(o => new Date(o.updated_date || o.created_date) >= yesterday);
      const executedWithoutTrade = last24hExecutedOrders.filter(o => {
        const oTime = new Date(o.updated_date || o.created_date).getTime();
        return !sellTrades.some(t => (
          t.symbol === o.symbol &&
          Math.abs((t.quantity || 0) - (o.quantity || 0)) < 0.0001 &&
          Math.abs(new Date(t.created_date).getTime() - oTime) < 5 * 60 * 1000
        ));
      });

      const buyVolume = buyTrades.reduce((sum, t) => sum + (t.total_value || 0), 0);
      const sellVolume = sellTrades.reduce((sum, t) => sum + (t.total_value || 0), 0);
      const execVolume = executedWithoutTrade.reduce((sum, o) => {
        const price = o.execution_price || o.purchase_price || 0;
        return sum + (o.quantity || 0) * price;
      }, 0);

      setTrades24h({
        total: buyTrades.length + sellTrades.length + executedWithoutTrade.length,
        buys: buyTrades.length,
        sells: sellTrades.length + executedWithoutTrade.length,
        volume: buyVolume + sellVolume + execVolume
      });
    } catch (err) {
      console.error('[AutoTraderHealth] Trade stats error:', err);
    }
  }, [user?.email, isSimMode]);

  // Check prerequisites (Kraken credentials, auto-buy prefs) — only on mount
  const checkPrerequisites = useCallback(async () => {
    if (!user?.email) return;
    try {
      const results = await Promise.allSettled([
        KrakenConnection.filter({ created_by: user.email }),
        AutoBuyPreference.filter({ created_by: user.email, enabled: true, is_simulation: false })
      ]);

      const krakenConns = results[0].status === 'fulfilled' ? results[0].value : null;
      const autoBuyPrefs = results[1].status === 'fulfilled' ? results[1].value : null;
      const krakenFetchFailed = results[0].status === 'rejected';
      const autoBuyFetchFailed = results[1].status === 'rejected';

      // Kraken connected if: provider says so, OR credentials exist in DB, OR fetch was rate-limited (keep optimistic)
      const hasCredentials = krakenConns && krakenConns.length > 0 && 
        (krakenConns[0]?.api_key || krakenConns[0]?.trade_api_key || krakenConns[0]?.balance_api_key);
      const krakenOk = isKrakenConnected || hasCredentials || (krakenFetchFailed && prerequisites.krakenConnected);

      const hasPrefs = autoBuyPrefs ? autoBuyPrefs.length > 0 : (autoBuyFetchFailed ? prerequisites.hasAutoBuyPrefs : false);
      const hasBalance = effectiveBalance > 1;

      const prereqs = {
        krakenConnected: krakenOk,
        autoTradingEnabled: settings?.auto_trading_enabled === true,
        hasAutoBuyPrefs: hasPrefs,
        hasBalance
      };

      // Build issues list — be very conservative about showing "issues"
      const issues = [];
      // Only show "not connected" if we truly have zero evidence of connection
      if (!krakenOk && !isKrakenConnected && !hasCredentials && !krakenFetchFailed) {
        issues.push({ type: 'connection', message: 'Kraken not connected' });
      }
      if (!hasPrefs && !autoBuyFetchFailed) {
        issues.push({ type: 'config', message: 'No auto-buy assets configured' });
      }
      // Only show balance issue if we're confidently connected AND balance is truly low
      if (krakenOk && effectiveBalance < 1 && providerHasData && !krakenFetchFailed) {
        issues.push({ type: 'balance', message: 'Insufficient balance to trade' });
      }
      if (settings?.bad_days_active && !settings?.bad_days_override_enabled) {
        issues.push({ type: 'bad_days', message: `Trading paused: ${settings?.bad_days_reason || 'Risk limit hit'}` });
      }

      setOperationalIssues(issues);
      setPrerequisites(prereqs);
      setPrerequisitesLoaded(true);
      console.log('[AutoTraderHealth] Prerequisites:', prereqs, '| Issues:', issues.length, '| Balance:', effectiveBalance);
    } catch (err) {
      console.error('[AutoTraderHealth] Prerequisites error:', err);
    }
  }, [user?.email, isKrakenConnected, effectiveBalance, providerHasData, settings?.auto_trading_enabled, settings?.bad_days_active, prerequisites.krakenConnected, prerequisites.hasAutoBuyPrefs]);

  // Initial load — delay to let provider settle
  const initRef = useRef(false);
  useEffect(() => {
    if (!user?.email || initRef.current) return;
    initRef.current = true;

    const timer = setTimeout(() => {
      checkPrerequisites();
      fetchTradeStats();
      setLastCheckTime(new Date());
      setLoading(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, [user?.email]);

  // Re-check prerequisites when auto_trading toggle changes
  useEffect(() => {
    if (initRef.current && user?.email) {
      checkPrerequisites();
    }
  }, [settings?.auto_trading_enabled]);

  // Periodic refresh of trade stats (5 min)
  useEffect(() => {
    if (!user?.email) return;
    const interval = setInterval(() => {
      fetchTradeStats();
      setLastCheckTime(new Date());
    }, 300000);
    return () => clearInterval(interval);
  }, [user?.email, fetchTradeStats]);

  // Update balance-dependent state when provider data changes
  useEffect(() => {
    if (providerHasData && prerequisitesLoaded) {
      setPrerequisites(prev => ({
        ...prev,
        hasBalance: effectiveBalance > 1,
        krakenConnected: true // If provider has data, kraken IS connected
      }));

      // Re-evaluate issues with fresh data
      setOperationalIssues(prev => {
        const filtered = prev.filter(i => i.type !== 'connection' && i.type !== 'balance');
        if (effectiveBalance < 1) {
          filtered.push({ type: 'balance', message: 'Insufficient balance to trade' });
        }
        return filtered;
      });
    }
  }, [effectiveBalance, providerHasData, prerequisitesLoaded]);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await refreshProvider?.();
      await fetchTradeStats();
      await checkPrerequisites();
      setLastCheckTime(new Date());
    } catch (err) {
      console.error('[AutoTraderHealth] Refresh error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEmergencyStop = async () => {
    if (!confirm('⚠️ Disable auto-trading and cancel all orders?')) return;
    setStopping(true);
    try {
      const response = await Promise.race([
        base44.functions.invoke('autoTraderMonitor', { action: 'emergency_stop' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]);
      const data = response?.data || response;
      if (data?.success) {
        notify.success('🚨 Auto-Trader Stopped', {
          description: `Cancelled ${data.cancelled_orders} orders`,
          duration: 5000
        });
        setTimeout(() => handleRefresh(), 1000);
      } else {
        throw new Error(data?.error || 'Failed');
      }
    } catch (stopError) {
      console.error('[AutoTraderHealth] Stop error:', stopError);
      notify.error('Failed to stop', { description: stopError.message });
    } finally {
      setStopping(false);
    }
  };

  if (loading && !prerequisitesLoaded) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 animate-pulse" />
            Auto-Trader Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
            <p className="text-sm text-gray-500">Loading status...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const canOperate = prerequisites.krakenConnected &&
    prerequisites.autoTradingEnabled &&
    prerequisites.hasAutoBuyPrefs &&
    effectiveBalance > 1;

  const borderColor = !canOperate && prerequisites.autoTradingEnabled ? '#f59e0b' :
    effectiveBalance <= 0 && providerHasData ? '#ef4444' :
    effectiveBalance <= 10 && providerHasData ? '#f59e0b' : '#10b981';

  return (
    <Card className="border-2" style={{ borderColor }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            {canOperate ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : prerequisites.autoTradingEnabled ? (
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
            ) : (
              <Activity className="w-5 h-5 text-gray-400" />
            )}
            Auto-Trader Status
            {isKrakenConnected && (
              <Badge variant="outline" className="text-xs flex items-center gap-1 bg-green-50 text-green-700 border-green-200">
                <Wifi className="w-3 h-3" />
                Live
              </Badge>
            )}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status row */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Status</span>
          <div className="flex items-center gap-2">
            {prerequisites.autoTradingEnabled ? (
              operationalIssues.length > 0 ? (
                <Badge className="bg-yellow-500 text-white flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Enabled (Issues)
                </Badge>
              ) : (
                <Badge className="bg-green-500 text-white">
                  🟢 Enabled
                </Badge>
              )
            ) : (
              <Badge className="bg-gray-500 text-white">
                ⏸️ Disabled
              </Badge>
            )}
            {(!prerequisites.autoTradingEnabled || operationalIssues.length > 0) && (
              <Popover open={showHelp} onOpenChange={setShowHelp}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="w-6 h-6 p-0">
                    <HelpCircle className="w-4 h-4 text-gray-400 hover:text-green-500 transition-colors" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-80 max-h-96 overflow-y-auto"
                  style={{
                    backgroundColor: 'var(--card-bg)',
                    borderColor: 'var(--neon-green)',
                    borderWidth: '2px'
                  }}
                >
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
                      {canOperate ? (
                        <CheckCircle className="w-5 h-5 text-green-500" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-yellow-500" />
                      )}
                      <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {canOperate ? 'Auto-Trader Active' :
                         prerequisites.krakenConnected && prerequisites.hasAutoBuyPrefs ? 'Ready to Enable' : 'Setup Required'}
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {/* Kraken Connection */}
                      <PrereqItem done={prerequisites.krakenConnected} step="1" label="Kraken Account"
                        extra={isKrakenConnected && <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">Live</Badge>}
                        failContent={
                          <Link to={createPageUrl("Wallet")} onClick={() => setShowHelp(false)}>
                            <Button size="sm" variant="outline" className="text-xs gap-1">
                              <LinkIcon className="w-3 h-3" /> Go to Wallet
                            </Button>
                          </Link>
                        }
                      />
                      {/* Auto-Trading Toggle */}
                      <PrereqItem done={prerequisites.autoTradingEnabled} step="2" label="Auto-Trading Enabled"
                        failContent={
                          <Link to={createPageUrl("Settings")} onClick={() => setShowHelp(false)}>
                            <Button size="sm" variant="outline" className="text-xs gap-1">
                              <ArrowRight className="w-3 h-3" /> Go to Settings
                            </Button>
                          </Link>
                        }
                      />
                      {/* Auto-Buy Prefs */}
                      <PrereqItem done={prerequisites.hasAutoBuyPrefs} step="3" label="Auto-Buy Assets Configured"
                        failContent={
                          <Link to={createPageUrl("Portfolio")} onClick={() => setShowHelp(false)}>
                            <Button size="sm" variant="outline" className="text-xs gap-1">
                              <ArrowRight className="w-3 h-3" /> Configure Portfolio
                            </Button>
                          </Link>
                        }
                      />

                      {canOperate && (
                        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                          <p className="text-sm font-medium text-green-700 dark:text-green-400">✅ Auto-Trader Active!</p>
                          <p className="text-xs text-green-600 dark:text-green-500">Monitoring the market and executing trades automatically.</p>
                        </div>
                      )}
                      {prerequisites.krakenConnected && prerequisites.hasAutoBuyPrefs && !prerequisites.autoTradingEnabled && (
                        <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                          <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">⏸️ Almost Ready!</p>
                          <p className="text-xs text-yellow-600 dark:text-yellow-500">Toggle "Enable Auto-Trading" in Settings to start.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>

        {/* Balance */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Kraken Balance</span>
          <div className="text-right">
            <p className="font-semibold text-lg">${effectiveBalance.toFixed(2)}</p>
            {(effectiveCash > 0 || effectiveAssets > 0) && (
              <p className="text-xs text-gray-500 mt-1">
                ${effectiveCash.toFixed(2)} cash + ${effectiveAssets.toFixed(2)} assets
              </p>
            )}
          </div>
        </div>

        {/* Issues (only real issues after data loaded) */}
        {operationalIssues.length > 0 && prerequisites.autoTradingEnabled && prerequisitesLoaded && (
          <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
            <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Issues Preventing Auto-Trading:
            </p>
            <ul className="text-xs text-yellow-600 dark:text-yellow-500 space-y-1">
              {operationalIssues.map((issue, idx) => (
                <li key={idx} className="flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Active Orders */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Active Orders</span>
          <Badge variant="outline">{activeOrderCount} orders</Badge>
        </div>

        {/* 24h Stats */}
        <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 space-y-2">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Last 24 Hours
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <p className="text-gray-500">Total</p>
              <p className="font-semibold">{trades24h.total}</p>
            </div>
            <div>
              <p className="text-gray-500">Buys</p>
              <p className="font-semibold text-green-600">{trades24h.buys}</p>
            </div>
            <div>
              <p className="text-gray-500">Sells</p>
              <p className="font-semibold text-red-600">{trades24h.sells}</p>
            </div>
          </div>
          <div>
            <p className="text-gray-500">Volume</p>
            <p className="font-semibold">${trades24h.volume.toFixed(2)}</p>
          </div>
        </div>

        {/* Emergency Stop */}
        {prerequisites.autoTradingEnabled && (
          <Button variant="destructive" className="w-full" onClick={handleEmergencyStop} disabled={stopping}>
            <Power className="w-4 h-4 mr-2" />
            {stopping ? 'Stopping...' : '🚨 Emergency Stop'}
          </Button>
        )}

        {/* Footer */}
        <p className="text-xs text-gray-500 text-center">
          Last checked: {lastCheckTime ? lastCheckTime.toLocaleTimeString() : 'Loading...'}
          {isKrakenConnected && <span className="text-green-600"> • Kraken Connected 🟢</span>}
        </p>

        {prerequisites.autoTradingEnabled && (
          <RouterLink to={createPageUrl("AutoTraderProspects")}>
            <Button variant="outline" className="w-full mt-2">
              <TrendingUp className="w-4 h-4 mr-2" /> View Prospect Orders
            </Button>
          </RouterLink>
        )}
      </CardContent>
    </Card>
  );
}

function PrereqItem({ done, step, label, extra, failContent }) {
  return (
    <div className="flex gap-3 p-3 rounded-lg" style={{
      backgroundColor: done ? 'rgba(34, 197, 94, 0.1)' : 'var(--secondary-bg)'
    }}>
      <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{
        backgroundColor: done ? 'rgba(34, 197, 94, 0.2)' : 'rgba(156, 163, 175, 0.2)',
        color: done ? '#22c55e' : '#9ca3af'
      }}>
        {done ? '✓' : step}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          {label}
          {done && <Badge className="bg-green-500 text-white text-xs">Connected</Badge>}
          {extra}
        </p>
        {!done && failContent}
      </div>
    </div>
  );
}