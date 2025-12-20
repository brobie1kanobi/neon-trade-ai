import React, { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertCircle, CheckCircle, TrendingUp, AlertTriangle, Power, RefreshCw, Wifi, HelpCircle, ArrowRight, Link as LinkIcon, XCircle } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { useSettings } from "@/components/utils/SettingsContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";
import { KrakenConnection, AutoBuyPreference } from "@/entities/all";
import { useKrakenData } from "@/components/hooks/useKrakenData";

export default function AutoTraderHealth() {
  const { settings, user } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [operationalIssues, setOperationalIssues] = useState([]);
  const [prerequisites, setPrerequisites] = useState({
    krakenConnected: false,
    autoTradingEnabled: false,
    hasAutoBuyPrefs: false,
    hasBalance: false
  });

  // USE THE SAME HOOK AS DASHBOARD/PORTFOLIO/WALLET - useKrakenData
  const { krakenData, connected: krakenConnected, refresh: refreshKraken } = useKrakenData(isSimMode, true);

  // Extract balance values from the SAME source as other pages
  const effectiveBalance = krakenData?.total_portfolio_value || 0;
  const effectiveCash = krakenData?.usd_balance || 0;
  const effectiveAssets = krakenData?.total_crypto_value || 0;
  const isKrakenConnected = krakenConnected || (krakenData?.connected === true);

  const checkPrerequisites = useCallback(async () => {
    if (!user?.email) return;
    
    try {
      // Check BOTH WebSocket AND database for Kraken connection
      const [krakenConns, autoBuyPrefs] = await Promise.all([
        KrakenConnection.filter({ created_by: user.email }).catch(() => []),
        AutoBuyPreference.filter({ 
          created_by: user.email, 
          enabled: true, 
          is_simulation: false 
        }).catch(() => [])
      ]);

      // Kraken is connected if: WebSocket active OR verified connection exists in DB OR we got API balance
      const hasKrakenCredentials = krakenConns.length > 0 && krakenConns[0]?.account_verified;
      const krakenConnected = wsConnected || hasKrakenCredentials || krakenBalance.connected;

      // For balance check, use effective balance
      const hasBalance = effectiveBalance > 1;

      const prereqs = {
        krakenConnected,
        autoTradingEnabled: settings?.auto_trading_enabled === true,
        hasAutoBuyPrefs: autoBuyPrefs.length > 0,
        hasBalance
      };

      // Build list of operational issues
      const issues = [];
      if (!prereqs.krakenConnected) {
        issues.push({ type: 'connection', message: 'Kraken not connected' });
      }
      if (!prereqs.hasAutoBuyPrefs) {
        issues.push({ type: 'config', message: 'No auto-buy assets configured' });
      }
      // Only show balance issue if WebSocket is connected and balance is actually low
      if (wsConnected && effectiveBalance <= 1) {
        issues.push({ type: 'balance', message: 'Insufficient balance to trade' });
      }
      
      setOperationalIssues(issues);
      console.log('[AutoTraderHealth] Prerequisites:', prereqs, '| WS Connected:', wsConnected, '| Has Kraken Creds:', hasKrakenCredentials, '| Balance:', effectiveBalance);
      setPrerequisites(prereqs);
      return prereqs;
    } catch (err) {
      console.error('[AutoTraderHealth] Prerequisites check error:', err);
      return prerequisites;
    }
  }, [user?.email, wsConnected, settings?.auto_trading_enabled, effectiveBalance, krakenBalance.connected]);

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
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
        // CRITICAL: Override backend balance with WebSocket data (always up-to-date)
        const wsBalance = totalPortfolioValue > 0 ? totalPortfolioValue : wsUsdBalance;
        setHealth({
          ...data.health,
          wallet_balance: wsBalance > 0 ? wsBalance : data.health.wallet_balance,
          wallet_status: wsBalance > 10 ? 'healthy' : wsBalance > 0 ? 'warning' : 'critical'
        });
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
      
      // Show minimal fallback health using WebSocket balance
      setHealth({
        auto_trading_enabled: settings?.auto_trading_enabled || false,
        wallet_balance: effectiveBalance || 0,
        wallet_status: effectiveBalance > 10 ? 'healthy' : effectiveBalance > 0 ? 'warning' : 'critical',
        active_conditional_orders: 0,
        trades_24h: { total: 0, buys: 0, sells: 0, volume: 0 },
        last_check: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  }, [totalPortfolioValue, wsUsdBalance, wsConnected, settings?.auto_trading_enabled, effectiveBalance]);

  // Fetch Kraken balance directly from API
  const fetchKrakenBalance = useCallback(async () => {
    if (!user?.email) return;
    
    try {
      const response = await base44.functions.invoke('getKrakenBalance', {});
      const data = response?.data || response;
      
      if (data?.success && data?.balances) {
        const usd = Number(data.balances['USD']?.balance || data.balances['ZUSD']?.balance || 0);
        let cryptoValue = 0;
        
        // Calculate crypto value from balances
        Object.entries(data.balances).forEach(([asset, info]) => {
          if (asset !== 'USD' && asset !== 'ZUSD') {
            const qty = Number(info?.balance || 0);
            const price = Number(info?.usd_value || 0) / qty || 0;
            cryptoValue += Number(info?.usd_value || 0);
          }
        });
        
        setKrakenBalance({
          total: usd + cryptoValue,
          cash: usd,
          assets: cryptoValue,
          connected: true
        });
        console.log('[AutoTraderHealth] Direct Kraken balance:', { usd, cryptoValue, total: usd + cryptoValue });
      }
    } catch (err) {
      console.error('[AutoTraderHealth] Kraken balance fetch error:', err);
    }
  }, [user?.email]);

  useEffect(() => {
    if (user?.email) {
      fetchHealth();
      fetchKrakenBalance();
      
      // Refresh every 30 seconds
      const interval = setInterval(() => {
        fetchHealth();
        fetchKrakenBalance();
      }, 30000);
      
      return () => clearInterval(interval);
    }
  }, [user?.email, settings?.auto_trading_enabled]);

  // Re-check prerequisites when WebSocket connection changes
  useEffect(() => {
    if (user?.email) {
      checkPrerequisites();
    }
  }, [wsConnected, user?.email, settings?.auto_trading_enabled]);

  // Auto-update balance from WebSocket (ALWAYS LIVE) - use TOTAL portfolio value
  useEffect(() => {
    if (effectiveBalance >= 0) {
      setHealth(prev => prev ? {
        ...prev,
        wallet_balance: effectiveBalance,
        wallet_status: effectiveBalance > 10 ? 'healthy' : effectiveBalance > 0 ? 'warning' : 'critical',
        last_check: new Date().toISOString()
      } : null);
      
      // Re-check prerequisites when balance changes
      checkPrerequisites();
    }
  }, [effectiveBalance, checkPrerequisites]);

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

  // Determine health status based on effective balance
  const isHealthy = effectiveBalance > 10;
  const isWarning = effectiveBalance > 0 && effectiveBalance <= 10;
  const isCritical = effectiveBalance <= 0;
  
  // Check if auto-trader can actually operate
  const canOperate = prerequisites.krakenConnected && 
                     prerequisites.autoTradingEnabled && 
                     prerequisites.hasAutoBuyPrefs && 
                     effectiveBalance > 1;

  return (
    <Card className="border-2" style={{ 
      borderColor: !canOperate && prerequisites.autoTradingEnabled ? '#f59e0b' : 
                   isCritical ? '#ef4444' : 
                   isWarning ? '#f59e0b' : '#10b981' 
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
            {/* Show Enabled/Disabled based on setting, but also show issues */}
            {prerequisites.autoTradingEnabled ? (
              operationalIssues.length > 0 ? (
                // Enabled but has issues preventing operation
                <Badge className="bg-yellow-500 text-white flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Enabled (Issues)
                </Badge>
              ) : (
                // Fully operational
                <Badge className="bg-green-500 text-white">
                  🟢 Enabled
                </Badge>
              )
            ) : (
              <Badge className="bg-gray-500 text-white">
                ⏸️ Disabled
              </Badge>
            )}
            
            {/* Show help icon if not enabled OR has operational issues */}
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
          <span className="text-sm font-medium">Kraken Balance</span>
          <div className="text-right">
            <p className="font-semibold text-lg">
              ${effectiveBalance.toFixed(2)}
            </p>
            <div className="flex items-center gap-1 justify-end">
              <Badge variant="outline" className={
                isKrakenConnected
                  ? 'text-green-600 border-green-600'
                  : 'text-yellow-600 border-yellow-600'
              }>
                {wsConnected ? '🔴 live' : isKrakenConnected ? 'api' : 'cached'}
              </Badge>
            </div>
            {(effectiveCash > 0 || effectiveAssets > 0) && (
              <p className="text-xs text-gray-500 mt-1">
                ${effectiveCash.toFixed(2)} cash + ${effectiveAssets.toFixed(2)} assets
              </p>
            )}
          </div>
        </div>
        
        {/* Show operational issues if any */}
        {operationalIssues.length > 0 && prerequisites.autoTradingEnabled && (
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

        {prerequisites.autoTradingEnabled && (
          <RouterLink to={createPageUrl("AutoTraderProspects")}>
            <Button variant="outline" className="w-full mt-2">
              <TrendingUp className="w-4 h-4 mr-2" />
              View Prospect Orders
            </Button>
          </RouterLink>
        )}
        </CardContent>
        </Card>
        );
        }