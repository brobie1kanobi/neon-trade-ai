import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, TrendingUp, TrendingDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AssetPriceChart from "@/components/details/AssetPriceChart";
import NumberDisplay from "@/components/ui/NumberDisplay";

export default function AssetDetailCard({ 
  asset, 
  holding, 
  onClose, 
  trades = [],
  currentPrice = 0,
  change24h = 0
}) {
  const [timeframe, setTimeframe] = useState("1D");
  const [chartPrice, setChartPrice] = useState(currentPrice);

  const quantity = holding?.quantity || 0;
  const avgCost = holding?.average_cost_price || 0;
  const currentValue = quantity * (chartPrice || currentPrice);
  const costBasis = quantity * avgCost;
  const periodPnL = currentValue - costBasis;
  const periodPnLPercent = costBasis > 0 ? (periodPnL / costBasis) * 100 : 0;

  const handlePriceUpdate = (data) => {
    if (data?.price) {
      setChartPrice(data.price);
    }
  };

  if (!asset || !holding) return null;

  const symbol = asset.symbol || holding.symbol;
  const assetType = asset.asset_type || holding.asset_type || 'crypto';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-4xl max-h-[90vh] overflow-y-auto"
        >
          <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {symbol} - {asset.name || symbol}
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-5 h-5" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Top Stats Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-3 rounded-lg border" style={{ 
                  borderColor: 'var(--border-color)',
                  backgroundColor: 'var(--secondary-bg)' 
                }}>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Current Price</div>
                  <div className="font-semibold text-lg neon-text">
                    ${(chartPrice || currentPrice).toFixed(2)}
                  </div>
                </div>

                <div className="p-3 rounded-lg border" style={{ 
                  borderColor: 'var(--border-color)',
                  backgroundColor: 'var(--secondary-bg)' 
                }}>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>24h Change</div>
                  <div className={`font-semibold text-sm flex items-center gap-1 ${change24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {change24h >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                  </div>
                </div>

                <div className="p-3 rounded-lg border" style={{ 
                  borderColor: 'var(--border-color)',
                  backgroundColor: 'var(--secondary-bg)' 
                }}>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Your Holdings</div>
                  <div className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>
                    {quantity.toFixed(6)} {symbol}
                  </div>
                </div>

                <div className="p-3 rounded-lg border" style={{ 
                  borderColor: 'var(--border-color)',
                  backgroundColor: 'var(--secondary-bg)' 
                }}>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Portfolio Value</div>
                  <div className="font-semibold text-lg neon-text">
                    ${currentValue.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Chart with embedded stats */}
              <div className="relative">
                <AssetPriceChart
                  symbol={symbol}
                  assetType={assetType}
                  onPriceUpdate={handlePriceUpdate}
                  trades={trades}
                  holding={holding}
                />
              </div>

              {/* Bottom Stats Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
                <div className="p-3 rounded-lg border" style={{ 
                  borderColor: 'var(--border-color)',
                  backgroundColor: 'var(--secondary-bg)' 
                }}>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Period P/L</div>
                  <div className={`font-semibold text-sm ${periodPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {periodPnL >= 0 ? '+' : ''}${periodPnL.toFixed(2)}
                  </div>
                  <div className={`text-xs ${periodPnLPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {periodPnLPercent >= 0 ? '+' : ''}{periodPnLPercent.toFixed(2)}%
                  </div>
                </div>

                <div className="p-3 rounded-lg border" style={{ 
                  borderColor: 'var(--border-color)',
                  backgroundColor: 'var(--secondary-bg)' 
                }}>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Current Price</div>
                  <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    ${(chartPrice || currentPrice).toFixed(2)}
                  </div>
                </div>

                <div className="p-3 rounded-lg border" style={{ 
                  borderColor: 'var(--border-color)',
                  backgroundColor: 'var(--secondary-bg)' 
                }}>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Quantity</div>
                  <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {quantity.toFixed(8)}
                  </div>
                </div>

                <div className="p-3 rounded-lg border" style={{ 
                  borderColor: 'var(--border-color)',
                  backgroundColor: 'var(--secondary-bg)' 
                }}>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Current Value</div>
                  <div className="font-semibold text-sm neon-text">
                    ${currentValue.toFixed(2)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}