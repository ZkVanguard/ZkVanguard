/**
 * POST /api/admin/reconcile-sui-hedges
 *
 * One-shot endpoint to mirror on-chain SUI pool hedges into the DB.
 * Auth: Bearer CRON_SECRET (same secret used by all cron routes).
 *
 * Idempotent. Safe to invoke repeatedly. The same logic runs automatically
 * inside the SUI cron after every successful pool tick.
 */

import { NextRequest, NextResponse } from 'next/server';
import { reconcileSuiHedges } from '@/lib/services/sui/SuiHedgeReconciler';
import { verifyAdminBearer } from '@/lib/security/auth-middleware';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function isAuthorized(req: NextRequest): boolean {
  return verifyAdminBearer(req, ['CRON_SECRET']);
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await reconcileSuiHedges();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
