// Canonical signal selection + trade-readiness gate.
//
// Only ONE generator (the unified pipeline in shared/signalEngine.ts) is allowed
// to produce signals the auto-trader acts on. Signals written by any other path
// (legacy generators, external agents) are still readable for display, but are
// never traded while REQUIRE_CANONICAL is true.
//
// ROLLBACK SWITCH: set REQUIRE_CANONICAL = false to restore legacy behavior
// (any active signal is tradeable, buy-preferring selection).
export const REQUIRE_CANONICAL = true;
export const PIPELINE_ID = 'unified_v1';

// A signal older than this, or whose price has drifted this far since it was
// produced, no longer describes the market and must not execute.
export const MAX_SIGNAL_AGE_MS = 75 * 60 * 1000;
export const MAX_PRICE_DRIFT_PCT = 1.5;

export function signalMeta(s: any): any {
  try { return JSON.parse(s?.metadata_json || '{}') || {}; } catch (_e) { return {}; }
}

export function isCanonicalSignal(s: any): boolean {
  return signalMeta(s).pipeline === PIPELINE_ID;
}

const isBuy = (s: any) => {
  const t = String(s?.signal_type || '').toLowerCase();
  return t === 'buy' || t === 'strong_buy';
};
const ts = (s: any) => {
  const g = signalMeta(s).generated_at;
  return new Date(g || s?.updated_date || s?.created_date || 0).getTime();
};

export function pickSignalPerSymbol(signals: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const sig of signals || []) {
    const key = String(sig?.asset_symbol || '').toUpperCase();
    if (!key) continue;
    if (REQUIRE_CANONICAL && !isCanonicalSignal(sig)) continue;
    const cur = map.get(key);
    if (!cur) { map.set(key, sig); continue; }
    if (REQUIRE_CANONICAL) {
      // One canonical signal per symbol: the newest analysis wins.
      if (ts(sig) >= ts(cur)) map.set(key, sig);
      continue;
    }
    // Legacy rule (rollback only): prefer the highest-confidence buy.
    const a = isBuy(sig), b = isBuy(cur);
    if (a !== b) { if (a) map.set(key, sig); continue; }
    if (a) {
      const dc = Number(sig.confidence_score || 0) - Number(cur.confidence_score || 0);
      if (dc > 0 || (dc === 0 && ts(sig) >= ts(cur))) map.set(key, sig);
    } else if (ts(sig) >= ts(cur)) {
      map.set(key, sig);
    }
  }
  return map;
}

/**
 * Decide whether a signal is safe to act on right now.
 * Returns { ok, reason } — reason is recorded in the auto-trader run log.
 */
export function tradeReadiness(sig: any, currentPrice: number, now = Date.now()): { ok: boolean; reason: string } {
  if (!sig) return { ok: false, reason: 'no_canonical_signal' };
  if (!REQUIRE_CANONICAL) return { ok: true, reason: 'legacy_mode' };
  const meta = signalMeta(sig);
  if (meta.pipeline !== PIPELINE_ID) return { ok: false, reason: 'non_canonical_signal' };
  if (meta.data_status !== 'complete') {
    return { ok: false, reason: `incomplete_analysis${meta.non_actionable_reason ? ': ' + meta.non_actionable_reason : ''}` };
  }
  const age = now - ts(sig);
  if (age > MAX_SIGNAL_AGE_MS) return { ok: false, reason: `stale_signal (${Math.round(age / 60000)} min old)` };
  const ref = Number(sig.price_at_signal || 0);
  if (ref > 0 && currentPrice > 0) {
    const drift = Math.abs(currentPrice - ref) / ref * 100;
    if (drift > MAX_PRICE_DRIFT_PCT) return { ok: false, reason: `price_moved_${drift.toFixed(2)}pct_since_signal` };
  }
  return { ok: true, reason: 'ready' };
}