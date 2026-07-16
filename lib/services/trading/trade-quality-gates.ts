/**
 * Trade quality gates for the polymarket-edge-trader.
 *
 * Pure functions that filter trade decisions using orthogonal edges
 * (funding rate, exposure concentration, prolonged losing streak).
 * Each is env-tunable and defaults to a conservative setting.
 *
 * Not to be confused with the SafeExecutionGuard — that's the global
 * position-cap/consensus enforcer. These are per-trade profitability
 * filters that compound with the AI signal edge.
 */

export type Side = 'LONG' | 'SHORT';

/**
 * Funding-rate edge — SHORT receives funding when rate is POSITIVE,
 * LONG receives when NEGATIVE. Trading with funding tailwind adds a
 * meaningful, compounding return on top of the AI signal:
 *   funding 0.0001/8h ≈ 0.03% per day ≈ 11% annualised
 *
 * On BlueFin perps, funding is settled every 8h. If we hold a position
 * that RECEIVES funding, we get paid; if we hold one that PAYS funding,
 * we bleed. Over 30+ day holds the difference dominates the AI signal.
 */
export interface FundingEdgeResult {
  advantage: 'RECEIVE' | 'PAY' | 'NEUTRAL';
  bonusPct: number; // 0-15 added to prediction.confidence
  reason: string;
}

export function fundingEdge(
  side: Side,
  fundingRatePer8h: number,
  opts?: { neutralThreshold?: number; maxBonus?: number },
): FundingEdgeResult {
  const neutral = opts?.neutralThreshold ?? 0.00003; // 0.003%/8h
  const maxBonus = opts?.maxBonus ?? 15;

  if (Math.abs(fundingRatePer8h) < neutral) {
    return { advantage: 'NEUTRAL', bonusPct: 0, reason: `funding ${(fundingRatePer8h * 100).toFixed(4)}% within neutral band` };
  }

  const receives = (side === 'SHORT' && fundingRatePer8h > 0) || (side === 'LONG' && fundingRatePer8h < 0);
  const advantage = receives ? 'RECEIVE' : 'PAY';

  // Scale bonus by |funding| — linear interpolation between the neutral
  // threshold and the funding-rate guard's max (BLUEFIN_MAX_FUNDING_RATE
  // default 0.0001 = 0.01%/8h). Above that, funding-rate guard rejects
  // the trade entirely so we never see bigger values here.
  const scale = Math.min(1, (Math.abs(fundingRatePer8h) - neutral) / (0.0001 - neutral));
  const bonusPct = Math.round(receives ? scale * maxBonus : -scale * maxBonus);

  return {
    advantage,
    bonusPct,
    reason: `${side} ${receives ? 'receives' : 'pays'} funding at ${(fundingRatePer8h * 100).toFixed(4)}%/8h`,
  };
}

/**
 * Total notional exposure cap. Prevents the concentration bleed seen
 * on 2026-07-15 where a single $18 hedge (48% of $38 NAV) drove most
 * of the day's losses. Trades that would push total notional above
 * cap are rejected.
 */
export interface ExposureCapResult {
  ok: boolean;
  currentNotionalUsd: number;
  proposedNotionalUsd: number;
  postOpenPct: number;
  capPct: number;
  reason: string;
}

export function exposureCap(args: {
  navUsd: number;
  currentTotalNotionalUsd: number;
  proposedTradeNotionalUsd: number;
  maxPct?: number;
}): ExposureCapResult {
  const envMax = Number(process.env.TRADE_MAX_TOTAL_NOTIONAL_PCT);
  const maxPct = args.maxPct ?? (Number.isFinite(envMax) ? envMax : 30);
  const postTotal = args.currentTotalNotionalUsd + args.proposedTradeNotionalUsd;
  const postPct = args.navUsd > 0 ? (postTotal / args.navUsd) * 100 : 0;
  const ok = postPct <= maxPct;
  return {
    ok,
    currentNotionalUsd: args.currentTotalNotionalUsd,
    proposedNotionalUsd: args.proposedTradeNotionalUsd,
    postOpenPct: postPct,
    capPct: maxPct,
    reason: ok
      ? `post-open exposure ${postPct.toFixed(1)}% ≤ cap ${maxPct}%`
      : `post-open exposure ${postPct.toFixed(1)}% would exceed cap ${maxPct}%`,
  };
}

/**
 * Regret-based full halt — when 30-day regret score is deeply negative
 * (badly losing streak), halt entirely for 24h. Distinct from the
 * conviction-gate adjustment which only raises the threshold; this
 * halts the trader outright.
 *
 * Rationale: on a bad streak, taking any trade at all is negative EV.
 * Even the raised conviction bar could be cleared by noise. Better to
 * step away and let the streak break naturally.
 */
export interface RegretHaltResult {
  halt: boolean;
  regretScore: number;
  threshold: number;
  reason: string;
}

export function regretBasedHalt(args: {
  regretScore: number;
  threshold?: number;
}): RegretHaltResult {
  const envThresh = Number(process.env.TRADER_REGRET_HALT_THRESHOLD);
  const threshold = args.threshold ?? (Number.isFinite(envThresh) ? envThresh : -0.3);
  const halt = args.regretScore < threshold;
  return {
    halt,
    regretScore: args.regretScore,
    threshold,
    reason: halt
      ? `regret ${args.regretScore.toFixed(3)} < halt threshold ${threshold} — 24h cooldown`
      : `regret ${args.regretScore.toFixed(3)} ≥ ${threshold} — trader active`,
  };
}
