import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertCircle, CheckCircle, TrendingUp, AlertTriangle, Power, RefreshCw, Wifi, HelpCircle, ArrowRight, Link as LinkIcon } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { useKrakenWebSocket } from "@/components/providers/KrakenWebSocketProvider";
import { useSettings } from "@/components/utils/SettingsContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";
import { KrakenConnection, AutoBuyPreference } from "@/entities/all";

export default function AutoTraderHealth() {
  const { settings, user } = useSettings();
  
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [prerequisites, setPrerequisites] = useState({
    krakenConnected: false,
    autoTradingEnabled: false,
    hasAutoBuyPrefs: false
  });

  // CRITICAL: Use global WebSocket connection
  const { isConnected: wsConnected, usdBalance: wsUsdBalance } = useKrakenWebSocket();

  const checkPrerequisites = async () => {
    if (!user?.email) return;
    
    try {
      // CRITICAL: WebSocket connection is PRIMARY indicator - if connected, Kraken IS connected
      const autoBuyPrefs = await AutoBuyPreference.filter({ 
        created_by: user.email, 
        enabled: true, 
        is_simulation: false 
      }).catch(() => []);

      const prereqs = {
        krakenConnected: wsConnected, // WebSocket active = Kraken connected
        autoTradingEnabled: settings?.auto_trading_enabled === true,
        hasAutoBuyPrefs: autoBuyPrefs.length > 0
      };

      console.log('[AutoTraderHealth] Prerequisites:', prereqs, '| WS Connected:', wsConnected);
      setPrerequisites(prereqs);
      return prereqs;
    } catch (err) {
      console.error('[AutoTraderHealth] Prerequisites check error:', err);
      return prerequisites;
    }
  };

  const fetchHealth = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Check prerequisites first
      await checkPrerequisites();
      
      // CRITICAL: Fast timeout - 5 seconds max
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
      
      // Only set error if WebSocket is also disconnected
      if (!wsConnected) {
        setError(fetchError.message);
      } else {
        setError(null); // Clear error if WebSocket is active
      }
      
      // Show minimal fallback health (LIVE mode only)
      setHealth({
        auto_trading_enabled: settings?.auto_trading_enabled || false,
        wallet_balance: wsUsdBalance || 0,
        wallet_status: wsUsdBalance < 0 ? 'critical' : wsUsdBalance < 10 ? 'warning' : 'healthy',
        active_conditional_orders: 0,
        trades_24h: { total: 0, buys: 0, sells: 0, volume: 0 },
        last_check: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.email) {
      fetchHealth();
      
      // Refresh every 30 seconds
      const interval = setInterval(fetchHealth, 30000);
      
      return () => clearInterval(interval);
    }
  }, [user?.email, settings?.auto_trading_enabled]);

  // Re-check prerequisites when WebSocket connection changes
  useEffect(() => {
    if (user?.email && health) {
      checkPrerequisites();
    }
  }, [wsConnected, user?.email]);

  // Auto-update balance from WebSocket (ALWAYS LIVE)
  useEffect(() => {
    if (wsUsdBalance > 0) {
      setHealth(prev => prev ? {
        ...prev,
        wallet_balance: wsUsdBalance,
        wallet_status: wsUsdBalance < 0 ? 'critical' : wsUsdBalance < 10 ? 'warning' : 'healthy',
        last_check: new Date().toISOString()
      } : null);
    }
  }, [wsUsdBalance]);

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
            {wsConnected && (
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
        {error && !wsConnected && (
          <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
            <p className="text-xs text-yellow-700 dark:text-yellow-400">
              ⚠️ Health check slow - using live WebSocket data
            </p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Status</span>
          <div className="flex items-center gap-2">
            <Badge className={
              health.auto_trading_enabled
                ? 'bg-green-500 text-white'
                : 'bg-gray-500 text-white'
            }>
              {health.auto_trading_enabled ? '🟢 Enabled' : '⏸️ Disabled'}
            </Badge>
            {!health.auto_trading_enabled && (
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
                      {prerequisites.krakenConnected && prerequisites.hasAutoBuyPrefs && prerequisites.autoTradingEnabled ? (
                        <CheckCircle className="w-5 h-5 text-green-500" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-yellow-500" />
                      )}
                      <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {prerequisites.krakenConnected && prerequisites.hasAutoBuyPrefs && prerequisites.autoTradingEnabled
                          ? 'Auto-Trader Active'
                          : prerequisites.krakenConnected && prerequisites.hasAutoBuyPrefs 
                          ? 'Ready to Enable' 
                          : 'Setup Required'}
                      </h3>
                    </div>

                    <div className="space-y-3">
                      {/* Show status for each prerequisite */}
                      <div className="space-y-3">
                        {/* Kraken Connection */}
                        <div className="flex gap-3 p-3 rounded-lg" style={{ 
                          backgroundColor: prerequisites.krakenConnected ? 'rgba(34, 197, 94, 0.1)' : 'var(--secondary-bg)'
                        }}>
                          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{
                            backgroundColor: prerequisites.krakenConnected ? 'rgba(34, 197, 94, 0.2)' : 'rgba(156, 163, 175, 0.2)',
                            color: prerequisites.krakenConnected ? '#22c55e' : '#9ca3af'
                          }}>
                            {prerequisites.krakenConnected ? '✓' : '1'}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                              Kraken Account
                              {prerequisites.krakenConnected && (
                                <Badge className="bg-green-500 text-white text-xs">Connected</Badge>
                              )}
                              {wsConnected && (
                                <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">Live</Badge>
                              )}
                            </p>
                            {!prerequisites.krakenConnected && (
                              <>
                                <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                                  Link your Kraken exchange account with API credentials
                                </p>
                                <Link to={createPageUrl("Wallet")} onClick={() => setShowHelp(false)}>
                                  <Button size="sm" variant="outline" className="text-xs gap-1">
                                    <LinkIcon className="w-3 h-3" />
                                    Go to Wallet
                                  </Button>
                                </Link>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Auto-Trading Toggle */}
                        <div className="flex gap-3 p-3 rounded-lg" style={{ 
                          backgroundColor: prerequisites.autoTradingEnabled ? 'rgba(34, 197, 94, 0.1)' : 'var(--secondary-bg)'
                        }}>
                          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{
                            backgroundColor: prerequisites.autoTradingEnabled ? 'rgba(34, 197, 94, 0.2)' : 'rgba(156, 163, 175, 0.2)',
                            color: prerequisites.autoTradingEnabled ? '#22c55e' : '#9ca3af'
                          }}>
                            {prerequisites.autoTradingEnabled ? '✓' : '2'}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                              Auto-Trading Toggle
                              {prerequisites.autoTradingEnabled && (
                                <Badge className="bg-green-500 text-white text-xs">Enabled</Badge>
                              )}
                            </p>
                            {!prerequisites.autoTradingEnabled && (
                              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                Turn on the auto-trading switch in Trading Settings above
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Auto-Buy Preferences */}
                        <div className="flex gap-3 p-3 rounded-lg" style={{ 
                          backgroundColor: prerequisites.hasAutoBuyPrefs ? 'rgba(34, 197, 94, 0.1)' : 'var(--secondary-bg)'
                        }}>
                          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{
                            backgroundColor: prerequisites.hasAutoBuyPrefs ? 'rgba(34, 197, 94, 0.2)' : 'rgba(156, 163, 175, 0.2)',
                            color: prerequisites.hasAutoBuyPrefs ? '#22c55e' : '#9ca3af'
                          }}>
                            {prerequisites.hasAutoBuyPrefs ? '✓' : '3'}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                              Auto-Buy Preferences
                              {prerequisites.hasAutoBuyPrefs && (
                                <Badge className="bg-green-500 text-white text-xs">Configured</Badge>
                              )}
                            </p>
                            {!prerequisites.hasAutoBuyPrefs && (
                              <>
                                <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                                  Configure which assets to auto-trade in Portfolio
                                </p>
                                <Link to={createPageUrl("Portfolio")} onClick={() => setShowHelp(false)}>
                                  <Button size="sm" variant="outline" className="text-xs gap-1">
                                    <ArrowRight className="w-3 h-3" />
                                    Configure Portfolio
                                  </Button>
                                </Link>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Summary */}
                      {prerequisites.krakenConnected && prerequisites.hasAutoBuyPrefs && prerequisites.autoTradingEnabled && (
                        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                          <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">
                            ✅ Auto-Trader Active!
                          </p>
                          <p className="text-xs text-green-600 dark:text-green-500">
                            Your auto-trader is now monitoring the market and will execute trades automatically.
                          </p>
                        </div>
                      )}
                      {prerequisites.krakenConnected && prerequisites.hasAutoBuyPrefs && !prerequisites.autoTradingEnabled && (
                        <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                          <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400 mb-1">
                            ⏸️ Almost Ready!
                          </p>
                          <p className="text-xs text-yellow-600 dark:text-yellow-500">
                            Just toggle "Enable Auto-Trading" above to start automated trading.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Wallet Balance</span>
          <div className="text-right">
            <p className="font-semibold">${health.wallet_balance.toFixed(2)}</p>
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

        {health.auto_trading_enabled && (
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
          {wsConnected && (
            <span className="text-green-600"> • WebSocket Active 🟢</span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}