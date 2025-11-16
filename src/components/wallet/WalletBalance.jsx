import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, Wallet, Activity, RefreshCw, Loader2, Wifi, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useRealtimeKrakenData } from "@/components/hooks/useRealtimeKrakenData";
import NumberDisplay from "@/components/ui/NumberDisplay";

export default function WalletBalance({ wallet, isSimMode, portfolioMarketValue, onSyncComplete }) {
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const hasAutoSyncedRef = useRef(false);

  const { 
    isConnected: wsConnected,
    loading: wsLoading,
    usdBalance: wsUsdBalance,
    totalPortfolioValue: wsTotalValue,
    totalAssets: wsTotalAssets,
    refresh: wsRefresh
  } = useRealtimeKrakenData({
    subscribeToPrices: true,
    priceSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD'],
    subscribeToBalances: !isSimMode,
    subscribeToOrders: false,
    isSimMode
  });

  // CRITICAL: Calculate display values from WebSocket
  const displayCash = React.useMemo(() => {
    if (isSimMode) {
      return wallet?.cash_balance || 0;
    }
    // LIVE: Use WebSocket cash
    return (wsConnected && typeof wsUsdBalance === 'number') ? wsUsdBalance : (wallet?.real_cash_balance || 0);
  }, [isSimMode, wallet, wsConnected, wsUsdBalance]);

  const displayPortfolio = React.useMemo(() => {
    if (isSimMode) {
      return portfolioMarketValue || 0;
    }
    // LIVE: Calculate from WebSocket
    if (wsConnected && typeof wsTotalValue === 'number' && typeof wsUsdBalance === 'number') {
      return Math.max(0, wsTotalValue - wsUsdBalance);
    }
    return portfolioMarketValue || 0;
  }, [isSimMode, portfolioMarketValue, wsConnected, wsTotalValue, wsUsdBalance]);

  const totalBalance = displayCash + displayPortfolio;

  // Auto-sync on first WebSocket connection
  useEffect(() => {
    if (!isSimMode && wsConnected && !hasAutoSyncedRef.current && !isSyncing) {
      hasAutoSyncedRef.current = true;
      console.log('[WalletBalance] 🚀 Auto-syncing on WebSocket connection');
      handleManualSync();
    }
  }, [wsConnected, isSimMode]);

  const handleManualSync = async () => {
    if (isSyncing) return;
    
    setIsSyncing(true);
    const toastId = toast.loading(!isSimMode ? 'Syncing with Kraken...' : 'Repairing wallet...');
    
    try {
      if (!isSimMode) {
        // LIVE: Sync with Kraken
        await base44.functions.invoke('syncKrakenBalance');
        wsRefresh(); // Trigger WebSocket refresh
        toast.success('✅ Synced with Kraken', { id: toastId });
      } else {
        // SIM: Repair wallet
        await base44.functions.invoke('reconcileWallet', { mode: 'sim' });
        toast.success('✅ Wallet repaired', { id: toastId });
      }
      
      if (onSyncComplete) {
        onSyncComplete();
      }
    } catch (error) {
      console.error('[WalletBalance] Sync error:', error);
      toast.error('Sync failed. Please try again.', { id: toastId });
    } finally {
      setIsSyncing(false);
    }
  };

  const showLoading = !isSimMode && wsLoading && totalBalance === 0;

  return (
    <Card className="border-2 neon-glow" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--neon-green)' }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Wallet Balance
            </CardTitle>
            {!isSimMode && (
              <Badge className="bg-green-100 text-green-800 text-xs flex items-center gap-1">
                {wsConnected ? <Wifi className="w-3 h-3" /> : <Loader2 className="w-3 h-3 animate-spin" />}
                Live
              </Badge>
            )}
            {isSimMode && <Badge variant="outline" className="text-xs">Demo</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualSync}
              disabled={isSyncing || showLoading}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSimMode ? 'Repair' : 'Sync'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setBalanceVisible(!balanceVisible)}
            >
              {balanceVisible ? (
                <EyeOff className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
              ) : (
                <Eye className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center py-2">
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>Total Balance</p>
          {showLoading ? (
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-green-500" />
              <span className="text-lg text-gray-500">Loading balance...</span>
            </div>
          ) : balanceVisible ? (
            <>
              <NumberDisplay
                value={totalBalance}
                prefix="$"
                decimals={2}
                className="neon-text max-w-full"
                maxFontSize={40}
                minFontSize={20}
              />
              {!isSimMode && wsConnected && wsTotalAssets > 0 && (
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                  ✅ Connected • {wsTotalAssets} asset{wsTotalAssets !== 1 ? 's' : ''}
                </p>
              )}
            </>
          ) : (
            <p className="text-4xl font-bold neon-text">••••••</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4" style={{ color: 'var(--neon-green)' }} />
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Available Cash</p>
            </div>
            {balanceVisible ? (
              <p className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                ${displayCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            ) : (
              <p className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>••••••</p>
            )}
          </div>

          <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4" style={{ color: 'var(--neon-green)' }} />
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Portfolio Value</p>
            </div>
            {balanceVisible ? (
              <p className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                ${displayPortfolio.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            ) : (
              <p className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>••••••</p>
            )}
          </div>
        </div>

        {isSimMode && (
          <div className="grid grid-cols-2 gap-4 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <div className="text-center">
              <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total Deposits</p>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                ${(wallet?.total_deposits || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total Withdrawals</p>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                ${(wallet?.total_withdrawals || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        )}

        {!isSimMode && (
          <div className="text-center pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Net Flow
            </p>
            <p className="text-lg font-semibold neon-text">
              +${((wallet?.real_total_deposits || 0) - (wallet?.real_total_withdrawals || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}