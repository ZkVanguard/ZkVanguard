/**
 * Profit-Lock Guard — protects gains by capping risk exposure during
 * drawdowns from ATH.
 *
 * ## Problem
 *
 * The two-legged strategy (spot LONG + perp SHORT hedge) is designed to
 * be delta-neutral at 100% hedge ratio. But at small NAV, BlueFin's
 * per-symbol minQty prevents perp hedges on assets whose target notional
 * falls below the minimum:
 *
 *   BTC-PERP minQty 0.001 → $60 notional min (at $60k spot)
 *   ETH-PERP minQty 0.01  → $16 notional min (at $1600 spot)
 *   SUI-PERP minQty 1     → $0.72 notional min
 *
 * At $54 NAV, only SUI can be reliably hedged. The rest is naked spot
 * exposure — when markets pull back, the pool bleeds spot losses while
 * the small hedges can't offset them.
 *
 * ## Fix
 *
 * When NAV drops below rolling peak by more than `PROFIT_LOCK_DRAWDOWN_PCT`,
 * cap the risk allocation. The higher the drawdown, the more we shift
 * into USDC (which doesn't move). This DOES sacrifice upside during a
 * recovery — the cost of insurance is missing part of the bounce — but
 * prevents the profit from bleeding away in a slow chop.
 *
 * ## Behavior
 *
 * | Drawdown from ATH | Max risk allocation |
 * |-------------------|---------------------|
 * | < 5%              | 100% (no clamp)     |
 * | 5-10%             | 80%                 |
 * | 10-15%            | 60%                 |
 * | 15-20%            | 40%                 |
 * | ≥ 20%             | 0% (all USDC)       |
 *
 * The tiers scale inversely with drawdown. Env override:
 *   PROFIT_LOCK_DISABLE=1              — turn off entirely
 *   PROFIT_LOCK_DRAWDOWN_START=5       — start clamping at this drawdown %
 *   PROFIT_LOCK_ZERO_RISK_AT=20        — go 100% USDC at this drawdown %
 *
 * ## Interaction with existing hedgeability clamp
 *
 * The existing "hedgeability clamp" (sui-community-pool line 1422) drops
 * assets that can't be hedged at current NAV. This guard runs BEFORE
 * that — it caps total risk allocation first, then the hedgeability clamp
 * redistributes what's left. If profit-lock reduces risk to 40% and
 * hedgeability then drops BTC, the remaining risk goes to ETH/SUI.
 */

import { logger } from '@/lib/utils/logger';
import { envFlag } from '@/lib/utils/env-flag';

export interface ProfitLockDecision {
  active: boolean;
  drawdownPct: number;
  peakNav: number;
  currentNav: number;
  originalAllocations: Record<string, number>;
  cappedAllocations: Record<string, number>;
  riskAllocationCap: number;
  reason: string;
}

const DEFAULT_TIERS = [
  { drawdownPct: 5, maxRiskPct: 80 },
  { drawdownPct: 10, maxRiskPct: 60 },
  { drawdownPct: 15, maxRiskPct: 40 },
  { drawdownPct: 20, maxRiskPct: 0 },
];

function computeRiskCap(drawdownPct: number): number {
  const startAt = Number(process.env.PROFIT_LOCK_DRAWDOWN_START) || 5;
  const zeroAt = Number(process.env.PROFIT_LOCK_ZERO_RISK_AT) || 20;

  if (drawdownPct < startAt) return 100;
  if (drawdownPct >= zeroAt) return 0;

  // Find the tier we're in
  const tiers = DEFAULT_TIERS.map((t) => ({ ...t, drawdownPct: t.drawdownPct * (startAt / 5) }));
  for (const tier of tiers) {
    if (drawdownPct < tier.drawdownPct) {
      // Linear-interpolate between this tier and the previous one
      const prev = tiers[tiers.indexOf(tier) - 1];
      const prevDD = prev?.drawdownPct ?? startAt;
      const prevCap = prev?.maxRiskPct ?? 100;
      const ratio = (drawdownPct - prevDD) / (tier.drawdownPct - prevDD);
      return Math.max(0, Math.round(prevCap + (tier.maxRiskPct - prevCap) * ratio));
    }
  }
  return 0;
}

