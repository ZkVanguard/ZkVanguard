/**
 * Step 6.5: Settle PREVIOUS cycle's hedges — return USDC from admin back to pool.
 *
 * Extracted verbatim from app/api/cron/sui-community-pool/route.ts (was
 * lines 438-575 pre-extraction). Behavior unchanged — same shortfall-only
 * replenish (fixes the Step 6.5 wallet-churn bug from 598484a7), same
 * Audit-15 residual guard against writing fake realized losses when
 * replenish fails partway.
 *
 * Flow:
 *   1. Read active hedges from on-chain pool state.
 *   2. Compute USDC shortfall vs admin balance; replenish only the delta
 *      (× 1.2 slippage buffer) instead of blanket-converting everything.
 *   3. Audit-15 guard: if replenish left > $1 non-USDC residual AND admin
 *      USDC < 95% of collateral needed → skip settlement (would write
 *      fake losses).
 *   4. settleActiveHedges: close each on-chain hedge, distribute realized
 *      USDC pro-rata to the pool.
 */
import { logger } from '@/lib/utils/logger';
import { notifyDiscord } from '@/lib/utils/discord-notify';
import { getActiveHedges, settleActiveHedges } from '@/lib/services/sui/cron/hedge-lifecycle';
import {
  getAdminUsdcBalance,
  getAdminNonUsdcUsdValue,
  replenishAdminUsdc,
} from '@/lib/services/sui/cron/admin-swaps';

export interface HedgeSettlementResult {
  settled: number;
  failed: number;
  details: unknown[];
  replenishment?: unknown;
  debug?: unknown;
}

export interface Step65Input {
  navUsd: number;
  aboveSafetyCeiling: boolean;
  pricesUSD: Record<string, number>;
  network: 'mainnet' | 'testnet';
}

export interface Step65Result {
  hedgeSettlement: HedgeSettlementResult;
}

