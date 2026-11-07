import React from "react";

// Collapse a raw rejection message into a readable group label.
function reasonLabel(t) {
  const raw = (t.risk_rejection_reason || t.status || "Unknown").toString();
  const s = raw.toLowerCase();
  if (s.includes("websocket token") || s.includes("unknown key")) return "Kraken trading key not accepted (WebSocket token)";
  if (s.includes("insufficient")) return "Insufficient funds";
  if (s.includes("lockout") || s.includes("rate limit")) return "Kraken rate limit / lockout";
  if (s.includes("minimum") || s.includes("volume")) return "Below minimum order size";
  if (s.includes("exposure")) return "Max asset exposure reached";
  if (s.includes("loss cap") || s.includes("daily loss")) return "Daily loss cap";
  if (s.includes("drawdown")) return "Max drawdown reached";
  if (s.includes("confidence")) return "Confidence too low";
  if (s === "failed" || s === "rejected") return `Trade ${s} (no reason recorded)`;
  return raw.length > 80 ? raw.slice(0, 80) + "…" : raw;
}

export default function BlockReasonsList({ trades }) {
  const groups = {};
  for (const t of trades || []) {
    const k = reasonLabel(t);
    groups[k] = (groups[k] || 0) + 1;
  }
  const rows = Object.entries(groups).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mt-3 pt-3 border-t space-y-1.5" style={{ borderColor: "var(--border-color)" }}>
      <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Block reasons (24h)</p>
      {rows.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>No blocked trades in the last 24 hours.</p>
      ) : (
        rows.map(([label, count]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-xs">
            <span style={{ color: "var(--text-primary)" }}>{label}</span>
            <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-medium">{count}</span>
          </div>
        ))
      )}
    </div>
  );
}