import React, { useState, useEffect, useCallback } from "react";
import { Wallet, Transaction, UserSettings, User, Holding } from "@/entities/all";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { getMarketData } from "@/functions/getMarketData";
import { useRealtimeKrakenData } from "@/components/hooks/useRealtimeKrakenData";
import { usePriceData } from "@/components/hooks/usePriceData";

import WalletBalance from "../components/wallet/WalletBalance";
import BankConnection from "../components/wallet/BankConnection";
import TransactionForm from "../components/wallet/TransactionForm";
import TransactionHistory from "../components/wallet/TransactionHistory";
import EmergencyRepair from "../components/wallet/EmergencyRepair";

export default function WalletPage() {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [settings, setSettings] = useState(null);
  const [user, setUser] = useState(null);
  const [activeAction, setActiveAction] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [portfolioMarketValue, setPortfolioMarketValue] = useState(0);
  const [lastLoadTime, setLastLoadTime] = useState(0);

  const isSimMode = settings?.sim_trading_mode !== false;

  // CRITICAL: Use WebSocket data for LIVE mode
  const { 
    usdBalance: wsUsdBalance,
    totalPortfolioValue: wsTotalValue,
    balances: wsBalances,
    prices: wsPrices,
    isConnected: wsConnected,
    refresh: wsRefresh
  } = useRealtimeKrakenData({
    subscribeToPrices: true,
    priceSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD'],
    subscribeToBalances: !isSimMode,
    subscribeToOrders: false,
    subscribeToExecutions: false,
    isSimMode
  });

  // CRITICAL: Calculate portfolio value from WebSocket in LIVE mode
  const krakenPortfolioValue = React.useMemo(() => {
    if (isSimMode) return 0;

    // Use WebSocket total portfolio value minus cash balance
    if (wsConnected && wsTotalValue >= 0 && wsUsdBalance >= 0) {
      const portfolioValue = wsTotalValue - wsUsdBalance;
      console.log('[Wallet] ✅ Using WebSocket portfolio value:', portfolioValue.toFixed(2));
      return portfolioValue;
    }

    console.warn('[Wallet] ⚠️ No WebSocket data available');
    return 0;
  }, [isSimMode, wsConnected, wsTotalValue, wsUsdBalance]);

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
    if (lastLoadTime && (now - lastLoadTime) < 30000) {
      if (typeof window !== "undefined") window.__entityCallInFlight = false;
      return;
    }

    try {
      const currentUser = await User.me();
      setUser(currentUser);
      const isAdmin = (currentUser?.role || '').toLowerCase() === 'admin';
      const isCreator = !!currentUser?.is_creator;
      const isAdminOrCreator = isAdmin || isCreator;
      
      await new Promise(resolve => setTimeout(resolve, 200));
      const userWallet = await Wallet.filter({ created_by: currentUser.email });
      
      await new Promise(resolve => setTimeout(resolve, 200));
      const userTransactions = await Transaction.filter({ created_by: currentUser.email }, '-created_date');

      await new Promise(resolve => setTimeout(resolve, 200));
      const userSettings = await UserSettings.filter({ created_by: currentUser.email });
      
      setWallet(userWallet[0] || { 
        cash_balance: 0, 
        total_deposits: 0, 
        total_withdrawals: 0,
        real_cash_balance: 0, 
        real_total_deposits: 0,
        real_total_withdrawals: 0
      });
      
      setTransactions(userTransactions);

      const currentSettings = userSettings[0] || { sim_trading_mode: true };
      if (!isAdminOrCreator) {
        currentSettings.sim_trading_mode = true;
      }
      setSettings(currentSettings);

      // Compute portfolio value for SIM mode only
      if (currentSettings.sim_trading_mode) {
        await new Promise(resolve => setTimeout(resolve, 200));
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

  // Listen for data sync events
  useEffect(() => {
    const handleSync = () => {
      console.log('[Wallet] Sync event detected, refreshing...');
      wsRefresh();
      setTimeout(() => loadData(), 500);
    };

    window.addEventListener('kraken:synced', handleSync);
    window.addEventListener('trade:completed', handleSync);
    
    return () => {
      window.removeEventListener('kraken:synced', handleSync);
      window.removeEventListener('trade:completed', handleSync);
    };
  }, [wsRefresh, loadData]);

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

  // CRITICAL: Use WebSocket portfolio value in LIVE mode
  const displayPortfolioValue = isSimMode ? portfolioMarketValue : krakenPortfolioValue;

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
          onSyncComplete={() => {
            console.log('[Wallet] Sync complete, reloading data...');
            wsRefresh();
            setTimeout(() => loadData(), 500);
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
        <TransactionHistory transactions={transactions} isSimMode={isSimMode} />
      </motion.div>
    </div>
  );
}