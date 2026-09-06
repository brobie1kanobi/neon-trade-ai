import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// Narrow, app-specific AI endpoints for the asset/market UI.
// Restricted Core integrations (InvokeLLM) run here with the service role
// instead of from the browser. Only three fixed operations are exposed and
// every prompt is built server-side — no generic LLM proxy.

const SYMBOL_RE = /^[A-Za-z0-9.\-]{1,12}$/;

function cleanSymbol(input) {
  const s = String(input || '').trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}

const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    full_name: { type: 'string' },
    description: { type: 'string' },
    website: { type: 'string' },
    yahoo_symbol: { type: 'string' },
    exchange: { type: 'string' },
    sector: { type: 'string' },
    industry: { type: 'string' }
  }
};

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    const ai = base44.asServiceRole.integrations.Core;

    if (action === 'assetInsights') {
      const symbol = cleanSymbol(body?.symbol);
      if (!symbol) return Response.json({ error: 'Invalid symbol' }, { status: 400 });
      const assetType = body?.assetType === 'stock' ? 'stock' : 'crypto';

      const result = await ai.InvokeLLM({
        prompt: `Provide a detailed but concise market analysis for the ${assetType} ${symbol}.
1. sentiment: a single word — "Bullish", "Bearish" or "Neutral".
2. summary: 2-3 sentences on the current market position and outlook.
3. technical_analysis: a brief summary of key technical indicators (RSI, MACD, key moving averages).
4. recent_news: 2-3 markdown bullet points of recent significant news or catalysts affecting the price.`,
        add_context_from_internet: true,
        model: 'gemini_3_flash',
        response_json_schema: {
          type: 'object',
          properties: {
            sentiment: { type: 'string', enum: ['Bullish', 'Bearish', 'Neutral'] },
            summary: { type: 'string' },
            technical_analysis: { type: 'string' },
            recent_news: { type: 'string' }
          },
          required: ['sentiment', 'summary', 'technical_analysis', 'recent_news']
        }
      });

      return Response.json({ success: true, insights: result });
    }

    if (action === 'assetProfile') {
      const symbol = cleanSymbol(body?.symbol);
      if (!symbol) return Response.json({ error: 'Invalid symbol' }, { status: 400 });
      const assetType = body?.assetType === 'stock' ? 'stock' : 'crypto';

      const passes = (d) => {
        if (!d) return false;
        const hasDesc = d.description && String(d.description).trim().length >= 40;
        const hasName = d.full_name && String(d.full_name).trim().length >= 2;
        return hasDesc || hasName;
      };

      const attempts = [
        `Using Google.com results first, identify the official profile and key details for this ${assetType}: symbol ${symbol}.
Return concise JSON with full_name, description (2-5 sentences), website (official), yahoo_symbol (if it differs), exchange, sector and industry (for stocks).
If the info is not found, leave fields blank — do NOT fabricate.`,
        `From Yahoo Finance ONLY, fetch the profile for ${assetType} ${symbol}.
Return JSON with full_name, description (2-5 sentences), website (official), yahoo_symbol, exchange, sector, industry.`,
        `Using general web search, identify the official profile and a short description for ${assetType} ${symbol}.
Prefer the official site, Wikipedia or reputable financial sources. Return full_name, description (2-5 sentences), website, yahoo_symbol, exchange, sector, industry.`
      ];

      for (const prompt of attempts) {
        try {
          const res = await ai.InvokeLLM({
            prompt,
            add_context_from_internet: true,
            model: 'gemini_3_flash',
            response_json_schema: PROFILE_SCHEMA
          });
          if (passes(res)) return Response.json({ success: true, profile: res });
        } catch (e) {
          console.warn('[assetAiInsights] profile attempt failed:', e.message);
        }
      }

      return Response.json({ success: true, profile: null });
    }

    if (action === 'marketAnalystChat') {
      const question = String(body?.question || '').trim().slice(0, 500);
      if (!question) return Response.json({ error: 'Question required' }, { status: 400 });

      // Market context is fetched server-side — the client cannot inject it.
      let marketContext = '';
      try {
        const md = await base44.functions.invoke('getMarketData', {
          action: 'getWatchlistData',
          payload: {
            cryptoSymbols: ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE'],
            stockSymbols: ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA', 'META']
          }
        });
        const rows = Array.isArray(md?.data) ? md.data : [];
        if (rows.length > 0) {
          marketContext = `\n\nREAL-TIME MARKET DATA (as of ${new Date().toISOString()}):\n` +
            rows.map((d) => {
              const price = Number(d.price ?? d.current_price ?? 0);
              const chg = Number(d.change ?? d.change_24h_percent ?? d.price_change_percentage_24h ?? 0);
              return `${d.symbol}: $${price.toFixed(2)} (24h: ${chg.toFixed(2)}%)`;
            }).join('\n');
        }
      } catch (e) {
        console.warn('[assetAiInsights] market context unavailable:', e.message);
      }

      const res = await ai.InvokeLLM({
        prompt: [
          'You are a professional market analyst for a trading app, answering the user question below.',
          'Only answer questions about markets, assets, trading and investing. For anything else, reply that you can only discuss markets.',
          'Today is ' + new Date().toISOString().slice(0, 10) + '.',
          'Answer concisely with clear reasoning based on current market conditions. If asked to predict, give an educated estimate and note the uncertainty.',
          marketContext,
          `\nUser Question: ${question}`
        ].join('\n'),
        add_context_from_internet: true,
        model: 'gemini_3_flash'
      });

      const answer = typeof res === 'string' ? res : (res?.answer || JSON.stringify(res));
      return Response.json({ success: true, answer });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}