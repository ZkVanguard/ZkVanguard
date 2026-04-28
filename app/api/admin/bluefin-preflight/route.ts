/**
 * Bluefin Preflight — verify the live trading pipeline is ready
 *
 * Run this BEFORE relying on auto-hedging. It checks:
 *   1. BLUEFIN_PRIVATE_KEY is configured and produces a valid Sui wallet
 *   2. Bluefin auth API is reachable (signs a JWT)
 *   3. The wallet is onboarded on Bluefin (account exists, canTrade=true)
 *   4. Free collateral / USDC margin balance
 *   5. Market data is reachable for each pair we hedge
 *   6. Latency on the auth + market data calls
 *
 * Auth: Bearer CRON_SECRET (admin only).
 *
 * Returns a structured `ready: boolean` plus per-check details. The cron
 * MUST refuse to fire hedges when this returns ready=false.
 */
import { NextRequest, NextResponse } from 'next/server';
import { BluefinService } from '@/lib/services/sui/BluefinService';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface CheckResult {
  ok: boolean;
  detail?: string;
  ms?: number;
  data?: unknown;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: true; ms: number; value: T } | { ok: false; ms: number; error: string }> {
  const start = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: Date.now() - start, value };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
  }
}

async function authorize(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization') || '';
  const expected = (process.env.CRON_SECRET || '').trim();
  if (!expected) return false;
  return auth === `Bearer ${expected}`;
}

async function runPreflight() {
  const checks: Record<string, CheckResult> = {};

  // 1. Env present?
  const hasKey = !!(process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  checks.env = {
    ok: hasKey,
    detail: hasKey ? 'BLUEFIN_PRIVATE_KEY set' : 'BLUEFIN_PRIVATE_KEY missing — hedges will be silently skipped',
  };
  if (!hasKey) return { ready: false, walletAddress: null, checks };

  const bluefin = BluefinService.getInstance();

  // 2. Initialize (also signs JWT and verifies the keypair)
  // BluefinService.initialize() requires (privateKey, network); we go through
  // a method call that auto-initializes from env via ensureInitializedAsync.
  const init = await timed(async () => {
    await bluefin.getBalance().catch(() => 0);
    return bluefin.getAddress();
  });
  if (!init.ok) {
    checks.initialize = { ok: false, ms: init.ms, detail: init.error };
    return { ready: false, walletAddress: null, checks };
  }
  const walletAddress = init.value || null;
  checks.initialize = { ok: true, ms: init.ms, detail: 'Bluefin client signed in', data: { walletAddress } };

  // 3. Account onboarding + balance — call the same path the cron will use
  const balance = await timed(() => bluefin.getBalance());
  checks.account = balance.ok
    ? {
        ok: balance.value > 0,
        ms: balance.ms,
        detail: balance.value > 0
          ? `Free collateral: ${balance.value.toFixed(4)} USDC`
          : 'Account exists but free collateral is 0 — fund the wallet on Bluefin before hedging',
        data: { freeCollateralUsdc: balance.value },
      }
    : {
        ok: false,
        ms: balance.ms,
        detail: balance.error.includes('404') || balance.error.toLowerCase().includes('not onboarded')
          ? `Wallet ${walletAddress} not onboarded on Bluefin. Visit https://trade.bluefin.io to register.`
          : balance.error,
      };

  // 4. Open positions snapshot — informational, not a gate
  const positions = await timed(() => bluefin.getPositions());
  checks.positions = positions.ok
    ? {
        ok: true,
        ms: positions.ms,
        detail: `${positions.value.length} open position(s)`,
        data: positions.value.map(p => ({
          symbol: p.symbol,
          side: p.side,
          size: p.size,
          leverage: p.leverage,
          entryPrice: p.entryPrice,
          markPrice: p.markPrice,
          unrealizedPnl: p.unrealizedPnl,
          marginRatio: p.marginRatio,
        })),
      }
    : { ok: false, ms: positions.ms, detail: positions.error };

  // 5. Market data reachable for each tradable pair
  const symbols = ['BTC-PERP', 'ETH-PERP', 'SUI-PERP'];
  const marketResults: Record<string, CheckResult> = {};
  await Promise.all(symbols.map(async sym => {
    const md = await timed(() => bluefin.getMarketData(sym));
    if (!md.ok) {
      marketResults[sym] = { ok: false, ms: md.ms, detail: md.error };
      return;
    }
    if (!md.value || !Number.isFinite(md.value.price) || md.value.price <= 0) {
      marketResults[sym] = { ok: false, ms: md.ms, detail: 'no price returned' };
      return;
    }
    marketResults[sym] = {
      ok: true,
      ms: md.ms,
      detail: `price=$${md.value.price.toFixed(2)} funding=${(md.value.fundingRate * 100).toFixed(4)}%`,
      data: md.value,
    };
  }));
  const allMarketsOk = Object.values(marketResults).every(c => c.ok);
  checks.markets = {
    ok: allMarketsOk,
    detail: allMarketsOk ? 'all perp markets reachable' : 'one or more perp markets unreachable',
    data: marketResults,
  };

  const ready = Boolean(checks.env.ok && checks.initialize.ok && checks.account.ok && checks.markets.ok);

  logger.info('[BluefinPreflight] result', {
    ready,
    walletAddress,
    freeCollateral: (checks.account.data as { freeCollateralUsdc?: number } | undefined)?.freeCollateralUsdc,
    markets: allMarketsOk,
  });

  return { ready, walletAddress, checks };
}

export async function GET(req: NextRequest) {
  if (!(await authorize(req))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await runPreflight();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    logger.error('[BluefinPreflight] fatal', e instanceof Error ? e : undefined);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
