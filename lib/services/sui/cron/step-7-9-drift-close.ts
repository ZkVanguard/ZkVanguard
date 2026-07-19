/**
 * Step 7.9: Position-Drift Auto-Close (AG10) — self-correct misalignment.
 *
 * Extracted from app/api/cron/sui-community-pool/route.ts on 2026-07-19
 * for symmetry with Step 4/6.5/6.6/7/8/9 modules. The actual drift-check
 * logic lives in `checkAndCloseDrifts` (position-drift-monitor.ts) —
 * this wrapper handles the BluefinService fetch + non-critical error
 * containment so Step 8 continues even if the drift check throws.
 *
 * For each active real hedge (collateral ≥ $1), ask AgentTradeGuard
 * whether re-opening the SAME side would now be approved. If not
 * (agent-directive stage: agent recommends opposite side or HOLD, or
 * risk-gate stage: systemic risk-ceiling breach), close the position.
 *
 * Runs BEFORE Step 8 so freed capital can immediately re-hedge on the
 * correct side in the same tick — pool self-corrects in one cycle.
 *
 * Kill switch: HEDGE_DRIFT_AUTO_CLOSE_DISABLE=1
 */
import { logger } from '@/lib/utils/logger';
import { BluefinService } from '@/lib/services/sui/BluefinService';
import { checkAndCloseDrifts } from '@/lib/services/agents/position-drift-monitor';

export interface Step79Result {
  checked: number;
  drifted: number;
  closed: number;
  skipped: number;
  errors: number;
  actions: unknown[];
}

export async function runStep7_9DriftClose(): Promise<Step79Result | null> {
  try {
    const bluefinService = BluefinService.getInstance();
    const driftResult = await checkAndCloseDrifts('sui', bluefinService);
    if (driftResult.drifted > 0) {
      logger.info('[SUI Cron] Drift monitor summary', driftResult);
    }
    return driftResult;
  } catch (driftErr) {
    logger.warn('[SUI Cron] Drift monitor threw (non-critical — Step 8 continues)', {
      error: driftErr instanceof Error ? driftErr.message : String(driftErr),
    });
    return null;
  }
}
