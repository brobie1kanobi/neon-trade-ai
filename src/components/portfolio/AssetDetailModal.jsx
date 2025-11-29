
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ReferenceDot } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import { InvokeLLM } from "@/integrations/Core";
import { getMarketData } from "@/functions/getMarketData";

export default function AssetDetailModal({ asset, isOpen, onClose }) {
  // Existing states
  const [assetInfo, setAssetInfo] = useState(null);
  const [priceDirection, setPriceDirection] = useState('neutral'); // 'up', 'down', 'neutral'
  const prevPriceRef = useRef(null);

  // Added: timeframe, chart and P/L state
  const [timeframe, setTimeframe] = useState("1d"); // '1d' | '7d' | '1m' | '3m' | '1y'
  const [chartData, setChartData] = useState([]);
  const [isLoadingChart, setIsLoadingChart] = useState(false);
  const [periodStartPrice, setPeriodStartPrice] = useState(null);

  // Added: Crosshair + snap behavior (mobile + desktop)
  const [hoverIndex, setHoverIndex] = useState(null);
  const [pinnedIndex, setPinnedIndex] = useState(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const longPressTimerRef = useRef(null);

  const quantity = asset?.quantity || 0;
  // Use assetInfo.current_price if available, otherwise fallback to asset props
  const currentPrice = assetInfo?.current_price ?? asset?.currentPrice ?? asset?.price ?? asset?.average_cost_price ?? 0;
  const assetType = (asset?.asset_type || "crypto").toLowerCase() === "stock" ? "stocks" : "crypto";

  const daysMap = { "1d": 1, "7d": 7, "1m": 30, "3m": 90, "1y": 365 };
  const days = daysMap[timeframe] || 1;

  const fetchAssetData = useCallback(async () => {
    if (!asset) return;

    try {
      const response = await InvokeLLM({
        prompt: `Get detailed information for ${asset.symbol}. Include current price, 24h change, market cap, and name.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            current_price: { type: "number" },
            change_24h: { type: "number" },
            market_cap: { type: "string" },
            name: { type: "string" }
          }
        }
      });

      if (response && response.current_price !== undefined) {
        if (prevPriceRef.current !== null && prevPriceRef.current !== response.current_price) {
          setPriceDirection(response.current_price > prevPriceRef.current ? 'up' : 'down');
          setTimeout(() => setPriceDirection('neutral'), 1500);
        }
        prevPriceRef.current = response.current_price;
      }

      setAssetInfo(response);
    } catch (error) {
      console.error("Failed to fetch asset data:", error);
    }
  }, [asset]);

  useEffect(() => {
    if (asset && isOpen) {
      // Set initial price to avoid false flash on first load
      if (asset.currentPrice) {
        prevPriceRef.current = asset.currentPrice;
      }
      fetchAssetData();
      const interval = setInterval(fetchAssetData, 30000); // Refresh every 30s
      return () => clearInterval(interval); // Cleanup on unmount or close
    }
  }, [asset, isOpen, fetchAssetData]);

  // Fetch chart data for the timeframe and compute start price
  useEffect(() => {
    let mounted = true;
    const loadChart = async () => {
      setIsLoadingChart(true);
      try {
        const { data } = await getMarketData({
          action: "getAssetChartData",
          payload: { symbol: asset?.symbol, assetType, days }
        });
        if (!mounted) return;

        const processed = Array.isArray(data) ? data.map(p => ({
          time: new Date(p.time).toISOString(),
          price: Number(p.price)
        })) : [];

        setChartData(processed);
        if (processed.length > 0) {
          setPeriodStartPrice(processed[0].price);
        } else {
          // Fallback: if no series, approximate start price from current price (flat series)
          setPeriodStartPrice(currentPrice);
        }
      } finally {
        if (mounted) setIsLoadingChart(false);
      }
    };
    if (asset?.symbol && isOpen) {
      loadChart();
    }
    return () => { mounted = false; };
  }, [asset?.symbol, assetType, days, currentPrice, isOpen]);

  // Compute period P/L based on user's quantity and prices
  const periodEndPrice = currentPrice;
  const periodPnL = useCallback(() => {
    if (quantity <= 0 || periodStartPrice == null || periodEndPrice == null) {
      return { value: 0, percent: 0 };
    }
    const diff = periodEndPrice - periodStartPrice;
    const value = quantity * diff;
    const percent = periodStartPrice > 0 ? (diff / periodStartPrice) * 100 : 0;
    return { value, percent };
  }, [quantity, periodStartPrice, periodEndPrice])(); // Immediately invoke useCallback

  // Auto-zoom Y-axis to movement in timeframe
  const yDomain = useCallback(() => {
    const prices = (chartData || []).map(d => d.price).filter(v => typeof v === "number" && isFinite(v));
    if (prices.length === 0) {
      const base = currentPrice || 1;
      return [base * 0.995, base * 1.005]; // tiny band around current
    }
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    let range = max - min;
    if (range === 0) range = (max || 1) * 0.001; // ensure a visible line
    const pad = range * 0.1;
    return [Math.max(0, min - pad), max + pad];
  }, [chartData, currentPrice])(); // Immediately invoke useCallback

  // Create ticks approximately 6 lines
  const yTicks = useCallback(() => {
    const [lower, upper] = yDomain;
    const range = upper - lower;
    if (!isFinite(range) || range <= 0) return [];
    const raw = range / 6;
    const power = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-12))));
    const normalized = raw / power;
    let nice;
    if (normalized <= 1) nice = 1; else if (normalized <= 2) nice = 2; else if (normalized <= 2.5) nice = 2.5; else if (normalized <= 5) nice = 5; else nice = 10;
    const step = nice * power;
    const start = Math.ceil(lower / step) * step;
    const ticks = [];
    for (let v = start; v <= upper && ticks.length < 12; v += step) ticks.push(v);
    return ticks;
  }, [yDomain])(); // Immediately invoke useCallback

  // Crosshair + snap behavior (mobile + desktop)
  const handleMouseMove = useCallback((state) => {
    const idx = typeof state?.activeTooltipIndex === "number" ? state.activeTooltipIndex : null;
    setHoverIndex(idx);
    if (isScrubbing && idx != null) setPinnedIndex(idx);
  }, [isScrubbing]);

  const handleMouseLeave = useCallback(() => setHoverIndex(null), []);

  const handleClick = useCallback((state) => {
    const idx = typeof state?.activeTooltipIndex === "number" ? state.activeTooltipIndex : null;
    if (idx == null) return;
    setPinnedIndex(prev => prev === idx ? null : idx);
  }, []);

  const handleTouchStart = useCallback(() => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      setIsScrubbing(true);
      if (hoverIndex != null) setPinnedIndex(hoverIndex);
    }, 250);
  }, [hoverIndex]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsScrubbing(false);
  }, []);

  const CrosshairCursor = ({ points, height }) => {
    if (!points || !points[0]) return null;
    const x = points[0].x;
    return <line x1={x} y1={0} x2={x} y2={height} stroke="rgba(57,255,20,0.6)" strokeWidth={1} />;
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const price = payload[0]?.value;
      return (
        <div className="bg-gray-900 text-white p-2 rounded-md text-xs">
          <div>{new Date(label).toLocaleString()}</div>
          <div className="font-semibold text-lime-400">${Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</div>
        </div>
      );
    }
    return null;
  };

  const tfButtons = [
    { label: "1D", value: "1d" },
    { label: "7D", value: "7d" },
    { label: "1M", value: "1m" },
    { label: "3M", value: "3m" },
    { label: "1Y", value: "1y" }
  ];

  if (!asset) return null;

  const isPositive = assetInfo?.change_24h >= 0;
  const directionClass = priceDirection === 'up' ? 'text-green-500' : priceDirection === 'down' ? 'text-red-500' : '';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl h-[80vh]" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--text-primary)' }}>
            {asset.symbol} - {assetInfo?.name || asset.symbol}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {/* Asset Summary */}
          <Card style={{ backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Current Price</p>
                  <p className={`text-lg font-bold transition-colors duration-500 ${directionClass}`} style={{ color: directionClass ? '' : 'var(--text-primary)' }}>
                    ${currentPrice?.toFixed(2) || '---'}
                  </p>
                </div>
                <div>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>24h Change</p>
                  <div className="flex items-center gap-1">
                    {isPositive ? (
                      <TrendingUp className="w-4 h-4 text-green-500" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-500" />
                    )}
                    <span className={`font-bold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                      {assetInfo?.change_24h ? `${isPositive ? '+' : ''}${assetInfo.change_24h.toFixed(2)}%` : '---'}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Your Holdings</p>
                  <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                    {quantity?.toFixed(4) || '0'} {asset.symbol}
                  </p>
                </div>
                <div>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Portfolio Value</p>
                  <p className="font-bold neon-text">
                    ${(quantity * currentPrice)?.toFixed(2) || '0.00'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* New Chart Section */}
          <Card style={{ backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}>
            <CardContent className="p-4">
              {/* Timeframe selector */}
              <div className="flex gap-1 mb-3 overflow-x-auto">
                {tfButtons.map(tf =>
                  <Button
                    key={tf.value}
                    variant={timeframe === tf.value ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setTimeframe(tf.value)}
                    className={`shrink-0 ${timeframe === tf.value ? "bg-green-600 text-white neon-glow hover:bg-green-700" : "text-gray-600 dark:text-gray-400 hover:bg-gray-800"}`}>
                    {tf.label}
                  </Button>
                )}
              </div>

              {/* User's actual period P/L */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="p-3 rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Period P/L</div>
                  <div className={`font-semibold ${periodPnL.value >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {periodPnL.value >= 0 ? '+' : ''}${periodPnL.value.toFixed(2)}
                  </div>
                  <div className={`text-xs ${periodPnL.percent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {periodPnL.percent >= 0 ? '+' : ''}{periodPnL.percent.toFixed(2)}%
                  </div>
                </div>
                <div className="p-3 rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Current Price</div>
                  <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    ${Number(currentPrice).toFixed(2)}
                  </div>
                </div>
                <div className="p-3 rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Quantity</div>
                  <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {Number(quantity).toFixed(6)}
                  </div>
                </div>
                <div className="p-3 rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Current Value</div>
                  <div className="font-semibold neon-text">
                    ${Number(quantity * currentPrice).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Auto-zoomed chart with crosshair, hover and snap */}
              <div
                className="bg-slate-100 dark:bg-slate-800 p-4 h-56 sm:h-64 rounded-lg border"
                style={{ borderColor: 'var(--border-color)' }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
              >
                {isLoadingChart ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-lime-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chartData}
                      onMouseMove={handleMouseMove}
                      onMouseLeave={handleMouseLeave}
                      onClick={handleClick}
                    >
                      <CartesianGrid stroke="var(--border-color)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                        tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, days <= 2 ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' })}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={yDomain}
                        ticks={yTicks}
                        tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                        tickFormatter={(v) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 })}`}
                        axisLine={false}
                        tickLine={false}
                        width={60}
                      />
                      {periodStartPrice != null && (
                        <ReferenceLine
                          y={periodStartPrice}
                          stroke="#94a3b8"
                          strokeDasharray="3 3"
                          label={{ value: `Start: $${Number(periodStartPrice).toFixed(2)}`, position: "topRight", fontSize: 10, fill: "#94a3b8" }}
                        />
                      )}
                      <Tooltip content={<CustomTooltip />} cursor={<CrosshairCursor />} />
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke={periodPnL.value >= 0 ? '#39FF14' : '#ef4444'}
                        strokeWidth={2}
                        dot={false}
                        activeDot={(pinnedIndex != null || hoverIndex != null) ? { r: 4, fill: '#39FF14', stroke: '#ffffff', strokeWidth: 2 } : false}
                      />
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
                          />
                        </>
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
