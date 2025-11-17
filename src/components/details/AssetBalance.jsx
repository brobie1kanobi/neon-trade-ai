
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, TrendingUp, TrendingDown, DollarSign, PieChart } from "lucide-react";

export default function AssetBalance({ holding, assetData }) {
    if (!holding || holding.quantity <= 0) {
        return (
            <Card style={{ backgroundColor: 'var(--secondary-bg)' }}>
                <CardContent className="p-6 text-center">
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>You do not currently hold this asset.</p>
                </CardContent>
            </Card>
        );
    }

    const currentValue = holding.quantity * assetData.price;
    const costBasis = holding.quantity * holding.average_cost_price;
    const pnl = currentValue - costBasis;
    const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
    const isPositive = pnl >= 0;

    return (
        <Card style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                    <Wallet className="w-5 h-5 neon-text"/>
                    Your Position
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="text-center pb-4 border-b" style={{borderColor: 'var(--border-color)'}}>
                    <p className="text-3xl font-bold" style={{color: 'var(--text-primary)'}}>${currentValue.toFixed(2)}</p>
                    <p className="text-sm" style={{color: 'var(--text-secondary)'}}>Current Value</p>
                </div>

                <div className="flex justify-between items-center text-sm pt-2">
                    <span style={{ color: 'var(--text-secondary)' }}>Quantity Owned</span>
                    <p className="font-semibold">{holding.quantity.toFixed(6)}</p>
                </div>
                <div className="flex justify-between items-center text-sm">
                    <span style={{ color: 'var(--text-secondary)' }}>Average Cost</span>
                    <p className="font-semibold">${holding.average_cost_price.toFixed(2)}</p>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span style={{ color: 'var(--text-secondary)' }}>Current Value</span>
                  <p className="font-semibold flex items-center gap-1"><DollarSign className="w-3 h-3"/> {currentValue.toFixed(2)}</p>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span style={{ color: 'var(--text-secondary)' }}>Unrealized P/L</span>
                  <p className={`flex items-center gap-1 font-semibold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                    {isPositive ? <TrendingUp className="w-4 h-4"/> : <TrendingDown className="w-4 h-4"/>}
                    <span>${pnl.toFixed(2)} ({pnlPercent.toFixed(2)}%)</span>
                  </p>
                </div>
            </CardContent>
        </Card>
    );
}
