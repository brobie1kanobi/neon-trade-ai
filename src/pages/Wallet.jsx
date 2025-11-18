import React, { useState, useEffect } from "react";
import { Transaction } from "@/entities/all";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { usePortfolioData, invalidatePortfolioCache } from "@/components/hooks/usePortfolioData";

import WalletBalance from "../components/wallet/WalletBalance";
import BankConnection from "../components/wallet/BankConnection";
import TransactionForm from "../components/wallet/TransactionForm";
import TransactionHistory from "../components/wallet/TransactionHistory";
import EmergencyRepair from "../components/wallet/EmergencyRepair";

export default function WalletPage() {
  const {
    user,
    wallet,
    settings,
    isSimMode,
    currentPortfolioValue,
    isLoading,
    refresh
  } = usePortfolioData();

  const [transactions, setTransactions] = useState([]);
  const [activeAction, setActiveAction] = useState(null);

  useEffect(() => {
    const loadTransactions = async () => {
      if (user) {
        try {
          const txs = await Transaction.filter({ created_by: user.email }, '-created_date');
          setTransactions(txs);
        } catch (e) {
          console.error('Failed to load transactions:', e);
        }
      }
    };
    loadTransactions();

    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    if (action) {
      setActiveAction(action);
    }

    const paymentStatus = urlParams.get('payment');
    if (paymentStatus === 'success') {
      toast.success("Payment successful! Your funds have been added to your account.");
      window.history.replaceState({}, '', window.location.pathname);
    } else if (paymentStatus === 'cancelled') {
      toast.info("Payment was cancelled.");
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [user]);

  useEffect(() => {
    const handleSync = () => {
      refresh();
    };
    window.addEventListener('kraken:synced', handleSync);
    window.addEventListener('trade:completed', handleSync);
    return () => {
      window.removeEventListener('kraken:synced', handleSync);
      window.removeEventListener('trade:completed', handleSync);
    };
  }, [refresh]);

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
      
      invalidatePortfolioCache();
      refresh();
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
          portfolioMarketValue={currentPortfolioValue}
          onSyncComplete={() => {
            invalidatePortfolioCache();
            refresh();
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
          onConnectionChange={refresh}
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