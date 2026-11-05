import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { runCanonicalPipeline, loadCanonicalSignals, toRecommendation, resolveSymbols, signalAgeMs } from '../../shared/signalEngine.ts';

/**
 * Market Analysis backend.
 *
 * Recommendations are NOT generated here anymore: they are the exact canonical
 * signals the auto-trader consumes (shared/signalEngine.ts). If a requested
 * asset's signal is missing or old, the unified pipeline is run for it first.
 *
 * Market intelligence (sentiment / regime / commentary / avoid list) is market
 * context only. It never creates or upgrades a signal — its avoid list can only
 * stop a buy.
 */
const CACHE_KEY = 'market-intel:global';
const REFRESH_AFTER_MS = 30 * 60 * 1000;
const FORCE_REFRESH_AFTER_MS = 5 * 60 * 1000;

const parse = (v: string, fb: any) => { try { return v ? JSON.parse(v) : fb; } catch (_e) { return fb; } };

async function fetchFearGreed() {
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(4000) });
    const e = (await r.json())?.data?.[0];
    return e?.value ? parseInt(e.value, 10) : null;
  } catch (_e) { return null; }
}

function intelFromRecord(c: any) {
  return {
    market_intelligence: {
      market_sentiment_score: c.market_sentiment_score ?? null, market_regime: c.market_regime || 'range',
      volatility_level: c.volatility_level || 'moderate', momentum_direction: c.momentum_direction || 'neutral',
      trend_strength: c.trend_strength || 'moderate', short_term_outlook: c.short_term_outlook || '',
      trading_recommendation: c.trading_recommendation || '', best_opportunities: parse(c.best_opportunities_json, []),
      avoid_list: parse(c.avoid_list_json, []), hot_signals: parse(c.hot_signals_json, [])
    },
    market_summary: c.market_summary || '',
    upcoming_catalysts: parse(c.upcoming_catalysts_json, [])
  };
}

