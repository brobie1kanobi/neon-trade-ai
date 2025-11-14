
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowUpCircle, ArrowDownCircle, X, Loader2, CreditCard, Shield, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { stripePayments } from "@/functions/stripePayments";

export default function TransactionForm({ type, wallet, settings, onSubmit, onCancel, isSimMode = true }) {
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = amount && parseFloat(amount) > 0;

  // Helper to round to 2 decimals safely
  const toMoney = (n) => {
    const x = Number(n || 0);
    return Math.round((x + Number.EPSILON) * 100) / 100;
  };

  // Epsilon tolerance for floating point comparisons
  const EPS = 0.005;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);

    try {
      const transactionAmount = toMoney(parseFloat(amount));

      if (type === 'deposit') {
        if (isSimMode) {
          // Simulate deposit in demo mode
          await onSubmit({
            type: 'deposit',
            amount: transactionAmount,
            status: 'completed',
            bank_account: 'Demo Account',
            reference_id: `demo_${Date.now()}`
          });
          toast.success(`Demo deposit of $${transactionAmount} completed!`);
        } else {
          // Create real Stripe checkout session
          const response = await stripePayments({
            action: 'createDepositSession',
            payload: { amount: transactionAmount }
          });

          if (response.data?.success && response.data?.data?.url) {
            toast.success("Redirecting to secure payment...");
            // Open Stripe in a new tab to avoid issues with embedded iframes or security policies
            window.open(response.data.data.url, '_blank');
          } else {
            const errorMessage = response.data?.error || "Failed to create payment session";
            throw new Error(errorMessage);
          }
        }
      } else {
        // Withdrawal
        if (isSimMode) {
          const currentBalance = wallet?.cash_balance || 0;
          // Allow withdrawing up to full available balance with epsilon tolerance
          if (transactionAmount > (currentBalance + EPS)) {
            toast.error("Insufficient demo funds for withdrawal");
            setIsSubmitting(false); // Stop submitting state if validation fails
            return;
          }

          await onSubmit({
            type: 'withdrawal',
            amount: transactionAmount,
            status: 'completed',
            bank_account: 'Demo Account',
            reference_id: `demo_withdrawal_${Date.now()}`
          });
          toast.success(`Demo withdrawal of $${transactionAmount} completed!`);
        } else {
          toast.info("Real money withdrawals are coming soon!");
          onCancel();
        }
      }
    } catch (error) {
      console.error('Transaction error:', error);
      toast.error(`Unable to process ${type}. Please try again.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentBalance = isSimMode ? wallet?.cash_balance || 0 : wallet?.real_cash_balance || 0;

  return (
    <Card className="border-2" style={{
      backgroundColor: 'var(--card-bg)',
      borderColor: type === 'deposit' ? '#39FF14' : '#ef4444'
    }}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              {type === 'deposit' ?
              <ArrowUpCircle className="w-5 h-5 text-green-500" /> :

              <ArrowDownCircle className="w-5 h-5 text-red-500" />
              }
              {type === 'deposit' ? isSimMode ? 'Add Demo Funds' : 'Add Real Funds' : isSimMode ? 'Demo Withdraw' : 'Withdraw Funds'}
            </CardTitle>
            {isSimMode && <Badge variant="outline" className="text-xs">Demo Mode</Badge>}
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (USD)</Label>
            <div className="flex gap-2">
              <Input
                id="amount"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                // Deposits keep existing minimums; withdrawals allow down to $0.01
                min={type === 'withdrawal' ? "0.01" : (isSimMode ? "1.00" : "5.00")}
                step="0.01"
                className="flex-1"
              />
              {type === 'withdrawal' && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAmount(toMoney(currentBalance).toFixed(2))}
                  disabled={currentBalance <= 0}
                >
                  Max
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between text-sm">
              <span style={{ color: 'var(--text-secondary)' }}>
                {type === 'withdrawal'
                  ? 'Minimum: $0.01'
                  : (isSimMode ? 'Minimum: $1.00' : 'Minimum: $5.00')}
              </span>
              {type === 'withdrawal' &&
              <span style={{ color: 'var(--text-secondary)' }}>
                  Available: ${toMoney(currentBalance).toFixed(2)}
                </span>
              }
            </div>
          </div>

          {type === 'deposit' && !isSimMode &&
          <div className="p-3 rounded-lg border" style={{
            backgroundColor: 'var(--secondary-bg)',
            borderColor: 'var(--border-color)'
          }}>
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-blue-500" />
                <CreditCard className="w-4 h-4 text-blue-500" />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Secure Payment via Stripe
                </span>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Your payment information is encrypted and secure. Powered by Stripe.
              </p>
            </div>
          }

          {type === 'withdrawal' && !isSimMode &&
          <div className="p-3 rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-900/20">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-medium text-orange-700 dark:text-orange-300">
                  Coming Soon
                </span>
              </div>
              <p className="text-xs text-orange-600 dark:text-orange-400">
                Real money withdrawals will be available soon. Demo withdrawals work normally.
              </p>
            </div>
          }

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onCancel}
              disabled={isSubmitting}>

              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !canSubmit ||
                isSubmitting ||
                (type === 'withdrawal' && (!isSimMode || parseFloat(amount || '0') <= 0))
              }
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 text-primary-foreground h-10 px-4 py-2 flex-1 neon-glow bg-green-600 hover:bg-green-700">


              {isSubmitting ?
              <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {type === 'deposit' ? (isSimMode ? 'Adding...' : 'Creating Payment...') : 'Processing...'}
                </> :

              <>
                  {type === 'deposit' ? <CreditCard className="w-4 h-4 mr-2" /> : <ArrowDownCircle className="w-4 h-4 mr-2" />}
                  {type === 'deposit'
                    ? `${isSimMode ? 'Add' : 'Deposit'} $${amount || '0.00'}`
                    : `Withdraw $${amount || '0.00'}`}
                </>
              }
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>);

}
