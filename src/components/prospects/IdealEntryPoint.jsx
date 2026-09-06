import React from "react";
import { Target, CheckCircle2, ArrowDownRight } from "lucide-react";

const fmt = (n) => {
  const v = Number(n || 0);
  if (v === 0) return "—";
  return v < 1 ? `$${v.toFixed(6)}` : `$${v.toFixed(2)}`;
};

export default function IdealEntryPoint({ prospect }) {
  const ideal = Number(prospect?.ideal_entry_price || 0);
  if (!ideal) return null;

  const atIdeal = prospect.at_ideal_entry === true;
  const gap = Number(prospect.entry_gap_pct || 0);

  return (
    <div
      className={`p-3 rounded-lg border ${
        atIdeal
          ? "bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700"
          : "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700"
      }`}>
      <div className="flex items-center gap-2 mb-1">
        <Target className={`w-3.5 h-3.5 ${atIdeal ? "text-green-600" : "text-amber-600"}`} />
        <p className={`text-xs font-semibold ${atIdeal ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}>
          Ideal Buy-In Point
        </p>
      </div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">{fmt(ideal)}</p>
        <p className={`text-xs ${atIdeal ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
          {atIdeal ? (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Price is at the ideal entry
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <ArrowDownRight className="w-3 h-3" /> Needs −{gap.toFixed(2)}% to reach it
            </span>
          )}
        </p>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        {prospect.ideal_entry_source === "ai_entry_zone"
          ? "Based on the AI's published entry zone — buying above it means paying a premium."
          : Number(prospect.required_pullback_pct || 0) > 0
          ? `${prospect.symbol} already moved ${Number(prospect.market_trend || 0).toFixed(2)}% today, so a ${Number(prospect.required_pullback_pct).toFixed(2)}% pullback is required before the auto-trader buys.`
          : "Price is flat enough that the current market price is a fair entry."}
      </p>
    </div>
  );
}