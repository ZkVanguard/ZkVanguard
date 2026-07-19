/**
 * Step 7: Plan + Execute rebalance via SuiPoolAgent.
 *
 * Extracted verbatim from app/api/cron/sui-community-pool/route.ts
 * (was lines 1117-1466 pre-extraction). The route now dispatches to
 * runStep7Rebalance() with a Step7Input; behavior unchanged.
 *
 * Trigger swaps when:
 *   a) AI detects allocation drift and recommends rebalancing, OR
 *   b) Pool has USDC that hasn't been converted to assets yet.
 *
 * Substep flow:
 *   7:  planRebalanceSwaps via BluefinAggregator + on-chain admin balance check
 *   7b: Ensure admin has enough USDC — transfer from pool via open_hedge
 *       (bounded by max_hedge_ratio, reserve %, and daily cap; retries with
 *       aiDrivenResetDailyHedge when daily cap exhausted + AI urgency high)
 *   7c: Re-plan against actual admin USDC budget if constrained
 *   7d: Log hedged/simulated positions
 */
import { logger } from '@/lib/utils/logger';
import { getBluefinAggregatorService, type PoolAsset as BluefinPoolAsset } from '@/lib/services/sui/BluefinAggregatorService';
import { SUI_USDC_POOL_CONFIG } from '@/lib/services/sui/SuiCommunityPoolService';
import {
  getAdminUsdcBalance,
  transferUsdcFromPoolToAdmin,
  aiDrivenResetDailyHedge,
} from '@/lib/services/sui/cron/hedge-treasury';
import type { AllocationDecision } from '@/agents/specialized/SuiPoolAgent';

/**
 * Shape of the result the cron surfaces for Step 7 — mirrors the
 * SuiCronResult['rebalanceSwaps'] slice defined in the route.
 * Kept as a locally-defined identical shape to avoid coupling this
 * module to a route-file type (anti-pattern to import from routes).
 */
export interface RebalanceSwapsResult {
  planned: number;
  executable: number;
  quotes: Array<{
    asset: string;
    amountInUsdc: string;
    expectedOut: string;
    route: string;
    canSwap: boolean;
  }>;
  simulated?: number;
  swappableAssets?: string[];
  hedgedAssets?: string[];
  executed?: number;
  failed?: number;
  txDigests?: Array<{ asset: string; digest: string }>;
}

export interface Step7Input {
  navUsd: number;
  aboveSafetyCeiling: boolean;
  currentAllocations: Record<string, number>;
  executionAllocations?: Record<string, number>;
  aiResult: AllocationDecision;
  enhancedContext: { urgency?: string };
  network: 'mainnet' | 'testnet';
}

export interface Step7Result {
  rebalanceSwaps: RebalanceSwapsResult | undefined;
}

