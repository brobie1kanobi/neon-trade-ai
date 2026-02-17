import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import NumberDisplay from "@/components/ui/NumberDisplay";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { useKrakenWebSocket } from "@/components/providers/KrakenWebSocketProvider";

export default function PortfolioSummary({ wallet, trades, currentPortfolioValue, isLoading, isSimMode = true, change24hr, lifetimeChange, onSyncClick, krakenData }) {
  // CRITICAL: Use global WebSocket connection for real-time Kraken data
  const {
    isConnected: wsConnected,
    usdBalance: wsUsdBalance,
    cryptoHoldingsValue: wsCryptoValue,
    totalPortfolioValue: wsTotalValue,
    refresh: refreshWebSocket
  } = useKrakenWebSocket();

  // CRITICAL: Refresh data when trades complete
  React.useEffect(() => {
    const handleTradeCompleted = () => {
      console.log('[PortfolioSummary] Trade completed, refreshing WebSocket data');
      if (!isSimMode && refreshWebSocket) {
        refreshWebSocket();
      }
    };

    window.addEventListener('trade:completed', handleTradeCompleted);
    window.addEventListener('kraken:synced', handleTradeCompleted);

    return () => {
      window.removeEventListener('trade:completed', handleTradeCompleted);
      window.removeEventListener('kraken:synced', handleTradeCompleted);
    };
  }, [isSimMode, refreshWebSocket]);

  // CRITICAL: In LIVE mode, prioritize krakenData prop (REST API data) > WebSocket > wallet DB
  // REST API is the most reliable source - it returns accurate prices + cost basis
  // WebSocket only has raw quantities without accurate USD valuations
  const currentCashBalance = React.useMemo(() => {
    if (isSimMode) {
      return wallet?.cash_balance || 0;
    }
    // LIVE MODE: krakenData prop first (REST API is authoritative)
    if (krakenData?.success && typeof krakenData?.usd_balance === 'number') {
      return krakenData.usd_balance;
    }
    // WebSocket fallback
    if (wsConnected && wsUsdBalance > 0) {
      return wsUsdBalance;
    }
    return wallet?.real_cash_balance || 0;
  }, [isSimMode, wallet, wsConnected, wsUsdBalance, krakenData]);

  // CRITICAL: Portfolio value = crypto holdings only (not including cash)
  // REST API is authoritative - it returns actual prices from Kraken
  const effectivePortfolioValue = React.useMemo(() => {
    if (isSimMode) {
      return currentPortfolioValue || 0;
    }
    // LIVE MODE: krakenData prop first (REST API is authoritative)
    if (krakenData?.success && krakenData?.total_crypto_value_usd > 0) {
      return krakenData.total_crypto_value_usd;
    }
    if (krakenData?.success && krakenData?.total_crypto_value > 0) {
      return krakenData.total_crypto_value;
    }
    // WebSocket fallback
    if (wsConnected && wsCryptoValue > 0) {
      return wsCryptoValue;
    }
    return currentPortfolioValue || 0;
  }, [isSimMode, currentPortfolioValue, wsConnected, wsCryptoValue, krakenData]);

  const totalValue = currentCashBalance + effectivePortfolioValue;

  const displayChange = change24hr || { value: 0, percentage: 0 };
  const isPositive = displayChange.value >= 0;
  const lifetime = lifetimeChange || { value: 0, percentage: 0 };
  const isLifetimePositive = lifetime.value >= 0;

  // Sync handler - refreshes holdings and balances
  const [isSyncing, setIsSyncing] = React.useState(false);

  const handleSync = async () => {
    if (isSyncing) return;

    setIsSyncing(true);
    try {
      if (isSimMode) {
        // SIM MODE: Repair portfolio data
        await base44.functions.invoke('repairMyPortfolio', {});
      } else {
        // LIVE MODE: Sync from Kraken
        const syncRes = await base44.functions.invoke('syncKrakenBalance', {});
        const syncData = syncRes?.data || syncRes;

        if (!syncData?.success) {
          throw new Error(syncData?.error || 'Sync failed');
        }

        // Dispatch sync event for WebSocket refresh
        window.dispatchEvent(new CustomEvent('kraken:synced', {
          detail: { holdings: syncData.holdings, usdBalance: syncData.usdBalance }
        }));
      }

      // Broadcast data update
      window.dispatchEvent(new CustomEvent('app:data-updated', {
        detail: { type: 'sync', source: 'portfolio_summary' }
      }));

      // Refresh page after brief delay
      setTimeout(() => {
        window.location.href = window.location.pathname + '?t=' + Date.now();
      }, 500);

    } catch (error) {
      console.error('[PortfolioSummary] Sync error:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const onClick = onSyncClick || handleSync;

  return (
    <Card className="border-2 neon-glow" style={{
      backgroundColor: 'var(--card-bg)',
      borderColor: 'var(--neon-green)'
    }}>
      <CardContent className="p-6">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Portfolio Summary
            </h2>
            {isSimMode &&
            <Badge variant="outline" className="text-xs">
                Demo Mode
              </Badge>
            }
            {!isSimMode &&
            <div className="flex items-center gap-2">
                


                {wsConnected &&
              <Badge variant="outline" className="text-xs flex items-center gap-1 bg-green-50 text-green-700 border-green-200">
                    <Wifi className="w-3 h-3" />
                    Live
                  </Badge>
              }
              </div>
            }
          </div>
          
          <div>
            <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              Total Portfolio Value
            </p>
            {/* Show immediately; don't block on isLoading */}
            <NumberDisplay
              value={totalValue}
              prefix="$"
              decimals={2}
              className="mx-auto max-w-[min(90vw,420px)]"
              maxFontSize={40}
              minFontSize={18}
              // New: colorize by lifetime PnL sign (green profit, red loss)
              tone={lifetime.value === 0 ? 'neutral' : isLifetimePositive ? 'positive' : 'negative'} />

          </div>
          
          <div className="flex items-center justify-center gap-6 flex-wrap">
            <div className="text-center min-w-[120px]">
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Cash</p>
              <NumberDisplay
                value={currentCashBalance}
                prefix="$"
                decimals={2}
                className="mx-auto max-w-[160px]"
                maxFontSize={20}
                minFontSize={12} />

              {!isSimMode && wsConnected && currentCashBalance > 0 &&
              <p className="text-xs text-green-500 mt-0.5">✅ Live</p>
              }
            </div>
            <div className="text-center min-w-[140px]">
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Assets Value</p>

              <NumberDisplay
                value={effectivePortfolioValue}
                prefix="$"
                decimals={2}
                className="mx-auto max-w-[180px]"
                maxFontSize={20}
                minFontSize={12} />

              {!isSimMode && wsConnected && effectivePortfolioValue > 0 &&
              <p className="text-xs text-green-500 mt-0.5">✅ Live</p>
              }
            </div>
          </div>

          <div className="flex flex-col items-center gap-2 pt-2">
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {isPositive ?
              <TrendingUp className="w-4 h-4 text-green-500" /> :

              <TrendingDown className="w-4 h-4 text-red-500" />
              }
              <span className={`text-sm font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                {isPositive ? '+' : ''}${displayChange.value.toFixed(2)} ({displayChange.percentage.toFixed(1)}%)
              </span>
              <span className="text-xs text-gray-500">24h</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-center">
              {isLifetimePositive ?
              <TrendingUp className="w-4 h-4 text-green-500" /> :

              <TrendingDown className="w-4 h-4 text-red-500" />
              }
              <span className={`text-sm font-medium ${isLifetimePositive ? 'text-green-500' : 'text-red-500'}`}>
                {isLifetimePositive ? '+' : ''}${lifetime.value.toFixed(2)} ({lifetime.percentage.toFixed(1)}%)
              </span>
              <span className="text-xs text-gray-500">Lifetime</span>
            </div>
          </div>
        </div>

        {/* Persistent sync button at bottom */}
        <div className="pt-4">
          <Button
            onClick={onClick}
            disabled={isSyncing}
            className="w-full neon-glow bg-green-600 hover:bg-green-700">

            {isSyncing ? 'Syncing...' : isSimMode ? 'Sync Portfolio Data' : 'Sync Kraken Balance'}
          </Button>
        </div>
      </CardContent>
    </Card>);

}