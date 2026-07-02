/**
 * Position Drift Monitor
 *
 * Closes the last autonomy gap: the AgentTradeGuard prevents NEW misaligned
 * trades, but existing positions can drift misaligned when signals flip
 * after the trade opened. This module runs at the top of each cron tick and:
 *
 *   1. Fetches all active real hedges (collateral ≥ $1 — filters the $0.01
 *      operational transport rows).
 *   2. For each hedge, asks AgentTradeGuard: "would you approve re-opening
 *      the same position right now?" If the guard would REJECT with
 *      stage='agent-directive' (i.e. agent recommends opposite side or HOLD),
 *      the position has drifted → close it.
 *   3. If the guard rejects at 'risk-gate' stage (systemic risk-ceiling
 *      breach), close ALL positions.
 *   4. Records drift-close events to `agent_decisions` for accuracy
 *      tracking. Fires Discord per close.
 *
 * Guards against runaway closing:
 *   - HEDGE_DRIFT_AUTO_CLOSE_DISABLE=1 kills the whole path
 *   - HEDGE_DRIFT_MIN_NOTIONAL_USD (default $10) skips small positions where
 *     the round-trip funding + fee cost > the misalignment risk
 *   - HEDGE_DRIFT_MAX_CLOSES_PER_TICK (default 3) caps blast radius
 *   - Only closes at HIGH confidence — matches the guard's block threshold
 */

import { logger } from '@/lib/utils/logger';
import { notifyDiscord } from '@/lib/utils/discord-notify';

export interface DriftCheckResult {
  checked: number;
  drifted: number;
  closed: number;
  skipped: number;
  errors: number;
  actions: Array<{
    symbol: string;
    side: 'LONG' | 'SHORT';
    notionalUsd: number;
    action: 'CLOSED' | 'SKIPPED_SMALL' | 'SKIPPED_RATE_LIMIT' | 'CLOSE_FAILED' | 'ERROR';
    reason: string;
    orderId?: string;
    realizedPnlUsd?: number;
  }>;
}

/**
 * Minimum surface we need from BluefinService — kept loose so any
 * BluefinService-shaped object satisfies it without needing to import the
 * exact class type from this module.
 */
