import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, Minus, AlertCircle, Eye, EyeOff, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useSettings } from "@/components/utils/SettingsContext";
import { motion } from "framer-motion";

export default function BankConnection({ settings, onConnectionChange, onQuickAction, isSimMode = true }) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [krakenConnected, setKrakenConnected] = useState(false);
  const [krakenChecking, setKrakenChecking] = useState(true);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [balanceApiKey, setBalanceApiKey] = useState("");
  const [balanceApiSecret, setBalanceApiSecret] = useState("");
  const [tradeApiKey, setTradeApiKey] = useState("");
  const [tradeApiSecret, setTradeApiSecret] = useState("");
  const [showBalanceSecret, setShowBalanceSecret] = useState(false);
  const [showTradeSecret, setShowTradeSecret] = useState(false);
  const { user } = useSettings();

  // CRITICAL: Prevent duplicate requests
  const connectionInProgress = useRef(false);
  const statusCheckDone = useRef(false);

  const isAdmin = (user?.role || '').toLowerCase() === 'admin';
  const isCreator = !!user?.is_creator;
  const canUseLiveTrading = isAdmin || isCreator;

  useEffect(() => {
    const checkKrakenStatus = async () => {
      // CRITICAL: Only check once per mount
      if (statusCheckDone.current || isSimMode || !canUseLiveTrading) {
        setKrakenChecking(false);
        return;
      }

      statusCheckDone.current = true;

      try {
        console.log('[BankConnection] Checking status...');
        const response = await base44.functions.invoke('krakenApi', { action: 'status' });
        const data = response?.data || response;
        const isConnected = data?.connected || false;

        console.log('[BankConnection] Status:', isConnected);
        setKrakenConnected(isConnected);

      } catch (error) {
        console.error('[BankConnection] Status check failed:', error);
        setKrakenConnected(false);
      } finally {
        setKrakenChecking(false);
      }
    };

    checkKrakenStatus();
  }, [isSimMode, canUseLiveTrading]);

  const handleConfirmConnection = async () => {
    // CRITICAL: Prevent duplicate requests
    if (connectionInProgress.current) {
      console.log('[BankConnection] Connection already in progress, ignoring');
      return;
    }

    if (!balanceApiKey || !balanceApiSecret) {
      toast.error('Please enter Balance API Key and Secret');
      return;
    }

    connectionInProgress.current = true;
    setIsConnecting(true);

    try {
      console.log('[BankConnection] Connecting...');

      const response = await base44.functions.invoke('krakenApi', {
        action: 'connect',
        payload: {
          // Send as both legacy and new fields for maximum compatibility
          apiKey: (balanceApiKey || '').trim(),
          apiSecret: (balanceApiSecret || '').trim(),
          balanceApiKey: (balanceApiKey || '').trim(),
          balanceApiSecret: (balanceApiSecret || '').trim(),
          tradeApiKey: (tradeApiKey || '').trim() || undefined,
          tradeApiSecret: (tradeApiSecret || '').trim() || undefined
        }
      });

      const data = response?.data || response;

      if (data?.success) {
        toast.success('🎉 Kraken Connected!', {
          description: 'Your account is now linked and ready for trading'
        });
        setKrakenConnected(true);
        setShowConnectionModal(false);
        setBalanceApiKey("");
        setBalanceApiSecret("");
        setTradeApiKey("");
        setTradeApiSecret("");

        // Notify parent
        if (onConnectionChange) {
          setTimeout(() => onConnectionChange(), 500);
        }
      } else {
        throw new Error(data?.error || 'Connection failed');
      }
    } catch (error) {
      console.error('[BankConnection] Connection failed:', error);
      const respData = error?.response?.data;
      const errorMsg = respData?.error || respData?.message || error?.message || 'Unknown error';

      // Provide helpful error messages
      if (/(Invalid signature|EAPI:Invalid signature)/i.test(errorMsg)) {
        toast.error('Invalid API credentials', { description: 'Please check your API Key and Secret are correct' });
      } else if (/(Invalid nonce|EAPI:Invalid nonce)/i.test(errorMsg)) {
        toast.error('Authentication timing issue', { description: 'Please try again in a few seconds' });
      } else if (/(Invalid key|EAPI:Invalid key)/i.test(errorMsg)) {
        toast.error('API Key not recognized', { description: 'Please verify your API key is correct and active' });
      } else if (/Unknown action|Missing action/i.test(errorMsg)) {
        toast.error('App error', { description: 'Please refresh and try again (action parse failed)' });
      } else {
        toast.error('Failed to connect', { description: errorMsg });
      }
    } finally {
      setIsConnecting(false);
      connectionInProgress.current = false;
    }
  };

  const handleKrakenDisconnect = async () => {
    try {
      await base44.functions.invoke('krakenApi', { action: 'disconnect' });
      toast.success('Kraken disconnected');
      setKrakenConnected(false);
      onConnectionChange?.();
    } catch (error) {
      toast.error('Failed to disconnect');
    }
  };

  return (
    <>
      {/* Disclaimer Modal */}
      {showDisclaimerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-900 rounded-xl max-w-md w-full p-6 shadow-2xl"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Manage Funds on Exchange</h3>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                To deposit or withdraw funds, please visit your connected exchange (Kraken) directly. We don't want to handle your money, only help you grow it. Think of your money like a seed. You bring it to your garden (exchange) and Neon Trade builds a greenhouse over it, waters and cares for it until you're ready to harvest it. 😁
              </p>
              
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-red-800 dark:text-red-300 mb-1">
                      Important: Disable Auto-Trader First
                    </p>
                    <p className="text-xs text-red-700 dark:text-red-400">
                      Before making deposits or withdrawals, turn off the Auto-Trader in Settings to prevent insufficient funds errors or failed trades during the transaction.
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-xs text-gray-600 dark:text-gray-400">
                Once your transaction completes on the exchange, your balance will automatically sync with the app.
              </p>
            </div>

            <Button 
              className="w-full"
              onClick={() => setShowDisclaimerModal(false)}
            >
              Got it
            </Button>
          </motion.div>
        </div>
      )}

      {/* Connection Modal */}
      {showConnectionModal &&
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white dark:bg-gray-900 rounded-xl max-w-md w-full p-6 shadow-2xl">

            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center">
                <Building2 className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Connect to Kraken</h3>
                <p className="text-sm text-gray-500">Enter your API credentials</p>
              </div>
            </div>

            <div className="space-y-4 mb-6">
              <div className="text-gray-700 text-sm font-light dark:text-gray-300">To deposit or withdraw funds, please visit your connected exchange (Kraken) directly. We don't want to handle your money, only help you grow it. Think of your money like a seed. You bring it to your garden (exchange) and Neon Trade builds a greenhouse over it, waters and cares for it until you're ready to harvest it. 😁









            </div>

              <div className="space-y-5">
                {/* Balance (Read-Only) Key */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">Balance Key (Read-only)</p>
                  <div>
                    <Label htmlFor="balanceApiKey">API Key</Label>
                    <Input
                      id="balanceApiKey"
                      type="text"
                      value={balanceApiKey}
                      onChange={(e) => setBalanceApiKey(e.target.value)}
                      placeholder="Enter your Balance API Key"
                      className="mt-1"
                      disabled={isConnecting}
                    />
                  </div>
                  <div>
                    <Label htmlFor="balanceApiSecret">API Secret</Label>
                    <div className="relative mt-1">
                      <Input
                        id="balanceApiSecret"
                        type={showBalanceSecret ? "text" : "password"}
                        value={balanceApiSecret}
                        onChange={(e) => setBalanceApiSecret(e.target.value)}
                        placeholder="Enter your Balance API Secret"
                        className="pr-10"
                        disabled={isConnecting}
                      />
                      <button
                        type="button"
                        onClick={() => setShowBalanceSecret(!showBalanceSecret)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                        disabled={isConnecting}
                      >
                        {showBalanceSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Trade Key (Optional) */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">Trade Key (Orders/WebSocket) – optional but required for live trading</p>
                  <div>
                    <Label htmlFor="tradeApiKey">API Key</Label>
                    <Input
                      id="tradeApiKey"
                      type="text"
                      value={tradeApiKey}
                      onChange={(e) => setTradeApiKey(e.target.value)}
                      placeholder="Enter your Trade API Key"
                      className="mt-1"
                      disabled={isConnecting}
                    />
                  </div>
                  <div>
                    <Label htmlFor="tradeApiSecret">API Secret</Label>
                    <div className="relative mt-1">
                      <Input
                        id="tradeApiSecret"
                        type={showTradeSecret ? "text" : "password"}
                        value={tradeApiSecret}
                        onChange={(e) => setTradeApiSecret(e.target.value)}
                        placeholder="Enter your Trade API Secret"
                        className="pr-10"
                        disabled={isConnecting}
                      />
                      <button
                        type="button"
                        onClick={() => setShowTradeSecret(!showTradeSecret)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                        disabled={isConnecting}
                      >
                        {showTradeSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                      API Key Permissions Required
                    </p>
                    <p className="text-xs text-yellow-700 dark:text-yellow-400">
                      Balance key: Query Funds + Access WebSockets API. Trade key: Access WebSockets API + Query open/closed orders + Create/Modify orders (no withdraw needed).
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowConnectionModal(false);
                setBalanceApiKey("");
                setBalanceApiSecret("");
                setTradeApiKey("");
                setTradeApiSecret("");
              }}
              disabled={isConnecting}>

                Cancel
              </Button>
              <Button
              className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
              onClick={handleConfirmConnection}
              disabled={isConnecting || !balanceApiKey || !balanceApiSecret}>

                {isConnecting ? 'Connecting...' : 'Connect Kraken'}
              </Button>
            </div>
          </motion.div>
        </div>
      }

      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Building2 className="w-5 h-5 neon-text" />
              {isSimMode ? 'Simulation Mode' : 'Connected Accounts'}
            </CardTitle>
            {isSimMode &&
            <Badge variant="outline" className="text-xs">
                Demo
              </Badge>
            }
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSimMode ?
          <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
              <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                You're in simulation mode. Use virtual funds to practice trading.
              </p>
              <div className="flex justify-center">
                <Button 
                  onClick={() => setShowDisclaimerModal(true)} 
                  variant="outline"
                  className="text-sm px-4 py-2 h-auto"
                >
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Manage Funds
                </Button>
              </div>
            </div> :

          <>
              {canUseLiveTrading ?
            <div className="p-4 rounded-lg border" style={{ backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                        <Building2 className="w-4 h-4 text-purple-600" />
                      </div>
                      <div>
                        <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Kraken</p>
                        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {krakenChecking ? 'Checking...' : krakenConnected ? 'Connected' : 'Not connected'}
                        </p>
                      </div>
                    </div>
                    {!krakenChecking && (
                krakenConnected ?
                <Button variant="outline" size="sm" onClick={handleKrakenDisconnect}>
                          Disconnect
                        </Button> :

                <Button
                  size="sm"
                  onClick={() => setShowConnectionModal(true)}
                  disabled={isConnecting}
                  className="bg-purple-600 hover:bg-purple-700 text-white">

                          Connect
                        </Button>)

                }
                  </div>
                  
                  {krakenConnected &&
              <>
                      <div className="mt-3 p-2 rounded bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 mb-3">
                        <p className="text-xs font-medium text-green-800 dark:text-green-300">
                          ✅ Connected - You can now trade with your Kraken account
                        </p>
                      </div>

                      <div className="flex justify-center">
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => setShowDisclaimerModal(true)}
                        >
                          <AlertCircle className="w-4 h-4 mr-2" />
                          Manage Funds
                        </Button>
                      </div>
                    </>
              }

                  {!krakenConnected &&
              <div className="mt-3">
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        Connect your Kraken account to enable live trading, deposits, and withdrawals.
                      </p>
                    </div>
              }
                </div> :

            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
                  <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                    Live trading features are available for admin/creator accounts only.
                  </p>
                </div>
            }
            </>
          }
        </CardContent>
      </Card>
    </>);

}