import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertCircle, Link as LinkIcon, ArrowRight, Wifi } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function AutoTraderChecklist({ prerequisites, isKrakenConnected }) {
  if (!prerequisites) return null;

  return (
    <div className="w-full md:max-w-sm md:ml-auto md:sticky md:top-4 border-2 rounded-lg p-3"
      style={{ borderColor: '#22c55e', backgroundColor: 'var(--card-bg)' }}>
      <div className="flex items-center gap-2 pb-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
        {prerequisites.krakenConnected && prerequisites.hasAutoBuyPrefs && prerequisites.autoTradingEnabled ? (
          <CheckCircle className="w-5 h-5 text-green-500" />
        ) : (
          <AlertCircle className="w-5 h-5 text-yellow-500" />
        )}
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          {prerequisites.krakenConnected && prerequisites.hasAutoBuyPrefs && prerequisites.autoTradingEnabled
            ? 'Auto-Trader Active'
            : prerequisites.krakenConnected && prerequisites.hasAutoBuyPrefs
            ? 'Ready to Enable'
            : 'Setup Required'}
        </h3>
      </div>

      <div className="space-y-3 mt-3">
        {/* Kraken Connection */}
        <div className="flex gap-3 p-3 rounded-lg" style={{
          backgroundColor: prerequisites.krakenConnected ? 'rgba(34, 197, 94, 0.1)' : 'var(--secondary-bg)'
        }}>
          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{
            backgroundColor: prerequisites.krakenConnected ? 'rgba(34, 197, 94, 0.2)' : 'rgba(156, 163, 175, 0.2)',
            color: prerequisites.krakenConnected ? '#22c55e' : '#9ca3af'
          }}>
            {prerequisites.krakenConnected ? '✓' : '1'}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              Kraken Account
              {prerequisites.krakenConnected && (
                <Badge className="bg-green-500 text-white text-xs">Connected</Badge>
              )}
              {isKrakenConnected && (
                <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200 flex items-center gap-1">
                  <Wifi className="w-3 h-3" />
                  Live
                </Badge>
              )}
            </p>
            {!prerequisites.krakenConnected && (
              <>
                <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Link your Kraken exchange account with API credentials
                </p>
                <Link to={createPageUrl("Wallet")}>
                  <Button size="sm" variant="outline" className="text-xs gap-1">
                    <LinkIcon className="w-3 h-3" />
                    Go to Wallet
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Auto-Trading Toggle */}
        <div className="flex gap-3 p-3 rounded-lg" style={{
          backgroundColor: prerequisites.autoTradingEnabled ? 'rgba(34, 197, 94, 0.1)' : 'var(--secondary-bg)'
        }}>
          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{
            backgroundColor: prerequisites.autoTradingEnabled ? 'rgba(34, 197, 94, 0.2)' : 'rgba(156, 163, 175, 0.2)',
            color: prerequisites.autoTradingEnabled ? '#22c55e' : '#9ca3af'
          }}>
            {prerequisites.autoTradingEnabled ? '✓' : '2'}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              Auto-Trading Toggle
              {prerequisites.autoTradingEnabled && (
                <Badge className="bg-green-500 text-white text-xs">Enabled</Badge>
              )}
            </p>
            {!prerequisites.autoTradingEnabled && (
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Turn on the auto-trading switch in Trading Settings above
              </p>
            )}
          </div>
        </div>

        {/* Auto-Buy Preferences */}
        <div className="flex gap-3 p-3 rounded-lg" style={{
          backgroundColor: prerequisites.hasAutoBuyPrefs ? 'rgba(34, 197, 94, 0.1)' : 'var(--secondary-bg)'
        }}>
          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{
            backgroundColor: prerequisites.hasAutoBuyPrefs ? 'rgba(34, 197, 94, 0.2)' : 'rgba(156, 163, 175, 0.2)',
            color: prerequisites.hasAutoBuyPrefs ? '#22c55e' : '#9ca3af'
          }}>
            {prerequisites.hasAutoBuyPrefs ? '✓' : '3'}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              Auto-Buy Preferences
              {prerequisites.hasAutoBuyPrefs && (
                <Badge className="bg-green-500 text-white text-xs">Configured</Badge>
              )}
            </p>
            {!prerequisites.hasAutoBuyPrefs && (
              <>
                <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Configure which assets to auto-trade in Portfolio
                </p>
                <Link to={createPageUrl("Portfolio")}>
                  <Button size="sm" variant="outline" className="text-xs gap-1">
                    <ArrowRight className="w-3 h-3" />
                    Configure Portfolio
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Summary */}
        {prerequisites.krakenConnected && prerequisites.hasAutoBuyPrefs && prerequisites.autoTradingEnabled && (
          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
            <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">
              ✅ Auto-Trader Active!
            </p>
            <p className="text-xs text-green-600 dark:text-green-500">
              Your auto-trader is now monitoring the market and will execute trades automatically.
            </p>
          </div>
        )}
        {prerequisites.krakenConnected && prerequisites.hasAutoBuyPrefs && !prerequisites.autoTradingEnabled && (
          <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
            <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400 mb-1">
              ⏸️ Almost Ready!
            </p>
            <p className="text-xs text-yellow-600 dark:text-yellow-500">
              Just toggle "Enable Auto-Trading" above to start automated trading.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}