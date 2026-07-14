/**
 * Decision-tree tests for `checkBeforeTrade` in agent-trade-guard.ts.
 *
 * The guard is the safety-critical checkpoint every trade-impacting cron
 * calls before opening a position. It has 4 layers:
 *   1. Agent directive (per-asset side + shouldHedge from cached cycle)
 *   2. Risk-gate (global risk score vs ceiling)
 *   3. SafeExecutionGuard (position cap, slippage, cooldown, breaker)
 *   4. Consensus / ZK-STARK attestation for large trades
 *
 * These tests exercise the DECISION MATRIX by mocking the cron_state DB
 * and the SafeExecutionGuard singleton. Fetch-based ZK attestation and
 * DB writes for agent_decisions are stubbed as no-ops.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ─── Mock the I/O layer ────────────────────────────────────────────────────
jest.mock('@/lib/db/cron-state', () => ({
  getCronState: jest.fn(),
  setCronState: jest.fn(async () => {}),
}));
jest.mock('@/lib/db/agent-decisions', () => ({
  recordAgentDecision: jest.fn(async () => {}),
}));

// SafeExecutionGuard singleton — return one that always approves and
// tracks calls so we can verify consensus/vote flow.
const mockValidateExecution = jest.fn(async () => ({ isValid: true, errors: [] }));
const mockRequestConsensus = jest.fn(async () => {});
const mockSubmitVote = jest.fn();
const mockCheckConsensus = jest.fn(() => ({ reached: true, approved: true, details: 'ok' }));

jest.mock('@/agents/core/SafeExecutionGuard', () => ({
  getSafeExecutionGuard: () => ({
    validateExecution: mockValidateExecution,
    requestConsensus: mockRequestConsensus,
    submitVote: mockSubmitVote,
    checkConsensus: mockCheckConsensus,
  }),
}));

// Re-import after mocks are set up.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { checkBeforeTrade, publishDirectives } = require('@/lib/services/agents/agent-trade-guard');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getCronState, setCronState } = require('@/lib/db/cron-state');

const now = Date.now();
const freshCycle = {
  ranAt: now,
  chain: 'sui',
  riskScore: 50,
  riskLevel: 'medium',
  byAsset: {} as Record<string, unknown>,
};

function makeDirective(over: Partial<{
  recommendedSide: 'LONG' | 'SHORT' | null;
  confidence: number;
  shouldHedge: boolean;
  reason: string;
  riskScore: number;
  source: 'hedging-agent' | 'signal-aggregator';
}> = {}) {
  return {
    asset: 'BTC',
    recommendedSide: 'LONG' as const,
    confidence: 75,
    shouldHedge: true,
    reason: 'strong signal',
    riskScore: 50,
    computedAt: now,
    source: 'signal-aggregator' as const,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockValidateExecution.mockResolvedValue({ isValid: true, errors: [] });
  mockCheckConsensus.mockReturnValue({ reached: true, approved: true, details: 'ok' });
  // Default: no cached cycle → fail-open path
  (getCronState as jest.Mock).mockResolvedValue(null);
});

describe('checkBeforeTrade — fail-open when no cache', () => {
  it('approves when no agent cycle cached (stale or never ran)', async () => {
    const r = await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(r.approved).toBe(true);
    expect(r.stage).toBe('pass');
  });

  it('approves stale cache older than 35 min', async () => {
    (getCronState as jest.Mock).mockResolvedValue({
      ...freshCycle,
      ranAt: now - 40 * 60_000,  // 40 min old — stale
    });
    const r = await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(r.approved).toBe(true);
  });
});

describe('checkBeforeTrade — risk-gate', () => {
  it('BLOCKS when global riskScore exceeds default ceiling (80)', async () => {
    (getCronState as jest.Mock).mockResolvedValue({ ...freshCycle, riskScore: 85 });
    const r = await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(r.approved).toBe(false);
    expect(r.stage).toBe('risk-gate');
    expect(r.reason).toContain('riskScore=85');
    expect(r.reason).toContain('ceiling 80');
  });

  it('APPROVES when riskScore equals ceiling exactly', async () => {
    (getCronState as jest.Mock).mockResolvedValue({ ...freshCycle, riskScore: 80 });
    const r = await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(r.approved).toBe(true);
  });

  it('APPROVES low risk', async () => {
    (getCronState as jest.Mock).mockResolvedValue({ ...freshCycle, riskScore: 30 });
    const r = await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(r.approved).toBe(true);
  });
});

describe('checkBeforeTrade — agent-directive layer', () => {
  it('BLOCKS when directive says shouldHedge=false (hard HOLD)', async () => {
    (getCronState as jest.Mock).mockResolvedValue({
      ...freshCycle,
      byAsset: { BTC: makeDirective({ shouldHedge: false, reason: 'no edge' }) },
    });
    const r = await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(r.approved).toBe(false);
    expect(r.stage).toBe('agent-directive');
    expect(r.reason).toContain('HOLD');
  });

  it('BLOCKS on side mismatch with conf ≥ 70 (default block threshold)', async () => {
    (getCronState as jest.Mock).mockResolvedValue({
      ...freshCycle,
      byAsset: { BTC: makeDirective({ recommendedSide: 'SHORT', confidence: 75 }) },
    });
    const r = await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(r.approved).toBe(false);
    expect(r.reason).toContain('SHORT');
    expect(r.reason).toContain('LONG');
    expect(r.reason).toContain('75');
  });

  it('APPROVES side mismatch with conf < 70 (weak opinion)', async () => {
    (getCronState as jest.Mock).mockResolvedValue({
      ...freshCycle,
      byAsset: { BTC: makeDirective({ recommendedSide: 'SHORT', confidence: 60 }) },
    });
    const r = await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(r.approved).toBe(true);
  });

  it('APPROVES when directive side aligns with intended', async () => {
    (getCronState as jest.Mock).mockResolvedValue({
      ...freshCycle,
      byAsset: { BTC: makeDirective({ recommendedSide: 'LONG', confidence: 90 }) },
    });
    const r = await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(r.approved).toBe(true);
  });

  it('APPROVES when directive has null recommendedSide (no opinion)', async () => {
    (getCronState as jest.Mock).mockResolvedValue({
      ...freshCycle,
      byAsset: { BTC: makeDirective({ recommendedSide: null, confidence: 90 }) },
    });
    const r = await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(r.approved).toBe(true);
  });

  it('reports the SIGNAL-AGG source in block message when directive source is signal-aggregator', async () => {
    (getCronState as jest.Mock).mockResolvedValue({
      ...freshCycle,
      byAsset: { BTC: makeDirective({ recommendedSide: 'SHORT', confidence: 80, source: 'signal-aggregator' }) },
    });
    const r = await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(r.reason).toContain('signal-agg');
  });

  it('reports the HEDGING AGENT source in block message when directive source is hedging-agent', async () => {
    (getCronState as jest.Mock).mockResolvedValue({
      ...freshCycle,
      byAsset: { BTC: makeDirective({ recommendedSide: 'SHORT', confidence: 80, source: 'hedging-agent' }) },
    });
    const r = await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(r.reason).toContain('HedgingAgent(LLM)');
  });
});

describe('checkBeforeTrade — asset case-insensitive', () => {
  it('normalizes asset to uppercase in the directive lookup', async () => {
    (getCronState as jest.Mock).mockResolvedValue({
      ...freshCycle,
      byAsset: { BTC: makeDirective({ shouldHedge: false }) },
    });
    // Pass lowercase asset
    const r = await checkBeforeTrade({
      chain: 'sui', asset: 'btc', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(r.approved).toBe(false);
    expect(r.stage).toBe('agent-directive');
  });
});

describe('checkBeforeTrade — SafeExecutionGuard integration', () => {
  it('BLOCKS when SafeGuard validation fails', async () => {
    mockValidateExecution.mockResolvedValueOnce({
      isValid: false,
      errors: ['position cap $10M exceeded'],
    });
    (getCronState as jest.Mock).mockResolvedValue({
      ...freshCycle,
      byAsset: { BTC: makeDirective() },
    });
    const r = await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(r.approved).toBe(false);
    expect(r.stage).toBe('safe-execution-guard');
    expect(r.reason).toContain('position cap');
  });

  it('passes leverage through to SafeGuard when provided', async () => {
    (getCronState as jest.Mock).mockResolvedValue({
      ...freshCycle,
      byAsset: { BTC: makeDirective() },
    });
    await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test', leverage: 5,
    });
    expect(mockValidateExecution).toHaveBeenCalledWith(expect.objectContaining({ leverage: 5 }));
  });

  it('defaults expectedSlippageBps to 30 if not provided', async () => {
    (getCronState as jest.Mock).mockResolvedValue({
      ...freshCycle,
      byAsset: { BTC: makeDirective() },
    });
    await checkBeforeTrade({
      chain: 'sui', asset: 'BTC', intendedSide: 'LONG',
      notionalUsd: 100, agentSource: 'test',
    });
    expect(mockValidateExecution).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSlippageBps: 30 }),
    );
  });
});

describe('publishDirectives — DB write', () => {
  it('writes the snapshot to cron_state under the correct key', async () => {
    const snap = {
      ranAt: now, chain: 'sui', riskScore: 40, riskLevel: 'low', byAsset: {},
    };
    await publishDirectives(snap);
    expect(setCronState).toHaveBeenCalledWith('agent-directives:by-asset', snap);
  });

  it('does not throw when the DB write fails (best-effort)', async () => {
    (setCronState as jest.Mock).mockRejectedValueOnce(new Error('conn refused'));
    const snap = {
      ranAt: now, chain: 'sui', riskScore: 40, riskLevel: 'low', byAsset: {},
    };
    await expect(publishDirectives(snap)).resolves.toBeUndefined();
  });
});
