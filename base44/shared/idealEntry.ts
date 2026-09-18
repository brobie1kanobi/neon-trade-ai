/**
 * IDEAL BUY-IN POINT
 *
 * A market buy fired the moment a signal appears often pays a small premium: the
 * asset has already ticked up over the last 24h and the entry lands near a local
 * high, so the position starts underwater and drifts toward the stop-loss.
 *
 * CRITICAL FIX: the ideal price used to be computed as a percentage BELOW THE LIVE
 * PRICE (price * (1 - pullback)). That made it a treadmill — the target moved down
 * with every tick, so the gap stayed pinned at the same value ("needs -0.30%")
 * forever and the buy was never released, however far the price actually fell.
 *
 * The reference is now the 24h OPEN, which is fixed for the day:
 *   ideal = 24h open + a small allowed run-up
 * So an asset that has barely moved is buyable right now, an asset that has run up
 * hard must genuinely come back toward its open, and a real dip closes the gap.
 *
 * Tolerance scales with the trade's own target: chasing a 3% target is not worth
 * abandoning over a few basis points of premium.
 */

const ALLOWED_RUNUP_PCT = 0.75; // we'll still pay up to 0.75% above the 24h open
const MIN_TOLERANCE_PCT = 0.15;

/** How much the price must come back for the entry to be fair, given the 24h move. */
export function requiredPullbackPct(change24h: number): number {
  return Math.max(0, Number(change24h || 0) - ALLOWED_RUNUP_PCT);
}

export function computeIdealEntry(opts: {
  price: number;
  change24h?: number;
  entryZoneLow?: number | null;
  entryZoneHigh?: number | null;
  targetGainPct?: number | null;
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

  const chg = Number(opts.change24h || 0);
  const open24h = chg > -100 ? price / (1 + chg / 100) : price;

  // Fixed anchor: the open plus a small allowed run-up.
  let ideal = open24h > 0 ? open24h * (1 + ALLOWED_RUNUP_PCT / 100) : price;
  let source = 'runup_from_open';

  // Never ask for a price ABOVE the market — a flat or down asset is fair right now.
  if (ideal >= price) {
    ideal = price;
    source = 'market';
  }

  // The AI's entry zone, when it exists and is tighter, wins.
  const zoneHigh = Number(opts.entryZoneHigh || 0);
  if (zoneHigh > 0 && zoneHigh < ideal) {
    ideal = zoneHigh;
    source = 'ai_entry_zone';
  }

  // Tolerance scales with the target gain: a 3% target tolerates ~0.75% of premium.
  const targetGain = Math.max(0, Number(opts.targetGainPct || 0));
  const tolerancePct = Math.max(MIN_TOLERANCE_PCT, targetGain * 0.25);

  const maxBuy = ideal * (1 + tolerancePct / 100);
  const gapPct = ((price - ideal) / price) * 100;

  return {
    ideal_entry_price: ideal,
    max_buy_price: maxBuy,
    at_ideal_entry: price <= maxBuy,
    entry_gap_pct: Math.max(0, gapPct),
    required_pullback_pct: requiredPullbackPct(chg),
    ideal_entry_source: source
  };
}