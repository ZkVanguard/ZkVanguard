/**
 * Golden tests for SafeExecutionGuard.validateExecution — the gate EVERY
 * trade-impacting action flows through. Locks the position/leverage/slippage
 * caps, the large-position + consensus approval triggers, and the >$1M ZK-proof
 * flag. validateExecution is read-only w.r.t. cooldown/volume state, so calling
 * the fresh singleton against defaults is deterministic.
 */
import { describe, it, expect } from '@jest/globals';
import { SafeExecutionGuard } from '@/agents/core/SafeExecutionGuard';

const guard = SafeExecutionGuard.getInstance();
const base = { executionId: 'test', agentId: 'tester', action: 'hedge' };

describe('SafeExecutionGuard.validateExecution', () => {
  it('accepts a clean, within-limits trade', async () => {
    const r = await guard.validateExecution({ ...base, positionSizeUSD: 1000, leverage: 3, expectedSlippageBps: 10 });
    expect(r.isValid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('rejects a position above the $10M single-position cap', async () => {
    const r = await guard.validateExecution({ ...base, positionSizeUSD: 11_000_000 });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.includes('Position size'))).toBe(true);
    expect(r.riskScore).toBeGreaterThanOrEqual(50);
  });

  it('rejects leverage above 5x', async () => {
    const r = await guard.validateExecution({ ...base, positionSizeUSD: 1000, leverage: 10 });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.includes('Leverage'))).toBe(true);
  });

  it('rejects slippage above 50bps', async () => {
    const r = await guard.validateExecution({ ...base, positionSizeUSD: 1000, expectedSlippageBps: 100 });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.includes('slippage'))).toBe(true);
  });

  it('warns + requires senior approval for a >50%-of-cap position', async () => {
    const r = await guard.validateExecution({ ...base, positionSizeUSD: 6_000_000 });
    expect(r.isValid).toBe(true); // warning, not block
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.requiredApprovals).toContain('senior_risk_officer');
  });

  it('requires multi-agent consensus for trades over $100K', async () => {
    const r = await guard.validateExecution({ ...base, positionSizeUSD: 200_000 });
    expect(r.requiredApprovals).toContain('multi_agent_consensus');
  });

  it('flags ZK-proof requirement above $1M (and not below)', async () => {
    expect((await guard.validateExecution({ ...base, positionSizeUSD: 2_000_000 })).zkProofRequired).toBe(true);
    expect((await guard.validateExecution({ ...base, positionSizeUSD: 5000 })).zkProofRequired).toBe(false);
  });

  it('skips cooldown for read-only zero-size analysis actions', async () => {
    const r = await guard.validateExecution({ ...base, action: 'analyze', positionSizeUSD: 0 });
    expect(r.isValid).toBe(true);
  });
});
