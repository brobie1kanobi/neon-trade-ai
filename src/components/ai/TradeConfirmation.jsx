
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowUpCircle, ArrowDownCircle, CheckCircle, XCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function TradeConfirmation({ trade, onConfirm, onCancel, isExecuting }) {
  const [status, setStatus] = useState('pending'); // 'pending', 'confirmed', 'cancelled'
  
  const handleConfirm = async () => {
    setStatus('confirmed'); // Set status immediately to 'confirmed'
    try {
      // Assuming 'base44' is globally available or provided via context/prop
      const user = await base44.auth.me();
      const settings = await base44.entities.UserSettings.filter({ created_by: user.email });
      const userSettings = settings[0] || {};

      await onConfirm(trade); // Await the onConfirm callback

      // ABSOLUTE FIX: Only send notification if BOTH toggles are explicitly enabled
      const notificationsEnabled = userSettings?.notifications_enabled === true;
      const tradeNotificationsEnabled = userSettings?.notify_on_trade === true;
      const appInBackground = document.visibilityState === "hidden";

      console.log('[AI ASSISTANT NOTIFICATION CHECK]', {
        notificationsEnabled,
        tradeNotificationsEnabled,
        appInBackground,
        willSend: notificationsEnabled && tradeNotificationsEnabled && appInBackground
      });

      if (notificationsEnabled && tradeNotificationsEnabled && appInBackground) {
        console.log('[AI ASSISTANT] ✅ SENDING push notification');
        base44.functions.invoke("pushNotifications", {
          action: "sendNotification",
          payload: {
            title: `AI Trade Executed • ${trade.trade_details.symbol}`,
            body: `${trade.trade_details.type === "buy" ? "Bought" : "Sold"} ${trade.trade_details.quantity} @ $${trade.trade_details.price.toFixed(2)}`,
            data: { type: "trade", symbol: trade.trade_details.symbol, source: "ai" }
          },
        }).catch((err) => {
          console.error('[AI ASSISTANT] Push notification error:', err);
        });
      } else {
        console.log('[AI ASSISTANT] ❌ BLOCKING push notification');
      }
    } catch (error) {
      console.error("Trade confirmation error:", error);
      setStatus('pending'); // Revert status if an error occurs during async operations
    }
  };
  
  const handleCancel = () => {
    setStatus('cancelled');
    onCancel();
  };
  
  const isBuy = trade.trade_details.type === 'buy';
  
  return (
    <Card className="border-2 border-yellow-200 bg-yellow-50">
      <CardContent className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            isBuy ? 'bg-green-100' : 'bg-red-100'
          }`}>
            {isBuy ? (
              <ArrowUpCircle className="w-5 h-5 text-green-600" />
            ) : (
              <ArrowDownCircle className="w-5 h-5 text-red-600" />
            )}
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-gray-900">Trade Confirmation</h4>
            <p className="text-sm text-gray-600">{trade.text}</p>
          </div>
        </div>
        
        <div className="space-y-2 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Asset:</span>
            <div className="flex items-center gap-2">
              <span className="font-medium">{trade.trade_details.symbol}</span>
              <Badge variant="outline">{trade.trade_details.asset_type}</Badge>
            </div>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Quantity:</span>
            <span className="font-medium">{trade.trade_details.quantity}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Price:</span>
            <span className="font-medium">${trade.trade_details.price}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Total Value:</span>
            <span className="font-medium">${trade.trade_details.total_value}</span>
          </div>
        </div>
        
        {status === 'pending' && (
          <div className="flex gap-2">
            <Button
              onClick={handleConfirm}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            >
              Confirm Trade
            </Button>
            <Button
              onClick={handleCancel}
              variant="outline"
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        )}
        
        {status === 'confirmed' && (
          <div className="flex items-center justify-center gap-2 py-2 text-green-600">
            <CheckCircle className="w-4 h-4" />
            <span className="font-medium">Trade Confirmed - Executing...</span>
          </div>
        )}
        
        {status === 'cancelled' && (
          <div className="flex items-center justify-center gap-2 py-2 text-red-600">
            <XCircle className="w-4 h-4" />
            <span className="font-medium">Trade Cancelled</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
