import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { createPageUrl } from "@/utils";
import { User, Holding, Trade } from "@/entities/all";
import { InvokeLLM } from "@/integrations/Core";
import { useSettings } from "@/components/utils/SettingsContext";
import { base44 } from "@/api/base44Client";

import AssetHeader from "../components/details/AssetHeader";
import AssetInfoTabs from "../components/details/AssetInfoTabs";
import AssetPriceChart from "../components/details/AssetPriceChart";
import { getMarketData } from "@/functions/getMarketData";
import TradeHistory from "../components/portfolio/TradeHistory";

export default function CryptoDetails() {
  const location = useLocation();
  const { settings, user } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false; // Default to sim if undefined
  
  const [assetData, setAssetData] = useState(null);
  const [holding, setHolding] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dynamicPriceChange, setDynamicPriceChange] = useState(null);
  const [trades, setTrades] = useState([]);
  const [tradesLoading, setTradesLoading] = useState(true);

  const symbol = new URLSearchParams(location.search).get("symbol");
  const assetType = (new URLSearchParams(location.search).get("assetType") || "crypto").toLowerCase();

  const enrichAssetInfo = async (symbolArg, assetTypeArg) => {
    const schema = {
      type: "object",
      properties: {
        full_name: { type: "string" },
        description: { type: "string" },
        website: { type: "string" },
        yahoo_symbol: { type: "string" },
        exchange: { type: "string" },
        sector: { type: "string" },
        industry: { type: "string" }
      }
    };

    const checksPass = (d) => {
      if (!d) return false;
      const hasDesc = d.description && d.description.trim().length >= 40;
      const hasName = d.full_name && d.full_name.trim().length >= 2;
      return hasDesc || hasName;
    };

    // 1) Google-first attempt
    try {
      const g = await InvokeLLM({
        prompt: `Using Google.com results first, identify the official profile and key details for this ${assetTypeArg}:
symbol: ${symbolArg}
Return a concise JSON with: full_name, description (2-5 sentences), website (official), yahoo_symbol (if differs), exchange, sector and industry (for stocks).
If info is not found on Google results, leave fields blank (do NOT fabricate), we'll try other sources.`,
        add_context_from_internet: true,
        response_json_schema: schema
      });
      if (checksPass(g)) return g;
    } catch (e) {
      console.warn("Google enrichment failed:", e.message);
    }

    // 2) Yahoo Finance-focused attempt
    try {
      const y = await InvokeLLM({
        prompt: `From Yahoo Finance ONLY, fetch profile for ${assetTypeArg} ${symbolArg}.
Return JSON with: full_name, description (2-5 sentences), website (official), yahoo_symbol, exchange, sector, industry.`,
        add_context_from_internet: true,
        response_json_schema: schema
      });
      if (checksPass(y)) return y;
    } catch (e) {
      console.warn("Yahoo Finance enrichment failed:", e.message);
    }

    // 3) General web search fallback
    try {
      const w = await InvokeLLM({
        prompt: `Using general web search, identify the official profile and a short description for ${assetTypeArg} ${symbolArg}.
Prefer official site, Wikipedia, or reputable sources. Return: full_name, description (2-5 sentences), website, yahoo_symbol, exchange, sector, industry.`,
        add_context_from_internet: true,
        response_json_schema: schema
      });
      if (checksPass(w)) return w;
    } catch (e) {
      console.warn("General web enrichment failed:", e.message);
    }

    return null;
  };

  useEffect(() => {
    // If no symbol is provided, display an error and stop loading.
    if (!symbol) {
      setError("No asset symbol provided.");
      setIsLoading(false);
      setAssetData(null);
      setHolding(null);
      setDynamicPriceChange(null);
      return;
    }

    // Reset state and set loading to true when symbol or assetType changes
    setAssetData(null);
    setHolding(null);
    setDynamicPriceChange(null);
    setIsLoading(true);
    setError(null);

    const fetchAssetData = async () => {
      try {
        const currentUser = user || await User.me();
        
        // Fetch asset details (market data)
        const marketDataPromise = getMarketData({
          action: 'getAssetDetails',
          payload: { symbol: symbol, assetType: assetType }
        });
        
        let holdingData = null;
        
        // Fetch holdings based on mode
        if (isSimMode) {
          // Sim mode: Fetch from DB
          const userHoldings = await Holding.filter({ 
            created_by: currentUser.email, 
            symbol: symbol.toUpperCase(),
            is_simulation: true
          });
          holdingData = userHoldings.length > 0 ? userHoldings[0] : null;
        } else {
          // Live mode: Try Kraken API first, fallback to DB
          try {
            const krakenRes = await base44.functions.invoke('getKrakenBalance', {});
            const kData = krakenRes?.data || krakenRes;
            
            if (kData?.success && kData?.holdings) {
              const found = kData.holdings.find(h => (h.symbol || "").toUpperCase() === symbol.toUpperCase());
              if (found) {
                holdingData = {
                  ...found,
                  is_simulation: false,
                  asset_type: assetType // Ensure asset type is set
                };
              }
            }
          } catch (kErr) {
            console.warn("Kraken balance fetch failed in CryptoDetails:", kErr);
          }
          
          // Fallback to DB if not found in Kraken (or Kraken failed)
          if (!holdingData) {
            const userHoldings = await Holding.filter({ 
              created_by: currentUser.email, 
              symbol: symbol.toUpperCase(),
              is_simulation: false
            });
            holdingData = userHoldings.length > 0 ? userHoldings[0] : null;
          }
        }
        
        // Wait for market data
        let { data: details } = await marketDataPromise;

        setHolding(holdingData);

        if (!details) {
          try {
            const cached = await base44.entities.AssetCache.filter({ symbol: symbol.toUpperCase(), asset_type: assetType });
            if (cached && cached.length > 0) {
              details = {
                name: cached[0].name,
                symbol: cached[0].symbol,
                description: cached[0].description || '',
                website: cached[0].website || '',
                icon_url: cached[0].icon_url || ''
              };
            }
          } catch (_) {}
        }
        if (!details) {
          // Graceful minimal fallback to avoid breaking the page
          details = { name: symbol.toUpperCase(), symbol: symbol.toUpperCase() };
        }

        // Base assetData
        const baseData = {
          name: details.name,
          symbol: details.symbol,
          price: 0,
          change: 0
        };

        // Enrich with Google → Yahoo → Web search
        const enriched = await enrichAssetInfo(details.symbol || symbol.toUpperCase(), assetType);
        const merged = enriched ? {
          ...baseData,
          name: enriched.full_name || baseData.name,
          description: enriched.description || undefined,
          website: enriched.website || undefined,
          exchange: enriched.exchange || undefined,
          sector: enriched.sector || undefined,
          industry: enriched.industry || undefined,
          yahoo_symbol: enriched.yahoo_symbol || undefined
        } : baseData;

        setAssetData(merged);

      } catch (e) {
        console.error("Error fetching asset details:", e);
        if (e.message.includes('429') || (e.response && e.response.status === 429) || e.message.includes('Rate limit')) {
          setError("Rate limit reached. Please wait a moment and try again.");
        } else {
          setError("Could not load data for this asset.");
        }
        setAssetData(null);
        setHolding(null);
        setDynamicPriceChange(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAssetData();
  }, [symbol, assetType, isSimMode, user]);

  // Load full trade history for this asset (fast, before chart)
  useEffect(() => {
    let active = true;
    const loadTrades = async () => {
      try {
        setTradesLoading(true);
        const currentUser = user || await User.me();
        const list = await Trade.filter(
          { 
            created_by: currentUser.email, 
            symbol: (symbol || "").toUpperCase(),
            is_simulation: isSimMode 
          },
          "-created_date",
          500
        );
        if (active) setTrades(list);
      } catch (e) {
        // Keep page functional even if trades fail to load
        // console.error("Failed to load trades:", e); // Removed console.error as per instruction
        if (active) setTrades([]);
      } finally {
        if (active) setTradesLoading(false);
      }
    };
    if (symbol) loadTrades();
    return () => { active = false; };
  }, [symbol, isSimMode, user]);

  const handlePriceUpdate = (priceData) => {
      setAssetData(prev => ({...prev, price: priceData.price}));
      setDynamicPriceChange({ change: priceData.change, label: priceData.label });
  };

  if (isLoading && !assetData) {
    return (
      <div className="p-4 flex justify-center items-center h-screen">
        <Loader2 className="w-12 h-12 animate-spin neon-text" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-500 mb-4">{error}</p>
        <a href={createPageUrl("Dashboard")} className="text-sm neon-text">
          &larr; Back to Dashboard
        </a>
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
          <AssetHeader asset={assetData} dynamicChange={dynamicPriceChange} isLoading={!dynamicPriceChange} />
          <div className="mt-6">
            {tradesLoading ? (
              <div className="h-64 rounded-lg border flex items-center justify-center" style={{ borderColor: 'var(--border-color)' }}>
                <Loader2 className="w-6 h-6 animate-spin neon-text" />
              </div>
            ) : (
              <AssetPriceChart symbol={assetData.symbol} onPriceUpdate={handlePriceUpdate} assetType={assetType} trades={trades} />
            )}
          </div>
          <div className="mt-6">
            <AssetInfoTabs assetData={assetData} holding={holding} />
          </div>
          {/* Full transaction history for this asset */}
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