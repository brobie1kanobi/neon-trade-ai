import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createPageUrl } from "@/utils";
import { BarChart3, TrendingUp, TrendingDown, Loader2, Flame, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useSettings } from "@/components/utils/SettingsContext";

function FearGreedGauge({ score }) {
  const label = score <= 20 ? 'Extreme Fear' :
  score <= 40 ? 'Fear' :
  score <= 60 ? 'Neutral' :
  score <= 80 ? 'Greed' :
  'Extreme Greed';

  const color = score <= 20 ? '#ef4444' :
  score <= 40 ? '#f97316' :
  score <= 60 ? '#eab308' :
  score <= 80 ? '#22c55e' :
  '#16a34a';

  const bgColor = score <= 20 ? 'rgba(239,68,68,0.15)' :
  score <= 40 ? 'rgba(249,115,22,0.15)' :
  score <= 60 ? 'rgba(234,179,8,0.15)' :
  score <= 80 ? 'rgba(34,197,94,0.15)' :
  'rgba(22,163,106,0.15)';

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl" style={{ backgroundColor: bgColor }}>
      <div className="flex flex-col items-center justify-center min-w-[52px]">
        <span className="text-2xl font-black leading-none" style={{ color }}>{score}</span>
        <span className="text-[9px] font-semibold mt-0.5 uppercase tracking-wide" style={{ color }}>{label}</span>
      </div>
      <div className="flex-1">
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border-color)' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${score}%`, backgroundColor: color }} />

        </div>
        <p className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>Fear & Greed Index</p>
      </div>
    </div>);

}

export default function QuickActions() {
  const { settings, user } = useSettings();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.email) return;

    // Check sessionStorage cache first (5 min TTL)
    const cacheKey = 'dashboard_market_intel';
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed._ts < 5 * 60 * 1000) {
          setData(parsed);
          setLoading(false);
          return;
        }
      } catch (_) {}
    }

    let cancelled = false;
    (async () => {
      try {
        const watchedCrypto = settings?.watched_crypto || ['BTC', 'ETH', 'SOL', 'XRP', 'ADA'];
        const autoBuyPrefs = await base44.entities.AutoBuyPreference.filter({
          created_by: user.email,
          enabled: true
        }).catch(() => []);
        const autoBuySymbols = autoBuyPrefs.map((p) => p.symbol);
        const allSymbols = [...new Set([...watchedCrypto, ...autoBuySymbols])];

        const response = await base44.functions.invoke('analyzeSmallGains', {
          symbols: allSymbols,
          includeMarketIntelligence: true,
          includeTradeHistory: false
        });
        const result = response?.data || response;
        if (!cancelled && result?.success) {
          result._ts = Date.now();
          setData(result);
          sessionStorage.setItem(cacheKey, JSON.stringify(result));
        }
      } catch (err) {
        console.error('[QuickActions] Market intel fetch failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {cancelled = true;};
  }, [user?.email, settings?.watched_crypto]);

  const intel = data?.market_intelligence;
  const recs = data?.recommendations || [];
  const sentimentScore = intel?.market_sentiment_score || intel?.sentiment_score || null;
  const bestOpps = intel?.best_opportunities?.slice(0, 3) || [];
  const avoidList = intel?.avoid_list?.slice(0, 2) || [];
  const outlook = intel?.short_term_outlook || intel?.trading_recommendation || null;
  const topSignal = recs.find((r) => r.optimal_action === 'strong_buy' || r.optimal_action === 'strong_sell');

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardContent className="p-4">
        {/* Header row with title + AI Analysis button */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Market Pulse
          </h3>
          <a href={createPageUrl("MarketAnalysis")}>
            <Button
              variant="ghost" className="bg-lime-600 px-3 py-2 text-sm font-medium rounded-lg justify-center whitespace-nowrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:text-accent-foreground flex items-center gap-2 h-auto hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">


              <BarChart3 className="w-5 h-5 neon-text" />
              <span className="text-xs font-medium neon-text">AI Analysis</span>
            </Button>
          </a>
        </div>

        {loading ?
        <div className="flex items-center justify-center py-6 gap-2" style={{ color: 'var(--text-secondary)' }}>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">Loading market intelligence...</span>
          </div> :

        <div className="space-y-3">
            {/* Fear & Greed */}
            {sentimentScore !== null && <FearGreedGauge score={Math.round(sentimentScore)} />}

            {/* Short-term Outlook */}
            {outlook &&
          <div className="p-2.5 rounded-lg text-xs leading-relaxed" style={{ backgroundColor: 'var(--secondary-bg)', color: 'var(--text-primary)' }}>
                <p className="line-clamp-3">{outlook}</p>
              </div>
          }

            {/* Best Opportunities + Avoid */}
            <div className="flex items-start gap-3">
              {bestOpps.length > 0 &&
            <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                    <TrendingUp className="w-3 h-3 text-green-500" /> Opportunities
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {bestOpps.map((sym, i) =>
                <Badge key={i} className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] px-1.5 py-0.5">
                        {sym}
                      </Badge>
                )}
                  </div>
                </div>
            }
              {avoidList.length > 0 &&
            <div className="flex-shrink-0">
                  <p className="text-[10px] uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                    <AlertTriangle className="w-3 h-3 text-red-400" /> Avoid
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {avoidList.map((sym, i) =>
                <Badge key={i} className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-[10px] px-1.5 py-0.5">
                        {sym}
                      </Badge>
                )}
                  </div>
                </div>
            }
            </div>

            {/* Hot Signal if available */}
            {topSignal &&
          <div className="flex items-center justify-between p-2 rounded-lg border" style={{ borderColor: 'var(--neon-green)', backgroundColor: 'rgba(57, 255, 20, 0.05)' }}>
                <div className="flex items-center gap-2">
                  <Flame className="w-3.5 h-3.5 text-orange-500" />
                  <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{topSignal.symbol}</span>
                  <Badge className={topSignal.optimal_action === 'strong_buy' ? 'bg-green-500 text-white text-[10px] px-1.5 py-0' : 'bg-red-500 text-white text-[10px] px-1.5 py-0'}>
                    {topSignal.optimal_action?.replace('_', ' ')}
                  </Badge>
                </div>
                <span className={`text-xs font-bold ${(topSignal.predicted_move_pct || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {(topSignal.predicted_move_pct || 0) >= 0 ? '+' : ''}{topSignal.predicted_move_pct?.toFixed(1)}%
                </span>
              </div>
          }

            {/* No data fallback */}
            {!sentimentScore && !outlook && bestOpps.length === 0 &&
          <p className="text-xs text-center py-2" style={{ color: 'var(--text-secondary)' }}>
                Tap AI Analysis for full market insights
              </p>
          }
          </div>
        }
      </CardContent>
    </Card>);

}