export async function runStep65HedgeSettle(input: Step65Input): Promise<Step65Result> {
  const { navUsd, aboveSafetyCeiling, pricesUSD, network } = input;

  let hedgeSettlement: HedgeSettlementResult;

  if (aboveSafetyCeiling) {
    logger.warn('[SUI Cron] Step 6.5 skipped — NAV above safety ceiling', { navUsd: navUsd.toFixed(2) });
    return { hedgeSettlement: { settled: 0, failed: 0, details: [], debug: { skippedReason: 'safety-ceiling' } } };
  }

  if (!(process.env.SUI_POOL_ADMIN_KEY && process.env.SUI_AGENT_CAP_ID)) {
    return {
      hedgeSettlement: {
        settled: 0, failed: 0, details: [],
        debug: { envMissing: { adminKey: !process.env.SUI_POOL_ADMIN_KEY, agentCap: !process.env.SUI_AGENT_CAP_ID } },
      },
    };
  }

  try {
    const activeHedges = await getActiveHedges(network);
    logger.info('[SUI Cron] Step 6.5 getActiveHedges result', { count: activeHedges.length, hedges: activeHedges });
    if (activeHedges.length > 0) {
      const totalCollateralNeeded = activeHedges.reduce((sum, h) => sum + h.collateralUsdc, 0);

      logger.info('[SUI Cron] Settling previous hedges before new allocation', {
        activeHedges: activeHedges.length,
        totalCollateral: totalCollateralNeeded.toFixed(6),
      });

      // Replenish only the actual shortfall, not blanket-convert everything.
      // See commit 598484a7 for the wallet-churn bug this fixes.
      const adminUsdcPreReplenish = await getAdminUsdcBalance(network);
      const usdcShortfall = Math.max(0, totalCollateralNeeded - adminUsdcPreReplenish);
      let replenishment: Awaited<ReturnType<typeof replenishAdminUsdc>> = { swapped: 0, details: [] };
      if (usdcShortfall > 0) {
        const replenishTarget = usdcShortfall * 1.2; // 20% buffer for slippage
        logger.info('[SUI Cron] Step 6.5 replenish needed', {
          adminUsdc: adminUsdcPreReplenish.toFixed(6),
          collateralNeeded: totalCollateralNeeded.toFixed(6),
          shortfall: usdcShortfall.toFixed(6),
          replenishTarget: replenishTarget.toFixed(6),
        });
        replenishment = await replenishAdminUsdc(network, replenishTarget, pricesUSD);
        logger.info('[SUI Cron] Step 6.5 replenishment result', { swapped: replenishment.swapped, details: replenishment.details });
        if (replenishment.swapped > 0) {
          await new Promise(r => setTimeout(r, 2000));
        }
      } else {
        logger.info('[SUI Cron] Step 6.5 replenish skipped — admin has enough USDC', {
          adminUsdc: adminUsdcPreReplenish.toFixed(6),
          collateralNeeded: totalCollateralNeeded.toFixed(6),
          excess: (adminUsdcPreReplenish - totalCollateralNeeded).toFixed(6),
        });
      }

      const adminUsdcForSettlement = await getAdminUsdcBalance(network);
      logger.info('[SUI Cron] Admin USDC for settlement', {
        adminUsdc: adminUsdcForSettlement.toFixed(6),
        totalCollateral: totalCollateralNeeded.toFixed(6),
        pnl: (adminUsdcForSettlement - totalCollateralNeeded).toFixed(6),
      });

      // Audit-15 guard: if replenish failed to fully convert non-USDC
      // holdings and we settle anyway, the close_hedge path books a fake
      // realized loss while the real value sits in unsold wBTC/wETH/SUI.
      // Skip when residual > $1 so next tick can retry replenish cleanly.
      const residualUsd = await getAdminNonUsdcUsdValue(network, pricesUSD);
      const REPLENISH_RESIDUAL_GUARD_USD = Number(process.env.HEDGE_SETTLE_RESIDUAL_GUARD_USD) || 1;
      if (residualUsd > REPLENISH_RESIDUAL_GUARD_USD && adminUsdcForSettlement < totalCollateralNeeded * 0.95) {
        logger.warn('[SUI Cron] Skipping hedge settlement — replenish incomplete; would write fake losses', {
          residualUsd: residualUsd.toFixed(2),
          adminUsdc: adminUsdcForSettlement.toFixed(2),
          totalCollateralNeeded: totalCollateralNeeded.toFixed(2),
          guard: REPLENISH_RESIDUAL_GUARD_USD,
        });
        await notifyDiscord(
          `Hedge settlement SKIPPED: admin still holds $${residualUsd.toFixed(2)} of non-USDC after replenish (USDC $${adminUsdcForSettlement.toFixed(2)} vs needed $${totalCollateralNeeded.toFixed(2)}). Likely aggregator route failure — would write fake losses if settled. Retry next tick.`,
          'WARN',
          { residualUsd: residualUsd.toFixed(2), adminUsdcForSettlement: adminUsdcForSettlement.toFixed(2), totalCollateralNeeded: totalCollateralNeeded.toFixed(2) },
        );
        hedgeSettlement = {
          settled: 0, failed: 0, details: [],
          replenishment,
          debug: { skippedReason: 'replenish-incomplete', residualUsd, adminUsdcForSettlement, totalCollateralNeeded },
        };
      } else if (adminUsdcForSettlement > 0.001) {
        const settlement = await settleActiveHedges(network);
        hedgeSettlement = {
          settled: settlement.settled,
          failed: settlement.failed,
          details: settlement.details,
          replenishment,
        };
        logger.info('[SUI Cron] Previous hedges settled — USDC returned to pool', {
          settled: settlement.settled,
          failed: settlement.failed,
          adminUsdcReturned: adminUsdcForSettlement.toFixed(6),
          pnl: (adminUsdcForSettlement - totalCollateralNeeded).toFixed(6),
        });
        if (settlement.settled > 0) {
          await new Promise(r => setTimeout(r, 2000));
        }
      } else {
        logger.warn('[SUI Cron] No USDC available to settle hedges', {
          adminUsdc: adminUsdcForSettlement.toFixed(6),
        });
        hedgeSettlement = {
          settled: 0, failed: 0, details: [],
          replenishment,
          debug: { adminUsdcForSettlement, totalCollateralNeeded, activeHedgesCount: activeHedges.length },
        };
      }
    } else {
      logger.info('[SUI Cron] No previous hedges to settle');
      hedgeSettlement = { settled: 0, failed: 0, details: [], debug: { activeHedgesFound: 0 } };
    }
  } catch (settleErr) {
    const errMsg = settleErr instanceof Error ? settleErr.message : String(settleErr);
    logger.warn('[SUI Cron] Pre-swap hedge settlement failed (non-critical)', { error: settleErr });
    hedgeSettlement = { settled: 0, failed: 0, details: [], debug: { error: errMsg } };
  }

  return { hedgeSettlement };
}
