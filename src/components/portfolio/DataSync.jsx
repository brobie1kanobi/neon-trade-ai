
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, Database } from "lucide-react";
import { Trade, Holding, User, UserSettings, HoldingsSnapshot } from "@/entities/all";

export default function DataSync({ onSyncComplete }) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");

  const EPS = 1e-8; // Epsilon for floating point comparisons to avoid issues with near-zero quantities

  const syncHoldingsFromTrades = async () => {
    setIsSyncing(true);
    setSyncStatus("Analyzing your trade history...");

    try {
      const currentUser = await User.me();
      const settingsList = await UserSettings.filter({ created_by: currentUser.email });
      const simMode = (settingsList?.[0]?.sim_trading_mode !== false);

      // Fetch trades for current mode, requesting them ordered by created_date
      // The backend should return them ordered, but we add a client-side sort for robustness.
      let allTrades = await Trade.filter({ created_by: currentUser.email, is_simulation: simMode }, "created_date");
      // Ensure allTrades is an array and sort ascending by created_date
      allTrades = Array.isArray(allTrades) ? allTrades : [];
      allTrades.sort((a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime());

      setSyncStatus(`Found ${allTrades.length} ${simMode ? 'simulation' : 'live'} trades. Rebuilding holdings with cost-basis logic...`);

      // Rebuild holdings using average cost method for cost basis
      // When selling, the cost basis is reduced by the average cost of the shares sold,
      // not by the sale proceeds.
      const state = {}; // symbol -> { qty, total_cost, asset_type }
      for (const t of allTrades) {
        const sym = (t.symbol || "").toUpperCase();
        if (!sym) continue; // Skip trades without a symbol

        const qty = Number(t.quantity) || 0;
        const price = Number(t.price) || 0;
        const type = (t.type || "").toLowerCase();

        if (!state[sym]) {
          state[sym] = { qty: 0, total_cost: 0, asset_type: t.asset_type || "crypto" };
        } else if (!state[sym].asset_type && t.asset_type) {
          // If asset_type was not set yet (e.g. first trade for this symbol had no asset_type), try to set it
          state[sym].asset_type = t.asset_type;
        }

        if (type === "buy") {
          state[sym].qty += qty;
          state[sym].total_cost += qty * price;
        } else if (type === "sell") {
          const currentQty = state[sym].qty;
          const currentCost = state[sym].total_cost;
          
          // Calculate average cost per share before the sale
          const avgCost = currentQty > EPS ? (currentCost / currentQty) : 0;

          // Determine the actual quantity being sold (cannot sell more than owned)
          const sellQty = Math.min(qty, Math.max(0, currentQty)); 
          
          // Reduce total cost by the average cost of the sold shares
          const costReduction = sellQty * avgCost;

          state[sym].qty = Math.max(0, currentQty - sellQty); // Ensure quantity doesn't go negative
          state[sym].total_cost = Math.max(0, currentCost - costReduction); // Ensure total_cost doesn't go negative
        }
      }

      // Build final holdings list from the calculated state with sane averages
      const validHoldings = Object.entries(state)
        .map(([symbol, s]) => {
          const qty = Number(s.qty) || 0;
          const cost = Number(s.total_cost) || 0;
          if (qty <= EPS) return null; // Filter out holdings with effectively zero quantity
          
          const avg = cost > EPS ? (cost / qty) : 0; // Avoid division by zero if cost is zero but qty is not

          return {
            symbol,
            asset_type: s.asset_type || "crypto", // Default to 'crypto' if not specified
            quantity: qty,
            average_cost_price: avg
          };
        })
        .filter(Boolean); // Remove null entries (holdings with zero quantity)

      // SAFETY: Snapshot current holdings before modifying anything
      setSyncStatus("Creating safety backup of current holdings...");
      const existingHoldings = await Holding.filter({ created_by: currentUser.email, is_simulation: simMode });
      await HoldingsSnapshot.create({
        is_simulation: simMode,
        holdings_json: JSON.stringify(existingHoldings || []), // Store the JSON representation of existing holdings
        note: `Auto-backup before DataSync rewrite for ${simMode ? 'simulation' : 'live'} mode`,
        created_at: new Date().toISOString(),
        created_by: currentUser.email
      });

      // Clear only holdings for the current mode before creating new ones
      setSyncStatus(`Clearing old ${simMode ? 'simulation' : 'live'} holdings data...`);
      for (const h of (existingHoldings || [])) {
        await Holding.delete(h.id);
      }

      // Create new holding records based on the rebuilt state
      setSyncStatus(`Applying ${validHoldings.length} holding record(s)...`);
      for (const h of validHoldings) {
        await Holding.create({ 
          ...h, 
          is_simulation: simMode, 
          created_by: currentUser.email 
        });
      }

      setSyncStatus(`✅ Sync complete! Rebuilt ${validHoldings.length} holdings using correct cost basis.`);
      if (onSyncComplete) setTimeout(onSyncComplete, 1000);

      // Notify rest of the app to refresh data
      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { type: 'sync', source: 'datasync' } }));

    } catch (error) {
      console.error("Sync error:", error);
      setSyncStatus(`❌ Sync failed: ${error.message}`);
    }
    setIsSyncing(false);
  };

  return (
    <Card className="mb-4" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Database className="w-5 h-5 neon-text" />
          Portfolio Data Sync
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Safely rebuild holdings from your trades. A backup snapshot is created automatically before any change. This process correctly calculates your cost basis, ensuring accurate portfolio tracking.
        </p>

        {syncStatus && (
          <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{syncStatus}</p>
          </div>
        )}

        <Button
          onClick={syncHoldingsFromTrades}
          disabled={isSyncing}
          className="w-full neon-glow bg-green-600 hover:bg-green-700"
        >
          {isSyncing ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Syncing...
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              Sync Portfolio Data
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