export function applyProfitLock(
  allocations: Record<string, number>,
  currentNav: number,
  peakNav: number,
  navHistory?: { drawdownPct7dAgo?: number },
): ProfitLockDecision {
  const orig = { ...allocations };

  if (envFlag('PROFIT_LOCK_DISABLE')) {
    return {
      active: false, drawdownPct: 0, peakNav, currentNav,
      originalAllocations: orig, cappedAllocations: orig,
      riskAllocationCap: 100, reason: 'PROFIT_LOCK_DISABLE=1',
    };
  }
  if (peakNav <= 0 || currentNav <= 0) {
    return {
      active: false, drawdownPct: 0, peakNav, currentNav,
      originalAllocations: orig, cappedAllocations: orig,
      riskAllocationCap: 100, reason: 'peakNav or currentNav <= 0',
    };
  }

  const drawdownPct = Math.max(0, ((peakNav - currentNav) / peakNav) * 100);
  const baseRiskCap = computeRiskCap(drawdownPct);

  // Recovery re-engagement (2026-07-15): if drawdown IMPROVED vs 7 days
  // ago by >= 5 ppts, add a momentum bonus to the risk cap so we don't
  // sit in USDC through the whole recovery. Prevents "held all-cash
  // through the rally" pattern. Bonus scales linearly from 0 → 30 ppts
  // over a 5-15 ppt improvement window.
  let recoveryBonus = 0;
  let recoveryReason = '';
  if ((process.env.RECOVERY_REENGAGE_DISABLE ?? '') !== '1' && navHistory?.drawdownPct7dAgo !== undefined) {
    const improvement = navHistory.drawdownPct7dAgo - drawdownPct;
    const minImp = Number(process.env.RECOVERY_REENGAGE_MIN_IMPROVEMENT_PCT) || 5;
    const maxImp = Number(process.env.RECOVERY_REENGAGE_MAX_IMPROVEMENT_PCT) || 15;
    const maxBonus = Number(process.env.RECOVERY_REENGAGE_MAX_BONUS_PCT) || 30;
    if (improvement >= minImp) {
      const clampedImp = Math.min(improvement, maxImp);
      recoveryBonus = Math.round((clampedImp - minImp) / (maxImp - minImp) * maxBonus);
      recoveryReason = ` + recovery bonus ${recoveryBonus}% (drawdown ${navHistory.drawdownPct7dAgo.toFixed(1)}% → ${drawdownPct.toFixed(1)}%)`;
    }
  }
  const riskCap = Math.min(100, baseRiskCap + recoveryBonus);

  if (riskCap >= 100) {
    return {
      active: false, drawdownPct, peakNav, currentNav,
      originalAllocations: orig, cappedAllocations: orig,
      riskAllocationCap: 100,
      reason: `drawdown ${drawdownPct.toFixed(2)}% below start threshold`,
    };
  }

  // Sum risk allocations (everything except USDC)
  const riskAssets = Object.keys(allocations).filter((k) => k.toUpperCase() !== 'USDC');
  const totalRisk = riskAssets.reduce((s, k) => s + (allocations[k] || 0), 0);

  if (totalRisk === 0) {
    return {
      active: false, drawdownPct, peakNav, currentNav,
      originalAllocations: orig, cappedAllocations: orig,
      riskAllocationCap: riskCap, reason: 'no risk allocations to cap',
    };
  }

  // Scale down all risk assets proportionally to hit the cap
  const scale = riskCap / totalRisk;
  const capped: Record<string, number> = {};
  let cappedRisk = 0;
  for (const asset of Object.keys(allocations)) {
    if (asset.toUpperCase() === 'USDC') continue;
    capped[asset] = Math.round((allocations[asset] || 0) * scale);
    cappedRisk += capped[asset];
  }
  // Assign remainder to USDC
  const usdcAlloc = Math.max(0, 100 - cappedRisk);
  capped['USDC'] = usdcAlloc;

  logger.info('[ProfitLockGuard] active', {
    drawdownPct: drawdownPct.toFixed(2),
    peakNav: peakNav.toFixed(2),
    currentNav: currentNav.toFixed(2),
    riskCap,
    original: orig,
    capped,
  });

  return {
    active: true, drawdownPct, peakNav, currentNav,
    originalAllocations: orig, cappedAllocations: capped,
    riskAllocationCap: riskCap,
    reason: `drawdown ${drawdownPct.toFixed(2)}% ≥ threshold — risk capped at ${riskCap}%${recoveryReason}, ${usdcAlloc}% held in USDC`,
  };
}
