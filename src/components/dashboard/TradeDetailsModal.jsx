import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { X, Calendar, Hash, DollarSign, Package, Banknote, TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSettings } from "@/components/utils/SettingsContext"; // Updated import path

// Format date in user's timezone
const formatInTimezone = (date, timezone, is24h) => {
  try {
    // Ensure we have a valid timezone
    const tz = timezone && timezone.length > 0 ? timezone : 'America/New_York';
    
    // CRITICAL: Ensure date string is treated as UTC if missing timezone offset
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
    const result = dateObj.toLocaleString('en-US', options);
    // console.log('[TradeDetailsModal] formatInTimezone:', date, '->', dateObj.toISOString(), 'tz:', tz, 'result:', result);
    return result;
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
  // Small quantities (< 1) need more decimals, large quantities need fewer
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

  const details = [
    { icon: Calendar, label: "Date & Time", value: formatInTimezone(trade.created_date, timezone, is24h) },
    { icon: Hash, label: "Asset", value: `${trade.symbol} (${(trade.asset_type || 'crypto').toUpperCase()})` },
    { icon: trade.type === 'buy' ? TrendingUp : TrendingDown, label: "Type", value: trade.type.toUpperCase(), color: trade.type === 'buy' ? 'text-green-500' : 'text-red-500' },
    { icon: Package, label: "Quantity", value: formatQuantity(trade.quantity) },
    { icon: DollarSign, label: "Price per unit", value: formatPrice(trade.price) },
    { icon: DollarSign, label: "Total Value", value: `$${trade.total_value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
    { icon: Banknote, label: "Funding Source", value: "Cash Wallet" },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--text-primary)'}}>
            Trade Details
          </DialogTitle>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          {details.map((item, index) => (
            <div key={index} className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <item.icon className={`w-4 h-4 ${item.color || 'neon-text'}`} />
                <span className="text-sm" style={{ color: 'var(--text-secondary)'}}>{item.label}</span>
              </div>
              <span className={`text-sm font-semibold text-right ${item.color || ''}`} style={{ color: item.color ? '' : 'var(--text-primary)' }}>
                {item.value}
              </span>
            </div>
          ))}
           <div className="flex items-start justify-between">
               <div className="flex items-center gap-3">
                <span className="text-sm" style={{ color: 'var(--text-secondary)'}}>Status</span>
               </div>
               <Badge className={`capitalize ${trade.status === 'executed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                {trade.status}
               </Badge>
           </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}