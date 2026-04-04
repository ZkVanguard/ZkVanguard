/**
 * Seed NAV History API Endpoint
 * 
 * POST /api/community-pool/seed-nav-history
 * 
 * Seeds 30 days of historical NAV data for risk metrics calculation.
 * Protected by CRON_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { query } from '@/lib/db/postgres';
import { ethers } from 'ethers';
import { getCronosRpcUrl } from '@/lib/throttled-provider';

export const runtime = 'nodejs';

export const maxDuration = 10;
const CRONOS_RPC = getCronosRpcUrl();
const COMMUNITY_POOL_ADDRESS = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';
const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
];

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Auth check - allow CRON_SECRET or admin header
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    logger.info('[Seed NAV] Starting NAV history seeding...');
    
    // Fetch current on-chain data
    const provider = new ethers.JsonRpcProvider(CRONOS_RPC);
    const pool = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, provider);
    const stats = await pool.getPoolStats();
    
    const currentSharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));
    const currentTotalNAV = parseFloat(ethers.formatUnits(stats._totalNAV, 6));
    const currentTotalShares = parseFloat(ethers.formatUnits(stats._totalShares, 18));
    const memberCount = Number(stats._memberCount);
    
    logger.info('[Seed NAV] Current on-chain values', {
      sharePrice: currentSharePrice,
      totalNAV: currentTotalNAV,
      totalShares: currentTotalShares,
      memberCount
    });
    
    // Check existing data
    const existingResult = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM community_pool_nav_history',
      []
    );
    const existingCount = parseInt(existingResult[0]?.count || '0', 10);
    
    // Generate 30 days of historical data
    const DAYS_TO_SEED = 30;
    const INCEPTION_SHARE_PRICE = 1.00;
    
    // Calculate daily return needed
    const totalReturn = (currentSharePrice / INCEPTION_SHARE_PRICE) - 1;
    const avgDailyReturn = totalReturn / DAYS_TO_SEED;
    const volatility = 0.01;
    
    const snapshots: Array<{
      timestamp: Date;
      sharePrice: string;
      totalNav: string;
      totalShares: string;
      memberCount: number;
    }> = [];
    
    for (let day = DAYS_TO_SEED; day >= 0; day--) {
      const timestamp = new Date();
      timestamp.setDate(timestamp.getDate() - day);
      timestamp.setHours(0, 0, 0, 0);
      
      let sharePrice: number;
      if (day === 0) {
        sharePrice = currentSharePrice;
      } else if (day === DAYS_TO_SEED) {
        sharePrice = INCEPTION_SHARE_PRICE;
      } else {
        // Linear interpolation from inception to current — no synthetic noise
        const progress = (DAYS_TO_SEED - day) / DAYS_TO_SEED;
        sharePrice = INCEPTION_SHARE_PRICE + (currentSharePrice - INCEPTION_SHARE_PRICE) * progress;
      }
      
      const totalNav = sharePrice * currentTotalShares;
      
      snapshots.push({
        timestamp,
        sharePrice: sharePrice.toFixed(8),
        totalNav: totalNav.toFixed(8),
        totalShares: currentTotalShares.toFixed(8),
        memberCount,
      });
    }
    
    // Sort by timestamp ascending
    snapshots.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Insert snapshots (skip if already exists for that day)
    let inserted = 0;
    for (const snap of snapshots) {
      try {
        const existing = await query<{ id: number }>(
          `SELECT id FROM community_pool_nav_history 
           WHERE timestamp >= $1 AND timestamp <= $2 LIMIT 1`,
          [
            new Date(snap.timestamp.getTime() - 3600000).toISOString(),
            new Date(snap.timestamp.getTime() + 3600000).toISOString()
          ]
        );
        
        if (existing.length === 0) {
          await query(
            `INSERT INTO community_pool_nav_history 
             (timestamp, share_price, total_nav, total_shares, member_count, source)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              snap.timestamp.toISOString(),
              snap.sharePrice,
              snap.totalNav,
              snap.totalShares,
              snap.memberCount,
              'historical-seed'
            ]
          );
          inserted++;
        }
      } catch (err) {
        logger.warn('[Seed NAV] Failed to insert snapshot', { timestamp: snap.timestamp, error: err });
      }
    }
    
    // Get new count
    const newCountResult = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM community_pool_nav_history',
      []
    );
    const newCount = parseInt(newCountResult[0]?.count || '0', 10);
    
    const duration = Date.now() - startTime;
    
    logger.info('[Seed NAV] Seeding complete', {
      previousCount: existingCount,
      inserted,
      newCount,
      duration: `${duration}ms`
    });
    
    return NextResponse.json({
      success: true,
      previousCount: existingCount,
      inserted,
      totalCount: newCount,
      duration: `${duration}ms`,
      message: `Seeded ${inserted} historical NAV snapshots. Risk metrics should now work.`
    });
    
  } catch (error) {
    logger.error('[Seed NAV] Failed to seed NAV history', error);
    return safeErrorResponse(error, 'Failed to seed NAV history');
  }
}
