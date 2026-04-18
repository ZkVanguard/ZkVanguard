/**
 * Debug: SUI Pool Status & Last Cron Run
 * 
 * Returns detailed info about the SUI pool state and last cron execution.
 * Protected by DEBUG_SECRET env var.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { query } from '@/lib/db/postgres';
import { getSuiUsdcPoolService, SUI_USDC_POOL_CONFIG } from '@/lib/services/sui/SuiCommunityPoolService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const debugSecret = process.env.DEBUG_SECRET || process.env.CRON_SECRET;
  
  // Require auth in production
  if (process.env.NODE_ENV === 'production' && debugSecret) {
    if (authHeader !== `Bearer ${debugSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const network = ((process.env.SUI_NETWORK || 'testnet').trim()) as 'mainnet' | 'testnet';
  
  const result: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    network,
    envVars: {
      SUI_NETWORK: process.env.SUI_NETWORK ? `${network} (raw: ${process.env.SUI_NETWORK.length} chars)` : 'NOT SET',
      SUI_POOL_ADMIN_KEY: process.env.SUI_POOL_ADMIN_KEY ? '✅ SET' : '❌ NOT SET',
      SUI_AGENT_CAP_ID: process.env.SUI_AGENT_CAP_ID ? '✅ SET' : '❌ NOT SET',
      SUI_ADMIN_CAP_ID: process.env.SUI_ADMIN_CAP_ID ? '✅ SET' : '❌ NOT SET',
      BLUEFIN_PRIVATE_KEY: process.env.BLUEFIN_PRIVATE_KEY ? '✅ SET' : '❌ NOT SET',
      QSTASH_CURRENT_SIGNING_KEY: process.env.QSTASH_CURRENT_SIGNING_KEY ? '✅ SET' : '❌ NOT SET',
    },
    poolConfig: SUI_USDC_POOL_CONFIG[network],
  };

  // Fetch on-chain pool stats
  try {
    const suiService = getSuiUsdcPoolService(network);
    const poolStats = await suiService.getPoolStats();
    result.onChainPoolStats = poolStats;
  } catch (err) {
    result.onChainPoolStats = { error: err instanceof Error ? err.message : String(err) };
  }

  // Fetch last AI decision from DB
  try {
    const lastDecisions = await query(
      `SELECT created_at, details FROM community_pool_transactions 
       WHERE type = 'AI_DECISION' AND details->>'chain' = 'sui'
       ORDER BY created_at DESC LIMIT 3`
    ) as Array<{ created_at: Date; details: Record<string, unknown> }>;
    result.lastAIDecisions = lastDecisions.map(d => ({
      timestamp: d.created_at,
      allocations: (d.details as any)?.allocations,
      confidence: (d.details as any)?.confidence,
      shouldRebalance: (d.details as any)?.shouldRebalance,
    }));
  } catch (err) {
    result.lastAIDecisions = { error: err instanceof Error ? err.message : String(err) };
  }

  // Fetch recent NAV snapshots
  try {
    const navSnapshots = await query(
      `SELECT timestamp, share_price, total_nav, member_count, allocations 
       FROM community_pool_nav 
       WHERE chain = 'sui'
       ORDER BY timestamp DESC LIMIT 5`
    ) as Array<{ timestamp: Date; share_price: number; total_nav: number; member_count: number; allocations: Record<string, number> }>;
    result.recentNavSnapshots = navSnapshots;
  } catch (err) {
    result.recentNavSnapshots = { error: err instanceof Error ? err.message : String(err) };
  }

  // Fetch recent pool transactions (swaps, hedges, etc.)
  try {
    const txns = await query(
      `SELECT created_at, type, amount, details FROM community_pool_transactions 
       WHERE details->>'chain' = 'sui' AND type != 'AI_DECISION'
       ORDER BY created_at DESC LIMIT 10`
    ) as Array<{ created_at: Date; type: string; amount: number; details: Record<string, unknown> }>;
    result.recentTransactions = txns;
  } catch (err) {
    result.recentTransactions = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json(result);
}
