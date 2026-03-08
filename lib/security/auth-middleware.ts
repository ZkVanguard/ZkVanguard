/**
 * API Authentication Middleware
 * 
 * Provides authentication verification for all sensitive API routes.
 * Three authentication methods supported:
 * 
 * 1. INTERNAL_API_SECRET — for server-to-server / cron / internal calls
 * 2. Wallet signature — for user-initiated operations (EIP-191)
 * 3. CRON_SECRET — legacy cron authentication (via QStash or Bearer)
 * 
 * SECURITY: This is the ONLY gateway to sensitive operations.
 * Every mutation endpoint MUST call one of these verifiers.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'crypto';
import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';

// ─── Timing-safe string comparison ──────────────────────────────────
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ─── 1. Internal Service Authentication ─────────────────────────────
/**
 * Verify that a request comes from an internal service (cron, orchestrator, etc.)
 * Checks Authorization: Bearer <INTERNAL_API_SECRET> header.
 */
export function verifyInternalAuth(request: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('[Auth] INTERNAL_API_SECRET not configured in production — denying');
      return false;
    }
    // Dev mode: warn but allow
    logger.warn('[Auth] INTERNAL_API_SECRET not configured — allowing in dev mode');
    return true;
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7);
  return timingSafeEqual(token, secret);
}

// ─── 2. Wallet Signature Authentication ─────────────────────────────
/**
 * Verify that a request was signed by the claimed wallet address.
 * Expects headers:
 *   x-wallet-address: <address>
 *   x-wallet-signature: <signature>
 *   x-wallet-message: <message> (should include timestamp for replay protection)
 * 
 * Or body fields: walletAddress, signature, signedMessage
 */
export async function verifyWalletAuth(
  request: NextRequest,
  body?: Record<string, unknown>
): Promise<{ authenticated: boolean; walletAddress?: string }> {
  const walletAddress = (
    request.headers.get('x-wallet-address') ||
    (body?.walletAddress as string)
  )?.toLowerCase();

  const signature = (
    request.headers.get('x-wallet-signature') ||
    (body?.signature as string)
  );

  const message = (
    request.headers.get('x-wallet-message') ||
    (body?.signedMessage as string)
  );

  if (!walletAddress || !signature || !message) {
    return { authenticated: false };
  }

  try {
    // Verify the message contains a recent timestamp (within 5 minutes)
    const timestampMatch = message.match(/timestamp:(\d+)/);
    if (timestampMatch) {
      const msgTimestamp = parseInt(timestampMatch[1], 10);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - msgTimestamp) > 300) {
        logger.warn('[Auth] Wallet signature expired', { walletAddress });
        return { authenticated: false };
      }
    }

    const recoveredAddress = ethers.verifyMessage(message, signature).toLowerCase();
    if (recoveredAddress === walletAddress) {
      return { authenticated: true, walletAddress: recoveredAddress };
    }

    logger.warn('[Auth] Wallet signature mismatch', {
      claimed: walletAddress,
      recovered: recoveredAddress,
    });
    return { authenticated: false };
  } catch (error) {
    logger.warn('[Auth] Wallet signature verification failed', {
      walletAddress,
      error: error instanceof Error ? error.message : 'Unknown',
    });
    return { authenticated: false };
  }
}

// ─── 3. Combined Auth Check ─────────────────────────────────────────
/**
 * Check if a request is authenticated via ANY supported method.
 * Returns the auth method and identity if authenticated.
 */
export async function verifyAuth(
  request: NextRequest,
  body?: Record<string, unknown>
): Promise<{
  authenticated: boolean;
  method?: 'internal' | 'wallet' | 'system';
  identity?: string;
}> {
  // Method 1: Internal service token
  if (verifyInternalAuth(request)) {
    return { authenticated: true, method: 'internal', identity: 'service' };
  }

  // Method 2: System secret in body (legacy cron compatibility)
  const systemSecret = body?.systemSecret as string;
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (systemSecret && cronSecret && timingSafeEqual(systemSecret, cronSecret)) {
    return { authenticated: true, method: 'system', identity: 'cron' };
  }

  // Method 3: Wallet signature
  const walletResult = await verifyWalletAuth(request, body);
  if (walletResult.authenticated) {
    return { authenticated: true, method: 'wallet', identity: walletResult.walletAddress };
  }

  return { authenticated: false };
}

// ─── 4. Helper: Require Auth or Return 401 ──────────────────────────
/**
 * Convenience wrapper — returns a 401 response if not authenticated.
 * Usage in route handlers:
 * 
 *   const authResult = await requireAuth(request, body);
 *   if (authResult instanceof NextResponse) return authResult;
 *   // authResult is { method, identity }
 */
export async function requireAuth(
  request: NextRequest,
  body?: Record<string, unknown>
): Promise<
  | NextResponse
  | { method: 'internal' | 'wallet' | 'system'; identity: string }
> {
  const result = await verifyAuth(request, body);
  if (!result.authenticated) {
    logger.warn('[Auth] Unauthorized request', {
      path: request.nextUrl.pathname,
      ip: request.headers.get('x-forwarded-for') || 'unknown',
    });
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }
  return { method: result.method!, identity: result.identity! };
}

// ─── 5. Require Admin Auth (internal only) ──────────────────────────
export function requireAdminAuth(request: NextRequest): NextResponse | true {
  if (!verifyInternalAuth(request)) {
    return NextResponse.json(
      { success: false, error: 'Admin authentication required' },
      { status: 401 }
    );
  }
  return true;
}
