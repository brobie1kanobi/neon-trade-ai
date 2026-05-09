import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Activity, TrendingUp, TrendingDown, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import AssetDetailModal from "./AssetDetailModal";
import NumberDisplay from "@/components/ui/NumberDisplay";
import { useKrakenWebSocket } from "@/components/providers/KrakenWebSocketProvider";
import { useSettings } from "@/components/utils/SettingsContext";

const usePrevious = (value) => {
  const ref = useRef();
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
};

export default function AssetAllocation({ allocations, isLoading }) {
  const [totalValue, setTotalValue] = useState(0);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [priceChanges, setPriceChanges] = useState({});
  const [cachedAllocations, setCachedAllocations] = useState([]);
  const previousPrices = usePrevious(allocations);

  const { settings } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;

  // CRITICAL: Use global WebSocket connection for real-time Kraken data
  const {
    isConnected: wsConnected,
    balances: wsBalances,
    prices: wsPrices,
    cryptoHoldingsValue: wsCryptoValue,
    refresh: refreshWebSocket,
    // REST snapshot has ALL assets with prices immediately on load
    bestHoldings: restHoldings,
    krakenBalance: krakenData,
    hasData: hasKrakenData,
    wsUpdateCounter
  } = useKrakenWebSocket();

  // CRITICAL: Refresh WebSocket data when trades complete
  React.useEffect(() => {
    const handleTradeCompleted = () => {
      console.log('[AssetAllocation] Trade completed, refreshing WebSocket data');
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

  // CRITICAL: In LIVE mode, build allocations from Kraken data
  // PRIORITY 1: REST snapshot (bestHoldings) — available immediately with ALL assets and prices
  // PRIORITY 2: WebSocket balances+prices — arrives piecemeal (ticker-by-ticker), may show partial data
  const wsAllocations = React.useMemo(() => {
    if (isSimMode) return null;
    
    // PRIORITY 1: REST snapshot from provider (has ALL assets with accurate prices from Kraken Ticker API)
    if (restHoldings && restHoldings.length > 0) {
      console.log('[AssetAllocation] Using REST snapshot holdings:', restHoldings.length, 'assets');
      const mapped = restHoldings.map(h => {
        // Overlay real-time WS price if available (more current than REST)
        const pair = `${h.symbol}/USD`;
        const wsPrice = wsPrices?.[pair]?.price;
        const price = wsPrice || h.current_price_usd || 0;
        const qty = h.quantity || 0;
        const value = qty * price;
        const avgCost = h.avg_cost || 0;
        
        return {
          symbol: h.symbol,
          quantity: qty,
          currentPrice: price,
          currentValue: value,
          costBasis: avgCost > 0 ? avgCost * qty : value,
          average_cost_price: avgCost > 0 ? avgCost : price,
          asset_type: 'crypto',
          is_simulation: false
        };
      }).filter(a => a.currentValue > 0.01)
        .sort((a, b) => b.currentValue - a.currentValue);
      
      return mapped.length > 0 ? mapped : null;
    }
    
    // PRIORITY 2: WebSocket balances (fallback if REST hasn't loaded yet)
    if (wsConnected && wsBalances && Object.keys(wsBalances).length > 0) {
      console.log('[AssetAllocation] Using WebSocket balances (REST not yet available)');
      const wsAssets = Object.entries(wsBalances)
        .filter(([asset]) => asset !== 'USD' && asset !== 'ZUSD')
        .filter(([_, balance]) => (balance.balance || 0) > 0.00001)
        .map(([asset, balance]) => {
          const pair = `${asset}/USD`;
          const priceInfo = wsPrices?.[pair];
          const qty = balance.balance || 0;
          const price = priceInfo?.price || 0;
          const value = qty * price;
          
          return {
            symbol: asset,
            quantity: qty,
            currentPrice: price,
            currentValue: value,
            costBasis: value,
            average_cost_price: price,
            asset_type: 'crypto',
            is_simulation: false
          };
        })
        .filter(a => a.currentValue > 0.01)
        .sort((a, b) => b.currentValue - a.currentValue);
      
      return wsAssets.length > 0 ? wsAssets : null;
    }
    
    return null;
  }, [isSimMode, restHoldings, wsConnected, wsBalances, wsPrices, wsUpdateCounter]);

  // CRITICAL: Cache allocations so we keep showing them during refresh
  useEffect(() => {
    if (Array.isArray(allocations) && allocations.length > 0) {
      setCachedAllocations(allocations);
    }
  }, [allocations]);

  useEffect(() => {
    if (!previousPrices || !allocations) return;

    const changes = {};
    allocations.forEach((asset, idx) => {
      const prevAsset = previousPrices[idx];
      if (prevAsset && asset.symbol === prevAsset.symbol && asset.currentPrice !== prevAsset.currentPrice) {
        changes[asset.symbol] = asset.currentPrice > prevAsset.currentPrice ? 'up' : 'down';

        setTimeout(() => {
          setPriceChanges((prev) => {
            const next = { ...prev };
            delete next[asset.symbol];
            return next;
          });
        }, 2000);
      }
    });

    if (Object.keys(changes).length > 0) {
      setPriceChanges((prev) => ({ ...prev, ...changes }));
    }
  }, [allocations, previousPrices]);

  // CRITICAL: Prioritize WebSocket allocations in LIVE mode
  // Fall back to prop allocations, then cached allocations
  const displayAllocations = React.useMemo(() => {
    // LIVE MODE: Use WebSocket data if available
    if (!isSimMode && wsAllocations && wsAllocations.length > 0) {
      return wsAllocations;
    }
    // Use prop allocations if available
    if (allocations && allocations.length > 0) {
      return allocations;
    }
    // Fall back to cached when loading
    if (isLoading && cachedAllocations.length > 0) {
      return cachedAllocations;
    }
    return allocations || [];
  }, [isSimMode, wsAllocations, allocations, isLoading, cachedAllocations]);

  const consolidatedHoldings = useMemo(() => {
    if (!Array.isArray(displayAllocations)) return [];

    const grouped = displayAllocations.reduce((acc, holding) => {
      const symbol = (holding.symbol || "").toUpperCase();
      if (!acc[symbol]) {
        acc[symbol] = { ...holding };
      } else {
        acc[symbol].quantity = (acc[symbol].quantity || 0) + (holding.quantity || 0);
        acc[symbol].costBasis = (acc[symbol].costBasis || 0) + (holding.costBasis || 0);
        acc[symbol].currentValue = (acc[symbol].currentValue || 0) + (holding.currentValue || 0);

        const totalQty = acc[symbol].quantity;
        if (totalQty > 0) {
          acc[symbol].average_cost_price = acc[symbol].costBasis / totalQty;
          acc[symbol].currentPrice = acc[symbol].currentValue / totalQty;
        } else {
          acc[symbol].average_cost_price = 0;
          acc[symbol].currentPrice = 0;
        }
      }
      return acc;
    }, {});

    return Object.values(grouped).
    filter((h) => h.quantity > 0.0000001).
    sort((a, b) => b.currentValue - a.currentValue);
  }, [displayAllocations]);

  useEffect(() => {
    if (consolidatedHoldings && consolidatedHoldings.length > 0) {
      setTotalValue(
        consolidatedHoldings.reduce((sum, alloc) => sum + (alloc.currentValue || 0), 0)
      );
    } else {
      setTotalValue(0);
    }
  }, [consolidatedHoldings]);

  return (
    <>
      <AssetDetailModal
        asset={selectedAsset}
        isOpen={!!selectedAsset}
        onClose={() => setSelectedAsset(null)} />

      
      <Card style={{ backgroundColor: 'var(--card-bg)' }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <PieChart className="w-5 h-5" />
            Asset Allocation
            {!isSimMode && wsConnected ? (
              <Badge variant="outline" className="ml-auto text-xs flex items-center gap-1 bg-green-50 text-green-700 border-green-200">
                <Wifi className="w-3 h-3" />
                WebSocket Live
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-auto text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  {isSimMode ? 'Demo' : 'Live'} Prices
                </div>
              </Badge>
            )}
          </CardTitle>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            {!isSimMode && wsConnected 
              ? 'Prices update in real-time via WebSocket connection' 
              : 'Prices refresh every 60 seconds'}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Only show skeleton if loading AND no cached data */}
          {isLoading && cachedAllocations.length === 0 && consolidatedHoldings.length === 0 ?
          <div className="space-y-3">
              {[1, 2, 3].map((i) =>
            <div key={i} className="h-20 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse" />
            )}
            </div> :
          consolidatedHoldings.length === 0 ?
          <div className="text-center py-8" style={{ color: "var(--text-secondary)" }}>
              <Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No Assets Yet</p>
              <p className="text-sm mt-1">Start trading to build your portfolio</p>
            </div> :

          <div className="space-y-3">
              {consolidatedHoldings.map((asset) => {
              const percentage = totalValue > 0 ? asset.currentValue / totalValue * 100 : 0;
              const gainLoss = asset.currentValue - asset.costBasis;
              const gainLossPercent = asset.costBasis > 0 ? gainLoss / asset.costBasis * 100 : 0;
              const priceChange = priceChanges[asset.symbol];

              return (
                <motion.div
                  key={asset.symbol}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="p-4 rounded-lg border cursor-pointer hover:shadow-md transition-all"
                  style={{
                    backgroundColor: "var(--secondary-bg)",
                    borderColor: "var(--border-color)"
                  }}
                  onClick={() => setSelectedAsset(asset)}>

                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold neon-glow" style={{ backgroundColor: "rgba(var(--neon-green-rgb), 0.1)", color: "var(--neon-green)" }}>
                          {String(asset.symbol || '').substring(0, 3)}
                        </div>
                        <div>
                          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                            {String(asset.symbol || '')}
                          </p>
                          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                            {(asset.quantity || 0).toFixed(4)} units
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2">
                          <NumberDisplay value={asset.currentValue} prefix="$" decimals={2} maxFontSize={18} minFontSize={14} className="font-semibold" />
                          {priceChange &&
                        <motion.div
                          initial={{ scale: 1.5, opacity: 1 }}
                          animate={{ scale: 1, opacity: 0 }}
                          transition={{ duration: 2 }}>

                              {priceChange === 'up' ?
                          <TrendingUp className="w-4 h-4 text-green-500" /> :

                          <TrendingDown className="w-4 h-4 text-red-500" />
                          }
                            </motion.div>
                        }
                        </div>
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          {percentage.toFixed(1)}% of portfolio
                        </p>
                      </div>
                    </div>

                    <div className="pt-2 border-t space-y-1.5" style={{ borderColor: "var(--border-color)" }}>
                      <div className="flex items-center justify-between text-xs">
                        <div>
                          <span style={{ color: "var(--text-secondary)" }}>Price: </span>
                          <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                            ${((asset.currentPrice || 0) >= 1 
                              ? (asset.currentPrice || 0).toFixed(2) 
                              : (asset.currentPrice || 0).toFixed(6))}
                          </span>
                          {!isSimMode && wsConnected && (
                            <span className="ml-1 text-green-500">✅</span>
                          )}
                        </div>
                        <div className={`flex items-center gap-1 font-medium ${gainLoss >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {gainLoss >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          <span title="Unrealized Profit/Loss since purchase (Lifetime PnL)">
                            {gainLoss >= 0 ? "+" : ""}${Math.abs(gainLoss).toFixed(2)} ({gainLossPercent >= 0 ? "+" : ""}{gainLossPercent.toFixed(2)}%)
                          </span>
                        </div>
                      </div>
                      {asset.average_cost_price > 0 && asset.average_cost_price !== asset.currentPrice && (
                        <div className="flex items-center justify-between text-xs">
                          <div>
                            <span style={{ color: "var(--text-secondary)" }}>Avg Cost: </span>
                            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                              ${asset.average_cost_price >= 1 
                                ? asset.average_cost_price.toFixed(2) 
                                : asset.average_cost_price.toFixed(6)}
                            </span>
                          </div>
                          <div>
                            <span style={{ color: "var(--text-secondary)" }}>Cost Basis: </span>
                            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                              ${(asset.costBasis || 0).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-2 bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                      <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: "var(--neon-green)" }}
                      initial={{ width: 0 }}
                      animate={{ width: `${percentage}%` }}
                      transition={{ duration: 0.5, ease: "easeOut" }} />

                    </div>
                  </motion.div>);

            })}
            </div>
          }
        </CardContent>
      </Card>
    </>);

}