import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function OrderSyncButton({ isSimMode, onSyncComplete, disabled, className }) {
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    if (isSimMode || isSyncing) return;
    
    setIsSyncing(true);
    try {
      const res = await base44.functions.invoke('syncKrakenOrders', {});
      const data = res?.data || res;
      
      if (data?.success) {
        const updates = data.reactivated + data.cancelled;
        if (updates > 0) {
          toast.success(`Synced ${updates} order(s) with Kraken`);
        } else {
          toast.success('All orders in sync with Kraken');
        }
        
        if (onSyncComplete) {
          onSyncComplete();
        }
      } else {
        toast.error('Sync failed', { description: data?.error });
      }
    } catch (err) {
      console.error('[OrderSync] Error:', err);
      toast.error('Sync failed', { description: err.message });
    } finally {
      setIsSyncing(false);
    }
  };

  if (isSimMode) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleSync}
      disabled={disabled || isSyncing}
      className={`text-xs px-2 ${className || ''}`}
    >
      <RefreshCw className={`w-3 h-3 mr-1 ${isSyncing ? 'animate-spin' : ''}`} />
      {isSyncing ? 'Syncing...' : 'Sync Kraken'}
    </Button>
  );
}