async function getMarketIntel(base44: any, recs: any[], fearGreed: number | null) {
  const rows = await base44.asServiceRole.entities.MarketIntelligenceCache.filter({ cache_key: CACHE_KEY }).catch(() => []);
  const nowIso = new Date().toISOString();
  const valid = rows.filter((r: any) => !r.expires_at || r.expires_at > nowIso)
    .sort((a: any, b: any) => String(b.cached_at || '').localeCompare(String(a.cached_at || '')));
  if (valid[0]) return { ...intelFromRecord(valid[0]), intel_source: 'cache' };

  const lines = recs.map(r => `- ${r.symbol}: $${r.current_price}, 24h ${r.current_24h_change.toFixed(2)}%, technical signal ${r.optimal_action} (${r.confidence_score}%)`).join('\n');
  let payload: any = null, source = 'llm', ttlMs = 2 * 60 * 60 * 1000;
  try {
    payload = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `You are a short-term crypto market analyst. Using current news/social context and this live data:\n${lines}\n\nDescribe the market. avoid_list = assets with clear negative news or breakdown risk. Do NOT recommend trades; the technical signals above are final. Return JSON only.`,
      add_context_from_internet: true,
      response_json_schema: {
        type: 'object',
        properties: {
          market_intelligence: { type: 'object', properties: {
            market_regime: { type: 'string' }, volatility_level: { type: 'string' }, momentum_direction: { type: 'string' },
            trend_strength: { type: 'string' }, short_term_outlook: { type: 'string' }, trading_recommendation: { type: 'string' },
            best_opportunities: { type: 'array', items: { type: 'string' } }, avoid_list: { type: 'array', items: { type: 'string' } },
            hot_signals: { type: 'array', items: { type: 'object', properties: { symbol: { type: 'string' }, signal_type: { type: 'string' }, predicted_move_pct: { type: 'number' }, timing: { type: 'string' } } } }
          } },
          market_summary: { type: 'string' },
          upcoming_catalysts: { type: 'array', items: { type: 'string' } }
        }
      }
    });
  } catch (e) {
    console.warn('[MarketAnalysis] Intel LLM failed:', (e as Error).message);
  }
  if (!payload?.market_intelligence) {
    // Degraded: no AI commentary. Avoid list only (it can stop buys, never start them).
    source = 'degraded'; ttlMs = 15 * 60 * 1000;
    const avg = recs.length ? recs.reduce((a, r) => a + r.current_24h_change, 0) / recs.length : 0;
    payload = {
      market_intelligence: {
        market_regime: avg > 1 ? 'risk-on' : avg < -1 ? 'risk-off' : 'range',
        volatility_level: Math.abs(avg) > 3 ? 'high' : Math.abs(avg) > 1 ? 'moderate' : 'low',
        momentum_direction: avg > 0.5 ? 'bullish' : avg < -0.5 ? 'bearish' : 'neutral', trend_strength: 'unknown',
        short_term_outlook: '', trading_recommendation: 'AI market commentary is unavailable right now. Signals below are based on technical indicators only.',
        best_opportunities: [], avoid_list: recs.filter(r => r.current_24h_change < -2).map(r => r.symbol), hot_signals: []
      },
      market_summary: 'AI market commentary unavailable — showing technical signals only.',
      upcoming_catalysts: []
    };
  }
  payload.market_intelligence.market_sentiment_score = fearGreed;
  const mi = payload.market_intelligence;
  const record = {
    cache_key: CACHE_KEY, symbols_json: JSON.stringify(recs.map(r => r.symbol).sort()),
    market_sentiment_score: fearGreed ?? 50, market_regime: mi.market_regime, volatility_level: mi.volatility_level,
    momentum_direction: mi.momentum_direction, trend_strength: mi.trend_strength, short_term_outlook: mi.short_term_outlook || '',
    trading_recommendation: mi.trading_recommendation || '', best_opportunities_json: JSON.stringify(mi.best_opportunities || []),
    avoid_list_json: JSON.stringify((mi.avoid_list || []).map((s: string) => String(s).toUpperCase())), hot_signals_json: JSON.stringify(mi.hot_signals || []),
    market_summary: payload.market_summary || '', upcoming_catalysts_json: JSON.stringify(payload.upcoming_catalysts || []),
    cached_at: nowIso, expires_at: new Date(Date.now() + ttlMs).toISOString()
  };
  try {
    if (rows[0]) await base44.asServiceRole.entities.MarketIntelligenceCache.update(rows[0].id, record);
    else await base44.asServiceRole.entities.MarketIntelligenceCache.create(record);
  } catch (e) { console.warn('[MarketAnalysis] Intel cache save failed:', (e as Error).message); }
  return { ...payload, intel_source: source };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;
    const includeMarketIntelligence = body?.includeMarketIntelligence !== false;
    const symbols = await resolveSymbols(base44, user, Array.isArray(body?.symbols) ? body.symbols : []);

    // 1) Canonical signals — refresh any that are missing or old.
    let map = await loadCanonicalSignals(base44, symbols);
    const maxAge = force ? FORCE_REFRESH_AFTER_MS : REFRESH_AFTER_MS;
    const stale = symbols.filter(s => !map.get(s) || signalAgeMs(map.get(s)) > maxAge);
    let pipelineSummary = null;
    if (stale.length > 0) {
      pipelineSummary = (await runCanonicalPipeline(base44, user, { symbols: stale })).summary;
      map = await loadCanonicalSignals(base44, symbols);
    }
    const order: Record<string, number> = { strong_buy: 4, buy: 3, hold: 2, sell: 1, strong_sell: 0 };
    const recommendations = symbols.map(s => map.get(s)).filter(Boolean).map(toRecommendation)
      .sort((a, b) => (order[b.optimal_action] ?? 2) - (order[a.optimal_action] ?? 2) || b.confidence_score - a.confidence_score);

    // 2) Market context.
    let intel: any = { market_intelligence: null, market_summary: '', upcoming_catalysts: [], intel_source: 'skipped' };
    if (includeMarketIntelligence) intel = await getMarketIntel(base44, recommendations, await fetchFearGreed());

    const oldest = recommendations.reduce((m, r) => (r.signal_generated_at && (!m || r.signal_generated_at < m) ? r.signal_generated_at : m), null as string | null);
    return Response.json({
      success: true,
      recommendations,
      market_intelligence: intel.market_intelligence,
      market_summary: intel.market_summary,
      upcoming_catalysts: intel.upcoming_catalysts || [],
      intel_source: intel.intel_source,
      analyzed_count: recommendations.length,
      incomplete_count: recommendations.filter(r => r.analysis_status !== 'complete').length,
      signals_as_of: oldest,
      refreshed_symbols: stale,
      pipeline_summary: pipelineSummary,
      trade_history_summary: null,
      top_historical_performers: [],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[MarketAnalysis] Error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});