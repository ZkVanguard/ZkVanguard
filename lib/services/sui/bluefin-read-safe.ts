/**
 * Centralized "safe" BlueFin snapshot for NAV / health / display paths.
 *
 * Failure modes this defends against (all observed in production):
 *   1. Cold Vercel lambda — singleton not yet initialized, getBalance silently
 *      returns 0 instead of throwing.
 *   2. Auth handshake blip — JWT didn't land, account fetch returns null,
 *      getBalance returns 0.
 *   3. Venue API transient — Bluefin returns malformed/empty data, looks
 *      like "no positions" when on-chain says there should be exposure.
 *
 * Contract:
 *   - Always re-runs `initialize(adminKey, network)` before reading so a cold
 *     singleton can never silently surface as zero.
 *   - If the read looks "suspiciously empty" (free=$0 AND positions=[] AND
 *     onChainHasExposure=true), prefers the last-good DB cache over the live
 *     read. That is the asymmetry: a true $0 venue read is only trusted when
 *     on-chain agrees there should be nothing to read.
 *   - On any throw, falls back to the cache; if no fresh cache, surfaces
 *     `source: 'unknown'` so callers know the value can't be trusted.
 *
 * Cache TTL is intentionally longer than the sui-community-pool cron interval
 * (30 min) so any single warm read in the last 30 min covers cold-lambda gaps.
 */

import { logger } from '@/lib/utils/logger';
import { BluefinService, type BluefinPosition } from '@/lib/services/sui/BluefinService';
import { setCronState, getCronStateOr } from '@/lib/db/cron-state';

export interface BluefinSnapshot {
  free: number;
  lockedMargin: number;
  upnl: number;
  totalValue: number;          // free + lockedMargin + upnl
  positions: BluefinPosition[];
  positionsCount: number;
  source: 'live' | 'cache' | 'unknown';
  ageMs?: number;              // only set when source === 'cache'
  warning?: string;
}

const CACHE_KEY = 'bluefin:nav-last-good';
const CACHE_TTL_MS = 30 * 60 * 1000;

interface CachedSnapshot {
  value: number;
  free: number;
  lockedMargin: number;
  upnl: number;
  positions: number;            // count only — full position objects aren't cached
  ts: number;
}

function sumPositionFields(positions: BluefinPosition[]): { lockedMargin: number; upnl: number } {
  let lockedMargin = 0;
  let upnl = 0;
  for (const p of positions) {
    const pp = p as unknown as Record<string, unknown>;
    lockedMargin += Number(pp.margin ?? 0) || 0;
    upnl += Number(pp.unrealizedProfit ?? pp.uPnL ?? 0) || 0;
  }
  return { lockedMargin, upnl };
}

async function readCache(): Promise<{ cached: CachedSnapshot | null; ageMs: number }> {
  const cached = await getCronStateOr<CachedSnapshot | null>(CACHE_KEY, null);
  const ageMs = cached ? Date.now() - cached.ts : Infinity;
  return { cached, ageMs };
}

function snapshotFromCache(c: CachedSnapshot, ageMs: number, warning: string): BluefinSnapshot {
  return {
    free: c.free,
    lockedMargin: c.lockedMargin,
    upnl: c.upnl,
    totalValue: c.value,
    positions: [],
    positionsCount: c.positions,
    source: 'cache',
    ageMs,
    warning,
  };
}

/**
 * Read BlueFin venue state with cache fallback.
 *
 * @param onChainHasExposure  Pass true when on-chain hedge_state.active_hedges
 *   is non-empty OR total_hedged_value > 0. Lets the helper distinguish "venue
 *   really empty" from "venue read failed and we expected exposure."
 */
