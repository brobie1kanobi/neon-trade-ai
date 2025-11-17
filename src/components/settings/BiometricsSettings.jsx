import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Fingerprint, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { biometricAuth } from "@/functions/biometricAuth";

// Helper functions (same as in BiometricsSetupModal)
const bufferToBase64url = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).
  replace(/=/g, '').
  replace(/\+/g, '-').
  replace(/\//g, '_');
};

const base64urlToBuffer = (base64url) => {
  const base64 = base64url.
  replace(/-/g, '+').
  replace(/_/g, '/');
  const paddedBase64 = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  const binaryString = atob(paddedBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

export default function BiometricsSettings({ settings, onToggle }) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleToggleBiometrics = async (enabled) => {
    if (!enabled) {
      // Logic to disable biometrics (e.g., delete authenticators) can be added here later
      onToggle('biometrics_enabled', false);
      toast.info("Biometric login has been disabled.");
      return;
    }

    if (!window.navigator.credentials) {
      toast.error("Your browser doesn't support biometric authentication.");
      return;
    }

    setIsProcessing(true);
    try {
      // Get registration options from server
      const { data: options } = await biometricAuth({ action: 'generate-registration-options' });

      // Convert base64url strings to ArrayBuffers for WebAuthn
      const publicKeyCredentialCreationOptions = {
        ...options,
        challenge: base64urlToBuffer(options.challenge),
        user: {
          ...options.user,
          id: base64urlToBuffer(options.user.id)
        },
        excludeCredentials: options.excludeCredentials?.map((cred) => ({
          ...cred,
          id: base64urlToBuffer(cred.id)
        })) || []
      };

      // Start WebAuthn registration
      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions
      });

      if (!credential) {
        throw new Error('Failed to create credential');
      }

      // Convert credential response back to format expected by server
      const attestationResponse = {
        id: credential.id,
        rawId: bufferToBase64url(credential.rawId),
        response: {
          attestationObject: bufferToBase64url(credential.response.attestationObject),
          clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
          transports: credential.response.getTransports?.() || []
        },
        type: credential.type
      };

      // Send verification to server
      const { data: verification } = await biometricAuth({
        action: 'verify-registration',
        payload: { credential: attestationResponse }
      });

      if (verification.verified) {
        onToggle('biometrics_enabled', true);
        toast.success("Biometric login enabled successfully!");
      } else {
        throw new Error(verification.error || 'Biometric verification failed.');
      }
    } catch (error) {
      console.error('Biometric setup failed:', error);

      // Provide user-friendly error messages
      if (error.name === 'NotSupportedError') {
        toast.error("Biometric authentication is not supported on this device.");
      } else if (error.name === 'NotAllowedError') {
        toast.error("Biometric setup was cancelled or not allowed.");
      } else if (error.name === 'InvalidStateError') {
        toast.error("A biometric credential may already exist for this device.");
      } else {
        toast.error(`Biometric setup failed: ${error.message}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Fingerprint className="w-5 h-5 neon-text" />
          Biometric Login
        </CardTitle>
        <CardDescription>
          Enable passwordless sign-in using your device's biometrics (Face ID, Touch ID, etc.).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Enable Biometric Login</p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Requires a secure device with biometrics.
            </p>
          </div>
          <Switch
            checked={settings?.biometrics_enabled || false}
            onCheckedChange={handleToggleBiometrics}
            disabled={isProcessing}
            className="data-[state=checked]:bg-green-600" />

        </div>
        {isProcessing &&
        <div className="flex items-center justify-center text-sm p-2 rounded-lg" style={{ backgroundColor: 'var(--secondary-bg)' }}>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            <span style={{ color: 'var(--text-secondary)' }}>Follow your browser's prompts...</span>
          </div>
        }
        <div className="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-yellow-600" />
            <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Security Note
            </span>
          </div>
          <p className="text-sm text-yellow-700 dark:text-yellow-300">This feature registers your current device only for login. You will need to sign in with your account on new devices and enable this again.

          </p>
        </div>
      </CardContent>
    </Card>);

}