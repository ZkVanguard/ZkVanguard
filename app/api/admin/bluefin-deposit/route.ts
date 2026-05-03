/**
 * POST /api/admin/bluefin-deposit
 *
 * Admin-only endpoint to deposit USDC from the operator's spot SUI wallet into
 * the Bluefin Margin Bank so the auto-hedge cron can place perp orders.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 * Body: { amount?: number }    // USDC; if omitted, runs autoTopUp(min, target)
 */

import { NextResponse, NextRequest } from 'next/server';
import { bluefinTreasury } from '@/lib/services/sui/BluefinTreasuryService';
import { logger } from '@/lib/utils/logger';
import { verifyAdminBearer } from '@/lib/security/auth-middleware';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_MIN_MARGIN = Number(process.env.BLUEFIN_MIN_MARGIN_USD || 20);
const DEFAULT_TARGET_MARGIN = Number(process.env.BLUEFIN_TARGET_MARGIN_USD || 50);
const DEFAULT_SPOT_RESERVE = Number(process.env.BLUEFIN_SPOT_RESERVE_USD || 1);

function authorize(req: NextRequest): boolean {
  return verifyAdminBearer(req, ['CRON_SECRET']);
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: {
    amount?: number;
    minMargin?: number;
    targetMargin?: number;
    spotReserve?: number;
    swapFromSui?: boolean;
    suiReserve?: number;
    maxSwapSui?: number;
  } = {};
  try {
    body = (await req.json().catch(() => ({}))) || {};
  } catch {
    body = {};
  }

  try {
    const wallet = bluefinTreasury.getAddress();
    if (typeof body.amount === 'number' && body.amount > 0) {
      const result = await bluefinTreasury.deposit(body.amount);
      return NextResponse.json({ mode: 'manual', wallet, ...result });
    }

    const result = await bluefinTreasury.autoTopUp({
      minMargin: body.minMargin ?? DEFAULT_MIN_MARGIN,
      targetMargin: body.targetMargin ?? DEFAULT_TARGET_MARGIN,
      spotReserve: body.spotReserve ?? DEFAULT_SPOT_RESERVE,
      swapFromSui: body.swapFromSui ?? ((process.env.BLUEFIN_TOPUP_SWAP_FROM_SUI || 'true').toLowerCase() !== 'false'),
      suiReserve: body.suiReserve ?? Number(process.env.BLUEFIN_SUI_RESERVE || 0.5),
      maxSwapSui: body.maxSwapSui ?? Number(process.env.BLUEFIN_MAX_SWAP_SUI || 25),
    });
    return NextResponse.json({ ok: true, mode: 'auto', wallet, result });
  } catch (err) {
    logger.error('[bluefin-deposit] failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const [margin, spot] = await Promise.all([
      bluefinTreasury.getMarginBalance().catch((e) => ({ error: String(e) })),
      bluefinTreasury.getSpotUsdcBalance().catch((e) => ({ error: String(e) })),
    ]);
    return NextResponse.json({
      ok: true,
      wallet: bluefinTreasury.getAddress(),
      marginBankUsdc: margin,
      spotUsdc: spot,
      defaults: {
        minMargin: DEFAULT_MIN_MARGIN,
        targetMargin: DEFAULT_TARGET_MARGIN,
        spotReserve: DEFAULT_SPOT_RESERVE,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
