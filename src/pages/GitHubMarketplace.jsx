import React, { useState, useEffect } from "react";
import { useSettings } from "../components/utils/SettingsContext";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Globe, ShieldCheck, RefreshCw, Copy, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export default function GitHubMarketplace() {
  const { user, isLoading: settingsLoading } = useSettings();
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null);

  const isAdmin = user?.role === "admin" || user?.is_creator;

  useEffect(() => {
    if (!settingsLoading && !isAdmin) {
      navigate("/Settings");
    }
  }, [settingsLoading, isAdmin, navigate]);

  useEffect(() => {
    if (isAdmin) fetchEvents();
  }, [isAdmin]);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const logs = await base44.entities.KrakenLog.filter(
        { event_type: "github_marketplace" },
        "-created_date",
        50
      );
      setEvents(logs);
    } catch (e) {
      console.error("Failed to fetch marketplace events:", e);
    }
    setLoading(false);
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success(`${label} copied!`);
    setTimeout(() => setCopied(null), 2000);
  };

  // Build the webhook URL from the current origin
  const webhookUrl = `${window.location.origin}/api/githubMarketplaceWebhook`;

  if (settingsLoading || !isAdmin) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-8" style={{ backgroundColor: "var(--primary-bg)" }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/Settings")}>
          <ArrowLeft className="w-5 h-5" style={{ color: "var(--text-primary)" }} />
        </Button>
        <div>
          <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>GitHub Marketplace</h2>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Webhook configuration & event log</p>
        </div>
      </div>

      {/* Setup Instructions */}
      <Card style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--border-color)" }}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" style={{ color: "var(--neon-green)" }} />
            <CardTitle className="text-base" style={{ color: "var(--text-primary)" }}>Webhook Setup</CardTitle>
          </div>
          <CardDescription style={{ color: "var(--text-secondary)" }}>
            Use these values in your GitHub Marketplace app's webhook configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Payload URL */}
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>
              Payload URL
            </label>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 text-sm px-3 py-2 rounded-lg break-all"
                style={{ backgroundColor: "rgba(255,255,255,0.05)", color: "var(--neon-green)", border: "1px solid var(--border-color)" }}
              >
                {webhookUrl}
              </code>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => copyToClipboard(webhookUrl, "URL")}
                style={{ borderColor: "var(--border-color)" }}
              >
                {copied === "URL" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />}
              </Button>
            </div>
          </div>

          {/* Content Type */}
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>
              Content Type
            </label>
            <code
              className="text-sm px-3 py-2 rounded-lg block"
              style={{ backgroundColor: "rgba(255,255,255,0.05)", color: "var(--text-primary)", border: "1px solid var(--border-color)" }}
            >
              application/json
            </code>
          </div>

          {/* Secret */}
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>
              Secret
            </label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)" }}>
              <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Set as <code className="text-xs px-1 py-0.5 rounded" style={{ backgroundColor: "rgba(255,255,255,0.1)", color: "var(--neon-green)" }}>GITHUB_MARKETPLACE_WEBHOOK_SECRET</code> in your app's environment variables, and use the same value in GitHub.
              </span>
            </div>
          </div>

          {/* Quick link */}
          <a
            href="https://github.com/marketplace"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm hover:underline"
            style={{ color: "var(--neon-green)" }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open GitHub Marketplace
          </a>
        </CardContent>
      </Card>

      {/* Event Log */}
      <Card style={{ backgroundColor: "var(--card-bg)", borderColor: "var(--border-color)" }}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5" style={{ color: "var(--neon-green)" }} />
              <CardTitle className="text-base" style={{ color: "var(--text-primary)" }}>Event Log</CardTitle>
              <Badge variant="outline" style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
                {events.length}
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchEvents}
              disabled={loading}
              style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading && events.length === 0 ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-8" style={{ color: "var(--text-secondary)" }}>
              <Globe className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No marketplace events received yet.</p>
              <p className="text-xs mt-1">Events will appear here once your webhook is configured and GitHub sends events.</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {events.map((evt) => {
                let details = {};
                try { details = JSON.parse(evt.details_json || "{}"); } catch (_e) {}
                return (
                  <div
                    key={evt.id}
                    className="p-3 rounded-lg text-sm"
                    style={{ backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid var(--border-color)" }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          className="text-xs"
                          style={{
                            backgroundColor: "rgba(var(--neon-green-rgb), 0.1)",
                            color: "var(--neon-green)",
                            border: "none",
                          }}
                        >
                          {details.event || "event"}
                        </Badge>
                        {details.action && (
                          <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                            {details.action}
                          </span>
                        )}
                      </div>
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        {new Date(evt.created_date).toLocaleString()}
                      </span>
                    </div>
                    {details.sender && (
                      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        Sender: {details.sender}
                      </p>
                    )}
                    {details.marketplace_purchase && (
                      <div className="mt-1 text-xs space-y-0.5" style={{ color: "var(--text-secondary)" }}>
                        {details.marketplace_purchase.account && <p>Account: {details.marketplace_purchase.account}</p>}
                        {details.marketplace_purchase.plan && <p>Plan: {details.marketplace_purchase.plan}</p>}
                        {details.marketplace_purchase.billing_cycle && <p>Billing: {details.marketplace_purchase.billing_cycle}</p>}
                        {details.marketplace_purchase.on_free_trial && <p>Free Trial: Yes</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}