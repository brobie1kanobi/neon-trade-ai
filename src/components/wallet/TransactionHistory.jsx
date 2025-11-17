import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
import { format } from "date-fns";
import { useSettings } from "@/components/utils/SettingsContext";

export default function TransactionHistory({ transactions, isSimMode = true }) {
  const { settings } = useSettings();
  const is24h = (settings?.time_format || "12h") === "24h";
  const dateFmt = is24h ? "MMM d, yyyy • HH:mm" : "MMM d, yyyy • h:mm a";

  // CRITICAL: Filter transactions based on current mode
  const filteredTransactions = transactions.filter(tx => {
    // If no is_real_money field exists, assume it's a sim transaction
    const isRealMoney = tx.is_real_money === true;
    
    // Show real money transactions in live mode, sim transactions in sim mode
    return isSimMode ? !isRealMoney : isRealMoney;
  });

  if (filteredTransactions.length === 0) {
    return (
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <History className="w-5 h-5 neon-text" />
              Transaction History
            </CardTitle>
            {isSimMode ? (
              <Badge variant="outline" className="text-xs">Demo</Badge>
            ) : (
              <Badge className="bg-green-100 text-green-800 text-xs">Live</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p style={{ color: 'var(--text-secondary)' }}>
              {isSimMode 
                ? 'No demo transactions yet. Make your first deposit or withdrawal above!' 
                : 'No live transactions yet. Connect your Kraken account to start trading!'}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const statusColors = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    completed: "bg-green-100 text-green-800 border-green-200", 
    failed: "bg-red-100 text-red-800 border-red-200"
  };

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <History className="w-5 h-5 neon-text" />
            Transaction History
          </CardTitle>
          {isSimMode ? (
            <Badge variant="outline" className="text-xs">Demo</Badge>
          ) : (
            <Badge className="bg-green-100 text-green-800 text-xs">Live</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {filteredTransactions.map((transaction) => (
          <div key={transaction.id} 
               className="flex items-center justify-between p-3 rounded-lg border"
               style={{ 
                 backgroundColor: 'var(--secondary-bg)', 
                 borderColor: 'var(--border-color)' 
               }}>
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                transaction.type === 'deposit' ? 'bg-green-100 dark:bg-green-900' : 'bg-red-100 dark:bg-red-900'
              }`}>
                {transaction.type === 'deposit' ? (
                  <ArrowUpCircle className="w-4 h-4 text-green-600" />
                ) : (
                  <ArrowDownCircle className="w-4 h-4 text-red-600" />
                )}
              </div>
              <div>
                <p className="font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                  {transaction.type}
                  {transaction.bank_account && transaction.bank_account !== 'Demo Account' && (
                    <span className="text-xs ml-2 opacity-70">• {transaction.bank_account}</span>
                  )}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {format(new Date(transaction.created_date), dateFmt)}
                </p>
              </div>
            </div>
            
            <div className="text-right space-y-1">
              <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                {transaction.type === 'deposit' ? '+' : '-'}${transaction.amount.toFixed(2)}
              </p>
              <Badge variant="outline" className={`text-xs ${statusColors[transaction.status]}`}>
                {transaction.status}
              </Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}