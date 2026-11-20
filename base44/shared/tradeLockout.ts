// Shared Trade-key cooldown. Kraken's "Temporary lockout" is renewed by every
// call made while it is active, so once it happens ALL trade-key callers
// (manual orders, auto-trader, TP/SL monitor, cancels, token fetches) must stop
// until it clears. Stored in KrakenApiCache so every function instance sees it.
export const TRADE_LOCKOUT_KEY = 'kraken:lockout:trade';
export const TRADE_LOCKOUT_MS = 15 * 60 * 1000; // Kraken lockouts last ~15 min

export function isLockoutError(msg: unknown) {
  return /temporary lockout/i.test(String(msg || ''));
}

/** Returns the ISO time the trade key cooldown ends, or null if not locked. */
export async function tradeLockedUntil(base44: any): Promise<string | null> {
  try {
    const rows = await base44.asServiceRole.entities.KrakenApiCache.filter({ cache_key: TRADE_LOCKOUT_KEY }, '-updated_date', 1);
    const exp = rows?.[0]?.expires_at;
    return exp && new Date(exp).getTime() > Date.now() ? exp : null;
  } catch (_e) { return null; }
}

export async function setTradeLockout(base44: any) {
  try {
    const record = { cache_key: TRADE_LOCKOUT_KEY, data_json: JSON.stringify({ locked: true }), expires_at: new Date(Date.now() + TRADE_LOCKOUT_MS).toISOString() };
    const rows = await base44.asServiceRole.entities.KrakenApiCache.filter({ cache_key: TRADE_LOCKOUT_KEY }, '-updated_date', 1);
    if (rows?.[0]) await base44.asServiceRole.entities.KrakenApiCache.update(rows[0].id, record);
    else await base44.asServiceRole.entities.KrakenApiCache.create(record);
  } catch (_e) { /* non-critical */ }
}

export function lockoutMessage(until: string) {
  const t = new Date(until).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return `Kraken temporarily locked the trading key for too many requests. Trading resumes automatically after ${t} ET — no order was sent.`;
}