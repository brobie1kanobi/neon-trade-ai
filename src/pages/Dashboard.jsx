import React, { useState } from "react";
import { motion } from "framer-motion";

import BalanceCard from "../components/dashboard/BalanceCard";
import CryptoMarketOverview from "../components/dashboard/CryptoMarketOverview";
import QuickActions from "../components/dashboard/QuickActions";
import RecentTrades from "../components/dashboard/RecentTrades";
import TradeDetailsModal from "../components/dashboard/TradeDetailsModal";
import PerformanceChart from "../components/dashboard/PerformanceChart";
import { usePortfolioData } from "@/components/hooks/usePortfolioData";
import { DollarSign, Activity } from "lucide-react";

export default function Dashboard() {
  const [selectedTrade, setSelectedTrade] = useState(null);
  
  const {
    user,
    wallet,
    holdings,
    trades,
    isSimMode,
    currentCashBalance,
    currentPortfolioValue,
    totalValue,
    portfolio24hrChange,
    lifetimeChange,
    wsConnected,
    isLoading
  } = usePortfolioData();

  if (isLoading || !user) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
        <div className="h-48 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
        <div className="h-64 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-8" style={{ backgroundColor: "var(--primary-bg)" }}>
      <TradeDetailsModal trade={selectedTrade} isOpen={!!selectedTrade} onClose={() => setSelectedTrade(null)} />

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center py-4">
        <h2 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>
          Welcome back{user?.full_name ? `, ${user.full_name.split(" ")[0]}` : ""}!
        </h2>
        <p style={{ color: "var(--text-secondary)"}}>
          Trading in {isSimMode ? "simulation" : "live"} mode 🚀
          {!isSimMode && wsConnected && <span className="text-green-500"> • Live 🟢</span>}
        </p>
      </motion.div>

      <div className="grid grid-cols-1 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <BalanceCard
            title="Total Balance"
            amount={totalValue}
            change={portfolio24hrChange.percentage}
            isDemo={isSimMode}
            isPrimary={true}
            isConnected={!isSimMode && wsConnected}
          />
        </motion.div>

        <div className="grid grid-cols-2 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <BalanceCard
              title="Cash"
              amount={currentCashBalance}
              change={0}
              icon={DollarSign}
              isDemo={isSimMode}
              isConnected={!isSimMode && wsConnected}
            />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <BalanceCard
              title="Portfolio Value"
              amount={currentPortfolioValue}
              change={lifetimeChange.percentage}
              icon={Activity}
              isDemo={isSimMode}
              isConnected={!isSimMode && wsConnected}
            />
          </motion.div>
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <QuickActions />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
        <CryptoMarketOverview />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
        <PerformanceChart trades={trades} holdings={holdings} wallet={wallet} isSimMode={isSimMode} />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
        <RecentTrades trades={trades} onTradeSelect={(trade) => setSelectedTrade(trade)} />
      </motion.div>
    </div>
  );
}