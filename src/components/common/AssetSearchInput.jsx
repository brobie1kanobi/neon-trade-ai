import React, { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { base44 } from "@/api/base44Client";
import { Loader2 } from "lucide-react";

// Cache for search results
const searchCache = {
  crypto: {},
  stock: {}
};

// Debounce helper
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Popular assets for quick suggestions
const POPULAR_CRYPTO = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT', 'DOGE', 'LINK', 'AVAX', 'MATIC', 'ATOM', 'LTC', 'BCH', 'UNI', 'SHIB'];
const POPULAR_STOCKS = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'META', 'NVDA', 'AMD', 'NFLX', 'DIS'];

export default function AssetSearchInput({ 
  value, 
  onChange, 
  assetType = "crypto", 
  placeholder = "Search asset...",
  className = ""
}) {
  const [searchResults, setSearchResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState(value || "");
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sync external value changes
  useEffect(() => {
    setInputValue(value || "");
  }, [value]);

  // Search function
  const searchAssets = useCallback(async (query) => {
    if (!query || query.length < 1) {
      // Show popular assets when empty
      const popular = assetType === "crypto" ? POPULAR_CRYPTO : POPULAR_STOCKS;
      setSearchResults(popular.map(sym => ({ symbol: sym, name: sym })));
      return;
    }

    const upperQuery = query.toUpperCase();
    
    // Check cache first
    if (searchCache[assetType][upperQuery]) {
      setSearchResults(searchCache[assetType][upperQuery]);
      return;
    }

    setIsLoading(true);

    try {
      if (assetType === "crypto") {
        // Fetch crypto list from CoinGecko via our API
        const response = await base44.functions.invoke('getMarketData', {
          action: 'searchAssets',
          payload: { query: upperQuery, type: 'crypto' }
        });
        
        const results = response?.data || [];
        
        // Filter and format results
        const filtered = results
          .filter(item => 
            (item.symbol || "").toUpperCase().includes(upperQuery) ||
            (item.name || "").toUpperCase().includes(upperQuery)
          )
          .slice(0, 10)
          .map(item => ({
            symbol: (item.symbol || "").toUpperCase(),
            name: item.name || item.symbol,
            icon: item.icon_url || item.image
          }));

        // If no API results, filter from popular + common crypto
        if (filtered.length === 0) {
          const allCrypto = [...POPULAR_CRYPTO, 'TRX', 'XLM', 'ALGO', 'FIL', 'NEAR', 'APT', 'ARB', 'OP', 'INJ', 'PEPE', 'SUI', 'RENDER', 'FET', 'GRT', 'IMX'];
          const matches = allCrypto
            .filter(sym => sym.includes(upperQuery))
            .slice(0, 10)
            .map(sym => ({ symbol: sym, name: sym }));
          setSearchResults(matches);
          searchCache[assetType][upperQuery] = matches;
        } else {
          setSearchResults(filtered);
          searchCache[assetType][upperQuery] = filtered;
        }
      } else {
        // Stocks - use our stock API
        const response = await base44.functions.invoke('getMarketData', {
          action: 'searchAssets',
          payload: { query: upperQuery, type: 'stock' }
        });
        
        const results = response?.data || [];
        
        const filtered = results
          .filter(item => 
            (item.symbol || "").toUpperCase().includes(upperQuery) ||
            (item.name || "").toUpperCase().includes(upperQuery)
          )
          .slice(0, 10)
          .map(item => ({
            symbol: (item.symbol || "").toUpperCase(),
            name: item.name || item.symbol
          }));

        // If no API results, filter from popular stocks
        if (filtered.length === 0) {
          const allStocks = [...POPULAR_STOCKS, 'JPM', 'V', 'MA', 'BAC', 'WMT', 'PG', 'JNJ', 'UNH', 'HD', 'KO', 'PEP', 'MRK', 'ABBV', 'COST'];
          const matches = allStocks
            .filter(sym => sym.includes(upperQuery))
            .slice(0, 10)
            .map(sym => ({ symbol: sym, name: sym }));
          setSearchResults(matches);
          searchCache[assetType][upperQuery] = matches;
        } else {
          setSearchResults(filtered);
          searchCache[assetType][upperQuery] = filtered;
        }
      }
    } catch (error) {
      console.error('[AssetSearchInput] Search error:', error);
      // Fallback to local filtering
      const popular = assetType === "crypto" ? POPULAR_CRYPTO : POPULAR_STOCKS;
      const matches = popular
        .filter(sym => sym.includes(upperQuery))
        .map(sym => ({ symbol: sym, name: sym }));
      setSearchResults(matches);
    } finally {
      setIsLoading(false);
    }
  }, [assetType]);

  // Debounced search
  const debouncedSearch = useCallback(
    debounce((query) => searchAssets(query), 300),
    [searchAssets]
  );

  const handleInputChange = (e) => {
    const newValue = e.target.value.toUpperCase();
    setInputValue(newValue);
    onChange(newValue);
    setIsOpen(true);
    debouncedSearch(newValue);
  };

  const handleFocus = () => {
    setIsOpen(true);
    if (!inputValue) {
      // Show popular assets on focus
      const popular = assetType === "crypto" ? POPULAR_CRYPTO : POPULAR_STOCKS;
      setSearchResults(popular.map(sym => ({ symbol: sym, name: sym })));
    } else {
      debouncedSearch(inputValue);
    }
  };

  const handleSelect = (asset) => {
    setInputValue(asset.symbol);
    onChange(asset.symbol);
    setIsOpen(false);
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative">
        <Input
          ref={inputRef}
          placeholder={placeholder}
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          autoComplete="off"
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
          </div>
        )}
      </div>

      {isOpen && searchResults.length > 0 && (
        <div 
          className="absolute z-50 w-full mt-1 max-h-60 overflow-auto rounded-md border shadow-lg"
          style={{ 
            backgroundColor: 'var(--card-bg, #1a1a1a)', 
            borderColor: 'var(--border-color, #333)'
          }}
        >
          {searchResults.map((asset, index) => (
            <button
              key={`${asset.symbol}-${index}`}
              type="button"
              className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2 transition-colors"
              onClick={() => handleSelect(asset)}
            >
              {asset.icon && (
                <img 
                  src={asset.icon} 
                  alt={asset.symbol} 
                  className="w-5 h-5 rounded-full"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              )}
              <span className="font-medium" style={{ color: 'var(--text-primary, #fff)' }}>
                {asset.symbol}
              </span>
              {asset.name && asset.name !== asset.symbol && (
                <span className="text-sm truncate" style={{ color: 'var(--text-secondary, #888)' }}>
                  {asset.name}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}