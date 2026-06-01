/**
 * Hyperliquid read-only client.
 *
 * Phase 1 (this commit): public REST queries for market data, OI, funding.
 * No wallet, no signing, no trading. Used to compare liquidity against
 * BlueFin so the auto-hedge cron can make informed routing decisions.
 *
 * Phase 2 (later): live trading. Hyperliquid uses a custom EIP-712 signing
 * scheme + an L1 settlement that's distinct from anything else in this
 * repo — significant new integration work. Tracked in T5-A.
 *
 * API:  https://api.hyperliquid.xyz
 *       POST /info  with body { type: "<query-type>", ... }
 * Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/api-reference
 */
import { logger } from '@/lib/utils/logger';
import type { PerpVenue, PerpMarketSnapshot } from './PerpVenue';
import { toBareAsset } from './PerpVenue';

const HL_API_URL = (process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz').replace(/\/$/, '');

// metaAndAssetCtxs response shape (subset we use). Hyperliquid returns a
// 2-tuple: [universeMeta, assetCtxs] where assetCtxs[i] is the live
// context for universeMeta.universe[i].
interface UniverseAsset {
  name: string;                 // e.g. "BTC"
  szDecimals: number;
  maxLeverage?: number;
}
interface AssetCtx {
  markPx: string;
  oraclePx?: string;
  funding: string;              // per 1h, decimal string. Multiply by 8 for 8h equiv.
  openInterest: string;         // in BASE asset units (not USD)
  dayNtlVlm: string;            // 24h notional volume, USD
  premium?: string;
}

let universeCache: { universe: UniverseAsset[]; ctxs: AssetCtx[]; fetchedAt: number } | null = null;
const UNIVERSE_TTL_MS = 30_000;

async function fetchUniverse(): Promise<{ universe: UniverseAsset[]; ctxs: AssetCtx[] } | null> {
  if (universeCache && Date.now() - universeCache.fetchedAt < UNIVERSE_TTL_MS) {
    return { universe: universeCache.universe, ctxs: universeCache.ctxs };
  }
  try {
    const res = await fetch(`${HL_API_URL}/info`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      logger.debug('[Hyperliquid] metaAndAssetCtxs HTTP error', { status: res.status });
      return null;
    }
    const data = (await res.json()) as [{ universe: UniverseAsset[] }, AssetCtx[]];
    if (!Array.isArray(data) || data.length < 2) return null;
    const universe = data[0]?.universe || [];
    const ctxs = data[1] || [];
    universeCache = { universe, ctxs, fetchedAt: Date.now() };
    return { universe, ctxs };
  } catch (e) {
    logger.debug('[Hyperliquid] fetchUniverse failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

export class HyperliquidService implements PerpVenue {
  readonly name = 'hyperliquid';

  private static _instance: HyperliquidService | null = null;
  static getInstance(): HyperliquidService {
    if (!this._instance) this._instance = new HyperliquidService();
    return this._instance;
  }

  async getMarketSnapshot(symbol: string): Promise<PerpMarketSnapshot | null> {
    const asset = toBareAsset(symbol);
    const data = await fetchUniverse();
    if (!data) return null;
    const idx = data.universe.findIndex(u => u.name?.toUpperCase() === asset);
    if (idx < 0) {
      logger.debug('[Hyperliquid] symbol not in universe', { asset, available: data.universe.length });
      return null;
    }
    const ctx = data.ctxs[idx];
    if (!ctx) return null;
    const price = parseFloat(ctx.markPx);
    if (!Number.isFinite(price) || price <= 0) return null;

    // openInterest is denominated in base-asset units (e.g. 1234.5 BTC)
    const oiBase = parseFloat(ctx.openInterest);
    const openInterestUsd = Number.isFinite(oiBase) && oiBase > 0 ? oiBase * price : 0;

    // funding is per 1h on Hyperliquid; convert to per-8h to match BlueFin/standard
    const funding1h = parseFloat(ctx.funding);
    const fundingRate = Number.isFinite(funding1h) ? funding1h * 8 : 0;

    const vol24 = parseFloat(ctx.dayNtlVlm);
    const volume24hUsd = Number.isFinite(vol24) ? vol24 : undefined;

    return {
      symbol: `${asset}-PERP`,
      price,
      openInterestUsd,
      fundingRate,
      volume24hUsd,
      venue: this.name,
    };
  }

  async canTrade(): Promise<boolean> {
    // Phase 1 is read-only; no trading possible yet.
    return false;
  }

  /**
   * Pulls every asset in Hyperliquid's universe — useful for an admin
   * view that compares OI across venues at a glance.
   */
  async getAllSnapshots(): Promise<PerpMarketSnapshot[]> {
    const data = await fetchUniverse();
    if (!data) return [];
    const out: PerpMarketSnapshot[] = [];
    for (let i = 0; i < data.universe.length; i++) {
      const u = data.universe[i];
      const ctx = data.ctxs[i];
      if (!u || !ctx) continue;
      const price = parseFloat(ctx.markPx);
      if (!Number.isFinite(price) || price <= 0) continue;
      const oiBase = parseFloat(ctx.openInterest);
      const openInterestUsd = Number.isFinite(oiBase) && oiBase > 0 ? oiBase * price : 0;
      const funding1h = parseFloat(ctx.funding);
      const vol24 = parseFloat(ctx.dayNtlVlm);
      out.push({
        symbol: `${u.name.toUpperCase()}-PERP`,
        price,
        openInterestUsd,
        fundingRate: Number.isFinite(funding1h) ? funding1h * 8 : 0,
        volume24hUsd: Number.isFinite(vol24) ? vol24 : undefined,
        venue: this.name,
      });
    }
    return out;
  }
}
