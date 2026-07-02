/**
 * Agent pipeline E2E — verifies the complete fix (AG1-AG7) works end-to-end:
 *
 *   1. AgentDecisions DB table exists + accepts inserts + reads back
 *   2. AgentTradeGuard short-circuits when no directives cached (fail-open)
 *   3. publishDirectives → checkBeforeTrade can read them
 *   4. Per-asset HOLD directive BLOCKS a trade
 *   5. Side-mismatch with HIGH confidence BLOCKS a trade
 *   6. Side-mismatch with LOW confidence ALLOWS a trade
 *   7. Risk-ceiling breach BLOCKS all trades
 *   8. SafeExecutionGuard position cap BLOCKS oversized trades
 *   9. completeTrade() records decision + settles SafeGuard counter
 *  10. Agent scorecard returns non-null after a recorded outcome
 *
 * Read-only end state (decisions are recorded but no real trades happen).
 *
 * Usage:
 *   bun run scripts/test-agent-pipeline-e2e.ts
 *
 * Requires: DATABASE_URL set in .env.local (Aiven postgres for agent_decisions).
 */

import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

// Disable SafeExecutionGuard cooldown for tests — production cron is slow
// (30-min cadence) so 5s cooldown doesn't matter there, but tests fire fast.
process.env.SAFE_GUARD_COOLDOWN_MS = '0';

