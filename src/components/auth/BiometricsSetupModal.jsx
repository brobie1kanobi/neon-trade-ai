import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Fingerprint, Loader2, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { biometricAuth } from "@/functions/biometricAuth";

// Helper function to convert ArrayBuffer to base64url
const bufferToBase64url = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

// Helper function to convert base64url to ArrayBuffer
const base64urlToBuffer = (base64url) => {
  const base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const paddedBase64 = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  const binaryString = atob(paddedBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

export default function BiometricsSetupModal({ isOpen, onComplete, onDecline }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const [deviceSupport, setDeviceSupport] = useState({
    hasWebAuthn: false,
    hasPlatformAuth: false,
    isChecking: true
  });

  useEffect(() => {
    if (!isOpen) return;

    const checkDeviceSupport = async () => {
      setDeviceSupport(prev => ({ ...prev, isChecking: true }));
      
      // Check if running in iframe
      const inIframe = window.self !== window.top;
      setIsInIframe(inIframe);

      // Check basic WebAuthn support
      if (!window.PublicKeyCredential || !navigator.credentials) {
        setDeviceSupport({
          hasWebAuthn: false,
          hasPlatformAuth: false,
          isChecking: false
        });
        return;
      }

      try {
        // Check if device has platform authenticator (TouchID, FaceID, Windows Hello, etc.)
        const hasPlatformAuth = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        
        setDeviceSupport({
          hasWebAuthn: true,
          hasPlatformAuth,
          isChecking: false
        });
      } catch (error) {
        console.error('Error checking platform authenticator:', error);
        setDeviceSupport({
          hasWebAuthn: true,
          hasPlatformAuth: false,
          isChecking: false
        });
      }
    };

    checkDeviceSupport();
  }, [isOpen]);

  const handleEnableBiometrics = async () => {
    // CRITICAL: Multiple guards to prevent execution in iframe
    if (isInIframe) {
      toast.error("Biometrics can't be set up in preview mode. Please open the app in a new tab.");
      return;
    }

    if (!deviceSupport.hasPlatformAuth) {
      toast.error("No biometric authenticator found on this device.");
      return;
    }

    // Additional iframe check
    if (window.self !== window.top) {
      toast.error("Biometrics blocked by browser security. Try opening in a new tab.");
      return;
    }

    setIsProcessing(true);
    try {
      const { data: options } = await biometricAuth({ action: 'generate-registration-options' });
      
      const publicKeyCredentialCreationOptions = {
        ...options,
        challenge: base64urlToBuffer(options.challenge),
        user: { ...options.user, id: base64urlToBuffer(options.user.id) },
        excludeCredentials: options.excludeCredentials?.map(cred => ({
          ...cred,
          id: base64urlToBuffer(cred.id),
        })) || [],
      };

      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions,
      });

      if (!credential) {
        throw new Error('Failed to create credential');
      }

      const attestationResponse = {
        id: credential.id,
        rawId: bufferToBase64url(credential.rawId),
        response: {
          attestationObject: bufferToBase64url(credential.response.attestationObject),
          clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
          transports: credential.response.getTransports?.() || [],
        },
        type: credential.type,
      };

      const { data: verification } = await biometricAuth({
        action: 'verify-registration',
        payload: { credential: attestationResponse }
      });
      
      if (verification.verified) {
        toast.success("Biometric login enabled successfully!");
        onComplete();
      } else {
        throw new Error(verification.error || 'Biometric verification failed.');
      }
    } catch (error) {
      console.error('Biometric setup failed:', error);
      
      let errorMessage;
      if (error.name === 'NotAllowedError' || error.message.toLowerCase().includes('cancelled')) {
        errorMessage = "Biometric setup was cancelled.";
      } else if (error.message.toLowerCase().includes('publickey-credentials-create') || error.message.toLowerCase().includes('permissions policy')) {
        errorMessage = "Biometrics blocked by browser security. Try opening in a new tab.";
      } else {
        errorMessage = `Biometric setup failed: ${error.message}`;
      }
      
      toast.error(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenInNewTab = () => {
    const currentUrl = window.location.href.split('?')[0];
    window.open(currentUrl, '_blank');
    toast.info("App opened in a new tab. Try setting up biometrics there!");
  };

  // Don't render if device doesn't support platform authenticators or still checking
  if (deviceSupport.isChecking) {
    return null; // Still checking, don't render anything
  }

  if (!deviceSupport.hasPlatformAuth) {
    // Device doesn't support biometrics, mark as seen and close
    onDecline();
    return null;
  }

  const canSetupBiometrics = deviceSupport.hasPlatformAuth && !isInIframe;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onDecline()}>
      <DialogContent className="sm:max-w-md" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <DialogHeader>
          <div className="flex justify-center mb-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
              canSetupBiometrics ? 'bg-green-100 dark:bg-green-900/50' : 'bg-yellow-100 dark:bg-yellow-900/50'
            }`}>
              {canSetupBiometrics ? (
                <Fingerprint className="w-8 h-8 text-green-500" />
              ) : (
                <AlertTriangle className="w-8 h-8 text-yellow-500" />
              )}
            </div>
          </div>
          <DialogTitle className="text-center text-xl" style={{ color: 'var(--text-primary)'}}>
            {canSetupBiometrics ? 'Enable Biometric Login?' : 'Biometric Setup Unavailable'}
          </DialogTitle>
          <DialogDescription className="text-center" style={{ color: 'var(--text-secondary)' }}>
            {isInIframe
              ? "Biometrics can't be set up in the preview. Please open the app in a new tab to enable this feature."
              : canSetupBiometrics
                ? "Use your fingerprint, face, or device security to quickly sign in to your account."
                : "Biometric authentication is not available in this environment."
            }
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-col sm:flex-col space-y-2">
          {isInIframe ? (
            <>
              <Button onClick={handleOpenInNewTab} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open in New Tab
              </Button>
              <Button variant="outline" onClick={onDecline} className="w-full">
                Maybe Later
              </Button>
            </>
          ) : canSetupBiometrics ? (
            <>
              <Button onClick={handleEnableBiometrics} disabled={isProcessing} className="w-full bg-green-600 hover:bg-green-700 text-white">
                {isProcessing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Fingerprint className="w-4 h-4 mr-2" />}
                Enable Biometric Login
              </Button>
              <Button variant="outline" onClick={onDecline} className="w-full">
                Maybe Later
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onDecline} className="w-full">
              Understood
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}