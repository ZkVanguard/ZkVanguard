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

import { logger } from '@/lib/utils/logger';

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
   * Returns true if the browser has the WebAuthn API (Chrome, Firefox, Safari, Edge all do).
   * Does NOT require a platform authenticator — Chrome supports passkeys via
   * Windows Hello, phone-based auth, security keys, and its built-in passkey manager.
   */
  isSupported: async (): Promise<boolean> => {
    logger.debug('[PasskeyService] 🔍 Checking WebAuthn support...');
    logger.debug('[PasskeyService]   window defined:', typeof window !== 'undefined');
    logger.debug('[PasskeyService]   navigator.credentials:', typeof navigator !== 'undefined' && !!navigator.credentials);
    logger.debug('[PasskeyService]   PublicKeyCredential:', typeof window !== 'undefined' && !!window.PublicKeyCredential);
    if (typeof window === 'undefined' || !window.PublicKeyCredential) {
      logger.warn('[PasskeyService] ❌ WebAuthn NOT supported (no PublicKeyCredential)');
      return false;
    }
    // Check platform authenticator availability (informational only — not required)
    try {
      const platformAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      logger.debug('[PasskeyService]   Platform authenticator (biometric/Windows Hello):', platformAvailable);
      // Even if platform authenticator is NOT available, Chrome/Edge still support
      // passkeys via cross-platform authenticators (phone, security key, etc.)
      // So we return true as long as the WebAuthn API exists.
    } catch (e) {
      logger.debug('[PasskeyService]   Platform check failed (non-fatal):', e);
    }
    logger.debug('[PasskeyService] ✅ WebAuthn API is available');
    return true;
  },

  /**
   * Register a new Passkey
   */
  register: async (username: string): Promise<PasskeyCredential | null> => {
    logger.debug('[PasskeyService] 📝 Register passkey for user:', username);
    try {
      const challenge = getChallenge();
      const userId = crypto.getRandomValues(new Uint8Array(16));
      logger.debug('[PasskeyService]   Challenge generated:', challenge.length, 'bytes');
      logger.debug('[PasskeyService]   User ID generated:', userId.length, 'bytes');

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

      logger.debug('[PasskeyService]   📡 Calling navigator.credentials.create()...');
      logger.debug('[PasskeyService]   RP:', publicKey.rp);
      logger.debug('[PasskeyService]   User:', publicKey.user?.name);
      logger.debug('[PasskeyService]   PubKeyParams:', publicKey.pubKeyCredParams);
      logger.debug('[PasskeyService]   AuthenticatorSelection:', publicKey.authenticatorSelection);
      logger.debug('[PasskeyService]   Timeout:', publicKey.timeout);
      
      const credential = await navigator.credentials.create({ publicKey }) as any;
      
      if (!credential) {
        logger.warn('[PasskeyService] ⚠️ navigator.credentials.create() returned null');
        return null;
      }

      const rawIdBase64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
      logger.debug('[PasskeyService] ✅ Passkey registered successfully!');
      logger.debug('[PasskeyService]   Credential ID:', credential.id?.slice(0, 20) + '...');
      logger.debug('[PasskeyService]   Raw ID (base64):', rawIdBase64.slice(0, 20) + '...');
      logger.debug('[PasskeyService]   Type:', credential.type);

      return {
        id: credential.id,
        rawId: rawIdBase64,
        response: credential.response,
        type: credential.type,
      };
    } catch (err: any) {
      logger.error('[PasskeyService] ❌ Passkey registration failed:', err);
      logger.error('[PasskeyService]   Error name:', err?.name);
      logger.error('[PasskeyService]   Error message:', err?.message);
      throw err;
    }
  },

  /**
   * Authenticate with an existing Passkey
   */
  authenticate: async (credentialIds?: string[]): Promise<boolean> => {
    logger.debug('[PasskeyService] 🔐 === AUTHENTICATE START ===' );
    logger.debug('[PasskeyService]   credentialIds provided:', credentialIds?.length ?? 0);
    if (credentialIds) {
      credentialIds.forEach((id, i) => {
        logger.debug(`[PasskeyService]   credentialIds[${i}]:`, id?.slice(0, 30) + '...', 'length:', id?.length);
      });
    }
    
    // Pre-flight checks
    logger.debug('[PasskeyService]   navigator.credentials exists:', typeof navigator !== 'undefined' && !!navigator.credentials);
    logger.debug('[PasskeyService]   navigator.credentials.get exists:', typeof navigator !== 'undefined' && !!navigator.credentials?.get);
    
    try {
      const challenge = getChallenge();
      logger.debug('[PasskeyService]   Challenge generated:', challenge.length, 'bytes');
      
      logger.debug('[PasskeyService]   Decoding credential IDs...');
      const allowCredentials = credentialIds?.map((id, i) => {
        try {
          // Normalize Base64URL to Base64 for atob
          const base64 = id.replace(/-/g, '+').replace(/_/g, '/');
          const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
          logger.debug(`[PasskeyService]     [${i}] Original:`, id?.slice(0, 20) + '...');
          logger.debug(`[PasskeyService]     [${i}] Normalized:`, padded?.slice(0, 20) + '...');
          const decoded = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
          logger.debug(`[PasskeyService]     [${i}] Decoded to ${decoded.length} bytes ✅`);
          return {
            id: decoded as unknown as BufferSource,
            type: 'public-key' as const,
          };
        } catch (e: any) {
          logger.error(`[PasskeyService]     [${i}] ❌ Failed to decode credential ID:`, e?.message);
          logger.error(`[PasskeyService]     [${i}] Raw ID value:`, id);
          return null;
        }
      }).filter(c => c !== null) as PublicKeyCredentialDescriptor[];

      // If credential IDs were provided but all failed to decode, do NOT fail early.
      // Instead, proceed with empty allowCredentials to trigger "Discoverable Credentials" flow.
      const useDiscoverable = !allowCredentials || allowCredentials.length === 0;
      logger.debug('[PasskeyService]   Decoded credentials count:', allowCredentials?.length ?? 0);
      logger.debug('[PasskeyService]   Using discoverable mode:', useDiscoverable);

      const publicKey: PublicKeyCredentialRequestOptions = {
        challenge: challenge as unknown as BufferSource,
        // rpId: window.location.hostname, // OMIT ID to match register (safer)
        allowCredentials: useDiscoverable ? undefined : allowCredentials,
        userVerification: 'required',
        timeout: 60000,
      };

      logger.debug('[PasskeyService]   📡 Calling navigator.credentials.get()...');
      logger.debug('[PasskeyService]   Options:', JSON.stringify({
        hasChallenge: !!publicKey.challenge,
        allowCredentialsCount: publicKey.allowCredentials?.length ?? 'undefined (discoverable)',
        userVerification: publicKey.userVerification,
        timeout: publicKey.timeout,
      }));

      try {
        const assertion = await navigator.credentials.get({ publicKey });
        logger.debug('[PasskeyService]   ✅ Assertion received:', !!assertion);
        if (assertion) {
          logger.debug('[PasskeyService]   Assertion type:', (assertion as any).type);
          logger.debug('[PasskeyService]   Assertion ID:', (assertion as any).id?.slice(0, 20) + '...');
        }
        logger.debug('[PasskeyService] 🔐 === AUTHENTICATE END (success:', !!assertion, ') ===');
        return !!assertion;
      } catch (innerErr: any) {
        logger.warn('[PasskeyService]   ⚠️ credentials.get() threw:', innerErr?.name, innerErr?.message);
        // If specific credential failed (e.g. NotFoundError because ID is from different domain/device/stale),
        // try again with Discoverable Credentials (empty allowCredentials) if we haven't already.
        if (!useDiscoverable && (innerErr.name === 'NotFoundError' || innerErr.name === 'NotAllowedError')) {
          logger.warn('[PasskeyService]   🔄 Retrying with Discoverable Credentials (no allowCredentials)...');
          
          const fallbackKey: PublicKeyCredentialRequestOptions = {
            ...publicKey,
            allowCredentials: undefined,
          };
          
          try {
            const fallbackAssertion = await navigator.credentials.get({ publicKey: fallbackKey });
            logger.debug('[PasskeyService]   ✅ Fallback assertion received:', !!fallbackAssertion);
            logger.debug('[PasskeyService] 🔐 === AUTHENTICATE END (fallback success:', !!fallbackAssertion, ') ===');
            return !!fallbackAssertion;
          } catch (fallbackErr: any) {
            logger.error('[PasskeyService]   ❌ Fallback also failed:', fallbackErr?.name, fallbackErr?.message);
            throw fallbackErr;
          }
        }
        throw innerErr;
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        // User cancelled or timed out -> safe to ignore
        logger.debug('[PasskeyService] ⏹️ Authentication cancelled by user (NotAllowedError)');
      } else {
        logger.error('[PasskeyService] ❌ Authentication error:', err?.name, err?.message);
        logger.error('[PasskeyService]   Full error:', err);
      }
      logger.debug('[PasskeyService] 🔐 === AUTHENTICATE END (failed) ===');
      return false;
    }
  }
};
