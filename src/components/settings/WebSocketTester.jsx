import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, RefreshCw, CheckCircle, AlertCircle, Activity, FileCode } from 'lucide-react';
import { useKrakenWebSocket } from '@/components/providers/KrakenWebSocketProvider';
import { useSettings } from '@/components/utils/SettingsContext';

export default function WebSocketTester() {
  const { settings } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;

  const [logs, setLogs] = useState([]);

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, message, type }].slice(-10));
  };

  const {
    isConnected,
    balances,
    prices,
    orders,
    usdBalance,
    totalAssets,
    totalPortfolioValue,
    refresh,
    krakenOrders,
    krakenBalance
  } = useKrakenWebSocket();

  const openOrdersCount = Object.keys(orders || {}).length > 0 
    ? Object.keys(orders).length 
    : (krakenOrders?.length || 0);

  const displayAssetsCount = totalAssets > 0 
    ? totalAssets 
    : (krakenBalance?.holdings?.length || 0);

  useEffect(() => {
    if (isSimMode) {
      addLog('⚠️ Testing disabled in SIM mode', 'warning');
      return;
    }

    if (isConnected) {
      addLog('✅ WebSocket connected', 'success');
    } else {
      addLog('⏳ Connecting to Kraken WebSocket...', 'info');
    }
  }, [isConnected, isSimMode]);

  useEffect(() => {
    if (Object.keys(balances).length > 0) {
      addLog(`💰 Received ${Object.keys(balances).length} balance updates`, 'success');
    }
  }, [balances]);

  useEffect(() => {
    if (Object.keys(prices).length > 0) {
      addLog(`📊 Received ${Object.keys(prices).length} price updates`, 'success');
    }
  }, [prices]);

  useEffect(() => {
    if (Object.keys(orders).length > 0) {
      addLog(`📋 Received ${Object.keys(orders).length} order updates`, 'success');
    }
  }, [orders]);

  if (isSimMode) {
    return (
      <div className="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">
              WebSocket Testing Unavailable
            </p>
            <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-1">
              Switch to LIVE mode in Trading Settings to test WebSocket connections
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className="border-2 border-purple-500">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4" />
            WebSocket Test Console
          </CardTitle>
          <Badge className={isConnected ? 'bg-green-500' : 'bg-gray-500'}>
            {isConnected ? (
              <>
                <Wifi className="w-3 h-3 mr-1" />
                Connected
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 mr-1" />
                Disconnected
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        
        {/* Connection Status */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border">
            <p className="text-xs text-gray-500 mb-1">Connection</p>
            <div className="flex items-center gap-2">
              {isConnected ? (
                <>
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-semibold text-green-600">Active</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />
                  <span className="text-sm font-semibold text-gray-500">Connecting...</span>
                </>
              )}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900 border">
            <p className="text-xs text-gray-500 mb-1">Last Update</p>
            <p className="text-sm font-semibold">
              {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—'}
            </p>
          </div>
        </div>

        {/* Data Summary */}
        <div className="space-y-2">
          <div className="flex items-center justify-between p-2 rounded bg-green-50 dark:bg-green-900/20">
            <span className="text-xs font-medium">USD Balance</span>
            <span className="text-sm font-bold text-green-600">${(usdBalance || 0).toFixed(2)}</span>
          </div>

          <div className="flex items-center justify-between p-2 rounded bg-blue-50 dark:bg-blue-900/20">
            <span className="text-xs font-medium">Total Assets</span>
            <span className="text-sm font-bold text-blue-600">{totalAssets || 0}</span>
          </div>

          <div className="flex items-center justify-between p-2 rounded bg-purple-50 dark:bg-purple-900/20">
            <span className="text-xs font-medium">Portfolio Value</span>
            <span className="text-sm font-bold text-purple-600">${(totalPortfolioValue || 0).toFixed(2)}</span>
          </div>

          <div className="flex items-center justify-between p-2 rounded bg-yellow-50 dark:bg-yellow-900/20">
            <span className="text-xs font-medium">Open Orders</span>
            <span className="text-sm font-bold text-yellow-600">{Object.keys(orders || {}).length}</span>
          </div>
        </div>

        {/* Live Data Feeds */}
        <div className="space-y-2">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Live Price Feeds ({Object.keys(prices).length})
          </p>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {Object.entries(prices).map(([symbol, data]) => (
              <div key={symbol} className="flex items-center justify-between text-xs p-2 rounded bg-gray-50 dark:bg-gray-900">
                <span className="font-medium">{symbol}</span>
                <span className="text-green-600">${data.price?.toFixed(2) || '—'}</span>
              </div>
            ))}
            {Object.keys(prices).length === 0 && (
              <p className="text-xs text-gray-500 italic">Waiting for price data...</p>
            )}
          </div>
        </div>

        {/* Activity Log */}
        <div className="space-y-2">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Activity Log
          </p>
          <div className="max-h-40 overflow-y-auto space-y-1 p-2 rounded bg-gray-50 dark:bg-gray-900 border">
            {logs.map((log, idx) => (
              <div key={idx} className="text-xs flex items-start gap-2">
                <span className="text-gray-500 shrink-0">{log.timestamp}</span>
                <span className={
                  log.type === 'success' ? 'text-green-600' :
                  log.type === 'error' ? 'text-red-600' :
                  log.type === 'warning' ? 'text-yellow-600' :
                  'text-gray-600'
                }>
                  {log.message}
                </span>
              </div>
            ))}
            {logs.length === 0 && (
              <p className="text-xs text-gray-500 italic">No activity yet...</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            onClick={refresh}
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={!isConnected}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Data
          </Button>
          
          <Button
            onClick={() => addLog('🔄 Manual refresh triggered', 'info')}
            variant="outline"
            size="sm"
            className="flex-1"
          >
            <FileCode className="w-4 h-4 mr-2" />
            Test Log
          </Button>
        </div>

        {/* Status Indicator */}
        <div className="text-center pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {isConnected ? (
              <span className="text-green-600 flex items-center justify-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                WebSocket Active
              </span>
            ) : (
              <span className="text-gray-500">Establishing connection...</span>
            )}
          </p>
        </div>

      </CardContent>
    </Card>
  );
}