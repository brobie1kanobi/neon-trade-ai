import React, { useMemo, useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, ArrowDownRight, Clock, RefreshCw } from "lucide-react";
import { useSettings } from "@/components/utils/SettingsContext";
import { base44 } from "@/api/base44Client";

// Format date in user's timezone
const formatInTimezone = (date, timezone, is24h) => {
  try {
    // Ensure we have a valid timezone
    const tz = timezone && timezone.length > 0 ? timezone : 'America/New_York';
    const options = {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      hour: is24h ? '2-digit' : 'numeric',
      minute: '2-digit',
      hour12: !is24h
    };
    const result = new Date(date).toLocaleString('en-US', options);
    console.log('[RecentTrades] formatInTimezone:', date, 'tz:', tz, 'result:', result);
    return result;
  } catch (e) {
    console.error('[RecentTrades] formatInTimezone error:', e);
    return new Date(date).toLocaleString();
  }
};

// Normalize Kraken symbol - remove X/Z prefixes and suffixes
const normalizeKrakenSymbol = (symbol) => {
  if (!symbol) return 'UNKNOWN';
  let s = symbol.toUpperCase();
  s = s.replace(/USD$/, '').replace(/ZUSD$/, '').replace(/\/USD$/, '');
  s = s.replace(/^XXBT$/, 'BTC').replace(/^XBT$/, 'BTC').replace(/^XBTC$/, 'BTC');
  s = s.replace(/^XXRP$/, 'XRP').replace(/^XRPZ$/, 'XRP');
  s = s.replace(/^XETH$/, 'ETH').replace(/^XXDG$/, 'DOGE').replace(/^XLTC$/, 'LTC');
  if (s.length > 3 && s.startsWith('X') && /^X[A-Z]/.test(s)) {
    s = s.substring(1);
  }
  if (s.length > 3 && s.endsWith('Z')) {
    s = s.slice(0, -1);
  }
  return s;
};

export default function RecentTrades({ trades, onTradeSelect }) {
  const { settings, isLoading } = useSettings();
  const is24h = (settings?.time_format || "12h") === "24h";
  // CRITICAL: Only use timezone after settings have loaded to avoid showing UTC times
  const timezone = (!isLoading && settings?.timezone) ? settings.timezone : 'America/New_York';
  const isSimMode = settings?.sim_trading_mode !== false;
  
  console.log('[RecentTrades] Settings loaded:', !isLoading, 'timezone:', timezone, 'raw:', settings?.timezone);
  
  const [krakenTrades, setKrakenTrades] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch Kraken trades history in LIVE mode
  const fetchKrakenTrades = useCallback(async () => {
    if (isSimMode) return;
    
    setIsLoading(true);
    try {
      const response = await base44.functions.invoke('krakenApi', { action: 'getTradesHistory' });
      const data = response?.data || response;
      
      if (data?.trades && Array.isArray(data.trades)) {
        // Convert Kraken trades to our format
        const formattedTrades = data.trades.map(kt => {
          const symbol = normalizeKrakenSymbol(kt.pair || '');
          return {
            id: kt.trade_id || kt.ordertxid || `kraken-${kt.time}`,
            symbol: symbol,
            type: kt.type || 'unknown',
            quantity: parseFloat(kt.vol) || 0,
            price: parseFloat(kt.price) || 0,
            total_value: parseFloat(kt.cost) || 0,
            created_date: kt.time ? new Date(kt.time * 1000).toISOString() : new Date().toISOString(),
            is_simulation: false,
            is_auto_trade: false,
            asset_type: 'crypto',
            status: 'executed',
            fee: parseFloat(kt.fee) || 0,
            kraken_trade_id: kt.trade_id
          };
        });
        setKrakenTrades(formattedTrades);
      }
    } catch (err) {
      console.error('[RecentTrades] Kraken fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isSimMode]);

  // Fetch on mount and when mode changes
  useEffect(() => {
    fetchKrakenTrades();
  }, [fetchKrakenTrades]);

  // Merge and sort trades - combine local with Kraken in LIVE mode
  const recentTrades = useMemo(() => {
    const localTrades = Array.isArray(trades) ? trades.filter(t => t.is_simulation === isSimMode) : [];
    
    // In LIVE mode, merge with Kraken trades
    let allTrades = localTrades;
    if (!isSimMode && krakenTrades.length > 0) {
      const mergedTrades = [...localTrades];
      krakenTrades.forEach(kt => {
        // Check for duplicates
        const isDupe = localTrades.some(lt => 
          lt.symbol === kt.symbol && 
          Math.abs(lt.quantity - kt.quantity) < 0.0001 &&
          Math.abs(new Date(lt.created_date).getTime() - new Date(kt.created_date).getTime()) < 60000
        );
        if (!isDupe) {
          mergedTrades.push(kt);
        }
      });
      allTrades = mergedTrades;
    }
    
    return allTrades
      .slice()
      .sort((a, b) => {
        const dateA = new Date(a.created_date || a.date || 0).getTime();
        const dateB = new Date(b.created_date || b.date || 0).getTime();
        return dateB - dateA;
      })
      .slice(0, 5);
  }, [trades, krakenTrades, isSimMode]);

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
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Clock className="w-5 h-5 neon-text" />
            Recent Trades
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchKrakenTrades}
            disabled={isLoading || isSimMode}>
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
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
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{normalizeKrakenSymbol(trade.symbol)}</p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {formatInTimezone(trade.created_date, timezone, is24h)}
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