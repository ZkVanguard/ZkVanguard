/**
 * Get Hedges from PostgreSQL Database
 * API endpoint for fetching hedge positions
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllHedges, getActiveHedges, getHedgeStats } from '@/lib/db/hedges';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/agents/hedging/list
 * Fetch hedge positions from database
 * 
 * Query params:
 * - portfolioId: Filter by portfolio (optional)
 * - status: 'active' | 'all' (default: 'all')
 * - limit: Number of results (default: 50)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const portfolioId = searchParams.get('portfolioId');
    const status = searchParams.get('status') || 'all';
    const limit = parseInt(searchParams.get('limit') || '50');

    logger.info('📊 Fetching hedges from database', { portfolioId, status, limit });

    let hedges;
    
    if (status === 'active') {
      hedges = await getActiveHedges(portfolioId ? parseInt(portfolioId) : undefined);
    } else {
      hedges = await getAllHedges(
        portfolioId ? parseInt(portfolioId) : undefined,
        limit
      );
    }

    // Get stats if requested
    const includeStats = searchParams.get('includeStats') === 'true';
    const stats = includeStats ? await getHedgeStats() : null;

    logger.info('✅ Hedges retrieved', { count: hedges.length });

    return NextResponse.json({
      success: true,
      hedges,
      count: hedges.length,
      stats,
    });

  } catch (error) {
    logger.error('❌ Failed to fetch hedges', { error });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch hedges',
      },
      { status: 500 }
    );
  }
}
