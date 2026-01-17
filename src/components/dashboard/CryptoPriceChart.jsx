import React, { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, CartesianGrid, ReferenceDot } from "recharts";
import { TrendingUp, TrendingDown, BarChart3, Loader2 } from "lucide-react";
import { useSettings } from "@/components/utils/SettingsContext"; // Import useSettings
import { base44 } from "@/api/base44Client"; // Import base44 for fallback

export default function CryptoPriceChart({ symbol: propSymbol = "BTC" }) {
  // Pull user settings (watchlist) from context
  const { settings } = useSettings?.() || {};
  const hour12 = (settings?.time_format || "12h") !== "24h";
  // Determine effective symbol: user's #1 watched crypto, else prop, else BTC
  const effectiveSymbol = (settings?.watched_crypto?.length ? settings.watched_crypto[0] : propSymbol) || "BTC";

  const containerRef = useRef(null);
  const [isVisible, setIsVisible] = useState(true);

  const [chartData, setChartData] = useState([]);
  const [timeframe, setTimeframe] = useState("24h");
  const [currentPrice, setCurrentPrice] = useState(null);
  const [priceChange, setPriceChange] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Crosshair + snap state
  const [hoverIndex, setHoverIndex] = useState(null);
  const [pinnedIndex, setPinnedIndex] = useState(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const longPressTimerRef = useRef(null);

  const timeframes = [
  { label: "24H", value: "24h" },
  { label: "7D", value: "7d" },
  { label: "1M", value: "1m" },
  { label: "3M", value: "3m" },
  { label: "1Y", value: "1y" }];

  const handleMouseMove = (state) => {
    const idx = typeof state?.activeTooltipIndex === "number" ? state.activeTooltipIndex : null;
    setHoverIndex(idx);
    if (isScrubbing && idx != null) setPinnedIndex(idx);
  };
  const handleMouseLeave = () => {
    setHoverIndex(null); // keep pinned selection
  };
  const handleClick = (state) => {
    const idx = typeof state?.activeTooltipIndex === "number" ? state.activeTooltipIndex : null;
    if (idx == null) return;
    setPinnedIndex((prev) => prev === idx ? null : idx);
  };
  const handleTouchStart = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      setIsScrubbing(true);
      if (hoverIndex != null) setPinnedIndex(hoverIndex); // Snap to current hover on long-press start
    }, 250);
  };
  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsScrubbing(false); // keep last pinnedIndex (snap)
  };
  const handleTouchCancel = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsScrubbing(false);
  };

  // Custom vertical cursor (green) for hover/scrub
  const CrosshairCursor = ({ points, height }) => {
    if (!points || !points[0]) return null;
    const x = points[0].x;
    return <line x1={x} y1={0} x2={x} y2={height} stroke="rgba(57,255,20,0.6)" strokeWidth={1} />;
  };

  // Calculate high and low points
  const { highPoint, lowPoint, highPrice, lowPrice, highTimestamp, lowTimestamp } = useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return { highPoint: null, lowPoint: null, highPrice: 0, lowPrice: 0, highTimestamp: null, lowTimestamp: null };
    }
    let high = chartData[0];
    let low = chartData[0];
    let hiIdx = 0;
    let loIdx = 0;
    chartData.forEach((point, idx) => {
      if (point.price > high.price) {high = point;hiIdx = idx;}
      if (point.price < low.price) {low = point;loIdx = idx;}
    });
    return {
      highPoint: high,
      lowPoint: low,
      highPrice: high.price,
      lowPrice: low.price,
      highTimestamp: chartData[hiIdx]?.timestamp || null,
      lowTimestamp: chartData[loIdx]?.timestamp || null
    };
  }, [chartData]);

  // Helper to compute nice tick step for Y-axis grid
  const getNiceStep = (range) => {
    const raw = range / 6; // target ~6 lines
    const power = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-12))));
    const normalized = raw / power;
    let nice;
    if (normalized <= 1) nice = 1;else
    if (normalized <= 2) nice = 2;else
    if (normalized <= 2.5) nice = 2.5;else
    if (normalized <= 5) nice = 5;else
    nice = 10;
    return nice * power;
  };

  // NEW: dynamic Y-axis domain to auto-zoom based on movement within timeframe
  const yDomain = useMemo(() => {
    if (!chartData || chartData.length === 0) return ['auto', 'auto'];
    const prices = chartData.map((p) => p.price).filter((v) => typeof v === 'number' && isFinite(v));
    if (prices.length === 0) return ['auto', 'auto'];

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    let range = max - min;

    // If no variance, use a small synthetic range to make line visible
    if (range === 0) {
      const base = max || 1;
      range = base * 0.001; // 0.1% of price
    }

    // Add 10% padding around the data range
    const padding = range * 0.1;
    const lower = Math.max(0, min - padding);
    const upper = max + padding;
    return [lower, upper];
  }, [chartData]);

  // Y-axis ticks at "nice" increments across the computed domain
  const yTicks = useMemo(() => {
    if (!Array.isArray(chartData) || chartData.length === 0) return [];
    const [lower, upper] = yDomain;
    if (lower === 'auto' || upper === 'auto') return [];
    const range = upper - lower;
    if (!isFinite(range) || range <= 0) return [];
    const step = getNiceStep(range);
    const start = Math.ceil(lower / step) * step;
    const ticks = [];
    for (let v = start; v <= upper; v += step) {
      // Limit to reasonable number of ticks to avoid clutter
      if (ticks.length > 12) break;
      ticks.push(v);
    }
    return ticks;
  }, [yDomain, chartData]);

  // Render dataset: real chartData or minimal 2-point fallback to keep chart visible
  const renderData = useMemo(() => {
    if (Array.isArray(chartData) && chartData.length > 0) return chartData;
    if (typeof currentPrice === 'number' && currentPrice > 0) {
      const now = Date.now();
      return [
        { timestamp: new Date(now - 60000).toISOString(), price: currentPrice, formattedTime: '' },
        { timestamp: new Date(now).toISOString(), price: currentPrice, formattedTime: '' }
      ];
    }
    return [];
  }, [chartData, currentPrice]);

  // Persistent pinned label renderer (SVG), attached to the pinned dot
  const PinnedDotLabel = (props) => {
    const { viewBox } = props || {};
    const cx = (viewBox && (viewBox.cx ?? viewBox.x)) ?? 0;
    const cy = (viewBox && (viewBox.cy ?? viewBox.y)) ?? 0;

    const point = pinnedIndex != null && chartData[pinnedIndex] ? chartData[pinnedIndex] : null;
    if (!point) return null;

    const priceStr = `$${Number(point.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
    const timeStr = point.formattedTime || new Date(point.timestamp).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12 });
    const text = `${timeStr} • ${priceStr}`;

    const padding = 6;
    const approxCharPx = 6.5;
    const minWidth = 90;
    const maxWidth = 240;
    const width = Math.max(minWidth, Math.min(maxWidth, text.length * approxCharPx + padding * 2));
    const height = 22;
    const rx = 6;
    const ry = 6;

    // If too close to top, show the label beside the dot; otherwise, above as usual.
    const topPadding = 8; // Margin from the top edge of the chart content area
    const aboveY = cy - (height + 14); // Y position if label is placed above the dot
    const tooCloseToTop = aboveY < topPadding;

    let rectX;
    let rectY;
    let textX;
    let textY;
    if (tooCloseToTop) {
      // Choose left or right based on proximity to left edge
      const placeRight = cx < 120; // Heuristic: if dot is on the left side, place label to the right
      rectX = placeRight ? cx + 10 : cx - width - 10; // 10px offset from the dot
      rectY = cy - height / 2 - 4; // Slightly above the dot's vertical center
      textX = rectX + width / 2;
      textY = rectY + height / 2 + 3;
    } else {
      // Default: place label above the dot
      rectX = cx - width / 2;
      rectY = aboveY;
      textX = cx;
      textY = rectY + height / 2 + 3;
    }

    return (
      <g>
        <rect x={rectX} y={rectY} rx={rx} ry={ry} width={width} height={height} fill="#111827" stroke="#39FF14" strokeWidth="0.8" />
        <text x={textX} y={textY} fill="#e5e7eb" fontSize="10" textAnchor="middle">
          {text}
        </text>
      </g>);

  };


  useEffect(() => {
    // Observe visibility of the chart card
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const formatXAxisLabel = (timestamp) => {
      const date = new Date(timestamp);
      if (timeframe === "24h") {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12 });
      } else if (timeframe === "7d") {
        return date.toLocaleDateString('en-US', { weekday: 'short' });
      } else {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    };

    const fetchChartData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const days = { '24h': 1, '7d': 7, '1m': 30, '3m': 90, '1y': 365 }[timeframe] || 1;

        const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), 10000)
        );

        // Fetch current price
        const currentPricePromise = base44.functions.invoke('getMarketData', {
          action: 'getWatchlistData',
          payload: { cryptoSymbols: [effectiveSymbol], stockSymbols: [] }
        });

        const currentPriceResponse = await Promise.race([currentPricePromise, timeoutPromise]);

        const currentAssetData = Array.isArray(currentPriceResponse?.data) ? currentPriceResponse.data[0] : null;

        if (currentAssetData) {
          setCurrentPrice(typeof currentAssetData.price === 'number' ? currentAssetData.price : currentAssetData.current_price ?? null);
          // Don't set priceChange here - we'll calculate it from the chart data
        } else {
          setCurrentPrice(null);
        }

        // Fetch historical series
        const historyPromise = base44.functions.invoke('getMarketData', {
          action: 'getAssetChartData',
          payload: { symbol: effectiveSymbol, assetType: 'crypto', days: days }
        });

        const historyResponse = await Promise.race([historyPromise, timeoutPromise]);

        const historyChartData = Array.isArray(historyResponse?.data) ? historyResponse.data : [];

        if (historyChartData.length > 0) {
          const processedData = historyChartData.map((point) => ({
            timestamp: new Date(point.time).toISOString(),
            price: point.price,
            formattedTime: formatXAxisLabel(new Date(point.time).toISOString())
          }));
          setChartData(processedData);

          // CALCULATE PERCENTAGE CHANGE FOR SELECTED TIMEFRAME
          if (processedData.length >= 2) {
            const firstPrice = processedData[0].price;
            const lastPrice = processedData[processedData.length - 1].price;

            if (firstPrice > 0) {
              const percentChange = (lastPrice - firstPrice) / firstPrice * 100;
              setPriceChange(percentChange);
            } else {
              setPriceChange(null);
            }
          } else {
            setPriceChange(null);
          }
        } else {
          setChartData((prev) => prev && prev.length > 0 ? prev : []);
          setPriceChange(null);
        }
      } catch (error) {
        console.error('[CryptoPriceChart] Fetch error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    // Reset pinned index when symbol or timeframe changes
    setPinnedIndex(null);

    if (isVisible) {
      fetchChartData();
    }
    // Update every 60s while visible; pause when hidden
    const interval = isVisible ? setInterval(fetchChartData, 60000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [effectiveSymbol, timeframe, isVisible, hour12]);

  const isPositive = priceChange !== null && priceChange >= 0;

  // Custom tooltip component
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      const price = data.value;
      const isHigh = highPoint && Math.abs(price - highPoint.price) < 0.01;
      const isLow = lowPoint && Math.abs(price - lowPoint.price) < 0.01;

      return (
        <div className="bg-gray-900 text-white p-3 rounded-lg shadow-lg border border-gray-700">
          <p className="text-sm font-medium">{`Time: ${label}`}</p>
          <p className="text-lg font-bold text-green-400">{`$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`}</p>
          {isHigh && <p className="text-xs text-red-400 font-medium">📈 Period High</p>}
          {isLow && <p className="text-xs text-blue-400 font-medium">📉 Period Low</p>}
        </div>);

    }
    return null;
  };

  // Custom dot component for ONLY the single high and low points (exact timestamp match)
  const CustomDot = (props) => {
    const { cx, cy, payload } = props;
    const ts = payload?.timestamp;
    const isHigh = highTimestamp && ts === highTimestamp;
    const isLow = lowTimestamp && ts === lowTimestamp;

    if (isHigh) {
      return <circle cx={cx} cy={cy} r={4} fill="#ef4444" stroke="#ffffff" strokeWidth={2} />;
    }
    if (isLow) {
      return <circle cx={cx} cy={cy} r={4} fill="#3b82f6" stroke="#ffffff" strokeWidth={2} />;
    }
    return null;
  };

  const handleRetry = () => {
    // A full page reload for retry as per original component behavior
    window.location.reload();
  };

  return (
    <Card ref={containerRef} style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold leading-none tracking-tight flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <BarChart3 className="w-5 h-5 neon-text" />
            {effectiveSymbol} Live Price Chart
          </CardTitle>
          <div className="flex gap-1">
            {timeframes.map((tf) =>
            <Button
              key={tf.value}
              variant={timeframe === tf.value ? "default" : "ghost"}
              size="sm"
              onClick={() => setTimeframe(tf.value)}
              className={timeframe === tf.value ?
              "bg-green-600 text-white neon-glow hover:bg-green-700" :
              "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              }>
                {tf.label}
              </Button>
            )}
          </div>
        </div>
        {currentPrice !== null &&
        <div className="flex items-center gap-4 mt-2">
            <span className="text-2xl font-bold neon-text">
              ${typeof currentPrice === 'number' ? currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : '0.00'}
            </span>
            {priceChange !== null &&
          <div className="flex items-center gap-1">
                {isPositive ?
            <TrendingUp className="w-4 h-4 text-green-500" /> :
            <TrendingDown className="w-4 h-4 text-red-500" />
            }
                <span className={`font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                  {typeof priceChange === 'number' ? `${isPositive ? '+' : ''}${priceChange.toFixed(2)}%` : '0.00%'}
                </span>
                <span className="text-xs text-gray-500 ml-1">
                  {timeframe === '24h' ? '24h' : timeframe === '7d' ? '7d' : timeframe === '1m' ? '1M' : timeframe === '3m' ? '3M' : '1Y'}
                </span>
              </div>
          }
          </div>
        }

        {/* High/Low Summary */}
        {!isLoading && !error && chartData.length > 0 &&
        <div className="flex items-center justify-between mt-2 text-xs">
            <div className="flex items-center gap-1">
              <span style={{ color: 'var(--text-secondary)' }}>High:</span>
              <span className="text-lime-400 font-medium">${highPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center gap-1">
              <span style={{ color: 'var(--text-secondary)' }}>Low:</span>
              <span className="text-blue-400 font-medium">${lowPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        }
      </CardHeader>
      <CardContent>
        <div
          className="bg-slate-100 dark:bg-slate-800 p-4 h-64 rounded-lg border"
          style={{ borderColor: 'var(--border-color)' }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel} // Added handleTouchCancel
        >
          {isLoading ?
          <div className="h-full flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin neon-text" />
            </div> :
          renderData.length > 0 ?
          <ResponsiveContainer width="100%" height="100%">
                <LineChart
              data={renderData}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onClick={handleClick}>

                  <CartesianGrid stroke="var(--border-color)" strokeDasharray="3 3" />
                  <XAxis
                dataKey="formattedTime"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} />
                  <YAxis
                domain={yDomain}
                ticks={yTicks}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                tickFormatter={(v) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 })}`}
                width={60} />

                  {/* High price reference line */}
                  <ReferenceLine
                y={highPrice}
                stroke="#ef444440"
                strokeDasharray="3 3"
                label={{ value: `High: $${highPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, position: "topRight", fontSize: 10, fill: "#ef4444" }} />

                  {/* Low price reference line */}
                  <ReferenceLine
                y={lowPrice}
                stroke="#3b82f640"
                strokeDasharray="3 3"
                label={{ value: `Low: $${lowPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, position: "bottomRight", fontSize: 10, fill: "#3b82f6" }} />

                  <Tooltip content={<CustomTooltip />} cursor={<CrosshairCursor />} />
                  <Line
                type="monotone"
                dataKey="price"
                stroke={isPositive ? '#39FF14' : '#ef4444'}
                strokeWidth={2}
                dot={<CustomDot />}
                activeDot={pinnedIndex != null || hoverIndex != null ? { r: 4, fill: '#39FF14', stroke: '#ffffff', strokeWidth: 2 } : false} />

                  {/* Persistent snap (pinned) line + green dot + sticky label */}
                  {pinnedIndex != null && chartData[pinnedIndex] &&
              <>
                      <ReferenceLine x={chartData[pinnedIndex].formattedTime} stroke="rgba(57,255,20,0.35)" />
                      <ReferenceDot
                  x={chartData[pinnedIndex].formattedTime}
                  y={chartData[pinnedIndex].price}
                  r={5}
                  fill="#39FF14"
                  stroke="#ffffff"
                  strokeWidth={2}
                  label={<PinnedDotLabel />} />

                    </>
              }
                </LineChart>
              </ResponsiveContainer> :
          // If we truly have nothing, show a subtle loader (rare)
          <div className="h-full flex items-center justify-center text-center p-4">
                {currentPrice !== null ?
            <div>
                    <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Showing latest price
                    </p>
                    <p className="text-2xl font-bold neon-text">
                      ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div> :

            <Loader2 className="w-6 h-6 animate-spin neon-text" />
            }
              </div>
          }
        </div>
      </CardContent>
    </Card>);

}