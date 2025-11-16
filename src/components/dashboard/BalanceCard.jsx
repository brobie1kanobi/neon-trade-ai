import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Eye, EyeOff, TrendingUp, TrendingDown, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import NumberDisplay from "@/components/ui/NumberDisplay";
import { useRealtimeKrakenData } from "@/components/hooks/useRealtimeKrakenData";
import { useSettings } from "@/components/utils/SettingsContext";

export default function BalanceCard({
  title,
  amount,
  change,
  icon: Icon,
  onToggleVisibility,
  isVisible,
  isPrimary = false,
  changeLabel,
  wallet = null,
  balanceType = 'total',
  krakenPnL = null // CRITICAL: Real Kraken PnL data
}) {
  const { settings } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  const { 
    isConnected: wsConnected, 
    usdBalance: wsUsdBalance,
    totalPortfolioValue: wsTotalValue,
    totalAssets: wsTotalAssets
  } = useRealtimeKrakenData({
    subscribeToPrices: true,
    priceSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD'],
    subscribeToBalances: !isSimMode,
    subscribeToOrders: !isSimMode,
    isSimMode
  });

  const displayAmount = React.useMemo(() => {
    if (isSimMode) {
      return amount || 0;
    }

    if (balanceType === 'cash') {
      return wsConnected && wsUsdBalance >= 0 ? wsUsdBalance : (wallet?.real_cash_balance || 0);
    }
    
    if (balanceType === 'portfolio') {
      const portfolioValue = wsTotalValue - (wsConnected && wsUsdBalance >= 0 ? wsUsdBalance : 0);
      return portfolioValue;
    }
    
    return wsConnected && wsTotalValue >= 0 ? wsTotalValue : amount;
  }, [isSimMode, amount, wsConnected, wsUsdBalance, wsTotalValue, balanceType, wallet]);

  // CRITICAL: Use REAL Kraken PnL if provided
  const displayChange = React.useMemo(() => {
    if (krakenPnL && !isSimMode) {
      // For 24h cards, use pnl_24h
      if (changeLabel?.includes('24h')) {
        return {
          value: krakenPnL.pnl_24h || 0,
          percentage: displayAmount > 0 ? (krakenPnL.pnl_24h / displayAmount * 100) : 0
        };
      }
      // For lifetime cards, use pnl_lifetime
      return {
        value: krakenPnL.pnl_lifetime || 0,
        percentage: displayAmount > 0 ? (krakenPnL.pnl_lifetime / displayAmount * 100) : 0
      };
    }
    return change || { value: 0, percentage: 0 };
  }, [krakenPnL, change, isSimMode, changeLabel, displayAmount]);

  const isPositive = displayChange.value >= 0;
  const changeValue = typeof displayChange.value === 'number' ? displayChange.value : 0;
  const changePct = typeof displayChange.percentage === 'number' ? displayChange.percentage : 0;

  return (
    <Card className={`border-2 transition-all duration-300 ${
      isPrimary ?
      'neon-glow' :
      'border-gray-200 dark:border-gray-700 hover:border-green-400'}`
    }
    style={{ backgroundColor: 'var(--card-bg)', borderColor: isPrimary ? 'var(--neon-green)' : 'var(--border-color)' }}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              {title}
            </h3>
            {isSimMode &&
              <Badge variant="outline" className="text-xs">
                Demo
              </Badge>
            }
            {!isSimMode &&
              <Badge className="bg-green-100 text-green-800 text-xs flex items-center gap-1">
                {wsConnected && <Wifi className="w-3 h-3" />}
                Live
              </Badge>
            }
          </div>
          <div className="flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4" style={{ color: 'var(--neon-green)' }} />}
            {onToggleVisibility &&
              <Button
                variant="ghost"
                size="icon"
                className="w-6 h-6 p-0"
                onClick={onToggleVisibility}>
                {isVisible ?
                  <EyeOff className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /> :
                  <Eye className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                }
              </Button>
            }
          </div>
        </div>
        
        <div className="space-y-1">
          {isVisible ? (
            <>
              <NumberDisplay
                value={displayAmount}
                prefix="$"
                decimals={2}
                className={`max-w-full ${isPrimary ? 'neon-text' : ''}`}
                maxFontSize={isPrimary ? 40 : 28}
                minFontSize={16}
              />
              {!isSimMode && wsConnected && balanceType === 'total' && wsTotalAssets > 0 && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  ✅ Live • {wsTotalAssets} asset{wsTotalAssets !== 1 ? 's' : ''}
                </p>
              )}
            </>
          ) : (
            <p className={`text-2xl font-bold ${isPrimary ? 'neon-text' : ''}`}
              style={{ color: isPrimary ? 'var(--neon-green)' : 'var(--text-primary)' }}>
              ••••••
            </p>
          )}
          
          {isVisible &&
            <div className="flex items-center gap-1 flex-wrap">
              {isPositive ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
              <span className={`text-sm font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                {(changeValue >= 0 ? '+' : '-')}${Math.abs(changeValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({changePct >= 0 ? '+' : '-'}{Math.abs(changePct).toFixed(2)}%)
              </span>
              <span className="text-xs ml-1" style={{ color: 'var(--text-secondary)' }}>
                {changeLabel || (isSimMode ? 'Demo' : 'Live')}
              </span>
            </div>
          }
        </div>
      </CardContent>
    </Card>
  );
}