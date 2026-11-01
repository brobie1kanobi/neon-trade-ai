// Cross-run buy claim. Two auto-trader runs that overlap can both pass every
// "already bought?" check before either has written a Trade, so both buy. Each run
// writes a placeholder Trade FIRST, then re-reads: the earliest claim for the coin
// in the window wins and every other run backs off. Both runs see the same set of
// claims after writing, so exactly one proceeds.

const CLAIM_WINDOW_MS = 120000;

export async function claimBuy(base44, userEmail, symbol, isSimMode, idempotencyKey) {
  const sym = String(symbol || '').toUpperCase();
  const claim = await base44.entities.Trade.create({
    symbol: sym, type: 'buy', asset_type: 'crypto', quantity: 0, price: 0, total_value: 0,
    status: 'pending_submission', is_auto_trade: true, is_simulation: isSimMode,
    idempotency_key: idempotencyKey, created_by: userEmail
  });
  const recent = await base44.entities.Trade.filter(
    { created_by: userEmail, symbol: sym, type: 'buy', is_auto_trade: true, is_simulation: isSimMode },
    '-created_date', 10
  ).catch(() => []);
  const now = Date.now();
  const live = (recent || []).filter(t =>
    !['rejected', 'cancelled'].includes(t.status) &&
    now - new Date(t.created_date).getTime() < CLAIM_WINDOW_MS
  );
  live.sort((a, b) => (new Date(a.created_date).getTime() - new Date(b.created_date).getTime()) || String(a.id).localeCompare(String(b.id)));
  const winner = live[0];
  if (winner && winner.id !== claim.id) {
    await base44.entities.Trade.delete(claim.id).catch(() => {});
    return { won: false, winnerId: winner.id };
  }
  return { won: true, claimId: claim.id };
}

export async function releaseClaim(base44, claimId, reason) {
  if (!claimId) return;
  await base44.entities.Trade.update(claimId, { status: 'rejected', risk_rejection_reason: String(reason || '').slice(0, 300) }).catch(() => {});
}