export async function runStep7Rebalance(input: Step7Input): Promise<Step7Result> {
  const {
    navUsd,
    aboveSafetyCeiling,
    currentAllocations,
    executionAllocations,
    aiResult,
    enhancedContext,
    network,
  } = input;

  // Step 7: Plan + Execute rebalance via SuiPoolAgent
  // Trigger swaps when:
  //  a) AI detects allocation drift and recommends rebalancing, OR
  //  b) Pool has USDC that hasn't been converted to assets yet (first allocation)
  //     If all previous DB-stored allocations are 0, it's the first run and all USDC
  //     needs to be swapped/hedged into assets. Also force rebalance when the pool has
  //     never had successful swaps (no DB swap records).
  let rebalanceSwaps: RebalanceSwapsResult | undefined = undefined;
  const hasUnallocatedUsdc = navUsd > 50 && (
    currentAllocations.BTC === 0 &&
    currentAllocations.ETH === 0 &&
    currentAllocations.SUI === 0
  );
  // Only execute on-chain swaps when pool has enough value to avoid
  // catastrophic slippage on micro-amounts. $15 minimum ensures each
  // asset swap is at least ~$3-5 which gets acceptable DEX pricing.
  const MIN_SWAP_NAV_USD = 15;
  const shouldExecuteSwaps = navUsd >= MIN_SWAP_NAV_USD && !aboveSafetyCeiling;
  if (hasUnallocatedUsdc) {
    logger.info('[SUI Cron] Unallocated USDC detected — triggering initial asset allocation', { navUsd });
  }
  if (navUsd > 0.50 && navUsd < MIN_SWAP_NAV_USD) {
    logger.info('[SUI Cron] Pool NAV $' + navUsd.toFixed(2) + ' below $' + MIN_SWAP_NAV_USD + ' swap minimum — skipping swaps to avoid slippage losses');
  }
  if (aboveSafetyCeiling) {
    logger.warn('[SUI Cron] Step 7 skipped — NAV above safety ceiling', { navUsd: navUsd.toFixed(2) });
  }
  if (shouldExecuteSwaps) {
    try {
      const aggregator = getBluefinAggregatorService(network);

      // Use buy-only execution allocations from Step 6.6 if available,
      // else fall back to the raw AI target. The buy-only set zeros out
      // any overweight asset so Step 7 doesn't re-buy what we just sold.
      const planAllocations = (executionAllocations && Object.values(executionAllocations).some(v => v > 0))
        ? executionAllocations as Record<BluefinPoolAsset, number>
        : aiResult.allocations as Record<BluefinPoolAsset, number>;
      if (executionAllocations && executionAllocations !== aiResult.allocations) {
        logger.info('[SUI Cron] Step 7 using buy-only execution allocations (excludes overweight assets)', {
          aiTarget: aiResult.allocations,
          executionAllocations: planAllocations,
        });
      }

      const plan = await aggregator.planRebalanceSwaps(
        navUsd,
        planAllocations,
      );

      const onChainCount = plan.swaps.filter(s => s.canSwapOnChain).length;
      const simulatedCount = plan.swaps.filter(s => s.isSimulated).length;

      rebalanceSwaps = {
        planned: plan.swaps.length,
        executable: onChainCount,
        quotes: plan.swaps.map(s => ({
          asset: s.asset,
          amountInUsdc: (Number(s.amountIn) / 1e6).toFixed(2),
          expectedOut: s.expectedAmountOut,
          route: s.route,
          canSwap: s.canSwapOnChain,
        })),
      };

      // Attach agent metadata
      rebalanceSwaps.simulated = simulatedCount;
      rebalanceSwaps.swappableAssets = aiResult.swappableAssets;
      rebalanceSwaps.hedgedAssets = aiResult.hedgedAssets;

      logger.info('[SUI Cron] Agent rebalance plan', {
        planned: plan.swaps.length,
        onChain: onChainCount,
        simulated: simulatedCount,
        quotes: plan.swaps.map(q =>
          `${q.asset}: $${(Number(q.amountIn) / 1e6).toFixed(2)} → ${q.expectedAmountOut} (${q.route})${q.isSimulated ? ' [simulated]' : ''}`
        ),
      });

      // Step 7b: Ensure admin wallet has USDC for swaps (transfer from pool if needed)
      const hedgeableCount = plan.swaps.filter(s => !s.canSwapOnChain && s.hedgeVia === 'bluefin').length;
      if (process.env.SUI_POOL_ADMIN_KEY && (onChainCount > 0 || hedgeableCount > 0)) {
        // Calculate total USDC needed for on-chain swaps + hedges
        const totalUsdcNeeded = plan.swaps
          .filter(s => s.canSwapOnChain || s.hedgeVia === 'bluefin')
          .reduce((sum, s) => sum + Number(s.amountIn) / 1e6, 0);

        // Check admin wallet USDC balance
        const adminUsdcBalance = await getAdminUsdcBalance(network);
        logger.info('[SUI Cron] Admin wallet USDC check', {
          available: adminUsdcBalance.toFixed(2),
          needed: totalUsdcNeeded.toFixed(2),
        });

        // If admin wallet doesn't have enough USDC, transfer from pool via open_hedge
        if (adminUsdcBalance < totalUsdcNeeded * 0.95) { // 5% tolerance
          const deficit = totalUsdcNeeded - adminUsdcBalance;

          // Read on-chain state to get exact contract-side balance and hedge values.
          let contractBalance = navUsd; // fallback: use full NAV
          let existingHedgedValue = 0;
          let dailyHedgedToday = 0;
          try {
            const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
            const rpcUrl = network === 'mainnet'
              ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
              : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
            const tmpClient = new SuiClient({ url: rpcUrl });
            const poolConfig = SUI_USDC_POOL_CONFIG[network];
            if (poolConfig.poolStateId) {
              const obj = await tmpClient.getObject({ id: poolConfig.poolStateId, options: { showContent: true } });
              const fields = (obj.data?.content as any)?.fields;
              if (fields) {
                const rawBal = typeof fields.balance === 'string'
                  ? fields.balance
                  : (fields.balance?.fields?.value || '0');
                contractBalance = Number(rawBal) / 1e6;
                existingHedgedValue = Number(fields.hedge_state?.fields?.total_hedged_value || '0') / 1e6;

                // Read daily hedge counter
                const hedgeState = fields.hedge_state?.fields;
                if (hedgeState) {
                  const currentDay = Math.floor(Date.now() / 86400000);
                  const onChainDay = Number(hedgeState.current_hedge_day || 0);
                  if (onChainDay === currentDay) {
                    dailyHedgedToday = Number(hedgeState.daily_hedge_total || 0) / 1e6;
                  }
                }

                logger.info('[SUI Cron] On-chain contract state for limit calc', {
                  contractBalance: contractBalance.toFixed(2),
                  existingHedgedValue: existingHedgedValue.toFixed(2),
                  maxHedgeRatioBps: fields.hedge_state?.fields?.auto_hedge_config?.fields?.max_hedge_ratio_bps,
                  dailyHedgedToday: dailyHedgedToday.toFixed(2),
                });
              }
            }
          } catch (stateErr) {
            logger.warn('[SUI Cron] Failed to read on-chain state for limit calc, using fallback', { error: stateErr });
          }

          // Contract's get_total_nav() returns balance + total_hedged_value (fixed in v5 redeploy).
          const contractNav = contractBalance + existingHedgedValue;
          const maxHedgeTotal = contractNav * 0.5; // max_hedge_ratio_bps=5000
          const maxByHedgeRatio = Math.max(0, maxHedgeTotal - existingHedgedValue);
          const maxByReserve = contractBalance * 0.8;     // 20% reserve must stay in pool

          // Daily cap: 50% of NAV minus what's already been hedged today
          // NOTE: contract resets daily_hedge_total at day boundary when open_hedge is called.
          // If dailyHedgedToday contains prior hedge but we're same calendar day, the contract
          // will reset it atomically. So we check maxByDailyCap but allow the call to fail gracefully.
          const maxByDailyCap = Math.max(0, contractNav * 0.50 - dailyHedgedToday);

          const maxTransferable = Math.min(maxByHedgeRatio, maxByReserve, maxByDailyCap);
          const cappedDeficit = Math.min(deficit, maxTransferable * 0.90); // 10% safety margin

          if (maxByHedgeRatio <= 0) {
            logger.warn('[SUI Cron] Already at max hedge ratio — skipping pool transfer', {
              existingHedgedValue: existingHedgedValue.toFixed(2),
              maxHedgeTotal: maxHedgeTotal.toFixed(2),
            });
            (rebalanceSwaps as any).poolTransfer = {
              requested: '0.00',
              success: false,
              error: 'Max hedge ratio reached',
            };
          } else if (maxTransferable <= 0 || cappedDeficit <= 0.000001) {
            // Daily cap exhausted on-chain. Try an AI-driven reset before
            // giving up: if the prediction-market signal is strong (urgency
            // HIGH/CRITICAL or confidence >= 75) and we still have reset
            // budget left for today, zero the counter and retry.
            const resetOutcome = await aiDrivenResetDailyHedge(network, {
              urgency: enhancedContext?.urgency,
              confidence: aiResult.confidence,
            });

            if (resetOutcome.reset) {
              logger.info('[SUI Cron] Daily cap was exhausted — AI-driven reset successful, retrying transfer', {
                txDigest: resetOutcome.txDigest,
                resetsUsedToday: resetOutcome.resetsUsed,
                urgency: enhancedContext?.urgency,
                confidence: aiResult.confidence,
              });
              // After reset, the full daily cap is available again — retry
              // with the original deficit (bounded by hedge ratio + reserve).
              const newCap = Math.min(maxByHedgeRatio, maxByReserve);
              const retryAmount = Math.min(deficit, newCap * 0.90);
              if (retryAmount > 0.01) {
                const transferResult = await transferUsdcFromPoolToAdmin(network, retryAmount);
                (rebalanceSwaps as any).poolTransfer = {
                  requested: retryAmount.toFixed(2),
                  success: transferResult.success,
                  txDigest: transferResult.txDigest,
                  resetTxDigest: resetOutcome.txDigest,
                  error: transferResult.error,
                };
                if (transferResult.success) {
                  logger.info('[SUI Cron] Pool → admin USDC transfer succeeded after AI-driven reset', {
                    txDigest: transferResult.txDigest, amount: retryAmount.toFixed(2),
                  });
                  await new Promise(r => setTimeout(r, 2000));
                } else {
                  logger.warn('[SUI Cron] Transfer failed after reset', {
                    error: transferResult.error,
                  });
                }
              } else {
                (rebalanceSwaps as any).poolTransfer = {
                  requested: '0.00', success: false,
                  error: 'After reset, no headroom (hedge ratio or reserve exhausted)',
                  resetTxDigest: resetOutcome.txDigest,
                };
              }
            } else {
              // Reset declined — signal too weak or budget exhausted.
              const minutesToMidnight = Math.ceil(((86_400_000 - (Date.now() % 86_400_000)) / 60_000));
              logger.info('[SUI Cron] On-chain daily cap exhausted; AI-driven reset NOT applied — skipping transfer', {
                deficit: deficit.toFixed(2),
                maxByDailyCap: maxByDailyCap.toFixed(2),
                resetReason: resetOutcome.reason,
                resetError: resetOutcome.error,
                urgency: enhancedContext?.urgency,
                confidence: aiResult.confidence,
                minutesToMidnight,
              });
              (rebalanceSwaps as any).poolTransfer = {
                requested: '0.00',
                success: false,
                error: `daily cap exhausted; reset declined (${resetOutcome.reason}); resets in ${minutesToMidnight}m`,
              };
            }
          } else {
          logger.info('[SUI Cron] Admin USDC insufficient — transferring from pool via open_hedge', {
            deficit: deficit.toFixed(2),
            contractNav: contractNav.toFixed(2),
            maxTransferable: maxTransferable.toFixed(2),
            cappedDeficit: cappedDeficit.toFixed(2),
          });


          const transferResult = await transferUsdcFromPoolToAdmin(network, cappedDeficit);
          (rebalanceSwaps as any).poolTransfer = {
            requested: cappedDeficit.toFixed(2),
            success: transferResult.success,
            txDigest: transferResult.txDigest,
            error: transferResult.error,
          };
          if (transferResult.success) {
            logger.info('[SUI Cron] Pool → admin USDC transfer successful', {
              txDigest: transferResult.txDigest,
              amount: cappedDeficit.toFixed(2),
            });
            // Small delay for state propagation
            await new Promise(r => setTimeout(r, 2000));
          } else {
            logger.warn('[SUI Cron] Pool → admin USDC transfer failed', {
              error: transferResult.error,
            });
          }
          } // close else block for maxByHedgeRatio > 0
        }

        // Step 7c: Check actual admin USDC balance before proceeding
        const actualAdminUsdc = await getAdminUsdcBalance(network);

        // BAIL OUT if admin has no meaningful USDC (transfer failed or wasn't needed)
        if (actualAdminUsdc < 0.10) {
          logger.warn('[SUI Cron] Admin USDC too low to execute swaps — skipping', {
            actualAdminUsdc: actualAdminUsdc.toFixed(4),
          });
          (rebalanceSwaps as any).swapBudget = actualAdminUsdc.toFixed(2);
          (rebalanceSwaps as any).executed = 0;
          (rebalanceSwaps as any).failed = 0;
          (rebalanceSwaps as any).swapResults = [];
        } else {
        // Re-plan swaps with actual available admin USDC budget
        let swapPlan = plan;
        if (actualAdminUsdc < totalUsdcNeeded * 0.95 && actualAdminUsdc > 0.10) {
          // Budget is limited — re-plan with available USDC.
          // Use the same buy-only allocations the initial plan used, so the
          // re-plan also skips overweight assets.
          logger.info('[SUI Cron] Re-planning swaps with available budget', {
            available: actualAdminUsdc.toFixed(2),
            originalNeeded: totalUsdcNeeded.toFixed(2),
          });
          try {
            swapPlan = await aggregator.planRebalanceSwaps(
              actualAdminUsdc,
              planAllocations,
            );
          } catch (replanErr) {
            logger.warn('[SUI Cron] Re-plan failed, using original plan', { error: replanErr });
          }
        }

        // Execute on-chain swaps
        try {
          const execResult = await aggregator.executeRebalance(swapPlan, 0.015);

          rebalanceSwaps.executed = execResult.totalExecuted;
          rebalanceSwaps.failed = execResult.totalFailed;
          rebalanceSwaps.txDigests = execResult.results
            .filter((r): r is typeof r & { txDigest: string } => !!r.txDigest)
            .map(r => ({ asset: r.asset, digest: r.txDigest }));
          // Include per-swap error details for diagnostics
          (rebalanceSwaps as any).swapResults = execResult.results.map(r => ({
            asset: r.asset,
            success: r.success,
            amountIn: r.amountIn,
            amountOut: r.amountOut,
            txDigest: r.txDigest,
            error: r.error,
          }));
          (rebalanceSwaps as any).swapBudget = actualAdminUsdc.toFixed(2);

          logger.info('[SUI Cron] On-chain swaps executed', {
            executed: execResult.totalExecuted,
            failed: execResult.totalFailed,
            budget: actualAdminUsdc.toFixed(2),
            digests: execResult.results.filter(r => r.txDigest).map(r => r.txDigest),
            errors: execResult.results.filter(r => !r.success).map(r => `${r.asset}: ${r.error}`),
          });
        } catch (execErr) {
          logger.error('[SUI Cron] On-chain swap execution failed', { error: execErr });
          (rebalanceSwaps as any).executionError = execErr instanceof Error ? execErr.message : String(execErr);
        }
        } // end else (admin has enough USDC)
      } else if (!process.env.SUI_POOL_ADMIN_KEY) {
        logger.info('[SUI Cron] Swap execution skipped — SUI_POOL_ADMIN_KEY not set (quotes only)');
      }

      // Step 7d: Log hedged/simulated positions
      const hedgedPositions = plan.swaps.filter(s => s.isSimulated || !s.canSwapOnChain);
      if (hedgedPositions.length > 0) {
        (rebalanceSwaps as any).hedgedPositions = hedgedPositions.map(s => ({
          asset: s.asset,
          method: s.hedgeVia || 'price-tracked',
          usdcAllocated: (Number(s.amountIn) / 1e6).toFixed(2),
          estimatedQty: s.expectedAmountOut,
          route: s.route,
        }));
        logger.info('[SUI Cron] Hedged positions tracked', {
          count: hedgedPositions.length,
          assets: hedgedPositions.map(s => `${s.asset}: $${(Number(s.amountIn) / 1e6).toFixed(2)} via ${s.hedgeVia || 'virtual'}`),
        });
      }

    } catch (swapErr) {
      logger.warn('[SUI Cron] Rebalance planning failed (non-critical)', { error: swapErr });
    }
  }

  return { rebalanceSwaps };
}
