import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, RefreshCw, Wallet, Activity, Loader2, Wifi } from "lucide-react";
import { useRealtimeKrakenData } from "@/components/hooks/useRealtimeKrakenData";

export default function PortfolioSummary({ 
  wallet, 
  trades, 
  currentPortfolioValue,
  isLoading, 
  isSimMode,
  change24hr,
  lifetimeChange,
  onSyncClick,
  krakenData
}) {
  const { 
    isConnected: wsConnected,
    loading: wsLoading,
    usdBalance: wsUsdBalance,
    totalPortfolioValue: wsTotalValue,
    totalAssets: wsTotalAssets
  } = useRealtimeKrakenData({
    subscribeToPrices: true,
    priceSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD'],
    subscribeToBalances: !isSimMode,
    subscribeToOrders: false,
    isSimMode
  });

  // CRITICAL: Use WebSocket data in LIVE mode
  const displayCash = React.useMemo(() => {
    if (isSimMode) {
      return wallet?.cash_balance || 0;
    }
    // LIVE: Use WebSocket cash balance
    return (wsConnected && typeof wsUsdBalance === 'number') ? wsUsdBalance : (wallet?.real_cash_balance || 0);
  }, [isSimMode, wallet, wsConnected, wsUsdBalance]);

  const displayAssets = React.useMemo(() => {
    if (isSimMode) {
      return currentPortfolioValue || 0;
    }
    // LIVE: Calculate from WebSocket total - cash
    if (wsConnected && typeof wsTotalValue === 'number' && typeof wsUsdBalance === 'number') {
      return Math.max(0, wsTotalValue - wsUsdBalance);
    }
    return currentPortfolioValue || 0;
  }, [isSimMode, currentPortfolioValue, wsConnected, wsTotalValue, wsUsdBalance]);

  const totalValue = displayCash + displayAssets;

  const is24hrPositive = (change24hr?.value || 0) >= 0;
  const isLifetimePositive = (lifetimeChange?.value || 0) >= 0;

  const showLoading = isLoading || (!isSimMode && wsLoading);

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }} className="border-2">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          Portfolio Summary
          {!isSimMode && (
            <Badge className="bg-green-100 text-green-800 text-xs flex items-center gap-1">
              {wsConnected ? <Wifi className="w-3 h-3" /> : <Loader2 className="w-3 h-3 animate-spin" />}
              Live Mode
            </Badge>
          )}
          {isSimMode && <Badge variant="outline" className="text-xs">Demo Mode</Badge>}
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={onSyncClick}
          disabled={showLoading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${showLoading ? 'animate-spin' : ''}`} />
          {isSimMode ? 'Repair' : 'Sync'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center py-4">
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
            Total Portfolio Value
          </p>
          {showLoading && totalValue === 0 ? (
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-green-500" />
              <span className="text-lg text-gray-500">Loading...</span>
            </div>
          ) : (
            <h2 className="text-4xl font-bold neon-text mb-1">
              ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h2>
          )}
          {!isSimMode && wsConnected && wsTotalAssets > 0 && (
            <p className="text-xs text-green-600 dark:text-green-400">
              ✅ Connected • {wsTotalAssets} asset{wsTotalAssets !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <div className="p-2 rounded-full" style={{ backgroundColor: 'var(--primary-bg)' }}>
              <Wallet className="w-5 h-5" style={{ color: 'var(--neon-green)' }} />
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Cash</p>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                ${displayCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <div className="p-2 rounded-full" style={{ backgroundColor: 'var(--primary-bg)' }}>
              <Activity className="w-5 h-5" style={{ color: 'var(--neon-green)' }} />
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Assets Value</p>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                ${displayAssets.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2">
          <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <div className="flex items-center justify-center gap-1 mb-1">
              {is24hrPositive ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
              <span className={`text-sm font-medium ${is24hrPositive ? 'text-green-500' : 'text-red-500'}`}>
                {is24hrPositive ? '+' : '-'}$
                {Math.abs(change24hr?.value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <p className={`text-xs font-medium ${is24hrPositive ? 'text-green-500' : 'text-red-500'}`}>
              {is24hrPositive ? '+' : ''}{(change24hr?.percentage || 0).toFixed(2)}%
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>24h {!isSimMode ? '(Kraken)' : ''}</p>
          </div>

          <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <div className="flex items-center justify-center gap-1 mb-1">
              {isLifetimePositive ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
              <span className={`text-sm font-medium ${isLifetimePositive ? 'text-green-500' : 'text-red-500'}`}>
                {isLifetimePositive ? '+' : '-'}$
                {Math.abs(lifetimeChange?.value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <p className={`text-xs font-medium ${isLifetimePositive ? 'text-green-500' : 'text-red-500'}`}>
              {isLifetimePositive ? '+' : ''}{(lifetimeChange?.percentage || 0).toFixed(2)}%
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Lifetime {!isSimMode ? '(Kraken)' : ''}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}