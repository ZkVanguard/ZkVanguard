/**
 * Cron Job: Sync On-Chain Pool Members to Neon DB
 * 
 * Offloaded from pool-nav-monitor to avoid Vercel function timeouts.
 * Makes N sequential RPC calls (one per member) — schedule via QStash 
 * at a lower frequency (every 1-4 hours).
 * 
 * Schedule: Every 2 hours via QStash
 * Security: QStash signature or CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { saveUserSharesToDb } from '@/lib/db/community-pool';
import { ethers } from 'ethers';
import { getCronosRpcUrl } from '@/lib/throttled-provider';
import { errMsg } from '@/lib/utils/error-handler';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const COMMUNITY_POOL_ADDRESS = process.env.NEXT_PUBLIC_COMMUNITY_POOL_PROXY_ADDRESS || '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';
const POOL_ABI = [
  'function getMemberCount() view returns (uint256)',
  'function memberList(uint256 index) view returns (address)',
  'function members(address) view returns (uint256 shares, uint128 depositedUSD, uint64 investedAt, bool active)',
];

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  const authResult = await verifyCronRequest(request, 'SyncMembers');
  if (authResult !== true) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const provider = new ethers.JsonRpcProvider(getCronosRpcUrl());
    const contract = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, provider);

    const memberCount = Number(await contract.getMemberCount());
    logger.info(`[SyncMembers] Syncing ${memberCount} members from on-chain`);

    let synced = 0;
    let errors = 0;

    // Process in small parallel batches to stay within RPC rate limits
    const BATCH_SIZE = 5;
    for (let i = 0; i < memberCount; i += BATCH_SIZE) {
      const batch = Array.from({ length: Math.min(BATCH_SIZE, memberCount - i) }, (_, j) => i + j);
      const results = await Promise.allSettled(
        batch.map(async (idx) => {
          const addr = await contract.memberList(idx);
          const memberData = await contract.members(addr);
          if (memberData.active) {
            await saveUserSharesToDb({
              walletAddress: addr.toLowerCase(),
              shares: parseFloat(ethers.formatUnits(memberData.shares, 18)),
              costBasisUSD: parseFloat(ethers.formatUnits(memberData.depositedUSD, 6)),
            });
            return true;
          }
          return false;
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) synced++;
        else if (r.status === 'rejected') errors++;
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`[SyncMembers] Done: ${synced} synced, ${errors} errors, ${duration}ms`);

    return NextResponse.json({
      success: true,
      memberCount,
      synced,
      errors,
      duration,
    });
  } catch (error: unknown) {
    logger.error('[SyncMembers] Error:', error);
    return safeErrorResponse(error, 'Sync members');
  }
}
