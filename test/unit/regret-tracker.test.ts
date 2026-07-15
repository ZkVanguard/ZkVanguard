/**
 * Unit tests for regret-tracker — Gap 7.
 *
 * Confidence-weighted rolling outcome. Locks the [0.25, 1.0] range and
 * the mapping curve, so a future "simplification" can't silently allow
 * huge stakes during losing streaks.
 */
import { describe, it, expect } from '@jest/globals';
import { computeRegretScore, computeSizeMultiplier } from '@/lib/services/ai/regret-tracker';

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 60 * 1000);
}

describe('computeRegretScore', () => {
  it('returns 0 on empty input', () => {
    expect(computeRegretScore([])).toBe(0);
  });

  it('returns +1 on perfect winning streak (all wins, same confidence)', () => {
    const decisions = Array.from({ length: 5 }, () => ({
      openConfidence: 80, realizedPnl: 10, openedAt: hoursAgo(1),
    }));
    expect(computeRegretScore(decisions)).toBeCloseTo(1, 3);
  });

  it('returns -1 on perfect losing streak (all losses, same confidence)', () => {
    const decisions = Array.from({ length: 5 }, () => ({
      openConfidence: 80, realizedPnl: -10, openedAt: hoursAgo(1),
    }));
    expect(computeRegretScore(decisions)).toBeCloseTo(-1, 3);
  });

  it('weights higher-confidence outcomes more', () => {
    // 1 high-confidence loss vs 1 low-confidence win → net negative
    const score = computeRegretScore([
      { openConfidence: 90, realizedPnl: -10, openedAt: hoursAgo(1) },
      { openConfidence: 10, realizedPnl: 10, openedAt: hoursAgo(1) },
    ]);
    expect(score).toBeLessThan(0);
  });

  it('ignores $0 realized (neutral outcome, contributes 0)', () => {
    const score = computeRegretScore([
      { openConfidence: 80, realizedPnl: 0, openedAt: hoursAgo(1) },
      { openConfidence: 80, realizedPnl: 10, openedAt: hoursAgo(1) },
    ]);
    // 1 win + 1 neutral → net positive but not full +1
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(0.5);
  });
});

describe('computeSizeMultiplier — bounds', () => {
  it('caps at maxMultiplier (default 1.0) when regret ≥ 0.3', async () => {
    const mult = await computeSizeMultiplier({
      recentDecisions: Array.from({ length: 10 }, () => ({
        openConfidence: 80, realizedPnl: 20, openedAt: hoursAgo(2),
      })),
    });
    expect(mult).toBe(1.0);
  });

  it('floors at minMultiplier (default 0.25) when regret ≤ -0.3', async () => {
    const mult = await computeSizeMultiplier({
      recentDecisions: Array.from({ length: 10 }, () => ({
        openConfidence: 80, realizedPnl: -20, openedAt: hoursAgo(2),
      })),
    });
    expect(mult).toBe(0.25);
  });

  it('interpolates linearly between (−0.3, +0.3)', async () => {
    // Score exactly at 0 → midpoint of range
    const mult = await computeSizeMultiplier({
      recentDecisions: [
        { openConfidence: 80, realizedPnl: 10, openedAt: hoursAgo(1) },
        { openConfidence: 80, realizedPnl: -10, openedAt: hoursAgo(1) },
      ],
    });
    // (1.0 + 0.25) / 2 = 0.625
    expect(mult).toBeCloseTo(0.625, 2);
  });
});

describe('computeSizeMultiplier — window filtering', () => {
  it('excludes decisions older than windowDays (default 30)', async () => {
    const mult = await computeSizeMultiplier({
      recentDecisions: [
        { openConfidence: 80, realizedPnl: -50, openedAt: hoursAgo(24 * 45) }, // 45 days old
        { openConfidence: 80, realizedPnl: -50, openedAt: hoursAgo(24 * 40) }, // 40 days old
      ],
    });
    // All decisions filtered out → regret = 0 → mult = 0.625
    expect(mult).toBeCloseTo(0.625, 2);
  });

  it('respects custom windowDays override', async () => {
    const mult = await computeSizeMultiplier({
      recentDecisions: [
        { openConfidence: 80, realizedPnl: -20, openedAt: hoursAgo(24 * 5) }, // 5 days old
      ],
      windowDays: 3, // window excludes the 5-day decision
    });
    // No in-window decisions → mult = 0.625
    expect(mult).toBeCloseTo(0.625, 2);
  });
});

describe('computeSizeMultiplier — custom bounds', () => {
  it('respects overridden min/max multipliers', async () => {
    const decisions = Array.from({ length: 5 }, () => ({
      openConfidence: 80, realizedPnl: -20, openedAt: hoursAgo(1),
    }));
    const mult = await computeSizeMultiplier({
      recentDecisions: decisions,
      minMultiplier: 0.1,
      maxMultiplier: 2.0,
    });
    expect(mult).toBe(0.1);
  });
});

describe('computeSizeMultiplier — edge cases', () => {
  it('returns midpoint on empty input', async () => {
    const mult = await computeSizeMultiplier({ recentDecisions: [] });
    expect(mult).toBeCloseTo(0.625, 2);
  });

  it('handles openConfidence outside [0, 100] gracefully', async () => {
    const mult = await computeSizeMultiplier({
      recentDecisions: [
        { openConfidence: 150, realizedPnl: 10, openedAt: hoursAgo(1) }, // clamped to 100
        { openConfidence: -20, realizedPnl: -10, openedAt: hoursAgo(1) }, // clamped to 0
      ],
    });
    // With clamp: full-weight win + zero-weight loss → strong positive → cap at 1.0
    expect(mult).toBeGreaterThan(0.9);
  });
});
