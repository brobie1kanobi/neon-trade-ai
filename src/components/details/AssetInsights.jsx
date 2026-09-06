import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Zap, Newspaper, BarChart, BrainCircuit } from "lucide-react";
import { base44 } from "@/api/base44Client";
import ReactMarkdown from 'react-markdown';

export default function AssetInsights({ symbol, name }) {
    const [insights, setInsights] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchInsights = async () => {
            if (!symbol || !name) return;
            setIsLoading(true);
            try {
                const res = await base44.functions.invoke('assetAiInsights', {
                    action: 'assetInsights',
                    symbol
                });
                const data = res?.data || res;
                setInsights(data?.insights || { error: "Could not load insights at this time." });
            } catch (error) {
                console.error("Failed to fetch asset insights:", error);
                setInsights({ error: "Could not load insights at this time." });
            } finally {
                setIsLoading(false);
            }
        };

        fetchInsights();
    }, [symbol, name]);
    
    const getSentimentBadge = (sentiment) => {
        switch (sentiment) {
            case 'Bullish': return "bg-green-100 text-green-800 border-green-200";
            case 'Bearish': return "bg-red-100 text-red-800 border-red-200";
            default: return "bg-yellow-100 text-yellow-800 border-yellow-200";
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center p-10">
                <Loader2 className="w-8 h-8 animate-spin neon-text"/>
                <p className="ml-2" style={{color: 'var(--text-secondary)'}}>Generating AI Insights...</p>
            </div>
        );
    }
    
    if (insights?.error) {
        return <p className="text-center text-red-500 p-4">{insights.error}</p>;
    }
    
    if (!insights) return null;

    return (
        <div className="space-y-4">
             <Card style={{ backgroundColor: 'var(--secondary-bg)' }}>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <BrainCircuit className="w-5 h-5 neon-text"/>
                        AI Sentiment
                    </CardTitle>
                    {insights.sentiment && <Badge className={getSentimentBadge(insights.sentiment)}>{insights.sentiment}</Badge>}
                </CardHeader>
                <CardContent>
                    <p className="text-sm" style={{color: 'var(--text-secondary)'}}>{insights.summary}</p>
                </CardContent>
            </Card>

            <Card style={{ backgroundColor: 'var(--secondary-bg)' }}>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                         <BarChart className="w-5 h-5 neon-text"/>
                        Technical Analysis
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm" style={{color: 'var(--text-secondary)'}}>{insights.technical_analysis}</p>
                </CardContent>
            </Card>
            
            <Card style={{ backgroundColor: 'var(--secondary-bg)' }}>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Newspaper className="w-5 h-5 neon-text"/>
                        Recent News
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="prose prose-sm prose-invert max-w-none text-sm" style={{color: 'var(--text-secondary)'}}>
                         <ReactMarkdown>{insights.recent_news}</ReactMarkdown>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}