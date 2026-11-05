// UNIFIED SIGNAL PIPELINE — the single authoritative source of trading signals.
//
// Every caller (hourly schedule, Market Analysis screen, Prospects, proxies)
// runs THIS code, so the screen and the auto-trader always see the same signal.
//
// Stages: validate market data → normalized indicators → one scoring/confidence
// policy → persist one canonical signal per asset (competing signals for the
// same asset are deactivated) with full provenance.
//
// Policy ("balanced, skip uncertain trades"):
//   composite score -100..+100 (weighted, scale-invariant indicators)
//   buy        composite >= 20  → confidence 60–69
//   strong_buy composite >= 40  → confidence >= 70
//   confidence = 50 + |composite| * 0.5 for directional calls
//   Missing / stale / conflicting required inputs → 'hold' with confidence 0
//   and data_status 'incomplete' — never a heuristic buy.
import { PIPELINE_ID, signalMeta, isCanonicalSignal } from './signalSelect.ts';

export const PIPELINE_VERSION = 'unified_v1.0';
export const SIGNAL_TTL_MS = 75 * 60 * 1000;
const BUY_T = 20, STRONG_T = 40;

export const KRAKEN_PAIR_MAP: Record<string, string> = {
  BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD', XRP: 'XXRPZUSD', ADA: 'ADAUSD',
  DOGE: 'XDGUSD', DOT: 'DOTUSD', LINK: 'LINKUSD', MATIC: 'MATICUSD', AVAX: 'AVAXUSD',
  UNI: 'UNIUSD', ATOM: 'ATOMUSD', LTC: 'XLTCZUSD', BCH: 'BCHUSD', XLM: 'XXLMZUSD',
  TRX: 'TRXUSD', SHIB: 'SHIBUSD', PEPE: 'PEPEUSD', HBAR: 'HBARUSD'
};
const BTC_CORRELATED_ALTS = new Set(['ETH', 'XRP', 'SOL', 'TRX', 'DOGE', 'ADA', 'LINK', 'DOT', 'AVAX', 'LTC']);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const sgn = (v: number) => (v > 0 ? '+' : '');

// ───────────── indicators ─────────────
function sma(p: number[], n: number) { if (!p || p.length < n) return null; return p.slice(-n).reduce((a, b) => a + b, 0) / n; }
function emaSeries(p: number[], n: number) {
  if (!p || p.length < n) return [];
  const k = 2 / (n + 1); let e = p.slice(0, n).reduce((a, b) => a + b, 0) / n; const out = [e];
  for (let i = n; i < p.length; i++) { e = p[i] * k + e * (1 - k); out.push(e); }
  return out;
}
function rsi(c: number[], n = 14) {
  if (!c || c.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  let ag = g / n, al = l / n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; ag = (ag * (n - 1) + Math.max(d, 0)) / n; al = (al * (n - 1) + Math.max(-d, 0)) / n; }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}
// MACD expressed as % of price so a $0.10 coin and a $90k coin score alike.
function macd(c: number[]) {
  if (!c || c.length < 35) return null;
  const e12 = emaSeries(c, 12), e26 = emaSeries(c, 26);
  const line: number[] = [];
  for (let i = 0; i < e26.length; i++) line.push(e12[i + 14] - e26[i]);
  const sig = emaSeries(line, 9);
  if (!sig.length) return null;
  const last = c[c.length - 1];
  const l = line[line.length - 1], s = sig[sig.length - 1];
  return { linePct: (l / last) * 100, histPct: ((l - s) / last) * 100 };
}
function bollinger(c: number[], n = 20, m = 2) {
  if (!c || c.length < n) return null;
  const s = c.slice(-n), mid = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, v) => a + (v - mid) ** 2, 0) / n);
  if (sd <= 0) return { percentB: 0.5, bandwidth: 0 };
  return { percentB: (c[c.length - 1] - (mid - m * sd)) / (2 * m * sd), bandwidth: (2 * m * sd) / mid * 100 };
}
function volumeRatio(v: number[], n = 20) {
  if (!v || v.length < n + 1) return null;
  const avg = v.slice(-(n + 1), -1).reduce((a, b) => a + b, 0) / n;
  return avg > 0 ? v[v.length - 1] / avg : null;
}

