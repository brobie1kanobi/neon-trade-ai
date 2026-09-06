/**
 * PROFIT LOCK ("take-profit limit") — server-side twin of src/lib/profitLock.js.
 * Both runtimes need identical behaviour but cannot share a module (Deno vs Vite),
 * so keep the two formulas in sync if either changes.
 *
 * Once a position climbs close to the user's take-profit target it is ARMED; if it
 * then gives back a small slice of its peak, it is sold while the gain still exists.
 * Derived purely from the user's gain margin — no new settings, no extra Kraken calls.
 */
export function evaluateProfitLock({ purchasePrice, price, peak, gainMargin }) {
  const entry = Number(purchasePrice || 0);
  const now = Number(price || 0);
  const target = Number(gainMargin || 0);
  if (entry <= 0 || now <= 0 || target <= 0) return null;

  const high = Math.max(Number(peak || 0), entry, now);
  const gainPct = ((now - entry) / entry) * 100;
  const peakGainPct = ((high - entry) / entry) * 100;

  const giveback = Math.max(0.4, target * 0.2);
  const armPct = Math.max(0.6, target - giveback);

  if (peakGainPct < armPct) return null;

  const dropFromPeakPct = ((high - now) / high) * 100;
  if (dropFromPeakPct < giveback) return null;

  // Never let profit lock sell at a loss — that's the stop-loss's job.
  if (gainPct <= 0.2) return null;

  return {
    reason: `Profit Lock (+${gainPct.toFixed(2)}% locked in — peaked at +${peakGainPct.toFixed(2)}%, gave back ${dropFromPeakPct.toFixed(2)}%)`,
    gainPct,
    peakGainPct,
    dropFromPeakPct,
    armPct,
    giveback
  };
}