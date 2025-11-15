import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Clock, TrendingUp, TrendingDown, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRealtimeKrakenData } from "@/components/hooks/useRealtimeKrakenData";
import { useSettings } from "@/components/utils/SettingsContext";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function OpenAndConditionalOrders() {
  const { settings } = useSettings();
  const isSimMode = settings?.sim_trading_mode !== false;
  
  const [conditionalOrders, setConditionalOrders] = useState([]);
  const [loadingConditional, setLoadingConditional] = useState(true);
  const [cancellingOrder, setCancellingOrder] = useState(null);

  // Get live Kraken orders via WebSocket
  const { 
    orders: krakenOrders,
    isConnected: wsConnected
  } = useRealtimeKrakenData({
    subscribeToOrders: !isSimMode,
    isSimMode
  });

  // Load conditional orders from database
  useEffect(() => {
    const loadConditionalOrders = async () => {
      try {
        setLoadingConditional(true);
        const orders = await base44.entities.ConditionalOrder.filter({ 
          status: 'active',
          is_simulation: isSimMode 
        });
        setConditionalOrders(orders || []);
      } catch (error) {
        console.error('[OpenAndConditionalOrders] Error loading conditional orders:', error);
        setConditionalOrders([]);
      } finally {
        setLoadingConditional(false);
      }
    };

    loadConditionalOrders();
  }, [isSimMode]);

  // Convert Kraken orders object to array
  const openOrdersList = React.useMemo(() => {
    if (!krakenOrders || typeof krakenOrders !== 'object') return [];
    return Object.values(krakenOrders);
  }, [krakenOrders]);

  const handleCancelOrder = async (orderId) => {
    if (!confirm('Cancel this order?')) return;

    setCancellingOrder(orderId);
    try {
      const response = await base44.functions.invoke('krakenTrade', {
        action: 'cancel_order',
        order_id: orderId
      });

      const data = response?.data || response;

      if (data?.success) {
        toast.success('Order cancelled');
      } else {
        throw new Error(data?.error || 'Failed to cancel order');
      }
    } catch (error) {
      console.error('[OpenAndConditionalOrders] Cancel error:', error);
      toast.error('Failed to cancel order', { description: error.message });
    } finally {
      setCancellingOrder(null);
    }
  };

  const handleCancelConditional = async (order) => {
    if (!confirm('Cancel this conditional order?')) return;

    try {
      await base44.entities.ConditionalOrder.update(order.id, { status: 'cancelled' });
      setConditionalOrders(prev => prev.filter(o => o.id !== order.id));
      toast.success('Conditional order cancelled');
    } catch (error) {
      console.error('[OpenAndConditionalOrders] Cancel conditional error:', error);
      toast.error('Failed to cancel conditional order');
    }
  };

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Clock className="w-5 h-5" />
          Open & Conditional Orders
          {!isSimMode && wsConnected && (
            <Badge className="bg-green-100 text-green-800 text-xs ml-auto">
              Live Orders
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="open" className="w-full">
          <TabsList className="grid w-full grid-cols-2" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <TabsTrigger value="open">
              Open Orders {!isSimMode && openOrdersList.length > 0 && `(${openOrdersList.length})`}
            </TabsTrigger>
            <TabsTrigger value="conditional">
              Conditional Orders ({conditionalOrders.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="open" className="space-y-3 mt-4">
            {isSimMode ? (
              <div className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
                <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No Open Orders in Demo Mode</p>
                <p className="text-sm mt-1">Switch to Live mode to see real Kraken orders</p>
              </div>
            ) : !wsConnected ? (
              <div className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
                <Clock className="w-12 h-12 mx-auto mb-3 opacity-50 animate-pulse" />
                <p className="font-medium">Connecting to Kraken...</p>
                <p className="text-sm mt-1">Loading your open orders</p>
              </div>
            ) : openOrdersList.length === 0 ? (
              <div className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No Open Orders</p>
                <p className="text-sm mt-1">Your pending orders will appear here</p>
              </div>
            ) : (
              openOrdersList.map((order) => (
                <div
                  key={order.order_id}
                  className="p-4 rounded-lg border"
                  style={{
                    backgroundColor: 'var(--secondary-bg)',
                    borderColor: 'var(--border-color)'
                  }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {order.symbol}
                        </p>
                        <Badge variant={order.side === 'buy' ? 'default' : 'destructive'} className="text-xs">
                          {order.side === 'buy' ? (
                            <TrendingUp className="w-3 h-3 mr-1" />
                          ) : (
                            <TrendingDown className="w-3 h-3 mr-1" />
                          )}
                          {order.side?.toUpperCase()}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {order.order_type || 'market'}
                        </Badge>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        Order ID: {order.order_id?.substring(0, 16)}...
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancelOrder(order.order_id)}
                      disabled={cancellingOrder === order.order_id}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p style={{ color: 'var(--text-secondary)' }}>Quantity</p>
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {parseFloat(order.quantity || 0).toFixed(4)}
                      </p>
                    </div>
                    <div>
                      <p style={{ color: 'var(--text-secondary)' }}>Price</p>
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        ${parseFloat(order.limit_price || order.price || 0).toFixed(2)}
                      </p>
                    </div>
                    {order.stop_price && (
                      <div>
                        <p style={{ color: 'var(--text-secondary)' }}>Stop Price</p>
                        <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                          ${parseFloat(order.stop_price).toFixed(2)}
                        </p>
                      </div>
                    )}
                    <div>
                      <p style={{ color: 'var(--text-secondary)' }}>Status</p>
                      <Badge variant="outline" className="text-xs">
                        {order.status || 'pending'}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="conditional" className="space-y-3 mt-4">
            {loadingConditional ? (
              <div className="text-center py-8">
                <Clock className="w-12 h-12 mx-auto mb-3 opacity-50 animate-pulse" />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Loading...</p>
              </div>
            ) : conditionalOrders.length === 0 ? (
              <div className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No Conditional Orders</p>
                <p className="text-sm mt-1">AI auto-trading orders will appear here</p>
              </div>
            ) : (
              conditionalOrders.map((order) => (
                <div
                  key={order.id}
                  className="p-4 rounded-lg border"
                  style={{
                    backgroundColor: 'var(--secondary-bg)',
                    borderColor: 'var(--border-color)'
                  }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {order.symbol}
                        </p>
                        <Badge className="bg-blue-100 text-blue-800 text-xs">
                          AI Auto-Trader
                        </Badge>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        Created: {new Date(order.created_date).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancelConditional(order)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p style={{ color: 'var(--text-secondary)' }}>Quantity</p>
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {order.quantity.toFixed(4)}
                      </p>
                    </div>
                    <div>
                      <p style={{ color: 'var(--text-secondary)' }}>Purchase Price</p>
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        ${order.purchase_price.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p style={{ color: 'var(--text-secondary)' }}>Take Profit</p>
                      <p className="font-medium text-green-600">
                        +{order.gain_margin}%
                      </p>
                    </div>
                    <div>
                      <p style={{ color: 'var(--text-secondary)' }}>Stop Loss</p>
                      <p className="font-medium text-red-600">
                        -{order.loss_margin}%
                      </p>
                    </div>
                    {order.trailing_enabled && (
                      <div className="col-span-2">
                        <p style={{ color: 'var(--text-secondary)' }}>Trailing Stop</p>
                        <Badge variant="outline" className="text-xs">
                          Enabled • {order.trailing_margin}% from peak
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}