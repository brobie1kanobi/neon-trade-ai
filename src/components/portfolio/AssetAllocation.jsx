import { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Activity, TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import AssetDetailModal from "./AssetDetailModal";
import NumberDisplay from "@/components/ui/NumberDisplay";

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
  const previousPrices = usePrevious(allocations);

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

  const consolidatedHoldings = useMemo(() => {
    if (!Array.isArray(allocations)) return [];

    const grouped = allocations.reduce((acc, holding) => {
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
  }, [allocations]);

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
            <Badge variant="outline" className="ml-auto text-xs">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Live Prices
              </div>
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ?
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
                          {asset.symbol.substring(0, 3)}
                        </div>
                        <div>
                          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                            {asset.symbol}
                          </p>
                          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                            {asset.quantity.toFixed(4)} units
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

                    <div className="flex items-center justify-between text-xs pt-2 border-t" style={{ borderColor: "var(--border-color)" }}>
                      <div>
                        <span style={{ color: "var(--text-secondary)" }} className="">Current Cost: </span>
                        <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                          ${asset.average_cost_price?.toFixed(2) || "0.00"}
                        </span>
                      </div>
                      <div className={`flex items-center gap-1 font-medium ${gainLoss >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {gainLoss >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        <span>
                          {gainLoss >= 0 ? "+" : ""}${Math.abs(gainLoss).toFixed(2)} ({gainLossPercent >= 0 ? "+" : ""}{gainLossPercent.toFixed(2)}%)
                        </span>
                      </div>
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