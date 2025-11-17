import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { stripePayments } from '@/functions/stripePayments';
import { createPageUrl } from '@/utils';

export default function PaymentSuccess() {
  const [status, setStatus] = useState('processing'); // processing, success, error
  const [message, setMessage] = useState('Processing your payment...');
  const location = useLocation();

  useEffect(() => {
    const verifySession = async () => {
      const urlParams = new URLSearchParams(location.search);
      const sessionId = urlParams.get('session_id');

      if (!sessionId) {
        setStatus('error');
        setMessage('No session ID found. Payment cannot be verified.');
        return;
      }

      try {
        const { data: result } = await stripePayments({
          action: 'verifyPaymentAndUpdate',
          payload: { sessionId }
        });

        if (!result.success) {
          throw new Error(result.error || 'Verification failed.');
        }

        setStatus('success');
        if (result.data.alreadyProcessed) {
          setMessage('This transaction has already been processed. Your account is up to date.');
        } else if (result.data.type === 'subscription') {
          setMessage(`Subscription successful! ${result.data.credits_added || 0} credits have been added to your account.`);
        } else {
          setMessage('Payment successful! Your account has been updated.');
        }

      } catch (err) {
        setStatus('error');
        setMessage(err.message || 'An error occurred while verifying your payment. Please contact support.');
        console.error("Payment verification error:", err);
      }
    };

    verifySession();
  }, [location]);

  const StatusIcon = () => {
    if (status === 'processing') return <Loader2 className="w-16 h-16 animate-spin text-blue-500" />;
    if (status === 'success') return <CheckCircle className="w-16 h-16 text-green-500" />;
    if (status === 'error') return <XCircle className="w-16 h-16 text-red-500" />;
    return null;
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--primary-bg)' }}>
      <Card className="w-full max-w-md text-center" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <CardTitle className="flex flex-col items-center gap-4">
            <StatusIcon />
            <span style={{ color: 'var(--text-primary)' }}>
              {status === 'processing' && 'Processing...'}
              {status === 'success' && 'Payment Successful'}
              {status === 'error' && 'Payment Error'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-lg" style={{ color: 'var(--text-secondary)' }}>
            {message}
          </p>
          <Button asChild className="w-full neon-glow">
            <Link to={createPageUrl('Settings')}>
              Return to Settings
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}