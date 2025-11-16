import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";

export default function HoldingsBreakdown({ holdings, prices, isSimMode }) {
  if (!holdings || holdings.length === 0) {
    return (
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <CardTitle className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Your Holdings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            No holdings yet. Start trading to see your assets here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Your Holdings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {holdings.map((holding) => {
          const symbol = holding.symbol;
          const pair = `${symbol}/USD`;
          const priceData = prices[pair] || {};
          const currentPrice = priceData.price || holding.currentPrice || 0;
          const change24h = priceData.change_24h || 0;
          const quantity = holding.quantity || 0;
          const currentValue = quantity * currentPrice;
          const gainLoss = holding.gainLoss || 0;
          const gainLossPercent = holding.gainLossPercent || 0;

          return (
            <div 
              key={symbol} 
              className="p-3 rounded-lg border" 
              style={{ 
                backgroundColor: 'var(--secondary-bg)',
                borderColor: 'var(--border-color)'
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
                  {symbol}
                </h3>
                <div className="flex items-center gap-1">
                  {change24h !== 0 && (
                    change24h >= 0 ? (
                      <TrendingUp className="w-4 h-4 text-green-500" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-500" />
                    )
                  )}
                  <span className={`text-xs font-medium ${change24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Current Price</p>
                  <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    ${currentPrice.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>24h Change</p>
                  <p className={`font-semibold text-sm ${change24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                  </p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Your Holdings</p>
                  <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {quantity.toFixed(6)} {symbol}
                  </p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Portfolio Value</p>
                  <p className="font-semibold text-sm neon-text">
                    ${currentValue.toFixed(2)}
                  </p>
                </div>
              </div>

              {!isSimMode && gainLoss !== 0 && (
                <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>P/L</p>
                    <p className={`text-sm font-semibold ${gainLoss >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {gainLoss >= 0 ? '+' : ''}${gainLoss.toFixed(2)} ({gainLossPercent >= 0 ? '+' : ''}{gainLossPercent.toFixed(2)}%)
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}