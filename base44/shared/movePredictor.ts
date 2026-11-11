// Predicted short-term move (1–6h) per asset — restores the AI per-asset
// prediction the original Market Analysis used (predicted_direction,
// predicted_move_pct, timing_window). It only fills the prediction fields;
// the canonical signal_type/confidence stay technical.
//
// Never returns 0: if the AI is unavailable or returns a flat/missing value
// for an asset, a volatility-based estimate from that asset's own candles
// (direction from its indicators) is used instead.

const TIMINGS = ['1h', '2h', '4h', '6h'];
const r2 = (v: number) => Math.round(v * 100) / 100;

function pctChange(c: number[], back: number) {
  if (!c || c.length <= back) return 0;
  const p = c[c.length - 1 - back];
  return p > 0 ? ((c[c.length - 1] - p) / p) * 100 : 0;
}

// Typical 4h move from the std-dev of 1h returns, signed by the indicators.
function estimateMove(d: any, meta: any) {
  const c: number[] = d?.h1?.closes || [];
  let vol = 0;
  if (c.length > 25) {
    const rets = [];
    for (let i = c.length - 24; i < c.length; i++) rets.push(((c[i] - c[i - 1]) / c[i - 1]) * 100);
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    vol = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) * 2; // ×√4 for a 4h window
  }
  if (!(vol > 0)) vol = Math.abs(Number(d?.change24h || 0)) / 3;
  const composite = Number(meta?.composite || 0);
  const dirSrc = composite !== 0 ? composite : (pctChange(c, 4) || Number(d?.change24h || 0) || 1);
  const strength = 0.5 + Math.min(1, Math.abs(composite) / 60);
  const mag = Math.max(0.1, vol * strength);
  return { predicted_move_pct: r2(Math.sign(dirSrc) * mag), timing_window: '4h', source: 'volatility_estimate' };
}

function assetLine(sym: string, d: any, meta: any, action?: string) {
  const ind = meta?.indicators || {};
  const c: number[] = d?.h1?.closes || [];
  const parts = [
    `price=$${d?.price}`, `24h=${Number(d?.change24h || 0).toFixed(2)}%`,
    `1h=${pctChange(c, 1).toFixed(2)}%`, `4h=${pctChange(c, 4).toFixed(2)}%`, `12h=${pctChange(c, 12).toFixed(2)}%`
  ];
  if (ind.rsi != null) parts.push(`RSI14=${Number(ind.rsi).toFixed(1)}`);
  if (ind.macd) parts.push(`MACD_hist=${Number(ind.macd.histPct).toFixed(3)}%ofPrice`);
  if (ind.bollinger) parts.push(`BB%B=${Number(ind.bollinger.percentB).toFixed(2)}`, `BBwidth=${Number(ind.bollinger.bandwidth).toFixed(2)}%`);
  if (ind.volume_ratio != null) parts.push(`vol=${Number(ind.volume_ratio).toFixed(2)}x`);
  if (ind.trend_1h != null) parts.push(`trend1h=${ind.trend_1h}`, `trend4h=${ind.trend_4h}`);
  parts.push(`composite=${meta?.composite ?? 0}`);
  if (meta?.history_stats) parts.push(`userHistory=${meta.history_stats.wins}/${meta.history_stats.total} wins`);
  return `- ${sym} [decision: ${action || 'hold'}]: ${parts.join(', ')}`;
}

export async function predictMoves(base44: any, items: { sym: string; d: any; meta: any; action?: string }[], btc: any, fearGreed: number | null) {
  const out: Record<string, any> = {};
  for (const it of items) out[it.sym] = estimateMove(it.d, it.meta);
  const usable = items.filter(it => it.d?.price > 0);
  if (!usable.length) return out;

  const prompt = `You are an expert quantitative short-term crypto analyst. For EACH asset below, predict the price move over the next 1-6 hours using its live indicators.
BTC momentum: ${btc ? `1h ${btc.pct1h}%, 4h ${btc.pct4h}%, ${btc.trend}` : 'unknown'}. Fear & Greed: ${fearGreed ?? 'unknown'}.

${usable.map(it => assetLine(it.sym, it.d, it.meta, it.action)).join('\n')}

For each asset return: symbol, predicted_direction ("up"|"down"), predicted_move_pct (SIGNED expected % move: positive for up, negative for down; realistic for the asset's volatility; NEVER 0), timing_window ("1h"|"2h"|"4h"|"6h"), and analysis.
analysis = 2-3 sentences UNIQUE to that asset: cite its actual numbers (RSI value and what it means, MACD histogram direction, where price sits in its Bollinger band, volume vs average, recent 1h/4h/24h moves, BTC influence), state what would have to change for a trade (e.g. "a push above the upper band on rising volume"). Do NOT contradict the given decision and do NOT reuse the same wording across assets. JSON only.`;

  try {
    const res = await Promise.race([
      base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            predictions: { type: 'array', items: { type: 'object', properties: {
              symbol: { type: 'string' }, predicted_direction: { type: 'string' },
              predicted_move_pct: { type: 'number' }, timing_window: { type: 'string' }, analysis: { type: 'string' }
            } } }
          }
        }
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('prediction timeout')), 45000))
    ]) as any;
    for (const p of res?.predictions || []) {
      const sym = String(p?.symbol || '').toUpperCase();
      if (!out[sym]) continue;
      const analysis = typeof p.analysis === 'string' && p.analysis.trim() ? p.analysis.trim().slice(0, 600) : null;
      if (analysis) out[sym].analysis = analysis;
      let move = Number(p.predicted_move_pct);
      if (!Number.isFinite(move) || Math.abs(move) < 0.05) continue; // keep estimate
      if (p.predicted_direction === 'down' && move > 0) move = -move;
      if (p.predicted_direction === 'up' && move < 0) move = -move;
      move = Math.max(-25, Math.min(25, move));
      out[sym] = { predicted_move_pct: r2(move), timing_window: TIMINGS.includes(p.timing_window) ? p.timing_window : '4h', source: 'ai', analysis };
    }
  } catch (e) {
    console.warn('[movePredictor] AI prediction failed, using volatility estimates:', (e as Error).message);
  }
  return out;
}