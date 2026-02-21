import React, { useState, useEffect } from "react";
import { useSettings } from "@/components/utils/SettingsContext";
import { AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

export default function LossCapHaltStatus() {
  const { settings, updateSetting } = useSettings();
  const [now, setNow] = useState(Date.now());
  const [resuming, setResuming] = useState(false);

  // Tick every 30 seconds to update countdown
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  if (!settings) return null;

  const isHalted = settings.bad_days_active === true;
  const triggeredAt = settings.bad_days_triggered_at ? new Date(settings.bad_days_triggered_at).getTime() : 0;
  const haltHours = Math.min(24, Math.max(6, settings.loss_cap_halt_hours || 12));
  const haltDurationMs = haltHours * 60 * 60 * 1000;
  const resumeAtMs = triggeredAt + haltDurationMs;
  const reason = settings.bad_days_reason || "Daily loss cap exceeded";

  // Auto-resume check (frontend side - backend also checks)
  useEffect(() => {
    if (isHalted && triggeredAt > 0 && now >= resumeAtMs) {
      updateSetting("bad_days_active", false);
    }
  }, [isHalted, triggeredAt, now, resumeAtMs, updateSetting]);

  const handleManualResume = async () => {
    setResuming(true);
    try {
      await updateSetting("bad_days_active", false);
      await updateSetting("bad_days_override_enabled", false);
    } finally {
      setResuming(false);
    }
  };

  // Currently halted
  if (isHalted) {
    const remaining = Math.max(0, resumeAtMs - now);
    const remainingHours = Math.floor(remaining / 3600000);
    const remainingMins = Math.floor((remaining % 3600000) / 60000);
    const triggeredDate = triggeredAt > 0 ? format(new Date(triggeredAt), "MMM d, h:mm a") : "Unknown";
    const resumeDate = triggeredAt > 0 ? format(new Date(resumeAtMs), "MMM d, h:mm a") : "Unknown";

    return (
      <div className="rounded-lg p-3 border space-y-2" style={{ backgroundColor: "rgba(239, 68, 68, 0.1)", borderColor: "rgba(239, 68, 68, 0.3)" }}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <span className="text-sm font-semibold text-red-400">Trading Halted</span>
        </div>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{reason}</p>
        <div className="text-xs space-y-1" style={{ color: "var(--text-secondary)" }}>
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>Triggered: {triggeredDate}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>Auto-resumes: {resumeDate} ({remainingHours}h {remainingMins}m remaining)</span>
          </div>
          <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Halt duration: {haltHours} hours
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleManualResume}
          disabled={resuming}
          className="w-full mt-1 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
        >
          {resuming ? "Resuming..." : "Override & Resume Now"}
        </Button>
      </div>
    );
  }

  // Show last halt info if it happened recently (within 48h)
  if (triggeredAt > 0 && (now - triggeredAt) < 48 * 60 * 60 * 1000) {
    const triggeredDate = format(new Date(triggeredAt), "MMM d, h:mm a");
    return (
      <div className="rounded-lg p-3 border" style={{ backgroundColor: "rgba(34, 197, 94, 0.05)", borderColor: "rgba(34, 197, 94, 0.2)" }}>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Last halt: {triggeredDate} — {reason}. Trading resumed.
          </span>
        </div>
      </div>
    );
  }

  return null;
}