/**
 * Golden tests for SafeExecutionGuard.validateExecution — the gate EVERY
 * trade-impacting action flows through. Locks the position/leverage/slippage
 * caps, the large-position + consensus approval triggers, and the >$1M ZK-proof
 * flag. validateExecution is read-only w.r.t. cooldown/volume state, so calling
 * the fresh singleton against defaults is deterministic.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SafeExecutionGuard } from '@/agents/core/SafeExecutionGuard';

const guard = SafeExecutionGuard.getInstance();
const base = { executionId: 'test', agentId: 'tester', action: 'hedge' };

// Reset before AND after so leaked state from other test files (same JS
// singleton across the whole bun-test process) can't fail us, and so we
// leave a clean instance for the next file.
const reset = () => {
  (guard as unknown as { resetState(): void }).resetState();
  (guard as unknown as { resetCircuitBreaker(): void }).resetCircuitBreaker();
};
beforeEach(reset);
afterEach(reset);

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

  it('rejects leverage above the 4x cap', async () => {
    const r = await guard.validateExecution({ ...base, positionSizeUSD: 1000, leverage: 10 });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.includes('Leverage'))).toBe(true);
  });

  it('rejects slippage above the 30bps cap', async () => {
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

describe('SafeExecutionGuard circuit breaker', () => {
  const breaker = () => (guard as unknown as { circuitBreaker: { isOpen: boolean } }).circuitBreaker;

  it('stays closed below the 3-failure threshold', () => {
    guard.failExecution('f1', 'simulated');
    guard.failExecution('f2', 'simulated');
    expect(breaker().isOpen).toBe(false);
  });

  it('opens after 3 consecutive failures and blocks new executions', async () => {
    for (let i = 0; i < 3; i++) guard.failExecution(`f${i}`, 'simulated failure');
    expect(breaker().isOpen).toBe(true);
    const r = await guard.validateExecution({ ...base, positionSizeUSD: 1000 });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.includes('CIRCUIT BREAKER'))).toBe(true);
  });

  it('emergencyStop trips it immediately and halts trades', async () => {
    guard.emergencyStop('manual halt');
    expect(breaker().isOpen).toBe(true);
    const r = await guard.validateExecution({ ...base, positionSizeUSD: 1000 });
    expect(r.isValid).toBe(false);
  });
});
