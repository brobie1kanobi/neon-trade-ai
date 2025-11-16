
import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wallet, Eye, EyeOff, RefreshCw, Wifi, WifiOff, AlertCircle, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import NumberDisplay from "@/components/ui/NumberDisplay";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { invalidateCache } from "@/components/hooks/useDataFetching";
import { invalidatePriceCache } from "@/components/hooks/usePriceData";
import { useSettings } from "@/components/utils/SettingsContext";
import { useRealtimeKrakenData } from "@/components/hooks/useRealtimeKrakenData";

export default function WalletBalance({ wallet, isSimMode, portfolioMarketValue = 0, onSyncComplete, holdings = [], prices = {} }) {
  const { settings } = useSettings();
  const [isVisible, setIsVisible] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [hasAutoSynced, setHasAutoSynced] = useState(false);
  
  // CRITICAL: Persistent state to prevent flashing to zero
  const persistentDataRef = useRef({
    cash: 0,
    portfolio: 0,
    total: 0,
    assets: 0
  });

  const {
    isConnected: wsConnected,
    usdBalance: wsUsdBalance,
    totalPortfolioValue: wsTotalValue,
    balances: wsBalances,
    totalAssets: wsTotalAssets,
    lastUpdated: wsLastUpdated,
    refresh: wsRefresh,
    prices: wsPrices
  } = useRealtimeKrakenData({
    subscribeToPrices: true,
    priceSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD'],
    subscribeToBalances: !isSimMode,
    subscribeToOrders: false,
    subscribeToExecutions: true,
    isSimMode
  });

  // CRITICAL: Auto-sync on first WebSocket connection (only once per session)
  useEffect(() => {
    if (!isSimMode && wsConnected && !hasAutoSynced) {
      const sessionKey = 'kraken_auto_synced';
      const alreadySynced = sessionStorage.getItem(sessionKey);
      
      if (!alreadySynced) {
        console.log('[WalletBalance] 🔄 Auto-syncing on WebSocket connection...');
        
        // Small delay to ensure WebSocket is fully ready
        setTimeout(async () => {
          try {
            const syncRes = await base44.functions.invoke('syncKrakenBalance', {});
            const syncData = syncRes?.data || syncRes;
            
            if (syncData?.success) {
              console.log('[WalletBalance] ✅ Auto-sync complete');
              
              // Update persistent ref
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

  // CRITICAL: Calculate display values and PERSIST them
  const displayCash = React.useMemo(() => {
    let value;
    
    if (isSimMode) {
      value = wallet?.cash_balance || 0;
    } else {
      const krakenUSD = wsUsdBalance || 0;
      const dbCash = wallet?.real_cash_balance || 0;
      value = wsConnected && krakenUSD >= 0 ? krakenUSD : dbCash;
    }
    
    // CRITICAL: Only update if value is valid (non-zero or first load)
    if (value > 0 || persistentDataRef.current.cash === 0) {
      persistentDataRef.current.cash = value;
    }
    
    return persistentDataRef.current.cash;
  }, [isSimMode, wallet, wsUsdBalance, wsConnected]);

  const displayPortfolioValue = React.useMemo(() => {
    let value;
    
    if (isSimMode) {
      value = portfolioMarketValue;
    } else {
      const wsPortfolio = wsTotalValue - (wsUsdBalance || 0);
      value = wsConnected && wsPortfolio >= 0 ? wsPortfolio : portfolioMarketValue;
    }
    
    // CRITICAL: Only update if value is valid
    if (value > 0 || persistentDataRef.current.portfolio === 0) {
      persistentDataRef.current.portfolio = value;
    }
    
    return persistentDataRef.current.portfolio;
  }, [isSimMode, wsTotalValue, portfolioMarketValue, wsConnected, wsUsdBalance]);

  const totalBalance = displayCash + displayPortfolioValue;
  
  // CRITICAL: Persist total and assets
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
        // CRITICAL: Update persistent ref BEFORE showing toast
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

  // CRITICAL: Only show sync button when NOT connected or there's an error
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
              <div className="flex items-center gap-2">
                <Badge className="bg-green-100 text-green-800 text-xs">Live</Badge>
                {wsConnected ? (
                  <Badge variant="outline" className="text-xs flex items-center gap-1 bg-green-50 text-green-700 border-green-200">
                    <Wifi className="w-3 h-3" />
                    Connected 24/7
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs flex items-center gap-1 bg-yellow-50 text-yellow-700 border-yellow-200">
                    <WifiOff className="w-3 h-3" />
                    Connecting...
                  </Badge>
                )}
              </div>
            )}
          </div >
          <Button variant="ghost" size="icon" onClick={() => setIsVisible(!isVisible)} className="h-8 w-8">
            {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        </div >
      </CardHeader >
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

        <div>
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Total Balance</p>
          {isVisible ? (
            <>
              <NumberDisplay
                value={totalBalance}
                prefix="$"
                decimals={2}
                className="neon-text"
                maxFontSize={36}
                minFontSize={20}
              />
              {!isSimMode && wsConnected && totalBalance > 0 && (
                <p className="text-xs mt-1 text-green-600 dark:text-green-400">
                  ✅ Live via WebSocket (No sync needed)
                </p>
              )}
            </>
          ) : (
            <p className="text-3xl font-bold neon-text">••••••</p>
          )}
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

        <div className="grid grid-cols-2 gap-4 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Available Cash</p>
            {isVisible ? (
              <div>
                <NumberDisplay value={displayCash} prefix="$" decimals={2} maxFontSize={20} minFontSize={14} />
                {!isSimMode && wsConnected && displayCash > 0 && (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">✅ Live USD</p>
                )}
              </div>
            ) : (
              <p className="text-lg font-semibold">••••••</p>
            )}
          </div>
          <div>
            <p className="text-xs mb-1 flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
              Portfolio Value
              {!isSimMode && wsConnected && displayPortfolioValue > 0 && (
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              )}
            </p>
            {isVisible ? (
              <div>
                <NumberDisplay value={displayPortfolioValue} prefix="$" decimals={2} maxFontSize={20} minFontSize={14} />
                {!isSimMode && wsConnected && totalAssets > 0 && (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                    ✅ {totalAssets} asset{totalAssets !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-lg font-semibold">••••••</p>
            )}
          </div>
        </div>

        {/* NEW: Holdings Breakdown Grid */}
        {holdings && holdings.length > 0 && (
          <div className="pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Your Holdings</p>
            <div className="grid grid-cols-1 gap-2">
              {holdings.slice(0, 3).map((holding) => {
                const symbol = holding.symbol;
                const pair = `${symbol}/USD`;
                const priceData = (isSimMode ? prices : wsPrices)[pair] || {};
                const currentPrice = priceData.price || holding.currentPrice || 0;
                const change24h = priceData.change_24h || 0;
                const quantity = holding.quantity || 0;
                const currentValue = quantity * currentPrice;

                return (
                  <div key={symbol} className="p-2 rounded-lg border" style={{ 
                    backgroundColor: 'var(--secondary-bg)',
                    borderColor: 'var(--border-color)'
                  }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-xs" style={{ color: 'var(--text-primary)' }}>{symbol}</span>
                      <span className={`text-xs ${change24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-xs">
                      <div>
                        <p style={{ color: 'var(--text-secondary)' }}>Price</p>
                        <p className="font-medium" style={{ color: 'var(--text-primary)' }}>${currentPrice.toFixed(2)}</p>
                      </div>
                      <div>
                        <p style={{ color: 'var(--text-secondary)' }}>Holdings</p>
                        <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{quantity.toFixed(4)}</p>
                      </div>
                      <div>
                        <p style={{ color: 'var(--text-secondary)' }}>Value</p>
                        <p className="font-medium neon-text">${currentValue.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {holdings.length > 3 && (
              <p className="text-xs text-center mt-2" style={{ color: 'var(--text-secondary)' }}>
                +{holdings.length - 3} more asset{holdings.length - 3 !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <div className="text-center">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total Deposits</p>
            {isVisible ? (
              <NumberDisplay value={totalDeposits} prefix="$" decimals={2} maxFontSize={16} minFontSize={12} />
            ) : (
              <p className="text-sm font-medium">••••</p>
            )}
          </div>
          <div className="text-center">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total Withdrawals</p>
            {isVisible ? (
              <NumberDisplay value={totalWithdrawals} prefix="$" decimals={2} maxFontSize={16} minFontSize={12} />
            ) : (
              <p className="text-sm font-medium">••••</p>
            )}
          </div>
          <div className="text-center">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Net Flow</p>
            {isVisible ? (
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
