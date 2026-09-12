import { createClientFromRequest } from 'npm:@base44/sdk@0.7.0';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server@10.0.0';

const rpName = 'NeonTrade AI';

// SECURITY: The ONLY origins this app will register biometric credentials for.
// The Origin/Referer headers are fully attacker-controlled, so they can never be
// trusted as the source of rpID/expectedOrigin — a spoofed header would let an
// attacker bind a credential to a domain they own. Add a custom domain here (and
// nowhere else) if the app is served from one.
const ALLOWED_ORIGINS = ['https://neontrade.base44.app'];

/**
 * Resolve the WebAuthn origin from a server-side allowlist.
 * A caller-supplied origin is only honored when it exactly matches an entry in
 * ALLOWED_ORIGINS; anything else falls back to the deployed endpoint's own origin.
 */
function resolveTrustedOrigin(req) {
  const endpointOrigin = new URL(req.url).origin;
  const trusted = ALLOWED_ORIGINS.includes(endpointOrigin)
    ? ALLOWED_ORIGINS
    : [...ALLOWED_ORIGINS, endpointOrigin];

  const claimed = req.headers.get('origin');
  let claimedOrigin = null;
  if (claimed) {
    try { claimedOrigin = new URL(claimed).origin; } catch (_e) { claimedOrigin = null; }
  }

  if (claimedOrigin && trusted.includes(claimedOrigin)) return claimedOrigin;
  return trusted[0];
}

const bufferToBase64URL = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

// Convert string to Uint8Array for WebAuthn
const stringToBuffer = (str) => {
  return new TextEncoder().encode(str);
};

Deno.serve(async (req) => {
  try {
    // SECURITY: rpID/expectedOrigin come from the server-side allowlist above,
    // never from the request's Origin/Referer headers.
    const origin = resolveTrustedOrigin(req);
    const rpID = new URL(origin).hostname;

    const { action, payload } = await req.json();
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    if (action === 'generate-registration-options') {
      const userAuthenticators = await base44.entities.Authenticator.filter({ created_by: user.email });

      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userID: stringToBuffer(user.email), // Convert string to buffer
        userName: user.full_name,
        timeout: 60000,
        attestationType: 'none',
        excludeCredentials: userAuthenticators.map((auth) => ({
          id: auth.credentialID,
          type: 'public-key',
          transports: auth.transports,
        })),
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
        supportedAlgorithmIDs: [-7, -257],
      });

      // Temporarily store the challenge - handle case where user.data might not exist
      const currentUserData = user.data || {};
      await base44.entities.User.update(user.id, {
        ...currentUserData,
        currentChallenge: options.challenge,
      });

      return new Response(JSON.stringify(options), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (action === 'verify-registration') {
      const { credential } = payload;
      const expectedChallenge = user.data?.currentChallenge;

      if (!expectedChallenge) {
        throw new Error('Challenge not found for user');
      }

      const verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });

      const { verified, registrationInfo } = verification;

      if (verified && registrationInfo) {
        const {
          credentialPublicKey,
          credentialID,
          counter,
          credentialDeviceType,
          credentialBackedUp,
        } = registrationInfo;

        await base44.entities.Authenticator.create({
          credentialID: bufferToBase64URL(credentialID),
          credentialPublicKey: bufferToBase64URL(credentialPublicKey),
          counter,
          credentialDeviceType,
          credentialBackedUp,
          transports: credential.response.transports || [],
          created_by: user.email,
        });

        // Clear the challenge - handle case where user.data might not exist
        const currentUserData = user.data || {};
        await base44.entities.User.update(user.id, { 
          ...currentUserData, 
          currentChallenge: null 
        });

        return new Response(JSON.stringify({ verified: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ verified: false, error: 'Verification failed' }), { status: 400 });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });

  } catch (error) {
    console.error('Biometric Auth Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
});