// ───────────── scoring (each -100..+100) ─────────────
function scoreRSI(x: number) { return x < 25 ? 80 : x < 35 ? 50 : x < 45 ? 20 : x < 55 ? 0 : x < 65 ? -15 : x < 75 ? -40 : -70; }
function scoreMACD(m: any) {
  // 0.1% of price histogram ≈ 30 points; capped at ±60. Line side adds ±10.
  let s = clamp((m.histPct / 0.1) * 30, -60, 60);
  if (Math.abs(m.linePct) > 0.05) s += m.linePct > 0 ? 10 : -10;
  return Math.round(clamp(s, -100, 100));
}
function scoreBB(b: any) {
  const p = b.percentB;
  let s = p < 0.05 ? 70 : p < 0.2 ? 40 : p < 0.4 ? 15 : p < 0.6 ? 0 : p < 0.8 ? -15 : p < 0.95 ? -40 : -70;
  if (b.bandwidth < 3 && s !== 0) s += s > 0 ? 10 : -10;
  return clamp(s, -100, 100);
}
function scoreVolume(ratio: number, lastCandleDir: number) {
  const up = lastCandleDir > 0;
  if (ratio > 2) return up ? 40 : -40;
  if (ratio > 1.3) return up ? 20 : -20;
  if (ratio < 0.5) return 0;
  return up ? 5 : -5;
}
function trendSide(c: number[]) {
  const a = sma(c, 20), b = sma(c, 50), last = c[c.length - 1];
  if (a == null || b == null) return 0;
  if (last > a && a > b) return 1;
  if (last < a && a < b) return -1;
  return 0;
}
function scoreHistory(wins: number, total: number) {
  if (total < 5) return 0;
  const wr = (wins / total) * 100;
  return wr >= 80 ? 30 : wr >= 65 ? 15 : wr >= 50 ? 0 : wr >= 35 ? -20 : -40;
}
function btcMomentum(closes: number[]) {
  if (!closes || closes.length < 50) return null;
  const now = closes[closes.length - 1];
  const pct = (back: number) => { const p = closes[closes.length - 1 - back]; return p > 0 ? ((now - p) / p) * 100 : 0; };
  const p15 = pct(3), p1h = pct(12), p4h = pct(48);
  const score = clamp(p15 * 40 + p1h * 35 + p4h * 25, -100, 100);
  const trend = p15 > 0 && p1h > 0 && p4h > 0 ? 'aligned_bullish' : p15 < 0 && p1h < 0 && p4h < 0 ? 'aligned_bearish' : 'mixed';
  return { score: r2(score), trend, pct1h: r2(p1h), pct4h: r2(p4h) };
}

