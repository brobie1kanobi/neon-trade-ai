import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Landmark, RefreshCw, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, DollarSign } from "lucide-react";
import { fetchGovSpending } from "@/functions/fetchGovSpending";

const formatAmount = (amount) => {
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(1)}M`;
  if (amount >= 1e3) return `$${(amount / 1e3).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
};

const impactColors = {
  bullish: "text-green-400 bg-green-400/10",
  bearish: "text-red-400 bg-red-400/10",
  neutral: "text-gray-400 bg-gray-400/10"
};

const impactIcons = {
  bullish: TrendingUp,
  bearish: TrendingDown,
  neutral: Minus
};

const sectorEmojis = {
  defense: "🛡️",
  healthcare: "🏥",
  technology: "💻",
  energy: "⚡",
  infrastructure: "🏗️",
  space: "🚀",
  finance: "🏦",
  general: "📋"
};

function AwardRow({ award }) {
  const [expanded, setExpanded] = useState(false);
  const ImpactIcon = impactIcons[award.signal_impact] || Minus;
  const relatedSymbols = useMemo(() => {
    try { return JSON.parse(award.related_symbols_json || '[]'); } catch { return []; }
  }, [award.related_symbols_json]);

  return (
    <div 
      className="border rounded-lg p-3 cursor-pointer hover:bg-white/5 transition-colors"
      style={{ borderColor: 'var(--border-color)' }}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">{sectorEmojis[award.sector] || "📋"}</span>
            <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {award.recipient_name}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">
              {award.award_type}
            </Badge>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {award.awarding_agency}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-bold neon-text">{formatAmount(award.total_obligation)}</span>
          <Badge className={`text-xs ${impactColors[award.signal_impact] || impactColors.neutral}`}>
            <ImpactIcon className="w-3 h-3 mr-1" />
            {award.signal_impact}
          </Badge>
          {expanded ? <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /> : <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid var(--border-color)' }}>
          {award.ai_analysis && (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {award.ai_analysis}
            </p>
          )}
          {relatedSymbols.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Related:</span>
              {relatedSymbols.map(sym => (
                <Badge key={sym} variant="outline" className="text-xs neon-text">
                  {sym}
                </Badge>
              ))}
            </div>
          )}
          {award.award_description && (
            <p className="text-xs italic" style={{ color: 'var(--text-secondary)' }}>
              {award.award_description.substring(0, 200)}
            </p>
          )}
          <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {award.naics_description && <span>NAICS: {award.naics_description}</span>}
            {award.start_date && <span>Date: {award.start_date}</span>}
            {typeof award.impact_score === 'number' && <span>Impact: {award.impact_score}/100</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function GovSpendingInsights() {
  const [awards, setAwards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const loadAwards = async () => {
    try {
      const data = await base44.entities.GovSpendingAward.list('-created_date', 50);
      setAwards(data || []);
    } catch (err) {
      console.error('[GovSpending] Load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAwards(); }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchGovSpending({ days_back: 7, min_amount: 1000000, limit: 25 });
      await loadAwards();
    } catch (err) {
      console.error('[GovSpending] Refresh error:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const stats = useMemo(() => {
    const bullish = awards.filter(a => a.signal_impact === 'bullish').length;
    const bearish = awards.filter(a => a.signal_impact === 'bearish').length;
    const totalValue = awards.reduce((sum, a) => sum + (a.total_obligation || 0), 0);
    const sectors = [...new Set(awards.map(a => a.sector))];
    return { bullish, bearish, totalValue, sectors };
  }, [awards]);

  const displayAwards = showAll ? awards : awards.slice(0, 5);

  if (loading) {
    return (
      <Card className="border" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardContent className="p-4 text-center">
          <div className="animate-pulse text-sm" style={{ color: 'var(--text-secondary)' }}>
            Loading government spending data...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Landmark className="w-4 h-4 neon-text" />
            Gov Spending Signals
          </CardTitle>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleRefresh}
            disabled={refreshing}
            className="h-7 px-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {awards.length > 0 && (
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1">
              <DollarSign className="w-3 h-3 neon-text" />
              <span className="text-xs font-medium neon-text">{formatAmount(stats.totalValue)}</span>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>tracked</span>
            </div>
            <Badge className={impactColors.bullish + " text-xs"}>{stats.bullish} bullish</Badge>
            <Badge className={impactColors.bearish + " text-xs"}>{stats.bearish} bearish</Badge>
          </div>
        )}
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {awards.length === 0 ? (
          <div className="text-center py-4">
            <Landmark className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-secondary)' }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              No government spending data yet
            </p>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleRefresh}
              disabled={refreshing}
              className="mt-2"
            >
              {refreshing ? 'Fetching...' : 'Fetch Latest Awards'}
            </Button>
          </div>
        ) : (
          <>
            {displayAwards.map(award => (
              <AwardRow key={award.id} award={award} />
            ))}
            {awards.length > 5 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowAll(!showAll)}
                className="w-full text-xs"
              >
                {showAll ? 'Show Less' : `Show All ${awards.length} Awards`}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}