export async function safeBluefinSnapshot(opts: {
  network: 'mainnet' | 'testnet';
  onChainHasExposure: boolean;
}): Promise<BluefinSnapshot> {
  const adminKey = (process.env.BLUEFIN_PRIVATE_KEY || process.env.SUI_POOL_ADMIN_KEY || '').trim();
  if (!adminKey) {
    const { cached, ageMs } = await readCache();
    if (cached && ageMs < CACHE_TTL_MS) {
      return snapshotFromCache(cached, ageMs, 'no adminKey configured — using cache');
    }
    return {
      free: 0, lockedMargin: 0, upnl: 0, totalValue: 0,
      positions: [], positionsCount: 0,
      source: 'unknown', warning: 'no BLUEFIN_PRIVATE_KEY configured',
    };
  }

  try {
    const bf = BluefinService.getInstance();
    // Always re-call initialize. It's idempotent when already initialized
    // (returns early on line 199–201) and re-runs auth if not.
    await bf.initialize(adminKey, opts.network);

    const [freeRes, posRes] = await Promise.allSettled([
      bf.getBalance(),
      bf.getPositions(),
    ]);
    const free = freeRes.status === 'fulfilled' ? (Number(freeRes.value) || 0) : 0;
    const positions: BluefinPosition[] = posRes.status === 'fulfilled' ? posRes.value : [];
    const bothOk = freeRes.status === 'fulfilled' && posRes.status === 'fulfilled';

    const { lockedMargin, upnl } = sumPositionFields(positions);
    const computed = free + lockedMargin + upnl;
    const venueLooksEmpty = free === 0 && positions.length === 0;

    // Trust path 1: both fetches succeeded AND something is there.
    if (bothOk && !venueLooksEmpty) {
      const cachePayload: CachedSnapshot = {
        value: computed, free, lockedMargin, upnl,
        positions: positions.length, ts: Date.now(),
      };
      await setCronState(CACHE_KEY, cachePayload).catch(() => { /* best-effort */ });
      return {
        free, lockedMargin, upnl, totalValue: computed,
        positions, positionsCount: positions.length,
        source: 'live',
      };
    }

    // Trust path 2: both fetches succeeded, venue truly empty, AND on-chain
    // agrees. Real zero — also cache it so consecutive cold reads don't churn.
    if (bothOk && venueLooksEmpty && !opts.onChainHasExposure) {
      const cachePayload: CachedSnapshot = {
        value: 0, free: 0, lockedMargin: 0, upnl: 0,
        positions: 0, ts: Date.now(),
      };
      await setCronState(CACHE_KEY, cachePayload).catch(() => { /* best-effort */ });
      return {
        free: 0, lockedMargin: 0, upnl: 0, totalValue: 0,
        positions: [], positionsCount: 0,
        source: 'live',
      };
    }

    // Suspicious read: venue says empty but chain says exposure, OR a sub-
    // fetch rejected. Prefer the cache.
    const { cached, ageMs } = await readCache();
    if (cached && ageMs < CACHE_TTL_MS) {
      logger.warn('[BluefinReadSafe] suspicious live read — using last-good cache', {
        bothOk,
        freeRead: freeRes.status,
        posRead: posRes.status,
        rawFree: free,
        rawPositions: positions.length,
        onChainHasExposure: opts.onChainHasExposure,
        cachedValue: cached.value,
        cacheAgeMs: ageMs,
      });
      return snapshotFromCache(cached, ageMs, 'live read looked empty while on-chain has exposure');
    }

    logger.error('[BluefinReadSafe] suspicious live read AND no fresh cache — surfacing unknown', {
      bothOk,
      freeRead: freeRes.status,
      posRead: posRes.status,
      onChainHasExposure: opts.onChainHasExposure,
      cacheAgeMs: cached ? ageMs : null,
    });
    return {
      free, lockedMargin, upnl, totalValue: computed,
      positions, positionsCount: positions.length,
      source: 'unknown',
      warning: 'venue read suspicious and no fresh cache',
    };
  } catch (err) {
    const { cached, ageMs } = await readCache();
    if (cached && ageMs < CACHE_TTL_MS) {
      logger.warn('[BluefinReadSafe] read threw — using last-good cache', {
        error: err instanceof Error ? err.message : String(err),
        cachedValue: cached.value,
        cacheAgeMs: ageMs,
      });
      return snapshotFromCache(cached, ageMs, `read threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    logger.error('[BluefinReadSafe] read threw and no fresh cache', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      free: 0, lockedMargin: 0, upnl: 0, totalValue: 0,
      positions: [], positionsCount: 0,
      source: 'unknown',
      warning: `read threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
