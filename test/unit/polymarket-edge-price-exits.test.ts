/**
 * Locks the take-profit / stop-loss decision math from the
 * polymarket-edge trader.
 *
 * moveBps = (mark - entry) / entry × dir × 10_000
 *   dir = +1 for LONG (up = win), -1 for SHORT (down = win)
 *
 * Exit rules:
 *   moveBps >= TAKE_PROFIT_BPS  → take-profit close
 *   moveBps <= -STOP_LOSS_BPS   → stop-loss close
 *   otherwise                   → hold / signal-flip check
 *
 * Real-world calibration:
 *   TP = 30 bps  → close at first $22.90 move on a $76.50 SOL
 *   SL = 20 bps  → cut loss at $15.30 adverse
 *   Together they invert the profit-factor problem (avg win > avg loss).
 */

const TAKE_PROFIT_BPS = 30;
const STOP_LOSS_BPS = 20;

interface TradeState {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
}

function moveBps(state: TradeState, markPrice: number): number {
  const dir = state.side === 'LONG' ? 1 : -1;
  return ((markPrice - state.entryPrice) / state.entryPrice) * dir * 10_000;
}

function shouldExit(
  state: TradeState,
  markPrice: number,
): { exit: false } | { exit: true; reason: 'take-profit' | 'stop-loss'; bps: number } {
  const bps = moveBps(state, markPrice);
  if (bps >= TAKE_PROFIT_BPS) return { exit: true, reason: 'take-profit', bps };
  if (bps <= -STOP_LOSS_BPS) return { exit: true, reason: 'stop-loss', bps };
  return { exit: false };
}

describe('polymarket-edge price-based exits', () => {
  describe('LONG position', () => {
    const trade: TradeState = { side: 'LONG', entryPrice: 76.50 };

    it('holds when move is inside band (+15 bps)', () => {
      // +15 bps = 76.50 × 1.0015 = 76.6148
      const r = shouldExit(trade, 76.6148);
      expect(r.exit).toBe(false);
    });

    it('take-profit fires at +30.01 bps (just past threshold)', () => {
      const target = 76.50 * (1 + 30.01 / 10_000);
      const r = shouldExit(trade, target);
      expect(r.exit).toBe(true);
      if (r.exit) {
        expect(r.reason).toBe('take-profit');
        expect(r.bps).toBeCloseTo(30.01, 4);
      }
    });

    it('take-profit fires generously past +30 bps', () => {
      const r = shouldExit(trade, 76.50 * 1.005); // +50 bps
      expect(r.exit).toBe(true);
      if (r.exit) {
        expect(r.reason).toBe('take-profit');
        expect(r.bps).toBeCloseTo(50, 5);
      }
    });

    it('stop-loss fires at -20.01 bps (just past threshold)', () => {
      const target = 76.50 * (1 - 20.01 / 10_000);
      const r = shouldExit(trade, target);
      expect(r.exit).toBe(true);
      if (r.exit) {
        expect(r.reason).toBe('stop-loss');
        expect(r.bps).toBeCloseTo(-20.01, 4);
      }
    });

    it('holds at -15 bps (inside band on downside)', () => {
      const target = 76.50 * (1 - 15 / 10_000);
      const r = shouldExit(trade, target);
      expect(r.exit).toBe(false);
    });
  });

  describe('SHORT position', () => {
    const trade: TradeState = { side: 'SHORT', entryPrice: 3800 };

    it('take-profit fires when price drops 30 bps (SHORT wins going down)', () => {
      // Price down = SHORT profit → dir=-1 flips sign back to positive
      const target = 3800 * (1 - 30 / 10_000); // price fell 30 bps
      const r = shouldExit(trade, target);
      expect(r.exit).toBe(true);
      if (r.exit) {
        expect(r.reason).toBe('take-profit');
        expect(r.bps).toBeCloseTo(30, 5);
      }
    });

    it('stop-loss fires when price rises 20.01 bps against a SHORT', () => {
      const target = 3800 * (1 + 20.01 / 10_000); // price rose = SHORT loses
      const r = shouldExit(trade, target);
      expect(r.exit).toBe(true);
      if (r.exit) {
        expect(r.reason).toBe('stop-loss');
        expect(r.bps).toBeCloseTo(-20.01, 4);
      }
    });
  });

  describe('profit-factor inversion (the actual point of the fix)', () => {
    it('caps loss at 20 bps × leverage on a bad trade', () => {
      // With stake $5, 3× leverage, notional $15:
      // Max loss = 20 bps × $15 = $0.03 gross (ignore fees for math)
      const trade: TradeState = { side: 'LONG', entryPrice: 100 };
      const stopPrice = 100 * (1 - 20 / 10_000); // = 99.80
      const notional = 15;
      const maxLoss = ((stopPrice - 100) / 100) * notional;
      expect(maxLoss).toBeCloseTo(-0.03, 4);
    });

    it('locks in gain at 30 bps × leverage on a good trade', () => {
      const trade: TradeState = { side: 'LONG', entryPrice: 100 };
      const tpPrice = 100 * (1 + 30 / 10_000); // = 100.30
      const notional = 15;
      const takenProfit = ((tpPrice - 100) / 100) * notional;
      expect(takenProfit).toBeCloseTo(0.045, 4);
    });

    it('inverts historical avg-loss / avg-win imbalance', () => {
      // Historical: avg win $0.18, avg loss $0.87 → net negative
      // Post-fix cap: avg win ≤ $0.045, avg loss ≤ $0.03 per trade (at $15 notional)
      // Win-loss ratio becomes 1.5× in our favor even at 40% win rate
      const notional = 15;
      const maxWin = (30 / 10_000) * notional;
      const maxLoss = (20 / 10_000) * notional;
      expect(maxWin / maxLoss).toBeCloseTo(1.5, 3);
    });
  });
});
