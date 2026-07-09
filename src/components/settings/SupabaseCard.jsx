import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Database, Loader2, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function SupabaseCard() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);

  const handleSync = async () => {
    setSyncing(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke('syncToSupabase', {});
      const data = res?.data || res;
      if (data?.success) {
        setResult(data);
        toast.success(`Synced ${data.total_synced} records to Supabase`, {
          description: data.total_errors > 0 ? `${data.total_errors} error(s)` : 'All entities synced successfully'
        });
      } else {
        toast.error(data?.error || 'Sync failed');
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to sync to Supabase');
    }
    setSyncing(false);
  };

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader className="flex flex-row items-center gap-4">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(var(--neon-green-rgb), 0.1)' }}>
          <Database className="w-5 h-5" style={{ color: 'var(--neon-green)' }} />
        </div>
        <div className="flex-1">
          <CardTitle className="text-base" style={{ color: 'var(--text-primary)' }}>Supabase Sync</CardTitle>
          <CardDescription style={{ color: 'var(--text-secondary)' }}>
            Push all entity data to your Supabase database
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Syncs wallets, trades, holdings, signals, ledger entries, and 15+ other entity tables to Supabase using incremental cursors. Only new or updated records are pushed.
        </p>

        <Button
          onClick={handleSync}
          disabled={syncing}
          variant="ghost"
          className="bg-lime-600 px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg w-full sm:w-auto justify-center"
        >
          {syncing ? (
            <Loader2 className="w-4 h-4 animate-spin neon-text" />
          ) : (
            <RefreshCw className="w-4 h-4 neon-text" />
          )}
          <span className="text-xs font-medium neon-text">
            {syncing ? 'Syncing...' : 'Update Supabase'}
          </span>
        </Button>

        {result && (
          <div
            className="flex items-start gap-3 p-3 rounded-lg border"
            style={{
              borderColor: result.total_errors > 0 ? '#f59e0b' : 'var(--neon-green)',
              backgroundColor: result.total_errors > 0 ? 'rgba(245,158,11,0.05)' : 'rgba(var(--neon-green-rgb), 0.05)'
            }}
          >
            {result.total_errors > 0 ? (
              <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0 text-yellow-500" />
            ) : (
              <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: 'var(--neon-green)' }} />
            )}
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {result.total_errors > 0 ? 'Sync completed with errors' : 'Sync successful!'}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                {result.total_synced} records synced
                {result.total_errors > 0 && ` · ${result.total_errors} error(s)`}
              </p>
              {result.summary && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {result.summary.filter(s => s.synced > 0).map((s, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
                      {s.entity}: {s.synced}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}