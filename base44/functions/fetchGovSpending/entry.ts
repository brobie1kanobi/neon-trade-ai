import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Fetches recent government spending data from USASpending.gov API
 * and uses AI to map awards to tradeable symbols for signal enhancement.
 * 
 * Endpoints used:
 * - POST /api/v2/search/spending_by_award/ — search recent awards
 * - GET /api/v2/autocomplete/recipient/ — lookup recipients
 */

const SECTOR_KEYWORDS = {
  defense: ['defense', 'military', 'weapons', 'aircraft', 'missile', 'army', 'navy', 'air force', 'dod', 'pentagon'],
  healthcare: ['health', 'medical', 'pharma', 'biotech', 'hospital', 'vaccine', 'nih', 'cdc', 'hhs'],
  technology: ['software', 'cyber', 'cloud', 'data', 'ai', 'artificial intelligence', 'it services', 'computer', 'digital'],
  energy: ['energy', 'solar', 'wind', 'nuclear', 'oil', 'gas', 'renewable', 'battery', 'grid', 'doe'],
  infrastructure: ['construction', 'bridge', 'highway', 'road', 'transit', 'rail', 'water', 'infrastructure'],
  space: ['space', 'satellite', 'nasa', 'launch', 'orbit', 'rocket'],
  finance: ['financial', 'banking', 'treasury', 'lending', 'insurance']
};

function detectSector(description, agencyName) {
  const text = `${description || ''} ${agencyName || ''}`.toLowerCase();
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) return sector;
  }
  return 'general';
}

