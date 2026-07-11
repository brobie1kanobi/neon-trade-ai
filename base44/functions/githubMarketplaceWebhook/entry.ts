import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get("GITHUB_MARKETPLACE_WEBHOOK_SECRET");
    if (!secret) {
      console.error("GITHUB_MARKETPLACE_WEBHOOK_SECRET not configured");
      return Response.json({ error: "Webhook secret not configured" }, { status: 500 });
    }

    // Verify GitHub signature
    const signature = req.headers.get("x-hub-signature-256");
    const body = await req.text();

    if (!signature) {
      console.error("Missing X-Hub-Signature-256 header");
      return Response.json({ error: "Missing signature" }, { status: 401 });
    }

    // HMAC-SHA256 verification using Web Crypto API
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const digest = "sha256=" + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

    // Timing-safe comparison to prevent timing attacks
    const digestBytes = new TextEncoder().encode(digest);
    const signatureBytes = new TextEncoder().encode(signature);
    if (digestBytes.length !== signatureBytes.length) {
      console.error("Invalid signature");
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
    const sigMatch = await crypto.subtle.timingSafeEqual
      ? crypto.subtle.timingSafeEqual(digestBytes, signatureBytes)
      : digest === signature; // fallback if timingSafeEqual unavailable
    if (!sigMatch) {
      console.error("Invalid signature");
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(body);
    const event = req.headers.get("x-github-event") || "unknown";
    const deliveryId = req.headers.get("x-github-delivery") || "unknown";

    console.log(`GitHub Marketplace event: ${event}, delivery: ${deliveryId}`);
    console.log(`Action: ${payload.action || "N/A"}`);

    // Use service role since this is a webhook (no user auth)
    const base44 = createClientFromRequest(req);

    // Log the event
    await base44.asServiceRole.entities.KrakenLog.create({
      event_type: "github_marketplace",
      status: "info",
      message: `GitHub Marketplace: ${event} - ${payload.action || "N/A"}`,
      details_json: JSON.stringify({
        event,
        delivery_id: deliveryId,
        action: payload.action,
        sender: payload.sender?.login,
        marketplace_purchase: payload.marketplace_purchase ? {
          plan: payload.marketplace_purchase.plan?.name,
          account: payload.marketplace_purchase.account?.login,
          billing_cycle: payload.marketplace_purchase.billing_cycle,
          unit_count: payload.marketplace_purchase.unit_count,
          on_free_trial: payload.marketplace_purchase.on_free_trial,
        } : null,
        received_at: new Date().toISOString()
      })
    });

    // Handle specific marketplace events
    if (event === "marketplace_purchase") {
      const action = payload.action;
      const purchase = payload.marketplace_purchase;
      const account = purchase?.account;

      console.log(`Marketplace purchase action: ${action}`);
      console.log(`Account: ${account?.login}, Plan: ${purchase?.plan?.name}`);

      switch (action) {
        case "purchased":
          console.log(`New purchase: ${account?.login} subscribed to ${purchase?.plan?.name}`);
          break;
        case "changed":
          console.log(`Plan changed: ${account?.login} changed to ${purchase?.plan?.name}`);
          break;
        case "cancelled":
          console.log(`Cancelled: ${account?.login} cancelled ${purchase?.plan?.name}`);
          break;
        case "pending_change":
          console.log(`Pending change: ${account?.login} pending change to ${purchase?.plan?.name}`);
          break;
        case "pending_change_cancelled":
          console.log(`Pending change cancelled for ${account?.login}`);
          break;
        default:
          console.log(`Unknown marketplace action: ${action}`);
      }
    }

    return Response.json({ ok: true, event, delivery_id: deliveryId });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
});