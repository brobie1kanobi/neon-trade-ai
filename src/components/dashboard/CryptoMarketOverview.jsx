import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { createPageUrl } from "@/utils";
import { useSettings } from "@/components/utils/SettingsContext";
import { base44 } from "@/api/base44Client";
import StockLogo from "../common/StockLogo";
import { Loader2 } from "lucide-react";

// GLOBAL DEDUPLICATION: Only ONE request at a time across ALL component instances
if (typeof window !== 'undefined') {
  window.__marketDataCache = window.__marketDataCache || {
    data: null,
    timestamp: 0,
    inFlight: null
  };
}

const formatPrice = (price) => {
  if (price === undefined || price === null) return "—";
  return `$${Number(price).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatChange = (value, pct) => {
  if (value == null && pct == null) return null;
  const v = typeof value === "number" ? value : null;
  const p = typeof pct === "number" ? pct : null;
  const sign = (v ?? p ?? 0) >= 0 ? "+" : "";
  return `${sign}${v != null ? v.toFixed(2) : "0.00"}${
    p != null ? ` (${p >= 0 ? "+" : ""}${p.toFixed(2)}%)` : ""
  }`;
};

export default function CryptoMarketOverview() {
  const [activeTab, setActiveTab] = useState("crypto");
  const [subTabCrypto, setSubTabCrypto] = useState("watchlist");
  const [subTabStocks, setSubTabStocks] = useState("watchlist");
  const [cryptoAssets, setCryptoAssets] = useState([]);
  const [stockAssets, setStockAssets] = useState([]);
  const [cryptoGainers, setCryptoGainers] = useState([]);
  const [cryptoLosers, setCryptoLosers] = useState([]);
  const [stockGainers, setStockGainers] = useState([]);
  const [stockLosers, setStockLosers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const { settings } = useSettings?.() || {};

  // SINGLE UNIFIED DATA FETCH - NO DUPLICATES
  const fetchWatchlistData = async (force = false) => {
    if (!settings) return;

    const cache = window.__marketDataCache;
    const now = Date.now();
    
    // CRITICAL: Extend cache to 60 seconds (was 15s) to reduce API calls
    if (!force && cache.data && (now - cache.timestamp) < 60000) {
      setCryptoAssets(cache.data.crypto || []);
      setStockAssets(cache.data.stocks || []);
      setIsLoading(false);
      return;
    }

    if (cache.inFlight) {
      console.log('[CryptoMarketOverview] Request already in flight, waiting...');
      try {
        const result = await cache.inFlight;
        setCryptoAssets(result.crypto || []);
        setStockAssets(result.stocks || []);
        setIsLoading(false);
        return;
      } catch (e) {
        console.error('[CryptoMarketOverview] In-flight request failed:', e);
        // Use cached data if available
        if (cache.data) {
          setCryptoAssets(cache.data.crypto || []);
          setStockAssets(cache.data.stocks || []);
          setIsLoading(false);
          return;
        }
      }
    }

    // CRITICAL FIX: Deduplicate symbols AGGRESSIVELY
    const rawCryptoSymbols = settings?.watched_crypto?.length ? settings.watched_crypto : ["BTC", "ETH", "SOL"];
    const rawStockSymbols = settings?.watched_stocks?.length ? settings.watched_stocks : ["AAPL", "TSLA", "NVDA"];
    
    // Remove duplicates using Set, then take first 3 ONLY
    const cryptoSymbols = [...new Set(rawCryptoSymbols.map(s => String(s).toUpperCase().trim()))].slice(0, 3);
    const stockSymbols = [...new Set(rawStockSymbols.map(s => String(s).toUpperCase().trim()))].slice(0, 3);

    console.log('[CryptoMarketOverview] Deduplicated symbols:', { cryptoSymbols, stockSymbols });

    // Build payload - ONLY include non-empty arrays
    const payload = {};
    if (cryptoSymbols.length > 0) {
      payload.cryptoSymbols = cryptoSymbols;
    }
    if (stockSymbols.length > 0) {
      payload.stockSymbols = stockSymbols;
    }

    if (Object.keys(payload).length === 0) {
      setIsLoading(false);
      return;
    }

    // Create promise with TIMEOUT to prevent hanging
    cache.inFlight = (async () => {
      try {
        // Add 12 second timeout to prevent hanging forever (increased from 10s)
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 12000)
        );

        const requestPromise = base44.functions.invoke('getMarketData', {
          action: 'getWatchlistData',
          payload
        });

        const res = await Promise.race([requestPromise, timeoutPromise]);

        const data = Array.isArray(res?.data) ? res.data : [];
        
        const result = {
          crypto: (cryptoSymbols || []).map((sym) => {
            const d = data.find(x => (x.symbol || "").toUpperCase() === String(sym).toUpperCase()) || {};
            return {
              symbol: sym,
              price: d.price || null,
              change1hPct: d.change_1h_percent || d.change || null,
              change1hVal: d.change_1h_value || null,
              icon_url: d.icon_url || d.image || null,
              name: d.name || String(sym).toUpperCase(),
            };
          }),
          stocks: (stockSymbols || []).map((sym) => {
            const d = data.find(x => (x.symbol || "").toUpperCase() === String(sym).toUpperCase()) || {};
            return {
              symbol: sym,
              price: d.price || null,
              change24hPct: d.change || null,
              change24hVal: d.change_value || null,
              icon_url: null,
              name: d.name || String(sym).toUpperCase(),
              domain: null,
            };
          })
        };

        // Update cache
        cache.data = result;
        cache.timestamp = Date.now();
        cache.inFlight = null;

        return result;
      } catch (error) {
        console.error('[CryptoMarketOverview] Watchlist fetch error:', error);
        cache.inFlight = null;
        
        // Return cached data on error instead of throwing
        if (cache.data) {
          return cache.data;
        }
        
        // Return empty data structure on error
        return { crypto: [], stocks: [] };
      }
    })();

    try {
      const result = await cache.inFlight;
      setCryptoAssets(result.crypto || []);
      setStockAssets(result.stocks || []);
    } catch (error) {
      console.error('[CryptoMarketOverview] Request failed:', error);
      
      // Always use cached data if available
      if (cache.data) {
        setCryptoAssets(cache.data.crypto || []);
        setStockAssets(cache.data.stocks || []);
      } else {
        // Fallback to empty arrays
        setCryptoAssets([]);
        setStockAssets([]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load - with delay to prevent race conditions
  useEffect(() => {
    if (!settings) return;
    
    // Small delay to allow other data to load first
    const timer = setTimeout(() => {
      fetchWatchlistData();
    }, 1000);

    return () => clearTimeout(timer);
  }, [settings]);

  // Periodic refresh (2 minutes instead of 30s to reduce API calls)
  useEffect(() => {
    if (!settings) return;
    
    const interval = setInterval(() => {
      fetchWatchlistData(false);
    }, 120000); // Changed from 30s to 2 minutes

    return () => clearInterval(interval);
  }, [settings]);

  // Load movers when tabs change - WITH TIMEOUT PROTECTION
  useEffect(() => {
    const loadCryptoMovers = async () => {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 8000)
        );
        
        const res = await Promise.race([
          base44.functions.invoke('getMarketData', {
            action: 'getTopMovers',
            payload: { type: 'crypto' }
          }),
          timeoutPromise
        ]);
        
        setCryptoGainers((res?.data?.gainers || []).slice(0, 5));
        setCryptoLosers((res?.data?.losers || []).slice(0, 5));
      } catch (e) {
        console.error('[CryptoMarketOverview] Crypto movers error:', e);
        // Silently fail - not critical
      }
    };

    const loadStockMovers = async () => {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 8000)
        );
        
        const res = await Promise.race([
          base44.functions.invoke("getMarketData", { 
            action: 'getTopStockMovers', 
            payload: { type: 'stocks' } 
          }),
          timeoutPromise
        ]);
        
        setStockGainers((res?.data?.gainers || []).slice(0, 5));
        setStockLosers((res?.data?.losers || []).slice(0, 5));
      } catch (e) {
        console.error('[CryptoMarketOverview] Stock movers error:', e);
        // Silently fail - not critical
      }
    };

    if (activeTab === "crypto" && (subTabCrypto === "gainers" || subTabCrypto === "losers")) {
      loadCryptoMovers();
    }
    if (activeTab === "stocks" && (subTabStocks === "gainers" || subTabStocks === "losers")) {
      loadStockMovers();
    }
  }, [activeTab, subTabCrypto, subTabStocks]);

  // Send first symbol to chart
  useEffect(() => {
    const topCrypto = cryptoAssets?.[0]?.symbol;
    const topStock = stockAssets?.[0]?.symbol;
    const symbol = activeTab === "crypto" ? topCrypto : topStock;
    const assetType = activeTab;
    if (symbol) {
      window.dispatchEvent(
        new CustomEvent("dashboard:chart-symbol", { detail: { assetType, symbol } })
      );
    }
  }, [activeTab, cryptoAssets, stockAssets]);

  return (
    <div className="w-full">
      <div className="mb-3 flex justify-end">
        <Button variant="outline" asChild>
          <a href={createPageUrl("WatchlistSettings")}>Watchlist Settings</a>
        </Button>
      </div>

      <Tabs defaultValue="crypto" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="crypto">Crypto</TabsTrigger>
          <TabsTrigger value="stocks">Stocks</TabsTrigger>
        </TabsList>

        <TabsContent value="crypto">
          <Card>
            <CardHeader>
              <CardTitle>Crypto</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={subTabCrypto} onValueChange={setSubTabCrypto} className="w-full">
                <TabsList>
                  <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
                  <TabsTrigger value="gainers">Top Gainers</TabsTrigger>
                  <TabsTrigger value="losers">Top Losers</TabsTrigger>
                </TabsList>
                <TabsContent value="watchlist">
                  {isLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin neon-text" />
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {cryptoAssets.map((c, i) => (
                        <li key={`${c.symbol}-${i}`} className="flex items-center justify-between">
                          <a
                            className="flex items-center gap-2 font-medium hover:underline"
                            href={createPageUrl(`CryptoDetails?symbol=${c.symbol}&assetType=crypto`)}
                          >
                            {c.icon_url ? (
                              <img src={c.icon_url} alt={c.symbol} className="w-5 h-5 rounded" />
                            ) : (
                              <div className="w-5 h-5 rounded bg-gray-200" />
                            )}
                            <span>{c.name}</span>
                          </a>
                          <span className="text-right">
                            <div className="font-medium">{formatPrice(c.price)}</div>
                            {(typeof c.change1hVal === "number" || typeof c.change1hPct === "number") ? (
                              <div
                                className={`text-xs ${
                                  (c.change1hVal ?? c.change1hPct ?? 0) >= 0 ? "text-green-600" : "text-red-600"
                                }`}
                              >
                                {formatChange(c.change1hVal, c.change1hPct)}
                              </div>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
                <TabsContent value="gainers">
                  {cryptoGainers.length > 0 ? (
                    <ul className="space-y-2">
                      {cryptoGainers.map((c, i) => (
                        <li key={i} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {c.icon_url ? (
                              <img src={c.icon_url} alt={c.symbol} className="w-5 h-5 rounded" />
                            ) : (
                              <div className="w-5 h-5 rounded bg-gray-200" />
                            )}
                            <span className="font-medium">{c.name || c.symbol}</span>
                          </div>
                          <span className="text-right">
                            <div className="font-medium">{formatPrice(c.price)}</div>
                            {(typeof c.change1hVal === "number" || typeof c.change1hPct === "number") ? (
                              <div className="text-xs text-green-600">
                                {formatChange(c.change1hVal, c.change1hPct)}
                              </div>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">No gainers available</p>
                  )}
                </TabsContent>
                <TabsContent value="losers">
                  {cryptoLosers.length > 0 ? (
                    <ul className="space-y-2">
                      {cryptoLosers.map((c, i) => (
                        <li key={i} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {c.icon_url ? (
                              <img src={c.icon_url} alt={c.symbol} className="w-5 h-5 rounded" />
                            ) : (
                              <div className="w-5 h-5 rounded bg-gray-200" />
                            )}
                            <span className="font-medium">{c.name || c.symbol}</span>
                          </div>
                          <span className="text-right">
                            <div className="font-medium">{formatPrice(c.price)}</div>
                            {(typeof c.change1hVal === "number" || typeof c.change1hPct === "number") ? (
                              <div className="text-xs text-red-600">
                                {formatChange(c.change1hVal, c.change1hPct)}
                              </div>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">No losers available</p>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stocks">
          <Card>
            <CardHeader>
              <CardTitle>Stocks</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={subTabStocks} onValueChange={setSubTabStocks} className="w-full">
                <TabsList>
                  <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
                  <TabsTrigger value="gainers">Top Gainers</TabsTrigger>
                  <TabsTrigger value="losers">Top Losers</TabsTrigger>
                </TabsList>
                <TabsContent value="watchlist">
                  {isLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin neon-text" />
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {stockAssets.map((s, i) => (
                        <li key={`${s.symbol}-${i}`} className="flex items-center justify-between">
                          <a
                            className="flex items-center gap-2 font-medium hover:underline"
                            href={createPageUrl(`StockDetails?symbol=${s.symbol}&assetType=stocks`)}
                          >
                            <StockLogo
                              symbol={s.symbol}
                              name={s.name}
                              domain={s.domain}
                              srcs={[s.icon_url]}
                              size={20}
                            />
                            <span>{s.name}</span>
                          </a>
                          <span className="text-right">
                            <div className="font-medium">{formatPrice(s.price)}</div>
                            {(typeof s.change24hVal === "number" || typeof s.change24hPct === "number") ? (
                              <div
                                className={`text-xs ${
                                  (s.change24hPct ?? 0) >= 0 ? "text-green-600" : "text-red-600"
                                }`}
                              >
                                {formatChange(s.change24hVal, s.change24hPct)}
                              </div>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
                <TabsContent value="gainers">
                  {stockGainers.length > 0 ? (
                    <ul className="space-y-2">
                      {stockGainers.map((s, i) => (
                        <li key={i} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <StockLogo
                              symbol={s.symbol}
                              name={s.name || s.symbol}
                              domain={s.domain}
                              srcs={[s.icon_url]}
                              size={20}
                            />
                            <span className="font-medium">{s.name || s.symbol}</span>
                          </div>
                          <span className="text-right">
                            <div className="font-medium">{formatPrice(s.price)}</div>
                            {(typeof s.change24hVal === "number" || typeof s.change24hPct === "number") ? (
                              <div className="text-xs text-green-600">
                                {formatChange(s.change24hVal, s.change24hPct)}
                              </div>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">No gainers available</p>
                  )}
                </TabsContent>
                <TabsContent value="losers">
                  {stockLosers.length > 0 ? (
                    <ul className="space-y-2">
                      {stockLosers.map((s, i) => (
                        <li key={i} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <StockLogo
                              symbol={s.symbol}
                              name={s.name || s.symbol}
                              domain={s.domain}
                              srcs={[s.icon_url]}
                              size={20}
                            />
                            <span className="font-medium">{s.name || s.symbol}</span>
                          </div>
                          <span className="text-right">
                            <div className="font-medium">{formatPrice(s.price)}</div>
                            {(typeof s.change24hVal === "number" || typeof s.change24hPct === "number") ? (
                              <div className="text-xs text-red-600">
                                {formatChange(s.change24hVal, s.change24hPct)}
                              </div>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">No losers available</p>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}