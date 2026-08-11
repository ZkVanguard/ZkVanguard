/**
 * Shared types for the sui/community-pool action handlers.
 *
 * `route.ts` stays the single HTTP entry point. Extracted per-action
 * handlers take a normalized `ActionCtx` so they're independently
 * testable and free of URL / rate-limit / body-parse concerns.
 */
import type { NextRequest } from 'next/server';

export type NetworkType = 'testnet' | 'mainnet';

export interface ActionCtx {
  request: NextRequest;
  network: NetworkType;
  body: Record<string, unknown>;
}