interface BluefinLike {
  closeHedge(params: { symbol: string; size?: number }): Promise<{
    success: boolean;
    orderId?: string;
    executionPrice?: number;
    fees?: number;
    error?: string;
    /** DUST_LOCKED = position size < minQty at venue level (see BluefinHedgeResult.code) */
    code?: string;
  }>;
  getPositions(): Promise<Array<{ symbol: string; side: 'LONG' | 'SHORT'; size: number }>>;
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Main entry. Called from sui-community-pool cron BEFORE Step 8 (auto-hedge)
 * so drift-closes free up capital for new correct-side hedges in the same
 * tick — the pool self-corrects in one cycle.
 */
export async function checkAndCloseDrifts(
  chain: 'sui' | 'cronos' | 'oasis-sapphire' | 'hedera',
  bluefin: BluefinLike,
): Promise<DriftCheckResult> {
  const result: DriftCheckResult = {
    checked: 0, drifted: 0, closed: 0, skipped: 0, errors: 0, actions: [],
  };

  if ((process.env.HEDGE_DRIFT_AUTO_CLOSE_DISABLE ?? '').trim() === '1') {
    logger.info('[DriftMonitor] disabled via HEDGE_DRIFT_AUTO_CLOSE_DISABLE=1');
    return result;
  }

  const minNotional = envNum('HEDGE_DRIFT_MIN_NOTIONAL_USD', 10);
  const maxClosesPerTick = Math.max(1, Math.floor(envNum('HEDGE_DRIFT_MAX_CLOSES_PER_TICK', 3)));

  let hedges: Array<{
    id?: number; asset?: string; market: string; side: string;
    notional_value?: number | string; size?: number | string;
    order_id?: string; current_pnl?: number | string;
    hedge_id_onchain?: string;
  }>;
  try {
    const { getActiveHedges } = await import('@/lib/db/hedges');
    // -2 = SUI community pool (see lib/constants.ts)
    hedges = (await getActiveHedges(-2, chain)) as typeof hedges;
  } catch (e) {
    logger.warn('[DriftMonitor] getActiveHedges failed — cannot check drift', {
      error: e instanceof Error ? e.message : String(e),
    });
    result.errors++;
    return result;
  }

  const realHedges = hedges.filter((h) => {
    const notional = Number(h.notional_value ?? 0);
    // Filter the $0.01 operational transport entries — they're not directional.
    // Also skip anything with non-PERP market (belt-and-suspenders — DB is
    // already scoped to BlueFin perps for SUI chain).
    return notional >= 1 && /-PERP$/i.test(h.market ?? '');
  });

  result.checked = realHedges.length;
  if (!realHedges.length) return result;

  const { checkBeforeTrade } = await import('@/lib/services/agents/agent-trade-guard');
  const { recordAgentDecision } = await import('@/lib/db/agent-decisions');

  let closesThisTick = 0;

  for (const h of realHedges) {
    const symbol = h.market;
    const asset = (h.asset ?? symbol.replace(/-PERP$/i, '')).toUpperCase();
    const currentSide = (h.side ?? '').toUpperCase() as 'LONG' | 'SHORT';
    const notionalUsd = Number(h.notional_value ?? 0);

    if (currentSide !== 'LONG' && currentSide !== 'SHORT') continue;

    // Small-position skip — round-trip cost dominates the misalignment risk.
    if (notionalUsd < minNotional) {
      result.actions.push({
        symbol, side: currentSide, notionalUsd,
        action: 'SKIPPED_SMALL',
        reason: `Notional $${notionalUsd.toFixed(2)} < min $${minNotional.toFixed(2)}`,
      });
      result.skipped++;
      continue;
    }

    // Ask the guard whether re-opening the CURRENT side would be approved.
    // If it would be blocked at 'agent-directive' or 'risk-gate' stage,
    // that's a drift signal.
    const drift = await checkBeforeTrade({
      chain, asset, intendedSide: currentSide,
      notionalUsd, agentSource: 'drift-monitor',
    });

    if (drift.approved) continue; // aligned — leave it

    // Only close on agent-driven rejection. SafeGuard cooldown/position-cap
    // rejections are transient and shouldn't force position exits.
    if (drift.stage !== 'agent-directive' && drift.stage !== 'risk-gate') continue;

    result.drifted++;

    if (closesThisTick >= maxClosesPerTick) {
      result.actions.push({
        symbol, side: currentSide, notionalUsd,
        action: 'SKIPPED_RATE_LIMIT',
        reason: `Reached max ${maxClosesPerTick} closes/tick — drift noted, will retry next tick`,
      });
      result.skipped++;
      // Record so we know the guard flagged it, even though we didn't close
      await recordAgentDecision({
        chain, agent: 'drift-monitor', asset,
        intendedSide: currentSide, agentApproved: false,
        agentSide: drift.agentSide, agentConfidence: drift.agentConfidence,
        agentReason: `Drift detected but rate-limited: ${drift.reason.slice(0, 150)}`,
        notionalUsd, wasActedOn: false, hedgeOrderId: h.order_id ?? null,
      }).catch(() => {});
      continue;
    }

    // ── Dust guard ────────────────────────────────────────────────
    // Before attempting close, check the actual VENUE size against BlueFin's
    // minQty. Positions below minQty are protocol-trapped — attempting close
    // just produces a "too small" error and Discord noise. Log the classification
    // to agent_decisions with DUST_LOCKED so operators can see it, then skip.
    try {
      const { classifyPosition } = await import('@/lib/services/sui/dust-manager');
      // Query the venue for the current size (DB `size` field can be stale for
      // reconstructed rows). If unavailable, fall back to the DB value.
      let venueSize = Number(h.size ?? 0);
      try {
        const venuePositions = await bluefin.getPositions();
        const venuePos = venuePositions.find((p) => p.symbol === symbol);
        if (venuePos) venueSize = venuePos.size;
      } catch { /* stay with DB value */ }
      const classification = classifyPosition(symbol, venueSize);
      if (classification.exitPath === 'UNCLEARABLE') {
        result.actions.push({
          symbol, side: currentSide, notionalUsd,
          action: 'SKIPPED_SMALL', // repurpose enum — semantically "protocol-locked dust"
          reason: `DUST_LOCKED: ${classification.reason}`,
        });
        await recordAgentDecision({
          chain, agent: 'drift-monitor', asset,
          intendedSide: currentSide, agentApproved: false,
          agentSide: drift.agentSide, agentConfidence: drift.agentConfidence,
          agentReason: `DUST_LOCKED (venue size ${venueSize} < minQty ${classification.minQty}) — ${classification.reason}`,
          notionalUsd, wasActedOn: false, hedgeOrderId: h.order_id ?? null,
        }).catch(() => {});
        result.skipped++;
        continue;
      }
    } catch (dustErr) {
      logger.debug('[DriftMonitor] dust classification threw (non-critical, continuing to close attempt)', {
        error: dustErr instanceof Error ? dustErr.message : String(dustErr),
      });
    }

    // Close the position via BlueFin
    logger.warn(`[DriftMonitor] Closing drifted ${symbol} ${currentSide} $${notionalUsd.toFixed(2)}`, {
      stage: drift.stage, agentSide: drift.agentSide, agentConfidence: drift.agentConfidence,
      reason: drift.reason,
    });

    let closeResult: Awaited<ReturnType<BluefinLike['closeHedge']>>;
    try {
      closeResult = await bluefin.closeHedge({ symbol });
    } catch (closeErr) {
      const errMsg = closeErr instanceof Error ? closeErr.message : String(closeErr);
      result.errors++;
      result.actions.push({
        symbol, side: currentSide, notionalUsd,
        action: 'ERROR', reason: errMsg,
      });
      await recordAgentDecision({
        chain, agent: 'drift-monitor', asset,
        intendedSide: currentSide, agentApproved: false,
        agentSide: drift.agentSide, agentConfidence: drift.agentConfidence,
        agentReason: `Drift-close threw: ${errMsg.slice(0, 150)}`,
        notionalUsd, wasActedOn: false, hedgeOrderId: h.order_id ?? null,
      }).catch(() => {});
      continue;
    }

    if (!closeResult.success) {
      // Distinguish structured DUST_LOCKED from other close failures.
      // DUST_LOCKED means the position is protocol-trapped and no code
      // change can fix it — needs BlueFin support. Log as SKIPPED_SMALL
      // so Discord noise doesn't accumulate every 5min.
      const isDustLocked = closeResult.code === 'DUST_LOCKED';
      result.actions.push({
        symbol, side: currentSide, notionalUsd,
        action: isDustLocked ? 'SKIPPED_SMALL' : 'CLOSE_FAILED',
        reason: closeResult.error ?? 'close returned !success',
      });
      await recordAgentDecision({
        chain, agent: 'drift-monitor', asset,
        intendedSide: currentSide, agentApproved: false,
        agentSide: drift.agentSide, agentConfidence: drift.agentConfidence,
        agentReason: isDustLocked
          ? `DUST_LOCKED: ${(closeResult.error ?? 'unknown').slice(0, 200)}`
          : `Drift-close failed: ${(closeResult.error ?? 'unknown').slice(0, 150)}`,
        notionalUsd, wasActedOn: false, hedgeOrderId: h.order_id ?? null,
      }).catch(() => {});
      if (isDustLocked) result.skipped++;
      continue;
    }

    // Success — mark DB row closed + record the decision + Discord ping
    result.closed++;
    closesThisTick++;
    const realizedPnl = Number((closeResult as { realizedPnl?: number }).realizedPnl ?? h.current_pnl ?? 0);

    try {
      const { closeHedgeByOnchainId } = await import('@/lib/db/hedges');
      // Prefer on-chain hedge id when available; fall back to BlueFin order id.
      const closeKey = h.hedge_id_onchain || h.order_id;
      if (closeKey) {
        await closeHedgeByOnchainId({
          hedgeIdOnchain: closeKey,
          realizedPnl,
          status: 'closed',
          closeTxDigest: closeResult.orderId,
        });
      }
    } catch (dbErr) {
      logger.warn('[DriftMonitor] Close succeeded on-venue but DB update failed', {
        symbol, orderId: h.order_id,
        error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      });
    }

    await recordAgentDecision({
      chain, agent: 'drift-monitor', asset,
      intendedSide: currentSide, agentApproved: false,
      agentSide: drift.agentSide, agentConfidence: drift.agentConfidence,
      agentReason: `DRIFT-CLOSED: ${drift.reason.slice(0, 200)}`,
      notionalUsd, wasActedOn: true, hedgeOrderId: closeResult.orderId ?? h.order_id ?? null,
    }).catch(() => {});

    result.actions.push({
      symbol, side: currentSide, notionalUsd,
      action: 'CLOSED', reason: drift.reason,
      orderId: closeResult.orderId,
      realizedPnlUsd: realizedPnl,
    });

    await notifyDiscord(
      `🔀 DRIFT-CLOSED ${symbol} ${currentSide} $${notionalUsd.toFixed(2)} — agent now says ${drift.agentSide ?? '?'} (conf ${drift.agentConfidence ?? '?'}%). Realized $${realizedPnl.toFixed(2)}.`,
      'WARN',
      { symbol, side: currentSide, notionalUsd, agentSide: drift.agentSide, agentConfidence: drift.agentConfidence, realizedPnl, reason: drift.reason },
    ).catch(() => {});
  }

  if (result.drifted > 0) {
    logger.info(`[DriftMonitor] Cycle summary`, {
      checked: result.checked,
      drifted: result.drifted,
      closed: result.closed,
      skipped: result.skipped,
      errors: result.errors,
    });
  }

  return result;
}
