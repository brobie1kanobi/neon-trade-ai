
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, ReferenceDot, ReferenceLine } from "recharts";
import { Loader2, RefreshCw } from "lucide-react";
import { getMarketData } from "@/functions/getMarketData";
import { User, Trade } from "@/entities/all";
import { useSettings } from "@/components/utils/SettingsContext";

export default function AssetPriceChart({ symbol, assetType = 'crypto', onPriceUpdate, trades = [], holding = null }) {
  const [chartData, setChartData] = useState([]);
  const [timeframe, setTimeframe] = useState("24h");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetchTime, setLastFetchTime] = useState(0);
  const [tradeMarkers, setTradeMarkers] = useState([]);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [pinnedIndex, setPinnedIndex] = useState(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const longPressTimerRef = useRef(null);
  const intervalRef = useRef(null);
  const [latestPrice, setLatestPrice] = useState(null); // Add a local price fallback holder
  const [periodStartPrice, setPeriodStartPrice] = useState(null); // Store the start price of the current period

  // Read simulation mode from settings context
  const { settings } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;

  const timeframes = useMemo(() => [
    { label: "24H", value: "24h", days: 1 },
    { label: "7D", value: "7d", days: 7 },
    { label: "1M", value: "1m", days: 30 },
    { label: "3M", value: "3m", days: 90 },
    { label: "1Y", value: "1y", days: 365 }
  ], []);

  // Compute high/low from series
  const { highPrice, lowPrice } = useMemo(() => {
    if (!chartData || chartData.length === 0) return { highPrice: null, lowPrice: null };
    let hi = chartData[0].price;
    let lo = chartData[0].price;
    for (const p of chartData) {
      if (p.price > hi) hi = p.price;
      if (p.price < lo) lo = p.price;
    }
    return { highPrice: hi, lowPrice: lo };
  }, [chartData]);

  const fetchChartData = useCallback(async (isManualRefresh = false) => {
    const now = Date.now();
    // Only throttle if we already have chartData; never block initial/empty fetches
    if (!isManualRefresh && chartData.length > 0 && (now - lastFetchTime) < 30000) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const days = timeframes.find(tf => tf.value === timeframe)?.days || 1;
      
      const { data: historyData, error: historyError } = await getMarketData({
          action: 'getAssetChartData',
          payload: { symbol: symbol, assetType: assetType, days: days }
      });

      if (!historyError && Array.isArray(historyData) && historyData.length > 0) {
        const currentPrice = historyData[historyData.length - 1]?.price || 0;
        const startPrice = historyData[0]?.price || currentPrice;
        const change = startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : 0;
        
        const processedData = historyData.map(point => ({
          time: new Date(point.time).getTime(),
          price: point.price,
        }));
        
        setChartData(processedData);
        setLastFetchTime(now);
        setPinnedIndex(null); // Reset pinned index on new data load
        setLatestPrice(currentPrice); // Store the latest price from the chart data
        setPeriodStartPrice(startPrice); // Store the start price for P&L calculation
        
        onPriceUpdate({
          price: currentPrice,
          change: change,
          label: timeframes.find(tf => tf.value === timeframe).label,
        });
      } else {
        // No series from providers; fetch real latest/last-close price and show price-only fallback
        const { data: details } = await getMarketData({
          action: 'getAssetDetails',
          payload: { symbol: symbol, assetType: assetType }
        });
        // Use details.price as fallback, or last price from previously loaded chart data if available, otherwise null.
        const fallbackPrice = typeof details?.price === 'number' ? details.price : (chartData?.[chartData.length - 1]?.price || null);
        
        setLatestPrice(fallbackPrice); // Always store the latest price available
        setPeriodStartPrice(fallbackPrice); // If no history, start price is current price
        setLastFetchTime(now);
        setPinnedIndex(null);
        setChartData([]); // Ensure chartData is empty if no historical data was received

        // Do not synthesize chartData; leave as-is (may be empty) per user request
        if (typeof fallbackPrice === 'number') {
          onPriceUpdate({
            price: fallbackPrice,
            change: 0, // No change can be calculated without history
            label: timeframes.find(tf => tf.value === timeframe).label,
          });
        }
        // Do not set error here; this is an intentional graceful fallback
      }

    } catch (e) {
      console.error("Chart data fetch error:", e);
      
      // Handle rate limiting specifically
      if (e.message.includes('429') || e.message.includes('Rate limit')) {
        setError("Rate limit reached. Please wait a moment before refreshing.");
      } else {
        // Keep previous chart data if any; avoid noisy error if we can show something
        if (!chartData || chartData.length === 0) {
          setError("Failed to load chart data. Please try again.");
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [symbol, timeframe, timeframes, onPriceUpdate, lastFetchTime, assetType, chartData]);

  const quantity = holding?.quantity || 0;

  // Compute period P&L
  const periodPnL = React.useMemo(() => {
    if (quantity <= 0 || periodStartPrice == null || latestPrice == null) {
      return { value: 0, percent: 0 };
    }
    const diff = latestPrice - periodStartPrice;
    const value = quantity * diff;
    const percent = periodStartPrice > 0 ? (diff / periodStartPrice) * 100 : 0;
    return { value, percent };
  }, [quantity, periodStartPrice, latestPrice]);

  // Handle timeframe changes and initial load
  useEffect(() => {
    if (symbol) {
      fetchChartData();
    }
  }, [symbol, timeframe, assetType]);

  // Use preloaded trades if provided; otherwise, fallback to internal fetch
  useEffect(() => {
    const mapTradesToMarkers = (tradesArr) => {
      const daysMap = { "24h": 1, "7d": 7, "1m": 30, "3m": 90, "1y": 365 };
      const days = daysMap[timeframe] || 1;
      const startMs = Date.now() - days * 24 * 60 * 60 * 1000;
      return (tradesArr || [])
        .filter(t => 
          (t.type === "buy" || t.type === "sell") && 
          (t.symbol || "").toUpperCase() === (symbol || "").toUpperCase() &&
          (t.is_simulation !== false) === isSimMode // strict filter by simulation mode
        )
        .filter(t => new Date(t.created_date).getTime() >= startMs)
        .map(t => ({
          time: new Date(t.created_date).getTime(),
          price: Number(t.price) || 0,
          type: t.type,
          id: t.id,
          total: typeof t.total_value === 'number' ? t.total_value : (Number(t.quantity) * Number(t.price) || 0)
        }));
    };

    if (Array.isArray(trades)) { // Changed from preloadedTrades to trades
      setTradeMarkers(mapTradesToMarkers(trades));
      return;
    }

    let active = true;
    const loadTrades = async () => {
      if (!symbol) return;
      try {
        const user = await User.me();
        const symbolUpper = (symbol || "").toUpperCase();
        // Server-side filter by simulation mode as well for efficiency
        const userTrades = await Trade.filter(
          { created_by: user.email, symbol: symbolUpper, is_simulation: isSimMode },
          "-created_date",
          500
        );
        if (active) setTradeMarkers(mapTradesToMarkers(userTrades));
      } catch (e) {
        // Silently ignore; markers are optional
        console.warn("Failed loading trade markers:", e?.message || e);
        if (active) setTradeMarkers([]);
      }
    };
    loadTrades();
    return () => { active = false; };
  }, [trades, symbol, timeframe, isSimMode]); // Changed from preloadedTrades to trades

  // Find nearest trade marker to current hover position
  const nearestHoverMarker = useMemo(() => {
    if (hoverIndex == null || !Array.isArray(chartData) || chartData.length === 0 || tradeMarkers.length === 0) {
      return null;
    }
    const hoverTime = chartData[hoverIndex]?.time;
    if (!hoverTime) return null;
    let nearest = null;
    let bestDelta = Infinity;
    for (const m of tradeMarkers) {
      const d = Math.abs(m.time - hoverTime);
      if (d < bestDelta) {
        bestDelta = d;
        nearest = m;
      }
    }
    // Optional: only highlight if within a reasonable temporal window (e.g., 1/50 of range)
    // For simplicity, we highlight the nearest one always if one is found
    return nearest;
  }, [hoverIndex, chartData, tradeMarkers]);

  // Time range for proximity detection in tooltip
  const timeRange = useMemo(() => {
    if (!chartData || chartData.length < 2) return 0;
    return chartData[chartData.length - 1].time - chartData[0].time;
  }, [chartData]);

  // Set up interval for automatic refresh (increased to 5 minutes to avoid rate limits)
  useEffect(() => {
    if (symbol && chartData.length > 0) { // Only set interval if we have actual chart data
      // Clear any existing interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      
      // Set up new interval with longer delay (5 minutes)
      intervalRef.current = setInterval(() => {
        fetchChartData();
      }, 300000); // 5 minutes instead of 1 minute
      
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    } else if (intervalRef.current) {
      // If symbol or chartData becomes empty, clear any active interval
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [symbol, chartData.length]);

  const handleManualRefresh = () => {
    fetchChartData(true); // Bypass rate limiting for manual refresh
  };

  const isPositive = chartData.length > 1 ? chartData[chartData.length - 1].price >= chartData[0].price : true;
  
  const formatXAxisLabel = (timestamp) => {
      const date = new Date(timestamp);
      if (timeframe === "24h") {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else if (timeframe === "7d") {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } else {
        return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      }
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const price = payload[0].value;
    const ts = label; // numeric ms when XAxis type="number"
    const timeText = formatXAxisLabel(ts);

    // If near a trade, show its info (date + transaction amount)
    let tradeInfo = null;
    if (nearestHoverMarker && timeRange > 0) {
      const proximity = Math.abs(nearestHoverMarker.time - ts);
      const threshold = timeRange / 40; // within ~2.5% of the range
      if (proximity <= threshold) {
        const tradeDate = formatXAxisLabel(nearestHoverMarker.time);
        const amount = typeof nearestHoverMarker.total === 'number'
          ? nearestHoverMarker.total
          : nearestHoverMarker.price; // fallback
        tradeInfo = {
          type: nearestHoverMarker.type,
          date: tradeDate,
          amount
        };
      }
    }

    return (
      <div className="bg-gray-900 text-white p-3 rounded-lg shadow-lg border border-gray-700 space-y-1.5">
        <p className="text-sm font-medium">{timeText}</p>
        <p className="text-lg font-bold text-green-400">
          ${Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
        </p>
        {tradeInfo && (
          <div className="mt-1 text-xs">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded ${tradeInfo.type === 'buy' ? 'bg-green-700/40 text-green-300' : 'bg-red-700/40 text-red-300'}`}>
              {tradeInfo.type === 'buy' ? 'Buy' : 'Sell'}
            </span>
            <span className="ml-2 text-gray-300">
              ${Number(tradeInfo.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="ml-2 text-gray-400">on {tradeInfo.date}</span>
          </div>
        )}
      </div>
    );
  };

  // Crosshair cursor (green vertical line)
  const CrosshairCursor = ({ points, height }) => {
    if (!points || !points[0]) return null;
    const x = points[0].x;
    return <line x1={x} y1={0} x2={x} y2={height} stroke="rgba(57,255,20,0.6)" strokeWidth={1} />;
  };

  // Persistent pinned label attached to the pinned dot
  const PinnedDotLabel = (props) => {
    const { viewBox } = props || {};
    const cx = (viewBox && (viewBox.cx ?? viewBox.x)) ?? 0;
    const cy = (viewBox && (viewBox.cy ?? viewBox.y)) ?? 0;
    const point = (pinnedIndex != null && chartData[pinnedIndex]) ? chartData[pinnedIndex] : null;
    if (!point) return null;
    const priceStr = `$${Number(point.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
    const timeStr = (() => {
      const t = chartData[pinnedIndex]?.time;
      if (!t) return '';
      const date = new Date(t);
      if (timeframe === "24h") return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      if (timeframe === "7d") return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    })();
    const text = `${timeStr} • ${priceStr}`;
    const padding = 6;
    const approxCharPx = 6.5;
    const minWidth = 90;
    const maxWidth = 240;
    const width = Math.max(minWidth, Math.min(maxWidth, text.length * approxCharPx + padding * 2));
    const height = 22;
    const rx = 6;
    const ry = 6;
    const rectX = cx - width / 2;
    const rectY = cy - (height + 14);
    const textY = rectY + height / 2 + 3;
    return (
      <g>
        <rect x={rectX} y={rectY} rx={rx} ry={ry} width={width} height={height} fill="#111827" stroke="#39FF14" strokeWidth="0.8" />
        <text x={cx} y={textY} fill="#e5e7eb" fontSize="10" textAnchor="middle">
          {text}
        </text>
      </g>
    );
  };

  // Pointer/touch handlers to support snap and mobile scrubbing
  const handleMouseMove = (state) => {
    const idx = typeof state?.activeTooltipIndex === "number" ? state.activeTooltipIndex : null;
    setHoverIndex(idx);
    if (isScrubbing && idx != null) setPinnedIndex(idx);
  };
  const handleMouseLeave = () => setHoverIndex(null);
  const handleClick = (state) => {
    const idx = typeof state?.activeTooltipIndex === "number" ? state.activeTooltipIndex : null;
    if (idx == null) return;
    setPinnedIndex(idx); // move pinned to hovered point
  };
  const handleTouchStart = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      setIsScrubbing(true);
      if (hoverIndex != null) setPinnedIndex(hoverIndex);
    }, 250); // 250ms for long press
  };
  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsScrubbing(false); // keep last pinnedIndex
  };
  const handleTouchCancel = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsScrubbing(false);
  };

  // Helper to snap to nearest chart point time (for dot clicks)
  const findNearestIndexByTime = useCallback((targetTime) => {
    if (!Array.isArray(chartData) || chartData.length === 0) return null;
    let nearestIdx = 0;
    let bestDelta = Infinity;
    for (let i = 0; i < chartData.length; i++) {
      const d = Math.abs(chartData[i].time - targetTime);
      if (d < bestDelta) {
        bestDelta = d;
        nearestIdx = i;
      }
    }
    return nearestIdx;
  }, [chartData]);

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold leading-none tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Price Chart
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleManualRefresh}
              disabled={isLoading}
              className="p-1 h-6 w-6"
            >
              <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <div className="flex gap-1">
            {timeframes.map((tf) =>
              <Button
                key={tf.value}
                variant={timeframe === tf.value ? "default" : "ghost"}
                size="sm"
                onClick={() => {
                  setTimeframe(tf.value);
                  setIsLoading(true);
                  // A small delay to show loader before fetchChartData runs, for better UX
                  setTimeout(() => {
                    fetchChartData(true);
                  }, 100);
                }}
                className={timeframe === tf.value ? "bg-green-600 text-white neon-glow hover:bg-green-700" : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"}>
                {tf.label}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Period P/L and Info Cards like screenshot */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="p-3 rounded-lg border" style={{ 
            borderColor: 'var(--border-color)',
            backgroundColor: 'var(--secondary-bg)' 
          }}>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Period P/L</div>
            <div className={`font-semibold text-sm ${periodPnL.value >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {periodPnL.value >= 0 ? '+' : ''}${periodPnL.value.toFixed(2)}
            </div>
            <div className={`text-xs ${periodPnL.percent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {periodPnL.percent >= 0 ? '+' : ''}{periodPnL.percent.toFixed(2)}%
            </div>
          </div>
          
          <div className="p-3 rounded-lg border" style={{ 
            borderColor: 'var(--border-color)',
            backgroundColor: 'var(--secondary-bg)' 
          }}>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Current Price</div>
            <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
              ${Number(latestPrice || 0).toFixed(2)}
            </div>
          </div>
          
          <div className="p-3 rounded-lg border" style={{ 
            borderColor: 'var(--border-color)',
            backgroundColor: 'var(--secondary-bg)' 
          }}>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Quantity</div>
            <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
              {Number(quantity).toFixed(6)}
            </div>
          </div>
          
          <div className="p-3 rounded-lg border" style={{ 
            borderColor: 'var(--border-color)',
            backgroundColor: 'var(--secondary-bg)' 
          }}>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Current Value</div>
            <div className="font-semibold text-sm neon-text">
              ${Number(quantity * (latestPrice || 0)).toFixed(2)}
            </div>
          </div>
        </div>
        <div
          className="h-64 rounded-lg p-2"
          style={{ backgroundColor: 'var(--primary-bg)' }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
        >
          {isLoading ?
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin neon-text" />
            </div> :
            error ?
              <div className="h-full flex flex-col items-center justify-center text-center p-4">
                 <p style={{ color: 'var(--text-secondary)' }} className="mb-2">{error}</p>
                 <Button 
                   variant="outline" 
                   size="sm" 
                   onClick={handleManualRefresh}
                   className="text-xs"
                 >
                   Try Again
                 </Button>
              </div> :
              (chartData && chartData.length > 0) ? 
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    onClick={handleClick}
                  >
                    <CartesianGrid 
                      strokeDasharray="3 3" 
                      stroke="var(--border-color)"
                      className="opacity-30 md:opacity-100" 
                    />
                    <XAxis
                      type="number"
                      dataKey="time"
                      domain={['dataMin', 'dataMax']}
                      scale="time"
                      tickFormatter={(ts) => formatXAxisLabel(ts)}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                    />
                    <YAxis hide domain={['dataMin', 'dataMax']} />
                    {/* High/Low reference lines */}
                    {typeof highPrice === 'number' && (
                      <ReferenceLine
                        y={highPrice}
                        stroke="#10b981"
                        strokeDasharray="3 3"
                        label={{ value: `High ${highPrice.toFixed(2)}`, position: 'right', fill: '#10b981', fontSize: 12 }}
                      />
                    )}
                    {typeof lowPrice === 'number' && (
                      <ReferenceLine
                        y={lowPrice}
                        stroke="#ef4444"
                        strokeDasharray="3 3"
                        label={{ value: `Low ${lowPrice.toFixed(2)}`, position: 'right', fill: '#ef4444', fontSize: 12 }}
                      />
                    )}
                    <Tooltip content={<CustomTooltip />} cursor={<CrosshairCursor />} />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke={isPositive ? '#39FF14' : '#ef4444'}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 6, stroke: isPositive ? '#39FF14' : '#ef4444', strokeWidth: 2, fill: '#000000' }} />

                    {/* Pinned crosshair: vertical line + dot + sticky label */}
                    {pinnedIndex != null && chartData[pinnedIndex] && (
                      <>
                        <ReferenceLine x={chartData[pinnedIndex].time} stroke="rgba(57,255,20,0.35)" />
                        <ReferenceDot
                          x={chartData[pinnedIndex].time}
                          y={chartData[pinnedIndex].price}
                          r={5}
                          fill="#39FF14"
                          stroke="#ffffff"
                          strokeWidth={2}
                          label={<PinnedDotLabel />}
                        />
                      </>
                    )}
  
                    {/* Trade markers: green for buys, red for sells (always visible, filtered by timeframe and mode) */}
                    {tradeMarkers.map((m) => (
                      <ReferenceDot
                        key={m.id}
                        x={m.time}
                        y={m.price}
                        r={4}
                        fill={m.type === "buy" ? "#22c55e" : "#ef4444"}
                        stroke="#ffffff"
                        strokeWidth={1.5}
                        onClick={() => {
                          const idx = findNearestIndexByTime(m.time);
                          if (idx != null) {
                            setPinnedIndex(idx);
                            setHoverIndex(idx);
                          }
                        }}
                      />
                    ))}
  
                    {/* Highlight nearest marker to hover time */}
                    {nearestHoverMarker && (
                      <ReferenceDot
                        x={nearestHoverMarker.time}
                        y={nearestHoverMarker.price}
                        r={6}
                        fill={nearestHoverMarker.type === "buy" ? "#16a34a" : "#dc2626"}
                        stroke="#ffffff"
                        strokeWidth={2}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer> :
                <div className="h-full flex flex-col items-center justify-center text-center p-4">
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Showing latest available price
                  </p>
                  <p className="text-2xl font-bold neon-text">
                    {typeof latestPrice === 'number'
                      ? `$${latestPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
                      : '—'}
                  </p>
                </div>
          }
        </div>
        {/* Optional subtle legend */}
        {tradeMarkers.length > 0 && (
          <div className="flex items-center gap-4 mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#22c55e' }}></span>
              Buy
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#ef4444' }}></span>
              Sell
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
