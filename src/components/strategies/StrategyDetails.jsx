import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react';
import { Badge } from "@/components/ui/badge";

export default function StrategyDetails({ strategy, onClose, onUpdate }) {
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadExecutions();
  }, [strategy.id]);

  const loadExecutions = async () => {
    try {
      const data = await base44.entities.StrategyExecution.filter(
        { strategy_id: strategy.id },
        '-created_date',
        50
      );
      setExecutions(data || []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={onClose}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {strategy.name}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {strategy.description}
          </p>
        </div>
        <Badge className={strategy.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
          {strategy.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card style={{ backgroundColor: 'var(--card-bg)' }}>
          <CardContent className="p-4">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total Trades</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {strategy.total_trades || 0}
            </p>
          </CardContent>
        </Card>
        
        <Card style={{ backgroundColor: 'var(--card-bg)' }}>
          <CardContent className="p-4">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Win Rate</p>
            <p className="text-2xl font-bold text-green-500">
              {strategy.win_rate?.toFixed(1) || 0}%
            </p>
          </CardContent>
        </Card>
        
        <Card style={{ backgroundColor: 'var(--card-bg)' }}>
          <CardContent className="p-4">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total P/L</p>
            <p className={`text-2xl font-bold ${(strategy.total_pnl || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              ${strategy.total_pnl?.toFixed(2) || '0.00'}
            </p>
          </CardContent>
        </Card>
        
        <Card style={{ backgroundColor: 'var(--card-bg)' }}>
          <CardContent className="p-4">
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Last Run</p>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {strategy.last_run ? new Date(strategy.last_run).toLocaleString() : 'Never'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card style={{ backgroundColor: 'var(--card-bg)' }}>
        <CardHeader>
          <CardTitle>Execution History</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-4 border-green-400 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : executions.length === 0 ? (
            <p className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
              No executions yet
            </p>
          ) : (
            <div className="space-y-2">
              {executions.map((exec) => (
                <div
                  key={exec.id}
                  className="flex items-center justify-between p-4 rounded-lg border"
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--secondary-bg)' }}
                >
                  <div className="flex items-center gap-4">
                    {exec.action === 'buy' ? (
                      <TrendingUp className="w-5 h-5 text-green-500" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-red-500" />
                    )}
                    <div>
                      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {exec.action.toUpperCase()} {exec.symbol}
                      </p>
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {new Date(exec.created_date).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {exec.quantity.toFixed(4)} @ ${exec.price.toFixed(2)}
                    </p>
                    {exec.pnl != null && (
                      <p className={`text-sm font-medium ${exec.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        P/L: ${exec.pnl.toFixed(2)}
                      </p>
                    )}
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Signal: {exec.signal}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}