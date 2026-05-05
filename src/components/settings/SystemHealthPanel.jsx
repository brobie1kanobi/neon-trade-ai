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
  TrendingUp,
  ShieldCheck,
  Zap,
  Clock,
  RotateCcw,
  PauseCircle
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useSettings } from "@/components/utils/SettingsContext";
import BadDaysMonitorCard from "./BadDaysMonitorCard";
import { toast } from "sonner";

export default function SystemHealthPanel() {
  const [health, setHealth] = useState(null);
  const [healthRecords, setHealthRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resettingComponent, setResettingComponent] = useState(null);
  const { settings } = useSettings();

  const fetchHealth = async () => {
    try {
      // Fetch real data from multiple sources in parallel
      const [tradesRes, ordersRes, settingsData, systemHealthRecords] = await Promise.all([
        base44.entities.Trade.list('-created_date', 50),
        base44.entities.ConditionalOrder.filter({ status: 'active' }),
        Promise.resolve(settings),
        base44.entities.SystemHealth.filter({}).catch(() => [])
      ]);

      setHealthRecords(systemHealthRecords);

      const now = new Date();
      const oneHourAgo = new Date(now - 60 * 60 * 1000);
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

      // Build a map of SystemHealth entity records for merging
      const shMap = {};
      for (const r of systemHealthRecords) {
        shMap[r.component] = r;
      }

      // Analyze trades
      const recentTrades = tradesRes.filter(t => new Date(t.created_date) > oneDayAgo);
      const autoTrades = recentTrades.filter(t => t.is_auto_trade);
      const failedTrades = recentTrades.filter(t => t.status === 'failed' || t.status === 'rejected');
      const executedTrades = recentTrades.filter(t => t.status === 'executed' || t.status === 'filled');
      const liveTrades = recentTrades.filter(t => !t.is_simulation);
      const lastTrade = tradesRes[0];
      const lastTradeTime = lastTrade ? new Date(lastTrade.created_date) : null;

      // Build component health from real data, MERGED with SystemHealth entity records
      const components = {};

      // Auto Trader health
      const autoTraderEnabled = settingsData?.auto_trading_enabled;
      const autoTradesLastHour = autoTrades.filter(t => new Date(t.created_date) > oneHourAgo);
      const atRecord = shMap['auto_trader'];
      const atPaused = atRecord?.is_auto_paused || atRecord?.status === 'unhealthy';
      components.auto_trader = {
        status: atPaused ? 'unhealthy' : !autoTraderEnabled ? 'paused' : autoTrades.length > 0 ? 'healthy' : 'idle',
        label: 'Auto Trader',
        detail: atPaused
          ? `BLOCKED: ${atRecord.last_error_message || 'System health issue'}`
          : autoTraderEnabled 
            ? `${autoTrades.length} trades today, ${autoTradesLastHour.length} in last hour`
            : 'Disabled in settings',
        icon: Zap,
        last_activity: autoTrades[0] ? new Date(autoTrades[0].created_date) : null,
        entity_record: atRecord
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

      // Kraken API health - CRITICAL: merge with SystemHealth entity record
      const isSimMode = settingsData?.sim_trading_mode !== false;
      if (!isSimMode) {
        const krakenTrades = liveTrades.filter(t => t.kraken_order_id);
        const lastKrakenTrade = krakenTrades[0];
        const krRecord = shMap['kraken_api'];
        const krPaused = krRecord?.is_auto_paused || krRecord?.status === 'unhealthy';
        components.kraken_api = {
          status: krPaused ? 'unhealthy' : krakenTrades.length > 0 ? 'healthy' : 'idle',
          label: 'Kraken API',
          detail: krPaused
            ? `BLOCKED: ${krRecord.last_error_message || 'API health issue'} (errors 1h: ${krRecord.error_count_1h || 0}, 24h: ${krRecord.error_count_24h || 0})`
            : krakenTrades.length > 0 
              ? `${krakenTrades.length} live trades (24h), last: ${lastKrakenTrade?.symbol}`
              : 'No live trades in last 24h',
          icon: Wifi,
          last_activity: lastKrakenTrade ? new Date(lastKrakenTrade.created_date) : null,
          entity_record: krRecord
        };

        // Also show kraken_ws and market_data if they have records
        const wsRecord = shMap['kraken_ws'];
        if (wsRecord) {
          const wsPaused = wsRecord.is_auto_paused || wsRecord.status === 'unhealthy';
          components.kraken_ws = {
            status: wsPaused ? 'unhealthy' : wsRecord.status === 'degraded' ? 'degraded' : 'healthy',
            label: 'Kraken WebSocket',
            detail: wsPaused
              ? `BLOCKED: ${wsRecord.last_error_message || 'WS health issue'}`
              : wsRecord.status === 'healthy' ? 'Connected' : wsRecord.status || 'Unknown',
            icon: Wifi,
            last_activity: wsRecord.last_success_at ? new Date(wsRecord.last_success_at) : null,
            entity_record: wsRecord
          };
        }

        const aiRecord = shMap['ai_signals'];
        if (aiRecord) {
          const aiPaused = aiRecord.is_auto_paused || aiRecord.status === 'unhealthy';
          components.ai_signals = {
            status: aiPaused ? 'unhealthy' : aiRecord.status === 'degraded' ? 'degraded' : 'healthy',
            label: 'AI Signals',
            detail: aiPaused
              ? `BLOCKED: ${aiRecord.last_error_message || 'Signals health issue'}`
              : aiRecord.status === 'healthy' ? 'Operational' : aiRecord.status || 'Unknown',
            icon: Zap,
            last_activity: aiRecord.last_success_at ? new Date(aiRecord.last_success_at) : null,
            entity_record: aiRecord
          };
        }
      }

      // Conditional orders / risk management
      const activeLocalOrders = ordersRes.length;
      let krakenOpenOrdersCount = 0;
      if (!isSimMode) {
        try {
          const krakenOrdersRes = await base44.functions.invoke('krakenApi', { action: 'getOpenOrders' });
          const krakenData = krakenOrdersRes?.data || krakenOrdersRes;
          if (krakenData?.orders) {
            krakenOpenOrdersCount = krakenData.orders.length;
          }
        } catch (_e) {}
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

      // Determine overall status - INCLUDE SystemHealth entity records
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

  const handleResetComponent = async (componentKey, entityRecord) => {
    if (!entityRecord?.id) return;
    setResettingComponent(componentKey);
    try {
      await base44.entities.SystemHealth.update(entityRecord.id, {
        status: 'healthy',
        is_auto_paused: false,
        pause_reason: '',
        error_count_1h: 0,
        error_count_24h: 0,
        last_error_message: '',
        last_error_at: '',
        last_success_at: new Date().toISOString(),
        metrics_json: JSON.stringify({ manually_reset: true, reset_at: new Date().toISOString() })
      });
      toast.success(`${componentKey} reset to healthy`);
      await fetchHealth();
    } catch (e) {
      toast.error(`Failed to reset: ${e.message}`);
    } finally {
      setResettingComponent(null);
    }
  };

  const handleResetAll = async () => {
    setResettingComponent('all');
    try {
      const unhealthyRecords = healthRecords.filter(r => r.status === 'unhealthy' || r.is_auto_paused);
      for (const record of unhealthyRecords) {
        await base44.entities.SystemHealth.update(record.id, {
          status: 'healthy',
          is_auto_paused: false,
          pause_reason: '',
          error_count_1h: 0,
          error_count_24h: 0,
          last_error_message: '',
          last_error_at: '',
          last_success_at: new Date().toISOString(),
          metrics_json: JSON.stringify({ manually_reset: true, reset_at: new Date().toISOString() })
        });
      }
      toast.success(`Reset ${unhealthyRecords.length} component(s) to healthy`);
      await fetchHealth();
    } catch (e) {
      toast.error(`Failed to reset: ${e.message}`);
    } finally {
      setResettingComponent(null);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'degraded': return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'unhealthy': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'paused': return <PauseCircle className="w-4 h-4 text-orange-500" />;
      case 'idle': return <Clock className="w-4 h-4 text-gray-400" />;
      default: return <Activity className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'healthy': return <Badge className="bg-green-100 text-green-800 text-xs">Healthy</Badge>;
      case 'degraded': return <Badge className="bg-yellow-100 text-yellow-800 text-xs">Degraded</Badge>;
      case 'unhealthy': return <Badge className="bg-red-100 text-red-800 text-xs">Blocked</Badge>;
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

  // Check if any SystemHealth entity records are blocking trading
  const blockedRecords = healthRecords.filter(r => r.status === 'unhealthy' || r.is_auto_paused);
  const isSystemBlocked = blockedRecords.length > 0;

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
    <Card style={{ 
      backgroundColor: 'var(--card-bg)', 
      borderColor: isSystemBlocked ? '#ef4444' : 'var(--border-color)',
      borderWidth: isSystemBlocked ? '2px' : '1px'
    }}>
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
        {/* CRITICAL: System blocked banner */}
        {isSystemBlocked && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-800">
            <div className="flex items-start gap-2">
              <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                  Auto-trading is BLOCKED by system health
                </p>
                <p className="text-xs text-red-600 dark:text-red-300 mt-1">
                  {blockedRecords.map(r => `${r.component}: ${r.last_error_message || r.pause_reason || 'unhealthy'}`).join(' • ')}
                </p>
                <Button 
                  size="sm" 
                  className="mt-2 gap-1 bg-red-600 hover:bg-red-700 text-white"
                  onClick={handleResetAll}
                  disabled={resettingComponent === 'all'}
                >
                  <RotateCcw className={`w-3 h-3 ${resettingComponent === 'all' ? 'animate-spin' : ''}`} />
                  {resettingComponent === 'all' ? 'Resetting...' : 'Reset All to Healthy'}
                </Button>
              </div>
            </div>
          </div>
        )}

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
            const isBlocked = comp.status === 'unhealthy' && comp.entity_record;
            return (
              <div
                key={key}
                className="p-3 rounded-lg border"
                style={{ 
                  borderColor: isBlocked ? '#ef4444' : 'var(--border-color)', 
                  backgroundColor: 'var(--secondary-bg)' 
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {getStatusIcon(comp.status)}
                    <div className="min-w-0">
                      <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                        {comp.label}
                      </p>
                      <p className="text-xs" style={{ color: isBlocked ? '#ef4444' : 'var(--text-secondary)' }}>
                        {comp.detail}
                      </p>
                      {comp.last_activity && (
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          Last: {formatTimeAgo(comp.last_activity)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {getStatusBadge(comp.status)}
                    {isBlocked && (
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="text-xs gap-1 h-7 px-2"
                        onClick={() => handleResetComponent(key, comp.entity_record)}
                        disabled={resettingComponent === key}
                      >
                        <RotateCcw className={`w-3 h-3 ${resettingComponent === key ? 'animate-spin' : ''}`} />
                        Reset
                      </Button>
                    )}
                  </div>
                </div>
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