import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { stripePayments } from "@/functions/stripePayments";

export default function CreditsSection({ creditsBalance = 0 }) {
  const [isLoading, setIsLoading] = useState(false);

  const handleGetCredits = async () => {
    setIsLoading(true);
    try {
      const response = await stripePayments({
        action: 'createCreditsSession',
        payload: {
          packageType: 'starter'
        }
      });

      const checkoutData = response.data;

      if (checkoutData?.success && checkoutData?.data?.url) {
        window.open(checkoutData.data.url, '_blank');
      } else {
        const errorMessage = checkoutData?.error || "Failed to create checkout session. Please try again.";
        toast.error(errorMessage);
      }
    } catch (error) {
      console.error("Credits checkout error:", error);
      const errorMessage = error.response?.data?.error || "An error occurred. Please try again.";
      toast.error(errorMessage);
    }
    setIsLoading(false);
  };

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="text-2xl font-semibold leading-none tracking-tight flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>AI Trading Credits
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-4 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
          <div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Current Balance
            </p>
            <p className="text-2xl font-bold neon-text">
              {creditsBalance} credits
            </p>
          </div>
          <Badge className={creditsBalance > 0 ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"}>
            {creditsBalance > 0 ? "Active" : "Low Balance"}
          </Badge>
        </div>

        <div className="space-y-2">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Credits will be used for AI-powered live trading. Each buy order in live mode consumes 1 credit.

          </p>
          
          <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-700">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-400 mb-1">💡 Starter Subscription

            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              100 credits for $10 - Perfect for getting started with live AI trading
            </p>
          </div>
        </div>

        <Button
          onClick={handleGetCredits}
          disabled={true}
          className="w-full">

          Coming Soon
        </Button>

        <p className="text-xs text-center" style={{ color: 'var(--text-secondary)' }}>
          Simulation mode trades are always free and don't require credits
        </p>
      </CardContent>
    </Card>);

}