import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, Loader2, Shield } from "lucide-react";
import { User } from "@/entities/all";

import { toast } from "sonner";

export default function RefundManagement() {
  const [sessionId, setSessionId] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const checkAdminAccess = async () => {
      try {
        const currentUser = await User.me();
        setUser(currentUser);
        
        if (currentUser.role !== 'admin') {
          toast.error("Access denied. Admin privileges required.");
        }
      } catch (error) {
        console.error("Error checking user role:", error);
        toast.error("Error verifying access permissions.");
      }
    };
    
    checkAdminAccess();
  }, []);

  const handleProcessRefund = async (e) => {
    e.preventDefault();
    
    if (!sessionId.trim()) {
      toast.error("Please enter a valid session ID");
      return;
    }

    if (user?.role !== 'admin') {
      toast.error("Admin access required");
      return;
    }

    setIsProcessing(true);
    setResult(null);

    try {
      const response = await stripePayments({
        action: 'processRefund',
        payload: { sessionId: sessionId.trim(), adminUserEmail: user.email }
      });

      if (response.data) {
        setResult(response.data);
        toast.success("Refund processed successfully");
      } else {
        throw new Error("Failed to process refund");
      }

    } catch (error) {
      console.error("Refund processing error:", error);
      toast.error(error.message || "Failed to process refund");
    } finally {
      setIsProcessing(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin" />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (user.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--primary-bg)' }}>
        <Card className="w-full max-w-md border-red-200">
          <CardContent className="p-8 text-center">
            <Shield className="w-12 h-12 mx-auto mb-4 text-red-500" />
            <h2 className="text-xl font-bold mb-2 text-red-600">Access Denied</h2>
            <p style={{ color: 'var(--text-secondary)' }}>
              This page requires administrator privileges.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-8" style={{ backgroundColor: 'var(--primary-bg)' }}>
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              Refund Management
              <Badge variant="destructive" className="text-xs">Admin Only</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-yellow-600" />
                <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  Important Notice
                </span>
              </div>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                This will reverse the effects of a successful payment, including removing credits or canceling subscriptions. 
                Only use this for legitimate refund requests.
              </p>
            </div>

            <form onSubmit={handleProcessRefund} className="space-y-4">
              <div>
                <Label htmlFor="sessionId">Stripe Session ID</Label>
                <Input
                  id="sessionId"
                  placeholder="cs_test_..."
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  disabled={isProcessing}
                />
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Enter the Stripe checkout session ID that needs to be refunded
                </p>
              </div>

              <Button
                type="submit"
                disabled={isProcessing || !sessionId.trim()}
                className="w-full bg-red-600 hover:bg-red-700"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing Refund...
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    Process Refund Reversal
                  </>
                )}
              </Button>
            </form>

            {result && (
              <Card className="border-green-200">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <h3 className="font-semibold text-green-700">
                      {result.alreadyProcessed ? 'Already Processed' : 'Refund Processed'}
                    </h3>
                  </div>
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Type:</span>
                      <Badge variant="outline">{result.type}</Badge>
                    </div>
                    
                    {result.credits_removed && (
                      <div className="flex justify-between">
                        <span>Credits Removed:</span>
                        <span className="font-medium">{result.credits_removed}</span>
                      </div>
                    )}
                    
                    {result.new_balance !== undefined && (
                      <div className="flex justify-between">
                        <span>New Credit Balance:</span>
                        <span className="font-medium">{result.new_balance}</span>
                      </div>
                    )}
                    
                    {result.subscription_cancelled && (
                      <div className="flex justify-between">
                        <span>Subscription:</span>
                        <span className="font-medium text-red-600">Cancelled</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}