import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wallet, Eye, EyeOff, RefreshCw, Wifi, WifiOff, AlertCircle, TrendingUp, DollarSign, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import NumberDisplay from "@/components/ui/NumberDisplay";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { invalidateCache } from "@/components/hooks/useDataFetching";
import { invalidatePriceCache } from "@/components/hooks/usePriceData";
import { useSettings } from "@/components/utils/SettingsContext";
import { useRealtimeKrakenData } from "@/components/hooks/useRealtimeKrakenData";

export default function WalletBalance({ wallet, isSimMode, portfolioMarketValue = 0, onSyncComplete }) {
  const { settings } = useSettings();
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [hasAutoSynced, setHasAutoSynced] = useState(false);
  
  const persistentDataRef = useRef({
    cash: 0,
    portfolio: 0,
    total: 0,
    assets: 0
  });

  const {
    isConnected: wsConnected,
    usdBalance: wsUsdBalance,
    totalAssets: wsTotalAssets,
    lastUpdated: wsLastUpdated,
    refresh: wsRefresh
  } = useRealtimeKrakenData({
    subscribeToPrices: true,
    priceSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD'],
    subscribeToBalances: !isSimMode,
    subscribeToOrders: false,
    subscribeToExecutions: true,
    isSimMode
  });

  useEffect(() => {
    if (!isSimMode && wsConnected && !hasAutoSynced) {
      const sessionKey = 'kraken_auto_synced';
      const alreadySynced = sessionStorage.getItem(sessionKey);
      
      if (!alreadySynced) {
        console.log('[WalletBalance] 🔄 Auto-syncing on WebSocket connection...');
        
        setTimeout(async () => {
          try {
            const syncRes = await base44.functions.invoke('syncKrakenBalance', {});
            const syncData = syncRes?.data || syncRes;
            
            if (syncData?.success) {
              console.log('[WalletBalance] ✅ Auto-sync complete');
              
              if (syncData.usdBalance >= 0) {
                persistentDataRef.current.cash = syncData.usdBalance;
              }
              if (syncData.holdings?.length > 0) {
                persistentDataRef.current.assets = syncData.holdings.length;
              }
              
              invalidateCache();
              invalidatePriceCache();
              wsRefresh();
              
              sessionStorage.setItem(sessionKey, 'true');
              setHasAutoSynced(true);
              
              if (onSyncComplete) onSyncComplete();
            }
          } catch (error) {
            console.error('[WalletBalance] Auto-sync failed:', error);
          }
        }, 1500);
      } else {
        setHasAutoSynced(true);
      }
    }
  }, [wsConnected, isSimMode, hasAutoSynced, onSyncComplete, wsRefresh]);

  // CRITICAL: Use direct calculation (like AssetAllocation)
  const displayCash = React.useMemo(() => {
    let value;
    
    if (isSimMode) {
      value = wallet?.cash_balance || 0;
    } else {
      const krakenUSD = wsUsdBalance || 0;
      const dbCash = wallet?.real_cash_balance || 0;
      value = wsConnected && krakenUSD >= 0 ? krakenUSD : dbCash;
    }
    
    if (value > 0 || persistentDataRef.current.cash === 0) {
      persistentDataRef.current.cash = value;
    }
    
    return persistentDataRef.current.cash;
  }, [isSimMode, wallet, wsUsdBalance, wsConnected]);

  // CRITICAL: Use passed portfolio value from parent calculation
  const displayPortfolioValue = React.useMemo(() => {
    const value = portfolioMarketValue || 0;
    
    if (value > 0 || persistentDataRef.current.portfolio === 0) {
      persistentDataRef.current.portfolio = value;
    }
    
    return persistentDataRef.current.portfolio;
  }, [portfolioMarketValue]);

  const totalBalance = displayCash + displayPortfolioValue;
  
  useEffect(() => {
    if (totalBalance > 0) {
      persistentDataRef.current.total = totalBalance;
    }
    
    if (!isSimMode && wsConnected && wsTotalAssets > 0) {
      persistentDataRef.current.assets = wsTotalAssets;
    }
  }, [totalBalance, wsTotalAssets, wsConnected, isSimMode]);
  
  const totalAssets = isSimMode ? 0 : persistentDataRef.current.assets;

  const totalDeposits = isSimMode ? wallet?.total_deposits || 0 : wallet?.real_total_deposits || 0;
  const totalWithdrawals = isSimMode ? wallet?.total_withdrawals || 0 : wallet?.real_total_withdrawals || 0;
  const netFlow = totalDeposits - totalWithdrawals;

  const handleManualSync = async () => {
    if (isSimMode) return;

    setIsSyncing(true);
    setSyncError(null);

    const syncTimeout = setTimeout(() => {
      setIsSyncing(false);
      setSyncError('Sync timeout');
      toast.error('Sync timeout');
    }, 15000);

    try {
      toast.info('Syncing Kraken...', { duration: 2000 });

      const syncRes = await base44.functions.invoke('syncKrakenBalance', {});
      const syncData = syncRes?.data || syncRes;

      clearTimeout(syncTimeout);

      if (syncData?.success) {
        if (syncData.usdBalance >= 0) {
          persistentDataRef.current.cash = syncData.usdBalance;
        }
        if (syncData.holdings?.length > 0) {
          persistentDataRef.current.assets = syncData.holdings.length;
        }
        
        toast.success('✅ Kraken synced!', {
          description: `$${syncData.usdBalance?.toFixed(2)} USD, ${syncData.holdings?.length || 0} assets`,
          duration: 3000
        });

        invalidateCache();
        invalidatePriceCache();

        await new Promise((resolve) => setTimeout(resolve, 300));

        wsRefresh();

        window.dispatchEvent(new CustomEvent('app:data-updated', {
          detail: { type: 'kraken-sync', source: 'wallet' }
        }));

        window.dispatchEvent(new CustomEvent('kraken:synced', {
          detail: { holdings: syncData.holdings, usdBalance: syncData.usdBalance }
        }));

        if (onSyncComplete) onSyncComplete();
      } else {
        throw new Error(syncData?.error || 'Sync failed');
      }
    } catch (error) {
      clearTimeout(syncTimeout);
      console.error('[WalletBalance] Sync error:', error);
      setSyncError(error.message);
      toast.error('Sync failed', { description: error.message });
    } finally {
      setIsSyncing(false);
    }
  };

  const connectionStatus = isSimMode
    ? 'connected'
    : wsConnected
      ? 'connected'
      : 'disconnected';

  const showSyncButton = !isSimMode && (!wsConnected || syncError);

  return (
    <Card className="border-2 neon-glow" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--neon-green)' }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Wallet className="w-5 h-5 neon-text" />
              Wallet Balance
            </CardTitle>
            {isSimMode ? (
              <Badge variant="outline" className="text-xs">Demo</Badge>
            ) : (
              <Badge className="bg-green-100 text-green-800 text-xs">Live</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!isSimMode && wsConnected && totalBalance > 0 && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-600" />
              <div>
                <p className="text-xs font-semibold text-green-700 dark:text-green-400">Real-Time WebSocket Active</p>
                <p className="text-xs text-green-600 dark:text-green-500">
                  {totalAssets} asset{totalAssets !== 1 ? 's' : ''} • Auto-synced • Updated: {wsLastUpdated ? new Date(wsLastUpdated).toLocaleTimeString() : '—'}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={wsRefresh} className="h-7 text-green-700">
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4">
          <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Total Balance
                  </h3>
                  {connectionStatus === 'disconnected' && (
                    <Badge variant="destructive" className="text-xs">
                      Offline
                    </Badge>
                  )}
                  {connectionStatus === 'connected' && !isSimMode && (
                    <Badge className="bg-green-100 text-green-800 text-xs flex items-center gap-1">
                      <Wifi className="w-3 h-3" />
                      Connected 24/7
                    </Badge>
                  )}
                  {connectionStatus === 'connected' && isSimMode && (
                    <Badge variant="outline" className="text-xs">
                      Demo Mode
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Wallet className="w-5 h-5" style={{ color: 'var(--neon-green)' }} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-6 h-6 p-0"
                    onClick={() => setBalanceVisible(!balanceVisible)}
                  >
                    {balanceVisible ? 
                      <EyeOff className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /> :
                      <Eye className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    }
                  </Button>
                </div>
              </div>
              
              {balanceVisible ? (
                <NumberDisplay
                  value={totalBalance}
                  prefix="$"
                  decimals={2}
                  className="neon-text max-w-full"
                  maxFontSize={42}
                  minFontSize={20}
                />
              ) : (
                <p className="text-3xl font-bold neon-text">
                  ••••••
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Available Cash
                  </h4>
                  <DollarSign className="w-4 h-4" style={{ color: 'var(--neon-green)' }} />
                </div>
                {balanceVisible ? (
                  <NumberDisplay
                    value={displayCash}
                    prefix="$"
                    decimals={2}
                    className="max-w-full"
                    maxFontSize={28}
                    minFontSize={16}
                  />
                ) : (
                  <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>••••</p>
                )}
              </CardContent>
            </Card>

            <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Portfolio Value
                  </h4>
                  <Activity className="w-4 h-4" style={{ color: 'var(--neon-green)' }} />
                </div>
                {balanceVisible ? (
                  <NumberDisplay
                    value={displayPortfolioValue}
                    prefix="$"
                    decimals={2}
                    className="max-w-full"
                    maxFontSize={28}
                    minFontSize={16}
                  />
                ) : (
                  <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>••••</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {!isSimMode && !wsConnected && (
          <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">Establishing Connection...</p>
                <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-1">
                  WebSocket connecting to Kraken for real-time updates
                </p>
              </div>
            </div>
          </div>
        )}

        {showSyncButton && (
          <div className="pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
            {syncError && (
              <div className="mb-3 p-2 rounded bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{syncError}</span>
              </div>
            )}
            <Button
              onClick={handleManualSync}
              disabled={isSyncing}
              className="w-full bg-purple-600 hover:bg-purple-700"
              size="sm"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Reconnect & Sync'}
            </Button>
            <p className="text-xs text-center mt-2" style={{ color: 'var(--text-secondary)' }}>
              Connection lost. Click to reconnect.
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <div className="text-center">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total Deposits</p>
            {balanceVisible ? (
              <NumberDisplay value={totalDeposits} prefix="$" decimals={2} maxFontSize={16} minFontSize={12} />
            ) : (
              <p className="text-sm font-medium">••••</p>
            )}
          </div>
          <div className="text-center">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total Withdrawals</p>
            {balanceVisible ? (
              <NumberDisplay value={totalWithdrawals} prefix="$" decimals={2} maxFontSize={16} minFontSize={12} />
            ) : (
              <p className="text-sm font-medium">••••</p>
            )}
          </div>
          <div className="text-center">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Net Flow</p>
            {balanceVisible ? (
              <NumberDisplay value={Math.abs(netFlow)} prefix={netFlow >= 0 ? '+$' : '-$'} decimals={2} maxFontSize={16} minFontSize={12} className={netFlow >= 0 ? 'text-green-500' : 'text-red-500'} />
            ) : (
              <p className="text-sm font-medium">••••</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}