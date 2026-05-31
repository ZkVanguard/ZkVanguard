/**
 * Read-only debug: BlueFin positions + open orders + balance.
 * Auth: CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/qstash';
import { BluefinService } from '@/lib/services/sui/BluefinService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const auth = await verifyCronRequest(req, 'BluefinDebug');
  if (auth !== true) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const bf = BluefinService.getInstance();
    const [balance, positions, orders] = await Promise.all([
      bf.getBalance(),
      bf.getPositions(),
      bf.getOpenOrders(),
    ]);
    return NextResponse.json({
      freeCollateral: balance,
      positions,
      openOrders: orders,
      ts: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 });
  }
}
