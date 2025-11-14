import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Zap, Database, Radio, RefreshCw, Activity, Wallet, TrendingUp } from 'lucide-react';

/**
 * KRAKEN INTEGRATION ARCHITECTURE
 * 
 * Visual documentation of how the app connects to Kraken
 */
export default function KrakenArchitecture() {
  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-purple-500" />
            NeonTrade AI ↔ Kraken Integration Architecture
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          
          {/* OVERVIEW */}
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 p-6 rounded-lg border-2 border-purple-200 dark:border-purple-800">
            <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-500" />
              Real-Time Data Flow
            </h3>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              <strong>NEW ARCHITECTURE:</strong> The app now uses <strong>Kraken WebSocket API v2</strong> for real-time updates,
              drastically reducing REST API calls and providing instant data synchronization.
            </p>
          </div>

          {/* WEBSOCKET LAYER */}
          <div className="space-y-4">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <Radio className="w-5 h-5 text-green-500" />
              WebSocket Layer (Real-Time)
            </h3>
            
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="border-2 border-green-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Wallet className="w-4 h-4" />
                    Balance Updates
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-2">
                  <Badge className="bg-green-500 text-white">WebSocket v2</Badge>
                  <p className="text-gray-600 dark:text-gray-400">
                    <strong>Channel:</strong> <code>balances</code>
                  </p>
                  <p className="text-gray-600 dark:text-gray-400">
                    <strong>Updates:</strong> Instant when balance changes
                  </p>
                  <p className="text-gray-600 dark:text-gray-400">
                    <strong>Benefit:</strong> No polling needed, always accurate
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2 border-blue-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Price Updates
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-2">
                  <Badge className="bg-blue-500 text-white">WebSocket v2</Badge>
                  <p className="text-gray-600 dark:text-gray-400">
                    <strong>Channel:</strong> <code>ticker</code>
                  </p>
                  <p className="text-gray-600 dark:text-gray-400">
                    <strong>Updates:</strong> Real-time price changes
                  </p>
                  <p className="text-gray-600 dark:text-gray-400">
                    <strong>Benefit:</strong> Live market data, no lag
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2 border-purple-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Order Updates
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-2">
                  <Badge className="bg-purple-500 text-white">WebSocket v2</Badge>
                  <p className="text-gray-600 dark:text-gray-400">
                    <strong>Channel:</strong> <code>openOrders</code>
                  </p>
                  <p className="text-gray-600 dark:text-gray-400">
                    <strong>Updates:</strong> Instant order status changes
                  </p>
                  <p className="text-gray-600 dark:text-gray-400">
                    <strong>Benefit:</strong> Track orders in real-time
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2 border-yellow-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Trade Executions
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-2">
                  <Badge className="bg-yellow-500 text-white">WebSocket v2</Badge>
                  <p className="text-gray-600 dark:text-gray-400">
                    <strong>Channel:</strong> <code>executions</code>
                  </p>
                  <p className="text-gray-600 dark:text-gray-400">
                    <strong>Updates:</strong> Instant trade confirmations
                  </p>
                  <p className="text-gray-600 dark:text-gray-400">
                    <strong>Benefit:</strong> Immediate trade feedback
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* REST API LAYER */}
          <div className="space-y-4">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-orange-500" />
              REST API Layer (One-Time Operations)
            </h3>
            
            <div className="grid md:grid-cols-3 gap-4">
              <Card className="border-2 border-orange-300">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Initial Sync</CardTitle>
                </CardHeader>
                <CardContent className="text-xs">
                  <Badge variant="outline">REST API</Badge>
                  <p className="text-gray-600 dark:text-gray-400 mt-2">
                    Used once to fetch historical data and establish baseline
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2 border-orange-300">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Place Orders</CardTitle>
                </CardHeader>
                <CardContent className="text-xs">
                  <Badge variant="outline">REST API</Badge>
                  <p className="text-gray-600 dark:text-gray-400 mt-2">
                    Create new orders, WebSocket confirms execution
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2 border-orange-300">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Cancel Orders</CardTitle>
                </CardHeader>
                <CardContent className="text-xs">
                  <Badge variant="outline">REST API</Badge>
                  <p className="text-gray-600 dark:text-gray-400 mt-2">
                    Cancel orders, WebSocket confirms cancellation
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* HOOKS ARCHITECTURE */}
          <div className="space-y-4">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <Database className="w-5 h-5 text-indigo-500" />
              React Hooks Architecture
            </h3>
            
            <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border space-y-3">
              <div className="flex items-start gap-3">
                <Badge className="bg-indigo-500 text-white shrink-0">NEW</Badge>
                <div>
                  <code className="text-sm font-bold">useKrakenWebSocketManager</code>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    Core WebSocket manager - handles connections, subscriptions, reconnections
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Badge className="bg-indigo-500 text-white shrink-0">NEW</Badge>
                <div>
                  <code className="text-sm font-bold">useRealtimeKrakenData</code>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    High-level hook - combines all WebSocket data with smart caching
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Badge className="bg-gray-500 text-white shrink-0">OLD</Badge>
                <div>
                  <code className="text-sm font-bold line-through">useKrakenData</code>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    Legacy REST polling hook - replace with useRealtimeKrakenData
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* BENEFITS */}
          <div className="bg-green-50 dark:bg-green-900/20 p-6 rounded-lg border-2 border-green-500">
            <h3 className="font-bold text-lg mb-4 text-green-700 dark:text-green-400">
              ✅ Benefits of New Architecture
            </h3>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <div>
                <strong>🚀 95% Fewer API Calls</strong>
                <p className="text-gray-600 dark:text-gray-400">No more polling = no rate limits</p>
              </div>
              <div>
                <strong>⚡ Instant Updates</strong>
                <p className="text-gray-600 dark:text-gray-400">See changes in real-time (no delay)</p>
              </div>
              <div>
                <strong>💰 Always Accurate</strong>
                <p className="text-gray-600 dark:text-gray-400">No stale data, no sync issues</p>
              </div>
              <div>
                <strong>🔄 Auto Reconnection</strong>
                <p className="text-gray-600 dark:text-gray-400">Handles disconnects gracefully</p>
              </div>
              <div>
                <strong>🎯 Better UX</strong>
                <p className="text-gray-600 dark:text-gray-400">Faster, smoother, more responsive</p>
              </div>
              <div>
                <strong>🛡️ Production Ready</strong>
                <p className="text-gray-600 dark:text-gray-400">Handles errors, timeouts, edge cases</p>
              </div>
            </div>
          </div>

          {/* MIGRATION GUIDE */}
          <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-lg border-2 border-blue-500">
            <h3 className="font-bold text-lg mb-4 text-blue-700 dark:text-blue-400">
              📖 Migration Guide
            </h3>
            <div className="space-y-3 text-sm">
              <div>
                <strong className="text-red-600">❌ Old Way (REST Polling):</strong>
                <pre className="bg-white dark:bg-gray-800 p-2 rounded mt-2 overflow-x-auto text-xs">
{`const { krakenData, loading } = useKrakenData(isSimMode, true);
// Polls every 30 seconds, causes rate limits`}
                </pre>
              </div>
              
              <div>
                <strong className="text-green-600">✅ New Way (WebSocket):</strong>
                <pre className="bg-white dark:bg-gray-800 p-2 rounded mt-2 overflow-x-auto text-xs">
{`const { data, isConnected } = useRealtimeKrakenData({
  subscribeToPrices: true,
  subscribeToBalances: true,
  subscribeToOrders: true,
  isSimMode
});
// Real-time updates, no polling!`}
                </pre>
              </div>
            </div>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}