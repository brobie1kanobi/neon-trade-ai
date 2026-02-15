import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Brain, 
  TrendingUp, 
  TrendingDown,
  Target,
  Clock,
  BarChart3
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { ModelPerformance } from "@/entities/all";

export default function AIPerformancePanel() {
  const [performance, setPerformance] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPerformance = async () => {
      try {
        const records = await ModelPerformance.list('-created_date', 100);
        
        if (records.length === 0) {
          setPerformance({ noData: true });
          setLoading(false);
          return;
        }

        // Calculate metrics
        const completedTrades = records.filter(r => r.exit_price);
        const wins = completedTrades.filter(r => r.is_success);
        const winRate = completedTrades.length > 0 
          ? (wins.length / completedTrades.length * 100) 
          : 0;

        const avgReturn = completedTrades.length > 0
          ? completedTrades.reduce((sum, r) => sum + (r.outcome_percentage || 0), 0) / completedTrades.length
          : 0;

        const avgHoldTime = completedTrades.length > 0
          ? completedTrades.reduce((sum, r) => sum + (r.duration_held_minutes || 0), 0) / completedTrades.length
          : 0;

        // Calculate by signal type
        const bySignalType = {};
        for (const r of completedTrades) {
          const type = r.signal_type || 'unknown';
          if (!bySignalType[type]) {
            bySignalType[type] = { total: 0, wins: 0, totalReturn: 0 };
          }
          bySignalType[type].total++;
          if (r.is_success) bySignalType[type].wins++;
          bySignalType[type].totalReturn += r.outcome_percentage || 0;
        }

        // Recent trades
        const recentTrades = records.slice(0, 5);

        setPerformance({
          totalTrades: records.length,
          completedTrades: completedTrades.length,
          winRate,
          avgReturn,
          avgHoldTimeMinutes: avgHoldTime,
          bySignalType,
          recentTrades
        });
      } catch (e) {
        console.error('Failed to fetch performance:', e);
        setPerformance({ error: e.message });
      } finally {
        setLoading(false);
      }
    };

    fetchPerformance();
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center text-gray-500">
            <Brain className="w-5 h-5 animate-pulse mr-2" />
            Loading AI performance data...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (performance?.error || performance?.noData) {
    return (
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Brain className="w-5 h-5" />
            AI Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No performance data yet</p>
            <p className="text-xs">Data will appear after AI-executed trades complete</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatDuration = (minutes) => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
    return `${Math.round(minutes / 1440)}d`;
  };

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Brain className="w-5 h-5" />
          AI Performance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-gray-500">Win Rate</span>
            </div>
            <p className={`text-xl font-bold ${performance.winRate >= 50 ? 'text-green-500' : 'text-red-500'}`}>
              {performance.winRate.toFixed(1)}%
            </p>
          </div>

          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <div className="flex items-center gap-2 mb-1">
              {performance.avgReturn >= 0 ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
              <span className="text-xs text-gray-500">Avg Return</span>
            </div>
            <p className={`text-xl font-bold ${performance.avgReturn >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {performance.avgReturn >= 0 ? '+' : ''}{performance.avgReturn.toFixed(2)}%
            </p>
          </div>

          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-gray-500">Avg Hold</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {formatDuration(performance.avgHoldTimeMinutes)}
            </p>
          </div>

          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-orange-500" />
              <span className="text-xs text-gray-500">Total Trades</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {performance.completedTrades}
            </p>
          </div>
        </div>

        {/* Performance by Signal Type */}
        {performance.bySignalType && Object.keys(performance.bySignalType).length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
              Performance by Signal Type
            </h4>
            <div className="space-y-2">
              {Object.entries(performance.bySignalType).map(([type, data]) => {
                const typeWinRate = data.total > 0 ? (data.wins / data.total * 100) : 0;
                const typeAvgReturn = data.total > 0 ? (data.totalReturn / data.total) : 0;
                
                return (
                  <div 
                    key={type}
                    className="flex items-center justify-between p-2 rounded-lg"
                    style={{ backgroundColor: 'var(--secondary-bg)' }}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">
                        {type.replace(/_/g, ' ')}
                      </Badge>
                      <span className="text-xs text-gray-500">
                        {data.total} trades
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className={typeWinRate >= 50 ? 'text-green-500' : 'text-red-500'}>
                        {typeWinRate.toFixed(0)}% win
                      </span>
                      <span className={typeAvgReturn >= 0 ? 'text-green-500' : 'text-red-500'}>
                        {typeAvgReturn >= 0 ? '+' : ''}{typeAvgReturn.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Trades */}
        {performance.recentTrades?.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
              Recent AI Trades
            </h4>
            <div className="space-y-2">
              {performance.recentTrades.map((trade, idx) => (
                <div 
                  key={idx}
                  className="flex items-center justify-between p-2 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--secondary-bg)' }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      {trade.asset_symbol}
                    </span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {trade.signal_type}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    {trade.outcome_percentage !== undefined && (
                      <span className={trade.is_success ? 'text-green-500' : 'text-red-500'}>
                        {trade.outcome_percentage >= 0 ? '+' : ''}{trade.outcome_percentage?.toFixed(2)}%
                      </span>
                    )}
                    {trade.exit_reason && (
                      <Badge variant="secondary" className="text-xs">
                        {trade.exit_reason}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}