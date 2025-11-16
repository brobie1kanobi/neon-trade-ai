
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

export default function PortfolioSummary({ wallet, trades, currentPortfolioValue, isLoading, change24hr, lifetimeChange, onSyncClick, holdings = [], prices = {} }) {
  const { settings } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  const { 
    isConnected: wsConnected, 
    usdBalance: wsUsdBalance,
    totalPortfolioValue: wsTotalValue,
    totalAssets: wsTotalAssets,
    balances: wsBalances,
    prices: wsPrices
  } = useRealtimeKrakenData({
    subscribeToPrices: true,
    priceSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD'],
    subscribeToBalances: !isSimMode,
    subscribeToOrders: !isSimMode,
    isSimMode
  });

  const { pnlData } = useKrakenPnL(isSimMode);

  const currentCashBalance = React.useMemo(() => {
    if (isSimMode) {
      return wallet?.cash_balance || 0;
    }
    return wsConnected && wsUsdBalance >= 0 ? wsUsdBalance : (wallet?.real_cash_balance || 0);
  }, [isSimMode, wallet, wsConnected, wsUsdBalance]);

  const displayPortfolioValue = React.useMemo(() => {
    if (isSimMode) {
      return currentPortfolioValue || 0;
    }
    const portfolioOnly = wsTotalValue - (wsConnected && wsUsdBalance >= 0 ? wsUsdBalance : 0);
    return portfolioOnly;
  }, [isSimMode, currentPortfolioValue, wsTotalValue, wsConnected, wsUsdBalance]);

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

          {/* NEW: Holdings Breakdown Grid */}
          {holdings && holdings.length > 0 && (
            <div className="pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Your Holdings</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {holdings.slice(0, 4).map((holding) => {
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
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        <div>
                          <p style={{ color: 'var(--text-secondary)' }}>Price</p>
                          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>${currentPrice.toFixed(2)}</p>
                        </div>
                        <div>
                          <p style={{ color: 'var(--text-secondary)' }}>Value</p>
                          <p className="font-medium neon-text">${currentValue.toFixed(2)}</p>
                        </div>
                      </div>
                      <div className="mt-1 pt-1 border-t" style={{ borderColor: 'var(--border-color)' }}>
                        <p style={{ color: 'var(--text-secondary)' }}>Holdings</p>
                        <p className="font-medium text-xs" style={{ color: 'var(--text-primary)' }}>{quantity.toFixed(6)} {symbol}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {holdings.length > 4 && (
                <p className="text-xs text-center mt-2" style={{ color: 'var(--text-secondary)' }}>
                  +{holdings.length - 4} more asset{holdings.length - 4 !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}

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
