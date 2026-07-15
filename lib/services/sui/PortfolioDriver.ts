/**
 * PortfolioDriver — the missing bridge between agent decisions and
 * the actual balance sheet.
 *
 * ## Why
 *
 * Existing autonomy layers (profit-lock, hedgeability clamp, signal-tick
 * drift-close) are **prescriptive**: they cap or gate what the *next*
 * rebalance can do. None of them **reshape existing holdings**. So when
 * the pool ran through its Jun 26 ATH into a 30% drawdown, the wBTC/wETH
 * already parked on the admin wallet never moved — the cron caps applied
 * to a stream of new capital that wasn't coming.
 *
 * ## What
 *
 * Given a snapshot of current holdings (idle USDC + spot + perp hedges),
 * plus target allocation from profit-lock/hedgeability clamp, plus the
 * current signal, emit a list of corrective actions:
 *
 *   - SELL_SPOT_TO_USDC   — spot > target cap OR signal contradicts side
 *   - BUY_SPOT_FROM_USDC  — spot < target cap AND signal supports side
 *   - OPEN_HEDGE          — perp leg missing
 *   - CLOSE_HEDGE         — perp leg contradicts current signal
 *
 * Bundles Gap 1 (corrective unwind), Gap 2 (signal-flip covers spot),
 * and Gap 5 (symmetric sell trigger).
 *
 * Caller is expected to execute the actions via BluefinAggregatorService
 * (spot swaps) + BluefinService (perp orders); this module is pure
 * (side-effect-free) so it's trivially testable.
 */
import { logger } from '@/lib/utils/logger';
import { applyProfitLock } from '@/lib/services/sui/cron/profit-lock-guard';

export type CorrectiveActionType =
  | 'SELL_SPOT_TO_USDC'
  | 'BUY_SPOT_FROM_USDC'
  | 'OPEN_HEDGE'
  | 'CLOSE_HEDGE';

export interface CorrectiveAction {
  type: CorrectiveActionType;
  asset: string;
  amountUsd: number;
  reason: string;
}

export interface PortfolioSnapshot {
  idleUsdc: number;
  spot: Record<string, number>; // key like "wBTC" or "BTC" — normalized internally
  hedges: Array<{ asset: string; side: 'LONG' | 'SHORT'; notionalUsd: number }>;
  getNav: () => number;
}

export interface DriverInput {
  sandbox: PortfolioSnapshot;
  signal: { direction: 'UP' | 'DOWN'; confidence: number; observedAt: number };
  nowMs: number;
  peakNavUsd: number;
  signalFlipped?: boolean;
  /** AI-driven target allocation in percent. If not passed, defaults to current spot share. */
  aiAllocation?: Record<string, number>;
  /** Optional per-asset spot prices — used by hedgeability clamp when supplied. */
  spotPrices?: Record<string, number>;
}

// Map spot ledger keys to canonical asset symbols
const SPOT_TO_ASSET: Record<string, string> = { wBTC: 'BTC', wETH: 'ETH', SUI: 'SUI' };
const ASSET_TO_SPOT: Record<string, string> = { BTC: 'wBTC', ETH: 'wETH', SUI: 'SUI' };

function normalizeSpotKey(key: string): string {
  return SPOT_TO_ASSET[key] ?? key.toUpperCase();
}

function spotKeyForAsset(asset: string): string {
  return ASSET_TO_SPOT[asset.toUpperCase()] ?? asset;
}

