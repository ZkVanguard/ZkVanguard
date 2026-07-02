/**
 * Dust Manager — detects & manages positions trapped below BlueFin's per-
 * symbol minimum quantity floor.
 *
 * ## The problem
 *
 * BlueFin enforces two floors on every order:
 *   1. `minQuantity` — smallest allowed order size (e.g. 0.01 ETH)
 *   2. `stepSize`    — orders must be exact multiples of this step
 *
 * `snapToStepSize` rounds DOWN. If a position's size sits between 0 and
 * one stepSize (e.g. 0.00794 ETH with step 0.01), any close attempt snaps
 * to 0 and gets rejected. The position becomes **trapped dust**:
 *   - Cannot be closed via reduce-only (order size < step size)
 *   - Cannot be exited by adding + closing (residue is always > 0 because
 *     of the same step-alignment constraint on the new fill size)
 *   - Ties up margin until manually cleared by BlueFin support
 *
 * A small pool ($55 NAV) hits this constantly because target allocation
 * often produces sub-minQty target sizes.
 *
 * ## The systemic fix (what this module provides)
 *
 * 1. **Detection**: `detectDustPositions(bf)` — enumerates trapped positions
 * 2. **Prevention**: `wouldBecomeDust(symbol, targetSize)` — for cron guards
 * 3. **Reporting**: `computeDustReport(bf)` — margin-locked totals + Discord
 *    hooks for operator visibility
 *
 * The drift monitor + close-bluefin-positions route both consult this
 * module BEFORE attempting close, so we don't spam Discord with "failed
 * to close dust" errors every cron tick.
 */

import { logger } from '@/lib/utils/logger';
import { BLUEFIN_PAIRS, type BluefinPosition } from './BluefinService';

/**
 * Multiplier applied to `minQuantity` for open-size guards. Opening at
 * exactly minQty leaves no margin for downside shrinkage (partial fill,
 * funding accrual, PnL-driven size normalization) — one small event can
 * push a fresh position into dust territory. 1.5x gives a buffer.
 */
export const OPEN_MIN_QTY_BUFFER = 1.5;

export interface DustClassification {
  symbol: string;
  isDust: boolean;
  size: number;
  minQty: number;
  stepSize: number;
  /** How many step-multiples this size represents. If < 1, the position
   *  cannot be closed via reduce order. */
  stepMultiples: number;
  /** Best-case exit path, if any. `null` when position is truly stuck. */
  exitPath: null | 'REDUCE_ORDER' | 'ADD_TO_CLEAR' | 'UNCLEARABLE';
  reason: string;
}

export interface DustReport {
  totalPositions: number;
  dustPositions: number;
  totalMarginLockedUsd: number;
  dustMarginLockedUsd: number;
  dustEntries: Array<{
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    minQty: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnl: number;
    marginUsd: number;
    ageEstimate: string;
  }>;
  producedAt: number;
}

/**
 * Classify a single position. The exitPath field tells the caller whether
 * the position is closable (`REDUCE_ORDER`), potentially closable by first
 * growing it (`ADD_TO_CLEAR` — still leaves residue but reduces exposure),
 * or truly stuck (`UNCLEARABLE`).
 */
export function classifyPosition(symbol: string, size: number): DustClassification {
  const pair = BLUEFIN_PAIRS[symbol as keyof typeof BLUEFIN_PAIRS];
  if (!pair) {
    return {
      symbol, isDust: false, size,
      minQty: 0, stepSize: 0, stepMultiples: 0,
      exitPath: 'REDUCE_ORDER',
      reason: 'Unknown symbol — assumed non-dust',
    };
  }
  const stepMultiples = size / pair.stepSize;

  // Case 1: size >= minQty AND aligned to step — normal close works
  if (size >= pair.minQuantity && Math.abs(stepMultiples - Math.round(stepMultiples)) < 1e-6) {
    return {
      symbol, isDust: false, size,
      minQty: pair.minQuantity, stepSize: pair.stepSize,
      stepMultiples,
      exitPath: 'REDUCE_ORDER',
      reason: `Size ${size} is a step-aligned multiple ≥ minQty ${pair.minQuantity}`,
    };
  }

  // Case 2: size >= minQty but not step-aligned — need to close in step multiples
  //   e.g. size 0.01294, step 0.01: close 0.01 leaves 0.00294 dust
  if (size >= pair.minQuantity) {
    return {
      symbol, isDust: true, size,
      minQty: pair.minQuantity, stepSize: pair.stepSize,
      stepMultiples,
      exitPath: 'ADD_TO_CLEAR',
      reason: `Size ${size} not step-aligned (${pair.stepSize}); closing in step multiples leaves ${(size % pair.stepSize).toFixed(6)} residue`,
    };
  }

  // Case 3: size < minQty — CANNOT close, truly trapped
  return {
    symbol, isDust: true, size,
    minQty: pair.minQuantity, stepSize: pair.stepSize,
    stepMultiples,
    exitPath: 'UNCLEARABLE',
    reason: `Size ${size} < minQty ${pair.minQuantity}; no close order is possible at this venue — needs BlueFin support`,
  };
}

