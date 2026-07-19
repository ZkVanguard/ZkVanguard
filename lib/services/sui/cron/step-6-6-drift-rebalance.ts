/**
 * Step 6.6: Drift-based pre-rebalance — sell overweight asset(s) to USDC
 * so Step 7 has actual budget to buy underweight assets.
 *
 * Extracted verbatim from app/api/cron/sui-community-pool/route.ts (was
 * lines 577-709 pre-extraction). Behavior unchanged.
 *
 * Why this step exists: after the Step 6.5 shortfall-only fix (598484a7),
 * admin USDC sat near zero because nothing was sold. Step 7's
 * planRebalanceSwaps had no budget and the wallet got stuck at whatever
 * composition existed. Fix: explicitly sell overweight assets so Step 7
 * has budget for the underweight buys. Pure addition — does NOT change
 * aiResult.allocations (which still drives the hedge step and DB snapshots).
 */
import { logger } from '@/lib/utils/logger';
import { notifyDiscord } from '@/lib/utils/discord-notify';
import { POOL_ASSETS, type PoolAsset } from '@/lib/services/sui/cron/allocation';
import type { PoolAsset as BluefinPoolAsset } from '@/lib/services/sui/BluefinAggregatorService';
import { getAdminAssetValuesUsd, sellAssetForUsdc } from '@/lib/services/sui/cron/admin-swaps';
import type { AllocationDecision } from '@/agents/specialized/SuiPoolAgent';

// Tunables. Bound per-tick blast radius: at most MAX_REBALANCE_SELL_USD of
// any one overweight asset gets sold, and only when the drift from the AI
// target exceeds REBALANCE_DRIFT_THRESHOLD_PCT.
const REBALANCE_DRIFT_THRESHOLD_PCT = Number(process.env.REBALANCE_DRIFT_THRESHOLD_PCT) || 10;
const MAX_REBALANCE_SELL_USD = Number(process.env.MAX_REBALANCE_SELL_USD) || 20;

export interface DriftRebalanceResult {
  preHoldings: Record<string, number>;
  targets: Record<string, number>;
  deltas: Record<string, number>;
  sold: Array<{ asset: string; usdcReceived: number; driftPct: number; txDigest?: string; error?: string }>;
  totalSoldUsdc: number;
  executionAllocations?: Record<string, number>;
  skippedReason?: string;
}

export interface Step66Input {
  navUsd: number;
  aboveSafetyCeiling: boolean;
  pricesUSD: Record<string, number>;
  aiResult: AllocationDecision;
  network: 'mainnet' | 'testnet';
}

export interface Step66Result {
  driftRebalance: DriftRebalanceResult;
  executionAllocations: Record<string, number> | undefined;
}

