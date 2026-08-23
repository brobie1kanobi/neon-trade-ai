// Translates the raw technical strings stored on AssetSignal (e.g. the
// "v7 multi-strategy [...] composite=25.6 | RSI=42.0(+20), ..." reasoning)
// into plain-English explanations for display. The RAW data is left
// untouched in the database — these are pure, read-only formatting helpers
// so trade history / future prediction models keep the exact original data.

export function parseV7Reasoning(reasoning) {
  if (!reasoning || !reasoning.startsWith('v7 multi-strategy')) return null;

  const compositeMatch = reasoning.match(/composite=([-\d.]+)/);
  const composite = compositeMatch ? parseFloat(compositeMatch[1]) : null;
  const insights = [];

  const rsiMatch = reasoning.match(/RSI=([-\d.]+)\(([+-]?\d+)\)/);
  if (rsiMatch) {
    const rsi = parseFloat(rsiMatch[1]);
    const contribution = parseInt(rsiMatch[2], 10);
    let detail;
    if (rsi < 25) detail = 'deeply oversold — often precedes a bounce';
    else if (rsi < 35) detail = 'oversold, favoring buyers';
    else if (rsi < 45) detail = 'leaning oversold';
    else if (rsi < 55) detail = 'neutral, no clear momentum bias';
    else if (rsi < 65) detail = 'leaning overbought';
    else if (rsi < 75) detail = 'overbought, favoring sellers';
    else detail = 'deeply overbought — risk of a pullback';
    insights.push({ label: 'Momentum (RSI)', detail: `RSI is ${rsi.toFixed(0)} — ${detail}`, contribution });
  }

  const macdMatch = reasoning.match(/MACD=([+-][\d.]+)\(([+-]?\d+)\)/);
  if (macdMatch) {
    const contribution = parseInt(macdMatch[2], 10);
    const detail = contribution > 0 ? 'trending upward (bullish crossover)' : contribution < 0 ? 'trending downward (bearish crossover)' : 'flat, no clear trend';
    insights.push({ label: 'Trend (MACD)', detail: `Price momentum is ${detail}`, contribution });
  }

  const bbMatch = reasoning.match(/BB%B=([-\d.]+)\(([+-]?\d+)\)/);
  if (bbMatch) {
    const pctB = parseFloat(bbMatch[1]);
    const contribution = parseInt(bbMatch[2], 10);
    let detail;
    if (pctB < 0.05) detail = 'below its lower volatility band — stretched to the downside';
    else if (pctB < 0.2) detail = 'near its lower volatility band';
    else if (pctB < 0.4) detail = 'in the lower half of its recent trading range';
    else if (pctB < 0.6) detail = 'near the middle of its recent trading range';
    else if (pctB < 0.8) detail = 'in the upper half of its recent trading range';
    else if (pctB < 0.95) detail = 'near its upper volatility band';
    else detail = 'above its upper volatility band — stretched to the upside';
    insights.push({ label: 'Volatility Bands', detail: `Price is ${detail}`, contribution });
  }

  const trendMatch = reasoning.match(/Trend\(([+-]?\d+)\)/);
  if (trendMatch) {
    const contribution = parseInt(trendMatch[1], 10);
    const detail = contribution > 0 ? 'agree on an uptrend' : contribution < 0 ? 'agree on a downtrend' : 'disagree — no clear trend';
    insights.push({ label: 'Multi-Timeframe Trend', detail: `Short and medium-term charts ${detail}`, contribution });
  }

  const volMatch = reasoning.match(/Vol=([\d.]+)x\(([+-]?\d+)\)/);
  if (volMatch) {
    const ratio = parseFloat(volMatch[1]);
    const contribution = parseInt(volMatch[2], 10);
    let detail;
    if (ratio > 2) detail = `very high (${ratio.toFixed(1)}x normal) — strongly confirms the move`;
    else if (ratio > 1.3) detail = `above average (${ratio.toFixed(1)}x normal) — supports the move`;
    else if (ratio < 0.5) detail = `quiet (${ratio.toFixed(1)}x normal) — low conviction either way`;
    else detail = `roughly normal (${ratio.toFixed(1)}x average)`;
    insights.push({ label: 'Trading Volume', detail: `Volume is ${detail}`, contribution });
  }

  const sentMatch = reasoning.match(/Sent=([-\d.]+)\(([^)]*)\)/);
  if (sentMatch) {
    const score = parseFloat(sentMatch[1]);
    const text = (sentMatch[2] || '').trim();
    insights.push({ label: 'Market Sentiment', detail: text || `AI-assessed sentiment score: ${score}`, contribution: score });
  }

  const histMatch = reasoning.match(/Hist\(([+-]?\d*)\)/);
  if (histMatch) {
    const contribution = histMatch[1] ? parseInt(histMatch[1], 10) : 0;
    let detail;
    if (contribution > 15) detail = 'this asset has a strong track record of past winning auto-trades';
    else if (contribution > 0) detail = 'this asset has a decent track record of past auto-trades';
    else if (contribution < 0) detail = 'this asset has a below-average track record of past auto-trades';
    else detail = 'not enough trade history yet to score this asset';
    insights.push({ label: 'Past Performance', detail, contribution });
  }

  const btcMatch = reasoning.match(/BTC:\s*([^|]+)$/);
  const btcNote = btcMatch ? btcMatch[1].trim() : null;

  return { composite, insights: insights.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)), btcNote };
}

