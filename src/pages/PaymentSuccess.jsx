import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

export default function PaymentSuccess() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--primary-bg)' }}>
      <Card className="w-full max-w-md text-center" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <CardTitle style={{ color: 'var(--text-primary)' }}>Payments Disabled</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-lg" style={{ color: 'var(--text-secondary)' }}>
            This app no longer uses Stripe or any payment provider.
          </p>
          <Button asChild className="w-full neon-glow">
            <Link to="/Settings">Return to Settings</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}