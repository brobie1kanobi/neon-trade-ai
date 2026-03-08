import React, { useState, useEffect, useCallback } from "react";
import { Wallet as WalletEntity, Transaction, UserSettings, User, Holding, Trade } from "@/entities/all";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { getMarketData } from "@/functions/getMarketData";
import { useKrakenWebSocket } from "@/components/providers/KrakenWebSocketProvider";
import { useSettings } from "@/components/utils/SettingsContext";

import WalletBalance from "../components/wallet/WalletBalance";
import BankConnection from "../components/wallet/BankConnection";
import TransactionForm from "../components/wallet/TransactionForm";
import TransactionHistory from "../components/wallet/TransactionHistory";
import { getRecent, setRecent } from "@/components/hooks/useGlobalDataStore";

export default function WalletPage() {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [krakenTrades, setKrakenTrades] = useState([]);
  const [user, setUser] = useState(null);
  const [activeAction, setActiveAction] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [portfolioMarketValue, setPortfolioMarketValue] = useState(0);
  const [lastLoadTime, setLastLoadTime] = useState(0);

  // CRITICAL: Use shared SettingsContext as single source of truth for mode
  // This prevents the page from defaulting to sim mode during loading/rate limits
  const { settings, isLoading: settingsLoading } = useSettings();
  
  // CRITICAL: Derive sim mode from SHARED settings context - NOT local state
  // Default to null while loading (not true) so we can show loading state
  const isSimMode = settings ? (settings.sim_trading_mode !== false) : null;
  
  // Track previous mode to detect transitions
  const prevSimModeRef = React.useRef(isSimMode);

  // CRITICAL: Use CENTRALIZED WebSocket provider - single source of truth for ALL Kraken data
  const {
    isConnected: wsConnectedFromProvider,
    usdBalance: wsUsdBalance,
    cryptoHoldingsValue: wsCryptoValue,
    totalPortfolioValue: wsTotalValue,
    // CRITICAL: Use centralized REST data instead of direct API calls
    krakenBalance: krakenData,
    fetchKrakenData,
    restDataLoading
  } = useKrakenWebSocket();

  // CRITICAL: Also check global window state - provider React state can be stale
  const wsConnected = wsConnectedFromProvider || (typeof window !== 'undefined' && window.__krakenWsConnected);

  // CRITICAL: Use provider data directly - no duplicate price fetching
  const krakenPortfolioValue = React.useMemo(() => {
    if (isSimMode) return 0;

    // PRIORITY 1: Use Kraken REST API data (most reliable)
    if (krakenData?.total_crypto_value_usd !== undefined) {
      return krakenData.total_crypto_value_usd;
    }
    if (krakenData?.total_crypto_value !== undefined) {
      return krakenData.total_crypto_value;
    }

    // PRIORITY 2: Sum up total_value_usd from individual holdings
    if (krakenData?.holdings && krakenData.holdings.length > 0) {
      const sumOfHoldings = krakenData.holdings.reduce((sum, h) => sum + (h.total_value_usd || 0), 0);
      if (sumOfHoldings >= 0) return sumOfHoldings;
    }

    // PRIORITY 3: Use WebSocket as fallback
    if (wsConnected && wsCryptoValue > 0) {
      return wsCryptoValue;
    }

    return 0;
  }, [isSimMode, wsConnected, wsCryptoValue, krakenData]);
  
  // CRITICAL: Cash balance from Kraken REST API
  const krakenCashBalance = React.useMemo(() => {
    if (isSimMode) return 0;
    
    // REST API first
    if (krakenData?.usd_balance >= 0 && krakenData?.usd_balance !== undefined) {
      console.log('[Wallet] ✅ Using Kraken API usd_balance:', krakenData.usd_balance.toFixed(2));
      return krakenData.usd_balance;
    }
    
    // WebSocket fallback
    if (wsConnected && wsUsdBalance > 0) {
      return wsUsdBalance;
    }
    
    return 0;
  }, [isSimMode, krakenData, wsConnected, wsUsdBalance]);

  const loadData = useCallback(async (force = false) => {
    // CRITICAL: Don't load data until we know the mode from SettingsContext
    if (isSimMode === null) return;

    // CROSS-PAGE CHECK: If Dashboard/Portfolio just loaded everything, reuse it
    if (!force) {
      const recentWallet = getRecent('wallet');
      const tradeKey = `trades_${isSimMode ? 'sim' : 'real'}`;
      const recentTrades = getRecent(tradeKey);
      if (recentWallet && recentTrades) {
        console.log('[Wallet] Using cross-page cached wallet + trades (< 15s old)');
        setWallet(recentWallet);
        setTrades(recentTrades);
        setIsLoading(false);
        // Still need user and transactions, but wallet/trades are the expensive calls
        try {
          const currentUser = await User.me();
          setUser(currentUser);
          const userTransactions = await Transaction.filter({ created_by: currentUser.email }, '-created_date');
          setTransactions(userTransactions);
        } catch (_) {}
        return;
      }
    }
    
    if (typeof window !== "undefined") {
      if (window.__entityCooldownUntil && Date.now() < window.__entityCooldownUntil) {
        console.log('Wallet: Global cooldown active, skipping load');
        setIsLoading(false);
        return;
      }
      if (window.__entityCallInFlight) {
        console.log('Wallet: Another entity call in flight, skipping');
        return;
      }
      window.__entityCallInFlight = true;
    }

    const now = Date.now();
    if (!force && lastLoadTime && (now - lastLoadTime) < 30000) {
      if (typeof window !== "undefined") window.__entityCallInFlight = false;
      return;
    }

    try {
      const currentUser = await User.me();
      setUser(currentUser);
      
      // Fetch wallet and transaction data in parallel
      const [userWalletArr, userTransactions] = await Promise.all([
        WalletEntity.filter({ created_by: currentUser.email }),
        Transaction.filter({ created_by: currentUser.email }, '-created_date')
      ]);
      
      const userWallet = userWalletArr;
      
      // CRITICAL: Use isSimMode from SettingsContext (already validated by context)
      const userTrades = await Trade.filter({ 
        created_by: currentUser.email, 
        is_simulation: isSimMode 
      }, '-created_date', 100);
      
      // CRITICAL: In LIVE mode ONLY, fetch Kraken trades for display
      // SIM mode NEVER calls Kraken APIs - it has no API keys
      if (!isSimMode) {
        try {
          const response = await base44.functions.invoke('krakenApi', { action: 'getTradesHistory' });
          const data = response?.data || response;
          if (data?.trades && Array.isArray(data.trades)) {
            setKrakenTrades(data.trades);
          }
        } catch (err) {
          console.warn('[Wallet] Failed to fetch Kraken trades:', err);
        }
      }
      
      const walletData = userWallet[0] || { 
        cash_balance: 0, 
        total_deposits: 0, 
        total_withdrawals: 0,
        real_cash_balance: 0, 
        real_total_deposits: 0,
        real_total_withdrawals: 0
      };
      
      setWallet(walletData);
      setRecent('wallet', walletData); // Store for cross-page reuse
      setTransactions(userTransactions);
      setTrades(userTrades);
      setRecent(`trades_${isSimMode ? 'sim' : 'real'}`, userTrades);

      // Compute portfolio value (SIM from DB, LIVE from Kraken)
      if (isSimMode) {
        // Simulation mode - use database holdings
        const userHoldings = await Holding.filter({ 
          created_by: currentUser.email, 
          is_simulation: true 
        });
        
        if (Array.isArray(userHoldings) && userHoldings.length > 0) {
          const cryptoSymbols = userHoldings.filter(h => h.asset_type === 'crypto').map(h => h.symbol);
          const stockSymbols = userHoldings.filter(h => h.asset_type === 'stock').map(h => h.symbol);
          
          try {
            const { data: quotes } = await getMarketData({
              action: "getWatchlistData",
              payload: { cryptoSymbols, stockSymbols }
            });
            
            let total = 0;
            userHoldings.forEach(h => {
              const q = Array.isArray(quotes) ? quotes.find(d => (d.symbol || '').toUpperCase() === (h.symbol || '').toUpperCase()) : null;
              const price = typeof q?.price === 'number'
                ? q.price
                : (typeof q?.current_price === 'number' ? q.current_price : h.average_cost_price || 0);
              total += (h.quantity || 0) * (price || 0);
            });
            setPortfolioMarketValue(total);
          } catch (_e) {
            setPortfolioMarketValue(0);
          }
        } else {
          setPortfolioMarketValue(0);
        }
      } else {
        // LIVE mode - portfolio value will come from krakenPortfolioValue
        console.log('[Wallet] LIVE mode - portfolio value from Kraken');
      }

      const urlParams = new URLSearchParams(window.location.search);
      const paymentStatus = urlParams.get('payment');
      
      if (paymentStatus === 'success') {
        toast.success("Payment successful! Your funds have been added to your account.");
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(loadData, 1000);
      } else if (paymentStatus === 'cancelled') {
        toast.info("Payment was cancelled.");
        window.history.replaceState({}, '', window.location.pathname);
      }

      setLastLoadTime(Date.now());
      
    } catch (error) {
      console.log("Loading wallet data error:", error);
      const msg = (error?.message || '').toLowerCase();
      const status = error?.response?.status || error?.status;
      
      if (status === 429 || msg.includes('rate limit')) {
        if (typeof window !== "undefined") {
          window.__entityCooldownUntil = Date.now() + 65000;
        }
        toast.error('Rate limit reached. Please wait a moment before refreshing.');
        
        setTimeout(() => {
          if (typeof window !== "undefined") window.__entityCallInFlight = false;
          loadData();
        }, 65000);
        return;
      }
      
      setPortfolioMarketValue(0);
    } finally {
      setIsLoading(false);
      if (typeof window !== "undefined") {
        window.__entityCallInFlight = false;
      }
    }
  }, [lastLoadTime, isSimMode]);

  useEffect(() => {
    loadData();
    
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    if (action) {
      setActiveAction(action);
    }
  }, [loadData]);
  
  // CRITICAL: When mode changes, reset all data to prevent sim data showing in live mode
  React.useEffect(() => {
    if (prevSimModeRef.current !== isSimMode && isSimMode !== null) {
      console.log('[Wallet] Mode changed from', prevSimModeRef.current ? 'SIM' : 'LIVE', 'to', isSimMode ? 'SIM' : 'LIVE', '- resetting data');
      prevSimModeRef.current = isSimMode;
      setPortfolioMarketValue(0);
      setKrakenTrades([]);
      setLastLoadTime(0); // Reset cooldown to allow immediate reload
      loadData(true);
    }
  }, [isSimMode, loadData]);

  // CRITICAL: Listen for Kraken sync events
  useEffect(() => {
    const handleKrakenSync = () => {
      console.log('[Wallet] Kraken sync event detected, refreshing...');
      setTimeout(() => {
        fetchKrakenData(true);
        loadData(true);
      }, 500);
    };

    window.addEventListener('kraken:synced', handleKrakenSync);
    
    return () => {
      window.removeEventListener('kraken:synced', handleKrakenSync);
    };
  }, [fetchKrakenData, loadData]);

  const executeTransaction = async (transactionData) => {
    const currentIsSimMode = isSimMode;

    try {
      await Transaction.create({
        ...transactionData,
        is_real_money: !currentIsSimMode
      });
      
      let updateData = {};
      let prevBalance, prevDeposits, prevWithdrawals;
      let balanceKey, depositsKey, withdrawalsKey;

      if (currentIsSimMode) {
        prevBalance = wallet.cash_balance;
        prevDeposits = wallet.total_deposits;
        prevWithdrawals = wallet.total_withdrawals;
        balanceKey = 'cash_balance';
        depositsKey = 'total_deposits';
        withdrawalsKey = 'total_withdrawals';
      } else {
        prevBalance = wallet.real_cash_balance;
        prevDeposits = wallet.real_total_deposits;
        prevWithdrawals = wallet.real_total_withdrawals;
        balanceKey = 'real_cash_balance';
        depositsKey = 'real_total_deposits';
        withdrawalsKey = 'real_total_withdrawals';
      }

      const newBalanceValue = transactionData.type === 'deposit'
        ? (prevBalance + transactionData.amount)
        : (prevBalance - transactionData.amount);
      
      const newDepositsValue = transactionData.type === 'deposit'
        ? (prevDeposits + transactionData.amount)
        : prevDeposits;
        
      const newWithdrawalsValue = transactionData.type === 'withdrawal'
        ? (prevWithdrawals + transactionData.amount)
        : prevWithdrawals;

      updateData = {
        [balanceKey]: Math.max(0, newBalanceValue),
        [depositsKey]: newDepositsValue,
        [withdrawalsKey]: newWithdrawalsValue
      };

      if (wallet.id) {
        await WalletEntity.update(wallet.id, updateData);
      } else {
        const newWalletData = {
          cash_balance: currentIsSimMode ? Math.max(0, newBalanceValue) : 0,
          total_deposits: currentIsSimMode ? newDepositsValue : 0,
          total_withdrawals: currentIsSimMode ? newWithdrawalsValue : 0,
          real_cash_balance: !currentIsSimMode ? Math.max(0, newBalanceValue) : 0,
          real_total_deposits: !currentIsSimMode ? newDepositsValue : 0,
          real_total_withdrawals: !currentIsSimMode ? newWithdrawalsValue : 0,
          created_by: user.email
        };
        
        await WalletEntity.create(newWalletData);
      }
      
      await loadData(true);
      setActiveAction(null);

      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { type: 'transaction', source: 'wallet' } }));

      const notificationsEnabled = settings?.notifications_enabled === true;
      const appInBackground = document.visibilityState === 'hidden';

      if (notificationsEnabled && appInBackground) {
        const title = transactionData.type === 'deposit' ? 'Deposit Completed' : 'Withdrawal Completed';
        const modeLabel = currentIsSimMode ? 'Simulation' : 'Live';
        const body = `${transactionData.type === 'deposit' ? 'Added' : 'Removed'} $${transactionData.amount.toFixed(2)} (${modeLabel})`;
        
        await base44.functions.invoke('pushNotifications', {
          action: 'sendNotification',
          payload: { 
            title, 
            body, 
            data: { 
              type: 'wallet', 
              txType: transactionData.type, 
              amount: transactionData.amount, 
              isSimMode: currentIsSimMode 
            } 
          }
        }).catch(() => {});
      }

    } catch (error) {
      console.error("Error executing transaction:", error);
      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { type: 'transaction_error', source: 'wallet' } }));
    }
  };

  // CRITICAL: Use Kraken values in LIVE mode
  const displayPortfolioValue = isSimMode ? Math.max(0, portfolioMarketValue) : Math.max(0, krakenPortfolioValue);
  const displayCashBalance = isSimMode ? Math.max(0, wallet?.cash_balance || 0) : Math.max(0, krakenCashBalance);

  // CRITICAL: Don't render until we know the mode - prevents showing sim UI in live mode
  if (isSimMode === null || settingsLoading) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[60vh]" style={{ backgroundColor: 'var(--primary-bg)' }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-green-400 rounded-full animate-spin mx-auto mb-3" style={{ borderTopColor: 'var(--neon-green)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Loading wallet...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-8" style={{ backgroundColor: 'var(--primary-bg)' }}>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <WalletBalance 
          wallet={wallet} 
          isSimMode={isSimMode} 
          portfolioMarketValue={displayPortfolioValue}
          cashBalance={displayCashBalance}
          isLoading={isLoading || (!isSimMode && restDataLoading)}
          onSyncComplete={() => {
            console.log('[Wallet] Sync complete, reloading data...');
            setTimeout(() => {
              fetchKrakenData(true);
              loadData();
            }, 500);
          }}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <BankConnection 
          settings={settings} 
          onConnectionChange={loadData}
          onQuickAction={setActiveAction}
          isSimMode={isSimMode} 
        />
      </motion.div>

      {activeAction && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <TransactionForm
            type={activeAction}
            wallet={wallet}
            settings={settings}
            onSubmit={executeTransaction}
            onCancel={() => setActiveAction(null)}
            isSimMode={isSimMode} 
          />
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <TransactionHistory 
          transactions={transactions} 
          trades={trades} 
          isSimMode={isSimMode}
          krakenTrades={krakenTrades}
        />
      </motion.div>
    </div>
  );
}