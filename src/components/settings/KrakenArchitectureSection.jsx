import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, Zap, Radio, RefreshCw, Activity, Wifi, Code } from 'lucide-react';
import WebSocketTester from './WebSocketTester';

export default function KrakenArchitectureSection() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showTester, setShowTester] = useState(false);

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between hover:opacity-80 transition-opacity"
        >
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Activity className="w-5 h-5 text-purple-500" />
            Kraken Integration Architecture
          </CardTitle>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          ) : (
            <ChevronDown className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          )}
        </button>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-6">
          
          {/* Overview */}
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 p-4 rounded-lg border border-purple-200 dark:border-purple-800">
            <div className="flex items-start gap-3">
              <Zap className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-bold text-sm mb-2">Real-Time Data Flow</h3>
                <p className="text-xs text-gray-700 dark:text-gray-300">
                  The app uses <strong>Kraken WebSocket API v2</strong> for instant updates,
                  eliminating polling and reducing API calls by 95%.
                </p>
              </div>
            </div>
          </div>

          {/* WebSocket Channels */}
          <div className="space-y-3">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <Radio className="w-4 h-4 text-green-500" />
              WebSocket Channels
            </h3>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                <Badge className="bg-green-500 text-white text-xs mb-2">Balances</Badge>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Instant balance updates when you trade
                </p>
              </div>

              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <Badge className="bg-blue-500 text-white text-xs mb-2">Prices</Badge>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Real-time market prices
                </p>
              </div>

              <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                <Badge className="bg-purple-500 text-white text-xs mb-2">Orders</Badge>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Track order status live
                </p>
              </div>

              <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                <Badge className="bg-yellow-500 text-white text-xs mb-2">Executions</Badge>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Instant trade confirmations
                </p>
              </div>
            </div>
          </div>

          {/* Benefits */}
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-500">
            <h3 className="font-bold text-sm mb-3 text-green-700 dark:text-green-400">
              ✅ Benefits
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <strong>🚀 95% Fewer API Calls</strong>
                <p className="text-gray-600 dark:text-gray-400">No polling = no rate limits</p>
              </div>
              <div>
                <strong>⚡ Instant Updates</strong>
                <p className="text-gray-600 dark:text-gray-400">Real-time data (no delay)</p>
              </div>
              <div>
                <strong>💰 Always Accurate</strong>
                <p className="text-gray-600 dark:text-gray-400">No stale data</p>
              </div>
              <div>
                <strong>🔄 Auto Reconnect</strong>
                <p className="text-gray-600 dark:text-gray-400">Handles disconnects</p>
              </div>
            </div>
          </div>

          {/* Test Button */}
          <div className="flex gap-2">
            <Button
              onClick={() => setShowTester(!showTester)}
              variant="outline"
              className="flex-1"
            >
              <Wifi className="w-4 h-4 mr-2" />
              {showTester ? 'Hide Test Console' : 'Test WebSocket Connection'}
            </Button>
          </div>

          {/* WebSocket Tester */}
          {showTester && <WebSocketTester />}

        </CardContent>
      )}
    </Card>
  );
}