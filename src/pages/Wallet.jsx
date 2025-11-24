import React, { useState, useEffect, useCallback } from "react";
import { Transaction, User } from "@/entities/all";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

import WalletBalance from "../components/wallet/WalletBalance";
import BankConnection from "../components/wallet/BankConnection";
import TransactionForm from "../components/wallet/TransactionForm";
import TransactionHistory from "../components/wallet/TransactionHistory";
import EmergencyRepair from "../components/wallet/EmergencyRepair";
import { usePortfolioData, invalidatePortfolioCache } from "@/components/hooks/usePortfolioData";

export default function WalletPage() {
  const [transactions, setTransactions] = useState([]);
  const [activeAction, setActiveAction] = useState(null);
  const [lastLoadTime, setLastLoadTime] = useState(0);

  const {
    user,
    wallet,
    settings,
    isSimMode,
    currentPortfolioValue,
    wsConnected,
    isLoading,
    refresh
  } = usePortfolioData();

  const loadTransactions = useCallback(async () => {
    if (!user) return;

    const now = Date.now();
    if (lastLoadTime && (now - lastLoadTime) < 30000) {
      return;
    }

    try {
      const userTransactions = await Transaction.filter({ created_by: user.email }, '-created_date');
      setTransactions(userTransactions);

      const urlParams = new URLSearchParams(window.location.search);
      const paymentStatus = urlParams.get('payment');
      
      if (paymentStatus === 'success') {
        toast.success("Payment successful! Your funds have been added to your account.");
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(() => {
          invalidatePortfolioCache();
          refresh();
        }, 1000);
      } else if (paymentStatus === 'cancelled') {
        toast.info("Payment was cancelled.");
        window.history.replaceState({}, '', window.location.pathname);
      }

      setLastLoadTime(Date.now());
      
    } catch (error) {
      console.error("Loading transactions error:", error);
    }
  }, [user, lastLoadTime, refresh]);

  useEffect(() => {
    loadTransactions();
    
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    if (action) {
      setActiveAction(action);
    }
  }, [loadTransactions]);

  // Listen for data sync events
  useEffect(() => {
    const handleSync = () => {
      console.log('[Wallet] Sync event detected, refreshing...');
      invalidatePortfolioCache();
      refresh();
      setTimeout(() => loadTransactions(), 500);
    };

    window.addEventListener('kraken:synced', handleSync);
    window.addEventListener('trade:completed', handleSync);
    window.addEventListener('app:data-updated', handleSync);
    
    return () => {
      window.removeEventListener('kraken:synced', handleSync);
      window.removeEventListener('trade:completed', handleSync);
      window.removeEventListener('app:data-updated', handleSync);
    };
  }, [refresh, loadTransactions]);

  const executeTransaction = async (transactionData) => {
    if (!user || !wallet) return;

    try {
      await Transaction.create({
        ...transactionData,
        is_real_money: !isSimMode
      });
      
      let updateData = {};
      let prevBalance, prevDeposits, prevWithdrawals;
      let balanceKey, depositsKey, withdrawalsKey;

      if (isSimMode) {
        prevBalance = wallet.cash_balance || 0;
        prevDeposits = wallet.total_deposits || 0;
        prevWithdrawals = wallet.total_withdrawals || 0;
        balanceKey = 'cash_balance';
        depositsKey = 'total_deposits';
        withdrawalsKey = 'total_withdrawals';
      } else {
        prevBalance = wallet.real_cash_balance || 0;
        prevDeposits = wallet.real_total_deposits || 0;
        prevWithdrawals = wallet.real_total_withdrawals || 0;
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
        await base44.entities.Wallet.update(wallet.id, updateData);
      }
      
      invalidatePortfolioCache();
      refresh();
      await loadTransactions();
      setActiveAction(null);

      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { type: 'transaction', source: 'wallet' } }));

      const notificationsEnabled = settings?.notifications_enabled === true;
      const appInBackground = document.visibilityState === 'hidden';

      if (notificationsEnabled && appInBackground) {
        const title = transactionData.type === 'deposit' ? 'Deposit Completed' : 'Withdrawal Completed';
        const modeLabel = isSimMode ? 'Simulation' : 'Live';
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
              isSimMode: isSimMode 
            } 
          }
        }).catch(() => {});
      }

    } catch (error) {
      console.error("Error executing transaction:", error);
      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { type: 'transaction_error', source: 'wallet' } }));
    }
  };

  if (isLoading && !wallet && !user) {
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
            invalidatePortfolioCache();
            setTimeout(() => refresh(), 500);
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
          portfolioMarketValue={currentPortfolioValue}
          wsConnected={wsConnected}
          onSyncComplete={() => {
            console.log('[Wallet] Sync complete, reloading data...');
            invalidatePortfolioCache();
            setTimeout(() => refresh(), 500);
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
          onConnectionChange={() => {
            invalidatePortfolioCache();
            refresh();
          }}
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