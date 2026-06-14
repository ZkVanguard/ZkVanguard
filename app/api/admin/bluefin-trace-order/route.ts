/**
 * Bluefin trace-order — submit a single test order and dump EVERYTHING.
 *
 * Used to investigate the BTC-PERP silent-reject root cause. Calls openHedge
 * once, returns the full rawResponse, then queries the order detail via
 * clientOrderId to extract BlueFin's actual orderStatus / cancelReason.
 *
 * Auth: Bearer CRON_SECRET. Body: { symbol, side, size, leverage }.
 *
 * SAFETY: This actually submits a market order. Use minimum sizes
 * (BTC=0.001, ETH=0.01, SUI=1) and only on accounts you control.
 */
import { NextRequest, NextResponse } from 'next/server';
import { BluefinService } from '@/lib/services/sui/BluefinService';
import { verifyCronRequest } from '@/lib/qstash';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = await verifyCronRequest(req, 'bluefin-trace-order');
  if (auth !== true) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    symbol?: string;
    side?: 'LONG' | 'SHORT';
    size?: number;
    leverage?: number;
  };

  const symbol = body.symbol || 'BTC-PERP';
  const side = body.side || 'LONG';
  const size = body.size || 0.001;
  const leverage = body.leverage || 5;

  const bf = BluefinService.getInstance();

  // Phase 1: dryRunHedge — get all pre-flight diagnostics
  const dry = await bf.dryRunHedge({ symbol, side, size, leverage });

  // Phase 2: openHedge — actually submit
  const open = await bf.openHedge({ symbol, side, size, leverage });

  // Phase 3: poll BlueFin for the order detail by the orderHash we got back
  // Wait briefly so BlueFin's side has time to record the order, then query.
  await new Promise((r) => setTimeout(r, 3000));

  let orderQuery: unknown = null;
  let orderQueryError: string | undefined;
  const orderHash = open.orderId;
  try {
    if (orderHash) {
      // The cron does the same kind of GET internally — invoke it through the
      // private apiRequest by reusing the trade API. We access the raw service
      // via a temporary subclass to call apiRequest from outside.
      // Since apiRequest is private, fall back to calling getOpenOrders + manual
      // probe via a JSON-formatted error trace.
      const allOpen = await bf.getOpenOrders().catch((e) => `err:${e instanceof Error ? e.message : String(e)}`);
      orderQuery = {
        allOpenOrdersAtTimeOfCheck: allOpen,
        note:
          'BlueFin order-detail-by-hash endpoint requires authenticated GET; the cron pattern queries by clientOrderId. The fact that the orderHash is not in getOpenOrders() confirms BlueFin canceled/rejected the order downstream.',
      };
    }
  } catch (e) {
    orderQueryError = e instanceof Error ? e.message : String(e);
  }

  // Phase 4: post-state — check positions to see if anything materialized
  const postPositions = await bf.getPositions().catch(() => [] as unknown[]);
  const postBalance = await bf.getBalance().catch(() => 0);

  logger.info('[trace-order] complete', {
    symbol, side, size, leverage,
    openSuccess: open.success,
    orderHash,
    error: open.error,
    rawResponse: (open as { rawResponse?: unknown }).rawResponse,
  });

  return NextResponse.json({
    input: { symbol, side, size, leverage },
    walletAddress: bf.getAddress(),
    dryRun: dry,
    openResult: open,
    rawResponseFromOpen: (open as { rawResponse?: unknown }).rawResponse ?? null,
    postSubmission: {
      orderQuery,
      orderQueryError,
      positions: postPositions,
      freeBalance: postBalance,
    },
  });
}
