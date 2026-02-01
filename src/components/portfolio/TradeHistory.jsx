import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, ArrowUpRight, ArrowDownRight } from "lucide-react";
import TradeDetailsModal from "../dashboard/TradeDetailsModal";
import { useSettings } from "@/components/utils/SettingsContext";

// Format date in user's timezone - CRITICAL for accurate time display
const formatInTimezone = (date, timezone, is24h) => {
  try {
    const tz = timezone && timezone.length > 0 ? timezone : 'America/New_York';
    
    let dateObj;
    if (typeof date === 'number') {
      dateObj = new Date(date);
    } else if (typeof date === 'string') {
      if (date.endsWith('Z') || date.match(/[+-]\d{2}:?\d{2}$/)) {
        dateObj = new Date(date);
      } else if (date.includes('T')) {
        dateObj = new Date(date + 'Z');
      } else {
        dateObj = new Date(date);
      }
    } else {
      dateObj = new Date(date);
    }

    const options = {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      hour: is24h ? '2-digit' : 'numeric',
      minute: '2-digit',
      hour12: !is24h
    };
    return dateObj.toLocaleString('en-US', options);
  } catch (e) {
    console.error('[TradeHistory] formatInTimezone error:', e);
    return new Date(date).toLocaleString();
  }
};

export default function TradeHistory({ trades }) {
  const [selectedTrade, setSelectedTrade] = useState(null);
  const { settings, isLoading: settingsLoading } = useSettings();
  const is24h = (settings?.time_format || "12h") === "24h";
  const timezone = (!settingsLoading && settings?.timezone) ? settings.timezone : 'America/New_York';

  const formatDisplayQuantity = (quantity) => {
    if (quantity > 0 && quantity < 0.001) {
      return '< 0.001';
    }
    // For numbers like 1.0000, show as 1. For 1.2300 show as 1.23
    return parseFloat(quantity.toFixed(4));
  };

  if (trades.length === 0) {
    return (
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <History className="w-5 h-5 neon-text" />
            Trade History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p style={{ color: 'var(--text-secondary)' }}>
              No trades yet. Execute your first trade above!
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <TradeDetailsModal 
        trade={selectedTrade} 
        isOpen={!!selectedTrade} 
        onClose={() => setSelectedTrade(null)} 
      />
      
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <History className="w-5 h-5 neon-text" />
            Trade History
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {trades.map((trade) => (
            <button
              key={trade.id} 
              onClick={() => setSelectedTrade(trade)}
              className="w-full text-left flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
               style={{ 
                 backgroundColor: 'var(--secondary-bg)', 
                 borderColor: 'var(--border-color)' 
               }}>
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
                  <div className="flex items-center gap-2">
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      {trade.symbol}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {trade.asset_type}
                    </Badge>
                    {trade.is_auto_trade && (
                      <Badge className="text-xs bg-blue-100 text-blue-800">AI</Badge>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {formatInTimezone(trade.created_date, timezone, is24h)}
                  </p>
                </div>
              </div>
              
              <div className="text-right">
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  {trade.type === 'buy' ? '-' : '+'}${trade.total_value.toFixed(2)}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {formatDisplayQuantity(trade.quantity)} @ ${trade.price.toFixed(2)}
                </p>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>
    </>
  );
}