import React from "react";
import { TrendingUp, TrendingDown, Loader2, Wifi } from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { useSettings } from "@/components/utils/SettingsContext";
import { useRealtimeKrakenData } from "@/components/hooks/useRealtimeKrakenData";

export default function AssetHeader({ asset, dynamicChange, isLoading, holding }) {
  const { settings } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  const { 
    balances: wsBalances, 
    prices: wsPrices,
    isConnected: wsConnected 
  } = useRealtimeKrakenData({
    subscribeToPrices: true,
    priceSymbols: [`${asset?.symbol}/USD`],
    subscribeToBalances: !isSimMode,
    isSimMode
  });

  if (!asset) return null;

  // CRITICAL: Get current holdings and price from WebSocket in LIVE mode
  const quantity = React.useMemo(() => {
    if (isSimMode) {
      return holding?.quantity || 0;
    }
    
    // LIVE MODE: Use WebSocket balance
    if (wsConnected && wsBalances) {
      const wsBalance = wsBalances[asset.symbol?.toUpperCase()];
      if (wsBalance && wsBalance.balance > 0) {
        return wsBalance.balance;
      }
    }
    
    return holding?.quantity || 0;
  }, [isSimMode, holding, wsConnected, wsBalances, asset.symbol]);

  const currentPrice = React.useMemo(() => {
    if (!isSimMode && wsConnected && wsPrices) {
      const pair = `${asset.symbol}/USD`;
      const wsPrice = wsPrices[pair]?.price;
      if (wsPrice) return wsPrice;
    }
    return asset.price || 0;
  }, [isSimMode, wsConnected, wsPrices, asset.symbol, asset.price]);

  const portfolioValue = quantity * currentPrice;

  const changeValue = dynamicChange?.change;
  const isPositive = changeValue != null && changeValue >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 rounded-2xl border-2"
      style={{ 
        backgroundColor: 'var(--card-bg)',
        borderColor: 'var(--border-color)'
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {asset.symbol} - {asset.name || asset.symbol}
          </h1>
        </div>
        {!isSimMode && (
          <Badge className="bg-green-100 text-green-800 text-xs flex items-center gap-1">
            {wsConnected && <Wifi className="w-3 h-3" />}
            Live
          </Badge>
        )}
      </div>

      {/* 4-column grid like the screenshot */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Current Price</p>
          {isLoading ? (
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          ) : (
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          )}
        </div>

        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>24h Change</p>
          <div className="flex items-center gap-1">
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            ) : (
              <>
                {isPositive ? (
                  <TrendingUp className="w-5 h-5 text-green-500" />
                ) : (
                  <TrendingDown className="w-5 h-5 text-red-500" />
                )}
                <span className={`text-lg font-semibold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                  {isPositive ? '+' : ''}{changeValue?.toFixed(2) || '0.00'}%
                </span>
              </>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Your Holdings</p>
          <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {quantity.toFixed(4)} {asset.symbol}
          </p>
          {!isSimMode && wsConnected && quantity > 0 && (
            <p className="text-xs text-green-600 dark:text-green-400">
              ✅ Live data
            </p>
          )}
        </div>

        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Portfolio Value</p>
          <p className="text-xl font-bold neon-text">
            ${portfolioValue.toFixed(2)}
          </p>
        </div>
      </div>
    </motion.div>
  );
}