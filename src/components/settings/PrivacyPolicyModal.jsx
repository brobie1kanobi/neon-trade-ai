import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Shield, AlertTriangle, Eye, Database, Scale } from "lucide-react";

export default function PrivacyPolicyModal({ isOpen, onClose }) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Shield className="w-5 h-5 text-blue-500" />
            Privacy Policy & Disclaimer
          </DialogTitle>
          <DialogDescription style={{ color: 'var(--text-secondary)' }}>
            How NeonTrade AI handles your data and important risk disclosures
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6" style={{ color: 'var(--text-primary)' }}>

            {/* Use at Your Own Risk */}
            <div className="p-4 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <h3 className="text-lg font-semibold text-red-800 dark:text-red-400">Use at Your Own Risk</h3>
              </div>
              <div className="space-y-2 text-sm text-red-700 dark:text-red-300">
                <p>
                  <strong>NeonTrade AI is provided "as-is" without warranty of any kind.</strong> All trading signals, 
                  AI recommendations, and automated strategies are for informational purposes only and do not constitute financial advice.
                </p>
                <p>
                  Cryptocurrency and stock markets are inherently volatile and unpredictable. Past performance does not guarantee future results. 
                  You may lose some or all of your invested capital.
                </p>
                <p>
                  By using this application, you acknowledge that you are solely responsible for your trading decisions 
                  and any resulting gains or losses.
                </p>
              </div>
            </div>

            {/* Limitation of Liability */}
            <div className="p-4 rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-800">
              <div className="flex items-center gap-2 mb-3">
                <Scale className="w-5 h-5 text-orange-600" />
                <h3 className="text-lg font-semibold text-orange-800 dark:text-orange-400">Limitation of Liability</h3>
              </div>
              <div className="space-y-2 text-sm text-orange-700 dark:text-orange-300">
                <p>
                  NeonTrade AI, its developers, contributors, and affiliates shall <strong>not be held liable</strong> for any 
                  direct, indirect, incidental, consequential, or special damages arising from:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Financial losses resulting from trades executed using this platform</li>
                  <li>Inaccurate, delayed, or missing AI signals or market data</li>
                  <li>System downtime, API failures, or exchange connectivity issues</li>
                  <li>Unauthorized access to your account due to compromised credentials</li>
                  <li>Decisions made based on information provided by this application</li>
                </ul>
              </div>
            </div>

            {/* Data Collection */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Database className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold">Data We Collect</h3>
              </div>
              <div className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <div className="flex items-start gap-2">
                  <span className="text-blue-500 font-bold">•</span>
                  <p><strong>Account Information:</strong> Email address, name, and role used for authentication and app access.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-blue-500 font-bold">•</span>
                  <p><strong>Trading Data:</strong> Trades, holdings, signals, orders, and wallet balances generated through your use of the platform.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-blue-500 font-bold">•</span>
                  <p><strong>Preferences:</strong> Settings such as theme, notification preferences, and trading strategies you configure.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-blue-500 font-bold">•</span>
                  <p><strong>API Credentials:</strong> Exchange API keys you provide are stored as encrypted secrets and are never exposed to other users.</p>
                </div>
              </div>
            </div>

            {/* Data Usage & Protection */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Eye className="w-5 h-5 text-green-600" />
                <h3 className="text-lg font-semibold">Data Usage & Protection</h3>
              </div>
              <div className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <div className="flex items-start gap-2">
                  <span className="text-green-500 font-bold">✓</span>
                  <p>Your data is used solely to provide and improve NeonTrade AI services.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-500 font-bold">✓</span>
                  <p>We do not sell, share, or distribute your personal or trading data to third parties.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-500 font-bold">✓</span>
                  <p>All data in transit is encrypted via HTTPS/TLS. Data at rest is encrypted by our infrastructure provider.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-500 font-bold">✓</span>
                  <p>Row-level security ensures users can only access their own records.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-500 font-bold">✓</span>
                  <p>You may request deletion of your account and all associated data at any time via Settings.</p>
                </div>
              </div>
            </div>

            {/* Third-Party Services */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Third-Party Services</h3>
              <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
                NeonTrade AI integrates with external services to provide functionality. These services have their own privacy policies:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li><strong>Kraken Exchange</strong> — for live trading and market data</li>
                <li><strong>CoinGecko</strong> — for cryptocurrency price data</li>
                <li><strong>GitHub</strong> — optional repository integration</li>
                <li><strong>Cash App</strong> — for voluntary donations</li>
              </ul>
            </div>

            {/* Legal Footer */}
            <div className="text-xs pt-2 border-t" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }}>
              <p>
                This Privacy Policy & Disclaimer is effective as of May 2025 and may be updated at any time. 
                Continued use of NeonTrade AI after changes constitutes acceptance of the revised policy.
                This application is not a registered broker-dealer, investment advisor, or financial institution.
              </p>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}