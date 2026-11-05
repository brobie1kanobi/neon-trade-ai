// Quantity-weighted FIFO matching of buys to sells.
// - Lots are kept per symbol AND per mode (a sim buy never matches a live sell).
// - A sell larger than the oldest lot consumes several lots; a partially
//   consumed lot keeps its remaining quantity for the next sell.
// - Fees are pro-rated by the matched quantity.
// - Trades must carry a real fill time; ordering never uses record creation time.
export type FillTrade = { symbol: string; type: string; quantity: number; price: number; fee?: number; time: number; is_simulation?: boolean };

export function fifoMatch(trades: FillTrade[]) {
  const sorted = [...trades].filter(t => t.quantity > 0 && t.price > 0 && t.time > 0).sort((a, b) => a.time - b.time);
  const lots: Record<string, any[]> = {};
  const roundTrips: any[] = [];
  let unmatchedSellQty: Record<string, number> = {};
  for (const t of sorted) {
    const key = `${t.symbol}|${!!t.is_simulation}`;
    if (t.type === 'buy') {
      (lots[key] = lots[key] || []).push({ price: t.price, remaining: t.quantity, qty: t.quantity, fee: t.fee || 0, time: t.time });
      continue;
    }
    if (t.type !== 'sell') continue;
    let left = t.quantity;
    const q = lots[key] || [];
    while (left > 1e-12 && q.length > 0) {
      const lot = q[0];
      const m = Math.min(lot.remaining, left);
      const buyFee = lot.fee * (m / lot.qty);
      const sellFee = (t.fee || 0) * (m / t.quantity);
      const gross = (t.price - lot.price) * m;
      const net = gross - buyFee - sellFee;
      roundTrips.push({
        symbol: t.symbol, is_simulation: !!t.is_simulation, quantity: m,
        buyPrice: lot.price, sellPrice: t.price, grossPnl: gross, fees: buyFee + sellFee, pnl: net,
        pnlPercent: ((t.price - lot.price) / lot.price) * 100,
        netPnlPercent: (net / (lot.price * m)) * 100,
        buyTime: lot.time, sellTime: t.time
      });
      lot.remaining -= m; left -= m;
      if (lot.remaining <= 1e-12) q.shift();
    }
    // Sell quantity with no recorded buy (e.g. coins bought before history starts) is
    // NOT scored — it would otherwise be counted as a win/loss against nothing.
    if (left > 1e-12) unmatchedSellQty[key] = (unmatchedSellQty[key] || 0) + left;
  }
  return { roundTrips, openLots: lots, unmatchedSellQty };
}