import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

import { createPageUrl } from '@/utils';

export default function PaymentSuccess() {
  const [status, setStatus] = useState('processing'); // processing, success, error
  const [message, setMessage] = useState('Processing your payment...');
  const location = useLocation();

  useEffect(() => {
    setStatus('error');
    setMessage('Payments are disabled in this app.');
  }, []);

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
              Payments Disabled
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