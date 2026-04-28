/**
 * SuiHedgeReconciler
 * --------------------------------------------------------------------------
 * Two-way reconciliation between SUI on-chain pool state and the Postgres
 * `hedges` table.
 *
 * The SUI USDC pool's Move contract holds active hedges in
 * `pool.hedge_state.active_hedges` (vector<HedgePosition>). These positions
 * include both:
 *   1. Real risk hedges opened by the auto-hedge agent
 *   2. Operational $0.01 "rebalance" hedges used by the cron to transfer
 *      USDC from the pool capability to the admin wallet for DEX swaps
 *
 * Until now the DB `hedges` table was BlueFin-perp-only. This reconciler
 * mirrors all on-chain HedgePosition objects into the DB so analytics, P&L
 * tracking, and the UI's historical views reflect the source of truth.
 *
 * Algorithm:
 *   1. Read on-chain active_hedges via SUI RPC sui_getObject
 *   2. Load DB hedges where chain='sui' AND status='active'
 *   3. INSERT any on-chain hedge missing from DB (keyed by hedge_id_onchain)
 *   4. UPDATE status='closed' for any DB row with chain='sui' status='active'
 *      whose hedge_id_onchain is no longer present on-chain
 *
 * Idempotent and safe to run repeatedly.
 */

import { query } from '@/lib/db/postgres';
import {
  ensureHedgesTable,
  createHedge,
  updateHedgeStatus,
  type Hedge,
} from '@/lib/db/hedges';
import { env, envFirst } from '@/lib/utils/env';
import { logger } from '@/lib/utils/logger';
import { SUI_COMMUNITY_POOL_PORTFOLIO_ID } from '@/lib/constants';

const SUI_PAIR_INDEX_TO_ASSET: Record<number, string> = {
  0: 'BTC',
  1: 'ETH',
  2: 'SUI',
  3: 'CRO',
};

interface OnChainHedge {
  hedgeIdOnchain: string;
  asset: string;
  side: 'LONG' | 'SHORT';
  collateralUsdc: number;
  leverage: number;
  notionalValue: number;
  openTimeMs: number;
  reason: string;
  pairIndex: number;
}

export interface ReconcileResult {
  onChainCount: number;
  dbCount: number;
  inserted: number;
  closed: number;
  unchanged: number;
  errors: string[];
}

/**
 * Read pool.hedge_state.active_hedges from on-chain via SUI RPC.
 */
async function readOnChainHedges(): Promise<OnChainHedge[]> {
  const poolStateId = envFirst([
    'NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE',
    'NEXT_PUBLIC_SUI_USDC_POOL_STATE',
    'NEXT_PUBLIC_SUI_POOL_STATE_ID',
  ]);
  if (!poolStateId) {
    throw new Error('No SUI pool state ID configured');
  }

  const rpcUrl = env('NEXT_PUBLIC_SUI_RPC_URL', 'https://fullnode.mainnet.sui.io:443');

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sui_getObject',
      params: [poolStateId, { showContent: true, showType: true }],
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`SUI RPC returned ${res.status}`);
  }

  const json = (await res.json()) as {
    result?: { data?: { content?: { fields?: Record<string, unknown> } } };
  };

  const fields = json?.result?.data?.content?.fields;
  if (!fields) return [];

  const hedgeState = (fields.hedge_state as { fields?: Record<string, unknown> })?.fields || {};
  const activeHedges = Array.isArray(hedgeState.active_hedges)
    ? (hedgeState.active_hedges as Array<{ fields?: Record<string, unknown> }>)
    : [];

  return activeHedges
    .map((h): OnChainHedge | null => {
      const f = h?.fields || {};
      const hedgeIdBytes = Array.isArray(f.hedge_id) ? (f.hedge_id as number[]) : [];
      if (hedgeIdBytes.length === 0) return null;

      const hedgeIdOnchain =
        '0x' + hedgeIdBytes.map((b) => Number(b).toString(16).padStart(2, '0')).join('');

      const pairIndex = Number(f.pair_index ?? 0);
      const asset = SUI_PAIR_INDEX_TO_ASSET[pairIndex] || `PAIR_${pairIndex}`;
      const isLong = Boolean(f.is_long);
      const collateralUsdc = Number(f.collateral_usdc || 0) / 1e6;
      const leverage = Math.max(1, Number(f.leverage || 1));

      const reasonBytes = Array.isArray(f.reason_hash) ? (f.reason_hash as number[]) : [];
      const reason =
        reasonBytes.length > 0
          ? '0x' + reasonBytes.map((b) => Number(b).toString(16).padStart(2, '0')).join('')
          : 'on-chain hedge (reason_hash absent)';

      return {
        hedgeIdOnchain,
        asset,
        side: isLong ? 'LONG' : 'SHORT',
        collateralUsdc,
        leverage,
        notionalValue: collateralUsdc * leverage,
        openTimeMs: Number(f.open_time || 0),
        reason,
        pairIndex,
      };
    })
    .filter((h): h is OnChainHedge => h !== null);
}

