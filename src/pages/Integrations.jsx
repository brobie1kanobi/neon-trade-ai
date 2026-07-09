import React from "react";
import { useNavigate } from "react-router-dom";
import { useSettings } from "@/components/utils/SettingsContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import GitHubConnect from "@/pages/GitHubConnect";
import GitHubMarketplace from "@/pages/GitHubMarketplace";
import SupabaseCard from "@/components/settings/SupabaseCard";

export default function Integrations() {
  const { user } = useSettings();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin" || user?.is_creator;

  return (
    <div className="p-4 space-y-6 pb-8" style={{ backgroundColor: 'var(--primary-bg)' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/Settings")}>
          <ArrowLeft className="w-5 h-5" style={{ color: 'var(--text-primary)' }} />
        </Button>
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Integrations</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Manage external service connections</p>
        </div>
      </div>

      {/* Supabase */}
      <SupabaseCard />

      {/* GitHub Connect (embedded inline) */}
      <GitHubConnect embedded />

      {/* GitHub Marketplace (admin only) */}
      {isAdmin && <GitHubMarketplace embedded />}
    </div>
  );
}