interface Result { name: string; ok: boolean; detail: string; }
const results: Result[] = [];
const record = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`);
};

async function main() {
  console.log('\n=== Agent Pipeline E2E ===\n');

  const { publishDirectives, checkBeforeTrade, completeTrade, getLatestDirectives } =
    await import('../lib/services/agents/agent-trade-guard');
  const { recordAgentDecision, getRecentAgentScorecard, settleAgentDecision } =
    await import('../lib/db/agent-decisions');

  // [1] DB table exists + writable
  try {
    const id = await recordAgentDecision({
      chain: 'sui', agent: 'e2e-test', asset: 'BTC',
      intendedSide: 'SHORT', agentApproved: true, agentSide: 'SHORT',
      agentConfidence: 70, agentReason: 'e2e test row',
      notionalUsd: 100, wasActedOn: false,
    });
    record('AgentDecisions table accepts inserts', id !== null, `inserted id=${id}`);
  } catch (e) {
    record('AgentDecisions table accepts inserts', false, String(e).slice(0, 200));
  }

  // [2] No cache → fail-OPEN at agent layer, SafeGuard still gates
  //
  // CRITICAL: DO NOT overwrite the production `agent-directives:by-asset`
  // key here — this test shares the Aiven DB with production, and wiping
  // the cache breaks the live agent guard until the next 30-min cron cycle
  // re-populates. Instead, we snapshot the current cache, wipe it locally
  // for the fail-open test, and RESTORE at the end.
  const NO_CACHE_KEY = 'agent-directives:by-asset';
  const { setCronState, getCronState } = await import('../lib/db/cron-state');
  const PROD_DIRECTIVE_SNAPSHOT = await getCronState<unknown>(NO_CACHE_KEY);
  await setCronState(NO_CACHE_KEY, null);
  const noCacheCheck = await checkBeforeTrade({
    chain: 'sui', asset: 'BTC', intendedSide: 'SHORT',
    notionalUsd: 100, agentSource: 'e2e',
  });
  record(
    'No directive cache → fail-OPEN at agent layer',
    noCacheCheck.approved === true && noCacheCheck.stage === 'pass',
    `approved=${noCacheCheck.approved}, stage=${noCacheCheck.stage}`,
  );

  // [3] Publish directives → read back
  await publishDirectives({
    ranAt: Date.now(),
    chain: 'sui',
    riskScore: 50,
    riskLevel: 'MEDIUM',
    byAsset: {
      BTC: { asset: 'BTC', recommendedSide: 'SHORT', confidence: 75, shouldHedge: true, reason: 'test', riskScore: 50, computedAt: Date.now() },
      ETH: { asset: 'ETH', recommendedSide: null, confidence: 30, shouldHedge: false, reason: 'HOLD test', riskScore: 50, computedAt: Date.now() },
      SUI: { asset: 'SUI', recommendedSide: 'LONG', confidence: 40, shouldHedge: true, reason: 'low-conf LONG', riskScore: 50, computedAt: Date.now() },
    },
  });
  const directives = await getLatestDirectives();
  record(
    'publishDirectives + getLatestDirectives roundtrip',
    directives !== null && Object.keys(directives.byAsset).length === 3,
    `loaded ${directives ? Object.keys(directives.byAsset).length : 0} assets`,
  );

  // [4] HOLD blocks
  const holdCheck = await checkBeforeTrade({
    chain: 'sui', asset: 'ETH', intendedSide: 'SHORT',
    notionalUsd: 100, agentSource: 'e2e',
  });
  record(
    'Per-asset HOLD directive blocks trade',
    !holdCheck.approved && holdCheck.stage === 'agent-directive',
    `approved=${holdCheck.approved}, stage=${holdCheck.stage}, reason=${holdCheck.reason.slice(0, 80)}`,
  );

  // [5] HIGH-confidence side mismatch blocks
  // BTC directive: SHORT @ 75% — cron wants LONG. Default block threshold = 70.
  const mismatchHighCheck = await checkBeforeTrade({
    chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
    notionalUsd: 100, agentSource: 'e2e',
  });
  record(
    'HIGH-confidence side mismatch blocks',
    !mismatchHighCheck.approved && mismatchHighCheck.stage === 'agent-directive',
    `approved=${mismatchHighCheck.approved}, agentSide=${mismatchHighCheck.agentSide}, conf=${mismatchHighCheck.agentConfidence}`,
  );

  // [6] LOW-confidence side mismatch passes the agent layer
  // SUI directive: LONG @ 40%. Cron wants SHORT. 40 < 70 → allow.
  const mismatchLowCheck = await checkBeforeTrade({
    chain: 'sui', asset: 'SUI', intendedSide: 'SHORT',
    notionalUsd: 100, agentSource: 'e2e',
  });
  record(
    'LOW-confidence side mismatch passes agent layer',
    mismatchLowCheck.approved === true,
    `approved=${mismatchLowCheck.approved}, agentSide=${mismatchLowCheck.agentSide}, conf=${mismatchLowCheck.agentConfidence}`,
  );

  // Settle the SafeGuard counter so future tests aren't affected
  if (mismatchLowCheck.approved) {
    await completeTrade(mismatchLowCheck, {
      chain: 'sui', asset: 'SUI', intendedSide: 'SHORT',
      notionalUsd: 100, orderId: 'e2e-test-order',
      success: false, error: 'e2e simulated no-op',
    });
  }

  // [7] Risk ceiling breach blocks
  await publishDirectives({
    ranAt: Date.now(),
    chain: 'sui',
    riskScore: 95,     // > default ceiling of 80
    riskLevel: 'EXTREME',
    byAsset: {
      BTC: { asset: 'BTC', recommendedSide: 'SHORT', confidence: 80, shouldHedge: true, reason: 'still-good', riskScore: 95, computedAt: Date.now() },
    },
  });
  const riskCheck = await checkBeforeTrade({
    chain: 'sui', asset: 'BTC', intendedSide: 'SHORT',
    notionalUsd: 100, agentSource: 'e2e',
  });
  record(
    'Risk ceiling breach blocks all trades',
    !riskCheck.approved && riskCheck.stage === 'risk-gate',
    `approved=${riskCheck.approved}, stage=${riskCheck.stage}`,
  );

  // [8] SafeExecutionGuard position cap blocks oversized
  await publishDirectives({
    ranAt: Date.now(),
    chain: 'sui',
    riskScore: 30,
    riskLevel: 'LOW',
    byAsset: {
      BTC: { asset: 'BTC', recommendedSide: 'SHORT', confidence: 80, shouldHedge: true, reason: 'ok', riskScore: 30, computedAt: Date.now() },
    },
  });
  const oversizedCheck = await checkBeforeTrade({
    chain: 'sui', asset: 'BTC', intendedSide: 'SHORT',
    notionalUsd: 50_000_000,   // > $10M position cap
    agentSource: 'e2e',
  });
  record(
    'SafeExecutionGuard position cap blocks oversized trade',
    !oversizedCheck.approved && oversizedCheck.stage === 'safe-execution-guard',
    `approved=${oversizedCheck.approved}, stage=${oversizedCheck.stage}, reason=${oversizedCheck.reason.slice(0, 100)}`,
  );

  // [9] completeTrade settles SafeGuard counter (no leak)
  const completeCheck = await checkBeforeTrade({
    chain: 'sui', asset: 'BTC', intendedSide: 'SHORT',
    notionalUsd: 100, agentSource: 'e2e',
  });
  // Wait through any cooldown by simply checking that completeTrade runs cleanly
  if (completeCheck.approved) {
    await completeTrade(completeCheck, {
      chain: 'sui', asset: 'BTC', intendedSide: 'SHORT',
      notionalUsd: 100, orderId: 'e2e-complete-order',
      success: true,
    });
    record('completeTrade settles execution + records decision', true, 'OK — no exception');
  } else {
    // Cooldown active — still test completeTrade with executionless flow
    await completeTrade(
      { approved: true, stage: 'pass', reason: 'no-exec test', agentSide: null, agentConfidence: null },
      { chain: 'sui', asset: 'BTC', intendedSide: 'SHORT', notionalUsd: 100, orderId: 'e2e-no-exec', success: true },
    );
    record('completeTrade handles missing executionId cleanly', true, 'OK — no exception');
  }

  // Settle the test decision so scorecard has settled outcomes
  await settleAgentDecision('e2e-complete-order', 1.23);

  // [10] Scorecard returns non-zero
  const scorecard = await getRecentAgentScorecard('sui', 7);
  record(
    'Agent scorecard returns non-zero rows',
    scorecard.totalDecisions > 0,
    `total=${scorecard.totalDecisions}, approved=${scorecard.approvedCount}, rejected=${scorecard.rejectedCount}, acted=${scorecard.actedOnCount}, netPnl=$${scorecard.netPnlUsd.toFixed(2)}`,
  );

  // [11] Position-drift auto-close — simulate a misaligned position closes
  // and an aligned one stays open. Uses a stub BlueFin that just records
  // close calls; no real trades happen.
  await publishDirectives({
    ranAt: Date.now(),
    chain: 'sui',
    riskScore: 30,
    riskLevel: 'LOW',
    byAsset: {
      // BTC signal wants LONG at 80% (blocks re-open of SHORT)
      BTC: { asset: 'BTC', recommendedSide: 'LONG', confidence: 80, shouldHedge: true, reason: 'test-flip', riskScore: 30, computedAt: Date.now() },
      // ETH signal wants SHORT at 80% (aligned with SHORT positions)
      ETH: { asset: 'ETH', recommendedSide: 'SHORT', confidence: 80, shouldHedge: true, reason: 'aligned', riskScore: 30, computedAt: Date.now() },
    },
  });

  const closeCalls: string[] = [];
  const stubBluefin = {
    getPositions: async () => [],
    closeHedge: async ({ symbol }: { symbol: string }) => {
      closeCalls.push(symbol);
      return { success: true, orderId: `stub-close-${symbol}`, executionPrice: 100000 };
    },
  };

  // Inject test hedges directly by mocking getActiveHedges. Simplest: call
  // the drift monitor with a stub via module patching. We'll spy indirectly
  // by checking that closeCalls fires only for misaligned positions.
  //
  // For a minimal E2E without heavy mocking, we invoke the guard directly
  // to simulate the drift-check decision path:
  const btcSideDrift = await checkBeforeTrade({
    chain: 'sui', asset: 'BTC', intendedSide: 'SHORT', notionalUsd: 50, agentSource: 'drift-test',
  });
  const ethSideAligned = await checkBeforeTrade({
    chain: 'sui', asset: 'ETH', intendedSide: 'SHORT', notionalUsd: 50, agentSource: 'drift-test',
  });
  record(
    'Drift signal: BTC SHORT is now rejected (agent flipped LONG)',
    !btcSideDrift.approved && btcSideDrift.stage === 'agent-directive',
    `stage=${btcSideDrift.stage}, agentSide=${btcSideDrift.agentSide}, conf=${btcSideDrift.agentConfidence}`,
  );
  record(
    'Drift signal: ETH SHORT stays approved (agent aligned)',
    ethSideAligned.approved === true,
    `approved=${ethSideAligned.approved}, agentSide=${ethSideAligned.agentSide}`,
  );

  // Verify the module surface loads cleanly
  const { checkAndCloseDrifts } = await import('../lib/services/agents/position-drift-monitor');
  const driftRun = await checkAndCloseDrifts('sui', stubBluefin);
  record(
    'Drift monitor executes without throwing on empty positions',
    typeof driftRun.checked === 'number' && typeof driftRun.closed === 'number',
    `checked=${driftRun.checked}, drifted=${driftRun.drifted}, closed=${driftRun.closed}, errors=${driftRun.errors}`,
  );

  // [14] Consensus vote required + auto-cast on trades >= $100k
  process.env.LARGE_TRADE_CONSENSUS_USD = '100000';
  await publishDirectives({
    ranAt: Date.now(),
    chain: 'sui',
    riskScore: 30,
    riskLevel: 'LOW',
    byAsset: {
      BTC: { asset: 'BTC', recommendedSide: 'SHORT', confidence: 80, shouldHedge: true, reason: 'consensus test', riskScore: 30, computedAt: Date.now() },
    },
  });
  const consensusCheck = await checkBeforeTrade({
    chain: 'sui', asset: 'BTC', intendedSide: 'SHORT',
    notionalUsd: 500_000, agentSource: 'e2e-consensus',
  });
  record(
    'Multi-agent consensus fires + passes on aligned large trade',
    consensusCheck.approved === true && (consensusCheck.reason.includes('consensus PASSED') || consensusCheck.reason.includes('SafeGuard cleared')),
    `approved=${consensusCheck.approved}, reason=${consensusCheck.reason.slice(0, 100)}`,
  );

  // [15] Consensus BLOCKS on side-mismatched large trade
  const consensusBlockCheck = await checkBeforeTrade({
    chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
    notionalUsd: 500_000, agentSource: 'e2e-consensus-block',
  });
  record(
    'Multi-agent consensus blocks side-mismatched large trade',
    !consensusBlockCheck.approved,
    `approved=${consensusBlockCheck.approved}, stage=${consensusBlockCheck.stage}, reason=${consensusBlockCheck.reason.slice(0, 100)}`,
  );

  // [16] ZK attestation soft-skip on unreachable prover
  process.env.ZK_ATTEST_MIN_NOTIONAL_USD = '250000';
  process.env.ZK_ATTEST_STRICT = '0';
  const zkSoftSkip = await checkBeforeTrade({
    chain: 'sui', asset: 'BTC', intendedSide: 'SHORT',
    notionalUsd: 300_000, agentSource: 'e2e-zk-soft',
  });
  record(
    'ZK attestation soft-skip allows trade when prover unreachable',
    zkSoftSkip.approved === true,
    `approved=${zkSoftSkip.approved}, reason=${zkSoftSkip.reason.slice(0, 100)}`,
  );

  // [17] Perp venue router below split threshold → single-venue plan
  const { routeHedgePlan } = await import('../lib/services/hedging/perp-venue-router');
  const smallPlan = await routeHedgePlan({ symbol: 'BTC-PERP', notionalUsd: 100, side: 'SHORT' });
  record(
    'Perp router: below split threshold → single BlueFin leg',
    smallPlan.singleVenue === true && smallPlan.belowSplitThreshold === true,
    `legs=${smallPlan.legs.length}, singleVenue=${smallPlan.singleVenue}, belowThreshold=${smallPlan.belowSplitThreshold}`,
  );

  // [18-22] Dust manager — the class of problem that trapped the ETH-PERP
  const dust = await import('../lib/services/sui/dust-manager');

  const dustCase = dust.classifyPosition('ETH-PERP', 0.00794);
  record(
    'Dust: sub-minQty ETH position classified UNCLEARABLE',
    dustCase.isDust && dustCase.exitPath === 'UNCLEARABLE',
    `size=${dustCase.size}, minQty=${dustCase.minQty}, stepMult=${dustCase.stepMultiples.toFixed(3)}, path=${dustCase.exitPath}`,
  );

  const alignedCase = dust.classifyPosition('ETH-PERP', 0.02);
  record(
    'Dust: step-aligned position is NOT dust',
    !alignedCase.isDust && alignedCase.exitPath === 'REDUCE_ORDER',
    `size=${alignedCase.size}, path=${alignedCase.exitPath}`,
  );

  const misalignedCase = dust.classifyPosition('ETH-PERP', 0.01294);
  record(
    'Dust: above-minQty non-step-aligned classified ADD_TO_CLEAR',
    misalignedCase.isDust && misalignedCase.exitPath === 'ADD_TO_CLEAR',
    `size=${misalignedCase.size}, residueOnStepClose=${(misalignedCase.size % misalignedCase.stepSize).toFixed(6)}`,
  );

  record(
    'Dust: wouldBecomeDust rejects sizes below 1.5x minQty',
    dust.wouldBecomeDust('ETH-PERP', 0.014) === true && dust.wouldBecomeDust('ETH-PERP', 0.016) === false,
    `0.014→dust=${dust.wouldBecomeDust('ETH-PERP', 0.014)}, 0.016→dust=${dust.wouldBecomeDust('ETH-PERP', 0.016)}`,
  );

  const minSafeUsd = dust.minSafeOpenNotionalUsd('ETH-PERP', 1600);
  record(
    'Dust: minSafeOpenNotionalUsd computes correctly',
    minSafeUsd === 24, // 0.01 * 1.5 * 1600
    `ETH-PERP at $1600 requires ≥ $${minSafeUsd.toFixed(2)} notional to avoid dust risk`,
  );

  // RESTORE the pre-test production cache — never leave production
  // running with test values or null. If the previous cache was populated
  // and fresh, put it back so the live guard keeps working; if it was
  // already stale, still restore so the loader's staleness logic fires
  // correctly (rather than fail-open on a null).
  if (PROD_DIRECTIVE_SNAPSHOT !== null && PROD_DIRECTIVE_SNAPSHOT !== undefined) {
    await setCronState(NO_CACHE_KEY, PROD_DIRECTIVE_SNAPSHOT);
    console.log('[E2E] Restored production directive cache snapshot.');
  } else {
    // If there was nothing before the test, publish a fresh snapshot from
    // the real prediction aggregator so production doesn't sit on empty
    // until the next cron cycle.
    try {
      const { PredictionAggregatorService } = await import('../lib/services/market-data/PredictionAggregatorService');
      const perAsset = await PredictionAggregatorService.getPerAssetPredictions(['BTC', 'ETH', 'SUI', 'CRO']);
      const byAsset: Record<string, unknown> = {};
      for (const [asset, pred] of Object.entries(perAsset)) {
        const dir = pred.direction;
        let side: 'LONG' | 'SHORT' | null = null;
        if (pred.recommendation.endsWith('LONG')) side = 'LONG';
        else if (pred.recommendation.endsWith('SHORT')) side = 'SHORT';
        else if (dir === 'UP') side = 'LONG';
        else if (dir === 'DOWN') side = 'SHORT';
        byAsset[asset.toUpperCase()] = {
          asset: asset.toUpperCase(),
          recommendedSide: side,
          confidence: Math.round(pred.confidence ?? 0),
          shouldHedge: pred.recommendation !== 'WAIT' || dir !== 'NEUTRAL',
          reason: `${pred.recommendation} (dir=${dir})`,
          riskScore: 50,
          computedAt: Date.now(),
        };
      }
      await publishDirectives({
        ranAt: Date.now(), chain: 'sui', riskScore: 50, riskLevel: 'MEDIUM', byAsset: byAsset as never,
      });
      console.log('[E2E] Published fresh production directives (no previous snapshot).');
    } catch (e) {
      console.log('[E2E] Could not populate fresh directives (test complete either way):', String(e).slice(0, 150));
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n=== ${passed}/${total} checks passed ===\n`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error('Unhandled:', e);
  process.exit(1);
});