Deno.serve(async (req) => {
  const start = Date.now();
  const DEADLINE = 25000;
  const timeLeft = () => Math.max(0, DEADLINE - (Date.now() - start));

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || (user.role || '').toLowerCase() !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { 
      award_types = ['contracts', 'grants', 'loans'], 
      min_amount = 1000000,
      days_back = 7,
      limit = 25 
    } = body;

    console.log('[GovSpending] Fetching awards - types:', award_types, 'min:', min_amount, 'days:', days_back);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days_back * 24 * 60 * 60 * 1000);
    const formatDate = (d) => d.toISOString().split('T')[0];

    // Build award type filter for USASpending API
    const awardTypeMap = {
      contracts: ['A', 'B', 'C', 'D'],
      grants: ['02', '03', '04', '05'],
      loans: ['07', '08'],
      direct_payments: ['06', '10'],
      other: ['09', '11']
    };
    
    const selectedTypes = award_types.flatMap(t => awardTypeMap[t] || []);

    // Fetch from USASpending API
    // Note: fields depend on award type. For contracts use 'Award Amount', 'Start Date', 'NAICS Code'
    // For grants/loans some of these don't apply. Use base fields + contract fields (API ignores unknowns).
    const searchPayload = {
      filters: {
        time_period: [{
          start_date: formatDate(startDate),
          end_date: formatDate(endDate)
        }],
        award_type_codes: selectedTypes,
        award_amounts: [{ lower_bound: min_amount }]
      },
      fields: [
        'Award ID',
        'Recipient Name',
        'Award Amount',
        'Description',
        'Start Date',
        'Awarding Agency',
        'Awarding Sub Agency',
        'Award Type',
        'Recipient UEI',
        'Recipient Location'
      ],
      page: 1,
      limit: Math.min(limit, 50),
      sort: 'Award Amount',
      order: 'desc'
    };

    let awards = [];
    try {
      console.log('[GovSpending] Request payload:', JSON.stringify(searchPayload, null, 2));
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(10000, timeLeft() - 2000));
      
      const resp = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchPayload),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const data = await resp.json();
        awards = data?.results || [];
        console.log('[GovSpending] Got', awards.length, 'awards from USASpending API');
        if (awards.length > 0) {
          console.log('[GovSpending] Sample award keys:', Object.keys(awards[0]));
          console.log('[GovSpending] Sample award:', JSON.stringify(awards[0]).substring(0, 500));
        }
      } else {
        const errText = await resp.text().catch(() => 'unknown');
        console.error('[GovSpending] USASpending API error:', resp.status, errText.substring(0, 500));
      }
    } catch (fetchErr) {
      console.error('[GovSpending] Fetch error:', fetchErr.message);
    }

    if (awards.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'No awards found for the given criteria',
        awards_fetched: 0,
        awards_saved: 0 
      });
    }

    // Check for existing awards to avoid duplicates
    let existingIds = new Set();
    try {
      const existing = await base44.asServiceRole.entities.GovSpendingAward.filter({}, '-created_date', 200);
      existingIds = new Set(existing.map(e => e.usaspending_award_id).filter(Boolean));
    } catch (_) {}

    // Process awards - detect sectors and prepare for AI analysis
    const processedAwards = awards
      .filter(a => !existingIds.has(a['Award ID']))
      .slice(0, 20) // Cap to avoid timeout
      .map(a => {
        const amount = parseFloat(a['Award Amount'] || '0');
        const awardType = (a['Award Type'] || '').toLowerCase();
        let type = 'other';
        if (awardType.includes('contract') || ['a', 'b', 'c', 'd'].includes(awardType)) type = 'contract';
        else if (awardType.includes('grant') || ['02','03','04','05'].includes(awardType)) type = 'grant';
        else if (awardType.includes('loan') || ['07','08'].includes(awardType)) type = 'loan';
        else if (awardType.includes('direct') || ['06','10'].includes(awardType)) type = 'direct_payment';

        return {
          recipient_name: a['Recipient Name'] || 'Unknown',
          award_type: type,
          total_obligation: amount,
          awarding_agency: a['Awarding Agency'] || a['Awarding Sub Agency'] || 'Unknown',
          award_description: (a['Description'] || '').substring(0, 500),
          naics_code: a['NAICS Code'] || '',
          naics_description: a['NAICS Description'] || '',
          start_date: a['Start Date'] || formatDate(endDate),
          recipient_uei: a['Recipient UEI'] || '',
          recipient_state: a['Recipient Location']?.state_code || a['Recipient State Code'] || '',
          sector: detectSector(a['Description'], a['Awarding Agency']),
          usaspending_award_id: a['Award ID'] || '',
          fetched_at: new Date().toISOString()
        };
      });

    console.log('[GovSpending] Processing', processedAwards.length, 'new awards');

    // Use AI to analyze market impact and map to tradeable symbols
    if (processedAwards.length > 0 && timeLeft() > 8000) {
      const summaryForAI = processedAwards.map(a => 
        `- ${a.recipient_name}: $${(a.total_obligation / 1e6).toFixed(1)}M ${a.award_type} from ${a.awarding_agency} | Sector: ${a.sector} | ${a.award_description.substring(0, 100)}`
      ).join('\n');

      try {
        const aiResult = await base44.integrations.Core.InvokeLLM({
          prompt: `You are a financial analyst. Analyze these recent US government awards and determine their potential impact on cryptocurrency and stock markets.

GOVERNMENT AWARDS (last ${days_back} days):
${summaryForAI}

For EACH award, provide:
1. related_symbols: Array of tradeable symbols (crypto like BTC, ETH, SOL or stocks like AAPL, MSFT, LMT) that could be affected
2. signal_impact: "bullish", "bearish", or "neutral"
3. impact_score: 0-100 (how significantly this affects markets)
4. analysis: Brief explanation of market impact (1-2 sentences)

RULES:
- Large defense contracts → defense stocks (LMT, RTX, NOC, BA) and potentially BTC (institutional spending signals)
- Healthcare/biotech grants → pharma stocks, healthcare ETFs
- Tech/cyber contracts → tech stocks (MSFT, GOOGL, AMZN), blockchain/AI tokens
- Energy grants → energy stocks, clean energy ETFs
- Infrastructure spending → materials, construction stocks
- Large government spending generally → slight BTC/crypto bullish (inflation hedge narrative)
- Focus on awards > $10M for meaningful impact`,
          response_json_schema: {
            type: "object",
            properties: {
              awards_analysis: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    recipient_name: { type: "string" },
                    related_symbols: { type: "array", items: { type: "string" } },
                    signal_impact: { type: "string" },
                    impact_score: { type: "number" },
                    analysis: { type: "string" }
                  }
                }
              },
              overall_spending_trend: { type: "string" },
              macro_impact: { type: "string" }
            }
          }
        });

        // Merge AI analysis back into awards
        const analysisMap = new Map();
        if (aiResult?.awards_analysis) {
          for (const a of aiResult.awards_analysis) {
            analysisMap.set((a.recipient_name || '').toLowerCase().trim(), a);
          }
        }

        for (const award of processedAwards) {
          const ai = analysisMap.get((award.recipient_name || '').toLowerCase().trim());
          if (ai) {
            award.related_symbols_json = JSON.stringify(ai.related_symbols || []);
            award.signal_impact = ai.signal_impact || 'neutral';
            award.impact_score = ai.impact_score || 0;
            award.ai_analysis = ai.analysis || '';
          } else {
            award.related_symbols_json = '[]';
            award.signal_impact = 'neutral';
            award.impact_score = 0;
            award.ai_analysis = '';
          }
        }

        console.log('[GovSpending] AI analysis complete. Macro impact:', aiResult?.macro_impact || 'N/A');
      } catch (aiErr) {
        console.warn('[GovSpending] AI analysis failed:', aiErr.message);
        for (const award of processedAwards) {
          award.related_symbols_json = '[]';
          award.signal_impact = 'neutral';
          award.impact_score = 0;
          award.ai_analysis = '';
        }
      }
    }

    // Save awards to database
    let saved = 0;
    for (const award of processedAwards) {
      if (timeLeft() < 2000) break;
      try {
        await base44.asServiceRole.entities.GovSpendingAward.create(award);
        saved++;
      } catch (saveErr) {
        console.warn('[GovSpending] Save error:', saveErr.message);
      }
    }

    console.log('[GovSpending] Saved', saved, '/', processedAwards.length, 'awards');

    return Response.json({
      success: true,
      awards_fetched: awards.length,
      awards_saved: saved,
      sectors: [...new Set(processedAwards.map(a => a.sector))],
      total_value: processedAwards.reduce((sum, a) => sum + (a.total_obligation || 0), 0),
      duration_ms: Date.now() - start
    });

  } catch (error) {
    console.error('[GovSpending] Error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});