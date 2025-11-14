import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownRight, Clock } from "lucide-react";
import { format } from "date-fns";
import { useSettings } from "@/components/utils/SettingsContext";

export default function RecentTrades({ trades, onTradeSelect }) {
  const { settings } = useSettings();
  const is24h = (settings?.time_format || "12h") === "24h";
  const dateFmt = is24h ? "MMM d, HH:mm" : "MMM d, h:mm a";

  // Sort trades by most recent first and take top 5
  const recentTrades = useMemo(() => {
    if (!Array.isArray(trades) || trades.length === 0) return [];
    
    return trades
      .slice() // Create a copy to avoid mutating original array
      .sort((a, b) => {
        const dateA = new Date(a.created_date || a.date || 0).getTime();
        const dateB = new Date(b.created_date || b.date || 0).getTime();
        return dateB - dateA; // Most recent first
      })
      .slice(0, 5); // Take only the 5 most recent
  }, [trades]);

  if (recentTrades.length === 0) {
    return (
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Clock className="w-5 h-5 neon-text" />
            Recent Trades
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p style={{ color: 'var(--text-secondary)' }}>
              No trades yet. Start trading to see your history here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Clock className="w-5 h-5 neon-text" />
          Recent Trades
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {recentTrades.map((trade) => (
          <button 
            key={trade.id} 
            onClick={() => onTradeSelect(trade)}
            className="w-full text-left flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            style={{ backgroundColor: 'var(--secondary-bg)' }}
          >
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                trade.type === 'buy' ? 'bg-green-100 dark:bg-green-900' : 'bg-red-100 dark:bg-red-900'
              }`}>
                {trade.type === 'buy' ? (
                  <ArrowUpRight className="w-4 h-4 text-green-600" />
                ) : (
                  <ArrowDownRight className="w-4 h-4 text-red-600" />
                )}
              </div>
              <div>
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{trade.symbol}</p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {format(new Date(trade.created_date), dateFmt)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                ${trade.total_value.toFixed(2)}
              </p>
              <div className="flex items-center gap-1">
                <Badge variant="outline" className="text-xs">
                  {trade.quantity} @ ${trade.price.toFixed(2)}
                </Badge>
              </div>
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}