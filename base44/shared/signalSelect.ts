// Several generators (e.g. a 4h and a 1d timeframe) keep an active AssetSignal
// for the same symbol at once. A plain "last one wins" map let a later 4h
// "hold" silently overwrite a fresher 1d "buy", so qualifying buys never
// reached the prospector or the auto-trader.
//
// Rule: if any active signal for a symbol is actionable (buy/strong_buy), use
// the highest-confidence actionable one (newest on ties). Otherwise use the
// newest signal.
const isBuy = (s: any) => {
  const t = String(s?.signal_type || '').toLowerCase();
  return t === 'buy' || t === 'strong_buy';
};
const ts = (s: any) => new Date(s?.updated_date || s?.created_date || 0).getTime();

export function pickSignalPerSymbol(signals: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const sig of signals || []) {
    const key = String(sig?.asset_symbol || '').toUpperCase();
    if (!key) continue;
    const cur = map.get(key);
    if (!cur) { map.set(key, sig); continue; }
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