// ───────────── data fetch ─────────────
async function getJson(url: string, ms = 8000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (Array.isArray(j?.error) && j.error.length) throw new Error(j.error.join(','));
  return j;
}
async function fetchOHLC(pair: string, interval: number) {
  const j = await getJson(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`);
  const key = Object.keys(j.result || {}).find(k => k !== 'last');
  const candles = (j?.result?.[key as string] || []).slice(0, -1); // drop the in-progress candle
  return {
    closes: candles.map((c: any) => parseFloat(c[4])),
    volumes: candles.map((c: any) => parseFloat(c[6])),
    lastOpenTime: candles.length ? Number(candles[candles.length - 1][0]) * 1000 : 0
  };
}
async function inBatches<T>(items: T[], size: number, fn: (x: T) => Promise<any>) {
  const out: any[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.allSettled(items.slice(i, i + size).map(fn)));
  return out;
}

// ───────────── symbol resolution ─────────────
export async function resolveSymbols(base44: any, user: any, requested: string[] = []) {
  let syms = (requested || []).map(s => String(s || '').toUpperCase());
  if (syms.length === 0) {
    const prefs = await base44.asServiceRole.entities.AutoBuyPreference.filter({ enabled: true }).catch(() => []);
    const settings = await base44.entities.UserSettings.filter({ created_by: user.email }, '-updated_date', 1).catch(() => []);
    syms = [...prefs.map((p: any) => p.symbol), ...((settings?.[0]?.watched_crypto) || [])].map(s => String(s || '').toUpperCase());
  }
  const valid = [...new Set(syms)].filter(s => KRAKEN_PAIR_MAP[s]).slice(0, 15);
  return valid.length ? valid : ['BTC', 'ETH', 'SOL'];
}

// ───────────── per-asset evaluation ─────────────
function evaluate(sym: string, d: any, ctx: any) {
  const { strategies, btc, sentimentScore, history, now } = ctx;
  const issues: string[] = [];
  const t1 = d.h1, t4 = d.h4;
  const price = d.price;
  if (!(price > 0)) issues.push('no live price');
  if (!t1 || t1.closes.length < 50) issues.push('insufficient 1h candles');
  else {
    const ageH = (now - t1.lastOpenTime) / 3600000;
    if (ageH > 3) issues.push(`1h candles stale (${ageH.toFixed(1)}h)`);
    const lastClose = t1.closes[t1.closes.length - 1];
    if (price > 0 && Math.abs(price - lastClose) / lastClose > 0.03) issues.push('live price disagrees with candles by >3%');
  }
  if (strategies.trend && (!t4 || t4.closes.length < 50)) issues.push('insufficient 4h candles');
  if (sym !== 'BTC' && BTC_CORRELATED_ALTS.has(sym) && !btc) issues.push('BTC momentum unavailable');

  const ind: any = {}, scores: any = {}, weights: any = {};
  if (t1 && t1.closes.length >= 50) {
    const c = t1.closes;
    if (strategies.rsi) { ind.rsi = rsi(c); if (ind.rsi != null) { scores.rsi = scoreRSI(ind.rsi); weights.rsi = 20; } }
    if (strategies.macd) { ind.macd = macd(c); if (ind.macd) { scores.macd = scoreMACD(ind.macd); weights.macd = 20; } }
    if (strategies.bollinger) { ind.bollinger = bollinger(c); if (ind.bollinger) { scores.bollinger = scoreBB(ind.bollinger); weights.bollinger = 15; } }
    if (strategies.volume) {
      ind.volume_ratio = volumeRatio(t1.volumes);
      if (ind.volume_ratio != null) { scores.volume = scoreVolume(ind.volume_ratio, c[c.length - 1] - c[c.length - 2]); weights.volume = 10; }
    }
    if (strategies.trend && t4 && t4.closes.length >= 50) {
      ind.trend_1h = trendSide(c); ind.trend_4h = trendSide(t4.closes);
      scores.trend = (ind.trend_1h + ind.trend_4h) * 40; weights.trend = 25;
    }
  }
  if (strategies.sentiment && sentimentScore != null) { scores.sentiment = clamp(sentimentScore - 50, -50, 50); weights.sentiment = 10; }
  if (strategies.history) { const h = history[sym] || { wins: 0, total: 0 }; ind.history = h; scores.history = scoreHistory(h.wins, h.total); weights.history = 10; }
  const technicalCount = ['rsi', 'macd', 'bollinger', 'trend', 'volume'].filter(k => scores[k] != null).length;
  if (issues.length === 0 && technicalCount < 3) issues.push('fewer than 3 technical strategies available');

  const totalW = Object.values(weights).reduce((a: number, b: any) => a + b, 0) as number;
  let composite = 0;
  for (const k of Object.keys(scores)) composite += scores[k] * (weights[k] / (totalW || 1));
  const compositeRaw = composite;
  const adjustments: string[] = [];

  // BTC correlation: can only DAMPEN or confirm — never promote a hold to a buy.
  if (btc && sym !== 'BTC') {
    const w = BTC_CORRELATED_ALTS.has(sym) ? 1 : 0.5;
    if (btc.trend === 'aligned_bearish' && btc.score < -20) {
      const cut = Math.min(20, Math.abs(btc.score) * 0.2 * w); composite -= cut; adjustments.push(`BTC falling (${btc.pct1h}% 1h) −${cut.toFixed(1)}`);
    } else if (btc.trend === 'aligned_bullish' && btc.score > 20 && composite >= BUY_T) {
      const add = Math.min(8, btc.score * 0.1 * w); composite += add; adjustments.push(`BTC confirms +${add.toFixed(1)}`);
    }
  }

  let action = composite >= STRONG_T ? 'strong_buy' : composite >= BUY_T ? 'buy' : composite <= -STRONG_T ? 'strong_sell' : composite <= -BUY_T ? 'sell' : 'hold';
  let reason: string | null = null;
  const buyish = action === 'buy' || action === 'strong_buy';
  if (buyish && scores.trend != null && scores.trend <= -40) reason = 'conflicting indicators: buy setup against a downtrend';
  else if (buyish) {
    const pos = Object.values(scores).filter((s: any) => s > 0).length, neg = Object.values(scores).filter((s: any) => s < 0).length;
    if (neg >= pos) reason = `conflicting indicators: ${pos} bullish vs ${neg} bearish`;
  }
  if (buyish && d.change24h > 6) reason = `price already up ${d.change24h.toFixed(1)}% in 24h`;
  if (reason) { action = 'hold'; adjustments.push(reason); }

  const incomplete = issues.length > 0;
  if (incomplete) { action = 'hold'; reason = issues.join('; '); }
  const confidence = incomplete ? 0 : action === 'hold' ? Math.round(clamp(50 - Math.abs(composite) * 0.5, 30, 50)) : Math.round(clamp(50 + Math.abs(composite) * 0.5, 5, 95));

  const parts: string[] = [];
  if (scores.rsi != null) parts.push(`RSI=${ind.rsi.toFixed(1)}(${sgn(scores.rsi)}${scores.rsi})`);
  if (scores.macd != null) parts.push(`MACD=${sgn(ind.macd.histPct)}${ind.macd.histPct.toFixed(3)}(${sgn(scores.macd)}${scores.macd})`);
  if (scores.bollinger != null) parts.push(`BB%B=${ind.bollinger.percentB.toFixed(2)}(${sgn(scores.bollinger)}${scores.bollinger})`);
  if (scores.trend != null) parts.push(`Trend(${sgn(scores.trend)}${scores.trend})`);
  if (scores.volume != null) parts.push(`Vol=${ind.volume_ratio.toFixed(1)}x(${sgn(scores.volume)}${scores.volume})`);
  if (scores.sentiment != null) parts.push(`Sent=${scores.sentiment}(Fear & Greed index ${sentimentScore})`);
  if (scores.history != null) parts.push(`Hist(${sgn(scores.history)}${scores.history})`);
  const reasoning = incomplete
    ? `Analysis incomplete — no trade: ${reason}.`
    : `v7 multi-strategy [${PIPELINE_ID}]: composite=${composite.toFixed(1)} | ${parts.join(', ')}${adjustments.length ? ` | BTC: ${adjustments.join('; ')}` : ''}`;

  const momentum = Math.abs(composite) >= STRONG_T ? 'strong' : Math.abs(composite) >= BUY_T ? 'moderate' : 'weak';
  return {
    action, confidence, reasoning, momentum,
    meta: {
      pipeline: PIPELINE_ID, version: PIPELINE_VERSION, generated_at: new Date(now).toISOString(),
      data_status: incomplete ? 'incomplete' : 'complete',
      non_actionable_reason: action === 'hold' || incomplete ? (reason || `no clear edge (score ${composite.toFixed(0)})`) : null,
      inputs: { price, change_24h: d.change24h, candles_1h: t1?.closes.length || 0, candles_4h: t4?.closes.length || 0, last_1h_candle: t1?.lastOpenTime ? new Date(t1.lastOpenTime).toISOString() : null, btc_momentum: btc, fear_greed: sentimentScore },
      indicators: ind, scores, weights, composite_raw: r2(compositeRaw), composite: r2(composite), adjustments,
      strategies_used: Object.keys(scores), user_margins: ctx.margins, history_mode: ctx.mode
    }
  };
}

// ───────────── reads ─────────────
export async function loadCanonicalSignals(base44: any, symbols: string[]) {
  const active = await base44.asServiceRole.entities.AssetSignal.filter({ is_active: true }).catch(() => []);
  const want = new Set(symbols.map(s => s.toUpperCase()));
  const map = new Map<string, any>();
  for (const s of active) {
    const sym = String(s.asset_symbol || '').toUpperCase();
    if (!want.has(sym) || !isCanonicalSignal(s)) continue;
    const cur = map.get(sym);
    if (!cur || signalMeta(s).generated_at > signalMeta(cur).generated_at) map.set(sym, s);
  }
  return map;
}

export function signalAgeMs(s: any) { return Date.now() - new Date(signalMeta(s).generated_at || 0).getTime(); }

// UI shape shared by Market Analysis / Quick Actions — straight from the stored signal.
export function toRecommendation(s: any) {
  const m = signalMeta(s);
  const type = s.signal_type || 'hold';
  return {
    symbol: s.asset_symbol, signal_id: s.id, action: type, optimal_action: type,
    confidence_score: Number(s.confidence_score || 0), reasoning: s.reasoning || '',
    current_price: Number(s.price_at_signal || 0), current_24h_change: Number(s.change_24h || 0),
    predicted_move_pct: Number(s.predicted_gain_pct || 0), timing_window: s.timing_window || '4h',
    stop_loss_pct: s.stop_loss_pct, take_profit_pct: s.take_profit_pct, momentum_strength: s.momentum_strength,
    technical_pattern: s.technical_pattern, sentiment_score: s.sentiment_score,
    analysis_status: m.data_status || 'unknown', non_actionable_reason: m.non_actionable_reason || null,
    signal_generated_at: m.generated_at || s.updated_date, expires_at: s.expires_at, pipeline: m.pipeline,
    auto_tradeable: (type === 'buy' || type === 'strong_buy') && m.data_status === 'complete',
    short_term_signal: true
  };
}

// ───────────── main ─────────────
export async function runCanonicalPipeline(base44: any, user: any, opts: { symbols?: string[] } = {}) {
  const now = Date.now();
  const symbols = await resolveSymbols(base44, user, opts.symbols || []);
  const settings = (await base44.entities.UserSettings.filter({ created_by: user.email }, '-updated_date', 1).catch(() => []))[0] || {};
  const strategies = {
    rsi: settings.strategy_rsi !== false, macd: settings.strategy_macd !== false, bollinger: settings.strategy_bollinger !== false,
    trend: settings.strategy_trend !== false, volume: settings.strategy_volume !== false,
    sentiment: settings.strategy_sentiment === true, history: settings.strategy_history !== false
  };
  const margins = { tp: typeof settings.gain_margin === 'number' ? settings.gain_margin : 3, sl: typeof settings.loss_margin === 'number' ? settings.loss_margin : 2 };
  const isSim = settings.sim_trading_mode !== false;
  const mode = isSim ? 'sim' : 'live';

  // Market data — ticker + candles, fetched in small parallel batches.
  const data: Record<string, any> = {};
  for (const s of symbols) data[s] = { price: 0, change24h: 0 };
  try {
    const tick = await getJson(`https://api.kraken.com/0/public/Ticker?pair=${symbols.map(s => KRAKEN_PAIR_MAP[s]).join(',')}`);
    for (const s of symbols) {
      const t = tick?.result?.[KRAKEN_PAIR_MAP[s]];
      if (!t) continue;
      const p = parseFloat(t.c?.[0] || '0'), o = parseFloat(t.o || '0');
      data[s] = { price: p, change24h: o > 0 ? ((p - o) / o) * 100 : 0 };
    }
  } catch (e) { console.warn('[signalEngine] ticker failed:', (e as Error).message); }
  const jobs: any[] = [{ sym: 'BTC', iv: 5 }];
  for (const s of symbols) { jobs.push({ sym: s, iv: 60 }); if (strategies.trend) jobs.push({ sym: s, iv: 240 }); }
  const results = await inBatches(jobs, 4, (j) => fetchOHLC(KRAKEN_PAIR_MAP[j.sym], j.iv));
  let btc: any = null;
  jobs.forEach((j, i) => {
    const r = results[i];
    if (r.status !== 'fulfilled') { console.warn(`[signalEngine] OHLC ${j.sym}/${j.iv} failed:`, r.reason?.message); return; }
    if (j.iv === 5) btc = btcMomentum(r.value.closes);
    else if (j.iv === 60) data[j.sym].h1 = r.value;
    else data[j.sym].h4 = r.value;
  });

  // Sentiment input (only if the user enabled it): cached Fear & Greed score.
  let sentimentScore: number | null = null;
  if (strategies.sentiment) {
    const c = (await base44.asServiceRole.entities.MarketIntelligenceCache.filter({}, '-cached_at', 1).catch(() => []))[0];
    if (c && (!c.expires_at || c.expires_at > new Date().toISOString())) sentimentScore = Number(c.market_sentiment_score ?? null);
  }

  // History: only RELIABLE outcomes, scoped to this user and trading mode.
  const history: Record<string, any> = {};
  if (strategies.history) {
    const perf = await base44.asServiceRole.entities.ModelPerformance.filter({ created_by: user.email, is_simulation: isSim }, '-created_date', 200).catch(() => []);
    const okSource = isSim ? 'simulation' : 'exchange_fill';
    for (const p of perf) {
      if (p.source !== okSource || !(p.entry_price > 0) || !(p.exit_price > 0)) continue;
      const k = String(p.asset_symbol || '').toUpperCase();
      history[k] = history[k] || { wins: 0, total: 0 };
      history[k].total++; if (p.is_success) history[k].wins++;
    }
  }

  // Evaluate + persist one canonical signal per symbol.
  const active = await base44.asServiceRole.entities.AssetSignal.filter({ is_active: true }).catch(() => []);
  const expiresAt = new Date(now + SIGNAL_TTL_MS).toISOString();
  const saved: any[] = [];
  const toDeactivate: string[] = [];
  const ctx = { strategies, btc, sentimentScore, history, now, margins, mode };
  for (const sym of symbols) {
    const ev = evaluate(sym, data[sym], ctx);
    const price = data[sym].price;
    const payload: any = {
      asset_symbol: sym, asset_type: 'crypto', timeframe: '1h', signal_type: ev.action, confidence_score: ev.confidence,
      reasoning: ev.reasoning, price_at_signal: price || 0, change_24h: r2(data[sym].change24h || 0),
      take_profit_pct: margins.tp, stop_loss_pct: margins.sl,
      target_price: price > 0 ? price * (1 + margins.tp / 100) : undefined,
      stop_loss_price: price > 0 ? price * (1 - margins.sl / 100) : undefined,
      technical_pattern: ev.meta.data_status === 'complete' ? 'No clear pattern' : 'Analysis incomplete',
      momentum_strength: ev.momentum, timing_window: '4h', sentiment_score: sentimentScore ?? undefined,
      is_active: true, expires_at: expiresAt, metadata_json: JSON.stringify(ev.meta)
    };
    const mine = active.filter((s: any) => String(s.asset_symbol || '').toUpperCase() === sym);
    const existing = mine.find((s: any) => isCanonicalSignal(s));
    try {
      const rec = existing
        ? await base44.asServiceRole.entities.AssetSignal.update(existing.id, payload)
        : await base44.asServiceRole.entities.AssetSignal.create(payload);
      const id = existing?.id || rec?.id;
      saved.push({ ...payload, id });
      // Retire every competing active signal for this asset (legacy generators, duplicates).
      for (const s of mine) if (s.id !== id) toDeactivate.push(s.id);
    } catch (e) { console.warn('[signalEngine] save failed for', sym, (e as Error).message); }
  }
  await inBatches(toDeactivate, 6, (id) => base44.asServiceRole.entities.AssetSignal.update(id, { is_active: false }));

  const complete = saved.filter(s => signalMeta(s).data_status === 'complete').length;
  const actionable = saved.filter(s => signalMeta(s).data_status === 'complete' && (s.signal_type === 'buy' || s.signal_type === 'strong_buy')).length;
  const summary = { pipeline: PIPELINE_ID, analyzed: symbols.length, saved: saved.length, complete, incomplete: saved.length - complete, actionable, competing_retired: toDeactivate.length, btc_momentum: btc, mode };
  await recordHealth(base44, summary);
  return { signals: saved, summary };
}

async function recordHealth(base44: any, summary: any) {
  try {
    const nowIso = new Date().toISOString();
    const rows = await base44.asServiceRole.entities.SystemHealth.filter({ component: 'ai_signals' });
    const healthy = summary.saved > 0 && summary.incomplete <= summary.saved / 2;
    const patch = {
      component: 'ai_signals', status: healthy ? 'healthy' : 'degraded', metrics_json: JSON.stringify({ ...summary, at: nowIso }),
      ...(healthy ? { last_success_at: nowIso } : { last_error_at: nowIso, last_error_message: `${summary.incomplete}/${summary.saved} signals incomplete` })
    };
    if (rows[0]) await base44.asServiceRole.entities.SystemHealth.update(rows[0].id, patch);
    else await base44.asServiceRole.entities.SystemHealth.create(patch);
  } catch (e) { console.warn('[signalEngine] health record failed:', (e as Error).message); }
}