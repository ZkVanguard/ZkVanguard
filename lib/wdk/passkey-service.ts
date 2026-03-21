/**
 * Passkey Service (Client-Side WebAuthn)
 * 
 * Provides helpers for registering and verifying passkeys (TouchID/FaceID)
 * to stream-line wallet unlocking.
 * 
 * NOTE: In a production App, the challenge should come from a server.
 * Since this is a self-custodial client-side wallet, we use local challenges
 * primarily for local authentication (biometric gating).
 */

export interface PasskeyCredential {
  id: string;
  rawId: string;
  response: any;
  type: string;
}

// Generate a random buffer for the challenge
function getChallenge(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export const PasskeyService = {
  /**
   * Check if WebAuthn is supported
   */
  isSupported: async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  },

  /**
   * Register a new Passkey
   */
  register: async (username: string): Promise<PasskeyCredential | null> => {
    try {
      const challenge = getChallenge();
      const userId = crypto.getRandomValues(new Uint8Array(16));

      const publicKey: PublicKeyCredentialCreationOptions = {
        challenge: challenge as unknown as BufferSource,
        rp: {
          name: 'Chronos Vanguard WDK',
          id: window.location.hostname, // Must verify against current domain
        },
        user: {
          id: userId as unknown as BufferSource,
          name: username,
          displayName: username,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' }, // ES256
          { alg: -257, type: 'public-key' }, // RS256
        ],
        authenticatorSelection: {
          // Allow any authenticator (Platform like FaceID/TouchID OR Roaming like YubiKey)
          // authenticatorAttachment: 'platform', 
          userVerification: 'required',
        },
        timeout: 60000,
        attestation: 'none',
      };

      const credential = await navigator.credentials.create({ publicKey }) as any;
      
      if (!credential) return null;

      return {
        id: credential.id,
        rawId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))),
        response: credential.response,
        type: credential.type,
      };
    } catch (err) {
      console.error('Passkey registration failed:', err);
      throw err;
    }
  },

  /**
   * Authenticate with an existing Passkey
   */
  authenticate: async (credentialIds?: string[]): Promise<boolean> => {
    try {
      const challenge = getChallenge();
      
      const allowCredentials = credentialIds?.map(id => ({
        id: Uint8Array.from(atob(id), c => c.charCodeAt(0)) as unknown as BufferSource,
        type: 'public-key' as const,
      }));

      const publicKey: PublicKeyCredentialRequestOptions = {
        challenge: challenge as unknown as BufferSource,
        rpId: window.location.hostname,
        allowCredentials,
        userVerification: 'required',
        timeout: 60000,
      };

      const assertion = await navigator.credentials.get({ publicKey });
      return !!assertion;
    } catch (err) {
      console.error('Passkey authentication failed:', err);
      return false;
    }
  }
};
