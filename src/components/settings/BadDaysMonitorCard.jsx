import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { ShieldAlert, ShieldCheck, Play, Eye, Clock } from "lucide-react";
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

  const handleResume = async () => {
    setResuming(true);
    try {
      await updateSetting("bad_days_override_enabled", true);
    } finally {
      setResuming(false);
    }
  };

  const handleReset = async () => {
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
        {isActive && !isOverridden ? (
          <>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-700 dark:text-red-400">
                  Auto-trading paused
                </p>
                <p className="text-xs text-red-600 dark:text-red-300 mt-1">{reason}</p>
                {triggeredAt && (
                  <p className="text-xs mt-1 flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                    <Clock className="w-3 h-3" /> Triggered: {formatTime(triggeredAt)}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" className="flex-1 gap-1 bg-yellow-600 hover:bg-yellow-700 text-white">
                    <Play className="w-3 h-3" /> Resume Trading
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Resume Trading?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Trading was paused because: <strong>{reason}</strong>
                      <br /><br />
                      Resuming will allow the auto-trader to execute trades again despite the risk limit being hit. 
                      This override lasts until the end of the day or until you manually reset it.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleResume} disabled={resuming}>
                      {resuming ? "Resuming..." : "Yes, Resume Trading"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button size="sm" variant="outline" onClick={handleReset} disabled={resuming} className="gap-1">
                Reset
              </Button>
            </div>
          </>
        ) : isActive && isOverridden ? (
          <>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <ShieldAlert className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                  Override active — trading resumed
                </p>
                <p className="text-xs text-yellow-600 dark:text-yellow-300 mt-1">
                  Original reason: {reason}
                </p>
                {triggeredAt && (
                  <p className="text-xs mt-1 flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                    <Clock className="w-3 h-3" /> Triggered: {formatTime(triggeredAt)}
                  </p>
                )}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={handleReset} disabled={resuming} className="w-full gap-1">
              Clear & Reset to Normal
            </Button>
          </>
        ) : (
          <div className="flex items-center gap-2 p-3 rounded-lg" style={{ backgroundColor: "var(--secondary-bg)" }}>
            <ShieldCheck className="w-5 h-5 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>All clear</p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                No risk limits triggered. Trading operating normally.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}