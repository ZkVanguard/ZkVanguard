/**
 * SUI community-pool cron — DB persistence steps (extracted from the route).
 *
 * Steps 4 (NAV snapshot), 5 (member sync), 6 (pool state) were inline in
 * app/api/cron/sui-community-pool/route.ts. Each is non-critical: it logs and
 * swallows its own error so one failing write never skips the others — that
 * independent-failure semantics is preserved exactly here.
 *
 * Pure relocation; no behavior change. The navUsd / sharePriceUsd / safety-
 * ceiling computation stays in the route because later steps depend on it.
 */
import { recordNavSnapshot, saveUserSharesToDb, savePoolStateToDb } from '@/lib/db/community-pool';
import { logger } from '@/lib/utils/logger';

const POOL_ASSETS = ['BTC', 'ETH', 'SUI'] as const;

interface PoolStatsLike {
  totalNAV: number;
  totalShares: number;
  sharePrice: number;
  memberCount: number;
}

interface PoolMemberLike {
  address: string;
  shares: number;
  valueUsd?: number;
  valueSui: number;
}

interface MemberSource {
  getAllMembers(): Promise<PoolMemberLike[]>;
}

/** Step 4 (write): record a NAV snapshot. Non-critical. */
export async function recordPoolNavSnapshot(args: {
  sharePriceUsd: number;
  navUsd: number;
  poolStats: PoolStatsLike;
  allocations: Record<string, number>;
}): Promise<void> {
  const { sharePriceUsd, navUsd, poolStats, allocations } = args;
  try {
    await recordNavSnapshot({
      sharePrice: sharePriceUsd || poolStats.sharePrice,
      totalNav: navUsd || poolStats.totalNAV,
      totalShares: poolStats.totalShares,
      memberCount: poolStats.memberCount,
      allocations,
      source: 'sui-usdc-pool',
      chain: 'sui',
    });
    logger.info('[SUI Cron] NAV snapshot recorded');
  } catch (navErr) {
    logger.warn('[SUI Cron] Failed to record NAV (non-critical)', { error: navErr });
  }
}

/** Step 5: sync on-chain members to DB. Non-critical. */
export async function syncMembersToDb(args: {
  suiService: MemberSource;
  suiPriceUsd: number;
}): Promise<void> {
  const { suiService, suiPriceUsd } = args;
  try {
    const members = await suiService.getAllMembers();
    let synced = 0;
    for (const m of members) {
      if (m.shares > 0) {
        await saveUserSharesToDb({
          walletAddress: m.address.toLowerCase(),
          shares: m.shares,
          costBasisUSD: m.valueUsd || m.valueSui * (suiPriceUsd || 0),
          chain: 'sui',
        });
        synced++;
      }
    }
    logger.info('[SUI Cron] Members synced to DB', { synced, total: members.length });
  } catch (syncErr) {
    logger.warn('[SUI Cron] Member sync failed (non-critical)', { error: syncErr });
  }
}

/** Step 6: persist pool state + last AI decision. Non-critical. */
export async function savePoolState(args: {
  navUsd: number;
  sharePriceUsd: number;
  poolStats: PoolStatsLike;
  allocations: Record<string, number>;
  reasoning: string;
  pricesUSD: Record<string, number>;
}): Promise<void> {
  const { navUsd, sharePriceUsd, poolStats, allocations, reasoning, pricesUSD } = args;
  try {
    const poolAllocRecord: Record<string, { percentage: number; valueUSD: number; amount: number; price: number }> = {};
    for (const asset of POOL_ASSETS) {
      const pct = allocations[asset] || 25;
      poolAllocRecord[asset] = {
        percentage: pct,
        valueUSD: navUsd * (pct / 100),
        amount: 0,
        price: pricesUSD[asset] || 0,
      };
    }

    await savePoolStateToDb({
      totalValueUSD: navUsd,
      totalShares: poolStats.totalShares,
      sharePrice: sharePriceUsd || 1,
      allocations: poolAllocRecord,
      lastRebalance: Date.now(),
      lastAIDecision: {
        timestamp: Date.now(),
        reasoning,
        allocations,
      },
      chain: 'sui',
    });
    logger.info('[SUI Cron] Pool state saved to DB');
  } catch (dbErr) {
    logger.warn('[SUI Cron] DB pool state save failed (non-critical)', { error: dbErr });
  }
}
