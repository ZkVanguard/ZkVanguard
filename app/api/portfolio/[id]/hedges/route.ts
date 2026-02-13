/**
 * Portfolio Hedges API
 * 
 * GET /api/portfolio/[id]/hedges - Get all hedges for a portfolio
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActiveHedges } from '@/lib/db/hedges';
import { logger } from '@/lib/utils/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const portfolioId = parseInt(params.id);

    if (isNaN(portfolioId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid portfolio ID' },
        { status: 400 }
      );
    }

    // Get all hedges for this portfolio
    const hedges = await getActiveHedges(portfolioId);

    // Calculate aggregate stats
    const activeHedges = hedges;
    const totalNotional = activeHedges.reduce((sum, h) => sum + Number(h.notional_value || 0), 0);
    const totalPnL = activeHedges.reduce((sum, h) => sum + Number(h.current_pnl || 0), 0);
    const shortCount = activeHedges.filter(h => h.side === 'SHORT').length;
    const longCount = activeHedges.filter(h => h.side === 'LONG').length;

    return NextResponse.json({
      success: true,
      portfolioId,
      hedges: activeHedges.map(h => ({
        id: h.id,
        orderId: h.order_id,
        asset: h.asset,
        market: h.market,
        side: h.side,
        size: h.size,
        notional_value: h.notional_value,
        leverage: h.leverage,
        entry_price: h.entry_price,
        current_price: h.current_price,
        current_pnl: h.current_pnl,
        status: h.status,
        onChain: h.on_chain,
        createdAt: h.created_at,
      })),
      stats: {
        activeCount: activeHedges.length,
        totalNotional,
        totalPnL,
        shortCount,
        longCount,
        pnlPercent: totalNotional > 0 ? (totalPnL / totalNotional) * 100 : 0,
      },
    });
  } catch (error) {
    logger.error('Failed to get portfolio hedges', { error, portfolioId: params.id });
    return NextResponse.json(
      { success: false, error: 'Failed to get portfolio hedges' },
      { status: 500 }
    );
  }
}
