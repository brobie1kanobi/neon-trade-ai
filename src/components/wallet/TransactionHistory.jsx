import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, ArrowUpCircle, ArrowDownCircle, TrendingUp, TrendingDown } from "lucide-react";
import { useSettings } from "@/components/utils/SettingsContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Format date in user's timezone - CRITICAL: Handle timestamps correctly
const formatInTimezone = (date, timezone, is24h) => {
  try {
    const tz = timezone && timezone.length > 0 ? timezone : 'America/New_York';
    
    // CRITICAL: Parse the date correctly
    // - Unix timestamps (numbers) are already in UTC milliseconds
    // - ISO strings with 'Z' or offset are already UTC-aware
    // - ISO strings WITHOUT 'Z' from Base44 database are stored as UTC
    let dateObj;
    if (typeof date === 'number') {
      dateObj = new Date(date);
    } else if (typeof date === 'string') {
      // If the string has 'Z' or a timezone offset, parse directly
      if (date.endsWith('Z') || date.match(/[+-]\d{2}:?\d{2}$/)) {
        dateObj = new Date(date);
      } else if (date.includes('T')) {
        // Base44 stores dates as UTC but without 'Z' suffix - add it
        dateObj = new Date(date + 'Z');
      } else {
        dateObj = new Date(date);
      }
    } else {
      dateObj = new Date(date);
    }

    const options = {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: is24h ? '2-digit' : 'numeric',
      minute: '2-digit',
      hour12: !is24h
    };
    return dateObj.toLocaleString('en-US', options);
  } catch (e) {
    console.error('[TransactionHistory] formatInTimezone error:', e);
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
  s = s.replace(/^XXLM$/, 'XLM').replace(/^XLMZ$/, 'XLM');
  if (s.length > 3 && s.startsWith('X') && /^X[A-Z]/.test(s)) {
    s = s.substring(1);
  }
  if (s.length > 3 && s.endsWith('Z')) {
    s = s.slice(0, -1);
  }
  return s;
};

export default function TransactionHistory({ transactions, trades, isSimMode = true, krakenTrades = [] }) {
  const { settings, isLoading: settingsLoading } = useSettings();
  const is24h = (settings?.time_format || "12h") === "24h";
  // CRITICAL: Only use timezone after settings load to avoid showing wrong times initially
  const timezone = (!settingsLoading && settings?.timezone) ? settings.timezone : 'America/New_York';
  const [selectedItem, setSelectedItem] = useState(null);

  // CRITICAL: Filter transactions based on current mode
  const filteredTransactions = transactions.filter(tx => {
    // If no is_real_money field exists, assume it's a sim transaction
    const isRealMoney = tx.is_real_money === true;
    
    // Show real money transactions in live mode, sim transactions in sim mode
    return isSimMode ? !isRealMoney : isRealMoney;
  });

  // CRITICAL: Filter trades based on current mode (trades affect cash)
  const filteredTrades = (trades || []).filter(t => t.is_simulation === isSimMode);
  
  // In LIVE mode, also include Kraken trades
  // CRITICAL: Calculate total_value as quantity * price (the ACTUAL trade value)
  const krakenFormattedTrades = !isSimMode && Array.isArray(krakenTrades) ? krakenTrades.map(kt => {
    const symbol = normalizeKrakenSymbol(kt.pair || kt.symbol || '');
    // CRITICAL: Use EXACT values from Kraken API
    const quantity = parseFloat(kt.vol || kt.quantity) || 0;
    const price = parseFloat(kt.price) || 0;
    // CRITICAL FIX: Calculate total from quantity * price (the ACTUAL cash amount)
    // Kraken's 'cost' field can be unreliable for partial fills
    const calculatedTotal = quantity * price;
    const fee = parseFloat(kt.fee) || 0;
    
    return {
      id: kt.trade_id || kt.txid || `kraken-${kt.time}`,
      symbol: symbol,
      type: kt.type || 'unknown',
      quantity: quantity,           // EXACT from Kraken
      price: price,                 // EXACT from Kraken
      total_value: calculatedTotal, // CALCULATED: quantity * price = actual cash
      fee: fee,                     // Fee from Kraken
      // CRITICAL: Kraken 'time' is Unix seconds - convert to ISO string
      created_date: kt.time ? new Date(kt.time * 1000).toISOString() : (kt.created_date || new Date().toISOString()),
      is_simulation: false,
      is_auto_trade: false,
      asset_type: 'crypto',
      status: 'executed',
      itemType: 'trade'
    };
  }) : [];

  // Combine transactions and trades into one timeline
  // CRITICAL: Avoid duplicates when merging Kraken trades with local trades
  const mergedTrades = [...filteredTrades.map(t => ({ ...t, itemType: 'trade' }))];
  
  if (!isSimMode && krakenFormattedTrades.length > 0) {
    krakenFormattedTrades.forEach(kt => {
      // Check for duplicates by comparing symbol, quantity, and time within 60s
      const isDupe = mergedTrades.some(lt => 
        lt.symbol === kt.symbol && 
        Math.abs(lt.quantity - kt.quantity) < 0.0001 &&
        Math.abs(new Date(lt.created_date).getTime() - new Date(kt.created_date).getTime()) < 60000
      );
      if (!isDupe) {
        mergedTrades.push(kt);
      }
    });
  }
  
  const allItems = [
    ...filteredTransactions.map(tx => ({ ...tx, itemType: 'transaction' })),
    ...mergedTrades
  ].sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime());

  if (allItems.length === 0) {
    return (
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <History className="w-5 h-5 neon-text" />
              Cash History
            </CardTitle>
            {isSimMode ? (
              <Badge variant="outline" className="text-xs">Demo</Badge>
            ) : (
              <Badge className="bg-green-100 text-green-800 text-xs">Live</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p style={{ color: 'var(--text-secondary)' }}>
              {isSimMode 
                ? 'No transactions yet. Make your first deposit or trade!' 
                : 'No live transactions yet. Connect your Kraken account to start trading!'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const statusColors = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    completed: "bg-green-100 text-green-800 border-green-200", 
    failed: "bg-red-100 text-red-800 border-red-200",
    executed: "bg-green-100 text-green-800 border-green-200"
  };

  return (
    <>
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <History className="w-5 h-5 neon-text" />
              Cash History
            </CardTitle>
            {isSimMode ? (
              <Badge variant="outline" className="text-xs">Demo</Badge>
            ) : (
              <Badge className="bg-green-100 text-green-800 text-xs">Live</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {allItems.map((item) => {
            const isTrade = item.itemType === 'trade';
            const isTransaction = item.itemType === 'transaction';
            
            if (isTransaction) {
              return (
                <button
                  key={`tx-${item.id}`}
                  onClick={() => setSelectedItem(item)}
                  className="w-full text-left flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  style={{ 
                    backgroundColor: 'var(--secondary-bg)', 
                    borderColor: 'var(--border-color)' 
                  }}>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      item.type === 'deposit' ? 'bg-green-100 dark:bg-green-900' : 'bg-red-100 dark:bg-red-900'
                    }`}>
                      {item.type === 'deposit' ? (
                        <ArrowUpCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <ArrowDownCircle className="w-4 h-4 text-red-600" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                        {item.type}
                        {item.bank_account && item.bank_account !== 'Demo Account' && (
                          <span className="text-xs ml-2 opacity-70">• {item.bank_account}</span>
                        )}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {formatInTimezone(item.created_date, timezone, is24h)}
                      </p>
                    </div>
                  </div>
                  
                  <div className="text-right space-y-1">
                    <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                      {item.type === 'deposit' ? '+' : '-'}${item.amount.toFixed(2)}
                    </p>
                    <Badge variant="outline" className={`text-xs ${statusColors[item.status]}`}>
                      {item.status}
                    </Badge>
                  </div>
                </button>
              );
            } else {
              // Trade item
              const isBuy = item.type === 'buy';
              return (
                <button
                  key={`trade-${item.id}`}
                  onClick={() => setSelectedItem(item)}
                  className="w-full text-left flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  style={{ 
                    backgroundColor: 'var(--secondary-bg)', 
                    borderColor: 'var(--border-color)' 
                  }}>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      isBuy ? 'bg-red-100 dark:bg-red-900' : 'bg-green-100 dark:bg-green-900'
                    }`}>
                      {isBuy ? (
                        <TrendingDown className="w-4 h-4 text-red-600" />
                      ) : (
                        <TrendingUp className="w-4 h-4 text-green-600" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {isBuy ? 'Trade Buy' : 'Trade Sell'} • {item.symbol}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {formatInTimezone(item.created_date, timezone, is24h)}
                      </p>
                    </div>
                  </div>
                  
                  <div className="text-right space-y-1">
                    <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                      {isBuy ? '-' : '+'}${item.total_value.toFixed(2)}
                    </p>
                    <Badge variant="outline" className={`text-xs ${statusColors[item.status]}`}>
                      {item.status}
                    </Badge>
                  </div>
                </button>
              );
            }
          })}
        </CardContent>
      </Card>

      {/* Details Modal */}
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent 
          className="max-w-md"
          style={{ 
            backgroundColor: 'var(--card-bg)',
            borderColor: 'var(--neon-green)',
            borderWidth: '2px'
          }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: 'var(--text-primary)' }}>
              {selectedItem?.itemType === 'trade' ? 'Trade Details' : 'Transaction Details'}
            </DialogTitle>
          </DialogHeader>
          
          {selectedItem && (
            <div className="space-y-4 pt-4">
              {selectedItem.itemType === 'trade' ? (
                <>
                  {/* Trade Details */}
                  <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        selectedItem.type === 'buy' ? 'bg-red-100 dark:bg-red-900' : 'bg-green-100 dark:bg-green-900'
                      }`}>
                        {selectedItem.type === 'buy' ? (
                          <TrendingDown className="w-5 h-5 text-red-600" />
                        ) : (
                          <TrendingUp className="w-5 h-5 text-green-600" />
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>
                          {selectedItem.symbol}
                        </p>
                        <Badge className={selectedItem.type === 'buy' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}>
                          {selectedItem.type.toUpperCase()}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Date</span>
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {formatInTimezone(selectedItem.created_date, timezone, is24h)}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Asset Type</span>
                      <span className="font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                        {selectedItem.asset_type}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Quantity</span>
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {selectedItem.quantity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Price per Unit</span>
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        ${selectedItem.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                      </span>
                    </div>

                    <div className="flex justify-between pt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Cash Impact
                      </span>
                      <span className="font-bold text-lg" style={{ 
                        color: selectedItem.type === 'buy' ? 'rgb(239, 68, 68)' : 'rgb(34, 197, 94)' 
                      }}>
                        {selectedItem.type === 'buy' ? '-' : '+'}${selectedItem.total_value.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Status</span>
                      <Badge variant="outline" className={`text-xs ${statusColors[selectedItem.status]}`}>
                        {selectedItem.status}
                      </Badge>
                    </div>

                    {selectedItem.is_auto_trade && (
                      <div className="pt-2">
                        <Badge className="bg-blue-100 text-blue-800">
                          🤖 Auto-Trade
                        </Badge>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Transaction Details */}
                  <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        selectedItem.type === 'deposit' ? 'bg-green-100 dark:bg-green-900' : 'bg-red-100 dark:bg-red-900'
                      }`}>
                        {selectedItem.type === 'deposit' ? (
                          <ArrowUpCircle className="w-5 h-5 text-green-600" />
                        ) : (
                          <ArrowDownCircle className="w-5 h-5 text-red-600" />
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-lg capitalize" style={{ color: 'var(--text-primary)' }}>
                          {selectedItem.type}
                        </p>
                        <Badge className={selectedItem.type === 'deposit' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                          {selectedItem.type.toUpperCase()}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Date</span>
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {formatInTimezone(selectedItem.created_date, timezone, is24h)}
                      </span>
                    </div>

                    {selectedItem.bank_account && (
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-secondary)' }}>Bank Account</span>
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          {selectedItem.bank_account}
                        </span>
                      </div>
                    )}

                    {selectedItem.reference_id && (
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--text-secondary)' }}>Reference</span>
                        <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                          {selectedItem.reference_id}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between pt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Amount
                      </span>
                      <span className="font-bold text-lg" style={{ 
                        color: selectedItem.type === 'deposit' ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)' 
                      }}>
                        {selectedItem.type === 'deposit' ? '+' : '-'}${selectedItem.amount.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span style={{ color: 'var(--text-secondary)' }}>Status</span>
                      <Badge variant="outline" className={`text-xs ${statusColors[selectedItem.status]}`}>
                        {selectedItem.status}
                      </Badge>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}