import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { invalidateCache } from "@/components/hooks/useDataFetching";
import { invalidatePortfolioCache, usePortfolioData } from "@/components/hooks/usePortfolioData";
import NumberDisplay from "@/components/ui/NumberDisplay";

export default function WalletBalance({ onBalanceUpdate }) {
  const [showBalance, setShowBalance] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  const {
    wallet,
    isSimMode,
    currentCashBalance,
    currentPortfolioValue,
    totalValue,
    wsConnected,
    holdings,
    refresh
  } = usePortfolioData();

  const handleManualSync = async () => {
    if (isSyncing) return;
    
    setIsSyncing(true);
    setSyncError(null);
    
    const timeoutId = setTimeout(() => {
      setIsSyncing(false);
      setSyncError('Sync timeout - trying again may help');
      toast.error('Sync timeout');
    }, 15000);
    
    try {
      if (isSimMode) {
        toast.info('Repairing portfolio...');
        await base44.functions.invoke('repairMyPortfolio', {});
        toast.success('Portfolio repaired');
      } else {
        const syncRes = await base44.functions.invoke('syncKrakenBalance', {});
        const syncData = syncRes?.data || syncRes;
        
        if (!syncData?.success) {
          throw new Error(syncData?.error || 'Sync failed');
        }
        
        toast.success('✅ Synced with Kraken', {
          description: `$${syncData.usdBalance?.toFixed(2)} USD, ${syncData.holdings?.length || 0} assets`,
          duration: 4000
        });
      }
      
      invalidateCache();
      invalidatePortfolioCache();
      refresh();
      if (onBalanceUpdate) onBalanceUpdate();
      
      window.dispatchEvent(new CustomEvent('app:data-updated', {
        detail: { type: 'wallet-sync', source: 'wallet_balance' }
      }));
    } catch (error) {
      console.error('Sync error:', error);
      setSyncError(error.message || 'Sync failed');
      toast.error('Sync failed', { description: error.message });
    } finally {
      clearTimeout(timeoutId);
      setIsSyncing(false);
    }
  };

  return (
    <Card className="border-2 neon-glow" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--neon-green)' }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle style={{ color: 'var(--text-primary)' }}>Wallet Balance</CardTitle>
          <div className="flex items-center gap-2">
            {!isSimMode && wsConnected && (
              <div className="flex items-center gap-1 text-xs text-green-500">
                <Wifi className="w-3 h-3" />
                <span>Live</span>
              </div>
            )}
            {!isSimMode && !wsConnected && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <WifiOff className="w-3 h-3" />
                <span>Offline</span>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowBalance(!showBalance)}
            >
              {showBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Total Balance</p>
          {showBalance ? (
            <NumberDisplay
              value={totalValue}
              prefix="$"
              decimals={2}
              className="mx-auto max-w-[min(90vw,420px)]"
              maxFontSize={48}
              minFontSize={20}
            />
          ) : (
            <p className="text-3xl font-bold">••••••</p>
          )}
        </div>

        {!isSimMode && wsConnected && (
          <div className="flex items-center justify-center gap-2 text-xs text-green-600 dark:text-green-400 mb-2">
            <Wifi className="w-3 h-3" />
            <span>Live • {holdings.length} asset{holdings.length !== 1 ? 's' : ''}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Available Cash</p>
            {showBalance ? (
              <NumberDisplay
                value={currentCashBalance}
                prefix="$"
                decimals={2}
                className="mx-auto max-w-[160px]"
                maxFontSize={20}
                minFontSize={12}
              />
            ) : (
              <p className="font-medium">••••</p>
            )}
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Portfolio Value</p>
            {showBalance ? (
              <NumberDisplay
                value={currentPortfolioValue}
                prefix="$"
                decimals={2}
                className="mx-auto max-w-[180px]"
                maxFontSize={20}
                minFontSize={12}
              />
            ) : (
              <p className="font-medium">••••</p>
            )}
          </div>
        </div>

        <div className="pt-4">
          <Button
            onClick={handleManualSync}
            disabled={isSyncing}
            className="w-full"
            variant="outline"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : isSimMode ? 'Repair Portfolio' : 'Sync with Kraken'}
          </Button>
          {syncError && (
            <p className="text-xs text-red-500 mt-2 text-center">{syncError}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}