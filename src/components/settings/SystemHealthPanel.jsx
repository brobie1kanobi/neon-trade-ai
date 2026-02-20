import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  RefreshCw,
  Wifi,
  WifiOff,
  TrendingUp,
  ShieldCheck,
  Zap,
  Clock
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useSettings } from "@/components/utils/SettingsContext";
import BadDaysMonitorCard from "./BadDaysMonitorCard";

export default function SystemHealthPanel() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { settings } = useSettings();

  const fetchHealth = async () => {
    try {
      // Fetch real data from multiple sources in parallel
      const [tradesRes, ordersRes, settingsData] = await Promise.all([
        base44.entities.Trade.list('-created_date', 50),
        base44.entities.ConditionalOrder.filter({ status: 'active' }),
        Promise.resolve(settings)
      ]);

      const now = new Date();
      const oneHourAgo = new Date(now - 60 * 60 * 1000);
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

      // Analyze trades
      const recentTrades = tradesRes.filter(t => new Date(t.created_date) > oneDayAgo);
      const autoTrades = recentTrades.filter(t => t.is_auto_trade);
      const failedTrades = recentTrades.filter(t => t.status === 'failed' || t.status === 'rejected');
      const executedTrades = recentTrades.filter(t => t.status === 'executed' || t.status === 'filled');
      const liveTrades = recentTrades.filter(t => !t.is_simulation);
      const lastTrade = tradesRes[0];
      const lastTradeTime = lastTrade ? new Date(lastTrade.created_date) : null;

      // Build component health from real data
      const components = {};

      // Auto Trader health
      const autoTraderEnabled = settingsData?.auto_trading_enabled;
      const autoTradesLastHour = autoTrades.filter(t => new Date(t.created_date) > oneHourAgo);
      components.auto_trader = {
        status: !autoTraderEnabled ? 'paused' : autoTrades.length > 0 ? 'healthy' : 'idle',
        label: 'Auto Trader',
        detail: autoTraderEnabled 
          ? `${autoTrades.length} trades today, ${autoTradesLastHour.length} in last hour`
          : 'Disabled in settings',
        icon: Zap,
        last_activity: autoTrades[0] ? new Date(autoTrades[0].created_date) : null
      };

      // Trade execution health
      const failRate = recentTrades.length > 0 ? failedTrades.length / recentTrades.length : 0;
      components.trade_execution = {
        status: failRate > 0.3 ? 'unhealthy' : failRate > 0.1 ? 'degraded' : executedTrades.length > 0 ? 'healthy' : 'idle',
        label: 'Trade Execution',
        detail: `${executedTrades.length} executed, ${failedTrades.length} failed (24h)`,
        icon: TrendingUp,
        last_activity: lastTradeTime
      };

      // Kraken connection (live mode)
      const isSimMode = settingsData?.sim_trading_mode !== false;
      if (!isSimMode) {
        const krakenTrades = liveTrades.filter(t => t.kraken_order_id);
        const lastKrakenTrade = krakenTrades[0];
        components.kraken_api = {
          status: krakenTrades.length > 0 ? 'healthy' : 'idle',
          label: 'Kraken API',
          detail: krakenTrades.length > 0 
            ? `${krakenTrades.length} live trades (24h), last: ${lastKrakenTrade?.symbol}`
            : 'No live trades in last 24h',
          icon: Wifi,
          last_activity: lastKrakenTrade ? new Date(lastKrakenTrade.created_date) : null
        };
      }

      // Conditional orders / risk management
      // Count BOTH local conditional orders AND Kraken open orders
      const activeLocalOrders = ordersRes.length;
      
      // Also fetch Kraken open orders count if in LIVE mode
      let krakenOpenOrdersCount = 0;
      if (!isSimMode) {
        try {
          const krakenOrdersRes = await base44.functions.invoke('krakenApi', { action: 'getOpenOrders' });
          const krakenData = krakenOrdersRes?.data || krakenOrdersRes;
          if (krakenData?.orders) {
            krakenOpenOrdersCount = krakenData.orders.length;
          }
        } catch (_e) {
          // Silently fail - just use local count
        }
      }
      
      const totalActiveOrders = Math.max(activeLocalOrders, krakenOpenOrdersCount);
      const isMonitoring = settingsData?.auto_trading_enabled || totalActiveOrders > 0;
      
      components.risk_management = {
        status: isMonitoring ? 'healthy' : 'idle',
        label: 'Risk Management',
        detail: !isSimMode && krakenOpenOrdersCount > 0
          ? `${krakenOpenOrdersCount} Kraken open orders, ${activeLocalOrders} local conditional orders`
          : `${activeLocalOrders} active conditional orders`,
        icon: ShieldCheck,
        last_activity: ordersRes[0] ? new Date(ordersRes[0].created_date) : null
      };

      // Determine overall status
      const statuses = Object.values(components).map(c => c.status);
      const anyUnhealthy = statuses.includes('unhealthy');
      const anyDegraded = statuses.includes('degraded');
      const allPaused = statuses.every(s => s === 'paused' || s === 'idle');

      let overallStatus = 'healthy';
      if (anyUnhealthy) overallStatus = 'unhealthy';
      else if (anyDegraded) overallStatus = 'degraded';
      else if (allPaused) overallStatus = 'idle';

      setHealth({
        overall_status: overallStatus,
        components,
        total_trades_24h: recentTrades.length,
        auto_trades_24h: autoTrades.length,
        live_trades_24h: liveTrades.length,
        last_trade_time: lastTradeTime
      });
    } catch (e) {
      console.error('Failed to fetch health:', e);
      setHealth({ overall_status: 'unknown', components: {}, error: e.message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 60000);
    return () => clearInterval(interval);
  }, [settings?.auto_trading_enabled, settings?.sim_trading_mode]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchHealth();
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'degraded': return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'unhealthy': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'paused': return <XCircle className="w-4 h-4 text-orange-500" />;
      case 'idle': return <Clock className="w-4 h-4 text-gray-400" />;
      default: return <Activity className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'healthy': return <Badge className="bg-green-100 text-green-800 text-xs">Healthy</Badge>;
      case 'degraded': return <Badge className="bg-yellow-100 text-yellow-800 text-xs">Degraded</Badge>;
      case 'unhealthy': return <Badge className="bg-red-100 text-red-800 text-xs">Unhealthy</Badge>;
      case 'paused': return <Badge className="bg-orange-100 text-orange-800 text-xs">Paused</Badge>;
      case 'idle': return <Badge variant="outline" className="text-xs">Idle</Badge>;
      default: return <Badge variant="outline" className="text-xs">Unknown</Badge>;
    }
  };

  const formatTimeAgo = (date) => {
    if (!date) return 'Never';
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  if (loading) {
    return (
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
            <span className="ml-2" style={{ color: 'var(--text-secondary)' }}>Loading health status...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Activity className="w-5 h-5" />
          System Health
        </CardTitle>
        <div className="flex items-center gap-2">
          {health?.overall_status && getStatusBadge(health.overall_status)}
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary stats */}
        {health && (
          <div className="grid grid-cols-3 gap-3">
            <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'var(--secondary-bg)' }}>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {health.total_trades_24h || 0}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Trades (24h)</p>
            </div>
            <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'var(--secondary-bg)' }}>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {health.auto_trades_24h || 0}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>AI Trades</p>
            </div>
            <div className="p-2 rounded-lg text-center" style={{ backgroundColor: 'var(--secondary-bg)' }}>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {health.live_trades_24h || 0}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Live Trades</p>
            </div>
          </div>
        )}

        {/* Component details */}
        <div className="space-y-3">
          {health?.components && Object.entries(health.components).map(([key, comp]) => {
            const Icon = comp.icon || Activity;
            return (
              <div
                key={key}
                className="flex items-center justify-between p-3 rounded-lg border"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--secondary-bg)' }}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {getStatusIcon(comp.status)}
                  <div className="min-w-0">
                    <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                      {comp.label}
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                      {comp.detail}
                    </p>
                    {comp.last_activity && (
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        Last: {formatTimeAgo(comp.last_activity)}
                      </p>
                    )}
                  </div>
                </div>
                {getStatusBadge(comp.status)}
              </div>
            );
          })}
        </div>

        {health?.last_trade_time && (
          <p className="text-xs text-center" style={{ color: 'var(--text-secondary)' }}>
            Last activity: {formatTimeAgo(health.last_trade_time)}
          </p>
        )}

        {/* Bad Days Monitor */}
        <BadDaysMonitorCard />
      </CardContent>
    </Card>
  );
}