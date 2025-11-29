import React, { useEffect, useState } from "react";
import { AutoBuyPreference, UserSettings, User } from "@/entities/all";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Save, RefreshCw, Bot, TrendingUp, TrendingDown, ChevronDown, ChevronUp } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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
  const [expandedPref, setExpandedPref] = useState(null);

  useEffect(() => {
    const load = async () => {
      const cache = window.__autoBuyCache;
      const now = Date.now();

      if (cache.data && (now - cache.timestamp) < CACHE_TTL) {
        setPrefs(cache.data.prefs);
        setIsSimMode(cache.data.isSimMode);
        setLoading(false);
        return;
      }

      if (cache.inFlight) {
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

      const fetchPromise = (async () => {
        try {
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

          const result = { prefs: list, isSimMode: sim };
          cache.data = result;
          cache.timestamp = Date.now();
          cache.inFlight = null;
          return result;
        } catch (error) {
          cache.inFlight = null;
          throw error;
        }
      })();

      cache.inFlight = fetchPromise;

      try {
        const result = await fetchPromise;
        setPrefs(result.prefs);
        setIsSimMode(result.isSimMode);
      } catch (error) {
        console.error('[AutoBuyPreferences] Load error:', error);
        if (cache.data) {
          setPrefs(cache.data.prefs);
          setIsSimMode(cache.data.isSimMode);
        }
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const invalidateCache = () => {
    window.__autoBuyCache.data = null;
    window.__autoBuyCache.timestamp = 0;
  };

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
        auto_sell_enabled: true,
        gain_margin: 10,
        loss_margin: 5,
        trailing_stop_enabled: false,
        trailing_stop_percent: 3,
        autonomous_trading: false,
        created_by: me.email
      });
      
      setPrefs((prev) => [created, ...prev]);
      invalidateCache();
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
      invalidateCache();
    } catch (error) {
      console.error('[AutoBuyPreferences] Toggle error:', error);
    }
  };

  const updateField = async (pref, field, value) => {
    try {
      const updated = await AutoBuyPreference.update(pref.id, { [field]: value });
      setPrefs((prev) => prev.map(p => p.id === pref.id ? { ...p, [field]: updated[field] } : p));
      invalidateCache();
    } catch (error) {
      console.error('[AutoBuyPreferences] Update error:', error);
    }
  };

  const toggleAutonomous = async (pref) => {
    try {
      const newValue = !pref.autonomous_trading;
      const updated = await AutoBuyPreference.update(pref.id, { autonomous_trading: newValue });
      setPrefs((prev) => prev.map(p => p.id === pref.id ? { ...p, autonomous_trading: updated.autonomous_trading } : p));
      invalidateCache();
    } catch (error) {
      console.error('[AutoBuyPreferences] Toggle autonomous error:', error);
    }
  };

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between" style={{ color: 'var(--text-primary)' }}>
          <span className="flex items-center gap-2">
            <Bot className="w-5 h-5" />
            Auto-Trading Preferences
            {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {isSimMode ? 'Demo Mode' : 'Live Mode'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add New Preference */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Input 
            placeholder="Symbol (e.g., BTC, ETH)" 
            value={symbol} 
            onChange={(e) => setSymbol(e.target.value.toUpperCase())} 
          />
          <Select value={assetType} onValueChange={setAssetType}>
            <SelectTrigger><SelectValue placeholder="Asset Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="crypto">Crypto</SelectItem>
              <SelectItem value="stock">Stock</SelectItem>
            </SelectContent>
          </Select>
          <Input 
            type="number" 
            min={10} 
            value={percentage} 
            onChange={(e) => setPercentage(e.target.value)} 
            placeholder="% of cash (min 10%)" 
          />
          <Button onClick={addPref} className="gap-2" disabled={!symbol || loading}>
            <Plus className="w-4 h-4" /> Add Asset
          </Button>
        </div>

        {/* Preferences List */}
        <div className="space-y-3">
          {loading && prefs.length === 0 ? (
            <div className="flex justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : prefs.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-secondary)' }}>
              No auto-trading assets configured. Add assets above to enable autonomous trading.
            </p>
          ) : (
            prefs.map((p) => (
              <Collapsible 
                key={p.id} 
                open={expandedPref === p.id}
                onOpenChange={(open) => setExpandedPref(open ? p.id : null)}
              >
                <div
                  className="p-3 rounded-lg border"
                  style={{ backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}
                >
                  {/* Main Row */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {p.symbol}
                      </div>
                      <Badge variant="outline" className="text-xs">{p.asset_type}</Badge>
                      {p.autonomous_trading && (
                        <Badge className="bg-green-100 text-green-800 text-xs flex items-center gap-1">
                          <Bot className="w-3 h-3" /> Auto
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={10}
                          className="w-16"
                          value={p.percentage}
                          onChange={(e) => updateField(p, 'percentage', Math.max(10, Number(e.target.value) || 10))}
                        />
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>%</span>
                      </div>

                      <Switch
                        checked={!!p.enabled}
                        onCheckedChange={() => toggleEnabled(p)}
                      />

                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          {expandedPref === p.id ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                  </div>

                  {/* Expanded Settings */}
                  <CollapsibleContent className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="space-y-4">
                      {/* Autonomous Trading Toggle */}
                      <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'var(--card-bg)' }}>
                        <div className="flex items-center gap-2">
                          <Bot className="w-4 h-4 text-green-500" />
                          <div>
                            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                              Autonomous Trading
                            </p>
                            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                              AI can trade without confirmation
                            </p>
                          </div>
                        </div>
                        <Switch
                          checked={!!p.autonomous_trading}
                          onCheckedChange={() => toggleAutonomous(p)}
                        />
                      </div>

                      {/* Take Profit / Stop Loss */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-green-500" />
                            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Take Profit</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={1}
                              className="w-20"
                              value={p.gain_margin || 10}
                              onChange={(e) => updateField(p, 'gain_margin', Number(e.target.value) || 10)}
                            />
                            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>% gain</span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <TrendingDown className="w-4 h-4 text-red-500" />
                            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Stop Loss</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={1}
                              className="w-20"
                              value={p.loss_margin || 5}
                              onChange={(e) => updateField(p, 'loss_margin', Number(e.target.value) || 5)}
                            />
                            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>% loss</span>
                          </div>
                        </div>
                      </div>

                      {/* Trailing Stop */}
                      <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'var(--card-bg)' }}>
                        <div>
                          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            Trailing Stop
                          </p>
                          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            Lock in profits as price rises
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            className="w-16"
                            disabled={!p.trailing_stop_enabled}
                            value={p.trailing_stop_percent || 3}
                            onChange={(e) => updateField(p, 'trailing_stop_percent', Number(e.target.value) || 3)}
                          />
                          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>%</span>
                          <Switch
                            checked={!!p.trailing_stop_enabled}
                            onCheckedChange={(checked) => updateField(p, 'trailing_stop_enabled', checked)}
                          />
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))
          )}
        </div>

        <div className="text-xs flex items-center gap-2 pt-2" style={{ color: 'var(--text-secondary)' }}>
          <Save className="w-3 h-3" /> Changes save automatically. Enable "Autonomous Trading" per asset to let AI trade without confirmation.
        </div>
      </CardContent>
    </Card>
  );
}