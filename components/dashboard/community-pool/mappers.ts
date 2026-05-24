/**
 * Pure API → view-model mappers for the community-pool hook. Extracted from
 * useCommunityPool so the SUI pool/user response shaping has one home and a
 * test net (test/unit/community-pool-mappers.test.ts). No React, no fetch —
 * pure (apiData) → model, behavior-identical to the inline code they replaced.
 */
import type { PoolSummary, UserPosition, PoolAllocation } from './types';

type ApiData = Record<string, unknown>;

/** parseFloat-with-0-fallback, matching the hook's prior inline coercion. */
const num = (v: unknown): number => parseFloat(String(v)) || 0;

/**
 * Live 4-asset composition (market-value % + USDC bucket). Falls back to
 * "SUI 100%" only when the server didn't compute one and the pool is non-empty.
 */
export function normalizeAllocations(
  apiAlloc: Record<string, unknown> | undefined,
  totalValueUSD: number,
): PoolAllocation {
  const a = apiAlloc || {};
  const sum =
    (Number(a.BTC) || 0) +
    (Number(a.ETH) || 0) +
    (Number(a.SUI) || 0) +
    (Number(a.USDC) || 0) +
    (Number(a.CRO) || 0);
  return sum > 0
    ? {
        BTC: Number(a.BTC) || 0,
        ETH: Number(a.ETH) || 0,
        SUI: Number(a.SUI) || 0,
        USDC: Number(a.USDC) || 0,
        CRO: Number(a.CRO) || 0,
      }
    : { BTC: 0, ETH: 0, SUI: totalValueUSD > 0 ? 100 : 0, CRO: 0, USDC: 0 };
}

/** Shape the SUI pool-summary API response into the PoolSummary view model. */
export function mapApiToPoolSummary(data: ApiData): PoolSummary {
  const totalValueUSD = num(data.totalNAVUsd);
  return {
    totalShares: num(data.totalShares),
    totalNAV: num(data.totalNAV),
    totalValueUSD,
    sharePrice: parseFloat(String(data.sharePrice)) || 1.0,
    sharePriceUSD: parseFloat(String(data.sharePriceUsd)) || 1.0,
    memberCount: (data.memberCount as number) || 0,
    allocations: normalizeAllocations(data.allocation as Record<string, unknown>, totalValueUSD),
    aiLastUpdate: null,
    aiReasoning: null,
    allTimeHighNav: parseFloat(String(data.allTimeHighNav)) || undefined,
    totalDeposited: num(data.totalDeposited),
    totalWithdrawn: num(data.totalWithdrawn),
  };
}

/** Shape the SUI user-position API response into the UserPosition view model. */
export function mapApiToUserPosition(data: ApiData, walletAddress: string | null | undefined): UserPosition {
  return {
    walletAddress: walletAddress || '',
    shares: num(data.shares),
    valueUSD: num(data.valueUsd),
    valueSUI: num(data.valueSui),
    percentage: num(data.percentage),
    isMember: (data.isMember as boolean) || false,
    totalDeposited: num(data.depositedSui),
    totalWithdrawn: num(data.withdrawnSui),
  };
}
