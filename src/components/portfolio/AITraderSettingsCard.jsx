import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Bot, Save } from "lucide-react";
import { UserSettings, User } from "@/entities/all";
import { notify } from "@/components/utils/notifications";
import { useSettings } from "@/components/utils/SettingsContext";

export default function AITraderSettingsCard() {
  const { settings: ctxSettings } = useSettings();
  const [gainMargin, setGainMargin] = useState(10);
  const [lossMargin, setLossMargin] = useState(5);
  const [autoExecuteThreshold, setAutoExecuteThreshold] = useState(80);
  const [minSignalConfidence, setMinSignalConfidence] = useState(55);
  const [settingsRecord, setSettingsRecord] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await UserSettings.list('-updated_date', 1);
        if (!cancelled && list.length > 0) {
          const s = list[0];
          setSettingsRecord(s);
          setGainMargin(s.gain_margin || 10);
          setLossMargin(s.loss_margin || 5);
          setAutoExecuteThreshold(s.auto_execute_threshold ?? 70);
          setMinSignalConfidence(s.min_signal_confidence ?? 55);
        }
      } catch (e) {
        console.warn('[AITraderSettingsCard] Settings fetch failed:', e.message);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    const currentUser = await User.me();
    const updated = {
      gain_margin: parseFloat(gainMargin),
      loss_margin: parseFloat(lossMargin),
      auto_execute_threshold: autoExecuteThreshold,
      min_signal_confidence: minSignalConfidence,
    };

    if (settingsRecord?.id) {
      await UserSettings.update(settingsRecord.id, updated);
      setSettingsRecord(prev => ({ ...prev, ...updated }));
    } else {
      const newS = await UserSettings.create({ ...updated, created_by: currentUser.email });
      setSettingsRecord(newS);
    }

    notify.success("Trader settings saved", {
      description: "AI trading margins updated successfully"
    });
  };

  const autoTradingEnabled = ctxSettings?.auto_trading_enabled || false;

  return (
    <Card className="border-2" style={{
      backgroundColor: 'var(--card-bg)',
      borderColor: 'var(--neon-green)',
      borderStyle: 'dashed'
    }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Bot className="w-5 h-5 neon-text" />
            AI Trader Settings
          </CardTitle>
          {autoTradingEnabled && (
            <Badge className="bg-green-100 text-green-800 border-green-200">
              AI Trading Active
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <p className="text-xs text-blue-700 dark:text-blue-400">
            💡 These margins control when the AI automatically sells your assets to lock in profits or cut losses.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="ai-gain-margin">Profit Target %</Label>
            <Input
              id="ai-gain-margin"
              type="number"
              step="0.1"
              min="0.1"
              value={gainMargin}
              onChange={(e) => setGainMargin(e.target.value)}
              placeholder="10.0"
            />
            <p className="text-xs text-gray-500 mt-1">AI sells when price gains {gainMargin}%</p>
          </div>
          <div>
            <Label htmlFor="ai-loss-margin">Stop Loss %</Label>
            <Input
              id="ai-loss-margin"
              type="number"
              step="0.1"
              min="0.1"
              value={lossMargin}
              onChange={(e) => setLossMargin(e.target.value)}
              placeholder="5.0"
            />
            <p className="text-xs text-gray-500 mt-1">AI sells when price drops {lossMargin}%</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Auto-Execute Threshold</Label>
            <span className="text-sm font-mono font-bold neon-text">{autoExecuteThreshold}%</span>
          </div>
          <Slider
            value={[autoExecuteThreshold]}
            onValueChange={([v]) => setAutoExecuteThreshold(v)}
            min={50} max={100} step={5}
            className="w-full"
          />
          <p className="text-xs text-gray-500">AI only auto-executes trades when confidence is ≥ {autoExecuteThreshold}%</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Min Signal Confidence</Label>
            <span className="text-sm font-mono font-bold neon-text">{minSignalConfidence}%</span>
          </div>
          <Slider
            value={[minSignalConfidence]}
            onValueChange={([v]) => setMinSignalConfidence(v)}
            min={30} max={90} step={5}
            className="w-full"
          />
          <p className="text-xs text-gray-500">Only show signals with confidence ≥ {minSignalConfidence}%</p>
        </div>

        <Button onClick={handleSave} className="w-full neon-glow bg-green-600 hover:bg-green-700">
          <Save className="w-4 h-4 mr-2" />
          Save Trader Settings
        </Button>
      </CardContent>
    </Card>
  );
}