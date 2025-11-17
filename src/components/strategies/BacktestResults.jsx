import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react';

export default function BacktestResults({ results, onClose }) {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={onClose}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Backtest Results: {results.strategy_name}
        </h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card style={{ backgroundColor: 'var(--card-bg)' }}>
          <CardContent className="p-4">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Initial Capital</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              ${results.initial_capital.toFixed(2)}
            </p>
          </CardContent>
        </Card>
        
        <Card style={{ backgroundColor: 'var(--card-bg)' }}>
          <CardContent className="p-4">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Final Capital</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              ${results.final_capital.toFixed(2)}
            </p>
          </CardContent>
        </Card>
        
        <Card style={{ backgroundColor: 'var(--card-bg)' }}>
          <CardContent className="p-4">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total Return</p>
            <p className={`text-xl font-bold ${results.total_return >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {results.total_return.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
        
        <Card style={{ backgroundColor: 'var(--card-bg)' }}>
          <CardContent className="p-4">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total Trades</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {results.total_trades}
            </p>
          </CardContent>
        </Card>
        
        <Card style={{ backgroundColor: 'var(--card-bg)' }}>
          <CardContent className="p-4">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Win Rate</p>
            <p className="text-xl font-bold text-green-500">
              {results.win_rate.toFixed(1)}%
            </p>
          </CardContent>
        </Card>
      </div>

      <Card style={{ backgroundColor: 'var(--card-bg)' }}>
        <CardHeader>
          <CardTitle>Trade History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {results.trades?.map((trade, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-4 rounded-lg border"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--secondary-bg)' }}
              >
                <div className="flex items-center gap-4">
                  {trade.action === 'buy' ? (
                    <TrendingUp className="w-5 h-5 text-green-500" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-red-500" />
                  )}
                  <div>
                    <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {trade.action.toUpperCase()} {trade.symbol}
                    </p>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(trade.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {trade.quantity.toFixed(4)} @ ${trade.price.toFixed(2)}
                  </p>
                  {trade.pnl != null && (
                    <p className={`text-sm font-medium ${trade.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      P/L: ${trade.pnl.toFixed(2)}
                    </p>
                  )}
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Signal: {trade.signal}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}