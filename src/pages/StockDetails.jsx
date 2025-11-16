
import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { createPageUrl } from "@/utils";
import { User, Holding } from "@/entities/all"; // Added Holding import
import { getMarketData } from "@/functions/getMarketData";
import AssetHeader from "../components/details/AssetHeader";
import AssetInfoTabs from "../components/details/AssetInfoTabs";
import AssetPriceChart from "../components/details/AssetPriceChart";
import TradeHistory from "../components/portfolio/TradeHistory";
import { Trade } from "@/entities/all";
import { useSettings } from "@/components/utils/SettingsContext";

export default function StockDetails() {
  const location = useLocation();
  const { settings } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  const [assetData, setAssetData] = useState(null);
  const [holding, setHolding] = useState(null); // New state for holding
  const [isLoading, setIsLoading] = useState(true);
  const [dynamicPriceChange, setDynamicPriceChange] = useState(null);
  const [trades, setTrades] = useState([]);
  const [tradesLoading, setTradesLoading] = useState(true);

  const symbol = new URLSearchParams(location.search).get("symbol");

  useEffect(() => {
    const load = async () => {
      if (!symbol) {
        setIsLoading(false);
        return;
      }
      try {
        const user = await User.me(); // Fetch user first
        const [{ data: details }, holdings] = await Promise.all([
          getMarketData({ action: "getAssetDetails", payload: { symbol, assetType: "stocks" } }),
          Holding.filter({
            created_by: user.email,
            symbol: symbol.toUpperCase(),
            is_simulation: isSimMode
          })
        ]);
        
        if (!details) throw new Error("No details");
        
        setAssetData({
          name: details.name || symbol,
          symbol: details.symbol || symbol.toUpperCase(),
          price: details.price || 0,
          description: details.description,
          website: details.website,
          exchange: details.exchange,
          sector: details.sector,
          industry: details.industry
        });
        
        setHolding(holdings && holdings.length > 0 ? holdings[0] : null); // Set holding state
      } catch (e) {
        setAssetData({ name: symbol, symbol: symbol.toUpperCase(), price: 0 });
        setHolding(null); // Set holding to null on error
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [symbol, isSimMode]); // Added isSimMode to dependencies

  useEffect(() => {
    let active = true;
    const loadTrades = async () => {
      try {
        setTradesLoading(true);
        const me = await User.me();
        const list = await Trade.filter({ 
          created_by: me.email, 
          symbol: (symbol || "").toUpperCase(),
          is_simulation: isSimMode
        }, "-created_date", 500);
        if (active) setTrades(list);
      } finally {
        if (active) setTradesLoading(false);
      }
    };
    if (symbol) loadTrades();
    return () => { active = false; };
  }, [symbol, isSimMode]);

  const handlePriceUpdate = (data) => {
    if (!data) return;
    setAssetData(prev => prev ? { ...prev, price: data.price } : prev);
    setDynamicPriceChange({ change: data.change, label: data.label });
  };

  if (isLoading && !assetData) {
    return (
      <div className="p-4 flex justify-center items-center h-screen">
        <Loader2 className="w-12 h-12 animate-spin neon-text" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-8" style={{ backgroundColor: 'var(--primary-bg)' }}>
      <a href={createPageUrl("Dashboard")} className="flex items-center gap-2 text-sm neon-text mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </a>

      {assetData ? (
        <>
          <AssetHeader asset={assetData} dynamicChange={dynamicPriceChange} isLoading={!dynamicPriceChange} holding={holding} /> {/* Passed holding prop */}
          <div className="mt-6">
            {tradesLoading ? (
              <div className="h-64 rounded-lg border flex items-center justify-center" style={{ borderColor: 'var(--border-color)' }}>
                <Loader2 className="w-6 h-6 animate-spin neon-text" />
              </div>
            ) : (
              <AssetPriceChart symbol={assetData.symbol} onPriceUpdate={handlePriceUpdate} assetType="stocks" trades={trades} holding={holding} /> {/* Passed holding prop */}
            )}
          </div>
          <div className="mt-6">
            <AssetInfoTabs assetData={assetData} holding={null} />
          </div>
          <div className="mt-6">
            <TradeHistory trades={trades} />
          </div>
        </>
      ) : (
        !isLoading && <p className="text-center text-red-500">Asset data could not be loaded.</p>
      )}
    </div>
  );
}
