
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { X, Calendar, Hash, DollarSign, Package, Banknote, TrendingUp, TrendingDown } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { useSettings } from "@/components/utils/SettingsContext"; // Updated import path

export default function TradeDetailsModal({ trade, isOpen, onClose }) {
  // Move hook before any early returns to satisfy React rules
  const { settings } = useSettings();

  if (!trade) return null;

  const is24h = (settings?.time_format || "12h") === "24h";
  const fullFmt = is24h ? "MMM d, yyyy 'at' HH:mm:ss" : "MMM d, yyyy 'at' h:mm:ss a";

  const details = [
    { icon: Calendar, label: "Date & Time", value: format(new Date(trade.created_date), fullFmt) },
    { icon: Hash, label: "Asset", value: `${trade.symbol} (${trade.asset_type.toUpperCase()})` },
    { icon: trade.type === 'buy' ? TrendingUp : TrendingDown, label: "Type", value: trade.type.toUpperCase(), color: trade.type === 'buy' ? 'text-green-500' : 'text-red-500' },
    { icon: Package, label: "Quantity", value: trade.quantity },
    { icon: DollarSign, label: "Price per unit", value: `$${trade.price.toFixed(2)}` },
    { icon: DollarSign, label: "Total Value", value: `$${trade.total_value.toFixed(2)}` },
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
