import { createClientFromRequest } from 'npm:@base44/sdk@0.7.0';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server@10.0.0';

const rpName = 'NeonTrade AI';

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
    // Get app URL from Base44 environment or derive from request
    let appUrl = Deno.env.get('BASE44_APP_URL');
    
    if (!appUrl) {
      // Try to get from Base44 app ID and construct URL
      const appId = Deno.env.get('BASE44_APP_ID');
      if (appId) {
        appUrl = `https://preview--neontrade.base44.app`;
      } else {
        // Fallback: derive from request URL
        const requestUrl = new URL(req.url);
        const origin = req.headers.get('origin') || req.headers.get('referer');
        if (origin) {
          appUrl = new URL(origin).origin;
        } else {
          // Last resort: use the request's origin
          appUrl = `${requestUrl.protocol}//${requestUrl.host}`;
        }
      }
    }
    
    const rpID = new URL(appUrl).hostname;
    const origin = appUrl;

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
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});