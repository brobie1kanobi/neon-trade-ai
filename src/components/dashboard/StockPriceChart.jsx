
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, CartesianGrid, ReferenceDot } from "recharts";
import { TrendingUp, TrendingDown, BarChart3, Loader2 } from "lucide-react";
import { useSettings } from "@/components/utils/SettingsContext";
import { base44 } from "@/api/base44Client"; // Import base44 for consolidated data fetching

export default function StockPriceChart({ symbol = "AAPL" }) {
  const containerRef = useRef(null);
  const [isVisible, setIsVisible] = useState(true);

  const [chartData, setChartData] = useState([]);
  const [timeframe, setTimeframe] = useState("24h");
  const [currentPrice, setCurrentPrice] = useState(null);
  const [priceChange, setPriceChange] = useState(null);
  const [assetName, setAssetName] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const [hoverIndex, setHoverIndex] = useState(null);
  const [pinnedIndex, setPinnedIndex] = useState(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const longPressTimerRef = useRef(null);

  const { settings } = useSettings();
  const hour12 = (settings?.time_format || "12h") !== "24h";

  const timeframes = [
    { label: "24H", value: "24h" },
    { label: "7D", value: "7d" },
    { label: "1M", value: "1m" },
    { label: "3M", value: "3m" },
    { label: "1Y", value: "1y" }
  ];

  const handleMouseMove = (state) => {
    const idx = typeof state?.activeTooltipIndex === "number" ? state.activeTooltipIndex : null;
    setHoverIndex(idx);
    if (isScrubbing && idx != null) setPinnedIndex(idx);
  };
  const handleMouseLeave = () => setHoverIndex(null);
  const handleClick = (state) => {
    const idx = typeof state?.activeTooltipIndex === "number" ? state.activeTooltipIndex : null;
    if (idx == null) return;
    setPinnedIndex((prev) => (prev === idx ? null : idx));
  };
  const handleTouchStart = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      setIsScrubbing(true);
      if (hoverIndex != null) setPinnedIndex(hoverIndex);
    }, 250);
  };
  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsScrubbing(false);
  };
  const handleTouchCancel = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsScrubbing(false);
  };

  const CrosshairCursor = ({ points, height }) => {
    if (!points || !points[0]) return null;
    const x = points[0].x;
    return <line x1={x} y1={0} x2={x} y2={height} stroke="rgba(57,255,20,0.6)" strokeWidth={1} />;
  };

  const { highPoint, lowPoint, highPrice, lowPrice, highTimestamp, lowTimestamp } = useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return { highPoint: null, lowPoint: null, highPrice: 0, lowPrice: 0, highTimestamp: null, lowTimestamp: null };
    }
    let high = chartData[0];
    let low = chartData[0];
    let hiIdx = 0;
    let loIdx = 0;
    chartData.forEach((point, idx) => {
      if (point.price > high.price) { high = point; hiIdx = idx; }
      if (point.price < low.price) { low = point; loIdx = idx; }
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

  const getNiceStep = (range) => {
    const raw = range / 6;
    const power = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-12))));
    const normalized = raw / power;
    let nice;
    if (normalized <= 1) nice = 1;
    else if (normalized <= 2) nice = 2;
    else if (normalized <= 2.5) nice = 2.5;
    else if (normalized <= 5) nice = 5;
    else nice = 10;
    return nice * power;
  };

  const yDomain = useMemo(() => {
    if (!chartData || chartData.length === 0) return ['auto', 'auto'];
    const prices = chartData.map((p) => p.price).filter((v) => typeof v === 'number' && isFinite(v));
    if (prices.length === 0) return ['auto', 'auto'];
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    let range = max - min;
    if (range === 0) {
      const base = max || 1;
      range = base * 0.001;
    }
    const padding = range * 0.1;
    const lower = Math.max(0, min - padding);
    const upper = max + padding;
    return [lower, upper];
  }, [chartData]);

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
      if (ticks.length > 12) break;
      ticks.push(v);
    }
    return ticks;
  }, [yDomain, chartData]);

  const PinnedDotLabel = (props) => {
    const { viewBox } = props || {};
    const cx = (viewBox && (viewBox.cx ?? viewBox.x)) ?? 0;
    const cy = (viewBox && (viewBox.cy ?? viewBox.y)) ?? 0;
    const point = (pinnedIndex != null && chartData[pinnedIndex]) ? chartData[pinnedIndex] : null;
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

    const topPadding = 8;
    const aboveY = cy - (height + 14);
    const tooCloseToTop = aboveY < topPadding;

    let rectX, rectY, textX, textY;
    if (tooCloseToTop) {
      const placeRight = cx < 120;
      rectX = placeRight ? (cx + 10) : (cx - width - 10);
      rectY = cy - height - 4;
      textX = rectX + width / 2;
      textY = rectY + height / 2 + 3;
    } else {
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
      </g>
    );
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => setIsVisible(entries[0].isIntersecting),
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
      try {
        const days = { '24h': 1, '7d': 7, '1m': 30, '3m': 90, '1y': 365 }[timeframe] || 1;

        // Add timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 10000)
        );

        // 1) Latest price
        const quotesPromise = base44.functions.invoke('getMarketData', {
          action: 'getWatchlistData',
          payload: { stockSymbols: [symbol], cryptoSymbols: [] }
        });

        const quotesRes = await Promise.race([quotesPromise, timeoutPromise]);

        const q = Array.isArray(quotesRes?.data) ? quotesRes.data[0] : null;
        if (q && typeof q.price === 'number') {
          setCurrentPrice(q.price);
          // Don't set priceChange here - we'll calculate it from the chart data for the selected timeframe
          setAssetName(q.name || null);
        } else {
          setCurrentPrice(null);
          // Only reset assetName here, priceChange will be handled after chart data fetch
          setAssetName(null);
        }

        // 2) Historical series
        const historyPromise = base44.functions.invoke('getMarketData', {
          action: 'getAssetChartData',
          payload: { symbol, assetType: 'stocks', days }
        });

        const historyRes = await Promise.race([historyPromise, timeoutPromise]);
        
        const series = Array.isArray(historyRes?.data) ? historyRes.data : [];

        if (series.length > 0) {
          const processed = series.map((pt) => ({
            timestamp: new Date(pt.time).toISOString(),
            price: pt.price,
            formattedTime: formatXAxisLabel(new Date(pt.time).toISOString())
          }));
          setChartData(processed);

          // CALCULATE PERCENTAGE CHANGE FOR SELECTED TIMEFRAME
          if (processed.length >= 2) {
            const firstPrice = processed[0].price;
            const lastPrice = processed[processed.length - 1].price;
            
            if (firstPrice > 0) {
              const percentChange = ((lastPrice - firstPrice) / firstPrice) * 100;
              setPriceChange(percentChange);
            } else {
              setPriceChange(null);
            }
          } else {
            setPriceChange(null);
          }
        } else {
          setChartData((prev) => (prev && prev.length > 0 ? prev : []));
          setPriceChange(null); // Ensure priceChange is reset if no chart data
        }
      } catch (error) {
        console.error('[StockPriceChart] Fetch error:', error);
        // Optionally, reset state or show an error message to the user
        setCurrentPrice(null);
        setPriceChange(null);
        setAssetName(null);
        setChartData([]);
      } finally {
        setIsLoading(false);
      }
    };

    setPinnedIndex(null);
    if (isVisible) fetchChartData();
    const interval = isVisible ? setInterval(fetchChartData, 60000) : null;
    return () => interval && clearInterval(interval);
  }, [symbol, timeframe, isVisible, hour12]);

  const isPositive = priceChange !== null && priceChange >= 0;

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
        </div>
      );
    }
    return null;
  };

  const CustomDot = (props) => {
    const { cx, cy, payload } = props;
    const ts = payload?.timestamp;
    const isHigh = highTimestamp && ts === highTimestamp;
    const isLow = lowTimestamp && ts === lowTimestamp;
    if (isHigh) return <circle cx={cx} cy={cy} r={4} fill="#ef4444" stroke="#ffffff" strokeWidth={2} />;
    if (isLow) return <circle cx={cx} cy={cy} r={4} fill="#3b82f6" stroke="#ffffff" strokeWidth={2} />;
    return null;
  };

  return (
    <Card ref={containerRef} style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold leading-none tracking-tight flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <BarChart3 className="w-5 h-5 neon-text" />
            {assetName ? `${symbol} · ${assetName}` : `${symbol}`} Live Price Chart
          </CardTitle>
          <div className="flex gap-1">
            {timeframes.map((tf) => (
              <Button
                key={tf.value}
                variant={timeframe === tf.value ? "default" : "ghost"}
                size="sm"
                onClick={() => setTimeframe(tf.value)}
                className={timeframe === tf.value ? "bg-green-600 text-white neon-glow hover:bg-green-700" : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"}
              >
                {tf.label}
              </Button>
            ))}
          </div>
        </div>

        {currentPrice !== null && (
          <div className="flex items-center gap-4 mt-2">
            <span className="text-2xl font-bold neon-text">
              ${typeof currentPrice === 'number' ? currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
            </span>
            {priceChange !== null && (
              <div className="flex items-center gap-1">
                {isPositive ? <TrendingUp className="w-4 h-4 text-green-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
                <span className={`font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                  {typeof priceChange === 'number' ? `${isPositive ? '+' : ''}${priceChange.toFixed(2)}%` : '0.00%'}
                </span>
                <span className="text-xs text-gray-500 ml-1">
                  {timeframe === '24h' ? '24h' : timeframe === '7d' ? '7d' : timeframe === '1m' ? '1M' : timeframe === '3m' ? '3M' : '1Y'}
                </span>
              </div>
            )}
          </div>
        )}

        {!isLoading && chartData.length > 0 && (
          <div className="flex items-center justify-between mt-2 text-xs">
            <div className="flex items-center gap-1">
              <span style={{ color: 'var(--text-secondary)' }}>High:</span>
              <span className="text-lime-400 font-medium">${highPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center gap-1">
              <span style={{ color: 'var(--text-secondary)' }}>Low:</span>
              <span className="text-red-500 font-medium">${lowPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent>
        <div
          className="bg-slate-100 dark:bg-slate-800 p-4 h-64 rounded-lg border"
          style={{ borderColor: 'var(--border-color)' }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
        >
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin neon-text" />
            </div>
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
              >
                <CartesianGrid stroke="var(--border-color)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="formattedTime"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                />
                <YAxis
                  domain={yDomain}
                  ticks={yTicks}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                  tickFormatter={(v) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 })}`}
                  width={60}
                />
                <ReferenceLine
                  y={highPrice}
                  stroke="#ef444440"
                  strokeDasharray="3 3"
                  label={{ value: `High: $${highPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, position: "topRight", fontSize: 10, fill: "#ef4444" }}
                />
                <ReferenceLine
                  y={lowPrice}
                  stroke="#3b82f640"
                  strokeDasharray="3 3"
                  label={{ value: `Low: $${lowPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, position: "bottomRight", fontSize: 10, fill: "#3b82f6" }}
                />
                <Tooltip content={<CustomTooltip />} cursor={<CrosshairCursor />} />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke={(priceChange ?? 0) >= 0 ? '#39FF14' : '#ef4444'}
                  strokeWidth={2}
                  dot={<CustomDot />}
                  activeDot={(pinnedIndex != null || hoverIndex != null) ? { r: 4, fill: '#39FF14', stroke: '#ffffff', strokeWidth: 2 } : false}
                />
                {pinnedIndex != null && chartData[pinnedIndex] && (
                  <>
                    <ReferenceLine x={chartData[pinnedIndex].formattedTime} stroke="rgba(57,255,20,0.35)" />
                    <ReferenceDot
                      x={chartData[pinnedIndex].formattedTime}
                      y={chartData[pinnedIndex].price}
                      r={5}
                      fill="#39FF14"
                      stroke="#ffffff"
                      strokeWidth={2}
                      label={<PinnedDotLabel />}
                    />
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-center p-4">
              {currentPrice !== null ? (
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Showing latest price
                  </p>
                  <p className="text-2xl font-bold neon-text">
                    ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              ) : (
                <Loader2 className="w-6 h-6 animate-spin neon-text" />
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
