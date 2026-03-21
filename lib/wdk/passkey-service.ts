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
    console.log('[PasskeyService] 🔍 Checking WebAuthn support...');
    console.log('[PasskeyService]   window defined:', typeof window !== 'undefined');
    console.log('[PasskeyService]   PublicKeyCredential:', typeof window !== 'undefined' && !!window.PublicKeyCredential);
    if (typeof window === 'undefined' || !window.PublicKeyCredential) {
      console.warn('[PasskeyService] ❌ WebAuthn NOT supported (no PublicKeyCredential)');
      return false;
    }
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    console.log('[PasskeyService]   Platform authenticator available:', available);
    return available;
  },

  /**
   * Register a new Passkey
   */
  register: async (username: string): Promise<PasskeyCredential | null> => {
    console.log('[PasskeyService] 📝 Register passkey for user:', username);
    try {
      const challenge = getChallenge();
      const userId = crypto.getRandomValues(new Uint8Array(16));
      console.log('[PasskeyService]   Challenge generated:', challenge.length, 'bytes');
      console.log('[PasskeyService]   User ID generated:', userId.length, 'bytes');

      const publicKey: PublicKeyCredentialCreationOptions = {
        challenge: challenge as unknown as BufferSource,
        rp: {
          name: 'Chronos Vanguard WDK',
          // id: window.location.hostname, // OMIT ID to allow browser to infer (safer for localhost/etc)
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

      console.log('[PasskeyService]   📡 Calling navigator.credentials.create()...');
      console.log('[PasskeyService]   RP:', publicKey.rp);
      console.log('[PasskeyService]   User:', publicKey.user?.name);
      console.log('[PasskeyService]   PubKeyParams:', publicKey.pubKeyCredParams);
      console.log('[PasskeyService]   AuthenticatorSelection:', publicKey.authenticatorSelection);
      console.log('[PasskeyService]   Timeout:', publicKey.timeout);
      
      const credential = await navigator.credentials.create({ publicKey }) as any;
      
      if (!credential) {
        console.warn('[PasskeyService] ⚠️ navigator.credentials.create() returned null');
        return null;
      }

      const rawIdBase64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
      console.log('[PasskeyService] ✅ Passkey registered successfully!');
      console.log('[PasskeyService]   Credential ID:', credential.id?.slice(0, 20) + '...');
      console.log('[PasskeyService]   Raw ID (base64):', rawIdBase64.slice(0, 20) + '...');
      console.log('[PasskeyService]   Type:', credential.type);

      return {
        id: credential.id,
        rawId: rawIdBase64,
        response: credential.response,
        type: credential.type,
      };
    } catch (err: any) {
      console.error('[PasskeyService] ❌ Passkey registration failed:', err);
      console.error('[PasskeyService]   Error name:', err?.name);
      console.error('[PasskeyService]   Error message:', err?.message);
      throw err;
    }
  },

  /**
   * Authenticate with an existing Passkey
   */
  authenticate: async (credentialIds?: string[]): Promise<boolean> => {
    console.log('[PasskeyService] 🔐 === AUTHENTICATE START ===' );
    console.log('[PasskeyService]   credentialIds provided:', credentialIds?.length ?? 0);
    if (credentialIds) {
      credentialIds.forEach((id, i) => {
        console.log(`[PasskeyService]   credentialIds[${i}]:`, id?.slice(0, 30) + '...', 'length:', id?.length);
      });
    }
    
    // Pre-flight checks
    console.log('[PasskeyService]   navigator.credentials exists:', typeof navigator !== 'undefined' && !!navigator.credentials);
    console.log('[PasskeyService]   navigator.credentials.get exists:', typeof navigator !== 'undefined' && !!navigator.credentials?.get);
    
    try {
      const challenge = getChallenge();
      console.log('[PasskeyService]   Challenge generated:', challenge.length, 'bytes');
      
      console.log('[PasskeyService]   Decoding credential IDs...');
      const allowCredentials = credentialIds?.map((id, i) => {
        try {
          // Normalize Base64URL to Base64 for atob
          const base64 = id.replace(/-/g, '+').replace(/_/g, '/');
          const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
          console.log(`[PasskeyService]     [${i}] Original:`, id?.slice(0, 20) + '...');
          console.log(`[PasskeyService]     [${i}] Normalized:`, padded?.slice(0, 20) + '...');
          const decoded = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
          console.log(`[PasskeyService]     [${i}] Decoded to ${decoded.length} bytes ✅`);
          return {
            id: decoded as unknown as BufferSource,
            type: 'public-key' as const,
          };
        } catch (e: any) {
          console.error(`[PasskeyService]     [${i}] ❌ Failed to decode credential ID:`, e?.message);
          console.error(`[PasskeyService]     [${i}] Raw ID value:`, id);
          return null;
        }
      }).filter(c => c !== null) as PublicKeyCredentialDescriptor[];

      // If credential IDs were provided but all failed to decode, do NOT fail early.
      // Instead, proceed with empty allowCredentials to trigger "Discoverable Credentials" flow.
      const useDiscoverable = !allowCredentials || allowCredentials.length === 0;
      console.log('[PasskeyService]   Decoded credentials count:', allowCredentials?.length ?? 0);
      console.log('[PasskeyService]   Using discoverable mode:', useDiscoverable);

      const publicKey: PublicKeyCredentialRequestOptions = {
        challenge: challenge as unknown as BufferSource,
        // rpId: window.location.hostname, // OMIT ID to match register (safer)
        allowCredentials: useDiscoverable ? undefined : allowCredentials,
        userVerification: 'required',
        timeout: 60000,
      };

      console.log('[PasskeyService]   📡 Calling navigator.credentials.get()...');
      console.log('[PasskeyService]   Options:', JSON.stringify({
        hasChallenge: !!publicKey.challenge,
        allowCredentialsCount: publicKey.allowCredentials?.length ?? 'undefined (discoverable)',
        userVerification: publicKey.userVerification,
        timeout: publicKey.timeout,
      }));

      try {
        const assertion = await navigator.credentials.get({ publicKey });
        console.log('[PasskeyService]   ✅ Assertion received:', !!assertion);
        if (assertion) {
          console.log('[PasskeyService]   Assertion type:', (assertion as any).type);
          console.log('[PasskeyService]   Assertion ID:', (assertion as any).id?.slice(0, 20) + '...');
        }
        console.log('[PasskeyService] 🔐 === AUTHENTICATE END (success:', !!assertion, ') ===');
        return !!assertion;
      } catch (innerErr: any) {
        console.warn('[PasskeyService]   ⚠️ credentials.get() threw:', innerErr?.name, innerErr?.message);
        // If specific credential failed (e.g. NotFoundError because ID is from different domain/device/stale),
        // try again with Discoverable Credentials (empty allowCredentials) if we haven't already.
        if (!useDiscoverable && (innerErr.name === 'NotFoundError' || innerErr.name === 'NotAllowedError')) {
          console.warn('[PasskeyService]   🔄 Retrying with Discoverable Credentials (no allowCredentials)...');
          
          const fallbackKey: PublicKeyCredentialRequestOptions = {
            ...publicKey,
            allowCredentials: undefined,
          };
          
          try {
            const fallbackAssertion = await navigator.credentials.get({ publicKey: fallbackKey });
            console.log('[PasskeyService]   ✅ Fallback assertion received:', !!fallbackAssertion);
            console.log('[PasskeyService] 🔐 === AUTHENTICATE END (fallback success:', !!fallbackAssertion, ') ===');
            return !!fallbackAssertion;
          } catch (fallbackErr: any) {
            console.error('[PasskeyService]   ❌ Fallback also failed:', fallbackErr?.name, fallbackErr?.message);
            throw fallbackErr;
          }
        }
        throw innerErr;
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        // User cancelled or timed out -> safe to ignore
        console.log('[PasskeyService] ⏹️ Authentication cancelled by user (NotAllowedError)');
      } else {
        console.error('[PasskeyService] ❌ Authentication error:', err?.name, err?.message);
        console.error('[PasskeyService]   Full error:', err);
      }
      console.log('[PasskeyService] 🔐 === AUTHENTICATE END (failed) ===');
      return false;
    }
  }
};
