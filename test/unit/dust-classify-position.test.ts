/**
 * Contract lock for dust-manager.classifyPosition — the reconcile scan's
 * dust-detection decision hinges on `exitPath === 'UNCLEARABLE'`. If a
 * refactor ever softens that classification (e.g. mislabels sub-minQty
 * as ADD_TO_CLEAR again), the escalation KILL never fires and dust
 * positions silently spam WARN every 15 min. Anchor it here.
 */
import { describe, it, expect } from '@jest/globals';
import { classifyPosition } from '@/lib/services/sui/dust-manager';

describe('classifyPosition — dust vs healthy classification', () => {
  it('flags sub-minQty ETH-PERP as UNCLEARABLE (the #190 case)', () => {
    const c = classifyPosition('ETH-PERP', 0.00929288);
    expect(c.isDust).toBe(true);
    expect(c.exitPath).toBe('UNCLEARABLE');
    expect(c.minQty).toBe(0.01);
  });

  it('flags sub-minQty SUI-PERP as UNCLEARABLE (the #5 case)', () => {
    const c = classifyPosition('SUI-PERP', 0.824);
    expect(c.exitPath).toBe('UNCLEARABLE');
  });

  it('healthy step-aligned ETH size returns REDUCE_ORDER (closable)', () => {
    const c = classifyPosition('ETH-PERP', 0.02);
    expect(c.isDust).toBe(false);
    expect(c.exitPath).toBe('REDUCE_ORDER');
  });

  it('above-minQty but non-step-aligned returns ADD_TO_CLEAR, not UNCLEARABLE', () => {
    // Regression guard: the reconcile scan filters on UNCLEARABLE only,
    // so this must NOT be re-classified as UNCLEARABLE (would over-flag).
    const c = classifyPosition('ETH-PERP', 0.01294);
    expect(c.exitPath).toBe('ADD_TO_CLEAR');
  });
});
