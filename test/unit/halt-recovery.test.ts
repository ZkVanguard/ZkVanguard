/**
 * Unit tests for evaluateHaltRecovery — autonomous drawdown-halt clearing.
 *
 * Locks the invariants that make the halt system self-healing without
 * operator intervention:
 *   1. Auto-clears drawdown-halts once drawdown recovers under threshold
 *   2. Leaves non-drawdown halts alone (manual, phantom-rate, etc.)
 *   3. Fail-closed on bad NAV / peak reads (never clears on ambiguous data)
 *   4. Handles NAV > peak (recovery beyond peak) — treats as 0% drawdown
 */
import { describe, it, expect } from '@jest/globals';
import { evaluateHaltRecovery } from '@/lib/services/sui/cron/halt-recovery';

const DRAWDOWN_REASON = 'Pool NAV $28.18 is 22.6% below peak $36.27 (>= 10% halt threshold). Auto-hedge paused until UTC midnight.';
const MANUAL_REASON = 'operator manually halted for review';
const PHANTOM_REASON = 'phantom hedge rate 3.2% > 1% threshold';

describe('evaluateHaltRecovery', () => {
  describe('autonomous drawdown recovery', () => {
    it('CLEARS when drawdown recovers below threshold', () => {
      // 2026-08-11 real scenario: NAV $28.18, peak (post-fix) $30.69 → 8.2% dd
      const r = evaluateHaltRecovery({
        haltReason: DRAWDOWN_REASON,
        currentNavUsd: 28.18,
        peakNavUsd: 30.69,
        thresholdPct: 10,
      });
      expect(r.shouldClear).toBe(true);
      expect(r.drawdownPct).toBeCloseTo(8.18, 1);
      expect(r.reason).toContain('recovered');
    });

    it('KEEPS halt when drawdown is still over threshold', () => {
      const r = evaluateHaltRecovery({
        haltReason: DRAWDOWN_REASON,
        currentNavUsd: 28.18,
        peakNavUsd: 36.27,  // stale peak from pre-#55
        thresholdPct: 10,
      });
      expect(r.shouldClear).toBe(false);
      expect(r.drawdownPct).toBeGreaterThan(10);
    });

    it('CLEARS at exact recovery to threshold', () => {
      // dd = 9.99% → below 10% → clear
      const r = evaluateHaltRecovery({
        currentNavUsd: 90.01,
        peakNavUsd: 100,
        thresholdPct: 10,
        haltReason: DRAWDOWN_REASON,
      });
      expect(r.shouldClear).toBe(true);
    });

    it('KEEPS halt at exact threshold boundary (dd = 10.0% AT threshold)', () => {
      // dd = exactly 10% → NOT below → keep
      const r = evaluateHaltRecovery({
        currentNavUsd: 90,
        peakNavUsd: 100,
        thresholdPct: 10,
        haltReason: DRAWDOWN_REASON,
      });
      expect(r.shouldClear).toBe(false);
    });

    it('treats NAV > peak as 0% drawdown → clears', () => {
      const r = evaluateHaltRecovery({
        currentNavUsd: 105,
        peakNavUsd: 100,
        thresholdPct: 10,
        haltReason: DRAWDOWN_REASON,
      });
      expect(r.shouldClear).toBe(true);
      expect(r.drawdownPct).toBe(0);
    });
  });

  describe('leaves non-drawdown halts alone', () => {
    it('does NOT clear a manual halt even if drawdown OK', () => {
      const r = evaluateHaltRecovery({
        haltReason: MANUAL_REASON,
        currentNavUsd: 100,
        peakNavUsd: 100,
        thresholdPct: 10,
      });
      expect(r.shouldClear).toBe(false);
      expect(r.reason).toContain('not drawdown-based');
    });

    it('does NOT clear a phantom-rate halt', () => {
      const r = evaluateHaltRecovery({
        haltReason: PHANTOM_REASON,
        currentNavUsd: 100,
        peakNavUsd: 100,
        thresholdPct: 10,
      });
      expect(r.shouldClear).toBe(false);
    });
  });

  describe('fail-closed on bad inputs', () => {
    it('does NOT clear on NaN NAV', () => {
      const r = evaluateHaltRecovery({
        haltReason: DRAWDOWN_REASON,
        currentNavUsd: NaN,
        peakNavUsd: 30,
        thresholdPct: 10,
      });
      expect(r.shouldClear).toBe(false);
      expect(r.reason).toContain('cannot re-verify');
    });

    it('does NOT clear on 0 NAV', () => {
      const r = evaluateHaltRecovery({
        haltReason: DRAWDOWN_REASON,
        currentNavUsd: 0,
        peakNavUsd: 30,
        thresholdPct: 10,
      });
      expect(r.shouldClear).toBe(false);
    });

    it('does NOT clear on negative peak', () => {
      const r = evaluateHaltRecovery({
        haltReason: DRAWDOWN_REASON,
        currentNavUsd: 28,
        peakNavUsd: -5,
        thresholdPct: 10,
      });
      expect(r.shouldClear).toBe(false);
      expect(r.reason).toContain('cannot compute');
    });
  });
});
