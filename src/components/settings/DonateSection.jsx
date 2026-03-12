import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeartHandshake } from "lucide-react";
import { toast } from "sonner";

import { User } from "@/entities/User";
import RefundPolicyModal from "./RefundPolicyModal";

export default function DonateSection() {
  const [amount, setAmount] = useState("");
  const [user, setUser] = useState(null);
  const [showRefundModal, setShowRefundModal] = useState(false);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const currentUser = await User.me();
        setUser(currentUser);
      } catch (error) {
        console.log("Error loading user:", error);
      }
    };
    loadUser();
  }, []);

  const handleDonate = () => {
    // This will redirect to the Cash App profile page
    // The user can then manually enter the amount.
    // This avoids hardcoding a specific tag and is more flexible.
    const cashAppProfileUrl = "https://cash.app/CTFDan";

    // Open in a new tab
    window.open(cashAppProfileUrl, "_blank");

    toast.success("Redirecting to Cash App...", {
      description: "Thank you for considering a donation!"
    });
  };

  const handleViewPolicy = () => {
    setShowRefundModal(true);
  };

  return (
    <>
      <RefundPolicyModal
        isOpen={showRefundModal}
        onClose={() => setShowRefundModal(false)} />

      
      <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <HeartHandshake className="w-5 h-5 neon-text" />
            Support & Policies
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>If you enjoy NeonTrade AI, please consider supporting its development. Your contribution and support will always be greatly appreciated.

          </p>
          
          <div className="flex flex-col sm:flex-row items-center gap-2">
            <Button
              onClick={handleDonate}
              className="w-full sm:w-auto flex-grow neon-glow bg-green-600 hover:bg-green-700">

              Donate via Cash App
            </Button>
            <Button
              onClick={handleViewPolicy}
              variant="outline"
              className="w-full sm:w-auto flex-grow">

              View Refund Policy
            </Button>
          </div>
        </CardContent>
      </Card>
    </>);

}