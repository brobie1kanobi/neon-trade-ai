import React from "react";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, BarChart3, Clock, Target, Info } from "lucide-react";
import { summarizeReasoning, friendlyPattern, buildEligibilityExplanation } from "@/lib/signalTranslator";

export default function AIAnalysisCard({ prospect, userMargins }) {
  const summary = summarizeReasoning(prospect.ai_reasoning);
  const explanationLines = buildEligibilityExplanation(prospect, userMargins);

  return (
    <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 space-y-2">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
        <TrendingUp className="w-3 h-3" />
        AI Market Analysis
      </p>
      <p className="text-xs text-gray-600 dark:text-gray-400">{summary}</p>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
        {prospect.technical_pattern &&
          <Badge variant="outline" className="text-xs flex items-center gap-1">
            <BarChart3 className="w-3 h-3" />
            {friendlyPattern(prospect.technical_pattern)}
          </Badge>
        }
        {prospect.timing_window &&
          <Badge variant="outline" className="text-xs flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {prospect.timing_window === 'immediate' ? '⚡ Now' : prospect.timing_window === 'short_term' ? '24-48h' : 'Wait'}
          </Badge>
        }
        {prospect.optimal_action && prospect.optimal_action !== 'buy' &&
          <Badge className={
            prospect.optimal_action === 'strong_buy' ? 'bg-green-600' :
            prospect.optimal_action === 'sell' ? 'bg-red-500' :
            prospect.optimal_action === 'strong_sell' ? 'bg-red-700' :
            'bg-gray-500'
          }>
            {prospect.optimal_action.replace('_', ' ')}
          </Badge>
        }
      </div>

      {prospect.entry_zone &&
        <div className="text-xs text-gray-500">
          <Target className="w-3 h-3 inline mr-1" />
          Entry Zone: ${prospect.entry_zone.low?.toFixed(2)} - ${prospect.entry_zone.high?.toFixed(2)}
        </div>
      }

      <div className="flex gap-4 text-xs">
        <span className="text-red-500 flex items-center gap-1">
          <TrendingDown className="w-3 h-3" />
          SL: -{Math.abs(prospect.user_loss_margin ?? userMargins?.loss_margin)}%
        </span>
        <span className="text-green-500 flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />
          TP: +{Math.abs(prospect.user_gain_margin ?? userMargins?.gain_margin)}%
        </span>
      </div>

      <div className="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-1">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1">
          <Info className="w-3 h-3" />
          Why this order reached this stage
        </p>
        {explanationLines.map((line, i) => (
          <p key={i} className="text-xs text-gray-600 dark:text-gray-400">• {line}</p>
        ))}
      </div>
    </div>
  );
}