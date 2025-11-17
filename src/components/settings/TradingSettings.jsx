
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Bot, Zap, TestTube2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function TradingSettings({ 
  autoTradingEnabled, 
  onToggleAutoTrading,
  simTradingMode,
  onToggleSimTrading,
  user
}) {
  const [showDevTooltip, setShowDevTooltip] = useState(false);
  const isAdmin = user?.role === 'admin';
  const isCreator = !!user?.is_creator;
  const canToggleSim = isAdmin || isCreator;

  const handleSimToggle = async (value) => {
    // Only admin or creator can toggle; others stay locked to Simulation
    if (!canToggleSim) {
      setShowDevTooltip(true);
      setTimeout(() => setShowDevTooltip(false), 2500);
      return;
    }

    // Update the setting (default is true until first manual toggle, ensured by entity defaults)
    await onToggleSimTrading(value);

    // Hint mode locally for any immediate logic if needed
    try { localStorage.setItem('nt_sim_trading_mode', value ? 'sim' : 'live'); } catch (_e) {}

    // Hard refresh so ALL pages re-mount and load correct mode-specific data (wallet, holdings, trades, charts)
    setTimeout(() => {
      // Full reload ensures every page and data source picks up new mode
      window.location.reload();
    }, 700);
  };

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Bot className="w-5 h-5 neon-text" />
          Trading Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="sim-trading" className="flex items-center gap-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
              <TestTube2 className="w-4 h-4" />
              Simulation Mode
              {canToggleSim ? (
                <Badge className="bg-purple-100 text-purple-800 border-purple-200">Admin/Creator</Badge>
              ) : (
                <Badge className="bg-blue-100 text-blue-800 border-blue-200">Locked</Badge>
              )}
            </Label>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {canToggleSim
                ? 'Admins and the app creator can switch between Simulation and Live to test the Coinbase integration.'
                : 'Currently locked to simulation while we finalize live trading.'}
            </p>
          </div>
          <TooltipProvider>
            <Tooltip open={showDevTooltip && !canToggleSim}>
              <TooltipTrigger asChild>
                <div>
                  <Switch
                    id="sim-trading"
                    checked={!!simTradingMode}
                    onCheckedChange={handleSimToggle}
                    disabled={!canToggleSim}
                    className={!canToggleSim ? "opacity-50" : ""}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent 
                side="left" 
                className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4 rounded-lg shadow-xl max-w-xs border-0"
              >
                <div className="text-center space-y-2">
                  <div className="text-lg font-bold">🚀 Live Trading Coming Soon!</div>
                  <div className="text-sm">We’re testing with admins and the creator now. You’ll get access soon.</div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="auto-trading" className="flex items-center gap-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
              <Zap className="w-4 h-4" />
              Automated Trading
              {autoTradingEnabled &&
              <Badge className="bg-green-100 text-green-800 border-green-200">
                  Active
                </Badge>
              }
            </Label>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Allow AI to execute trades based on your configured margins.
            </p>
          </div>
          <Switch
            id="auto-trading"
            checked={autoTradingEnabled}
            onCheckedChange={onToggleAutoTrading} />
        </div>
        
        {autoTradingEnabled &&
        <div className="bg-orange-400/20 text-zinc-900 p-3 rounded-lg border border-yellow-200 dark:border-yellow-700">
            <p className="text-sm text-yellow-600 dark:text-yellow-200">⚠️ AI trading is active. Trades will execute automatically when your gain/loss margins are reached.
          </p>
          </div>
        }
      </CardContent>
    </Card>);
}
