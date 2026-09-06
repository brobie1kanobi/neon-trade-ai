/**
 * IDEAL BUY-IN POINT
 *
 * A market buy fired the moment a signal appears often pays a small premium: the
 * asset has already ticked up over the last 24h and the entry lands near a local
 * high, so the position starts underwater and drifts toward the stop-loss.
 *
 * This computes the price we actually WANT to pay:
 *   - If the AI published an entry zone, its high is the ceiling we'll pay.
 *   - Otherwise, require a small pullback sized to how much the asset already ran.
 *     Flat/quiet assets need no pullback; ones already up 3%+ need the most.
 *
 * A tolerance band keeps this practical — being a hair above the ideal still counts
 * as "at the ideal entry" so orders aren't blocked forever by rounding.
 */

const TOLERANCE_PCT = 0.15; // treat prices within 0.15% above ideal as acceptable

export function requiredPullbackPct(change24h: number): number {
  const chg = Number(change24h || 0);
  if (chg >= 3) return 1.0;
  if (chg >= 1.5) return 0.6;
  if (chg >= 0.5) return 0.3;
  return 0; // flat or slightly down — current price is already a fair entry
}

export function computeIdealEntry(opts: {
  price: number;
  change24h?: number;
  entryZoneLow?: number | null;
  entryZoneHigh?: number | null;
}) {
  const price = Number(opts.price || 0);
  if (!price || price <= 0) {
    return {
      ideal_entry_price: 0,
      max_buy_price: 0,
      at_ideal_entry: false,
      entry_gap_pct: 0,
      required_pullback_pct: 0,
      ideal_entry_source: 'unavailable'
    };
  }

  const pullbackPct = requiredPullbackPct(opts.change24h ?? 0);
  let ideal = price * (1 - pullbackPct / 100);
  let source = pullbackPct > 0 ? 'pullback' : 'market';

  // The AI's entry zone, when it exists and is tighter than our pullback, wins.
  const zoneHigh = Number(opts.entryZoneHigh || 0);
  if (zoneHigh > 0 && zoneHigh < ideal) {
    ideal = zoneHigh;
    source = 'ai_entry_zone';
  }

  const maxBuy = ideal * (1 + TOLERANCE_PCT / 100);
  const gapPct = ((price - ideal) / price) * 100; // how far price must fall, in %

  return {
    ideal_entry_price: ideal,
    max_buy_price: maxBuy,
    at_ideal_entry: price <= maxBuy,
    entry_gap_pct: Math.max(0, gapPct),
    required_pullback_pct: pullbackPct,
    ideal_entry_source: source
  };
}