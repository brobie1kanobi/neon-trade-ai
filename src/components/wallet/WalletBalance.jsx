import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wallet, TrendingUp, TrendingDown, DollarSign, Eye, EyeOff, RefreshCw, Wifi } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import NumberDisplay from "@/components/ui/NumberDisplay";

export default function WalletBalance({ wallet, isSimMode, portfolioMarketValue, wsConnected, onSyncComplete }) {
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const currentCashBalance = isSimMode 
    ? (wallet?.cash_balance || 0) 
    : (wallet?.real_cash_balance || 0);

  const totalDeposits = isSimMode 
    ? (wallet?.total_deposits || 0) 
    : (wallet?.real_total_deposits || 0);

  const totalWithdrawals = isSimMode 
    ? (wallet?.total_withdrawals || 0) 
    : (wallet?.real_total_withdrawals || 0);

  const netFlow = totalDeposits - totalWithdrawals;
  const totalValue = currentCashBalance + (portfolioMarketValue || 0);

  const handleSync = async () => {
    if (isSyncing || isSimMode) return; // CRITICAL: Never sync in sim mode
    
    setIsSyncing(true);
    try {
      toast.info('Syncing Kraken account...', { duration: 8000 });
      
      // CRITICAL: Add longer timeout for the function call
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const syncRes = await base44.functions.invoke('syncKrakenBalance', {});
      clearTimeout(timeoutId);
      
      const syncData = syncRes?.data || syncRes;
      
      // Handle HTTP error status codes
      if (syncRes?.status >= 400) {
        throw new Error(syncData?.error || `Request failed with status code ${syncRes.status}`);
      }
      
      if (!syncData?.success) {
        throw new Error(syncData?.error || 'Sync failed');
      }
      
      toast.success('✅ Kraken synced!', {
        description: `$${syncData.usdBalance?.toFixed(2)} USD, ${syncData.holdings?.length || 0} assets`,
        duration: 4000
      });
      
      if (onSyncComplete) {
        onSyncComplete();
      }
    } catch (error) {
      console.error('Sync error:', error);
      const errorMsg = error.message || 'Unknown error';
      
      // Better error messages
      if (errorMsg.includes('408') || errorMsg.includes('timeout')) {
        toast.error('Sync timed out', { description: 'Kraken API is slow. Please try again.' });
      } else if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
        toast.error('Not authorized', { description: 'Please reconnect your Kraken account.' });
      } else {
        toast.error('Sync failed', { description: errorMsg });
      }
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Wallet className="w-5 h-5" />
            Wallet Balance
          </CardTitle>
          <div className="flex items-center gap-2">
            {!isSimMode && (
              <Badge className="bg-green-100 text-green-800 text-xs flex items-center gap-1">
                {wsConnected && <Wifi className="w-3 h-3" />}
                Live Mode
              </Badge>
            )}
            {isSimMode && (
              <Badge variant="outline" className="text-xs">
                Demo Mode
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setBalanceVisible(!balanceVisible)}
              className="h-8 w-8"
            >
              {balanceVisible ? (
                <EyeOff className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              ) : (
                <Eye className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Total Balance</p>
            {balanceVisible ? (
              <NumberDisplay
                value={totalValue}
                prefix="$"
                decimals={2}
                className="max-w-full"
                maxFontSize={28}
                minFontSize={16}
              />
            ) : (
              <p className="text-2xl font-bold">••••••</p>
            )}
          </div>
          
          <div className="space-y-2">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Available Cash</p>
            {balanceVisible ? (
              <NumberDisplay
                value={currentCashBalance}
                prefix="$"
                decimals={2}
                className="max-w-full"
                maxFontSize={28}
                minFontSize={16}
              />
            ) : (
              <p className="text-2xl font-bold">••••••</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <div className="space-y-1">
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Portfolio Value</p>
            {balanceVisible ? (
              <NumberDisplay
                value={portfolioMarketValue || 0}
                prefix="$"
                decimals={2}
                className="max-w-full"
                maxFontSize={20}
                minFontSize={14}
              />
            ) : (
              <p className="text-lg font-semibold">••••••</p>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Net Flow</p>
            {balanceVisible ? (
              <div className="flex items-center gap-1">
                {netFlow >= 0 ? (
                  <TrendingUp className="w-4 h-4 text-green-500" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-500" />
                )}
                <NumberDisplay
                  value={Math.abs(netFlow)}
                  prefix={netFlow >= 0 ? '+$' : '-$'}
                  decimals={2}
                  className="max-w-full"
                  maxFontSize={20}
                  minFontSize={14}
                  tone={netFlow >= 0 ? 'positive' : 'negative'}
                />
              </div>
            ) : (
              <p className="text-lg font-semibold">••••••</p>
            )}
          </div>
        </div>

        {!isSimMode && (
          <Button
            onClick={handleSync}
            disabled={isSyncing}
            className="w-full neon-glow bg-green-600 hover:bg-green-700"
            variant="default"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : 'Sync Kraken Balance'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}