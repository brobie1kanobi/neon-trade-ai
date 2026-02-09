import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createPageUrl } from "@/utils";
import { ArrowUpCircle, ArrowDownCircle, PieChart, BarChart3 } from "lucide-react";

export default function QuickActions() {
  const actions = [
  {
    title: "Deposit",
    url: createPageUrl("Wallet?action=deposit"),
    color: "text-green-500",
    icon: ArrowUpCircle
  },
  {
    title: "Withdraw",
    url: createPageUrl("Wallet?action=withdrawal"),
    color: "text-blue-500",
    icon: ArrowDownCircle
  },
  {
    title: "Portfolio",
    url: createPageUrl("Portfolio"),
    color: "text-purple-500",
    icon: PieChart
  },
  {
    title: "AI Analysis",
    url: createPageUrl("MarketAnalysis"),
    color: "neon-text",
    icon: BarChart3
  }];


  return (
    <>
      <MarketAnalystModal isOpen={isAnalystOpen} onClose={() => setIsAnalystOpen(false)} />
      
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardContent className="p-4">
          <div className="mb-4">
            <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Quick Actions
            </h3>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Try our free Market Analysis AI on the end 👉💹
            </p>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {actions.map((action) => {
              if (action.url) {
                return (
                  <a key={action.title} href={action.url}>
                    <Button
                      variant="ghost"
                      className="flex flex-col items-center gap-2 h-auto p-3 w-full hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-all duration-200 hover:-translate-y-1 hover:scale-105 hover:shadow-lg">

                      <div className={`w-6 h-6 ${action.color}`}>
                        {action.title === "Deposit" && <ArrowUpCircle className="w-6 h-6" />}
                        {action.title === "Withdraw" && <ArrowDownCircle className="w-6 h-6" />}
                        {action.title === "Portfolio" && <PieChart className="w-6 h-6" />}
                        {action.title === "Market Analysis" && <TrendingUp className="w-6 h-6" />}
                      </div>
                      <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                        {action.title}
                      </span>
                    </Button>
                  </a>);

              } else {
                return (
                  <Button
                    key={action.title}
                    variant="ghost"
                    className="flex flex-col items-center gap-2 h-auto p-3 w-full hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-all duration-200 hover:-translate-y-1 hover:scale-105 hover:shadow-lg"
                    onClick={action.action}>

                    <TrendingUp className={`w-6 h-6 ${action.color}`} />
                    <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      {action.title}
                    </span>
                  </Button>);

              }
            })}
          </div>
        </CardContent>
      </Card>
    </>);

}