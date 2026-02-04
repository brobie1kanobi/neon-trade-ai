import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle } from
"@/components/ui/dialog";
import {
  History,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Target,
  X,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Loader2,
  Info } from
"lucide-react";
import { format } from "date-fns";
import { useSettings } from "@/components/utils/SettingsContext";
import { ConditionalOrder, Trade } from "@/entities/all";
import { base44 } from "@/api/base44Client";
import TradeDetailsModal from "../dashboard/TradeDetailsModal";
import { notify } from "@/components/utils/notifications";
import OrderSyncButton from "./OrderSyncButton";
import { useKrakenWebSocket } from "@/components/providers/KrakenWebSocketProvider";

// Format date in user's timezone
const formatInTimezone = (date, timezone, is24h) => {
  try {
    // Ensure we have a valid timezone
    const tz = timezone && timezone.length > 0 ? timezone : 'America/New_York';
    
    // CRITICAL: Ensure date string is treated as UTC if missing timezone offset
    let dateObj;
    if (typeof date === 'string' && date.includes('T') && !date.endsWith('Z') && !date.match(/[+-]\d{2}:?\d{2}$/)) {
      dateObj = new Date(date + 'Z');
    } else {
      dateObj = new Date(date);
    }

    const options = {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      hour: is24h ? '2-digit' : 'numeric',
      minute: '2-digit',
      hour12: !is24h
    };
    const result = dateObj.toLocaleString('en-US', options);
    // console.log('[OrdersAndHistory] formatInTimezone:', date, '->', dateObj.toISOString(), 'tz:', tz, 'result:', result);
    return result;
  } catch (e) {
    console.error('[OrdersAndHistory] formatInTimezone error:', e);
    const d = new Date(date);
    return is24h 
      ? format(d, "MMM d, HH:mm") 
      : format(d, "MMM d, h:mm a");
  }
};

// Format full date in user's timezone
const formatFullInTimezone = (date, timezone, is24h) => {
  try {
    const tz = timezone && timezone.length > 0 ? timezone : 'America/New_York';
    
    // CRITICAL: Ensure date string is treated as UTC if missing timezone offset
    let dateObj;
    if (typeof date === 'string' && date.includes('T') && !date.endsWith('Z') && !date.match(/[+-]\d{2}:?\d{2}$/)) {
      dateObj = new Date(date + 'Z');
    } else {
      dateObj = new Date(date);
    }

    const options = {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: is24h ? '2-digit' : 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: !is24h
    };
    return dateObj.toLocaleString('en-US', options);
  } catch (e) {
    // Fallback if timezone is invalid
    const d = new Date(date);
    return is24h 
      ? format(d, "MMM d, yyyy HH:mm:ss") 
      : format(d, "MMM d, yyyy h:mm:ss a");
  }
};

// Normalize Kraken symbol - remove X/Z prefixes and suffixes
const normalizeKrakenSymbol = (symbol) => {
  if (!symbol) return 'UNKNOWN';
  let s = symbol.toUpperCase();
  // Remove USD suffixes
  s = s.replace(/USD$/, '').replace(/ZUSD$/, '').replace(/\/USD$/, '');
  // Handle XBT -> BTC variations
  s = s.replace(/^XXBT$/, 'BTC').replace(/^XBT$/, 'BTC').replace(/^XBTC$/, 'BTC').replace(/^XBTCZ$/, 'BTC').replace(/^XBTZ$/, 'BTC');
  // Handle other common Kraken prefixes
  s = s.replace(/^XXRP$/, 'XRP').replace(/^XXRPZ$/, 'XRP').replace(/^XRPZ$/, 'XRP');
  s = s.replace(/^XETH$/, 'ETH').replace(/^XETHZ$/, 'ETH').replace(/^ETHZ$/, 'ETH');
  s = s.replace(/^XXDG$/, 'DOGE').replace(/^XDOGEZ$/, 'DOGE');
  s = s.replace(/^XLTC$/, 'LTC').replace(/^XLTCZ$/, 'LTC').replace(/^LTCZ$/, 'LTC');
  s = s.replace(/^XXLM$/, 'XLM').replace(/^XLMZ$/, 'XLM');
  s = s.replace(/^XSOL$/, 'SOL').replace(/^SOLZ$/, 'SOL');
  s = s.replace(/^XADA$/, 'ADA').replace(/^ADAZ$/, 'ADA');
  // Generic: remove leading X if symbol is longer than 3 chars and starts with X followed by uppercase
  if (s.length > 3 && s.startsWith('X') && /^X[A-Z]/.test(s)) {
    s = s.substring(1);
  }
  // Generic: remove trailing Z if symbol is longer than 3 chars
  if (s.length > 3 && s.endsWith('Z')) {
    s = s.slice(0, -1);
  }
  return s;
};

