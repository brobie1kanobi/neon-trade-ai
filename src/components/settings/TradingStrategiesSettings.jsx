import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Activity, TrendingUp, BarChart2, LineChart, MessageSquare, History } from "lucide-react";

export default function TradingStrategiesSettings({ settings, onToggle }) {
  const [warning, setWarning] = useState(null);

  const strategies = [
    { key: "strategy_rsi", label: "RSI (Momentum)", icon: Activity, desc: "Relative Strength Index to detect overbought/oversold conditions." },
    { key: "strategy_macd", label: "MACD (Trend)", icon: TrendingUp, desc: "Moving Average Convergence Divergence for trend direction." },
    { key: "strategy_bollinger", label: "Bollinger Bands", icon: BarChart2, desc: "Volatility bands to detect mean reversion and breakouts." },
    { key: "strategy_trend", label: "Trend Alignment", icon: LineChart, desc: "Multi-timeframe trend confirmation (6h and 12h)." },
    { key: "strategy_volume", label: "Volume Confirmation", icon: BarChart2, desc: "Requires increasing volume to confirm price action." },
    { key: "strategy_sentiment", label: "Sentiment Analysis", icon: MessageSquare, desc: "AI analysis of news and social media sentiment." },
    { key: "strategy_history", label: "Historical Performance", icon: History, desc: "Adjusts scores based on past trading success rate." }
  ];

  useEffect(() => {
    if (!settings) return;
    
    // Check compatibility
    const enabledCount = strategies.filter(s => settings[s.key] !== false).length;
    
    let newWarning = null;
    if (enabledCount >= 6) {
      newWarning = "Warning: The currently selected trading styles may be overly restrictive. This configuration could prevent the trader from finding valid buy opportunities.";
    } else if (settings.strategy_bollinger !== false && settings.strategy_trend !== false && settings.strategy_rsi !== false) {
      newWarning = "Warning: This configuration may create conflicting trade filters (e.g., mean reversion vs trend following).";
    }
    
    setWarning(newWarning);
  }, [settings]);

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Activity className="w-5 h-5 text-indigo-500" />
          Trading Strategies
        </CardTitle>
        <CardDescription style={{ color: 'var(--text-secondary)' }}>
          Enable or disable specific trading styles for the AI to consider.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {warning && (
          <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/50 bg-amber-500/10 text-amber-500 mb-4">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p className="text-xs leading-relaxed">{warning}</p>
          </div>
        )}

        <div className="space-y-3">
          {strategies.map(({ key, label, icon: Icon, desc }) => (
            <div key={key} className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--secondary-bg)' }}>
              <div className="space-y-0.5">
                <Label className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Icon className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                  {label}
                </Label>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {desc}
                </p>
              </div>
              <Switch
                checked={settings?.[key] !== false}
                onCheckedChange={(checked) => onToggle(key, checked)}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}