// Human summary sentence for the AI Market Analysis block. Falls back to the
// raw reasoning text as-is when it isn't the v7 technical format (e.g. plain
// LLM prose from analyzeSmallGains).
export function summarizeReasoning(reasoning) {
  const parsed = parseV7Reasoning(reasoning);
  if (!parsed) return reasoning || 'Analyzing entry opportunity...';

  const top = parsed.insights.slice(0, 2).map(i => i.label).join(' and ');
  const scoreLabel = parsed.composite == null ? '' :
    parsed.composite >= 50 ? 'a strong buy score' :
    parsed.composite >= 20 ? 'a buy score' :
    parsed.composite <= -50 ? 'a strong sell score' :
    parsed.composite <= -20 ? 'a sell score' : 'a neutral score';

  let summary = top ? `Driven mainly by ${top}, this adds up to ${scoreLabel} (${parsed.composite?.toFixed(0)}/100).` : `Composite score: ${parsed.composite?.toFixed(0)}/100.`;
  if (parsed.btcNote) summary += ` ${parsed.btcNote}.`;
  return summary;
}

export function friendlyPattern(pattern) {
  if (!pattern || /no clear pattern/i.test(pattern)) {
    return 'No specific chart pattern — this call is based on indicator scores, not a textbook formation.';
  }
  return pattern;
}

// Builds the "why has this order made it this far" explanation from the
// prospect fields already computed by the backend (confidence, trend,
// entry zone, allocation) so it stays 100% consistent with the actual data.
export function buildEligibilityExplanation(prospect, userMargins) {
  const lines = [];
  const actionLabel = prospect.optimal_action === 'strong_buy' ? 'a STRONG BUY' : 'a BUY';
  lines.push(`AI rated this ${actionLabel} signal at ${prospect.confidence_score}% confidence.`);

  if (typeof prospect.market_trend === 'number') {
    const dir = prospect.market_trend >= 0 ? 'up' : 'down';
    lines.push(`Price is ${dir} ${Math.abs(prospect.market_trend).toFixed(2)}% over the last 24h — within the safe range the AI trades in (not chasing a pump or catching a falling knife).`);
  }

  if (prospect.entry_zone_status === 'in_zone') lines.push('Current price is inside the AI\'s recommended entry zone.');
  else if (prospect.entry_zone_status === 'below_zone') lines.push('Current price is below the AI\'s ideal entry zone (even better value than expected).');
  else if (prospect.entry_zone_status === 'above_zone') lines.push('Current price is above the AI\'s ideal entry zone — a bit late to this move.');

  if (typeof prospect.total_value === 'number' && typeof prospect.user_allocation_pct === 'number') {
    const gain = userMargins?.gain_margin ?? prospect.user_gain_margin;
    const loss = userMargins?.loss_margin ?? prospect.user_loss_margin;
    lines.push(`Sized at ${prospect.user_allocation_pct}% of your available trading cash ($${prospect.total_value.toFixed(2)}), with a +${gain}% take-profit and -${loss}% stop-loss.`);
  }

  return lines;
}