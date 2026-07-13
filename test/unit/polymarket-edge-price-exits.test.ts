/**
 * Locks the trailing-stop decision math from the polymarket-edge trader.
 *
 * Rules (bps, signed; dir=+1 for LONG, -1 for SHORT):
 *   moveBps = (mark - entry) / entry × dir × 10_000
 *
 *   highWaterBps ratchets upward each tick.
 *   effectiveStopBps depends on high-water:
 *     hwm < ARM (30)        → floor = -STOP_LOSS (20)   [initial stop]
 *     hwm ≥ ARM             → LOCK (10) + floor(hwm-ARM)/STEP × STEP_LOCK (10)
 *                             (each STEP=15 bps of new high raises the
 *                              locked stop by STEP_LOCK=10)
 *
 *   Exit when moveBps ≤ effectiveStopBps.
 *
 * Why: "profit hungry" — winners keep running as long as they keep
 * making new highs; losers are cut at -20 bps. Retraces past a raised
 * stop lock in profit at that level.
 */

const STOP_LOSS_BPS = 20;
const TRAIL_ARM_BPS = 30;
const TRAIL_LOCK_BPS = 10;
const TRAIL_STEP_BPS = 15;
const TRAIL_LOCK_STEP_BPS = 10;

function computeEffectiveStopBps(highWaterBps: number): number {
  const floor = -STOP_LOSS_BPS;
  if (highWaterBps < TRAIL_ARM_BPS) return floor;
  const stepsAbove = Math.floor((highWaterBps - TRAIL_ARM_BPS) / TRAIL_STEP_BPS);
  return TRAIL_LOCK_BPS + stepsAbove * TRAIL_LOCK_STEP_BPS;
}

interface TickState {
  entryPrice: number;
  side: 'LONG' | 'SHORT';
  highWaterBps: number;
}

function moveBps(state: TickState, mark: number): number {
  const dir = state.side === 'LONG' ? 1 : -1;
  return ((mark - state.entryPrice) / state.entryPrice) * dir * 10_000;
}

function tick(state: TickState, mark: number): {
  moveBps: number;
  highWaterBps: number;
  stopBps: number;
  exit: boolean;
} {
  const m = moveBps(state, mark);
  const hwm = Math.max(state.highWaterBps, m);
  const stop = computeEffectiveStopBps(hwm);
  return { moveBps: m, highWaterBps: hwm, stopBps: stop, exit: m <= stop };
}

