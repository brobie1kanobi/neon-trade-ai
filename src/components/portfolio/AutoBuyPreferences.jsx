import React, { useEffect, useState } from "react";
import { AutoBuyPreference, UserSettings, User } from "@/entities/all";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Plus, Save, RefreshCw, X } from "lucide-react";
import AssetSearchInput from "@/components/common/AssetSearchInput";

// GLOBAL CACHE to prevent duplicate API calls
if (typeof window !== 'undefined') {
  window.__autoBuyCache = window.__autoBuyCache || {
    data: null,
    timestamp: 0,
    inFlight: null
  };
}

const CACHE_TTL = 30000; // 30 seconds

export default function AutoBuyPreferences() {
  const [prefs, setPrefs] = useState([]);
  const [symbol, setSymbol] = useState("");
  const [assetType, setAssetType] = useState("crypto");
  const [percentage, setPercentage] = useState(10);
  const [isSimMode, setIsSimMode] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const cache = window.__autoBuyCache;
      const now = Date.now();

      // CRITICAL: Use cache if available and fresh
      if (cache.data && (now - cache.timestamp) < CACHE_TTL) {
        console.log('[AutoBuyPreferences] Using cached data');
        setPrefs(cache.data.prefs);
        setIsSimMode(cache.data.isSimMode);
        setLoading(false);
        return;
      }

      // CRITICAL: If request in flight, wait for it
      if (cache.inFlight) {
        console.log('[AutoBuyPreferences] Request in flight, waiting...');
        try {
          const result = await cache.inFlight;
          setPrefs(result.prefs);
          setIsSimMode(result.isSimMode);
          setLoading(false);
          return;
        } catch (e) {
          console.error('[AutoBuyPreferences] In-flight request failed:', e);
        }
      }

      setLoading(true);

      // Create fetch promise
      const fetchPromise = (async () => {
        try {
          // CRITICAL: Parallel queries with 2-second timeouts
          const [me, settings] = await Promise.all([
            Promise.race([
              User.me(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('User timeout')), 2000))
            ]),
            Promise.race([
              (async () => {
                const u = await User.me();
                return UserSettings.filter({ created_by: u.email });
              })(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Settings timeout')), 2000))
            ])
          ]);

          const sim = (settings[0]?.sim_trading_mode !== false);
          
          const list = await Promise.race([
            AutoBuyPreference.filter({ created_by: me.email, is_simulation: sim }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Preferences timeout')), 2000))
          ]);

          const result = {
            prefs: list,
            isSimMode: sim
          };

          // Update cache
          cache.data = result;
          cache.timestamp = Date.now();
          cache.inFlight = null;

          return result;

        } catch (error) {
          cache.inFlight = null;
          throw error;
        }
      })();

      // Store in-flight request
      cache.inFlight = fetchPromise;

      try {
        const result = await fetchPromise;
        setPrefs(result.prefs);
        setIsSimMode(result.isSimMode);
      } catch (error) {
        console.error('[AutoBuyPreferences] Load error:', error);
        
        // Use cached data if available (even if stale)
        if (cache.data) {
          console.log('[AutoBuyPreferences] Using stale cache due to error');
          setPrefs(cache.data.prefs);
          setIsSimMode(cache.data.isSimMode);
        }
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const addPref = async () => {
    if (!symbol) return;
    
    try {
      const me = await User.me();
      const created = await AutoBuyPreference.create({
        symbol: symbol.toUpperCase(),
        asset_type: assetType,
        percentage: Math.max(10, Number(percentage) || 10),
        enabled: true,
        is_simulation: isSimMode,
        created_by: me.email
      });
      
      setPrefs((prev) => [created, ...prev]);
      
      // Invalidate cache
      window.__autoBuyCache.data = null;
      window.__autoBuyCache.timestamp = 0;
      
      setSymbol("");
      setPercentage(10);
    } catch (error) {
      console.error('[AutoBuyPreferences] Add error:', error);
    }
  };

  const toggleEnabled = async (pref) => {
    try {
      const updated = await AutoBuyPreference.update(pref.id, { enabled: !pref.enabled });
      setPrefs((prev) => prev.map(p => p.id === pref.id ? { ...p, enabled: updated.enabled } : p));
      
      // Invalidate cache
      window.__autoBuyCache.data = null;
      window.__autoBuyCache.timestamp = 0;
    } catch (error) {
      console.error('[AutoBuyPreferences] Toggle error:', error);
    }
  };

  const updatePercentage = async (pref, pct) => {
    const value = Math.max(10, Number(pct) || 10);
    
    try {
      const updated = await AutoBuyPreference.update(pref.id, { percentage: value });
      setPrefs((prev) => prev.map(p => p.id === pref.id ? { ...p, percentage: updated.percentage } : p));
      
      // Invalidate cache
      window.__autoBuyCache.data = null;
      window.__autoBuyCache.timestamp = 0;
    } catch (error) {
      console.error('[AutoBuyPreferences] Update error:', error);
    }
  };

  const deletePref = async (pref) => {
    try {
      await AutoBuyPreference.delete(pref.id);
      setPrefs((prev) => prev.filter(p => p.id !== pref.id));
      
      // Invalidate cache
      window.__autoBuyCache.data = null;
      window.__autoBuyCache.timestamp = 0;
    } catch (error) {
      console.error('[AutoBuyPreferences] Delete error:', error);
    }
  };

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between" style={{ color: 'var(--text-primary)' }}>
          <span className="flex items-center gap-2">
            Auto-Buy Preferences
            {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {isSimMode ? 'Demo Mode' : 'Live Mode'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <AssetSearchInput 
            value={symbol} 
            onChange={setSymbol} 
            assetType={assetType}
            placeholder={assetType === "crypto" ? "Search crypto (e.g., BTC)" : "Search stock (e.g., AAPL)"}
          />
          <Select value={assetType} onValueChange={setAssetType}>
            <SelectTrigger><SelectValue placeholder="Asset Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="crypto">Crypto</SelectItem>
              <SelectItem value="stock">Stock</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative">
            <Input type="number" min={10} value={percentage} onChange={(e) => setPercentage(e.target.value)} className="pt-5" />
            <span className="absolute top-1 left-3 text-xs" style={{ color: 'var(--text-secondary)' }}>% of cash (min 10%)</span>
          </div>
          <Button onClick={addPref} className="gap-2" disabled={!symbol || loading}>
            <Plus className="w-4 h-4" /> Add
          </Button>
        </div>

        <div className="space-y-2">
          {loading && prefs.length === 0 ? (
            <div className="flex justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : prefs.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No auto-buy assets yet. Add some above.</p>
          ) : (
            prefs.map((p) => (
              <div
                key={p.id}
                className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-lg"
                style={{ backgroundColor: 'var(--secondary-bg)' }}
              >
                <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{p.symbol}</div>
                  <div className="text-xs uppercase" style={{ color: 'var(--text-secondary)' }}>{p.asset_type}</div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-between sm:justify-end">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={10}
                      className="w-20 sm:w-24"
                      value={p.percentage}
                      onChange={(e) => updatePercentage(p, e.target.value)}
                    />
                    <span className="text-xs hidden sm:inline" style={{ color: 'var(--text-secondary)' }}>% of cash</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs hidden sm:inline" style={{ color: 'var(--text-secondary)' }}>Enabled</span>
                    <Switch
                      className="shrink-0"
                      checked={!!p.enabled}
                      onCheckedChange={() => toggleEnabled(p)}
                    />
                  </div>

                  <button
                    onClick={() => deletePref(p)}
                    className="p-1 rounded hover:bg-red-500/20 transition-colors"
                    title="Remove auto-buy"
                  >
                    <X className="w-4 h-4 text-red-400 hover:text-red-300" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="text-xs flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
          <Save className="w-3 h-3" /> Changes save automatically.
        </div>
      </CardContent>
    </Card>
  );
}