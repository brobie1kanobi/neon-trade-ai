import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Save, RotateCcw, Info, AlertTriangle, Clock } from "lucide-react";
import { useSettings } from "@/components/utils/SettingsContext";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import LossCapHaltStatus from "../portfolio/LossCapHaltStatus";

const DEFAULTS = {
  max_asset_exposure_percent: 25,
  max_single_trade_percent: 20,
  daily_loss_cap_percent: 5,
  max_drawdown_percent: 15,
  loss_cap_halt_hours: 12,
  bad_days_active: false
};

export default function RiskManagementSettings() {
  const { settings, updateSetting } = useSettings();
  const [values, setValues] = useState({ ...DEFAULTS });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setValues({
      max_asset_exposure_percent: settings.max_asset_exposure_percent ?? DEFAULTS.max_asset_exposure_percent,
      max_single_trade_percent: settings.max_single_trade_percent ?? DEFAULTS.max_single_trade_percent,
      daily_loss_cap_percent: settings.daily_loss_cap_percent ?? DEFAULTS.daily_loss_cap_percent,
      max_drawdown_percent: settings.max_drawdown_percent ?? DEFAULTS.max_drawdown_percent,
      loss_cap_halt_hours: settings.loss_cap_halt_hours ?? DEFAULTS.loss_cap_halt_hours,
      bad_days_active: settings.bad_days_active ?? DEFAULTS.bad_days_active
    });
  }, [settings]);

  const handleChange = (key, raw) => {
    const num = parseFloat(raw);
    if (isNaN(num)) return;
    setValues(prev => ({ ...prev, [key]: Math.max(1, Math.min(100, num)) }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        Object.entries(values).map(([key, val]) => updateSetting(key, val))
      );
      toast.success("Risk parameters saved");
    } catch (e) {
      toast.error("Failed to save: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setValues({ ...DEFAULTS });
  };

  const isDirty = Object.entries(values).some(
    ([key, val]) => val !== (settings?.[key] ?? DEFAULTS[key])
  );

  const fields = [
    {
      key: "max_asset_exposure_percent",
      label: "Max Asset Exposure",
      desc: "Maximum percentage of portfolio allocated to a single asset. Lower = more diversified.",
      suffix: "%"
    },
    {
      key: "max_single_trade_percent",
      label: "Max Single Trade",
      desc: "Maximum percentage of available cash used in a single trade. Lower = smaller positions.",
      suffix: "%"
    },
    {
      key: "daily_loss_cap_percent",
      label: "Daily Loss Cap",
      desc: "Stop all trading after this percentage of daily loss. Protects against bad days.",
      suffix: "%"
    },
    {
      key: "max_drawdown_percent",
      label: "Max Drawdown",
      desc: "Maximum portfolio drawdown from peak before halting trading.",
      suffix: "%"
    }
  ];

  return (
    <Card style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--border-color)" }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Shield className="w-5 h-5 neon-text" />
            Risk Management
          </CardTitle>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="w-7 h-7">
                <Info className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 text-xs" style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--border-color)" }}>
              <p className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>How Risk Parameters Work</p>
              <p style={{ color: "var(--text-secondary)" }}>
                These parameters are checked by the Risk Engine before every auto-trade. If a proposed trade would exceed any limit, it is rejected. Adjust these to control how aggressively the AI trades.
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Loss Cap Halt Status Banner */}
        <LossCapHaltStatus />

        {/* Bad Days Mode Toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: "var(--border-color)", backgroundColor: "var(--secondary-bg)" }}>
          <div className="space-y-0.5">
            <Label className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Bad Days Mode
            </Label>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Manually toggle the trading halt. When active, auto-trading is paused.
            </p>
          </div>
          <Switch
            checked={values.bad_days_active}
            onCheckedChange={(checked) => setValues(prev => ({ ...prev, bad_days_active: checked }))}
          />
        </div>

        {fields.map(({ key, label, desc, suffix }) => (
          <div key={key} className="space-y-1">
            <Label className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              {label}
              <Badge variant="outline" className="text-xs">{suffix}</Badge>
            </Label>
            <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{desc}</p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={100}
                step={1}
                value={values[key]}
                onChange={(e) => handleChange(key, e.target.value)}
                className="w-24 text-center"
                style={{ backgroundColor: "var(--secondary-bg)", color: "var(--text-primary)", borderColor: "var(--border-color)" }}
              />
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>%</span>
              <span className="text-xs ml-auto" style={{ color: "var(--text-secondary)" }}>
                Default: {DEFAULTS[key]}%
              </span>
            </div>
          </div>
        ))}

        {/* Loss Cap Halt Duration Slider */}
        <div className="space-y-1 pt-2 border-t" style={{ borderColor: "var(--border-color)" }}>
          <Label className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Clock className="w-4 h-4" style={{ color: "var(--neon-green)" }} />
            Loss Cap Halt Duration
          </Label>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            How long to pause trading after the daily loss cap is hit. Trading auto-resumes after this period.
          </p>
          <div className="flex items-center gap-3">
            <Slider
              value={[values.loss_cap_halt_hours]}
              onValueChange={([val]) => setValues(prev => ({ ...prev, loss_cap_halt_hours: val }))}
              min={6}
              max={24}
              step={1}
              className="flex-1"
            />
            <span className="text-sm font-bold w-16 text-center px-2 py-1 rounded" style={{ backgroundColor: "var(--secondary-bg)", color: "var(--neon-green)" }}>
              {values.loss_cap_halt_hours}h
            </span>
          </div>
          <div className="flex justify-between text-xs" style={{ color: "var(--text-secondary)" }}>
            <span>6 hours</span>
            <span>Default: {DEFAULTS.loss_cap_halt_hours}h</span>
            <span>24 hours</span>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="flex-1 bg-green-600 hover:bg-green-700"
            size="sm"
          >
            <Save className="w-4 h-4 mr-1" />
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button
            onClick={handleReset}
            variant="outline"
            size="sm"
          >
            <RotateCcw className="w-4 h-4 mr-1" />
            Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}