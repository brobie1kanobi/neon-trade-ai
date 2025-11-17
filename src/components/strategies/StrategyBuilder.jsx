import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';

export default function StrategyBuilder({ onClose, onSave }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    asset_type: 'crypto',
    symbols: '',
    entry_conditions: 'RSI_OVERSOLD',
    exit_conditions: 'RSI_OVERBOUGHT',
    position_size: 10,
    stop_loss_percent: 5,
    take_profit_percent: 10,
    mode: 'simulation',
    indicators: {
      rsi_period: 14,
      rsi_overbought: 70,
      rsi_oversold: 30,
      macd_fast: 12,
      macd_slow: 26,
      macd_signal: 9,
      ma_short: 20,
      ma_long: 50
    }
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const symbols = formData.symbols.split(',').map(s => s.trim().toUpperCase());
      
      await base44.entities.TradingStrategy.create({
        ...formData,
        symbols,
        is_active: false
      });
      
      toast.success('Strategy created successfully');
      onSave();
    } catch (error) {
      console.error('Failed to create strategy:', error);
      toast.error('Failed to create strategy');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={onClose}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Create Trading Strategy
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card style={{ backgroundColor: 'var(--card-bg)' }}>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Strategy Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., RSI Oversold Strategy"
                required
              />
            </div>
            
            <div>
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe your strategy..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Asset Type</Label>
                <Select value={formData.asset_type} onValueChange={(v) => setFormData({ ...formData, asset_type: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="crypto">Crypto</SelectItem>
                    <SelectItem value="stock">Stock</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label>Trading Mode</Label>
                <Select value={formData.mode} onValueChange={(v) => setFormData({ ...formData, mode: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simulation">Simulation</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Symbols (comma-separated)</Label>
              <Input
                value={formData.symbols}
                onChange={(e) => setFormData({ ...formData, symbols: e.target.value })}
                placeholder="e.g., BTC, ETH, SOL"
                required
              />
            </div>
          </CardContent>
        </Card>

        <Card style={{ backgroundColor: 'var(--card-bg)' }}>
          <CardHeader>
            <CardTitle>Entry & Exit Conditions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Entry Signal</Label>
              <Select value={formData.entry_conditions} onValueChange={(v) => setFormData({ ...formData, entry_conditions: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RSI_OVERSOLD">RSI Oversold</SelectItem>
                  <SelectItem value="MACD_BULLISH_CROSS">MACD Bullish Cross</SelectItem>
                  <SelectItem value="MA_CROSS_UP">MA Cross Up</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Exit Signal</Label>
              <Select value={formData.exit_conditions} onValueChange={(v) => setFormData({ ...formData, exit_conditions: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RSI_OVERBOUGHT">RSI Overbought</SelectItem>
                  <SelectItem value="MACD_BEARISH_CROSS">MACD Bearish Cross</SelectItem>
                  <SelectItem value="MA_CROSS_DOWN">MA Cross Down</SelectItem>
                  <SelectItem value="STOP_LOSS">Stop Loss</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card style={{ backgroundColor: 'var(--card-bg)' }}>
          <CardHeader>
            <CardTitle>Technical Indicators</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>RSI Period</Label>
                <Input
                  type="number"
                  value={formData.indicators.rsi_period}
                  onChange={(e) => setFormData({
                    ...formData,
                    indicators: { ...formData.indicators, rsi_period: Number(e.target.value) }
                  })}
                />
              </div>
              <div>
                <Label>RSI Overbought</Label>
                <Input
                  type="number"
                  value={formData.indicators.rsi_overbought}
                  onChange={(e) => setFormData({
                    ...formData,
                    indicators: { ...formData.indicators, rsi_overbought: Number(e.target.value) }
                  })}
                />
              </div>
              <div>
                <Label>RSI Oversold</Label>
                <Input
                  type="number"
                  value={formData.indicators.rsi_oversold}
                  onChange={(e) => setFormData({
                    ...formData,
                    indicators: { ...formData.indicators, rsi_oversold: Number(e.target.value) }
                  })}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>MACD Fast</Label>
                <Input
                  type="number"
                  value={formData.indicators.macd_fast}
                  onChange={(e) => setFormData({
                    ...formData,
                    indicators: { ...formData.indicators, macd_fast: Number(e.target.value) }
                  })}
                />
              </div>
              <div>
                <Label>MACD Slow</Label>
                <Input
                  type="number"
                  value={formData.indicators.macd_slow}
                  onChange={(e) => setFormData({
                    ...formData,
                    indicators: { ...formData.indicators, macd_slow: Number(e.target.value) }
                  })}
                />
              </div>
              <div>
                <Label>MACD Signal</Label>
                <Input
                  type="number"
                  value={formData.indicators.macd_signal}
                  onChange={(e) => setFormData({
                    ...formData,
                    indicators: { ...formData.indicators, macd_signal: Number(e.target.value) }
                  })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>MA Short Period</Label>
                <Input
                  type="number"
                  value={formData.indicators.ma_short}
                  onChange={(e) => setFormData({
                    ...formData,
                    indicators: { ...formData.indicators, ma_short: Number(e.target.value) }
                  })}
                />
              </div>
              <div>
                <Label>MA Long Period</Label>
                <Input
                  type="number"
                  value={formData.indicators.ma_long}
                  onChange={(e) => setFormData({
                    ...formData,
                    indicators: { ...formData.indicators, ma_long: Number(e.target.value) }
                  })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card style={{ backgroundColor: 'var(--card-bg)' }}>
          <CardHeader>
            <CardTitle>Risk Management</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Position Size (%)</Label>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={formData.position_size}
                  onChange={(e) => setFormData({ ...formData, position_size: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Stop Loss (%)</Label>
                <Input
                  type="number"
                  value={formData.stop_loss_percent}
                  onChange={(e) => setFormData({ ...formData, stop_loss_percent: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Take Profit (%)</Label>
                <Input
                  type="number"
                  value={formData.take_profit_percent}
                  onChange={(e) => setFormData({ ...formData, take_profit_percent: Number(e.target.value) })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700">
            Create Strategy
          </Button>
        </div>
      </form>
    </div>
  );
}