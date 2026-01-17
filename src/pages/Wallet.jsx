import React, { useState, useEffect, useCallback } from "react";
import { Wallet, Transaction, UserSettings, User, Holding, Trade } from "@/entities/all";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { getMarketData } from "@/functions/getMarketData";
import { useKrakenData, invalidateKrakenCache } from "@/components/hooks/useKrakenData";
import { usePriceData } from "@/components/hooks/usePriceData";
import { useKrakenWebSocket } from "@/components/providers/KrakenWebSocketProvider";

import WalletBalance from "../components/wallet/WalletBalance";
import BankConnection from "../components/wallet/BankConnection";
import TransactionForm from "../components/wallet/TransactionForm";
import TransactionHistory from "../components/wallet/TransactionHistory";
import EmergencyRepair from "../components/wallet/EmergencyRepair";

export default function WalletPage() {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [settings, setSettings] = useState(null);
  const [user, setUser] = useState(null);
  const [activeAction, setActiveAction] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [portfolioMarketValue, setPortfolioMarketValue] = useState(0);
  const [lastLoadTime, setLastLoadTime] = useState(0);

  const isSimMode = settings ? (settings.sim_trading_mode !== false) : false;

  // CRITICAL: Use global WebSocket connection
  const {
    isConnected: wsConnected,
    usdBalance: wsUsdBalance,
    cryptoHoldingsValue: wsCryptoValue,
    totalPortfolioValue: wsTotalValue
  } = useKrakenWebSocket();

  // CRITICAL: Fetch real Kraken data in LIVE mode (autoFetch ALWAYS enabled for non-sim)
  const { krakenData, connected: krakenConnected, refresh: refreshKraken } = useKrakenData(isSimMode, false);

  // Removed forced REST refresh on mount; WebSocket is source of truth in LIVE mode

  // Get prices for Kraken holdings
  const krakenSymbols = React.useMemo(() => {
    if (isSimMode || !krakenData?.holdings) return [];
    return krakenData.holdings.map(h => h.symbol);
  }, [isSimMode, krakenData]);

  const { priceData } = usePriceData(krakenSymbols);

  // CRITICAL FIX: Use REST API (krakenData) as PRIMARY source - most reliable
  // WebSocket can return stale/zero data
  const krakenPortfolioValue = React.useMemo(() => {
    if (isSimMode) return 0;
    // PRIORITY 1: WebSocket crypto value
    if (wsConnected && typeof wsCryptoValue === 'number') return wsCryptoValue;
    // PRIORITY 2: REST (manual or fallback)
    if (typeof krakenData?.total_crypto_value_usd === 'number') return krakenData.total_crypto_value_usd;
    if (typeof krakenData?.total_crypto_value === 'number') return krakenData.total_crypto_value;
    // PRIORITY 3: derive from holdings/prices if available
    return 0;
  }, [isSimMode, wsConnected, wsCryptoValue, krakenData]);
  
  // CRITICAL: Cash balance from Kraken REST API
  const krakenCashBalance = React.useMemo(() => {
    if (isSimMode) return 0;
    // WebSocket first
    if (wsConnected && typeof wsUsdBalance === 'number') return wsUsdBalance;
    // REST fallback
    if (typeof krakenData?.usd_balance === 'number') return krakenData.usd_balance;
    return 0;
  }, [isSimMode, krakenData, wsConnected, wsUsdBalance]);

  const loadData = useCallback(async () => {
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
    if (lastLoadTime && (now - lastLoadTime) < 30000) { // REDUCED from 60s to 30s
      if (typeof window !== "undefined") window.__entityCallInFlight = false;
      return;
    }

    try {
      // CRITICAL: Removed 5-second artificial delay - was causing slow loads
      
      const currentUser = await User.me();
      setUser(currentUser);
      const isAdmin = (currentUser?.role || '').toLowerCase() === 'admin';
      const isCreator = !!currentUser?.is_creator;
      const isAdminOrCreator = isAdmin || isCreator;
      
      await new Promise(resolve => setTimeout(resolve, 200)); // Reduced from 500ms
      const userWallet = await Wallet.filter({ created_by: currentUser.email });
      
      await new Promise(resolve => setTimeout(resolve, 200)); // Reduced from 500ms
      const userTransactions = await Transaction.filter({ created_by: currentUser.email }, '-created_date');

      await new Promise(resolve => setTimeout(resolve, 200)); // Reduced from 500ms
      const userSettings = await UserSettings.filter({ created_by: currentUser.email });
      
      const currentSettings = userSettings[0] || { sim_trading_mode: true };
      if (!isAdminOrCreator) {
        currentSettings.sim_trading_mode = true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
      const userTrades = await Trade.filter({ 
        created_by: currentUser.email, 
        is_simulation: currentSettings.sim_trading_mode !== false 
      }, '-created_date', 100);
      
      setWallet(userWallet[0] || { 
        cash_balance: 0, 
        total_deposits: 0, 
        total_withdrawals: 0,
        real_cash_balance: 0, 
        real_total_deposits: 0,
        real_total_withdrawals: 0
      });
      
      setTransactions(userTransactions);
      setTrades(userTrades);
      setSettings(currentSettings);

      // Compute portfolio value (SIM from DB, LIVE from Kraken)
      if (currentSettings.sim_trading_mode) {
        // Simulation mode - use database holdings
        await new Promise(resolve => setTimeout(resolve, 200)); // Reduced from 500ms
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
  }, [lastLoadTime]);

  useEffect(() => {
    loadData();
    
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    if (action) {
      setActiveAction(action);
    }
  }, [loadData]);

  // CRITICAL: Listen for Kraken sync events
  useEffect(() => {
    const handleKrakenSync = () => {
      console.log('[Wallet] Kraken sync event detected, refreshing...');
      invalidateKrakenCache();
      setTimeout(() => {
        refreshKraken();
        loadData();
      }, 500);
    };

    window.addEventListener('kraken:synced', handleKrakenSync);
    
    return () => {
      window.removeEventListener('kraken:synced', handleKrakenSync);
    };
  }, [refreshKraken, loadData]);

  const executeTransaction = async (transactionData) => {
    const currentIsSimMode = settings?.sim_trading_mode !== false;

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
        await Wallet.update(wallet.id, updateData);
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
        
        await Wallet.create(newWalletData);
      }
      
      await loadData();
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
  const displayPortfolioValue = isSimMode ? portfolioMarketValue : krakenPortfolioValue;
  const displayCashBalance = isSimMode ? (wallet?.cash_balance || 0) : krakenCashBalance;

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-48 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
        <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
        <div className="h-64 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-8" style={{ backgroundColor: 'var(--primary-bg)' }}>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <EmergencyRepair 
          wallet={wallet} 
          isSimMode={isSimMode}
          onRepairComplete={() => {
            setTimeout(() => loadData(), 500);
          }}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <WalletBalance 
          wallet={wallet} 
          isSimMode={isSimMode} 
          portfolioMarketValue={displayPortfolioValue}
          cashBalance={displayCashBalance}
          onSyncComplete={() => {
            console.log('[Wallet] Sync complete, reloading data...');
            invalidateKrakenCache();
            setTimeout(() => {
              refreshKraken();
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
        <TransactionHistory transactions={transactions} trades={trades} isSimMode={isSimMode} />
      </motion.div>
    </div>
  );
}