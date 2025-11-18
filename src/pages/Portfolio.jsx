import React, { useState } from "react";
import { Trade, Holding } from "@/entities/all";
import { motion } from "framer-motion";
import { base44 } from "@/api/base44Client";

import PortfolioSummary from "../components/portfolio/PortfolioSummary";
import AssetAllocation from "../components/portfolio/AssetAllocation";
import TradingInterface from "../components/portfolio/TradingInterface";
import TradeHistory from "../components/portfolio/TradeHistory";
import DataSync from "../components/portfolio/DataSync";
import OpenAndConditionalOrders from "../components/portfolio/OpenAndConditionalOrders";
import AutoBuyPreferences from "../components/portfolio/AutoBuyPreferences";
import EmergencyRepair from "../components/wallet/EmergencyRepair";
import { usePortfolioData, invalidatePortfolioCache } from "@/components/hooks/usePortfolioData";

export default function Portfolio() {
  const [showDataSync, setShowDataSync] = useState(false);

  // CRITICAL: Use centralized portfolio data hook
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
    isLoading,
    error,
    refresh
  } = usePortfolioData();



  const executeTrade = async (tradeData) => {
    const tradeIsSimMode = isSimMode;

    try {
      await Trade.create({
        ...tradeData,
        status: 'executed',
        created_by: user.email,
        is_simulation: tradeIsSimMode
      });

      const freshHoldings = await Holding.filter({ created_by: user.email, is_simulation: tradeIsSimMode });
      const existingHolding = freshHoldings.find(h => h.symbol === tradeData.symbol);

      if (tradeData.type === 'buy') {
        if (existingHolding) {
          const newQuantity = existingHolding.quantity + tradeData.quantity;
          const oldTotalCost = existingHolding.average_cost_price * existingHolding.quantity;
          const newTotalCost = oldTotalCost + tradeData.total_value;
          const newAverageCost = newTotalCost / newQuantity;

          await Holding.update(existingHolding.id, {
            quantity: newQuantity,
            average_cost_price: newAverageCost
          });
        } else {
          await Holding.create({
            symbol: tradeData.symbol,
            asset_type: tradeData.asset_type,
            quantity: tradeData.quantity,
            average_cost_price: tradeData.price,
            created_by: user.email,
            is_simulation: tradeIsSimMode
          });
        }
      } else {
        if (existingHolding) {
          const newQuantity = existingHolding.quantity - tradeData.quantity;

          if (newQuantity <= 0.00001) {
            await Holding.delete(existingHolding.id);
          } else {
            await Holding.update(existingHolding.id, { quantity: newQuantity });
          }
        } else {
          throw new Error(`Cannot sell ${tradeData.symbol} - not found in holdings`);
        }
      }

      invalidatePortfolioCache();
      refresh();
      
      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { type: 'trade', source: 'portfolio' } }));
    } catch (err) {
      console.error("Error executing trade:", err);
      refresh();
      window.dispatchEvent(new CustomEvent('app:data-updated', { detail: { type: 'trade_error', source: 'portfolio' } }));
    }
  };

  const handleSyncComplete = () => {
    setShowDataSync(false);
    invalidatePortfolioCache();
    refresh();
  };

  if (isLoading && !wallet && !user) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-48 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
        <div className="h-64 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
        <div className="h-96 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-8" style={{ backgroundColor: 'var(--primary-bg)' }}>
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4"
          role="alert"
        >
          <strong className="font-bold">Error!</strong>
          <span className="block sm:inline"> {error}</span>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <EmergencyRepair 
          wallet={wallet} 
          isSimMode={isSimMode}
          onRepairComplete={() => {
            invalidatePortfolioCache();
            setTimeout(() => refresh(), 500);
          }}
        />
      </motion.div>

      {showDataSync && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <DataSync onSyncComplete={handleSyncComplete} />
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <PortfolioSummary
          wallet={wallet}
          trades={trades}
          currentPortfolioValue={currentPortfolioValue}
          isLoading={isLoading}
          isSimMode={isSimMode}
          change24hr={portfolio24hrChange}
          lifetimeChange={lifetimeChange}
          onSyncClick={() => {
            if (!isSimMode) {
              refresh();
            } else {
              setShowDataSync(true);
            }
          }}
        />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <AssetAllocation
          allocations={holdings}
          isLoading={isLoading}
        />
      </motion.div>
      
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <OpenAndConditionalOrders />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <TradingInterface
          wallet={wallet}
          onTrade={executeTrade}
          autoTradingEnabled={false}
          holdings={holdings}
          isSimMode={isSimMode}
          currentCashBalance={currentCashBalance}
        />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
        <AutoBuyPreferences />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <TradeHistory trades={trades} />
      </motion.div>
    </div>
  );
}