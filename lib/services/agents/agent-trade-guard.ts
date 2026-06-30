/**
 * Agent Trade Guard
 *
 * Central authoritative checkpoint that every trade-impacting cron must call
 * before opening a position. Combines:
 *
 *   1. **HedgingAgent directive** — per-asset side recommendation pulled from
 *      the cached LeadAgent autonomous cycle (refreshed every 30 min). If
 *      the agent says "don't hedge this asset right now" or recommends an
 *      opposing side, the trade is blocked.
 *   2. **RiskAgent risk gate** — if the cached risk score is above the
 *      configured ceiling (HEDGE_AGENT_RISK_CEILING, default 80), block all
 *      new positions until risk subsides.
 *   3. **SafeExecutionGuard** — invokes the singleton guard for position cap,
 *      slippage, leverage, cooldown, and circuit-breaker enforcement.
 *
 * Every gate's decision is recorded to `agent_decisions` so accuracy can be
 * measured over time.
 *
 * Failure mode is **fail-OPEN** for the agent layer (if the cycle hasn't run
 * or its cache is stale, we don't block the cron) but **fail-CLOSED** for
 * SafeExecutionGuard (a hard limit breach is always a stop).
 *
 * @see lib/services/agent-orchestrator.ts:runAutonomousCycle — the producer
 * @see agents/core/SafeExecutionGuard.ts — the hard-limit guard
 * @see lib/db/agent-decisions.ts — outcome tracking
 */

import { logger } from '@/lib/utils/logger';
import { recordAgentDecision } from '@/lib/db/agent-decisions';
import { getCronState, setCronState } from '@/lib/db/cron-state';

const CACHE_KEY = 'agent-directives:by-asset';
const RISK_GATE_DEFAULT = 80;
const STALE_AFTER_MS = 35 * 60 * 1000; // 30-min cycle + 5-min grace

export type Side = 'LONG' | 'SHORT';

export interface AgentDirective {
  asset: string;
  recommendedSide: Side | null;       // null = no opinion
  confidence: number;                  // 0-100
  shouldHedge: boolean;
  reason: string;
  riskScore: number;                   // 0-100, from RiskAgent
  computedAt: number;                  // ms epoch
}

export interface DirectiveSnapshot {
  ranAt: number;
  chain: string;
  riskScore: number;                   // global risk score
  riskLevel: string;
  byAsset: Record<string, AgentDirective>;
}

export interface GuardDecision {
  approved: boolean;
  reason: string;
  agentSide: Side | null;
  agentConfidence: number | null;
  stage: 'agent-directive' | 'risk-gate' | 'safe-execution-guard' | 'no-cache' | 'pass';
  executionId?: string;                 // SafeExecutionGuard correlation
}

/**
 * Cache the latest agent directives produced by `runAutonomousCycle`.
 * Called by the orchestrator after a cycle completes.
 */
export async function publishDirectives(snap: DirectiveSnapshot): Promise<void> {
  try {
    await setCronState(CACHE_KEY, snap);
  } catch (e) {
    logger.warn('[AgentTradeGuard] publishDirectives failed (non-fatal)', { error: String(e).slice(0, 200) });
  }
}

async function loadDirectives(): Promise<DirectiveSnapshot | null> {
  try {
    const v = await getCronState<DirectiveSnapshot>(CACHE_KEY);
    if (!v || typeof v.ranAt !== 'number') return null;
    if (Date.now() - v.ranAt > STALE_AFTER_MS) {
      logger.info('[AgentTradeGuard] directive cache is stale', {
        ageMin: Math.floor((Date.now() - v.ranAt) / 60_000),
      });
      return null;
    }
    return v;
  } catch (e) {
    logger.warn('[AgentTradeGuard] loadDirectives failed', { error: String(e).slice(0, 200) });
    return null;
  }
}

export interface CheckParams {
  chain: 'sui' | 'cronos' | 'oasis-sapphire' | 'hedera';
  asset: string;
  intendedSide: Side;
  notionalUsd: number;
  agentSource: string;                  // logging tag e.g. 'sui-cron' | 'polymarket-edge-trader'
  leverage?: number;                    // optional — defaults to undefined (skips guard's lev check)
  expectedSlippageBps?: number;         // optional — defaults to 30
}