/**
 * Returns true if attempting to open a position at `targetSize` risks
 * creating dust. Used by the cron auto-hedge step to skip micro-hedges.
 */
export function wouldBecomeDust(symbol: string, targetSize: number): boolean {
  const pair = BLUEFIN_PAIRS[symbol as keyof typeof BLUEFIN_PAIRS];
  if (!pair) return false;
  return targetSize < pair.minQuantity * OPEN_MIN_QTY_BUFFER;
}

/**
 * Absolute-minimum notional (USD) required to open a hedge on this symbol
 * without immediate dust risk. Callers can compare against
 * `allocation × NAV × hedge_ratio` and skip when below.
 */
export function minSafeOpenNotionalUsd(symbol: string, currentPriceUsd: number): number {
  const pair = BLUEFIN_PAIRS[symbol as keyof typeof BLUEFIN_PAIRS];
  if (!pair || currentPriceUsd <= 0) return 0;
  return pair.minQuantity * OPEN_MIN_QTY_BUFFER * currentPriceUsd;
}

/**
 * Detect all dust positions on the venue. Requires a live BluefinService
 * with a valid session. Never throws — returns empty on error.
 */
export async function detectDustPositions(
  bf: { getPositions(): Promise<BluefinPosition[]> },
): Promise<DustClassification[]> {
  try {
    const positions = await bf.getPositions();
    return positions
      .map((p) => classifyPosition(p.symbol, p.size))
      .filter((c) => c.isDust);
  } catch (e) {
    logger.warn('[DustManager] detectDustPositions failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/**
 * Full dust report — for admin surface + Discord daily summaries. Includes
 * the underlying position metadata (entry, mark, PnL, margin) so the
 * operator can decide whether to escalate to BlueFin support.
 */
export async function computeDustReport(
  bf: { getPositions(): Promise<BluefinPosition[]> },
  now = Date.now(),
): Promise<DustReport> {
  const report: DustReport = {
    totalPositions: 0,
    dustPositions: 0,
    totalMarginLockedUsd: 0,
    dustMarginLockedUsd: 0,
    dustEntries: [],
    producedAt: now,
  };
  try {
    const positions = await bf.getPositions();
    report.totalPositions = positions.length;
    report.totalMarginLockedUsd = positions.reduce((s, p) => s + p.margin, 0);
    for (const p of positions) {
      const c = classifyPosition(p.symbol, p.size);
      if (c.isDust) {
        report.dustPositions++;
        report.dustMarginLockedUsd += p.margin;
        report.dustEntries.push({
          symbol: p.symbol,
          side: p.side,
          size: p.size,
          minQty: c.minQty,
          entryPrice: p.entryPrice,
          markPrice: p.markPrice,
          unrealizedPnl: p.unrealizedPnl,
          marginUsd: p.margin,
          ageEstimate: 'unknown', // BlueFin doesn't expose open-time on positions
        });
      }
    }
  } catch (e) {
    logger.warn('[DustManager] computeDustReport failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return report;
}

/**
 * Human-readable summary — for Discord daily digests + logs.
 */
export function formatDustReport(r: DustReport): string {
  if (r.dustPositions === 0) {
    return `Dust report: 0 trapped positions ✅ (total ${r.totalPositions} positions, $${r.totalMarginLockedUsd.toFixed(2)} margin)`;
  }
  const lines = [
    `Dust report: ${r.dustPositions}/${r.totalPositions} positions TRAPPED below minQty — $${r.dustMarginLockedUsd.toFixed(2)} margin locked.`,
    `These positions cannot be closed via reduce order (size < step-size floor). Options:`,
    `  1. Leave them (default) — PnL still accrues; funding cost typically pennies/day at dust scale.`,
    `  2. Contact BlueFin support to force-close sub-minQty dust.`,
    `  3. Wait for NAV growth to allow an add-then-close cycle (still leaves residue).`,
    `Trapped:`,
    ...r.dustEntries.map((e) =>
      `  · ${e.symbol} ${e.side} ${e.size} (minQty ${e.minQty}) · entry $${e.entryPrice.toFixed(2)} mark $${e.markPrice.toFixed(2)} unrPnL $${e.unrealizedPnl.toFixed(2)} margin $${e.marginUsd.toFixed(2)}`,
    ),
  ];
  return lines.join('\n');
}
