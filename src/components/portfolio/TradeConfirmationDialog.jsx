import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter } from
"@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Bot } from 'lucide-react';

export default function TradeConfirmationDialog({ isOpen, onClose, tradeDetails, onConfirm }) {
  const [setConditional, setSetConditional] = useState(false);

  const handleConfirm = () => {
    onConfirm(tradeDetails, setConditional);
  };

  if (!tradeDetails) return null;

  const isBuy = tradeDetails.type === 'buy';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {if (!open) {setSetConditional(false);onClose();}}}>
      <DialogContent className="sm:max-w-[425px]" style={{ backgroundColor: 'var(--card-bg)' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-yellow-500" />
            Confirm Trade
          </DialogTitle>
          <DialogDescription>
            Please review the details below before executing this trade.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex justify-between items-center text-sm">
            <span style={{ color: 'var(--text-secondary)' }}>Action</span>
            <Badge variant={isBuy ? 'default' : 'destructive'} className={isBuy ? 'bg-green-600' : 'bg-red-600'}>
              {tradeDetails.type.toUpperCase()} {tradeDetails.symbol}
            </Badge>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span style={{ color: 'var(--text-secondary)' }}>Quantity</span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{tradeDetails.quantity.toFixed(6)}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span style={{ color: 'var(--text-secondary)' }}>Price</span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>${tradeDetails.price.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center text-lg font-bold">
            <span style={{ color: 'var(--text-secondary)' }}>Total</span>
            <span className="neon-text">${tradeDetails.total_value.toFixed(2)}</span>
          </div>
        </div>

        {isBuy &&
        <div className="bg-slate-700 p-3 flex items-start space-x-3 rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
                <Checkbox
            id="conditional-sell"
            checked={setConditional}
            onCheckedChange={setSetConditional} />

                <div className="grid gap-1.5 leading-none">
                    <label htmlFor="conditional-sell" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2">
                      <Bot className="w-4 h-4" />
                      Set AI Stop-Sell Order
                    </label>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        After this purchase, an automatic sell order will be placed based on your gain/loss margins.
                    </p>
                </div>
            </div>
        }

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="bg-red-600 px-4 py-2 text-sm font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input hover:bg-accent hover:text-accent-foreground h-10">Cancel</Button>
          <Button onClick={handleConfirm} className="neon-glow bg-green-600 hover:bg-green-700">
            Confirm & Execute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>);

}