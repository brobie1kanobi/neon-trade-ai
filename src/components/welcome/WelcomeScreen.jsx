
import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap, TrendingUp, Bot, Shield, ArrowRight, Sparkles, Loader2 } from "lucide-react";
import { UserSettings } from "@/entities/all";

export default function WelcomeScreen({ user, onComplete }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);

  const features = [
    {
      icon: <TrendingUp className="w-8 h-8 text-blue-500" />,
      title: "Real-Time Market Data",
      description: "Get live price updates, market sentiment analysis, and detailed charts for cryptocurrencies and stocks. Stay ahead with instant notifications."
    },
    {
      icon: <Shield className="w-8 h-8 text-green-500" />,
      title: "Safe Simulation Mode",
      description: "Practice trading with virtual money first. Learn strategies and test the AI without any financial risk. Switch to real trading when you're ready."
    },
    {
      icon: <Bot className="w-8 h-8 neon-text" />,
      title: "AI Trading Assistant",
      description: "Our advanced AI analyzes market trends and executes trades based on your preferences. Set your risk levels and let the AI work for you 24/7."
    },
    {
      icon: <Zap className="w-8 h-8 text-yellow-500" />,
      title: "Automated Trading Rules",
      description: "Set gain and loss margins, and our system will automatically sell your assets when your targets are hit. No more watching charts all day!"
    }
  ];


  const handleComplete = async () => {
    setIsCompleting(true);
    try {
      // Mark user as having seen welcome screen
      const existingSettings = await UserSettings.filter({ created_by: user.email });
      if (existingSettings.length > 0) {
        await UserSettings.update(existingSettings[0].id, { has_seen_welcome: true });
      } else {
        await UserSettings.create({
          has_seen_welcome: true,
          created_by: user.email,
          dark_mode: true // Also ensure default is set
        });
      }
      onComplete();
    } catch (error) {
      console.error("Failed to save welcome completion:", error);
      // Still proceed so user isn't stuck
      onComplete();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-black">
      <Card className="w-full max-w-2xl border-2 bg-[#1a1a1a] text-white" style={{ borderColor: 'var(--neon-green)' }}>
        <CardHeader className="text-center">
          <div className="flex justify-center items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center neon-glow">
               <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68b9d30ff048d7f24e2fe484/83b0737a9_7fed9c694_a365a9198_logo.png" alt="App Logo" className="w-full h-full object-contain" />
            </div>
            <CardTitle className="text-3xl font-bold neon-text">Welcome to NeonTrade AI!</CardTitle>
          </div>
          <p className="text-lg text-gray-300">
            Hi {user?.full_name?.split(' ')[0] || 'there'}! Thanks for joining us. Let's show you what makes us special.
          </p>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <AnimatePresence mode="wait">
            {currentStep === 0 &&
            <motion.div
              key="intro"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              className="space-y-4">

                <div className="text-center space-y-4">
                  <Sparkles className="w-16 h-16 mx-auto neon-text" />
                  <h3 className="text-xl font-semibold text-white">
                    Your AI-Powered Trading Journey Starts Here
                  </h3>
                  <p className="text-gray-300 leading-relaxed">
                    NeonTrade AI combines cutting-edge artificial intelligence with real-time market data to help you make smarter trading decisions. Whether you're a beginner or experienced trader, our platform adapts to your style and helps you grow your portfolio.
                  </p>
                  <p className="text-gray-300 leading-relaxed">
                    We're not just another trading app - we're your intelligent trading partner that learns your preferences, manages risk automatically, and provides insights that traditional platforms can't match.
                  </p>
                </div>
              </motion.div>
            }
            
            {currentStep === 1 &&
            <motion.div
              key="features"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              className="space-y-4">

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {features.map((feature) =>
                <div key={feature.title} className="flex items-start gap-3 p-3">
                      {feature.icon}
                      <div>
                        <h4 className="font-semibold text-white">{feature.title}</h4>
                        <p className="text-sm text-gray-300">{feature.description}</p>
                      </div>
                    </div>
                )}
                </div>
              </motion.div>
            }
          </AnimatePresence>

          <div className="flex items-center justify-between pt-4">
            <div className="flex gap-2">
                <div className={`w-2 h-2 rounded-full transition-colors ${currentStep === 0 ? 'bg-green-500' : 'bg-gray-600'}`}></div>
                <div className={`w-2 h-2 rounded-full transition-colors ${currentStep === 1 ? 'bg-green-500' : 'bg-gray-600'}`}></div>
            </div>

            {currentStep === 0 ?
            <Button onClick={() => setCurrentStep(1)} className="neon-glow bg-green-600 hover:bg-green-700">
                    Next <ArrowRight className="w-4 h-4 ml-2" />
                </Button> :

            <Button onClick={handleComplete} className="neon-glow bg-green-600 hover:bg-green-700" disabled={isCompleting}>
                    {isCompleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Get Started'}
                </Button>
            }
          </div>
        </CardContent>
      </Card>
    </div>);

}
