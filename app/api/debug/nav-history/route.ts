import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/postgres';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

/**
 * Debug endpoint to view NAV history
 * GET /api/debug/nav-history
 * 
 * SECURITY: Requires admin key or dev environment only
 */
export async function GET(request: Request) {
  // Only allow with admin key (header-based only for security)
  const adminKey = new Headers(request.headers).get('x-admin-key');
  const isAdmin = adminKey === process.env.INTERNAL_API_SECRET;

  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const records = await query(
      `SELECT id, timestamp, share_price, total_nav, total_shares, member_count, source
       FROM community_pool_nav_history
       ORDER BY timestamp ASC
       LIMIT 15`,
      []
    );
    
    const latest = await query(
      `SELECT id, timestamp, share_price, total_nav, total_shares, member_count, source
       FROM community_pool_nav_history
       ORDER BY timestamp DESC
       LIMIT 5`,
      []
    );
    
    const baseNAV = 10000;
    let calculatedReturn = null;
    
    if (records.length >= 2) {
      const first = records[0];
      const last = records[records.length - 1];
      
      const firstNormalizedNAV = baseNAV * Number(first.share_price);
      const lastNormalizedNAV = baseNAV * Number(last.share_price);
      const returnPct = ((lastNormalizedNAV - firstNormalizedNAV) / firstNormalizedNAV) * 100;
      const directShareReturn = ((Number(last.share_price) - Number(first.share_price)) / Number(first.share_price)) * 100;
      
      calculatedReturn = {
        firstSharePrice: Number(first.share_price),
        lastSharePrice: Number(last.share_price),
        firstNormalizedNAV: firstNormalizedNAV,
        lastNormalizedNAV: lastNormalizedNAV,
        calculatedReturn: returnPct,
        directSharePriceReturn: directShareReturn,
      };
    }
    
    return NextResponse.json({
      success: true,
      totalRecords: records.length,
      firstRecords: records.map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        sharePrice: Number(r.share_price),
        totalNav: Number(r.total_nav),
        totalShares: Number(r.total_shares),
        memberCount: r.member_count,
        source: r.source,
      })),
      latestRecords: latest.map(r => ({
        timestamp: r.timestamp,
        sharePrice: Number(r.share_price),
        totalNav: Number(r.total_nav),
        source: r.source,
      })),
      calculatedReturn,
    });
  } catch (error) {
    logger.error('[Debug NAV History] Failed to query', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve NAV history',
    }, { status: 500 });
  }
}
