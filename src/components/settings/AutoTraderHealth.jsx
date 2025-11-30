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

  // CRITICAL: WebSocket for LIVE mode balances
  const { 
    isConnected: wsConnected, 
    balances: wsBalances,
    usdBalance: wsUsdBalance,
    totalPortfolioValue: wsTotalValue 
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
        // CRITICAL: In LIVE mode, OVERRIDE wallet_balance with WebSocket data
        if (!isSimMode && wsConnected && wsUsdBalance >= 0) {
          data.health.wallet_balance = wsUsdBalance;
          data.health.wallet_status = wsUsdBalance < 0 ? 'critical' : wsUsdBalance < 10 ? 'warning' : 'healthy';
        }
        setHealth(data.health);
        setError(null);
      } else {
        throw new Error(data?.error || 'Invalid response');
      }
    } catch (fetchError) {
      console.error('[AutoTraderHealth] Error:', fetchError.message);
      setError(fetchError.message);
      
      // CRITICAL: Use WebSocket data as fallback in LIVE mode
      const liveBalance = (!isSimMode && wsConnected) ? wsUsdBalance : 0;
      
      setHealth({
        auto_trading_enabled: settings?.auto_trading_enabled || false,
        sim_trading_mode: isSimMode,
        wallet_balance: liveBalance,
        wallet_status: liveBalance < 0 ? 'critical' : liveBalance < 10 ? 'warning' : 'healthy',
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
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchHealth, 30000);
    
    return () => clearInterval(interval);
  }, []);

  // CRITICAL: Auto-update balance from WebSocket in LIVE mode
  useEffect(() => {
    if (!isSimMode && wsConnected && wsUsdBalance >= 0) {
      setHealth(prev => prev ? {
        ...prev,
        wallet_balance: wsUsdBalance,
        wallet_status: wsUsdBalance < 0 ? 'critical' : wsUsdBalance < 10 ? 'warning' : 'healthy',
        last_check: new Date().toISOString()
      } : null);
    }
  }, [isSimMode, wsConnected, wsUsdBalance]);

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

  const isHealthy = health.wallet_status === 'healthy';
  const isWarning = health.wallet_status === 'warning';
  const isCritical = health.wallet_status === 'critical';

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
            {!isSimMode && wsConnected && (
              <Badge variant="outline" className="text-xs flex items-center gap-1 bg-green-50 text-green-700 border-green-200">
                <Wifi className="w-3 h-3" />
                Live
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

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Status</span>
          <Badge className={
            health.auto_trading_enabled && !health.sim_trading_mode
              ? 'bg-green-500 text-white'
              : health.auto_trading_enabled
              ? 'bg-blue-500 text-white'
              : 'bg-gray-500 text-white'
          }>
            {health.auto_trading_enabled 
              ? (health.sim_trading_mode ? '💎 Running (SIM)' : '🟢 LIVE & Active')
              : '⏸️ Disabled'}
          </Badge>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            Wallet Balance
            {!isSimMode && wsConnected && (
              <span className="text-xs text-green-600 ml-1">• Live</span>
            )}
          </span>
          <div className="text-right">
            <p className="font-semibold">
              ${(health.wallet_balance || 0).toFixed(2)}
              {!isSimMode && wsConnected && <span className="text-xs text-green-500 ml-1">🟢</span>}
            </p>
            <Badge variant="outline" className={
              health.wallet_status === 'critical'
                ? 'text-red-600 border-red-600'
                : health.wallet_status === 'warning'
                ? 'text-yellow-600 border-yellow-600'
                : 'text-green-600 border-green-600'
            }>
              {health.wallet_status}
            </Badge>
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

        {health.auto_trading_enabled && !health.sim_trading_mode && (
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
          {!isSimMode && wsConnected && (
            <span className="text-green-600"> • WebSocket Active 🟢</span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}