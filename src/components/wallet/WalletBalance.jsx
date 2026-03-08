import React, { useState } from "react";
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
import { useKrakenWebSocket } from "@/components/providers/KrakenWebSocketProvider";

export default function WalletBalance({ wallet, isSimMode, portfolioMarketValue = 0, cashBalance = 0, isLoading = false, onSyncComplete }) {
  const { settings } = useSettings();
  const [isVisible, setIsVisible] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  // Use the SHARED provider (single source of truth, already merges WS > REST)
  const {
    isConnected: wsConnectedFromProvider,
    usdBalance: wsUsdBalance,
    cryptoHoldingsValue: wsCryptoHoldingsValue,
    totalAssets: wsTotalAssets,
    hasData: providerHasData,
    refresh: wsRefresh,
    krakenBalance
  } = useKrakenWebSocket();

  // CRITICAL: Also check global window state - provider React state can be stale
  const wsConnected = wsConnectedFromProvider || (typeof window !== 'undefined' && window.__krakenWsConnected);

  // CRITICAL: In LIVE mode, ONLY show WebSocket balances - never fall back to stale cached data
  // This prevents blips of old data showing during refreshes
  const displayCash = isSimMode 
    ? (wallet?.cash_balance || 0) 
    : ((krakenBalance?.success && typeof krakenBalance.usd_balance === 'number')
        ? krakenBalance.usd_balance
        : (wsUsdBalance > 0 ? wsUsdBalance : 0));
  const displayPortfolioValue = isSimMode 
    ? portfolioMarketValue 
    : ((krakenBalance?.success && (krakenBalance.total_crypto_value_usd !== undefined || krakenBalance.total_crypto_value !== undefined))
        ? (krakenBalance.total_crypto_value_usd ?? krakenBalance.total_crypto_value)
        : (wsCryptoHoldingsValue > 0 ? wsCryptoHoldingsValue : 0));
  const totalBalance = displayCash + displayPortfolioValue;
  const totalAssets = isSimMode ? 0 : wsTotalAssets;

  const totalDeposits = isSimMode ? wallet?.total_deposits || 0 : wallet?.real_total_deposits || 0;
  const totalWithdrawals = isSimMode ? wallet?.total_withdrawals || 0 : wallet?.real_total_withdrawals || 0;
  const netFlow = totalDeposits - totalWithdrawals;

  const handleKrakenSync = async () => {
    if (isSimMode) return;

    setIsSyncing(true);
    setSyncError(null);

    const syncTimeout = setTimeout(() => {
      setIsSyncing(false);
      // Do not block UI on timeout; rely on WebSocket to continue updating
      setSyncError(null);
      toast.info('Kraken is responding slowly. Live WebSocket will keep updating.');
      try { wsRefresh(); } catch (_) {}
    }, 30000);

    try {
      toast.info('Syncing Kraken...', { duration: 2000 });

      const syncRes = await base44.functions.invoke('syncKrakenBalance', {});
      const syncData = syncRes?.data || syncRes;

      clearTimeout(syncTimeout);

      if (syncData?.success) {
        toast.success('✅ Kraken synced!', {
          description: `$${syncData.usdBalance?.toFixed(2)} USD, ${syncData.holdings?.length || 0} assets`,
          duration: 3000
        });

        invalidateCache();
        invalidatePriceCache();

        await new Promise((resolve) => setTimeout(resolve, 200));

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
      const errMsg = error?.message || 'Unknown error';
      const isTimeout = /timeout/i.test(errMsg);
      if (isTimeout) {
        setSyncError(null); // don't scare users; WS continues updating
        toast.info('Using live WebSocket balances while Kraken REST is slow');
      } else {
        setSyncError(`Failed to fetch balance: ${errMsg}`);
        toast.error('Sync failed', { description: errMsg });
      }
      try { wsRefresh(); } catch (_) {}
    } finally {
      try { wsRefresh(); } catch (_) {}
      setIsSyncing(false);
    }
  };

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
                    WebSocket
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs flex items-center gap-1 bg-yellow-50 text-yellow-700 border-yellow-200">
                    <WifiOff className="w-3 h-3" />
                    Connecting...
                  </Badge>
                )}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={() => setIsVisible(!isVisible)} className="h-8 w-8">
            {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!isSimMode && wsConnected && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-600" />
              <div>
                <p className="text-xs font-semibold text-green-700 dark:text-green-400">Real-Time WebSocket</p>
                <p className="text-xs text-green-600 dark:text-green-500">
                  {totalAssets} asset{totalAssets !== 1 ? 's' : ''} found • Live
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
            <NumberDisplay
              value={totalBalance}
              prefix="$"
              decimals={2}
              className="neon-text"
              maxFontSize={36}
              minFontSize={20}
            />
          ) : (
            <p className="text-3xl font-bold neon-text">••••••</p>
          )}
          {!isSimMode && wsConnected && totalBalance > 0 && (
            <p className="text-xs mt-1 text-green-600 dark:text-green-400">
              ✅ Live via WebSocket
            </p>
          )}
        </div>

        {!isSimMode && !wsConnected && (
          <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">Connecting to Kraken...</p>
                <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-1">
                  WebSocket establishing real-time connection
                </p>
              </div>
            </div>
          </div>
        )}

        {!isSimMode && (
          <div className="pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
            {syncError && (
              <div className="mb-3 p-2 rounded bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{syncError}</span>
              </div>
            )}
            <Button
              onClick={handleKrakenSync}
              disabled={isSyncing}
              className="w-full bg-purple-600 hover:bg-purple-700"
              size="sm"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Sync Kraken (One-Time)'}
            </Button>
            <p className="text-xs text-center mt-2" style={{ color: 'var(--text-secondary)' }}>
              {wsConnected ? '🟢 WebSocket auto-updates • Use sync to force refresh' : 'Connect & import from Kraken'}
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