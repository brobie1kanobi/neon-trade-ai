import React from "react";
import { TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

export default function AssetHeader({ asset, dynamicChange, isLoading }) {
  if (!asset) {
    return null;
  }

  const changeValue = dynamicChange?.change;
  const isPositive = changeValue != null && changeValue >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-lg"
      style={{ backgroundColor: 'var(--secondary-bg)' }}>
      
      <div className="flex items-center justify-between relative">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {asset.name ? `${asset.name} (${asset.symbol})` : `Loading ${asset.symbol}...`}
          </h1>
          <p className="text-3xl font-bold neon-text pt-2">
            {(!asset.price && isLoading) ?
            <Loader2 className="w-8 h-8 animate-spin inline" /> :
            asset.price > 0 ?
            `$${asset.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` :
            '...'
            }
          </p>
        </div>
        <div className="mb-1 bg-red-100 mr-8 ml-6 pt-2 pr-2 pb-2 pl-2 flex items-center gap-2 rounded-lg transition-colors dark:bg-red-900 -mt-2">















          
          {isLoading ?
          <Loader2 className="w-5 h-5 animate-spin" /> :
          isPositive ?
          <TrendingUp className="w-5 h-5 text-green-500" /> :

          <TrendingDown className="w-5 h-5 text-red-500" />
          }
          <span
            className={`text-lg font-semibold transition-colors ${
            isLoading ?
            "text-gray-500" :
            isPositive ?
            "text-green-600" :
            "text-red-600"}`
            }>
            
            {isLoading ? "..." : `${isPositive ? "+" : ""}${changeValue?.toFixed(2) || "0.00"}%`}
          </span>
        </div>
      </div>
    </motion.div>);

}