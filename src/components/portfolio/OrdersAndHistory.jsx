import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Info
} from "lucide-react";
import { format } from "date-fns";
import { useSettings } from "@/components/utils/SettingsContext";
import { ConditionalOrder, Trade } from "@/entities/all";
import { base44 } from "@/api/base44Client";
import TradeDetailsModal from "../dashboard/TradeDetailsModal";
import { toast } from "sonner";

export default function OrdersAndHistory({ trades = [], isSimMode = true, onRefresh }) {
  const [activeTab, setActiveTab] = useState("trades");
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [conditionalOrders, setConditionalOrders] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [closedOrders, setClosedOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [selectedClosedOrder, setSelectedClosedOrder] = useState(null);
  
  const { settings, user } = useSettings();
  const is24h = (settings?.time_format || "12h") === "24h";
  const dateFmt = is24h ? "MMM d, HH:mm" : "MMM d, h:mm a";
  const fullDateFmt = is24h ? "MMM d, yyyy HH:mm:ss" : "MMM d, yyyy h:mm:ss a";

  // Load conditional orders - CRITICAL: Filter by simulation mode
  const loadOrders = useCallback(async () => {
    if (!user?.email) return;
    
    setIsLoading(true);
    try {
      // CRITICAL: Only load orders matching the current mode (sim vs live)
      // ConditionalOrder doesn't have is_simulation field, so we need to check
      // if the order was created in sim mode by looking at related trades or settings
      const allOrders = await ConditionalOrder.filter(
        { created_by: user.email },
        "-created_date",
        100
      );
      
      // Filter orders based on simulation mode
      // Orders created in live mode should only show in live mode and vice versa
      const modeFilteredOrders = allOrders.filter(o => {
        // If the order has is_simulation field, use it
        if (typeof o.is_simulation === 'boolean') {
          return o.is_simulation === isSimMode;
        }
        // For older orders without the field, show in sim mode only (safe default)
        return isSimMode;
      });
      
      // Separate active from executed/cancelled
      const active = modeFilteredOrders.filter(o => o.status === "active");
      const executed = modeFilteredOrders.filter(o => o.status === "executed");
      const cancelled = modeFilteredOrders.filter(o => o.status === "cancelled");
      
      setConditionalOrders(active);
      setOpenOrders(active);
      setClosedOrders([...executed, ...cancelled]);
      
    } catch (err) {
      console.error("[OrdersAndHistory] Failed to load orders:", err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.email, isSimMode]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // Cancel an order
  const handleCancelOrder = async (orderId) => {
    setCancellingOrderId(orderId);
    try {
      await ConditionalOrder.update(orderId, { status: "cancelled" });
      toast.success("Order cancelled");
      loadOrders();
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Failed to cancel order:", err);
      toast.error("Failed to cancel order");
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

  // Filter trades by simulation mode
  const filteredTrades = trades.filter(t => t.is_simulation === isSimMode);
  const buyTrades = filteredTrades.filter(t => t.type === "buy");
  const sellTrades = filteredTrades.filter(t => t.type === "sell");

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
        onClose={() => setSelectedTrade(null)} 
      />
      
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
              onClick={() => { loadOrders(); if (onRefresh) onRefresh(); }}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="pt-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full grid grid-cols-4 mb-4 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
              <TabsTrigger 
                value="trades" 
                className="text-xs px-2 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded"
              >
                Trades {tradesCount > 0 && <span className="ml-1 text-xs opacity-60">({tradesCount})</span>}
              </TabsTrigger>
              <TabsTrigger 
                value="open" 
                className="text-xs px-2 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded"
              >
                Open {openCount > 0 && <span className="ml-1 text-xs opacity-60">({openCount})</span>}
              </TabsTrigger>
              <TabsTrigger 
                value="conditional" 
                className="text-xs px-2 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded"
              >
                Conditional {conditionalCount > 0 && <span className="ml-1 text-xs opacity-60">({conditionalCount})</span>}
              </TabsTrigger>
              <TabsTrigger 
                value="closed" 
                className="text-xs px-2 py-1.5 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded"
              >
                Closed {closedCount > 0 && <span className="ml-1 text-xs opacity-60">({closedCount})</span>}
              </TabsTrigger>
            </TabsList>

            {/* TRADES TAB */}
            <TabsContent value="trades" className="mt-0">
              {filteredTrades.length === 0 ? (
                <EmptyState 
                  icon={History} 
                  message="No trades yet. Execute your first trade to see it here!" 
                />
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {filteredTrades.slice(0, 50).map((trade) => (
                    <TradeRow 
                      key={trade.id} 
                      trade={trade} 
                      dateFmt={dateFmt}
                      formatDisplayQuantity={formatDisplayQuantity}
                      formatPrice={formatPrice}
                      onClick={() => setSelectedTrade(trade)}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* OPEN ORDERS TAB */}
            <TabsContent value="open" className="mt-0">
              {isLoading ? (
                <LoadingState />
              ) : openOrders.length === 0 ? (
                <EmptyState 
                  icon={Clock} 
                  message="No open orders. Your active limit and stop orders will appear here." 
                />
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {openOrders.map((order) => (
                    <OrderRow 
                      key={order.id}
                      order={order}
                      dateFmt={dateFmt}
                      formatDisplayQuantity={formatDisplayQuantity}
                      formatPrice={formatPrice}
                      onCancel={handleCancelOrder}
                      isCancelling={cancellingOrderId === order.id}
                      type="open"
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* CONDITIONAL ORDERS TAB */}
            <TabsContent value="conditional" className="mt-0">
              {isLoading ? (
                <LoadingState />
              ) : conditionalOrders.length === 0 ? (
                <EmptyState 
                  icon={Target} 
                  message="No conditional orders. Auto-trader creates these when buying assets." 
                />
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {conditionalOrders.map((order) => (
                    <ConditionalOrderRow 
                      key={order.id}
                      order={order}
                      dateFmt={dateFmt}
                      formatDisplayQuantity={formatDisplayQuantity}
                      formatPrice={formatPrice}
                      onCancel={handleCancelOrder}
                      isCancelling={cancellingOrderId === order.id}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* CLOSED ORDERS TAB */}
            <TabsContent value="closed" className="mt-0">
              {isLoading ? (
                <LoadingState />
              ) : closedOrders.length === 0 ? (
                <EmptyState 
                  icon={CheckCircle2} 
                  message="No closed orders yet. Executed and cancelled orders appear here." 
                />
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {closedOrders.slice(0, 50).map((order) => (
                    <ClosedOrderRow 
                      key={order.id}
                      order={order}
                      dateFmt={dateFmt}
                      formatDisplayQuantity={formatDisplayQuantity}
                      formatPrice={formatPrice}
                      onClick={() => setSelectedClosedOrder(order)}
                    />
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
        fullDateFmt={fullDateFmt}
        formatDisplayQuantity={formatDisplayQuantity}
        formatPrice={formatPrice}
      />
    </>
  );
}

// Empty state component
function EmptyState({ icon: Icon, message }) {
  return (
    <div className="text-center py-8">
      <Icon className="w-10 h-10 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-secondary)' }} />
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {message}
      </p>
    </div>
  );
}

// Loading state
function LoadingState() {
  return (
    <div className="text-center py-8">
      <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin neon-text" />
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Loading orders...</p>
    </div>
  );
}

// Trade row component
function TradeRow({ trade, dateFmt, formatDisplayQuantity, formatPrice, onClick }) {
  const isBuy = trade.type === "buy";
  
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      style={{ backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}
    >
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
          isBuy ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'
        }`}>
          {isBuy ? (
            <ArrowUpRight className="w-4 h-4 text-green-500" />
          ) : (
            <ArrowDownRight className="w-4 h-4 text-red-500" />
          )}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {trade.symbol}
            </span>
            <Badge variant="outline" className="text-xs capitalize">
              {trade.type}
            </Badge>
            {trade.is_auto_trade && (
              <Badge className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                AI
              </Badge>
            )}
          </div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {format(new Date(trade.created_date), dateFmt)}
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
    </button>
  );
}

// Open order row
function OrderRow({ order, dateFmt, formatDisplayQuantity, formatPrice, onCancel, isCancelling, type }) {
  return (
    <div 
      className="flex items-center justify-between p-3 rounded-lg border"
      style={{ backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full flex items-center justify-center bg-yellow-100 dark:bg-yellow-900/30">
          <Clock className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {order.symbol}
            </span>
            <Badge className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">
              Pending
            </Badge>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {format(new Date(order.created_date), dateFmt)}
          </p>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
            {formatDisplayQuantity(order.quantity)} units
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            @ {formatPrice(order.purchase_price)}
          </p>
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => onCancel(order.id)}
          disabled={isCancelling}
          className="text-red-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30"
        >
          {isCancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

// Conditional order row
function ConditionalOrderRow({ order, dateFmt, formatDisplayQuantity, formatPrice, onCancel, isCancelling }) {
  const gainPrice = order.purchase_price * (1 + (order.gain_margin || 10) / 100);
  const lossPrice = order.purchase_price * (1 - (order.loss_margin || 5) / 100);
  
  return (
    <div 
      className="p-3 rounded-lg border"
      style={{ backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-purple-100 dark:bg-purple-900/30">
            <Target className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {order.symbol}
              </span>
              <Badge className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                Conditional
              </Badge>
              {order.trailing_enabled !== false && (
                <Badge className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                  Trailing
                </Badge>
              )}
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
          className="text-red-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30"
        >
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
      
      {order.highest_price && order.highest_price > order.purchase_price && (
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
      )}
    </div>
  );
}

// Closed order row
function ClosedOrderRow({ order, dateFmt, formatDisplayQuantity, formatPrice, onClick }) {
  const isExecuted = order.status === "executed";
  
  return (
    <button 
      onClick={onClick}
      className="w-full text-left flex items-center justify-between p-3 rounded-lg border opacity-75 hover:opacity-100 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all cursor-pointer"
      style={{ backgroundColor: 'var(--secondary-bg)', borderColor: 'var(--border-color)' }}
    >
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
          isExecuted ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-800'
        }`}>
          {isExecuted ? (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          ) : (
            <X className="w-4 h-4 text-gray-500" />
          )}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {order.symbol}
            </span>
            <Badge 
              className={`text-xs ${
                isExecuted 
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' 
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
              }`}
            >
              {isExecuted ? 'Executed' : 'Cancelled'}
            </Badge>
            <Info className="w-3 h-3 opacity-50" />
          </div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {format(new Date(order.updated_date || order.created_date), dateFmt)}
          </p>
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
  );
}

// Closed order details modal
function ClosedOrderDetailsModal({ order, isOpen, onClose, fullDateFmt, formatDisplayQuantity, formatPrice }) {
  if (!order) return null;
  
  const isExecuted = order.status === "executed";
  const gainPrice = order.purchase_price * (1 + (order.gain_margin || 10) / 100);
  const lossPrice = order.purchase_price * (1 - (order.loss_margin || 5) / 100);
  
  // Determine the reason for execution/cancellation
  const getClosureReason = () => {
    if (isExecuted) {
      // Check if it was trailing stop, take profit, or stop loss
      if (order.highest_price && order.highest_price > order.purchase_price) {
        const trailingStop = order.highest_price * (1 - (order.trailing_margin || order.loss_margin || 5) / 100);
        return {
          type: "trailing-stop",
          title: "Trailing Stop Triggered",
          description: `Price peaked at ${formatPrice(order.highest_price)}, then dropped to trigger the trailing stop at ${formatPrice(trailingStop)}. This locked in profits while following the upward trend.`,
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
      // Cancelled
      return {
        type: "cancelled",
        title: "Order Cancelled",
        description: "This order was manually cancelled or automatically removed when the underlying asset was no longer held.",
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
            {order.symbol} - {isExecuted ? 'Executed' : 'Cancelled'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 pt-2">
          {/* Reason Card */}
          <div className={`p-4 rounded-lg border ${isExecuted ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-slate-500 dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
            <h4 className={`font-medium mb-2 ${reason.color}`}>{reason.title}</h4>
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
                <Badge className={`text-xs ${isExecuted ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                  {isExecuted ? 'Executed' : 'Cancelled'}
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
              
              {order.highest_price && order.highest_price > order.purchase_price && (
                <div className="mt-2 flex items-center gap-1 p-2 rounded bg-blue-50 dark:bg-blue-900/20 text-xs">
                  <TrendingUp className="w-3 h-3 text-blue-500" />
                  <span style={{ color: 'var(--text-secondary)' }}>Peak Price:</span>
                  <span className="font-medium text-blue-600 dark:text-blue-400">
                    {formatPrice(order.highest_price)}
                  </span>
                </div>
              )}
            </div>
            
            {/* Timestamps */}
            <div className="pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <div className="grid grid-cols-1 gap-2 text-xs">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-secondary)' }}>Created:</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {format(new Date(order.created_date), fullDateFmt)}
                  </span>
                </div>
                {order.updated_date && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>{isExecuted ? 'Executed:' : 'Cancelled:'}</span>
                    <span style={{ color: 'var(--text-primary)' }}>
                      {format(new Date(order.updated_date), fullDateFmt)}
                    </span>
                  </div>
                )}
                {order.kraken_order_id && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Kraken Order ID:</span>
                    <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                      {order.kraken_order_id}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <Button onClick={onClose} className="w-full mt-4">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}