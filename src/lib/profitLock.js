/**
 * PROFIT LOCK ("take-profit limit")
 *
 * A full take-profit only fires when price reaches the user's target (e.g. +3%).
 * Plenty of positions climb to +2.5% and then roll over, giving the entire gain
 * back before the stop-loss finally sells at a loss.
 *
 * Profit lock closes that gap: once the position has climbed close to the target,
 * it is ARMED. From then on, if price gives back a small slice of the peak, the
 * position is sold immediately while the gain is still on the table.
 *
 * Everything is derived from the user's own gain margin — no new settings:
 *   giveback = max(0.4%, 20% of the target)   → 3% target ⇒ 0.6%
 *   arm      = target - giveback              → 3% target ⇒ armed at +2.4%
 *
 * Uses only prices the app already streams — no extra Kraken calls.
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

  if (peakGainPct < armPct) return null; // never got close enough to the target

  const dropFromPeakPct = ((high - now) / high) * 100;
  if (dropFromPeakPct < giveback) return null; // still holding near the peak

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