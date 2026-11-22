import { extractBaseAsset } from './krakenAssets.ts';

// Average entry price of what is ACTUALLY held, the way Kraken shows it:
// price the live balance from the most recent buys that cover it (fees excluded).
// A running average drifts because each closing sell is a hair smaller than its
// buy, so leftover dust at old prices gets blended into the next buy.
export function heldCostBasis(trades: any[], heldQty: Record<string, number>) {
  const lots: Record<string, { vol: number; cost: number }[]> = {};
  const sorted = [...(trades || [])].sort((a, b) => parseFloat(a.time) - parseFloat(b.time));
  for (const t of sorted) {
    if (t.type !== 'buy' || !t.pair) continue;
    const vol = parseFloat(t.vol) || 0, cost = parseFloat(t.cost) || 0;
    if (vol <= 0 || cost <= 0) continue;
    (lots[extractBaseAsset(t.pair)] ||= []).push({ vol, cost });
  }
  const out: Record<string, number> = {};
  for (const [sym, bal] of Object.entries(heldQty)) {
    const list = lots[sym];
    if (!(bal > 0) || !list?.length) continue;
    let qty = 0, cost = 0;
    for (let i = list.length - 1; i >= 0 && qty < bal; i--) {
      const take = Math.min(list[i].vol, bal - qty);
      cost += list[i].cost * (take / list[i].vol);
      qty += take;
    }
    if (qty > 0) out[sym] = cost / qty;
  }
  return out;
}