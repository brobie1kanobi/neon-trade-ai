import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Shield, Clock, CreditCard, AlertTriangle } from "lucide-react";

export default function RefundPolicyModal({ isOpen, onClose }) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Shield className="w-5 h-5 text-blue-500" />
            Refund Policy
          </DialogTitle>
          <DialogDescription style={{ color: 'var(--text-secondary)' }}>
            Understanding our 7-day refund policy for NeonTrade AI services
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6" style={{ color: 'var(--text-primary)' }}>
            
            {/* 7-Day Policy Section */}
            <div className="p-4 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-400">7-Day Refund Window</h3>
              </div>
              <p className="text-blue-700 dark:text-blue-300 mb-2">
                We offer a full refund within 7 days of your purchase, no questions asked.
              </p>
              <ul className="list-disc list-inside text-sm text-blue-600 dark:text-blue-400 space-y-1">
                <li>Refund window starts from the date of purchase</li>
                <li>Full refund of the original purchase amount</li>
                <li>Processing time: 3-5 business days</li>
              </ul>
            </div>

            {/* What's Covered */}
            <div>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-green-600" />
                What's Covered
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-green-500 font-bold">✓</span>
                  <p><strong>Credit Packages:</strong> Full refund of unused credits purchased within 7 days</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-500 font-bold">✓</span>
                  <p><strong>Subscription Plans:</strong> Pro subscription fees (prorated refund if partially used)</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-500 font-bold">✓</span>
                  <p><strong>Service Issues:</strong> Technical problems preventing normal use of services</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-500 font-bold">✓</span>
                  <p><strong>Billing Errors:</strong> Incorrect charges or duplicate transactions</p>
                </div>
              </div>
            </div>

            {/* Important Notes */}
            <div className="p-4 rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-900/20">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
                <h3 className="text-lg font-semibold text-orange-800 dark:text-orange-400">Important Notes</h3>
              </div>
              <div className="space-y-2 text-sm text-orange-700 dark:text-orange-300">
                <div className="flex items-start gap-2">
                  <span className="text-orange-500 font-bold">•</span>
                  <p><strong>Demo Mode:</strong> All trading in NeonTrade AI is currently in simulation mode - no real money is involved in trading activities</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-orange-500 font-bold">•</span>
                  <p><strong>Credits Usage:</strong> Any credits used for AI trading activities will be deducted from refund amount</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-orange-500 font-bold">•</span>
                  <p><strong>Data Retention:</strong> Account data and trading history will be preserved during refund processing</p>
                </div>
              </div>
            </div>

            {/* How to Request */}
            <div>
              <h3 className="text-lg font-semibold mb-3">How to Request a Refund</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>Contact our support team via email or in-app support</li>
                <li>Provide your account email and transaction details</li>
                <li>Specify the reason for your refund request</li>
                <li>Allow 3-5 business days for processing</li>
                <li>Refund will be credited to your original payment method</li>
              </ol>
            </div>

            {/* Contact Information */}
            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
              <h3 className="text-lg font-semibold mb-2">Need Help?</h3>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                If you have questions about our refund policy or need to request a refund, 
                please contact our support team. We're here to help make things right.
              </p>
              <p className="text-sm mt-2 font-medium">
                Response time: Within 24 hours
              </p>
            </div>

            {/* Legal */}
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              <p>
                This refund policy is part of our Terms of Service. 
                Policy effective as of January 2025 and subject to change with notice. 
                Refunds are processed according to the payment method's standard procedures.
              </p>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}