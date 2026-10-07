// Prevents repeat auto-buys of an asset that is already held, and repairs
// positions whose take-profit / stop-loss never reached Kraken.

const RECENT_BUY_WINDOW_MS = 24 * 3600000;

export async function checkOpenPosition(base44, userEmail, symbol, isSimMode) {
  const sym = String(symbol || '').toUpperCase();
  const cos = await base44.entities.ConditionalOrder.filter(
    { created_by: userEmail, symbol: sym, status: 'active' }, '-created_date', 10
  ).catch(() => []);
  const modeCos = (cos || []).filter(o => isSimMode ? o.is_simulation !== false : o.is_simulation === false);

  const buys = await base44.entities.Trade.filter(
    { created_by: userEmail, symbol: sym, type: 'buy', is_simulation: isSimMode }, '-created_date', 1
  ).catch(() => []);
  const lastBuy = buys?.[0];
  const lastBuyRecent = lastBuy && (Date.now() - new Date(lastBuy.created_date).getTime()) < RECENT_BUY_WINDOW_MS;

  // Prefer an unprotected position so it gets repaired first.
  const position = modeCos.find(o => !o.kraken_tp_order_id) || modeCos[0] ||
    (lastBuyRecent ? { symbol: sym, purchase_price: lastBuy.price, quantity: lastBuy.quantity, _fromTrade: true, kraken_tp_order_id: null } : null);

  return { position, lastBuyPrice: lastBuy?.price || position?.purchase_price || 0 };
}

export async function repairMissingBracket(base44, userEmail, pos, wsToken, log, deps) {
  const { invokeKrakenTrade, findRestingClosers, roundPriceForKraken } = deps;
  const sym = pos.symbol;
  let { tp, sl } = await findRestingClosers(base44, userEmail, sym);

  if (!tp) {
    const entry = Number(pos.purchase_price || 0);
    const qty = Number(pos.quantity || 0);
    if (entry > 0 && qty > 0) {
      const tpPrice = roundPriceForKraken(entry * (1 + Number(pos.gain_margin || 3) / 100), sym);
      const res = sl
        ? await invokeKrakenTrade(base44, { action: 'place_order', symbol: sym, side: 'sell', quantity: qty, orderType: 'take-profit', triggerPrice: tpPrice }, 2, wsToken, userEmail).catch(e => ({ error: e.message }))
        : await invokeKrakenTrade(base44, {
            action: 'place_bracket_orders', symbol: sym, quantity: qty, takeProfitPrice: tpPrice,
            stopLossPrice: roundPriceForKraken(entry * (1 - Number(pos.loss_margin || 2) / 100), sym)
          }, 2, wsToken, userEmail).catch(e => ({ error: e.message }));
      tp = res?.tp_order_id || res?.order_id || null;
      sl = sl || res?.sl_order_id || null;
      if (!tp) tp = (await findRestingClosers(base44, userEmail, sym)).tp;
    }
  }

  log(`BRACKET REPAIR ${sym}`, { tp, sl });
  if (pos.id && (tp || sl)) {
    await base44.entities.ConditionalOrder.update(pos.id, {
      kraken_tp_order_id: tp || pos.kraken_tp_order_id || null,
      kraken_sl_order_id: sl || pos.kraken_sl_order_id || null,
      ...(tp ? { trailing_enabled: false, closure_reason: 'Exit handled by resting Kraken TP/SL orders' } : {})
    }).catch(() => {});
  }
  return { tp, sl };
}