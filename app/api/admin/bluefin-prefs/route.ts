/**
 * Bluefin account preferences — GET / PUT
 *
 * GET returns the current per-symbol margin / leverage preferences. PUT updates
 * them. Used to diagnose and fix the openHedge silent-reject (BlueFin appears
 * to require explicit per-symbol marginType + leverage configuration via this
 * endpoint before orders for that symbol can persist).
 *
 * Auth: Bearer CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { BluefinService } from '@/lib/services/sui/BluefinService';
import { verifyCronRequest } from '@/lib/qstash';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const auth = await verifyCronRequest(req, 'bluefin-prefs');
  if (auth !== true) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const bf = BluefinService.getInstance();
  try {
    // Force initialization
    await bf.getBalance().catch(() => 0);
    const prefs = await bf.adminRawApiRequest('GET', '/api/v1/account/preferences', undefined, 'trade');
    return NextResponse.json({ preferences: prefs, walletAddress: bf.getAddress() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await verifyCronRequest(req, 'bluefin-prefs');
  if (auth !== true) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const bf = BluefinService.getInstance();
  try {
    await bf.getBalance().catch(() => 0);
    const result = await bf.adminRawApiRequest('PUT', '/api/v1/account/preferences', body, 'trade');
    logger.info('[bluefin-prefs] PUT result', { body, result });
    return NextResponse.json({ result, sent: body, walletAddress: bf.getAddress() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