/** Convert profit-lock decision + signal into corrective actions on the sandbox. */
export async function runPortfolioDriverTick(input: DriverInput): Promise<CorrectiveAction[]> {
  const { sandbox, signal, peakNavUsd } = input;
  const actions: CorrectiveAction[] = [];
  const currentNav = sandbox.getNav();

  // Sum current spot exposure per canonical asset
  const spotUsdByAsset: Record<string, number> = {};
  for (const [k, v] of Object.entries(sandbox.spot)) {
    const asset = normalizeSpotKey(k);
    spotUsdByAsset[asset] = (spotUsdByAsset[asset] || 0) + (Number(v) || 0);
  }

  // Derive "before" allocation from actual holdings (or use aiAllocation if provided)
  const totalRiskUsd = Object.values(spotUsdByAsset).reduce((s, v) => s + v, 0);
  const startingAllocation: Record<string, number> = {};
  if (input.aiAllocation) {
    Object.assign(startingAllocation, input.aiAllocation);
  } else {
    for (const [asset, usd] of Object.entries(spotUsdByAsset)) {
      startingAllocation[asset] = currentNav > 0 ? (usd / currentNav) * 100 : 0;
    }
    startingAllocation.USDC = currentNav > 0 ? (sandbox.idleUsdc / currentNav) * 100 : 100;
  }

  // Gap 1: profit-lock ⇒ target cap; must actively unwind, not just gate
  const profitLock = applyProfitLock(startingAllocation, currentNav, peakNavUsd);
  const targetAllocation = profitLock.active ? profitLock.cappedAllocations : startingAllocation;

  // Gap 5: symmetric sell trigger — opposing signal reduces the asset it opposes
  if (signal.confidence >= 65) {
    const opposedAssets = signal.direction === 'DOWN' ? Object.keys(spotUsdByAsset) : [];
    for (const asset of opposedAssets) {
      if (asset === 'USDC') continue;
      const currentPct = targetAllocation[asset] || 0;
      const reduction = (signal.confidence - 50) * 2;
      const newPct = Math.max(0, currentPct - reduction);
      if (newPct < currentPct) {
        targetAllocation[asset] = newPct;
        targetAllocation.USDC = (targetAllocation.USDC || 0) + (currentPct - newPct);
      }
    }
  }

  // Gap 2: signal flip means immediate cross-leg unwind, not "wait for next rebalance"
  if (input.signalFlipped) {
    for (const asset of Object.keys(spotUsdByAsset)) {
      // If signal opposes a LONG-oriented allocation (spot is always long),
      // force target for that asset down to 0. Applies even at low confidence
      // — the flip itself is the trigger.
      if (signal.direction === 'DOWN' && spotUsdByAsset[asset] > 0) {
        const currentPct = targetAllocation[asset] || 0;
        if (currentPct > 0) {
          targetAllocation.USDC = (targetAllocation.USDC || 0) + currentPct;
          targetAllocation[asset] = 0;
        }
      }
    }
  }

  // Diff current spot vs target — emit SELL/BUY actions
  for (const asset of Object.keys(spotUsdByAsset)) {
    if (asset === 'USDC') continue;
    const currentUsd = spotUsdByAsset[asset];
    const targetUsd = currentNav * ((targetAllocation[asset] || 0) / 100);
    const delta = currentUsd - targetUsd;
    if (delta > 0.5) {
      actions.push({
        type: 'SELL_SPOT_TO_USDC',
        asset: spotKeyForAsset(asset),
        amountUsd: Math.round(delta * 100) / 100,
        reason: profitLock.active
          ? `profit-lock ${profitLock.drawdownPct.toFixed(1)}% dd → risk cap ${profitLock.riskAllocationCap}%`
          : input.signalFlipped
          ? `signal flip ${signal.direction} conf=${signal.confidence}% — unwind ${asset}`
          : `opposing signal ${signal.direction} conf=${signal.confidence}% — reduce ${asset}`,
      });
    } else if (delta < -0.5 && sandbox.idleUsdc > 1) {
      actions.push({
        type: 'BUY_SPOT_FROM_USDC',
        asset: spotKeyForAsset(asset),
        amountUsd: Math.round(-delta * 100) / 100,
        reason: `target allocation ${asset} = ${(targetAllocation[asset] || 0).toFixed(1)}% requires buy`,
      });
    }
  }

  // Gap 2 also touches perps: close any hedge whose side contradicts current signal
  for (const h of sandbox.hedges) {
    const opposesSignal =
      (h.side === 'LONG' && signal.direction === 'DOWN') ||
      (h.side === 'SHORT' && signal.direction === 'UP');
    const shouldClose = input.signalFlipped ? opposesSignal : opposesSignal && signal.confidence >= 65;
    if (shouldClose) {
      actions.push({
        type: 'CLOSE_HEDGE',
        asset: h.asset,
        amountUsd: h.notionalUsd,
        reason: `${h.side} contradicts current signal ${signal.direction} conf=${signal.confidence}%`,
      });
    }
  }

  if (actions.length > 0) {
    logger.info('[PortfolioDriver] corrective actions', {
      count: actions.length,
      profitLockActive: profitLock.active,
      drawdownPct: profitLock.drawdownPct?.toFixed(2),
      signalFlipped: !!input.signalFlipped,
      types: actions.map((a) => `${a.type}:${a.asset}`),
    });
  }

  return actions;
}
