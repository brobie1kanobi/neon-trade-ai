import { useState, useEffect, useCallback } from "react";
import { UserSettings } from "@/entities/UserSettings";
import { User } from "@/entities/User";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Bitcoin, TrendingUp, Loader2, Save, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
// Removed import for getMarketData from functions folder as it's directly called via base44.functions.invoke

export default function WatchlistSettings() {
  const [activeTab, setActiveTab] = useState("crypto");
  const [suggestedCrypto, setSuggestedCrypto] = useState([]);
  const [suggestedStocks, setSuggestedStocks] = useState([]);
  const [searchedCrypto, setSearchedCrypto] = useState([]);
  const [searchedStocks, setSearchedStocks] = useState([]);
  const [selectedCrypto, setSelectedCrypto] = useState([]);
  const [selectedStocks, setSelectedStocks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [settings, setSettings] = useState(null);
  const [cryptoSearchTerm, setCryptoSearchTerm] = useState("");
  const [stockSearchTerm, setStockSearchTerm] = useState("");

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const searchParam = urlParams.get('search');
    if (searchParam) {
      setCryptoSearchTerm(searchParam);
      setStockSearchTerm(searchParam);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
        const userSettingsRes = await UserSettings.list();
        if (userSettingsRes.length > 0) {
            const currentSettings = userSettingsRes[0];
            setSettings(currentSettings);
            setSelectedCrypto(currentSettings.watched_crypto || []);
            setSelectedStocks(currentSettings.watched_stocks || []);
        }

        // Fetch crypto movers
        const moversResponse = await base44.functions.invoke('getMarketData', { action: 'getTopMovers', payload: {} });
        const cryptoSuggestions = [...(moversResponse.data.gainers || []), ...(moversResponse.data.losers || [])];
        setSuggestedCrypto(cryptoSuggestions.slice(0, 5));

        // Fetch top stock gainers (using getTopStockMovers to reuse the endpoint)
        const stockResponse = await base44.functions.invoke('getMarketData', { action: 'getTopStockMovers', payload: {} });
        setSuggestedStocks((stockResponse.data.gainers || []).slice(0, 5)); // Use gainers from getTopStockMovers

    } catch (error) {
        console.error("Failed to fetch initial asset suggestions:", error);
        toast.error("Could not load market suggestions.");
        setSuggestedCrypto([
            { symbol: "BTC", name: "Bitcoin", icon_url: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png" },
            { symbol: "ETH", name: "Ethereum", icon_url: "https://assets.coingecko.com/coins/images/279/small/ethereum.png" },
            { symbol: "SOL", name: "Solana", icon_url: "https://assets.coingecko.com/coins/images/4128/small/solana.png" },
        ]);
        setSuggestedStocks([
            { symbol: "AAPL", name: "Apple Inc." },
            { symbol: "MSFT", name: "Microsoft" },
            { symbol: "NVDA", name: "NVIDIA Corp" },
        ]);
    }
    setIsLoading(false);
  }, []);


  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const performLiveSearch = useCallback(async (term, type) => {
    if (!term || term.length < 2) {
      if (type === 'crypto') setSearchedCrypto([]);
      else setSearchedStocks([]);
      return;
    }
    setIsSearching(true);
    try {
        const { data } = await base44.functions.invoke('getMarketData', {
            action: 'searchAssets',
            payload: { term, assetType: type }
        });

        if (data && Array.isArray(data)) {
          if (type === 'crypto') {
            setSearchedCrypto(data);
          } else {
            setSearchedStocks(data);
          }
        } else {
          if (type === 'crypto') setSearchedCrypto([]);
          else setSearchedStocks([]);
        }
    } catch (error) {
        console.error("Live asset search failed:", error);
        if (type === 'crypto') setSearchedCrypto([]);
        else setSearchedStocks([]);
    }
    setIsSearching(false);
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
        if(cryptoSearchTerm) performLiveSearch(cryptoSearchTerm, 'crypto');
        else setSearchedCrypto([]);
    }, 500);
    return () => clearTimeout(handler);
  }, [cryptoSearchTerm, performLiveSearch]);

  useEffect(() => {
    const handler = setTimeout(() => {
        if(stockSearchTerm) performLiveSearch(stockSearchTerm, 'stocks');
        else setSearchedStocks([]);
    }, 500);
    return () => clearTimeout(handler);
  }, [stockSearchTerm, performLiveSearch]);

  const handleSelection = (symbol, type) => {
    const currentSelection = type === 'crypto' ? selectedCrypto : selectedStocks;
    const setter = type === 'crypto' ? setSelectedCrypto : setSelectedStocks;
    const isSelected = currentSelection.includes(symbol);

    if (isSelected) {
      setter(currentSelection.filter(s => s !== symbol));
    } else {
      if (currentSelection.length >= 3) {
        toast.warning("You can only select up to 3 assets per category.");
        return;
      }
      setter([...currentSelection, symbol]);
    }
  };

  const handleClearSelection = () => {
    if (activeTab === 'crypto') {
      setSelectedCrypto([]);
    } else {
      setSelectedStocks([]);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const currentUser = await User.me();
      
      if (settings?.id) {
        await UserSettings.update(settings.id, {
          watched_crypto: selectedCrypto,
          watched_stocks: selectedStocks
        });
      } else {
        await UserSettings.create({
          watched_crypto: selectedCrypto,
          watched_stocks: selectedStocks,
          created_by: currentUser.email
        });
      }
      
      toast.success("Watchlist preferences saved!");
      window.location.href = createPageUrl("Dashboard") + "?refresh=true";
      
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error("Failed to save preferences. Please try again.");
    }
    setIsSaving(false);
  };

  const AssetRow = ({ asset, type }) => {
    const isSelected = type === 'crypto' ? selectedCrypto.includes(asset.symbol) : selectedStocks.includes(asset.symbol);
    const selectionOrder = type === 'crypto' ? 
      selectedCrypto.indexOf(asset.symbol) + 1 : 
      selectedStocks.indexOf(asset.symbol) + 1;
    
    return (
      <div
        className="flex items-center justify-between p-3 rounded-lg transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
        onClick={() => handleSelection(asset.symbol, type)}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            {asset.icon_url ? (
              <img 
                src={asset.icon_url} 
                alt={`${asset.symbol} icon`}
                className="w-8 h-8 object-contain"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
            ) : null}
            <div className={`w-full h-full flex items-center justify-center ${asset.icon_url ? 'hidden' : 'flex'}`}>
              <span className="font-bold text-sm neon-text">{asset.symbol}</span>
            </div>
          </div>
          <div>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{asset.name}</p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Symbol: {asset.symbol}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSelected && selectionOrder > 0 && (
            <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
              #{selectionOrder}
            </span>
          )}
          <Checkbox checked={isSelected} onCheckedChange={() => handleSelection(asset.symbol, type)} />
        </div>
      </div>
    );
  };

  const renderContent = (type, assets) => {
    const selectedCount = type === 'crypto' ? selectedCrypto.length : selectedStocks.length;
    const searchTerm = type === 'crypto' ? cryptoSearchTerm : stockSearchTerm;
    const setSearchTerm = type === 'crypto' ? setCryptoSearchTerm : setStockSearchTerm;
    const searchedAssets = type === 'crypto' ? searchedCrypto : searchedStocks;
    
    return (
      <motion.div
        key={type}
        initial={{ x: type === activeTab ? (activeTab === 'crypto' ? 300 : -300) : 0, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: type === 'crypto' ? -300 : 300, opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className="space-y-2"
      >
        <p className="text-sm text-center mb-4" style={{ color: 'var(--text-secondary)' }}>
          Selected {selectedCount} of 3. Order determines dashboard display order.
        </p>

        <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
                placeholder={isSearching ? `Searching for ${type}...` : `Search ${type} by name or symbol...`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 bg-transparent"
            />
             {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />}
             {(searchedAssets.length > 0 && searchTerm && searchTerm.length >= 2) && (
                <div className="absolute z-10 w-full mt-1 bg-[var(--card-bg)] border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {searchedAssets.map(asset => (
                        <div key={asset.symbol} onClick={() => { handleSelection(asset.symbol, type); setSearchTerm(""); }}
                              className="p-3 hover:bg-[var(--secondary-bg)] cursor-pointer flex justify-between items-center">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center" style={{ backgroundColor: 'var(--secondary-bg)' }}>
                                {asset.icon_url ? (
                                  <img 
                                    src={asset.icon_url} 
                                    alt={`${asset.symbol} icon`}
                                    className="w-6 h-6 object-contain"
                                    onError={(e) => {
                                      e.target.style.display = 'none';
                                      e.target.nextSibling.style.display = 'flex';
                                    }}
                                  />
                                ) : null}
                                <div className={`w-full h-full flex items-center justify-center text-xs ${asset.icon_url ? 'hidden' : 'flex'}`}>
                                  {asset.symbol}
                                </div>
                              </div>
                              <span>{asset.name}</span>
                            </div>
                        </div>
                    ))}
                </div>
             )}
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center py-10">
            <Loader2 className="w-8 h-8 animate-spin neon-text" />
          </div>
        ) : (
          <>
            <div className="mb-4">
              <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                {type === 'crypto' ? 'Top Market Movers' : 'Top Stock Gainers'}
              </h4>
            </div>
            {assets.length > 0 ? (
              assets.map(asset => <AssetRow key={asset.symbol} asset={asset} type={type} />)
            ) : (
              <p className="text-center text-sm py-8" style={{ color: 'var(--text-secondary)' }}>
                No suggested assets found. Try searching above.
              </p>
            )}
          </>
        )}
      </motion.div>
    );
  };

  return (
    <div className="p-4 space-y-6 pb-8" style={{ backgroundColor: 'var(--primary-bg)' }}>
      <a href={createPageUrl("Dashboard")} className="flex items-center gap-2 text-sm neon-text mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </a>
      <div className="flex items-center justify-between -mt-2 mb-2">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {activeTab === 'crypto' ? 'Crypto Top 3' : 'Stocks Top 3'}
        </span>
        <Button variant="outline" size="sm" onClick={handleClearSelection}>
          Clear {activeTab === 'crypto' ? 'Crypto' : 'Stocks'} Selection
        </Button>
      </div>
      
      <Card className="border-2" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <CardTitle>Edit Dashboard Watchlist</CardTitle>
          <CardDescription>Choose up to 3 assets from each category to watch on your dashboard. The order of selection determines display order.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="overflow-hidden">
            <TabsList className="grid w-full grid-cols-2 mb-4" style={{ backgroundColor: 'var(--secondary-bg)' }}>
              <TabsTrigger value="crypto" className="flex items-center gap-2"><Bitcoin className="w-4 h-4" />Crypto</TabsTrigger>
              <TabsTrigger value="stocks" className="flex items-center gap-2"><TrendingUp className="w-4 h-4" />Stocks</TabsTrigger>
            </TabsList>
            <AnimatePresence mode="wait">
              {activeTab === 'crypto' ? renderContent('crypto', suggestedCrypto) : renderContent('stocks', suggestedStocks)}
            </AnimatePresence>
          </Tabs>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={isSaving} className="w-full neon-glow bg-green-600 hover:bg-green-700">
        {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
        Save Preferences
      </Button>
    </div>
  );
}