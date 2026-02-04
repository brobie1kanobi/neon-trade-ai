import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { X, Calendar, Hash, DollarSign, Package, Banknote, TrendingUp, TrendingDown, Percent } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSettings } from "@/components/utils/SettingsContext";

// Format date in user's timezone
const formatInTimezone = (date, timezone, is24h) => {
  try {
    const tz = timezone && timezone.length > 0 ? timezone : 'America/New_York';
    
    let dateObj;
    if (typeof date === 'string' && date.includes('T') && !date.endsWith('Z') && !date.match(/[+-]\d{2}:?\d{2}$/)) {
      dateObj = new Date(date + 'Z');
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
      second: '2-digit',
      hour12: !is24h
    };
    return dateObj.toLocaleString('en-US', options);
  } catch (e) {
    console.error('[TradeDetailsModal] formatInTimezone error:', e);
    return new Date(date).toLocaleString();
  }
};

export default function TradeDetailsModal({ trade, isOpen, onClose }) {
  // Move hook before any early returns to satisfy React rules
  const { settings } = useSettings();

  if (!trade) return null;

  const is24h = (settings?.time_format || "12h") === "24h";
  const timezone = settings?.timezone || 'America/New_York';

  // CRITICAL: Format quantity and price with appropriate precision
  const formatQuantity = (qty) => {
    if (qty >= 1000) return qty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (qty >= 1) return qty.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    return qty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  };
  
  const formatPrice = (price) => {
    if (price >= 100) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (price >= 1) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
  };

  // CRITICAL: Use trade.total_value if available (comes from Kraken's 'cost' field)
  // This is the EXACT cash impact - don't recalculate
  // For Kraken trades, trade.total_value = exact USD spent/received
  // For local trades, trade.total_value = quantity * price
  const actualCashImpact = trade.total_value || (trade.quantity * trade.price);
  
  // Fee from Kraken if available
  const fee = trade.fee || 0;
  
  // Net cash impact after fees
  const netCashImpact = trade.type === 'buy' 
    ? actualCashImpact + fee  // Buy: you pay price + fee
    : actualCashImpact - fee; // Sell: you receive price - fee

  const details = [
    { icon: Calendar, label: "Date", value: formatInTimezone(trade.created_date, timezone, is24h) },
    { icon: Hash, label: "Asset Type", value: (trade.asset_type || 'crypto').charAt(0).toUpperCase() + (trade.asset_type || 'crypto').slice(1) },
    { icon: Package, label: "Quantity", value: formatQuantity(trade.quantity) },
    { icon: DollarSign, label: "Price per Unit", value: formatPrice(trade.price) },
    { icon: DollarSign, label: "Total Value", value: `${trade.type === 'sell' ? '+' : ''}$${actualCashImpact.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: trade.type === 'sell' ? 'text-green-500' : '' },
  ];
  
  // Add fee if present
  if (fee > 0) {
    details.push({ icon: Percent, label: "Exchange Fee", value: `-$${fee.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`, color: 'text-red-400' });
    details.push({ 
      icon: Banknote, 
      label: trade.type === 'buy' ? "Total Cost" : "Net Proceeds", 
      value: `${trade.type === 'sell' ? '+' : '-'}$${netCashImpact.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      color: trade.type === 'sell' ? 'text-green-500' : 'text-red-500',
      bold: true
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--text-primary)'}}>
            Trade Details
          </DialogTitle>
        </DialogHeader>
        
        {/* Asset header with icon */}
        <div className="flex items-center gap-3 mt-2 pb-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            trade.type === 'buy' ? 'bg-green-100 dark:bg-green-900' : 'bg-red-100 dark:bg-red-900'
          }`}>
            {trade.type === 'buy' ? (
              <TrendingUp className="w-5 h-5 text-green-600" />
            ) : (
              <TrendingDown className="w-5 h-5 text-red-600" />
            )}
          </div>
          <div>
            <p className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{trade.symbol}</p>
            <Badge className={`text-xs ${trade.type === 'buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {trade.type.toUpperCase()}
            </Badge>
          </div>
        </div>
        
        <div className="mt-4 space-y-3">
          {details.map((item, index) => (
            <div key={index} className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <item.icon className={`w-4 h-4 ${item.color || 'neon-text'}`} />
                <span className={`text-sm ${item.bold ? 'font-semibold' : ''}`} style={{ color: 'var(--text-secondary)'}}>{item.label}</span>
              </div>
              <span className={`text-sm ${item.bold ? 'font-bold' : 'font-semibold'} text-right ${item.color || ''}`} style={{ color: item.color ? '' : 'var(--text-primary)' }}>
                {item.value}
              </span>
            </div>
          ))}
           <div className="flex items-start justify-between pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
               <div className="flex items-center gap-3">
                <span className="text-sm" style={{ color: 'var(--text-secondary)'}}>Status</span>
               </div>
               <Badge className={`capitalize ${trade.status === 'executed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                {trade.status}
               </Badge>
           </div>
           
           {trade.is_auto_trade && (
             <div className="flex items-center gap-2 pt-2">
               <Badge className="text-xs bg-blue-100 text-blue-800">🤖 Auto-Trade</Badge>
             </div>
           )}
        </div>
      </DialogContent>
    </Dialog>
  );
}