/**
 * One-shot admin: cancel ALL open BlueFin orders.
 *
 * Use when pending orders have reserved collateral but won't fill (e.g. an
 * over-sized auto-hedge from the sui-community-pool cron that BlueFin
 * accepted but couldn't fully match). Frees the collateral so the pool's
 * other paths (trader, smaller auto-hedge) can use it.
 *
 * Auth: CRON_SECRET via Bearer header — same as the cron routes. Read-only
 * audit is also accepted (GET returns just the open-order list without
 * cancelling). Intentionally NOT routable from a browser/UI: the operator
 * runs this from the terminal during incident response.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { notifyDiscord } from '@/lib/utils/discord-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SYMBOLS_TO_CANCEL = ['BTC-PERP', 'ETH-PERP', 'SUI-PERP'] as const;

async function getClient() {
  const { BluefinClient, Networks } = await import('@bluefin-exchange/bluefin-v2-client');
  const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');
  const raw = (process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  if (!raw) throw new Error('BLUEFIN_PRIVATE_KEY not set');

  const hex = raw.startsWith('suiprivkey')
    ? Buffer.from(decodeSuiPrivateKey(raw).secretKey).toString('hex')
    : (raw.startsWith('0x') ? raw.slice(2) : raw);

  const network = (process.env.BLUEFIN_NETWORK || process.env.SUI_NETWORK || 'mainnet').trim();
  const isMainnet = network === 'mainnet';
  const client = new BluefinClient(
    !isMainnet,
    isMainnet ? Networks.PRODUCTION_SUI : Networks.TESTNET_SUI,
    hex,
    'ED25519',
  );
  await client.init();
  return client;
}

async function handle(req: NextRequest, dryRun: boolean) {
  const startTime = Date.now();
  const auth = await verifyCronRequest(req, 'CancelBluefinOrders');
  if (auth !== true) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = await getClient();
    const address = client.getPublicAddress();
    const before = await client.getUserAccountData();
    const beforeFree = Number((before as any)?.freeCollateral || 0);

    const results: Array<{ symbol: string; ordersCancelled: number; error?: string }> = [];
    for (const symbol of SYMBOLS_TO_CANCEL) {
      try {
        if (dryRun) {
          // Read-only path uses the existing trade-API open-orders list.
          // We don't issue any cancellation in dry-run mode.
          results.push({ symbol, ordersCancelled: 0 });
          continue;
        }
        const res = await client.cancelAllOpenOrders(symbol as any);
        const ok = (res as any)?.ok === true || (res as any)?.data?.ok === true;
        const data = (res as any)?.data;
        const cancelledHashes = Array.isArray(data?.data) ? data.data : [];
        results.push({ symbol, ordersCancelled: cancelledHashes.length, error: ok ? undefined : JSON.stringify(data) });
      } catch (e: any) {
        results.push({ symbol, ordersCancelled: 0, error: e?.message?.slice(0, 200) });
      }
    }

    const after = await client.getUserAccountData();
    const afterFree = Number((after as any)?.freeCollateral || 0);
    const totalCancelled = results.reduce((sum, r) => sum + r.ordersCancelled, 0);
    const freedCollateral = afterFree - beforeFree;

    if (!dryRun && totalCancelled > 0) {
      await notifyDiscord(
        `Cancelled ${totalCancelled} pending BlueFin order(s). Freed $${freedCollateral.toFixed(2)} collateral ($${beforeFree.toFixed(2)} → $${afterFree.toFixed(2)}).`,
        'WARN',
        { address, results, beforeFree, afterFree, freedCollateral },
      );
    }

    logger.info('[cancel-bluefin-orders] complete', {
      dryRun, totalCancelled, beforeFree, afterFree, results,
    });

    return NextResponse.json({
      success: true,
      dryRun,
      address,
      beforeFree,
      afterFree,
      freedCollateral,
      totalCancelled,
      results,
      durationMs: Date.now() - startTime,
    });
  } catch (e: any) {
    const msg = e?.message || (typeof e === 'string' ? e : '') || JSON.stringify(e)?.slice(0, 500) || 'unknown';
    const stack = e?.stack?.split('\n').slice(0, 6).join('\n');
    logger.error('[cancel-bluefin-orders] error', { message: msg, stack });
    return NextResponse.json({
      success: false,
      error: msg,
      stack,
      errorName: e?.name,
      durationMs: Date.now() - startTime,
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return handle(req, false); }
export async function GET(req: NextRequest) { return handle(req, true); }