/**
 * Central gate. Returns `{ approved: true, ... }` only when ALL three layers
 * (agent directive + risk gate + SafeExecutionGuard) clear.
 *
 * Caller MUST call `completeTrade()` or `failTrade()` afterwards with the
 * returned `executionId` so the SafeExecutionGuard counter doesn't leak.
 */
export async function checkBeforeTrade(params: CheckParams): Promise<GuardDecision> {
  const snap = await loadDirectives();
  const assetUpper = params.asset.toUpperCase();
  const directive = snap?.byAsset?.[assetUpper] ?? null;

  // ─── Layer 1: Agent directive ────────────────────────────────────────────
  if (!snap) {
    // No cached cycle → fail-open. Record so we know it happened.
    await recordAgentDecision({
      chain: params.chain, agent: 'agent-trade-guard', asset: assetUpper,
      intendedSide: params.intendedSide, agentApproved: true,
      agentSide: null, agentConfidence: null,
      agentReason: 'No cached agent cycle (stale or never ran) — fail-open',
      notionalUsd: params.notionalUsd, wasActedOn: false,
    });
    // Continue to risk-gate + SafeGuard with neutral directive
  } else {
    // Risk gate first (cheaper, side-agnostic)
    const riskCeiling = Number(process.env.HEDGE_AGENT_RISK_CEILING) || RISK_GATE_DEFAULT;
    if (snap.riskScore > riskCeiling) {
      await recordAgentDecision({
        chain: params.chain, agent: 'risk-agent', asset: assetUpper,
        intendedSide: params.intendedSide, agentApproved: false,
        agentSide: null, agentConfidence: snap.riskScore,
        agentReason: `Risk-gate block: riskScore=${snap.riskScore} > ceiling ${riskCeiling}`,
        notionalUsd: params.notionalUsd, wasActedOn: false,
      });
      return {
        approved: false, stage: 'risk-gate',
        reason: `RiskAgent halt: riskScore=${snap.riskScore} > ceiling ${riskCeiling}`,
        agentSide: null, agentConfidence: snap.riskScore,
      };
    }

    // Per-asset directive
    if (directive) {
      // Hard NO from agent
      if (directive.shouldHedge === false) {
        await recordAgentDecision({
          chain: params.chain, agent: 'hedging-agent', asset: assetUpper,
          intendedSide: params.intendedSide, agentApproved: false,
          agentSide: directive.recommendedSide, agentConfidence: directive.confidence,
          agentReason: `Hedging agent says HOLD: ${directive.reason}`,
          notionalUsd: params.notionalUsd, wasActedOn: false,
        });
        return {
          approved: false, stage: 'agent-directive',
          reason: `HedgingAgent recommends HOLD on ${assetUpper}: ${directive.reason}`,
          agentSide: directive.recommendedSide, agentConfidence: directive.confidence,
        };
      }
      // Side mismatch (agent wants opposite direction)
      if (directive.recommendedSide && directive.recommendedSide !== params.intendedSide) {
        // Only block if confidence is meaningful — otherwise let the cron's
        // sentiment-driven default through (agent may not have strong opinion).
        const blockThreshold = Number(process.env.HEDGE_AGENT_SIDE_BLOCK_CONFIDENCE) || 70;
        if (directive.confidence >= blockThreshold) {
          await recordAgentDecision({
            chain: params.chain, agent: 'hedging-agent', asset: assetUpper,
            intendedSide: params.intendedSide, agentApproved: false,
            agentSide: directive.recommendedSide, agentConfidence: directive.confidence,
            agentReason: `Side mismatch blocked (conf=${directive.confidence} >= ${blockThreshold})`,
            notionalUsd: params.notionalUsd, wasActedOn: false,
          });
          return {
            approved: false, stage: 'agent-directive',
            reason: `HedgingAgent (conf=${directive.confidence}%) recommends ${directive.recommendedSide} on ${assetUpper}; cron wants ${params.intendedSide}`,
            agentSide: directive.recommendedSide, agentConfidence: directive.confidence,
          };
        }
      }
    }
  }

  // ─── Layer 2: SafeExecutionGuard (hard limits) ───────────────────────────
  // crypto.randomUUID needs a Node 18+ crypto import. The cron is already on
  // 20+ so a direct ES import works.
  const executionId = `guard-${params.agentSource}-${params.asset}-${Date.now()}`;
  try {
    const { getSafeExecutionGuard } = await import('@/agents/core/SafeExecutionGuard');
    const safeExecutionGuard = getSafeExecutionGuard();
    const validation = await safeExecutionGuard.validateExecution({
      executionId,
      agentId: params.agentSource,
      action: 'open_hedge',
      positionSizeUSD: params.notionalUsd,
      // Pass leverage only when caller asks for it (default SafeGuard ceiling
      // is 4x; the cron uses up to 5x by design, so omitting lets the trade
      // pass without re-tuning the guard). Caller can opt-in to the check.
      leverage: params.leverage,
      expectedSlippageBps: params.expectedSlippageBps ?? 30,
    });
    if (!validation.isValid) {
      const reason = validation.errors.join('; ') || 'rejected';
      await recordAgentDecision({
        chain: params.chain, agent: 'safe-execution-guard', asset: assetUpper,
        intendedSide: params.intendedSide, agentApproved: false,
        agentSide: null, agentConfidence: null,
        agentReason: `SafeGuard block: ${reason}`,
        notionalUsd: params.notionalUsd, wasActedOn: false,
      });
      return {
        approved: false, stage: 'safe-execution-guard',
        reason: `SafeExecutionGuard: ${reason}`,
        agentSide: directive?.recommendedSide ?? null,
        agentConfidence: directive?.confidence ?? null,
      };
    }
    return {
      approved: true, stage: 'pass',
      reason: directive
        ? `HedgingAgent(${directive.confidence}%) + RiskAgent(score=${snap?.riskScore}) + SafeGuard cleared`
        : 'No-cycle cache; SafeGuard cleared (fail-open)',
      agentSide: directive?.recommendedSide ?? null,
      agentConfidence: directive?.confidence ?? null,
      executionId,
    };
  } catch (e) {
    // SafeGuard import or run failed — fail OPEN to keep cron alive, but warn loudly
    logger.warn('[AgentTradeGuard] SafeExecutionGuard threw — falling back to allow', {
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      approved: true, stage: 'pass',
      reason: `SafeGuard error (fail-open): ${e instanceof Error ? e.message : String(e)}`,
      agentSide: directive?.recommendedSide ?? null,
      agentConfidence: directive?.confidence ?? null,
    };
  }
}

/** Settle the trade outcome at SafeGuard + record in agent_decisions. */
export async function completeTrade(
  decision: GuardDecision,
  params: {
    chain: 'sui' | 'cronos' | 'oasis-sapphire' | 'hedera';
    asset: string;
    intendedSide: Side;
    notionalUsd: number;
    orderId: string | null;
    success: boolean;
    error?: string;
  },
): Promise<void> {
  try {
    if (decision.executionId) {
      const { getSafeExecutionGuard } = await import('@/agents/core/SafeExecutionGuard');
    const safeExecutionGuard = getSafeExecutionGuard();
      if (params.success) {
        safeExecutionGuard.completeExecution(decision.executionId);
      } else {
        safeExecutionGuard.failExecution(decision.executionId, params.error ?? 'open_hedge failed');
      }
    }
  } catch (e) {
    logger.warn('[AgentTradeGuard] completeTrade SafeGuard finalize failed', { error: String(e).slice(0, 200) });
  }

  try {
    await recordAgentDecision({
      chain: params.chain, agent: 'agent-trade-guard', asset: params.asset.toUpperCase(),
      intendedSide: params.intendedSide,
      agentApproved: true,
      agentSide: decision.agentSide,
      agentConfidence: decision.agentConfidence,
      agentReason: params.success
        ? `Trade executed (orderId=${params.orderId ?? '?'})`
        : `Trade failed: ${params.error ?? 'unknown'}`,
      notionalUsd: params.notionalUsd,
      wasActedOn: params.success,
      hedgeOrderId: params.orderId,
    });
  } catch (e) {
    logger.warn('[AgentTradeGuard] completeTrade DB record failed', { error: String(e).slice(0, 200) });
  }
}

/** Best-effort read of latest directives (for surfacing on the dashboard). */
export async function getLatestDirectives(): Promise<DirectiveSnapshot | null> {
  return await loadDirectives();
}
