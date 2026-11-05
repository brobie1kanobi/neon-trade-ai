import React from "react";
import { CheckCircle, AlertCircle, Clock } from "lucide-react";

// Shows where a signal came from and whether the auto-trader can act on it —
// the same status the trader checks before buying.
export default function SignalStatusLine({ signal }) {
  const complete = signal.analysis_status === 'complete';
  const at = signal.signal_generated_at ? new Date(signal.signal_generated_at) : null;
  const mins = at ? Math.max(0, Math.round((Date.now() - at.getTime()) / 60000)) : null;
  const Icon = complete ? CheckCircle : AlertCircle;

  return (
    <div className="mb-3 space-y-1 text-xs">
      <div className="flex items-center justify-between gap-2" style={{ color: 'var(--text-secondary)' }}>
        <span className={`flex items-center gap-1 ${complete ? 'text-green-500' : 'text-yellow-500'}`}>
          <Icon className="w-3 h-3" />
          {complete ? 'Full analysis' : 'Incomplete data — not traded'}
        </span>
        {mins != null &&
        <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {mins < 1 ? 'just now' : `${mins} min ago`}
          </span>
        }
      </div>
      {signal.non_actionable_reason &&
      <p style={{ color: 'var(--text-secondary)' }}>Why no trade: {signal.non_actionable_reason}</p>
      }
    </div>);
}