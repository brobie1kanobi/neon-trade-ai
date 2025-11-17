import React, { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { TrendingUp, TrendingDown, Target, Shield, Layers, Zap } from "lucide-react";
import { toast } from "sonner";

export default function AdvancedOrderModal({ isOpen, onClose, asset, side, quantity, onExecute }) {
  const [orderType, setOrderType] = useState('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [trailingPercent, setTrailingPercent] = useState('1.0');
  const [trailingAmount, setTrailingAmount] = useState('');
  const [timeInForce, setTimeInForce] = useState('gtc');
  const [postOnly, setPostOnly] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [displayQty, setDisplayQty] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);

  // Conditional close order (OTO)
  const [enableOTO, setEnableOTO] = useState(false);
  const [otoOrderType, setOtoOrderType] = useState('limit');
  const [otoLimitPrice, setOtoLimitPrice] = useState('');
  const [otoStopPrice, setOtoStopPrice] = useState('');

  const handleExecute = async () => {
    if (!asset || !asset.symbol || !quantity) {
      toast.error("Missing required fields");
      return;
    }

    setIsExecuting(true);

    try {
      const orderConfig = {
        symbol: asset.symbol,
        side,
        quantity,
        orderType,
        limitPrice: limitPrice || undefined,
        stopPrice: stopPrice || undefined,
        triggerPrice: triggerPrice || undefined,
        trailingAmount: trailingAmount || undefined,
        trailingPercent: trailingPercent || undefined,
        timeInForce,
        postOnly,
        reduceOnly,
        displayQty: displayQty || undefined
      };

      // Add OTO if enabled
      if (enableOTO) {
        orderConfig.conditionalCloseOrder = {
          orderType: otoOrderType,
          limitPrice: otoLimitPrice || undefined,
          stopPrice: otoStopPrice || undefined
        };
      }

      await onExecute(orderConfig);

      toast.success("Order placed successfully", {
        description: `${orderType} ${side} order for ${quantity} ${asset.symbol}`
      });

      onClose();
    } catch (error) {
      console.error('[AdvancedOrder] Error:', error);
      toast.error("Order failed", {
        description: error.message || "Failed to place order"
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const orderTypeInfo = {
    market: {
      icon: Zap,
      label: "Market Order",
      description: "Execute immediately at best available price",
      color: "text-blue-500"
    },
    limit: {
      icon: Target,
      label: "Limit Order",
      description: "Execute only at specified price or better",
      color: "text-green-500"
    },
    'stop-loss': {
      icon: Shield,
      label: "Stop Loss",
      description: "Market order triggered when price hits stop",
      color: "text-red-500"
    },
    'stop-loss-limit': {
      icon: Shield,
      label: "Stop Loss Limit",
      description: "Limit order triggered when price hits stop",
      color: "text-red-500"
    },
    'take-profit': {
      icon: TrendingUp,
      label: "Take Profit",
      description: "Market order triggered at profit target",
      color: "text-green-500"
    },
    'take-profit-limit': {
      icon: TrendingUp,
      label: "Take Profit Limit",
      description: "Limit order triggered at profit target",
      color: "text-green-500"
    },
    'trailing-stop': {
      icon: TrendingDown,
      label: "Trailing Stop",
      description: "Market order triggered when price reverts from peak",
      color: "text-orange-500"
    },
    'trailing-stop-limit': {
      icon: TrendingDown,
      label: "Trailing Stop Limit",
      description: "Limit order triggered when price reverts from peak",
      color: "text-orange-500"
    },
    iceberg: {
      icon: Layers,
      label: "Iceberg Order",
      description: "Hide full order size, show only visible portion",
      color: "text-purple-500"
    }
  };

  const currentOrderInfo = orderTypeInfo[orderType];
  const Icon = currentOrderInfo.icon;

  // Don't render if no asset provided
  if (!asset || !asset.symbol) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 p-6 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border shadow-lg duration-200 sm:rounded-lg max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${currentOrderInfo.color}`} />
            Advanced Order Options
          </DialogTitle>
          <DialogDescription>
            Configure your {side} order for {asset.symbol}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Order Type Selection */}
          <div>
            <Label>Order Type</Label>
            <Select value={orderType} onValueChange={setOrderType}>
              <SelectTrigger className="bg-slate-950 px-3 py-2 text-sm rounded-md flex h-10 w-full items-center justify-between border border-input ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="market">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Market Order
                  </div>
                </SelectItem>
                <SelectItem value="limit">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    Limit Order
                  </div>
                </SelectItem>
                <SelectItem value="stop-loss">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Stop Loss
                  </div>
                </SelectItem>
                <SelectItem value="stop-loss-limit">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Stop Loss Limit
                  </div>
                </SelectItem>
                <SelectItem value="take-profit">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Take Profit
                  </div>
                </SelectItem>
                <SelectItem value="take-profit-limit">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Take Profit Limit
                  </div>
                </SelectItem>
                <SelectItem value="trailing-stop">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="w-4 h-4" />
                    Trailing Stop
                  </div>
                </SelectItem>
                <SelectItem value="trailing-stop-limit">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="w-4 h-4" />
                    Trailing Stop Limit
                  </div>
                </SelectItem>
                <SelectItem value="iceberg">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    Iceberg Order
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500 mt-1">
              {currentOrderInfo.description}
            </p>
          </div>

          {/* Order Parameters */}
          <div className="space-y-4">
            {/* Limit Price */}
            {['limit', 'stop-loss-limit', 'take-profit-limit', 'trailing-stop-limit', 'iceberg'].includes(orderType) &&
            <div>
                <Label>Limit Price (USD)</Label>
                <Input
                type="number"
                placeholder="e.g., 50000"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                step="0.01" className="bg-slate-950 text-black px-3 py-2 text-base rounded-md flex h-10 w-full border border-input ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm" />

                <p className="text-xs text-gray-500 mt-1">
                  Order will only execute at this price or better
                </p>
              </div>
            }

            {/* Stop Price */}
            {['stop-loss', 'stop-loss-limit'].includes(orderType) &&
            <div>
                <Label>Stop Price (USD)</Label>
                <Input
                type="number"
                placeholder="e.g., 45000"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                step="0.01" />

                <p className="text-xs text-gray-500 mt-1">
                  Order triggers when price reaches this level
                </p>
              </div>
            }

            {/* Trigger Price */}
            {['take-profit', 'take-profit-limit'].includes(orderType) &&
            <div>
                <Label>Trigger Price (USD)</Label>
                <Input
                type="number"
                placeholder="e.g., 55000"
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(e.target.value)}
                step="0.01" className="bg-slate-950 px-3 py-2 text-base rounded-md flex h-10 w-full border border-input ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm" />

                <p className="text-xs text-gray-500 mt-1">
                  Order triggers when price reaches profit target
                </p>
              </div>
            }

            {/* Trailing Stop */}
            {['trailing-stop', 'trailing-stop-limit'].includes(orderType) &&
            <Tabs defaultValue="percent" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="percent">Percentage</TabsTrigger>
                  <TabsTrigger value="amount">USD Amount</TabsTrigger>
                </TabsList>
                <TabsContent value="percent" className="mt-4">
                  <Label>Trailing Percentage (%)</Label>
                  <Input
                  type="number"
                  placeholder="e.g., 1.0 for 1%"
                  value={trailingPercent}
                  onChange={(e) => setTrailingPercent(e.target.value)}
                  step="0.1" />

                  <p className="text-xs text-gray-500 mt-1">
                    Triggers when price reverts by this % from peak
                  </p>
                </TabsContent>
                <TabsContent value="amount" className="mt-4">
                  <Label>Trailing Amount (USD)</Label>
                  <Input
                  type="number"
                  placeholder="e.g., 500"
                  value={trailingAmount}
                  onChange={(e) => setTrailingAmount(e.target.value)}
                  step="1" />

                  <p className="text-xs text-gray-500 mt-1">
                    Triggers when price drops by this USD amount from peak
                  </p>
                </TabsContent>
              </Tabs>
            }

            {/* Iceberg Display Quantity */}
            {orderType === 'iceberg' &&
            <div>
                <Label>Display Quantity</Label>
                <Input
                type="number"
                placeholder="Visible order size"
                value={displayQty}
                onChange={(e) => setDisplayQty(e.target.value)}
                step="0.0001" />

                <p className="text-xs text-gray-500 mt-1">
                  Only this amount will be visible in order book
                </p>
              </div>
            }
          </div>

          {/* Advanced Options */}
          <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <h4 className="font-semibold text-sm">Advanced Options</h4>
            
            <div>
              <Label>Time in Force</Label>
              <Select value={timeInForce} onValueChange={setTimeInForce}>
                <SelectTrigger className="bg-slate-950 px-3 py-2 text-sm rounded-md flex h-10 w-full items-center justify-between border border-input ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gtc">Good Till Canceled (GTC)</SelectItem>
                  <SelectItem value="ioc">Immediate or Cancel (IOC)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {['limit', 'iceberg'].includes(orderType) &&
            <div className="flex items-center space-x-2">
                <Checkbox
                id="post-only"
                checked={postOnly}
                onCheckedChange={setPostOnly} />

                <label htmlFor="post-only" className="text-sm font-medium">
                  Post Only (Maker-only, no taker fees)
                </label>
              </div>
            }

            <div className="flex items-center space-x-2">
              <Checkbox
                id="reduce-only"
                checked={reduceOnly}
                onCheckedChange={setReduceOnly} className="bg-slate-50 rounded-sm peer h-4 w-4 shrink-0 border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />

              <label htmlFor="reduce-only" className="text-sm font-medium">
                Reduce Only (Close positions only)
              </label>
            </div>
          </div>

          {/* One-Triggers-Other (OTO) */}
          {side === 'buy' &&
          <div className="space-y-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  One-Triggers-Other (OTO)
                </h4>
                <Checkbox
                checked={enableOTO}
                onCheckedChange={setEnableOTO} />

              </div>
              
              {enableOTO &&
            <div className="space-y-3 mt-3">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Automatically create a close order when this order fills
                  </p>
                  
                  <div>
                    <Label>Close Order Type</Label>
                    <Select value={otoOrderType} onValueChange={setOtoOrderType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="limit">Limit</SelectItem>
                        <SelectItem value="stop-loss">Stop Loss</SelectItem>
                        <SelectItem value="stop-loss-limit">Stop Loss Limit</SelectItem>
                        <SelectItem value="take-profit">Take Profit</SelectItem>
                        <SelectItem value="take-profit-limit">Take Profit Limit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {['limit', 'stop-loss-limit', 'take-profit-limit'].includes(otoOrderType) &&
              <div>
                      <Label>Close Limit Price (USD)</Label>
                      <Input
                  type="number"
                  placeholder="Target exit price"
                  value={otoLimitPrice}
                  onChange={(e) => setOtoLimitPrice(e.target.value)}
                  step="0.01" />

                    </div>
              }

                  {['stop-loss', 'stop-loss-limit'].includes(otoOrderType) &&
              <div>
                      <Label>Close Stop Price (USD)</Label>
                      <Input
                  type="number"
                  placeholder="Stop loss trigger"
                  value={otoStopPrice}
                  onChange={(e) => setOtoStopPrice(e.target.value)}
                  step="0.01" />

                    </div>
              }
                </div>
            }
            </div>
          }

          {/* Order Summary */}
          <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <h4 className="font-semibold mb-2">Order Summary</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Asset:</span>
                <span className="font-medium">{asset.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Side:</span>
                <Badge variant={side === 'buy' ? 'default' : 'destructive'}>
                  {side?.toUpperCase() || 'N/A'}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Quantity:</span>
                <span className="font-medium">{quantity}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Order Type:</span>
                <span className="font-medium">{currentOrderInfo.label}</span>
              </div>
              {limitPrice &&
              <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Limit Price:</span>
                  <span className="font-medium">${parseFloat(limitPrice).toFixed(2)}</span>
                </div>
              }
              {enableOTO &&
              <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Auto-Close:</span>
                  <Badge variant="outline" className="text-xs">
                    {otoOrderType} @ ${otoLimitPrice || otoStopPrice || '—'}
                  </Badge>
                </div>
              }
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="bg-red-700 px-4 py-2 text-sm font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input hover:bg-accent hover:text-accent-foreground h-10 flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleExecute}
              disabled={isExecuting || !asset || !asset.symbol}
              className="flex-1 bg-green-600 hover:bg-green-700">

              {isExecuting ? 'Placing Order...' : `Place ${currentOrderInfo.label}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>);

}