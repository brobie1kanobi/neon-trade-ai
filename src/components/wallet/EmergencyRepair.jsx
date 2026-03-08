import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, CheckCircle2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

// Component disabled per product decision: negative-balance emergency banner removed.
export default function EmergencyRepair({ wallet, isSimMode, onRepairComplete }) {
  return null;
}
  const [isRepairing, setIsRepairing] = useState(false);
  const [repairStatus, setRepairStatus] = useState(null);

  const currentBalance = isSimMode ? (wallet?.cash_balance || 0) : (wallet?.real_cash_balance || 0);
  const isNegative = currentBalance < 0;

  if (!isNegative) {
    return null; // Don't show if balance is positive
  }

  const handleRepair = async () => {
    setIsRepairing(true);
    setRepairStatus("Analyzing all transactions and trades...");

    try {
      const mode = isSimMode ? 'sim' : 'real';
      
      setRepairStatus("Recalculating correct balance...");
      const { data } = await base44.functions.invoke('reconcileWallet', { mode });

      if (data?.success) {
        setRepairStatus("✅ Repair completed successfully!");
        
        toast.success("Wallet Repaired", {
          description: `Your ${isSimMode ? 'simulation' : 'real'} wallet balance has been recalculated and corrected.`
        });

        // Wait a moment then reload
        setTimeout(() => {
          if (onRepairComplete) {
            onRepairComplete();
          } else {
            window.location.reload();
          }
        }, 2000);
      } else {
        throw new Error(data?.error || "Repair failed");
      }
    } catch (error) {
      console.error("Repair error:", error);
      setRepairStatus(null);
      toast.error("Repair Failed", {
        description: error.message || "Failed to repair wallet. Please contact support."
      });
    } finally {
      setIsRepairing(false);
    }
  };

  return (
    <Card className="border-red-500 border-2 bg-red-50 dark:bg-red-950/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
          <AlertTriangle className="w-5 h-5" />
          Emergency: Negative Balance Detected
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-red-600 dark:text-red-300">
          <p className="font-semibold mb-2">Your wallet balance is negative: ${Math.abs(currentBalance).toFixed(2)}</p>
          <p>This indicates a data inconsistency. Click the button below to recalculate your wallet balance from all transactions and trades.</p>
        </div>

        {repairStatus && (
          <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-sm flex items-center gap-2">
            {repairStatus.includes("✅") ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <RefreshCw className="w-4 h-4 animate-spin" />
            )}
            {repairStatus}
          </div>
        )}

        <Button
          onClick={handleRepair}
          disabled={isRepairing}
          className="w-full bg-red-600 hover:bg-red-700 text-white"
          size="lg"
        >
          {isRepairing ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Repairing Wallet...
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              Repair Wallet Balance
            </>
          )}
        </Button>

        <p className="text-xs text-gray-600 dark:text-gray-400">
          This will recalculate your balance by analyzing all completed deposits, withdrawals, buys, and sells. Your trade history will not be affected.
        </p>
      </CardContent>
    </Card>
  );
}