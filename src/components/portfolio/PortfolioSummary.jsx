
import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import NumberDisplay from "@/components/ui/NumberDisplay";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

export default function PortfolioSummary({ wallet, trades, currentPortfolioValue, isLoading, isSimMode = true, change24hr, lifetimeChange, onSyncClick }) {
  const currentCashBalance = isSimMode ? (wallet?.cash_balance || 0) : (wallet?.real_cash_balance || 0);
  const totalValue = currentCashBalance + (currentPortfolioValue || 0);
  
  const displayChange = change24hr || { value: 0, percentage: 0 };
  const isPositive = displayChange.value >= 0;
  const lifetime = lifetimeChange || { value: 0, percentage: 0 };
  const isLifetimePositive = lifetime.value >= 0;

  // Fallback repair handler (user-only) if onSyncClick not provided by the page
  const [isRepairing, setIsRepairing] = React.useState(false);
  const handleRepair = async () => {
    try {
      setIsRepairing(true);
      const res = await base44.functions.invoke('repairMyPortfolio', {});
      // Broadcast and soft refresh
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
              <Badge className="bg-green-100 text-green-800 text-xs">
                Live Mode
              </Badge>
            )}
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
              tone={lifetime.value === 0 ? 'neutral' : (isLifetimePositive ? 'positive' : 'negative')}
            />
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
                value={currentPortfolioValue || 0}
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
              <span className="text-xs text-gray-500">24h</span>
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
              <span className="text-xs text-gray-500">Lifetime</span>
            </div>
          </div>
        </div>

        {/* Persistent sync button at bottom */}
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
