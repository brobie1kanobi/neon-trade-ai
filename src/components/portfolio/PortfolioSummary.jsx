import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import NumberDisplay from "@/components/ui/NumberDisplay";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { useRealtimeKrakenData } from "@/components/hooks/useRealtimeKrakenData";
import { useSettings } from "@/components/utils/SettingsContext";
import { useKrakenPnL } from "@/components/hooks/useKrakenPnL";

export default function PortfolioSummary({ wallet, trades, currentPortfolioValue, isLoading, change24hr, lifetimeChange, onSyncClick }) {
  const { settings } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  const { 
    isConnected: wsConnected, 
    usdBalance: wsUsdBalance,
    totalAssets: wsTotalAssets
  } = useRealtimeKrakenData({
    subscribeToPrices: true,
    priceSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD'],
    subscribeToBalances: !isSimMode,
    subscribeToOrders: !isSimMode,
    isSimMode
  });

  const { pnlData } = useKrakenPnL(isSimMode);

  // CRITICAL: Use direct calculation from parent (like AssetAllocation)
  const currentCashBalance = React.useMemo(() => {
    if (isSimMode) {
      return wallet?.cash_balance || 0;
    }
    return wsConnected && wsUsdBalance >= 0 ? wsUsdBalance : (wallet?.real_cash_balance || 0);
  }, [isSimMode, wallet, wsConnected, wsUsdBalance]);

  // CRITICAL: Use passed portfolio value from parent calculation
  const displayPortfolioValue = currentPortfolioValue || 0;

  const totalValue = currentCashBalance + displayPortfolioValue;
  
  const displayChange = {
    value: pnlData.pnl_24h || 0,
    percentage: totalValue > 0 ? (pnlData.pnl_24h / totalValue * 100) : 0
  };

  const lifetime = {
    value: pnlData.pnl_lifetime || 0,
    percentage: totalValue > 0 ? (pnlData.pnl_lifetime / totalValue * 100) : 0
  };

  const isPositive = displayChange.value >= 0;
  const isLifetimePositive = lifetime.value >= 0;

  const [isRepairing, setIsRepairing] = React.useState(false);
  const handleRepair = async () => {
    try {
      setIsRepairing(true);
      const res = await base44.functions.invoke('repairMyPortfolio', {});
      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { type: 'repair', source: 'portfolio_summary' } }));
      setTimeout(() => window.location.reload(), 800);
      return res;
    } finally {
      setIsRepairing(false);
    }
  };
  const onClick = onSyncClick || handleRepair;

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
            {isSimMode && (
              <Badge variant="outline" className="text-xs">
                Demo Mode
              </Badge>
            )}
            {!isSimMode && (
              <Badge className="bg-green-100 text-green-800 text-xs flex items-center gap-1">
                {wsConnected && <Wifi className="w-3 h-3" />}
                Live Mode
              </Badge>
            )}
          </div>
          
          <div>
            <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              Total Portfolio Value
            </p>
            <NumberDisplay
              value={totalValue}
              prefix="$"
              decimals={2}
              className="mx-auto max-w-[min(90vw,420px)]"
              maxFontSize={40}
              minFontSize={18}
              tone={lifetime.value === 0 ? 'neutral' : (isLifetimePositive ? 'positive' : 'negative')}
            />
            {!isSimMode && wsConnected && wsTotalAssets > 0 && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                ✅ Live WebSocket • {wsTotalAssets} asset{wsTotalAssets !== 1 ? 's' : ''}
              </p>
            )}
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
                minFontSize={12}
              />
            </div>
            <div className="text-center min-w-[140px]">
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Assets Value</p>
              <NumberDisplay
                value={displayPortfolioValue}
                prefix="$"
                decimals={2}
                className="mx-auto max-w-[180px]"
                maxFontSize={20}
                minFontSize={12}
              />
            </div>
          </div>

          <div className="flex flex-col items-center gap-2 pt-2">
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {isPositive ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
              <span className={`text-sm font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                {isPositive ? '+' : ''}${displayChange.value.toFixed(2)} ({displayChange.percentage.toFixed(1)}%)
              </span>
              <span className="text-xs text-gray-500">24h (Kraken)</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-center">
              {isLifetimePositive ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
              <span className={`text-sm font-medium ${isLifetimePositive ? 'text-green-500' : 'text-red-500'}`}>
                {isLifetimePositive ? '+' : ''}${lifetime.value.toFixed(2)} ({lifetime.percentage.toFixed(1)}%)
              </span>
              <span className="text-xs text-gray-500">Lifetime (Kraken)</span>
            </div>
          </div>
        </div>

        <div className="pt-4">
          <Button
            onClick={onClick}
            disabled={isRepairing}
            className="w-full neon-glow bg-green-600 hover:bg-green-700"
          >
            {isRepairing ? 'Syncing...' : 'Sync Portfolio Data'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}