import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Brain, 
  TrendingUp, 
  TrendingDown,
  Target,
  Clock,
  BarChart3,
  RefreshCw,
  DollarSign
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { useSettings } from "@/components/utils/SettingsContext";

export default function AIPerformancePanel() {
  const [performance, setPerformance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { settings } = useSettings();

  const fetchPerformance = async () => {
    try {
      // Fetch all auto trades (the REAL data source)
      const allTrades = await base44.entities.Trade.filter(
        { is_auto_trade: true },
        '-created_date',
        200
      );

      if (allTrades.length === 0) {
        setPerformance({ noData: true });
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // Separate buy and sell trades
      const buyTrades = allTrades.filter(t => t.type === 'buy');
      const sellTrades = allTrades.filter(t => t.type === 'sell');

      // Find completed round-trips (buy + sell of same symbol)
      const completedTrades = [];
      const sellsBySymbol = {};
      for (const sell of sellTrades) {
        if (!sellsBySymbol[sell.symbol]) sellsBySymbol[sell.symbol] = [];
        sellsBySymbol[sell.symbol].push(sell);
      }

      for (const buy of buyTrades) {
        const sells = sellsBySymbol[buy.symbol] || [];
        const matchingSell = sells.find(s => 
          new Date(s.created_date) > new Date(buy.created_date)
        );
        if (matchingSell) {
          const pctReturn = ((matchingSell.price - buy.price) / buy.price) * 100;
          const holdMs = new Date(matchingSell.created_date) - new Date(buy.created_date);
          completedTrades.push({
            symbol: buy.symbol,
            asset_type: buy.asset_type,
            entry_price: buy.price,
            exit_price: matchingSell.price,
            quantity: buy.quantity,
            buy_value: buy.total_value,
            sell_value: matchingSell.total_value,
            pct_return: pctReturn,
            is_win: pctReturn > 0,
            hold_minutes: holdMs / 60000,
            is_simulation: buy.is_simulation,
            buy_date: buy.created_date,
            sell_date: matchingSell.created_date
          });
          // Remove matched sell so it's not reused
          sells.splice(sells.indexOf(matchingSell), 1);
        }
      }

      // Calculate open positions (buys without matching sells)
      const openPositions = buyTrades.length - completedTrades.length;

      // Key metrics
      const wins = completedTrades.filter(t => t.is_win);
      const winRate = completedTrades.length > 0 
        ? (wins.length / completedTrades.length * 100) 
        : 0;

      const avgReturn = completedTrades.length > 0
        ? completedTrades.reduce((sum, t) => sum + t.pct_return, 0) / completedTrades.length
        : 0;

      const totalPnL = completedTrades.reduce((sum, t) => sum + (t.sell_value - t.buy_value), 0);

      const avgHoldTime = completedTrades.length > 0
        ? completedTrades.reduce((sum, t) => sum + t.hold_minutes, 0) / completedTrades.length
        : 0;

      const totalInvested = buyTrades.reduce((sum, t) => sum + (t.total_value || 0), 0);

      // Performance by symbol
      const bySymbol = {};
      for (const t of completedTrades) {
        if (!bySymbol[t.symbol]) {
          bySymbol[t.symbol] = { total: 0, wins: 0, totalReturn: 0, totalPnL: 0 };
        }
        bySymbol[t.symbol].total++;
        if (t.is_win) bySymbol[t.symbol].wins++;
        bySymbol[t.symbol].totalReturn += t.pct_return;
        bySymbol[t.symbol].totalPnL += (t.sell_value - t.buy_value);
      }

      // Time-based breakdown
      const now = new Date();
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
      const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
      
      const trades24h = allTrades.filter(t => new Date(t.created_date) > oneDayAgo);
      const tradesWeek = allTrades.filter(t => new Date(t.created_date) > oneWeekAgo);

      // Recent trades (last 5)
      const recentTrades = allTrades.slice(0, 8);

      setPerformance({
        totalTrades: allTrades.length,
        totalBuys: buyTrades.length,
        totalSells: sellTrades.length,
        completedRoundTrips: completedTrades.length,
        openPositions,
        winRate,
        avgReturn,
        totalPnL,
        totalInvested,
        avgHoldTimeMinutes: avgHoldTime,
        bySymbol,
        recentTrades,
        trades24h: trades24h.length,
        tradesWeek: tradesWeek.length,
        liveTrades: allTrades.filter(t => !t.is_simulation).length,
        simTrades: allTrades.filter(t => t.is_simulation).length
      });
    } catch (e) {
      console.error('Failed to fetch AI performance:', e);
      setPerformance({ error: e.message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPerformance();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchPerformance();
  };

  if (loading) {
    return (
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardContent className="p-6">
          <div className="flex items-center justify-center" style={{ color: 'var(--text-secondary)' }}>
            <Brain className="w-5 h-5 animate-pulse mr-2" />
            Loading AI performance data...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (performance?.noData) {
    return (
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Brain className="w-5 h-5" />
            AI Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
            <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No AI trades recorded yet</p>
            <p className="text-xs">Enable auto-trading in Settings to get started</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (performance?.error) {
    return (
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Brain className="w-5 h-5" />
            AI Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-red-500 text-sm">
            Failed to load: {performance.error}
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatDuration = (minutes) => {
    if (!minutes || minutes === 0) return '—';
    if (minutes < 60) return `${Math.round(minutes)}m`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
    return `${Math.round(minutes / 1440)}d`;
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Brain className="w-5 h-5" />
          AI Performance
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-blue-500" />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Total AI Trades</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {performance.totalTrades}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {performance.trades24h} today · {performance.tradesWeek} this week
            </p>
          </div>

          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-purple-500" />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Win Rate</span>
            </div>
            <p className={`text-xl font-bold ${performance.completedRoundTrips > 0 ? (performance.winRate >= 50 ? 'text-green-500' : 'text-red-500') : ''}`}
               style={performance.completedRoundTrips === 0 ? { color: 'var(--text-primary)' } : {}}>
              {performance.completedRoundTrips > 0 ? `${performance.winRate.toFixed(1)}%` : '—'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {performance.completedRoundTrips} closed · {performance.openPositions} open
            </p>
          </div>

          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-green-500" />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Total Invested</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              ${performance.totalInvested.toFixed(2)}
            </p>
            {performance.completedRoundTrips > 0 && (
              <p className={`text-xs ${performance.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                PnL: {performance.totalPnL >= 0 ? '+' : ''}${performance.totalPnL.toFixed(2)}
              </p>
            )}
          </div>

          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-orange-500" />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Avg Hold</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {formatDuration(performance.avgHoldTimeMinutes)}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {performance.liveTrades} live · {performance.simTrades} sim
            </p>
          </div>
        </div>

        {/* Performance by Symbol */}
        {performance.bySymbol && Object.keys(performance.bySymbol).length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
              Closed Trades by Asset
            </h4>
            <div className="space-y-2">
              {Object.entries(performance.bySymbol)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([symbol, data]) => {
                  const symbolWinRate = data.total > 0 ? (data.wins / data.total * 100) : 0;
                  const symbolAvgReturn = data.total > 0 ? (data.totalReturn / data.total) : 0;

                  return (
                    <div
                      key={symbol}
                      className="flex items-center justify-between p-2 rounded-lg"
                      style={{ backgroundColor: 'var(--secondary-bg)' }}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          {symbol}
                        </Badge>
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {data.total} trades
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className={symbolWinRate >= 50 ? 'text-green-500' : 'text-red-500'}>
                          {symbolWinRate.toFixed(0)}% win
                        </span>
                        <span className={data.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}>
                          {data.totalPnL >= 0 ? '+' : ''}${data.totalPnL.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Recent AI Trades */}
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
                    <span className="font-medium font-mono" style={{ color: 'var(--text-primary)' }}>
                      {trade.symbol}
                    </span>
                    <Badge 
                      variant="outline" 
                      className={`text-xs ${trade.type === 'buy' ? 'text-green-600 border-green-600' : 'text-red-600 border-red-600'}`}
                    >
                      {trade.type.toUpperCase()}
                    </Badge>
                    {!trade.is_simulation && (
                      <Badge className="bg-blue-100 text-blue-800 text-xs">LIVE</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span style={{ color: 'var(--text-primary)' }}>
                      ${(trade.total_value || 0).toFixed(2)}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {formatDate(trade.created_date)}
                    </span>
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