export default function OrdersAndHistory({ trades = [], isSimMode = true, onRefresh }) {
  const [activeTab, setActiveTab] = useState("conditional");
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [conditionalOrders, setConditionalOrders] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [closedOrders, setClosedOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [selectedClosedOrder, setSelectedClosedOrder] = useState(null);

  // Merge lists without wiping UI — prepend new items, update existing in place
  const mergeLists = useCallback((prev, next) => {
    const prevMap = new Map(prev.map(o => [o.id, o]));
    const nextMap = new Map(next.map(o => [o.id, o]));
    const newItems = next
      .filter(o => !prevMap.has(o.id))
      .sort((a, b) => new Date(b.created_date || b.updated_date || 0) - new Date(a.created_date || a.updated_date || 0));
    const updatedExisting = prev
      .filter(o => nextMap.has(o.id))
      .map(o => ({ ...o, ...nextMap.get(o.id) }));
    return [...newItems, ...updatedExisting];
  }, []);

  const { settings, user, isLoading: settingsLoading } = useSettings();
  const is24h = (settings?.time_format || "12h") === "24h";
  // CRITICAL: Only use timezone after settings have loaded to avoid showing UTC times
  const timezone = (!settingsLoading && settings?.timezone) ? settings.timezone : 'America/New_York';
  
  console.log('[OrdersAndHistory] Settings loaded:', !settingsLoading, 'timezone:', timezone, 'raw:', settings?.timezone);

  // CRITICAL: Use CENTRALIZED WebSocket provider - prevents rate limits
  const { 
    orders: wsKrakenOrders, 
    isConnected: wsConnected,
    // Use centralized REST data instead of direct API calls
    krakenOrders: providerKrakenOrders,
    fetchKrakenData: fetchFromProvider,
    restDataLoading,
    lastRestFetchTime
  } = useKrakenWebSocket();

  // State for Kraken trades history (still fetched separately as it's less frequent)
  const [krakenTradesHistory, setKrakenTradesHistory] = useState([]);
  const [lastRefreshAt, setLastRefreshAt] = useState(0);
  const [lastTradesFetch, setLastTradesFetch] = useState(0);

  // Use provider orders as the source of truth
  const krakenOrders = wsKrakenOrders || {};

  // Fetch trades history separately (less frequent, not part of main data loop)
  const fetchTradesHistory = useCallback(async () => {
    if (isSimMode) return [];
    
    const now = Date.now();
    // CRITICAL: Only fetch trades every 120 seconds to avoid rate limits (was 90s)
    if (now - lastTradesFetch < 120000) {
      console.log('[OrdersAndHistory] Skipping trades fetch - too soon (', Math.round((now - lastTradesFetch) / 1000), 's ago)');
      return krakenTradesHistory;
    }
    
    try {
      console.log('[OrdersAndHistory] Fetching trades history...');
      const tradesResponse = await base44.functions.invoke('krakenApi', { action: 'getTradesHistory' });
      const tradesData = tradesResponse?.data || tradesResponse;
      
      if (tradesData?.trades) {
        setKrakenTradesHistory(tradesData.trades);
        setLastTradesFetch(now);
        return tradesData.trades;
      }
      return [];
    } catch (err) {
      console.error('[OrdersAndHistory] Trades fetch error:', err.message);
      // On rate limit, don't try again immediately
      if (err.message?.toLowerCase().includes('rate limit')) {
        setLastTradesFetch(now); // Prevent immediate retry
      }
      return krakenTradesHistory; // Return cached data
    }
  }, [isSimMode, lastTradesFetch, krakenTradesHistory]);

  // CRITICAL: Use provider data instead of making direct API calls
  const fetchKrakenData = useCallback(async () => {
    if (isSimMode) return { orders: [], trades: [] };
    
    // CRITICAL: Don't trigger provider fetch here - it handles its own timing
    // Just return whatever data the provider has cached
    // This prevents components from overwhelming the rate limit
    
    // Only fetch trades if enough time has passed (fetchTradesHistory has its own throttle)
    const trades = await fetchTradesHistory();
    
    return {
      orders: providerKrakenOrders || [],
      trades: trades
    };
  }, [isSimMode, fetchTradesHistory, providerKrakenOrders]);

  // Load conditional orders - CRITICAL: Filter by simulation mode and merge with Kraken data
  const loadOrders = useCallback(async () => {
    if (!user?.email) {
      setIsLoading(false);
      return;
    }

    console.log('[OrdersAndHistory] Starting loadOrders - isSimMode:', isSimMode);
    setIsLoading(true);
    
    try {
      // CRITICAL: In LIVE mode, always fetch fresh from Kraken API
      let krakenOpenOrders = [];
      let krakenTrades = [];

      if (!isSimMode) {
        console.log('[OrdersAndHistory] LIVE MODE - Fetching Kraken data...');
        
        try {
          const krakenData = await fetchKrakenData();
          krakenOpenOrders = krakenData.orders || [];
          krakenTrades = krakenData.trades || [];
          console.log('[OrdersAndHistory] ✅ Kraken fetch complete - Orders:', krakenOpenOrders.length, 'Trades:', krakenTrades.length);
          setKrakenTradesHistory(krakenTrades);
          
          // If no orders from API but WebSocket has them, log warning
          if (krakenOpenOrders.length === 0 && wsConnected && krakenOrders && Object.keys(krakenOrders).length > 0) {
            console.warn('[OrdersAndHistory] ⚠️ API returned 0 orders but WebSocket has', Object.keys(krakenOrders).length, '- will use WebSocket');
          }
        } catch (fetchError) {
          console.error('[OrdersAndHistory] ❌ Kraken fetch error:', fetchError);
          // Continue with empty arrays - will use WebSocket or local DB
          krakenOpenOrders = [];
          krakenTrades = [];
        }
      }

      // Load ALL local database orders (not just active ones)
      const allOrders = await ConditionalOrder.filter(
        { created_by: user.email },
        "-updated_date",
        200
      );

      console.log('[OrdersAndHistory] Loaded', allOrders.length, 'total orders from database');

      // Filter orders based on simulation mode
      const modeFilteredOrders = allOrders.filter((o) => {
        if (typeof o.is_simulation === 'boolean') {
          return o.is_simulation === isSimMode;
        }
        return isSimMode;
      });

      console.log('[OrdersAndHistory] Mode filtered orders:', modeFilteredOrders.length, 'for isSimMode:', isSimMode);

      // CRITICAL: In LIVE mode, use Kraken API data (source of truth)
      let activeOrders = modeFilteredOrders.filter((o) => o.status === "active");
      
      console.log('[OrdersAndHistory] Processing orders - isSimMode:', isSimMode, 'Kraken API:', krakenOpenOrders.length, 'WebSocket:', Object.keys(krakenOrders || {}).length, 'Local DB:', activeOrders.length);
      
      if (!isSimMode) {
        console.log('[OrdersAndHistory] 🟢 LIVE MODE - Processing Kraken orders...');
        if (krakenOpenOrders.length > 0) {
          console.log('[OrdersAndHistory] Converting', krakenOpenOrders.length, 'Kraken API orders...');
        }
        
        // Convert Kraken orders to our format
        const krakenOrdersList = krakenOpenOrders
          .map(ko => {
            // Parse Kraken order format
            const descr = ko.descr || {};
            const symbol = normalizeKrakenSymbol(descr.pair || ko.symbol || ko.pair || '');
            const volume = parseFloat(ko.vol) || parseFloat(ko.volume) || 0;
            const price = parseFloat(descr.price) || parseFloat(ko.price) || parseFloat(ko.limit_price) || 0;
            const orderType = (descr.ordertype || ko.order_type || ko.ordertype || 'unknown').toLowerCase();
            const side = (descr.type || ko.side || 'unknown').toLowerCase();
            
            return {
              id: ko.order_id || ko.txid,
              symbol: symbol,
              quantity: volume,
              purchase_price: price,
              status: 'active',
              asset_type: 'crypto',
              is_simulation: false,
              kraken_order_id: ko.order_id || ko.txid,
              created_date: ko.opentm ? new Date(ko.opentm * 1000).toISOString() : new Date().toISOString(),
              order_type: orderType,
              side: side,
              gain_margin: 10,
              loss_margin: 5,
              trailing_enabled: orderType.includes('trailing'),
              // Extra Kraken info
              kraken_description: descr.order || `${side} ${volume} ${symbol} @ ${orderType} ${price}`,
              trigger_price: parseFloat(descr.price) || 0,
              group_id: ko.group_id,
              group_type: ko.group_type
            };
          })
          .filter(o => o.quantity > 0.00000001); // Filter after mapping to ensure parsed volume is used

        // CRITICAL: Always set activeOrders from Kraken in LIVE mode, even if empty
        // This ensures Orders & History shows accurate state (no orders = empty list)
        activeOrders = krakenOrdersList;
        console.log('[OrdersAndHistory] ✅ Set active orders from Kraken API:', activeOrders.length);
        setLastRefreshAt(Date.now());
        
        // Clean up invalid local orders
        const invalidLocalOrders = modeFilteredOrders.filter(o => 
          o.status === 'active' && 
          o.is_simulation === false &&
          (o.quantity <= 0.00001 || o.purchase_price <= 0)
        );
        
        if (invalidLocalOrders.length > 0) {
          console.log('[OrdersAndHistory] Cleaning up', invalidLocalOrders.length, 'invalid local orders');
          Promise.all(invalidLocalOrders.map(o => 
            ConditionalOrder.update(o.id, { 
              status: 'cancelled',
              closure_reason: 'Invalid order: zero quantity or price',
              error_message: 'Order validation failed - quantity or price was zero'
            })
          )).catch(err => console.error('[OrdersAndHistory] Cleanup error:', err));
        }
      } else if (!isSimMode && krakenOpenOrders.length === 0 && wsConnected && krakenOrders && Object.keys(krakenOrders).length > 0) {
        // CRITICAL: API returned 0 but WebSocket has orders - use WebSocket as backup
        console.log('[OrdersAndHistory] ⚠️ API returned 0 orders, using WebSocket backup:', Object.keys(krakenOrders).length);
        const krakenOrdersList = Object.values(krakenOrders)
          .map(ko => {
             const descr = ko.descr || {};
             const orderType = descr.ordertype || ko.order_type || ko.ordertype || 'unknown';
             const side = descr.type || ko.side || 'unknown';
             const volume = parseFloat(ko.vol) || parseFloat(ko.volume) || 0;
             const price = parseFloat(descr.price) || parseFloat(ko.price) || parseFloat(ko.limit_price) || 0;
             const symbol = normalizeKrakenSymbol(descr.pair || ko.symbol || ko.pair || '');
             
             return {
               id: ko.order_id || ko.txid,
               symbol: symbol,
               quantity: volume,
               purchase_price: price,
               status: 'active',
               asset_type: 'crypto',
               is_simulation: false,
               kraken_order_id: ko.order_id || ko.txid,
               created_date: ko.opentm ? new Date(ko.opentm * 1000).toISOString() : (ko.created_at || new Date().toISOString()),
               order_type: orderType,
               side: side,
               gain_margin: 10,
               loss_margin: 5,
               trailing_enabled: orderType.includes('trailing'),
               kraken_description: descr.order || `${side} ${volume} ${symbol} @ ${orderType} ${price}`,
               trigger_price: parseFloat(descr.price) || 0
             };
          })
          .filter(ko => ko.quantity > 0.00000001); // Use lower threshold and filter AFTER mapping to ensure volume is parsed
          
        activeOrders = krakenOrdersList;
        console.log('[OrdersAndHistory] ✅ Set active orders from WebSocket backup:', activeOrders.length);
        setLastRefreshAt(Date.now());
      } else if (!isSimMode && krakenOpenOrders.length === 0 && (!wsConnected || !krakenOrders || Object.keys(krakenOrders).length === 0)) {
        // CRITICAL: No orders from API OR WebSocket - set empty array
        console.log('[OrdersAndHistory] ⚠️ No orders from Kraken API or WebSocket - setting empty list');
        activeOrders = [];
      }

      // CRITICAL: Include ALL non-active orders in closed list
      // But EXCLUDE any local records whose Kraken order ID is still open on Kraken (prevents false "Cancelled")
      const openOrderIdSet = new Set(
        (activeOrders || [])
          .flatMap(o => (o.kraken_order_id || '').split(',').map(id => id.trim()))
          .filter(Boolean)
      );
      const isStillOpenOnKraken = (o) => {
        if (!o?.kraken_order_id) return false;
        return o.kraken_order_id.split(',').some(id => openOrderIdSet.has(id.trim()));
      };

      const executed = modeFilteredOrders
        .filter((o) => o.status === "executed")
        .filter(o => !isStillOpenOnKraken(o));

      const cancelled = modeFilteredOrders
        .filter((o) => o.status === "cancelled")
        .filter(o => !isStillOpenOnKraken(o));

      const failed = modeFilteredOrders
        .filter((o) => o.status === "failed")
        .filter(o => !isStillOpenOnKraken(o));

      // In Live mode, include ALL orders with errors (even if locally 'active') because activeOrders comes from Kraken
      // In Sim mode, avoid duplicates by excluding active orders; also exclude those still open on Kraken
      const withErrors = modeFilteredOrders
        .filter((o) => !!o.error_message && (o.status !== "active" || !isSimMode))
        .filter(o => !isStillOpenOnKraken(o));

      // EXTRA: If API failed (e.g., permissions), fall back to local active orders so UI isn't empty
      if (!isSimMode && (krakenOpenOrders.length === 0) && (activeOrders.length === 0)) {
        activeOrders = modeFilteredOrders.filter((o) => o.status === "active" && o.is_simulation === false);
        console.warn('[OrdersAndHistory] Fallback to local active orders:', activeOrders.length);
      }

      console.log('[OrdersAndHistory] Order breakdown - executed:', executed.length, 'cancelled:', cancelled.length, 'failed:', failed.length, 'withErrors:', withErrors.length);

      // If a local record says cancelled but the same kraken_order_id is open on Kraken, auto-correct it in UI
      const locallyCancelledButOpen = modeFilteredOrders.filter(o => o.status === 'cancelled' && isStillOpenOnKraken(o));
      if (locallyCancelledButOpen.length > 0) {
        console.log('[OrdersAndHistory] Correcting locally-cancelled orders that are still OPEN on Kraken:', locallyCancelledButOpen.map(o => o.id));
      }

      // CRITICAL: Separate conditional orders from regular open orders
      // Conditional = stop-loss, take-profit, trailing-stop orders
      // Open = limit, market orders
      // NOTE: Also verify if order.order_type exists, fallback to other properties
      const conditionalOrdersList = activeOrders.filter(order => {
        const orderType = (order.order_type || order.ordertype || '').toLowerCase();
        const description = (order.kraken_description || '').toLowerCase();
        return orderType.includes('stop') || orderType.includes('take-profit') || orderType.includes('take profit') || orderType.includes('trigger') || orderType.includes('conditional') || orderType.includes('oco') || orderType.includes('oco trigger') || orderType.includes('trailing') ||
               description.includes('stop') || description.includes('take profit') || description.includes('trailing') || description.includes('oco');
      });
      
      const openOrdersList = activeOrders.filter(order => {
        const orderType = (order.order_type || order.ordertype || '').toLowerCase();
        const description = (order.kraken_description || '').toLowerCase();
        return (!orderType.includes('stop') && !orderType.includes('take-profit') && !orderType.includes('take profit') && !orderType.includes('trailing') && !orderType.includes('oco') && !orderType.includes('conditional') && !orderType.includes('trigger')) &&
               (!description.includes('stop') && !description.includes('take profit') && !description.includes('trailing') && !description.includes('oco'));
      });
      
      console.log('[OrdersAndHistory] ✅ Split orders - Conditional:', conditionalOrdersList.length, 'Open:', openOrdersList.length, 'Total active:', activeOrders.length);

      setConditionalOrders(prev => mergeLists(prev, conditionalOrdersList));
      setOpenOrders(prev => mergeLists(prev, openOrdersList));

      // Combine all closed orders - executed, cancelled, failed, and orders with errors
      // Use a Map to avoid duplicates (keyed by order ID)
      const closedOrdersMap = new Map();
      [...executed, ...cancelled, ...failed, ...withErrors].forEach(order => {
        closedOrdersMap.set(order.id, order);
      });

      const uniqueClosedOrders = Array.from(closedOrdersMap.values());

      console.log('[OrdersAndHistory] Total unique closed orders:', uniqueClosedOrders.length);

      // Sort by date (most recent first) and merge so UI doesn't jump
      const sortedClosed = uniqueClosedOrders.sort((a, b) =>
        new Date(b.updated_date || b.created_date).getTime() - new Date(a.updated_date || a.created_date).getTime()
      );
      setClosedOrders(prev => mergeLists(prev, sortedClosed));

    } catch (err) {
      console.error("[OrdersAndHistory] Failed to load orders:", err);
      notify.warning('Orders refresh failed', {
        description: err.message || 'Unknown error'
      });
      // CRITICAL: Still set empty arrays on error so UI doesn't stay stuck
      setConditionalOrders([]);
      setOpenOrders([]);
      setClosedOrders([]);
    } finally {
      setIsLoading(false); // no UI spinner rendered; used only to disable the manual refresh button
      console.log('[OrdersAndHistory] Finished loadOrders');
    }
  }, [user?.email, isSimMode, wsConnected, krakenOrders, fetchKrakenData]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // CRITICAL: Auto-refresh removed - provider handles periodic refresh
  // This prevents duplicate API calls and rate limit issues

  // CRITICAL: Update orders from provider data (centralized) - no direct API calls
  useEffect(() => {
    if (!isSimMode && providerKrakenOrders && providerKrakenOrders.length > 0) {
      console.log('[OrdersAndHistory] Provider orders updated:', providerKrakenOrders.length);
      
      const list = providerKrakenOrders
        .map(ko => {
          const descr = ko.descr || {};
          const orderType = descr.ordertype || ko.order_type || ko.ordertype || 'unknown';
          const side = descr.type || ko.side || 'unknown';
          const volume = parseFloat(ko.vol) || parseFloat(ko.volume) || 0;
          const price = parseFloat(descr.price) || parseFloat(ko.price) || parseFloat(ko.limit_price) || 0;
          const symbol = normalizeKrakenSymbol(descr.pair || ko.symbol || ko.pair || '');
          return {
            id: ko.order_id || ko.txid,
            symbol,
            quantity: volume,
            purchase_price: price,
            status: 'active',
            asset_type: 'crypto',
            is_simulation: false,
            kraken_order_id: ko.order_id || ko.txid,
            created_date: ko.opentm ? new Date(ko.opentm * 1000).toISOString() : (ko.created_at || new Date().toISOString()),
            order_type: orderType,
            side,
            gain_margin: 10,
            loss_margin: 5,
            trailing_enabled: String(orderType).toLowerCase().includes('trailing'),
            kraken_description: descr.order || `${side} ${volume} ${symbol} @ ${orderType} ${price}`,
            trigger_price: parseFloat(descr.price) || 0
          };
        })
        .filter(o => o.quantity > 0.00000001);

      const conditionalList = list.filter(order => {
        const ot = (order.order_type || '').toLowerCase();
        const desc = (order.kraken_description || '').toLowerCase();
        return ot.includes('stop') || ot.includes('take-profit') || ot.includes('take profit') || ot.includes('trailing') || ot.includes('oco') || ot.includes('conditional') || ot.includes('trigger') ||
               desc.includes('stop') || desc.includes('take profit') || desc.includes('trailing') || desc.includes('oco');
      });

      const openList = list.filter(order => {
        const ot = (order.order_type || '').toLowerCase();
        const desc = (order.kraken_description || '').toLowerCase();
        return (!ot.includes('stop') && !ot.includes('take-profit') && !ot.includes('take profit') && !ot.includes('trailing') && !ot.includes('oco') && !ot.includes('conditional') && !ot.includes('trigger')) &&
               (!desc.includes('stop') && !desc.includes('take profit') && !desc.includes('trailing') && !desc.includes('oco'));
      });

      setConditionalOrders(prev => mergeLists(prev, conditionalList));
      setOpenOrders(prev => mergeLists(prev, openList));
      setLastRefreshAt(Date.now());
    }
  }, [providerKrakenOrders, isSimMode, mergeLists]);

  // CRITICAL: Removed auto-refresh on tab switch to prevent rate limits
  // Provider already keeps data updated, no need to spam refresh

  // Listen for trade events (failed or completed) to refresh list immediately
  useEffect(() => {
    const handleRefresh = () => {
      console.log('[OrdersAndHistory] Trade event received, refreshing...');
      loadOrders();
    };
    window.addEventListener('trade:failed', handleRefresh);
    window.addEventListener('trade:completed', handleRefresh);
    return () => {
      window.removeEventListener('trade:failed', handleRefresh);
      window.removeEventListener('trade:completed', handleRefresh);
    };
  }, [loadOrders]);

  // Dismiss a failed order from the list (delete from database)
  const handleDismissFailedOrder = async (orderId) => {
    try {
      // Optimistically remove from UI immediately without triggering full reload spinner
      setClosedOrders(prev => prev.filter(o => o.id !== orderId));
      
      await ConditionalOrder.delete(orderId);
      notify.success("Failed order dismissed");
      
      // Notify parent to refresh balances/etc but don't force local loading spinner
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Failed to dismiss order:", err);
      notify.error("Failed to dismiss order");
      loadOrders(); // Sync on error
    }
  };

  // Cancel an order - also cancels associated Kraken orders in LIVE mode
  const handleCancelOrder = async (orderId) => {
    setCancellingOrderId(orderId);
    try {
      // Find the order to check for Kraken order IDs
      const order = conditionalOrders.find(o => o.id === orderId) || openOrders.find(o => o.id === orderId);
      
      // If in LIVE mode and has Kraken order IDs, cancel them on Kraken first
      if (!isSimMode && order?.kraken_order_id) {
        const krakenOrderIds = order.kraken_order_id.split(',').filter(id => id.trim());
        
        if (krakenOrderIds.length > 0) {
          try {
            console.log('[OrdersAndHistory] Cancelling Kraken orders:', krakenOrderIds);
            const cancelResponse = await base44.functions.invoke('krakenTrade', {
              action: 'cancel_order',
              orderIds: krakenOrderIds
            });
            
            const cancelData = cancelResponse?.data || cancelResponse;
            if (cancelData?.success) {
              console.log('[OrdersAndHistory] ✅ Kraken orders cancelled:', cancelData.order_ids);
              notify.success("Kraken orders cancelled", {
                description: `Cancelled ${cancelData.cancelled_count || krakenOrderIds.length} order(s) on Kraken`
              });
            } else {
              console.warn('[OrdersAndHistory] Kraken cancel response:', cancelData);
              // Don't block local cancellation if Kraken fails
              notify.warning("Kraken cancel may have failed", {
                description: cancelData?.error || "Orders may still be active on Kraken"
              });
            }
          } catch (krakenError) {
            console.error('[OrdersAndHistory] Kraken cancel error:', krakenError);
            // Don't block local cancellation - user can manually check Kraken
            notify.warning("Could not cancel on Kraken", {
              description: "Please verify orders are cancelled on Kraken directly"
            });
          }
        }
      }
      
      // Update local order status
      await ConditionalOrder.update(orderId, { 
        status: "cancelled",
        closure_reason: !isSimMode && order?.kraken_order_id 
          ? `Manually cancelled. Kraken order IDs: ${order.kraken_order_id}`
          : "Manually cancelled by user"
      });
      
      notify.success("Order cancelled");
      loadOrders();
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Failed to cancel order:", err);
      notify.error("Failed to cancel order");
    } finally {
      setCancellingOrderId(null);
    }
  };

  const formatDisplayQuantity = (quantity) => {
    if (!quantity) return "0";
    if (quantity > 0 && quantity < 0.001) return "< 0.001";
    return parseFloat(quantity.toFixed(4));
  };

  const formatPrice = (price) => {
    if (!price) return "$0.00";
    if (price >= 1000) return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (price >= 1) return `$${price.toFixed(2)}`;
    return `$${price.toFixed(6)}`;
  };

  // Filter trades by simulation mode - merge with Kraken trades in LIVE mode
  const filteredTrades = React.useMemo(() => {
    const localTrades = trades.filter((t) => t.is_simulation === isSimMode);
    
    // In LIVE mode, merge with Kraken trades history
    if (!isSimMode && krakenTradesHistory.length > 0) {
      // Convert Kraken trades to our format
      const krakenTradesList = krakenTradesHistory.map(kt => {
        const symbol = normalizeKrakenSymbol(kt.pair || '');
        return {
          id: kt.trade_id || kt.ordertxid || `kraken-${kt.time}`,
          symbol: symbol,
          type: kt.type || 'unknown',
          quantity: parseFloat(kt.vol) || 0,
          price: parseFloat(kt.price) || 0,
          total_value: parseFloat(kt.cost) || 0,
          created_date: kt.time ? new Date(kt.time * 1000).toISOString() : new Date().toISOString(),
          is_simulation: false,
          is_auto_trade: false,
          asset_type: 'crypto',
          status: 'executed',
          // Kraken-specific
          fee: parseFloat(kt.fee) || 0,
          order_type: kt.ordertype,
          kraken_trade_id: kt.trade_id
        };
      });
      
      // Merge and dedupe by checking if local trade matches Kraken trade (within time window)
      const mergedTrades = [...localTrades];
      krakenTradesList.forEach(kt => {
        const isDupe = localTrades.some(lt => 
          lt.symbol === kt.symbol && 
          Math.abs(lt.quantity - kt.quantity) < 0.0001 &&
          Math.abs(new Date(lt.created_date).getTime() - new Date(kt.created_date).getTime()) < 60000
        );
        if (!isDupe) {
          mergedTrades.push(kt);
        }
      });
      
      // Sort by date descending
      return mergedTrades.sort((a, b) => 
        new Date(b.created_date).getTime() - new Date(a.created_date).getTime()
      );
    }
    
    return localTrades;
  }, [trades, isSimMode, krakenTradesHistory]);
  
  const buyTrades = filteredTrades.filter((t) => t.type === "buy");
  const sellTrades = filteredTrades.filter((t) => t.type === "sell");

  // Tab counts
  const openCount = openOrders.length;
  const conditionalCount = conditionalOrders.length;
  const closedCount = closedOrders.length;
  const tradesCount = filteredTrades.length;

  return (
    <>
      <TradeDetailsModal
        trade={selectedTrade}
        isOpen={!!selectedTrade}
        onClose={() => setSelectedTrade(null)} />
      
      
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <History className="w-5 h-5 neon-text" />
              Orders & History
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {loadOrders();if (onRefresh) onRefresh();}}
              disabled={isLoading}>
              
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="pt-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full grid grid-cols-4 mb-4 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
              <TabsTrigger
                value="trades"
                className="text-[10px] sm:text-xs px-1 sm:px-2 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded">
                
                <span className="hidden sm:inline">Trades</span>
                <span className="sm:hidden">Trades</span>
                {tradesCount > 0 && <span className="ml-0.5 sm:ml-1 text-[9px] sm:text-xs opacity-60">({tradesCount})</span>}
              </TabsTrigger>
              <TabsTrigger
                value="open"
                className="text-[10px] sm:text-xs px-1 sm:px-2 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded">
                
                Open {openCount > 0 && <span className="ml-0.5 sm:ml-1 text-[9px] sm:text-xs opacity-60">({openCount})</span>}
              </TabsTrigger>
              <TabsTrigger
                value="conditional"
                className="text-[10px] sm:text-xs px-1 sm:px-2 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded leading-tight">
                
                <span className="hidden sm:inline">Conditional</span>
                <span className="sm:hidden">Cond.</span>
                {conditionalCount > 0 && <span className="ml-0.5 sm:ml-1 text-[9px] sm:text-xs opacity-60">({conditionalCount})</span>}
              </TabsTrigger>
              <TabsTrigger
                value="closed"
                className="text-[10px] sm:text-xs px-1 sm:px-2 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded leading-tight">
                
                <span className="hidden sm:inline">Closed/Failed</span>
                <span className="sm:hidden">Closed</span>
                {closedCount > 0 && <span className="ml-0.5 sm:ml-1 text-[9px] sm:text-xs opacity-60">({closedCount})</span>}
              </TabsTrigger>
            </TabsList>

            {/* TRADES TAB */}
            <TabsContent value="trades" className="mt-0">
              {filteredTrades.length === 0 ?
              <EmptyState
                icon={History}
                message="No trades yet. Execute your first trade to see it here!" /> :


              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {filteredTrades.slice(0, 50).map((trade) =>
                <TradeRow
                  key={trade.id}
                  trade={trade}
                  timezone={timezone}
                  is24h={is24h}
                  formatDisplayQuantity={formatDisplayQuantity}
                  formatPrice={formatPrice}
                  onClick={() => setSelectedTrade(trade)} />

                )}
                </div>
              }
            </TabsContent>

            {/* OPEN ORDERS TAB */}
            <TabsContent value="open" className="mt-0">
              {openOrders.length === 0 ? (
                <EmptyState
                  icon={Clock}
                  message="No open orders. Your active limit and stop orders will appear here." />
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {openOrders.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      timezone={timezone}
                      is24h={is24h}
                      formatDisplayQuantity={formatDisplayQuantity}
                      formatPrice={formatPrice}
                      onCancel={handleCancelOrder}
                      isCancelling={cancellingOrderId === order.id}
                      type="open" />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* CONDITIONAL ORDERS TAB */}
            <TabsContent value="conditional" className="mt-0">
              {conditionalOrders.length === 0 ? (
                <EmptyState
                  icon={Target}
                  message="No conditional orders. Auto-trader creates these when buying assets." />
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {conditionalOrders.map((order) => (
                    <ConditionalOrderRow
                      key={order.id}
                      order={order}
                      timezone={timezone}
                      is24h={is24h}
                      formatDisplayQuantity={formatDisplayQuantity}
                      formatPrice={formatPrice}
                      onCancel={handleCancelOrder}
                      isCancelling={cancellingOrderId === order.id} />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* CLOSED/FAILED ORDERS TAB */}
            <TabsContent value="closed" className="mt-0">
              {closedOrders.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  message="No closed or failed orders yet. Executed, cancelled, and failed orders appear here." />
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {closedOrders.slice(0, 50).map((order) => (
                    <ClosedOrderRow
                      key={order.id}
                      order={order}
                      timezone={timezone}
                      is24h={is24h}
                      formatDisplayQuantity={formatDisplayQuantity}
                      formatPrice={formatPrice}
                      onClick={() => setSelectedClosedOrder(order)}
                      onDismiss={handleDismissFailedOrder} />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Closed Order Details Modal */}
      <ClosedOrderDetailsModal
        order={selectedClosedOrder}
        isOpen={!!selectedClosedOrder}
        onClose={() => setSelectedClosedOrder(null)}
        timezone={timezone}
        is24h={is24h}
        formatDisplayQuantity={formatDisplayQuantity}
        formatPrice={formatPrice} />
      
    </>);

}

// Empty state component
function EmptyState({ icon: Icon, message }) {
  return (
    <div className="text-center py-8">
      <Icon className="w-10 h-10 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-secondary)' }} />
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {message}
      </p>
    </div>);

}

// Loading state
function LoadingState() {
  return (
    <div className="text-center py-8">
      <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin neon-text" />
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Loading orders...</p>
    </div>);

}

// Trade row component
function TradeRow({ trade, timezone, is24h, formatDisplayQuantity, formatPrice, onClick }) {
  const isBuy = trade.type === "buy";
  // Normalize the symbol for display (handles Kraken's X/Z prefixes/suffixes)
  const displaySymbol = normalizeKrakenSymbol(trade.symbol || '');

  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      style={{ backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}>
      
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
        isBuy ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`
        }>
          {isBuy ?
          <ArrowUpRight className="w-4 h-4 text-green-500" /> :

          <ArrowDownRight className="w-4 h-4 text-red-500" />
          }
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {displaySymbol}
            </span>
            <Badge variant="outline" className="text-xs capitalize">
              {trade.type}
            </Badge>
            {trade.is_auto_trade &&
            <Badge className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                AI
              </Badge>
            }
          </div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {formatInTimezone(trade.created_date, timezone, is24h)}
          </p>
        </div>
      </div>
      
      <div className="text-right">
        <p className={`font-medium ${isBuy ? 'text-red-500' : 'text-green-500'}`}>
          {isBuy ? '-' : '+'}${(trade.total_value || 0).toFixed(2)}
        </p>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {formatDisplayQuantity(trade.quantity)} @ {formatPrice(trade.price)}
        </p>
      </div>
    </button>);

}

// Open order row - enhanced for Kraken orders
function OrderRow({ order, timezone, is24h, formatDisplayQuantity, formatPrice, onCancel, isCancelling, type }) {
  // Normalize the symbol for display
  const displaySymbol = normalizeKrakenSymbol(order.symbol || '');
  
  // Determine order type badge color
  const getOrderTypeBadge = () => {
    const orderType = (order.order_type || '').toLowerCase();
    if (orderType.includes('stop-loss')) {
      return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Stop Loss' };
    }
    if (orderType.includes('take-profit')) {
      return { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', label: 'Take Profit' };
    }
    if (orderType.includes('trailing')) {
      return { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300', label: 'Trailing' };
    }
    if (orderType.includes('limit')) {
      return { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', label: 'Limit' };
    }
    return { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300', label: 'Pending' };
  };
  
  const typeBadge = getOrderTypeBadge();

  return (
    <div
      className="flex items-center justify-between p-3 rounded-lg border"
      style={{ backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}>
      
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full flex items-center justify-center bg-yellow-100 dark:bg-yellow-900/30">
          <Clock className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {displaySymbol}
            </span>
            <Badge className={`text-xs ${typeBadge.bg} ${typeBadge.text}`}>
              {typeBadge.label}
            </Badge>
            {order.side && (
              <Badge variant="outline" className="text-xs capitalize">
                {order.side}
              </Badge>
            )}
            {order.group_type === 'bracket' && (
              <Badge className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                Bracket
              </Badge>
            )}
          </div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {order.kraken_description || formatInTimezone(order.created_date, timezone, is24h)}
          </p>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
            {formatDisplayQuantity(order.quantity)} units
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            @ {formatPrice(order.purchase_price || order.trigger_price)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onCancel(order.id)}
          disabled={isCancelling}
          className="text-red-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30">
          
          {isCancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
        </Button>
      </div>
    </div>);

}

// Conditional order row
function ConditionalOrderRow({ order, timezone, is24h, formatDisplayQuantity, formatPrice, onCancel, isCancelling }) {
  const gainPrice = order.purchase_price * (1 + (order.gain_margin || 10) / 100);
  const lossPrice = order.purchase_price * (1 - (order.loss_margin || 5) / 100);
  // Normalize the symbol for display
  const displaySymbol = normalizeKrakenSymbol(order.symbol || '');

  return (
    <div
      className="p-3 rounded-lg border"
      style={{ backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}>
      
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-purple-100 dark:bg-purple-900/30">
            <Target className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {displaySymbol}
              </span>
              <Badge className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                Conditional
              </Badge>
              {order.trailing_enabled !== false &&
              <Badge className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                  Trailing
                </Badge>
              }
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {formatDisplayQuantity(order.quantity)} units • Entry: {formatPrice(order.purchase_price)}
            </p>
          </div>
        </div>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onCancel(order.id)}
          disabled={isCancelling}
          className="text-red-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30">
          
          {isCancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
        </Button>
      </div>
      
      <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
        <div className="flex items-center gap-1 p-2 rounded bg-green-50 dark:bg-green-900/20">
          <TrendingUp className="w-3 h-3 text-green-500" />
          <span style={{ color: 'var(--text-secondary)' }}>Take Profit:</span>
          <span className="font-medium text-green-600 dark:text-green-400">
            {formatPrice(gainPrice)} (+{order.gain_margin || 10}%)
          </span>
        </div>
        <div className="flex items-center gap-1 p-2 rounded bg-red-50 dark:bg-red-900/20">
          <TrendingDown className="w-3 h-3 text-red-500" />
          <span style={{ color: 'var(--text-secondary)' }}>Stop Loss:</span>
          <span className="font-medium text-red-600 dark:text-red-400">
            {formatPrice(lossPrice)} (-{order.loss_margin || 5}%)
          </span>
        </div>
      </div>
      
      {order.highest_price && order.highest_price > order.purchase_price &&
      <div className="mt-2 text-xs flex items-center gap-1 p-2 rounded bg-blue-50 dark:bg-blue-900/20">
          <TrendingUp className="w-3 h-3 text-blue-500" />
          <span style={{ color: 'var(--text-secondary)' }}>Peak:</span>
          <span className="font-medium text-blue-600 dark:text-blue-400">
            {formatPrice(order.highest_price)}
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>
            (Trailing stop @ {formatPrice(order.highest_price * (1 - (order.trailing_margin || order.loss_margin || 5) / 100))})
          </span>
        </div>
      }
    </div>);

}

// Closed order row
function ClosedOrderRow({ order, timezone, is24h, formatDisplayQuantity, formatPrice, onClick, onDismiss }) {
  const isExecuted = order.status === "executed";
  const isFailed = order.status === "failed" || !!order.error_message;
  // Normalize the symbol for display
  const displaySymbol = normalizeKrakenSymbol(order.symbol || '');
  
  // Determine icon and styling based on status
  const getStatusStyle = () => {
    if (isFailed) {
      return {
        bgClass: 'bg-red-100 dark:bg-red-900/30',
        icon: <AlertCircle className="w-4 h-4 text-red-500" />,
        badgeClass: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
        label: 'Failed'
      };
    }
    if (isExecuted) {
      return {
        bgClass: 'bg-green-100 dark:bg-green-900/30',
        icon: <CheckCircle2 className="w-4 h-4 text-green-500" />,
        badgeClass: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
        label: 'Executed'
      };
    }
    return {
      bgClass: 'bg-gray-100 dark:bg-gray-800',
      icon: <X className="w-4 h-4 text-gray-500" />,
      badgeClass: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
      label: 'Cancelled'
    };
  };
  
  const statusStyle = getStatusStyle();

  return (
    <div
      className={`relative w-full text-left flex items-center justify-between p-3 rounded-lg border hover:opacity-100 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all ${isFailed ? 'opacity-90 border-red-200 dark:border-red-800' : 'opacity-75'}`}
      style={{ backgroundColor: 'var(--secondary-bg)', borderColor: isFailed ? undefined : 'var(--border-color)' }}>
      
      {/* Dismiss button for failed orders */}
      {isFailed && onDismiss && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(order.id);
          }}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-md transition-colors z-10"
          title="Dismiss failed order"
        >
          <X className="w-3 h-3 text-white" />
        </button>
      )}
      
      <button
        onClick={onClick}
        className="flex-1 flex items-center justify-between cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${statusStyle.bgClass}`}>
            {statusStyle.icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {displaySymbol}
              </span>
              <Badge className={`text-xs ${statusStyle.badgeClass}`}>
                {statusStyle.label}
              </Badge>
              <Info className="w-3 h-3 opacity-50" />
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {formatInTimezone(order.updated_date || order.created_date, timezone, is24h)}
            </p>
            {isFailed && order.error_message && (
              <p className="text-xs text-red-500 dark:text-red-400 truncate max-w-[200px]">
                {order.error_message.slice(0, 50)}{order.error_message.length > 50 ? '...' : ''}
              </p>
            )}
          </div>
        </div>
        
        <div className="text-right">
          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
            {formatDisplayQuantity(order.quantity)} units
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Entry: {formatPrice(order.purchase_price)}
          </p>
        </div>
      </button>
    </div>);

}

// Closed order details modal
function ClosedOrderDetailsModal({ order, isOpen, onClose, timezone, is24h, formatDisplayQuantity, formatPrice }) {
  if (!order) return null;

  const isExecuted = order.status === "executed";
  const isFailed = order.status === "failed" || !!order.error_message;
  const gainPrice = order.purchase_price * (1 + (order.gain_margin || 10) / 100);
  const lossPrice = order.purchase_price * (1 - (order.loss_margin || 5) / 100);

  // Determine the reason for execution/cancellation/failure
  const getClosureReason = () => {
    // CRITICAL: If there's a stored closure_reason or error_message, use it first
    if (order.error_message) {
      // Parse common Kraken error messages for user-friendly display
      const errMsg = order.error_message.toLowerCase();
      let friendlyDescription = order.error_message;
      let title = "Order Failed";
      
      if (errMsg.includes('insufficient funds') || errMsg.includes('insufficient balance')) {
        title = "Insufficient Funds";
        friendlyDescription = `The order could not be executed because there weren't enough funds in your account. Original error: ${order.error_message}`;
      } else if (errMsg.includes('minimum order') || errMsg.includes('order minimum')) {
        title = "Below Minimum Order Size";
        friendlyDescription = `The order size was below Kraken's minimum requirement. Try increasing the order quantity. Original error: ${order.error_message}`;
      } else if (errMsg.includes('rate limit') || errMsg.includes('too many requests')) {
        title = "Rate Limited";
        friendlyDescription = `Too many requests were sent to Kraken. The order will be retried automatically. Original error: ${order.error_message}`;
      } else if (errMsg.includes('invalid') || errMsg.includes('unknown')) {
        title = "Invalid Order";
        friendlyDescription = `The order parameters were invalid or the trading pair is not supported. Original error: ${order.error_message}`;
      } else if (errMsg.includes('timeout') || errMsg.includes('timed out')) {
        title = "Connection Timeout";
        friendlyDescription = `The connection to Kraken timed out before the order could be confirmed. The order may or may not have been placed. Original error: ${order.error_message}`;
      } else if (errMsg.includes('websocket') || errMsg.includes('connection')) {
        title = "Connection Error";
        friendlyDescription = `There was a connection issue with Kraken. The order may not have been placed. Original error: ${order.error_message}`;
      }
      
      return {
        type: "error",
        title: title,
        description: friendlyDescription,
        icon: AlertCircle,
        color: "text-red-500"
      };
    }
    
    if (order.closure_reason) {
      // Parse the closure reason to determine icon and color
      const reason = order.closure_reason.toLowerCase();
      if (reason.includes('stop-loss') || reason.includes('trailing')) {
        return {
          type: "stop-triggered",
          title: "Stop Triggered",
          description: order.closure_reason,
          icon: TrendingDown,
          color: "text-orange-500"
        };
      }
      if (reason.includes('take-profit') || reason.includes('profit')) {
        return {
          type: "take-profit",
          title: "Take Profit Hit",
          description: order.closure_reason,
          icon: TrendingUp,
          color: "text-green-500"
        };
      }
      if (reason.includes('sold') || reason.includes('position')) {
        return {
          type: "position-closed",
          title: "Position Closed",
          description: order.closure_reason,
          icon: CheckCircle2,
          color: "text-blue-500"
        };
      }
      if (reason.includes('kraken') || reason.includes('websocket') || reason.includes('failed')) {
        return {
          type: "api-error",
          title: "Kraken API Error",
          description: order.closure_reason,
          icon: AlertCircle,
          color: "text-red-500"
        };
      }
      if (reason.includes('replaced') || reason.includes('updated')) {
        return {
          type: "replaced",
          title: "Order Replaced",
          description: order.closure_reason,
          icon: RefreshCw,
          color: "text-blue-500"
        };
      }
      // Generic stored reason
      return {
        type: "stored-reason",
        title: isExecuted ? "Order Executed" : "Order Cancelled",
        description: order.closure_reason,
        icon: isExecuted ? CheckCircle2 : X,
        color: isExecuted ? "text-green-500" : "text-gray-500"
      };
    }
    
    if (isExecuted) {
      // Check if it was trailing stop, take profit, or stop loss
      if (order.highest_price && order.highest_price > order.purchase_price) {
        const trailingStop = order.highest_price * (1 - (order.trailing_margin || order.loss_margin || 5) / 100);
        const profitPercent = ((order.highest_price - order.purchase_price) / order.purchase_price * 100).toFixed(2);
        return {
          type: "trailing-stop",
          title: "Trailing Stop Triggered",
          description: `Price peaked at ${formatPrice(order.highest_price)} (+${profitPercent}% from entry), then dropped below the trailing stop at ${formatPrice(trailingStop)}. This locked in profits while following the upward trend.`,
          icon: TrendingDown,
          color: "text-orange-500"
        };
      }
      return {
        type: "condition-met",
        title: "Condition Met",
        description: `The order was executed when price conditions were met. Take profit was set at ${formatPrice(gainPrice)} (+${order.gain_margin || 10}%) and stop loss at ${formatPrice(lossPrice)} (-${order.loss_margin || 5}%).`,
        icon: CheckCircle2,
        color: "text-green-500"
      };
    } else {
      // Cancelled - provide SPECIFIC reasons
      
      // Check if there's a newer order for the same symbol (replaced by updated order)
      // This happens when auto-trader creates new conditional orders with updated prices
      const createdDate = new Date(order.created_date).getTime();
      const updatedDate = order.updated_date ? new Date(order.updated_date).getTime() : createdDate;
      const timeDiff = updatedDate - createdDate;
      
      // Check for various cancellation scenarios
      if (order.quantity <= 0 || order.quantity < 0.00001) {
        return {
          type: "zero-quantity",
          title: "Position Closed",
          description: `This order was cancelled because the holding was fully sold. You no longer own any ${order.symbol}, so there's nothing left to monitor for this conditional order.`,
          icon: AlertCircle,
          color: "text-yellow-500"
        };
      }
      
      if (order.purchase_price <= 0) {
        return {
          type: "invalid-price",
          title: "Invalid Entry Price",
          description: `This order was cancelled due to an invalid or missing entry price. The system could not determine the original purchase price needed to calculate take-profit and stop-loss levels.`,
          icon: AlertCircle,
          color: "text-red-500"
        };
      }
      
      // If order was cancelled very quickly after creation (within 5 minutes), likely replaced
      if (timeDiff > 0 && timeDiff < 5 * 60 * 1000) {
        return {
          type: "replaced",
          title: "Replaced by New Order",
          description: `This order was replaced by a newer conditional order with updated price data. The auto-trader creates fresh orders when it detects price changes to ensure accurate take-profit and stop-loss levels.`,
          icon: RefreshCw,
          color: "text-blue-500"
        };
      }
      
      // Check if it's a simulation order that was cancelled when switching modes
      if (order.is_simulation === true) {
        return {
          type: "mode-switch",
          title: "Simulation Order Cancelled",
          description: `This simulation order was cancelled. Possible reasons: (1) You sold the ${order.symbol} position, (2) The auto-trader replaced it with updated pricing, or (3) You manually cancelled it from the orders list.`,
          icon: X,
          color: "text-gray-500"
        };
      }
      
      // Live order cancelled
      if (order.is_simulation === false) {
        if (order.kraken_order_id) {
          return {
            type: "kraken-cancelled",
            title: "Kraken Order Cancelled",
            description: `This live Kraken order (ID: ${order.kraken_order_id}) was cancelled. This could be because: (1) The position was sold separately, (2) You cancelled it manually, or (3) The order was rejected by Kraken due to insufficient funds or market conditions.`,
            icon: AlertCircle,
            color: "text-orange-500"
          };
        }
        return {
          type: "live-cancelled",
          title: "Live Order Cancelled",
          description: `This live trading order was cancelled. Possible reasons: (1) You sold the ${order.symbol} position on Kraken, (2) The order failed to place on Kraken and was only tracked locally, or (3) You manually cancelled it.`,
          icon: X,
          color: "text-gray-500"
        };
      }
      
      // Default fallback with more context
      return {
        type: "cancelled",
        title: "Order Cancelled",
        description: `This conditional order for ${order.symbol} was cancelled at ${order.updated_date ? format(new Date(order.updated_date), "MMM d, yyyy h:mm a") : 'an unknown time'}. The most common reason is that the underlying ${order.symbol} position was sold (either manually or by another conditional order triggering).`,
        icon: X,
        color: "text-gray-500"
      };
    }
  };

  const reason = getClosureReason();
  const ReasonIcon = reason.icon;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <ReasonIcon className={`w-5 h-5 ${reason.color}`} />
            {order.symbol} - {isFailed ? 'Failed' : isExecuted ? 'Executed' : 'Cancelled'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 pt-2">
          {/* Reason Card */}
          <div className={`p-4 rounded-lg border ${
            isFailed ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' :
            isExecuted ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 
            'bg-slate-600 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
          }`}>
            <h4 className={`mb-2 font-medium ${isFailed ? 'text-red-700 dark:text-red-300' : 'text-slate-50'}`}>{reason.title}</h4>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {reason.description}
            </p>
          </div>
          
          {/* Order Details */}
          <div className="space-y-3">
            <h4 className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>Order Details</h4>
            
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-2 rounded bg-slate-600 dark:bg-gray-800">
                <span className="block text-xs" style={{ color: 'var(--text-secondary)' }}>Symbol</span>
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{order.symbol}</span>
              </div>
              <div className="p-2 rounded bg-slate-600 dark:bg-gray-800">
                <span className="block text-xs" style={{ color: 'var(--text-secondary)' }}>Quantity</span>
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatDisplayQuantity(order.quantity)}</span>
              </div>
              <div className="p-2 rounded bg-slate-600 dark:bg-gray-800">
                <span className="block text-xs" style={{ color: 'var(--text-secondary)' }}>Entry Price</span>
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatPrice(order.purchase_price)}</span>
              </div>
              <div className="p-2 rounded bg-slate-600 dark:bg-gray-800">
                <span className="block text-xs" style={{ color: 'var(--text-secondary)' }}>Status</span>
                <Badge className={`text-xs ${
                  isFailed ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                  isExecuted ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 
                  'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}>
                  {isFailed ? 'Failed' : isExecuted ? 'Executed' : 'Cancelled'}
                </Badge>
              </div>
            </div>
            
            {/* Trigger Conditions */}
            <div className="pt-2">
              <h4 className="font-medium text-sm mb-2" style={{ color: 'var(--text-primary)' }}>Trigger Conditions</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1 p-2 rounded bg-green-50 dark:bg-green-900/20">
                  <TrendingUp className="w-3 h-3 text-green-500" />
                  <span style={{ color: 'var(--text-secondary)' }}>TP:</span>
                  <span className="font-medium text-green-600 dark:text-green-400">
                    {formatPrice(gainPrice)} (+{order.gain_margin || 10}%)
                  </span>
                </div>
                <div className="flex items-center gap-1 p-2 rounded bg-red-50 dark:bg-red-900/20">
                  <TrendingDown className="w-3 h-3 text-red-500" />
                  <span style={{ color: 'var(--text-secondary)' }}>SL:</span>
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {formatPrice(lossPrice)} (-{order.loss_margin || 5}%)
                  </span>
                </div>
              </div>
              
              {order.highest_price && order.highest_price > order.purchase_price &&
              <div className="mt-2 flex items-center gap-1 p-2 rounded bg-blue-50 dark:bg-blue-900/20 text-xs">
                  <TrendingUp className="w-3 h-3 text-blue-500" />
                  <span style={{ color: 'var(--text-secondary)' }}>Peak Price:</span>
                  <span className="font-medium text-blue-600 dark:text-blue-400">
                    {formatPrice(order.highest_price)}
                  </span>
                </div>
              }
            </div>
            
            {/* Timestamps */}
            <div className="pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <div className="grid grid-cols-1 gap-2 text-xs">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>Created:</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {formatFullInTimezone(order.created_date, timezone, is24h)}
                  </span>
                </div>
                {order.updated_date &&
                <div className="flex justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>{isFailed ? 'Failed:' : isExecuted ? 'Executed:' : 'Cancelled:'}</span>
                    <span style={{ color: 'var(--text-primary)' }}>
                      {formatFullInTimezone(order.updated_date, timezone, is24h)}
                    </span>
                  </div>
                }
                {order.kraken_order_id &&
                <div className="flex justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Kraken Order ID:</span>
                    <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                      {order.kraken_order_id}
                    </span>
                  </div>
                }
              </div>
            </div>
          </div>
          
          <Button onClick={onClose} className="w-full mt-4">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>);

}