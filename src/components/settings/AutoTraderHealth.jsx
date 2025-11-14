import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertCircle, CheckCircle, TrendingUp, AlertTriangle, Power, RefreshCw, Wifi } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { useRealtimeKrakenData } from "@/components/hooks/useRealtimeKrakenData";
import { useSettings } from "@/components/utils/SettingsContext";

export default function AutoTraderHealth() {
  const { settings } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState(null);

  // CRITICAL: Use WebSocket for LIVE mode balance
  const { 
    isConnected: wsConnected, 
    usdBalance: wsUsdBalance,
    totalAssets: wsTotalAssets
  } = useRealtimeKrakenData({
    subscribeToBalances: !isSimMode,
    subscribeToOrders: !isSimMode,
    subscribeToExecutions: !isSimMode,
    isSimMode
  });

  const fetchHealth = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout after 5s')), 5000)
      );

      const response = await Promise.race([
        base44.functions.invoke('autoTraderMonitor', { action: 'health' }),
        timeoutPromise
      ]);

      const data = response?.data || response;
      
      if (data?.success && data?.health) {
        setHealth(data.health);
        setError(null);
      } else {
        throw new Error(data?.error || 'Invalid response');
      }
    } catch (fetchError) {
      console.error('[AutoTraderHealth] Error:', fetchError.message);
      setError(fetchError.message);
      
      setHealth({
        auto_trading_enabled: settings?.auto_trading_enabled || false,
        sim_trading_mode: isSimMode,
        wallet_balance: 0,
        wallet_status: 'unknown',
        active_conditional_orders: 0,
        trades_24h: { total: 0, buys: 0, sells: 0, volume: 0 },
        last_check: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [isSimMode]);

  // CRITICAL: Use WebSocket balance in LIVE mode
  const displayBalance = React.useMemo(() => {
    if (isSimMode) {
      return health?.wallet_balance || 0;
    }
    // LIVE MODE: Use WebSocket USD balance
    return wsConnected && wsUsdBalance >= 0 ? wsUsdBalance : (health?.wallet_balance || 0);
  }, [isSimMode, wsConnected, wsUsdBalance, health?.wallet_balance]);

  const walletStatus = React.useMemo(() => {
    const balance = displayBalance;
    if (balance < 0) return 'critical';
    if (balance < 10) return 'warning';
    return 'healthy';
  }, [displayBalance]);

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
        toast.success('🚨 Auto-Trader Stopped', {
          description: `Cancelled ${data.cancelled_orders} orders`,
          duration: 5000
        });
        
        setTimeout(() => fetchHealth(), 1000);
      } else {
        throw new Error(data?.error || 'Failed');
      }
    } catch (stopError) {
      console.error('[AutoTraderHealth] Stop error:', stopError);
      toast.error('Failed to stop', { description: stopError.message });
    } finally {
      setStopping(false);
    }
  };

  if (loading && !health) {
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

  if (!health) return null;

  const isHealthy = walletStatus === 'healthy';
  const isWarning = walletStatus === 'warning';
  const isCritical = walletStatus === 'critical';

  return (
    <Card className="border-2" style={{ 
      borderColor: isCritical ? '#ef4444' : isWarning ? '#f59e0b' : '#10b981' 
    }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            {isCritical ? (
              <AlertCircle className="w-5 h-5 text-red-500" />
            ) : isWarning ? (
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
            ) : (
              <CheckCircle className="w-5 h-5 text-green-500" />
            )}
            Auto-Trader Status
            {!isSimMode && (
              <Badge className="bg-green-500 text-white text-xs flex items-center gap-1">
                {wsConnected ? <Wifi className="w-3 h-3" /> : null}
                🟢 LIVE
              </Badge>
            )}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={fetchHealth} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
            <p className="text-xs text-yellow-700 dark:text-yellow-400">
              ⚠️ Using cached data - {error}
            </p>
          </div>
        )}

        {!isSimMode && !wsConnected && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <p className="text-xs font-semibold text-red-700 dark:text-red-400">
              ⚠️ Kraken WebSocket Disconnected
            </p>
            <p className="text-xs text-red-600 dark:text-red-500 mt-1">
              Auto-trader may not function properly without live connection
            </p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Status</span>
          <Badge className={
            health.auto_trading_enabled && !isSimMode
              ? 'bg-green-500 text-white'
              : health.auto_trading_enabled
              ? 'bg-blue-500 text-white'
              : 'bg-gray-500 text-white'
          }>
            {health.auto_trading_enabled 
              ? (isSimMode ? '💎 Running (SIM)' : '🟢 LIVE & Active')
              : '⏸️ Disabled'}
          </Badge>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {isSimMode ? 'Wallet Balance (SIM)' : 'USD Balance (LIVE)'}
          </span>
          <div className="text-right">
            <p className="font-semibold">${displayBalance.toFixed(2)}</p>
            <Badge variant="outline" className={
              walletStatus === 'critical'
                ? 'text-red-600 border-red-600'
                : walletStatus === 'warning'
                ? 'text-yellow-600 border-yellow-600'
                : 'text-green-600 border-green-600'
            }>
              {walletStatus}
            </Badge>
            {!isSimMode && wsConnected && (
              <p className="text-xs text-green-600 mt-1">✅ Live WebSocket</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Active Orders</span>
          <Badge variant="outline">
            {health.active_conditional_orders} orders
          </Badge>
        </div>

        <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 space-y-2">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            Last 24 Hours
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <p className="text-gray-500">Total</p>
              <p className="font-semibold">{health.trades_24h.total}</p>
            </div>
            <div>
              <p className="text-gray-500">Buys</p>
              <p className="font-semibold text-green-600">{health.trades_24h.buys}</p>
            </div>
            <div>
              <p className="text-gray-500">Sells</p>
              <p className="font-semibold text-red-600">{health.trades_24h.sells}</p>
            </div>
          </div>
          <div>
            <p className="text-gray-500">Volume</p>
            <p className="font-semibold">${health.trades_24h.volume.toFixed(2)}</p>
          </div>
        </div>

        {health.auto_trading_enabled && !isSimMode && (
          <Button
            variant="destructive"
            className="w-full"
            onClick={handleEmergencyStop}
            disabled={stopping}
          >
            <Power className="w-4 h-4 mr-2" />
            {stopping ? 'Stopping...' : '🚨 Emergency Stop'}
          </Button>
        )}

        <p className="text-xs text-gray-500 text-center">
          Last checked: {new Date(health.last_check).toLocaleTimeString()}
          {!isSimMode && wsConnected && wsTotalAssets > 0 && (
            <span className="text-green-600"> • {wsTotalAssets} asset{wsTotalAssets !== 1 ? 's' : ''} • WebSocket Active 🟢</span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}