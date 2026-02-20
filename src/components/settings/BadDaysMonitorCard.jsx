import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle, 
  AlertDialogTrigger 
} from "@/components/ui/alert-dialog";
import { ShieldAlert, ShieldCheck, Eye, Clock, RotateCcw } from "lucide-react";
import { useSettings } from "@/components/utils/SettingsContext";

export default function BadDaysMonitorCard() {
  const { settings, updateSetting } = useSettings();
  const [resuming, setResuming] = useState(false);

  const isActive = settings?.bad_days_active === true;
  const isOverridden = settings?.bad_days_override_enabled === true;
  const reason = settings?.bad_days_reason || "Risk limit triggered";
  const triggeredAt = settings?.bad_days_triggered_at;

  const formatTime = (dateStr) => {
    if (!dateStr) return "Unknown";
    const d = new Date(dateStr);
    const tz = settings?.timezone || "America/New_York";
    try {
      return d.toLocaleString("en-US", { 
        timeZone: tz, 
        month: "short", day: "numeric", 
        hour: "numeric", minute: "2-digit", 
        hour12: (settings?.time_format || "12h") !== "24h" 
      });
    } catch { return d.toLocaleString(); }
  };

  // Calculate how long bad days has been active
  const durationText = useMemo(() => {
    if (!triggeredAt) return null;
    const triggeredTime = new Date(triggeredAt).getTime();
    if (isNaN(triggeredTime)) return null;
    const diff = Date.now() - triggeredTime;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }, [triggeredAt]);

  // Toggle bad days mode manually
  const handleToggleBadDays = async (checked) => {
    setResuming(true);
    try {
      if (checked) {
        // Manually activate "bad days" pause
        await updateSetting("bad_days_active", true);
        await updateSetting("bad_days_reason", "Manually paused by user");
        await updateSetting("bad_days_triggered_at", new Date().toISOString());
        await updateSetting("bad_days_override_enabled", false);
      } else {
        // Manually deactivate
        await updateSetting("bad_days_active", false);
        await updateSetting("bad_days_override_enabled", false);
        await updateSetting("bad_days_reason", "");
        await updateSetting("bad_days_triggered_at", "");
      }
    } finally {
      setResuming(false);
    }
  };

  const handleOverrideResume = async () => {
    setResuming(true);
    try {
      await updateSetting("bad_days_override_enabled", true);
    } finally {
      setResuming(false);
    }
  };

  const handleFullReset = async () => {
    setResuming(true);
    try {
      await updateSetting("bad_days_active", false);
      await updateSetting("bad_days_override_enabled", false);
      await updateSetting("bad_days_reason", "");
      await updateSetting("bad_days_triggered_at", "");
    } finally {
      setResuming(false);
    }
  };

  return (
    <Card style={{ 
      backgroundColor: "var(--card-bg)", 
      borderColor: isActive && !isOverridden ? "#ef4444" : "var(--border-color)",
      borderWidth: isActive && !isOverridden ? "2px" : "1px"
    }}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Eye className="w-4 h-4" />
            Trading Safety
          </div>
          {isActive && !isOverridden ? (
            <Badge className="bg-red-500 text-white text-xs">Paused</Badge>
          ) : isActive && isOverridden ? (
            <Badge className="bg-yellow-500 text-white text-xs">Override Active</Badge>
          ) : (
            <Badge className="bg-green-100 text-green-800 text-xs">Normal</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Manual On/Off Switch */}
        <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: "var(--secondary-bg)" }}>
          <div className="flex-1">
            <Label className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Bad Days Pause
            </Label>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {isActive 
                ? "Trading is paused — no new auto-trades will execute"
                : "Trading is active — auto-trader can execute normally"}
            </p>
          </div>
          <Switch
            checked={isActive}
            onCheckedChange={handleToggleBadDays}
            disabled={resuming}
          />
        </div>

        {isActive && !isOverridden ? (
          <>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">
                  Auto-trading paused
                </p>
                <p className="text-xs text-red-600 dark:text-red-300 mt-1">{reason}</p>
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  {triggeredAt && (
                    <p className="text-xs flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                      <Clock className="w-3 h-3" /> Since: {formatTime(triggeredAt)}
                    </p>
                  )}
                  {durationText && (
                    <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      Duration: {durationText}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" className="flex-1 gap-1 bg-yellow-600 hover:bg-yellow-700 text-white">
                    Override & Resume
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Override Trading Pause?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Trading was paused because: <strong>{reason}</strong>
                      {durationText && <><br />Paused for: <strong>{durationText}</strong></>}
                      <br /><br />
                      Overriding will allow the auto-trader to execute trades again despite the risk limit. 
                      The pause will remain recorded but trading will continue.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleOverrideResume} disabled={resuming}>
                      {resuming ? "Resuming..." : "Yes, Override & Resume"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button size="sm" variant="outline" onClick={handleFullReset} disabled={resuming} className="gap-1">
                <RotateCcw className="w-3 h-3" /> Reset
              </Button>
            </div>
          </>
        ) : isActive && isOverridden ? (
          <>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <ShieldAlert className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                  Override active — trading resumed
                </p>
                <p className="text-xs text-yellow-600 dark:text-yellow-300 mt-1">
                  Original reason: {reason}
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  {triggeredAt && (
                    <p className="text-xs flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                      <Clock className="w-3 h-3" /> Triggered: {formatTime(triggeredAt)}
                    </p>
                  )}
                  {durationText && (
                    <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      Pause was active for: {durationText}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={handleFullReset} disabled={resuming} className="w-full gap-1">
              <RotateCcw className="w-3 h-3" /> Clear & Reset to Normal
            </Button>
          </>
        ) : (
          <div className="flex items-center gap-2 p-3 rounded-lg" style={{ backgroundColor: "var(--secondary-bg)" }}>
            <ShieldCheck className="w-5 h-5 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>All clear</p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                No risk limits triggered. Auto-trading can execute normally. Toggle the switch above to manually pause trading on "bad days."
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}