export async function runStep66DriftRebalance(input: Step66Input): Promise<Step66Result> {
  const { navUsd, aboveSafetyCeiling, pricesUSD, aiResult, network } = input;

  let driftRebalance: DriftRebalanceResult;
  let executionAllocations: Record<string, number> | undefined;

  if (!(process.env.SUI_POOL_ADMIN_KEY && !aboveSafetyCeiling && navUsd >= 15)) {
    driftRebalance = {
      preHoldings: { BTC: 0, ETH: 0, SUI: 0 },
      targets: { BTC: 0, ETH: 0, SUI: 0 },
      deltas: { BTC: 0, ETH: 0, SUI: 0 },
      sold: [], totalSoldUsdc: 0,
      skippedReason: !process.env.SUI_POOL_ADMIN_KEY
        ? 'no admin key'
        : aboveSafetyCeiling
          ? 'above NAV safety ceiling'
          : `NAV $${navUsd.toFixed(2)} < $15 minimum`,
    };
    return { driftRebalance, executionAllocations };
  }

  try {
    const preHoldings = await getAdminAssetValuesUsd(network, pricesUSD);
    const targets: Record<string, number> = {};
    const deltas: Record<string, number> = {};
    for (const a of POOL_ASSETS) {
      const targetPct = Number(aiResult.allocations[a as PoolAsset] || 0);
      targets[a] = (navUsd * targetPct) / 100;
      deltas[a] = targets[a] - (preHoldings[a as PoolAsset] || 0);
    }
    logger.info('[SUI Cron] Step 6.6 drift analysis', {
      navUsd: navUsd.toFixed(2),
      preHoldings: Object.entries(preHoldings).map(([k, v]) => `${k}=$${(v as number).toFixed(2)}`).join(' '),
      targets: Object.entries(targets).map(([k, v]) => `${k}=$${v.toFixed(2)}`).join(' '),
      deltas: Object.entries(deltas).map(([k, v]) => `${k}=${v > 0 ? '+' : ''}$${v.toFixed(2)}`).join(' '),
      driftThreshold: REBALANCE_DRIFT_THRESHOLD_PCT,
      maxSellPerTick: MAX_REBALANCE_SELL_USD,
    });

    const sold: DriftRebalanceResult['sold'] = [];
    let totalSoldUsdc = 0;

    // Sell overweight assets, smallest excess first to spread DEX impact
    const overweightAssets = POOL_ASSETS
      .map(a => ({ asset: a as string, excess: -(deltas[a] || 0), driftPct: targets[a] > 0 ? (-(deltas[a] || 0) / targets[a]) * 100 : 0 }))
      .filter(x => x.excess > 0 && x.driftPct >= REBALANCE_DRIFT_THRESHOLD_PCT)
      .sort((a, b) => a.excess - b.excess);

    for (const { asset, excess, driftPct } of overweightAssets) {
      const sellUsd = Math.min(excess, MAX_REBALANCE_SELL_USD);
      logger.info(`[SUI Cron] Step 6.6 SELL ${asset}`, {
        currentUsd: (preHoldings[asset as PoolAsset] || 0).toFixed(2),
        targetUsd: targets[asset].toFixed(2),
        excessUsd: excess.toFixed(2),
        driftPct: driftPct.toFixed(1),
        sellUsd: sellUsd.toFixed(2),
      });
      const result = await sellAssetForUsdc(network, asset as BluefinPoolAsset, sellUsd, pricesUSD);
      sold.push({
        asset,
        usdcReceived: result.swapped,
        driftPct,
        txDigest: result.txDigest,
        error: result.error,
      });
      if (result.swapped > 0) {
        totalSoldUsdc += result.swapped;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Build buy-only execution allocations from positive deltas. Step 7 uses
    // this instead of the raw aiResult.allocations so it doesn't accidentally
    // re-buy overweight assets we just sold.
    const positiveDeltas: Record<string, number> = {};
    let totalPositive = 0;
    for (const a of POOL_ASSETS) {
      const d = deltas[a] || 0;
      if (d > 0) {
        positiveDeltas[a] = d;
        totalPositive += d;
      }
    }
    if (totalPositive > 0) {
      executionAllocations = {};
      let allocated = 0;
      const positiveAssets = Object.keys(positiveDeltas);
      for (let i = 0; i < positiveAssets.length; i++) {
        const a = positiveAssets[i];
        const isLast = i === positiveAssets.length - 1;
        const pct = isLast
          ? Math.max(0, 100 - allocated)
          : Math.round((positiveDeltas[a] / totalPositive) * 100);
        executionAllocations[a] = pct;
        allocated += pct;
      }
      for (const a of POOL_ASSETS) {
        if (!(a in executionAllocations)) executionAllocations[a] = 0;
      }
    }

    driftRebalance = { preHoldings, targets, deltas, sold, totalSoldUsdc, executionAllocations };

    if (totalSoldUsdc > 0 || sold.length > 0) {
      const okSold = sold.filter(s => s.usdcReceived > 0);
      await notifyDiscord(
        `Drift rebalance: sold $${totalSoldUsdc.toFixed(2)} of overweight asset(s) → USDC for Step 7 buys. ${okSold.map(s => `${s.asset} $${s.usdcReceived.toFixed(2)} (drift ${s.driftPct.toFixed(0)}%)`).join(', ') || '(no swap succeeded)'}.`,
        okSold.length > 0 ? 'INFO' : 'WARN',
        { sold, deltas, targets, navUsd: navUsd.toFixed(2), executionAllocations },
      );
    }
  } catch (driftErr) {
    const msg = driftErr instanceof Error ? driftErr.message : String(driftErr);
    logger.warn('[SUI Cron] Step 6.6 drift rebalance failed (non-critical)', { error: msg });
    driftRebalance = {
      preHoldings: { BTC: 0, ETH: 0, SUI: 0 },
      targets: { BTC: 0, ETH: 0, SUI: 0 },
      deltas: { BTC: 0, ETH: 0, SUI: 0 },
      sold: [], totalSoldUsdc: 0,
      skippedReason: `error: ${msg}`,
    };
  }

  return { driftRebalance, executionAllocations };
}
