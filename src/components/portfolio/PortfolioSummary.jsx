import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import NumberDisplay from "@/components/ui/NumberDisplay";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { invalidateCache } from "@/components/hooks/useDataFetching";
import { invalidatePriceCache, invalidatePortfolioCache } from "@/components/hooks/usePortfolioData";

export default function PortfolioSummary({
  user,
  wallet,
  holdings,
  trades,
  isSimMode,
  currentCashBalance,
  currentPortfolioValue,
  totalValue,
  portfolio24hrChange,
  lifetimeChange,
  wsConnected,
  isLoading,
  refresh
}) {
  const isPositive = portfolio24hrChange.value >= 0;
  const isLifetimePositive = lifetimeChange.value >= 0;

  const [isSyncing, setIsSyncing] = React.useState(false);
  
  const handleSync = async () => {
    if (isSyncing) return;
    
    try {
      setIsSyncing(true);
      
      if (isSimMode) {
        toast.info('Syncing portfolio data...');
        await base44.functions.invoke('repairMyPortfolio', {});
      } else {
        toast.info('Syncing Kraken account...', { duration: 3000 });
        
        const syncRes = await base44.functions.invoke('syncKrakenBalance', {});
        const syncData = syncRes?.data || syncRes;
        
        if (!syncData?.success) {
          throw new Error(syncData?.error || 'Sync failed');
        }
        
        toast.success('✅ Kraken synced!', {
          description: `$${syncData.usdBalance?.toFixed(2)} USD, ${syncData.holdings?.length || 0} assets`,
          duration: 4000
        });
      }
      
      invalidateCache();
      invalidatePriceCache();
      invalidatePortfolioCache();
      refresh();
      
      window.dispatchEvent(new CustomEvent('app:data-updated', { 
        detail: { type: 'portfolio-sync', source: 'portfolio_summary' } 
      }));
    } catch (error) {
      console.error('Sync error:', error);
      toast.error('Sync failed', { description: error.message });
    } finally {
      setIsSyncing(false);
    }
  };

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
              tone={lifetimeChange.value === 0 ? 'neutral' : (isLifetimePositive ? 'positive' : 'negative')}
            />
            {!isSimMode && wsConnected && holdings.length > 0 && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                ✅ Live WebSocket • {holdings.length} asset{holdings.length !== 1 ? 's' : ''}
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
                value={currentPortfolioValue}
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
                {isPositive ? '+' : ''}${portfolio24hrChange.value.toFixed(2)} ({portfolio24hrChange.percentage.toFixed(1)}%)
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
                {isLifetimePositive ? '+' : ''}${lifetimeChange.value.toFixed(2)} ({lifetimeChange.percentage.toFixed(1)}%)
              </span>
              <span className="text-xs text-gray-500">Lifetime (Kraken)</span>
            </div>
          </div>
        </div>

        <div className="pt-4">
          <Button
            onClick={handleSync}
            disabled={isSyncing}
            className="w-full neon-glow bg-green-600 hover:bg-green-700"
          >
            {isSyncing ? 'Syncing...' : (isSimMode ? 'Sync Portfolio Data' : 'Sync Kraken Holdings')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}