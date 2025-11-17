import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Play, Pause, TrendingUp, BarChart3, Settings, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import StrategyBuilder from '../components/strategies/StrategyBuilder';
import StrategyDetails from '../components/strategies/StrategyDetails';
import BacktestResults from '../components/strategies/BacktestResults';

export default function TradingStrategies() {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [showBacktest, setShowBacktest] = useState(false);
  const [backtestResults, setBacktestResults] = useState(null);

  useEffect(() => {
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    try {
      setLoading(true);
      const data = await base44.entities.TradingStrategy.list('-created_date');
      setStrategies(data || []);
    } catch (error) {
      console.error('Failed to load strategies:', error);
      toast.error('Failed to load strategies');
    } finally {
      setLoading(false);
    }
  };

  const toggleStrategy = async (strategyId, currentState) => {
    try {
      await base44.entities.TradingStrategy.update(strategyId, {
        is_active: !currentState
      });
      toast.success(!currentState ? 'Strategy activated' : 'Strategy paused');
      loadStrategies();
    } catch (error) {
      toast.error('Failed to toggle strategy');
    }
  };

  const runBacktest = async (strategy) => {
    try {
      toast.info('Running backtest...');
      const result = await base44.functions.invoke('strategyBacktest', {
        strategy_id: strategy.id,
        initial_capital: 10000
      });
      
      if (result?.data?.backtest) {
        setBacktestResults(result.data.backtest);
        setShowBacktest(true);
        toast.success('Backtest complete');
      }
    } catch (error) {
      toast.error('Backtest failed');
    }
  };

  const deleteStrategy = async (strategyId) => {
    if (!confirm('Delete this strategy?')) return;
    
    try {
      await base44.entities.TradingStrategy.delete(strategyId);
      toast.success('Strategy deleted');
      loadStrategies();
    } catch (error) {
      toast.error('Failed to delete strategy');
    }
  };

  if (showBuilder) {
    return (
      <StrategyBuilder
        onClose={() => setShowBuilder(false)}
        onSave={() => {
          setShowBuilder(false);
          loadStrategies();
        }}
      />
    );
  }

  if (selectedStrategy) {
    return (
      <StrategyDetails
        strategy={selectedStrategy}
        onClose={() => setSelectedStrategy(null)}
        onUpdate={loadStrategies}
      />
    );
  }

  if (showBacktest && backtestResults) {
    return (
      <BacktestResults
        results={backtestResults}
        onClose={() => setShowBacktest(false)}
      />
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Trading Strategies
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Automate your trading with technical indicators
          </p>
        </div>
        <Button
          onClick={() => setShowBuilder(true)}
          className="bg-green-600 hover:bg-green-700 neon-glow"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Strategy
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="w-8 h-8 border-4 border-green-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : strategies.length === 0 ? (
        <Card style={{ backgroundColor: 'var(--card-bg)' }}>
          <CardContent className="p-12 text-center">
            <BarChart3 className="w-16 h-16 mx-auto mb-4 opacity-50" style={{ color: 'var(--text-secondary)' }} />
            <h3 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              No Strategies Yet
            </h3>
            <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
              Create your first automated trading strategy with technical indicators
            </p>
            <Button onClick={() => setShowBuilder(true)} className="bg-green-600 hover:bg-green-700">
              <Plus className="w-4 h-4 mr-2" />
              Create Strategy
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {strategies.map((strategy) => (
            <motion.div
              key={strategy.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                          {strategy.name}
                        </h3>
                        {strategy.is_active ? (
                          <Badge className="bg-green-100 text-green-800">Active</Badge>
                        ) : (
                          <Badge variant="outline">Inactive</Badge>
                        )}
                        <Badge variant="outline">{strategy.mode}</Badge>
                      </div>
                      <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                        {strategy.description || 'No description'}
                      </p>
                      <div className="flex items-center gap-4 text-sm">
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Symbols: {strategy.symbols?.join(', ')}
                        </span>
                        <span style={{ color: 'var(--text-secondary)' }}>•</span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Type: {strategy.asset_type}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleStrategy(strategy.id, strategy.is_active)}
                      >
                        {strategy.is_active ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedStrategy(strategy)}
                      >
                        <Settings className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteStrategy(strategy.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total Trades</p>
                      <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                        {strategy.total_trades || 0}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Win Rate</p>
                      <p className="text-lg font-bold text-green-500">
                        {strategy.win_rate?.toFixed(1) || 0}%
                      </p>
                    </div>
                    <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total P/L</p>
                      <p className={`text-lg font-bold ${(strategy.total_pnl || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        ${strategy.total_pnl?.toFixed(2) || '0.00'}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Last Run</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {strategy.last_run ? new Date(strategy.last_run).toLocaleDateString() : 'Never'}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => runBacktest(strategy)}
                      className="flex-1"
                    >
                      <BarChart3 className="w-4 h-4 mr-2" />
                      Run Backtest
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedStrategy(strategy)}
                      className="flex-1"
                    >
                      <TrendingUp className="w-4 h-4 mr-2" />
                      View Details
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}