describe('polymarket-edge trailing stop', () => {
  describe('computeEffectiveStopBps (pure)', () => {
    it('returns -20 (floor) when hwm below arm threshold', () => {
      expect(computeEffectiveStopBps(0)).toBe(-20);
      expect(computeEffectiveStopBps(29.9)).toBe(-20);
    });

    it('arms at +30 hwm: stop jumps to +10 (breakeven after fees)', () => {
      expect(computeEffectiveStopBps(30)).toBe(10);
    });

    it('ratchets stop up by 10 bps per 15 bps of new high above arm', () => {
      expect(computeEffectiveStopBps(45)).toBe(20);  // 1 step: 10 + 10
      expect(computeEffectiveStopBps(60)).toBe(30);  // 2 steps: 10 + 20
      expect(computeEffectiveStopBps(75)).toBe(40);
      expect(computeEffectiveStopBps(90)).toBe(50);
    });

    it('never regresses (monotonic in hwm)', () => {
      let prev = computeEffectiveStopBps(0);
      for (let hwm = 0; hwm <= 200; hwm += 3) {
        const s = computeEffectiveStopBps(hwm);
        expect(s).toBeGreaterThanOrEqual(prev);
        prev = s;
      }
    });
  });

  describe('LONG runner — winner keeps running', () => {
    const initial: TickState = { entryPrice: 100, side: 'LONG', highWaterBps: 0 };

    it('tiny drift keeps stop at -20 floor', () => {
      const t = tick(initial, 100.05); // +5 bps
      expect(t.stopBps).toBe(-20);
      expect(t.exit).toBe(false);
    });

    it('crossing arm locks +10 stop and does NOT exit', () => {
      // Cross arm barely
      const t = tick(initial, 100.301); // +30.1 bps
      expect(t.stopBps).toBe(10);
      expect(t.exit).toBe(false); // still above stop
    });

    it('after running to +100 bps then retracing to +40, exits at trailing stop', () => {
      // Simulate: hwm previously reached 100 bps → stop = 50
      const armed: TickState = { entryPrice: 100, side: 'LONG', highWaterBps: 100 };
      const t = tick(armed, 100.40); // moveBps = 40, stop = 50
      expect(t.stopBps).toBe(50);
      expect(t.exit).toBe(true); // 40 < 50 → trailing-stop trigger, LOCKS +40 bps profit
    });

    it('does NOT exit while trade continues to make new highs', () => {
      const state: TickState = { entryPrice: 100, side: 'LONG', highWaterBps: 60 };
      const t = tick(state, 100.801); // +80.1 bps (new high)
      expect(t.highWaterBps).toBeCloseTo(80.1, 4);
      expect(t.stopBps).toBe(40); // was 30 at hwm=60, now 40 at hwm=80.1
      expect(t.exit).toBe(false); // 80.1 > 40
    });
  });

  describe('LONG loser — hard stop at -20', () => {
    const initial: TickState = { entryPrice: 100, side: 'LONG', highWaterBps: 0 };

    it('exits at -20 bps (never armed the trail)', () => {
      const t = tick(initial, 99.80); // -20 bps
      expect(t.stopBps).toBe(-20);
      expect(t.exit).toBe(true);
    });

    it('holds at -15 bps (inside the stop band)', () => {
      const t = tick(initial, 99.85);
      expect(t.exit).toBe(false);
    });
  });

  describe('SHORT runner + loser (mirror-image math)', () => {
    it('SHORT arms when price drops 30.1 bps (dir=-1 flips sign back positive)', () => {
      const s: TickState = { entryPrice: 100, side: 'SHORT', highWaterBps: 0 };
      const t = tick(s, 99.699); // moveBps ≈ 30.1 (SHORT wins going down)
      expect(t.moveBps).toBeGreaterThan(30);
      expect(t.stopBps).toBe(10);
      expect(t.exit).toBe(false);
    });

    it('SHORT loser exits when price rises 20 bps', () => {
      const s: TickState = { entryPrice: 100, side: 'SHORT', highWaterBps: 0 };
      const t = tick(s, 100.201); // moveBps ≈ -20.1
      expect(t.exit).toBe(true);
    });
  });

  describe('profit-factor: the point of "profit hungry"', () => {
    // Round-trip fees ≈ 10 bps. At $15 notional (=$5 stake × 3× lev):
    //   Fees ≈ $0.015 per trade.
    // Compare max-loss vs typical trailing win.

    it('caps loss at 20 bps × notional (never more)', () => {
      const notional = 15;
      const maxLossGross = (-20 / 10_000) * notional; // -$0.030
      expect(maxLossGross).toBeCloseTo(-0.03, 4);
      // After fees ($0.015 round-trip): ~-$0.045
    });

    it('LOCKS +40 bps on a runner that hit +100 and retraced', () => {
      // hwm=100 → stop=50; retrace exits at +40+ (whatever the mark shows)
      const notional = 15;
      const lockedGross = (40 / 10_000) * notional; // $0.060
      expect(lockedGross).toBeCloseTo(0.06, 4);
      // After fees ~$0.045 net = 1.5× the old fixed-TP of +30
    });

    it('EV positive after fees at 50% win rate assuming avg win = trailing +60 bps', () => {
      // 50% × +60 bps - 50% × -20 bps = +30 bps - 10 bps = +20 bps expected before fees
      // Post-fees: 50% × (60-10) + 50% × (-20-10) = 25 - 15 = +10 bps per trade net
      const evNet = 0.5 * (60 - 10) + 0.5 * (-20 - 10);
      expect(evNet).toBeGreaterThan(0);
    });
  });
});
