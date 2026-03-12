import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield } from 'lucide-react';

export default function RefundManagement() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--primary-bg)' }}>
      <Card className="w-full max-w-md" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Shield className="w-5 h-5 text-red-500" /> Refunds Disabled
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Stripe and related refund tools have been removed. No refund processing is available in this app.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}