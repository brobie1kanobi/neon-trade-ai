import React, { useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Eye, EyeOff, TrendingUp, TrendingDown, Wifi, Loader2 } from "lucide-react";
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
  krakenPnL = null
}) {
  const { settings } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  const persistentValueRef = useRef({
    amount: 0,
    change: { value: 0, percentage: 0 }
  });
  
  const { 
    isConnected: wsConnected,
    loading: wsLoading,
    usdBalance: wsUsdBalance,
    totalPortfolioValue: wsTotalValue,
    totalAssets: wsTotalAssets,
    balances: wsBalances
  } = useRealtimeKrakenData({
    subscribeToPrices: true,
    priceSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD'],
    subscribeToBalances: !isSimMode,
    subscribeToOrders: !isSimMode,
    isSimMode
  });

  // CRITICAL: Calculate display amount from WebSocket data
  const displayAmount = React.useMemo(() => {
    if (isSimMode) {
      return amount || 0;
    }
    
    // LIVE MODE: Use WebSocket data
    if (!wsConnected || wsLoading) {
      return persistentValueRef.current.amount || 0;
    }

    let value = 0;
    
    if (balanceType === 'cash') {
      // Cash balance from WebSocket
      value = typeof wsUsdBalance === 'number' ? wsUsdBalance : 0;
    } else if (balanceType === 'portfolio') {
      // Portfolio value = total - cash
      const total = typeof wsTotalValue === 'number' ? wsTotalValue : 0;
      const cash = typeof wsUsdBalance === 'number' ? wsUsdBalance : 0;
      value = Math.max(0, total - cash);
    } else if (balanceType === 'total') {
      // Total balance from WebSocket
      value = typeof wsTotalValue === 'number' ? wsTotalValue : 0;
    }
    
    // Update persistent ref with valid value
    if (value > 0.01 || !persistentValueRef.current.amount) {
      persistentValueRef.current.amount = value;
    }
    
    return persistentValueRef.current.amount;
  }, [isSimMode, amount, wsConnected, wsLoading, wsUsdBalance, wsTotalValue, balanceType]);

  const displayChange = React.useMemo(() => {
    let changeValue;
    
    if (krakenPnL && !isSimMode) {
      if (changeLabel?.includes('24h')) {
        changeValue = {
          value: krakenPnL.pnl_24h || 0,
          percentage: displayAmount > 0 ? ((krakenPnL.pnl_24h || 0) / displayAmount * 100) : 0
        };
      } else {
        changeValue = {
          value: krakenPnL.pnl_lifetime || 0,
          percentage: displayAmount > 0 ? ((krakenPnL.pnl_lifetime || 0) / displayAmount * 100) : 0
        };
      }
    } else {
      changeValue = change || { value: 0, percentage: 0 };
    }
    
    if (Math.abs(changeValue.value) > 0.01 || persistentValueRef.current.change.value === 0) {
      persistentValueRef.current.change = changeValue;
    }
    
    return persistentValueRef.current.change;
  }, [krakenPnL, change, isSimMode, changeLabel, displayAmount]);

  const isPositive = displayChange.value >= 0;
  const changeValue = typeof displayChange.value === 'number' ? displayChange.value : 0;
  const changePct = typeof displayChange.percentage === 'number' ? displayChange.percentage : 0;

  // Show loading indicator in LIVE mode when connecting
  const isLoadingLive = !isSimMode && wsLoading && displayAmount === 0;

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
                {wsConnected ? <Wifi className="w-3 h-3" /> : <Loader2 className="w-3 h-3 animate-spin" />}
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
              {isLoadingLive ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-green-500" />
                  <span className="text-sm text-gray-500">Loading balance...</span>
                </div>
              ) : (
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
                      ✅ Connected • {wsTotalAssets} asset{wsTotalAssets !== 1 ? 's' : ''}
                    </p>
                  )}
                </>
              )}
            </>
          ) : (
            <p className={`text-2xl font-bold ${isPrimary ? 'neon-text' : ''}`}
              style={{ color: isPrimary ? 'var(--neon-green)' : 'var(--text-primary)' }}>
              ••••••
            </p>
          )}
          
          {isVisible && !isLoadingLive &&
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