/**
 * Load existing DB hedges for the SUI community pool (active only).
 * Keyed by hedge_id_onchain when present.
 */
async function loadDbHedges(): Promise<Map<string, Hedge>> {
  await ensureHedgesTable();
  const rows = await query<Hedge>(
    `SELECT * FROM hedges
     WHERE chain = $1 AND status = $2 AND hedge_id_onchain IS NOT NULL`,
    ['sui', 'active'],
  );
  const map = new Map<string, Hedge>();
  for (const row of rows) {
    if (row.hedge_id_onchain) {
      map.set(row.hedge_id_onchain.toLowerCase(), row);
    }
  }
  return map;
}

/**
 * Fetch live USD prices for the assets present in the on-chain hedge set.
 * Returns a (possibly partial) map. Missing prices are non-fatal.
 */
async function fetchAssetPrices(assets: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (assets.length === 0) return out;
  try {
    const { getMarketDataService } = await import(
      '@/lib/services/market-data/RealMarketDataService'
    );
    const mds = getMarketDataService();
    await Promise.all(
      assets.map(async (a) => {
        try {
          const p = await mds.getTokenPrice(a);
          if (p?.price && p.price > 0) out[a] = p.price;
        } catch {
          /* missing price is non-fatal */
        }
      }),
    );
  } catch (err) {
    logger.warn('[HedgeReconciler] Failed to load market prices', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}

/**
 * Reconcile on-chain SUI hedges into the Postgres `hedges` table.
 * Idempotent. Returns counts of inserted/closed rows.
 */
export async function reconcileSuiHedges(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    onChainCount: 0,
    dbCount: 0,
    inserted: 0,
    closed: 0,
    unchanged: 0,
    errors: [],
  };

  let onChain: OnChainHedge[];
  try {
    onChain = await readOnChainHedges();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('[HedgeReconciler] Failed to read on-chain state', { error: msg });
    result.errors.push(`onchain-read: ${msg}`);
    return result;
  }
  result.onChainCount = onChain.length;

  let db: Map<string, Hedge>;
  try {
    db = await loadDbHedges();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('[HedgeReconciler] Failed to load DB state', { error: msg });
    result.errors.push(`db-read: ${msg}`);
    return result;
  }
  result.dbCount = db.size;

  const onChainIds = new Set(onChain.map((h) => h.hedgeIdOnchain.toLowerCase()));

  // Prefetch prices once for all assets present on-chain. Used both for new
  // inserts (entry_price + current_price) and for refreshing current_price on
  // already-mirrored rows so the UI shows live PnL.
  const uniqueAssets = Array.from(new Set(onChain.map((h) => h.asset)));
  const priceMap = await fetchAssetPrices(uniqueAssets);

  // 1. INSERT on-chain hedges not in DB
  for (const oc of onChain) {
    const key = oc.hedgeIdOnchain.toLowerCase();
    if (db.has(key)) {
      result.unchanged++;
      continue;
    }
    try {
      // Use hedge_id_onchain as the natural key. order_id needs to be unique;
      // derive it from the on-chain hedge id so re-runs are idempotent.
      const orderId = `sui-onchain-${oc.hedgeIdOnchain.slice(2, 18)}`;

      // Already inserted by another runner? Skip.
      const existing = await query<{ id: number }>(
        'SELECT id FROM hedges WHERE order_id = $1 OR hedge_id_onchain = $2 LIMIT 1',
        [orderId, oc.hedgeIdOnchain],
      );
      if (existing.length > 0) {
        result.unchanged++;
        continue;
      }

      const livePrice = priceMap[oc.asset] || 0;

      await createHedge({
        orderId,
        portfolioId: SUI_COMMUNITY_POOL_PORTFOLIO_ID,
        walletAddress: env('SUI_POOL_ADMIN_ADDRESS'),
        asset: oc.asset,
        market: oc.notionalValue < 1 ? 'POOL_REBALANCE' : 'BLUEFIN_PERP',
        side: oc.side,
        // `size` column is DECIMAL(18,8) so it preserves the true collateral.
        size: oc.collateralUsdc,
        // `notional_value` column is DECIMAL(18,2). Sub-cent rebalance hedges
        // would round to 0.00 and trip downstream validators — floor at 0.01.
        // The authoritative value is always on-chain.
        notionalValue: Math.max(0.01, oc.notionalValue),
        leverage: oc.leverage,
        // Move contract doesn't store entry price; capture spot at first
        // observation. Subsequent reconciliation cycles only update
        // current_price so PnL anchors to discovery time.
        entryPrice: livePrice > 0 ? livePrice : undefined,
        simulationMode: false,
        reason: `Reconciled from on-chain (pair_index=${oc.pairIndex}, reason_hash=${oc.reason.slice(0, 18)}...)`,
        chain: 'sui',
      });

      // Backfill on-chain id, opened-at timestamp, and current_price.
      await query(
        `UPDATE hedges
         SET hedge_id_onchain = $1,
             on_chain = true,
             created_at = $2,
             current_price = $3,
             price_source = 'reconciler',
             price_updated_at = CURRENT_TIMESTAMP
         WHERE order_id = $4`,
        [
          oc.hedgeIdOnchain,
          oc.openTimeMs > 0 ? new Date(oc.openTimeMs) : new Date(),
          livePrice > 0 ? livePrice : null,
          orderId,
        ],
      );
      result.inserted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('[HedgeReconciler] Failed to insert on-chain hedge', {
        hedgeId: oc.hedgeIdOnchain,
        error: msg,
      });
      result.errors.push(`insert ${oc.hedgeIdOnchain}: ${msg}`);
    }
  }

  // 2. CLOSE DB hedges no longer present on-chain
  for (const [key, dbHedge] of db.entries()) {
    if (onChainIds.has(key)) continue;
    try {
      await updateHedgeStatus(dbHedge.hedge_id_onchain || dbHedge.order_id, 'closed');
      result.closed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('[HedgeReconciler] Failed to close DB hedge', {
        hedgeId: dbHedge.hedge_id_onchain,
        error: msg,
      });
      result.errors.push(`close ${dbHedge.hedge_id_onchain}: ${msg}`);
    }
  }

  // 3. Refresh live prices and PnL on still-active mirrored rows so the UI
  // displays current numbers without waiting for a separate price-tracker job.
  for (const [key, dbHedge] of db.entries()) {
    if (!onChainIds.has(key)) continue;
    const livePrice = priceMap[dbHedge.asset];
    if (!livePrice || livePrice <= 0) continue;
    const entry = Number(dbHedge.entry_price ?? 0);
    const size = Number(dbHedge.size ?? 0);
    // PnL = (current - entry) × size × side-sign  (size is collateralUsdc here,
    // so this is a directional dollar approximation suitable for display).
    const sign = dbHedge.side === 'LONG' ? 1 : -1;
    const pnl = entry > 0 ? sign * (livePrice - entry) * size : 0;
    try {
      await query(
        `UPDATE hedges
         SET current_price = $1,
             price_source = 'reconciler',
             price_updated_at = CURRENT_TIMESTAMP,
             current_pnl = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND status = 'active'`,
        [livePrice, Math.round(pnl * 1e8) / 1e8, dbHedge.id],
      );
    } catch (err) {
      // Non-fatal — price refresh is a best-effort enrichment
      logger.debug('[HedgeReconciler] Price refresh failed', {
        hedgeId: dbHedge.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.inserted > 0 || result.closed > 0) {
    logger.info('[HedgeReconciler] Reconciled SUI hedges', result);
  }

  return result;
}
