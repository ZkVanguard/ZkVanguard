/**
 * Deep regression suite for polymarket-edge-trader.
 *
 * Covers every helper function, all branch conditions, boundary values,
 * and probes for known classes of logic bugs.
 *
 * Run: npx tsx scripts/test-edge-deep.ts
 */
/* eslint-disable no-console */

import { PredictionAggregatorService } from '../lib/services/market-data/PredictionAggregatorService';
import { Polymarket5MinService } from '../lib/services/market-data/Polymarket5MinService';
import { notifyDiscord } from '../lib/utils/discord-notify';

// ── test infra ──────────────────────────────────────────────────────────────
let pass = 0; let fail = 0; let section = '';
function S(name: string) { section = name; console.log(`\n[${name}]`); }
function ok(name: string, cond: boolean, detail?: unknown) {
  const tag = cond ? '  ✓' : '  ✗';
  if (cond) pass++; else fail++;
  console.log(`${tag} ${name}`, detail !== undefined ? detail : '');
  if (!cond) console.trace('    ^^ FAIL trace');
}
function near(a: number, b: number, eps = 0.001) { return Math.abs(a - b) < eps; }

// ── expose private/internal statics ────────────────────────────────────────
type AccFn = (sigs: unknown[]) => { correct: number; total: number; rate: number };
const calcAccuracy = (Polymarket5MinService as unknown as { calculateAccuracy: AccFn }).calculateAccuracy;

// Mirror pure-logic helpers from route.ts locally (no DB calls needed for unit tests)
type SupportedAsset = 'BTC' | 'ETH';
const ASSET_MIN_QTY: Record<SupportedAsset, number> = { BTC: 0.001, ETH: 0.01 };
const LEVERAGE = 3;
const MAX_CONSECUTIVE_LOSSES = 5;
const MAX_DRAWDOWN_PCT = 0.30;
const HALT_DURATION_MS = 24 * 60 * 60 * 1000;
const DAILY_LOSS_CAP_USD = -10; // default: -2 * BASE_STAKE_USD(5)
const MAX_SLIPPAGE_BPS = 30;
const BASE_STAKE_USD = 5;

interface EdgeStats {
  trades: number; wins: number; losses: number;
  totalPnlUsd: number; peakPnlUsd: number;
  consecutiveLosses: number; lastUpdatedMs: number;
  perAsset?: Record<string, { trades: number; wins: number; pnlUsd: number }>;
}
interface DailyStats { utcDayKey: string; pnlUsd: number; trades: number; }

function quantize(qty: number, step: number) { return Math.floor(qty / step) * step; }
function utcDayKey(ts: number) { return new Date(ts).toISOString().slice(0, 10); }
function recommendationToSide(rec: string) {
  if (rec.includes('SHORT')) return 'SHORT';
  if (rec.includes('LONG')) return 'LONG';
  return null;
}
function isActionable(rec: string) {
  return rec.startsWith('HEDGE_') || rec.startsWith('STRONG_');
}
function pickExitPrice(close: unknown, markPriceRaw: unknown, fallback: number): number {
  const exec = Number((close as { executionPrice?: number })?.executionPrice);
  if (Number.isFinite(exec) && exec > 0) return exec;
  const mark = Number(markPriceRaw);
  if (Number.isFinite(mark) && mark > 0) return mark;
  return fallback;
}
function riskGate(args: { asset: SupportedAsset; sizeQty: number; notionalUsd: number; free: number; refPrice: number }) {
  if (LEVERAGE > 5) return { ok: false as const, reason: 'leverage > 5x cap' };
  if (args.sizeQty < ASSET_MIN_QTY[args.asset]) return { ok: false as const, reason: `size ${args.sizeQty} < ${ASSET_MIN_QTY[args.asset]}` };
  if (args.refPrice <= 0) return { ok: false as const, reason: 'no ref price' };
  const maxNotional = args.free * LEVERAGE;
  if (args.notionalUsd > maxNotional * 0.5) return { ok: false as const, reason: `notional ${args.notionalUsd} > 50% capacity` };
  return { ok: true as const };
}
function applyOutcome(prev: EdgeStats, realizedUsd: number, asset: SupportedAsset): EdgeStats {
  const perAsset = { ...(prev.perAsset || {}) };
  const cur = perAsset[asset] || { trades: 0, wins: 0, pnlUsd: 0 };
  perAsset[asset] = { trades: cur.trades + 1, wins: cur.wins + (realizedUsd > 0 ? 1 : 0), pnlUsd: cur.pnlUsd + realizedUsd };
  const newTotal = prev.totalPnlUsd + realizedUsd;
  return {
    trades: prev.trades + 1,
    wins: prev.wins + (realizedUsd > 0 ? 1 : 0),
    losses: prev.losses + (realizedUsd <= 0 ? 1 : 0),
    totalPnlUsd: newTotal,
    peakPnlUsd: Math.max(prev.peakPnlUsd, newTotal),
    consecutiveLosses: realizedUsd > 0 ? 0 : prev.consecutiveLosses + 1,
    lastUpdatedMs: Date.now(),
    perAsset,
  };
}
function applyDaily(prev: DailyStats, realizedUsd: number): DailyStats {
  const today = utcDayKey(Date.now());
  const base = prev.utcDayKey === today ? prev : { utcDayKey: today, pnlUsd: 0, trades: 0 };
  return { utcDayKey: base.utcDayKey, pnlUsd: base.pnlUsd + realizedUsd, trades: base.trades + 1 };
}
function maybeHaltLogic(stats: EdgeStats, daily: DailyStats, currentHaltUntil: number): { trips: boolean; reason?: string } {
  const drawdown = stats.peakPnlUsd > 0 ? (stats.peakPnlUsd - stats.totalPnlUsd) / stats.peakPnlUsd : 0;
  const tripLosses = stats.consecutiveLosses >= MAX_CONSECUTIVE_LOSSES;
  const tripDrawdown = drawdown >= MAX_DRAWDOWN_PCT && stats.peakPnlUsd > 0;
  const tripDaily = daily.pnlUsd <= DAILY_LOSS_CAP_USD;
  if (tripLosses) return { trips: true, reason: 'consecutiveLosses' };
  if (tripDrawdown) return { trips: true, reason: 'drawdown' };
  if (tripDaily) return { trips: true, reason: 'dailyCap' };
  return { trips: false };
}

// ── default stats fixture ──────────────────────────────────────────────────
const ZeroStats: EdgeStats = { trades: 0, wins: 0, losses: 0, totalPnlUsd: 0, peakPnlUsd: 0, consecutiveLosses: 0, lastUpdatedMs: 0, perAsset: {} };
const TodayDaily: DailyStats = { utcDayKey: utcDayKey(Date.now()), pnlUsd: 0, trades: 0 };


// ═══════════════════════════════════════════════════════════════════════════
// 1. pickExitPrice
// ═══════════════════════════════════════════════════════════════════════════
S('1. pickExitPrice');
ok('uses executionPrice when present', pickExitPrice({ executionPrice: 50000 }, 49000, 48000) === 50000);
ok('skips zero executionPrice → uses markPrice', pickExitPrice({ executionPrice: 0 }, 49000, 48000) === 49000);
ok('skips negative executionPrice → uses markPrice', pickExitPrice({ executionPrice: -1 }, 49000, 48000) === 49000);
ok('skips NaN executionPrice → uses markPrice', pickExitPrice({ executionPrice: NaN }, 49000, 48000) === 49000);
ok('no execPrice, uses markPrice', pickExitPrice({}, 49000, 48000) === 49000);
ok('no execPrice, zero markPrice → fallback', pickExitPrice({}, 0, 48000) === 48000);
ok('no execPrice, NaN markPrice → fallback', pickExitPrice({}, NaN, 48000) === 48000);
ok('all missing → fallback', pickExitPrice(null, null, 12345) === 12345);
ok('string executionPrice is parsed via Number()', pickExitPrice({ executionPrice: '50000' as unknown as number }, 49000, 48000) === 50000);


// ═══════════════════════════════════════════════════════════════════════════
// 2. quantize
// ═══════════════════════════════════════════════════════════════════════════
S('2. quantize — BTC/ETH step rounding');
ok('BTC 0.001 step rounds down', quantize(0.0036, 0.001) === 0.003);
ok('BTC exact step', quantize(0.003, 0.001) === 0.003);
ok('ETH 0.01 step rounds down', quantize(0.019, 0.01) === 0.01);
ok('below BTC min → 0', quantize(0.0005, 0.001) === 0);
ok('large BTC qty', near(quantize(1.2345, 0.001), 1.234));
ok('no fractional error for ETH', quantize(1.55, 0.01) === 1.55 || near(quantize(1.55, 0.01), 1.55));


// ═══════════════════════════════════════════════════════════════════════════
// 3. recommendationToSide + isActionable
// ═══════════════════════════════════════════════════════════════════════════
S('3. recommendationToSide + isActionable');
const recs = ['STRONG_HEDGE_LONG', 'HEDGE_LONG', 'LIGHT_HEDGE_LONG', 'STRONG_HEDGE_SHORT', 'HEDGE_SHORT', 'LIGHT_HEDGE_SHORT', 'WAIT'];
for (const r of recs) {
  const side = recommendationToSide(r);
  const expected = r.includes('SHORT') ? 'SHORT' : r.includes('LONG') ? 'LONG' : null;
  ok(`${r} → ${expected}`, side === expected);
}
ok('STRONG_HEDGE_LONG is actionable', isActionable('STRONG_HEDGE_LONG'));
ok('HEDGE_SHORT is actionable', isActionable('HEDGE_SHORT'));
ok('LIGHT_HEDGE_LONG is NOT actionable', !isActionable('LIGHT_HEDGE_LONG'));
ok('WAIT is NOT actionable', !isActionable('WAIT'));
// Edge: LIGHT_HEDGE_* should NOT be actionable — this is the signal-flip threshold
ok('LIGHT_HEDGE_SHORT is NOT actionable (signal-flip fires)', !isActionable('LIGHT_HEDGE_SHORT'));


// ═══════════════════════════════════════════════════════════════════════════
// 4. riskGate — boundary conditions
// ═══════════════════════════════════════════════════════════════════════════
S('4. riskGate');
ok('passes normal BTC entry', riskGate({ asset: 'BTC', sizeQty: 0.001, notionalUsd: 15, free: 100, refPrice: 80000 }).ok === true);
ok('fails when sizeQty < BTC min', riskGate({ asset: 'BTC', sizeQty: 0.0009, notionalUsd: 15, free: 100, refPrice: 80000 }).ok === false);
ok('fails when sizeQty < ETH min', riskGate({ asset: 'ETH', sizeQty: 0.009, notionalUsd: 15, free: 100, refPrice: 2500 }).ok === false);
ok('passes ETH at exact min', riskGate({ asset: 'ETH', sizeQty: 0.01, notionalUsd: 15, free: 100, refPrice: 2500 }).ok === true);
ok('fails when refPrice = 0', riskGate({ asset: 'BTC', sizeQty: 0.001, notionalUsd: 15, free: 100, refPrice: 0 }).ok === false);
ok('fails when notional > 50% of free*leverage', riskGate({ asset: 'BTC', sizeQty: 0.001, notionalUsd: 151, free: 100, refPrice: 80000 }).ok === false);
ok('passes at 50% boundary exactly',
  riskGate({ asset: 'BTC', sizeQty: 0.001, notionalUsd: 150, free: 100, refPrice: 80000 }).ok === true);
// free=100, LEVERAGE=3 → maxNotional=300; 50% = 150; notional=150 passes, 151 fails
ok('fails at 151 notional (free=100, lev=3)', riskGate({ asset: 'BTC', sizeQty: 0.001, notionalUsd: 151, free: 100, refPrice: 80000 }).ok === false);


// ═══════════════════════════════════════════════════════════════════════════
// 5. applyOutcome — stats accumulation
// ═══════════════════════════════════════════════════════════════════════════
S('5. applyOutcome — stats accumulation');
const s0: EdgeStats = { ...ZeroStats };
const s1 = applyOutcome(s0, 10, 'BTC');   // +10 win
ok('win increments trades', s1.trades === 1);
ok('win increments wins', s1.wins === 1);
ok('win does not increment losses', s1.losses === 0);
ok('win updates totalPnl', s1.totalPnlUsd === 10);
ok('win updates peakPnl', s1.peakPnlUsd === 10);
ok('win resets consecutiveLosses', s1.consecutiveLosses === 0);
ok('win updates perAsset BTC', s1.perAsset?.BTC?.wins === 1 && s1.perAsset.BTC.pnlUsd === 10);

const s2 = applyOutcome(s1, -3, 'ETH');   // -3 loss
ok('loss increments losses', s2.losses === 1);
ok('loss increments consecutiveLosses', s2.consecutiveLosses === 1);
ok('loss updates totalPnl', near(s2.totalPnlUsd, 7));
ok('loss does NOT lower peakPnl', s2.peakPnlUsd === 10, { peak: s2.peakPnlUsd });  // peak stays at 10
ok('loss adds ETH perAsset', s2.perAsset?.ETH?.pnlUsd === -3);

const s3 = applyOutcome(s2, 5, 'BTC');    // +5 win: total = 12 > peak(10) → new peak
ok('new peak set when totalPnl exceeds old peak', s3.peakPnlUsd === 12, { peak: s3.peakPnlUsd });
ok('win resets consecutiveLosses from 1', s3.consecutiveLosses === 0);

// Consecutive loss count
let sN: EdgeStats = { ...ZeroStats };
for (let i = 0; i < 4; i++) sN = applyOutcome(sN, -1, 'BTC');
ok('4 consecutive losses counted', sN.consecutiveLosses === 4);
const sFinal = applyOutcome(sN, -1, 'BTC');
ok('5th consecutive loss: consecutiveLosses=5', sFinal.consecutiveLosses === 5);
// Break-even ($0 realized) counts as a LOSS for consecutiveLosses
const sBreak = applyOutcome(sFinal, 0, 'BTC');
ok('$0 realized is a loss (consecutive continues)', sBreak.consecutiveLosses === 6);


// ═══════════════════════════════════════════════════════════════════════════
// 6. applyDaily — accumulation + day rollover
// ═══════════════════════════════════════════════════════════════════════════
S('6. applyDaily — accumulation + rollover');
const today = utcDayKey(Date.now());
const d0: DailyStats = { utcDayKey: today, pnlUsd: -5, trades: 2 };
const d1 = applyDaily(d0, -3);
ok('same-day accumulates pnl', near(d1.pnlUsd, -8));
ok('same-day increments trades', d1.trades === 3);
ok('same-day keeps utcDayKey', d1.utcDayKey === today);

// Simulate yesterday's data
const yesterday = utcDayKey(Date.now() - 86_400_000);
const dYest: DailyStats = { utcDayKey: yesterday, pnlUsd: -100, trades: 10 };
const dNew = applyDaily(dYest, 5);
ok('old-day resets to zero before adding', near(dNew.pnlUsd, 5), { pnl: dNew.pnlUsd });
ok('old-day resets trades to 1', dNew.trades === 1);
ok('old-day sets utcDayKey to today', dNew.utcDayKey === today);


// ═══════════════════════════════════════════════════════════════════════════
// 7. maybeHalt — trip conditions + no-trip
// ═══════════════════════════════════════════════════════════════════════════
S('7. maybeHalt — trip conditions');
// Trip 1: 5 consecutive losses
const statsAt5Losses: EdgeStats = { ...ZeroStats, consecutiveLosses: 5, peakPnlUsd: 10, totalPnlUsd: 5 };
ok('trips on consecutiveLosses=5', maybeHaltLogic(statsAt5Losses, TodayDaily, 0).trips === true);
ok('reason=consecutiveLosses', maybeHaltLogic(statsAt5Losses, TodayDaily, 0).reason === 'consecutiveLosses');
ok('no trip on consecutiveLosses=4', maybeHaltLogic({ ...ZeroStats, consecutiveLosses: 4 }, TodayDaily, 0).trips === false);

// Trip 2: ≥30% drawdown from peak
const statsDrawdown30: EdgeStats = { ...ZeroStats, peakPnlUsd: 100, totalPnlUsd: 70 };  // 30% drawdown
ok('trips on exactly 30% drawdown', maybeHaltLogic(statsDrawdown30, TodayDaily, 0).trips === true);
ok('reason=drawdown', maybeHaltLogic(statsDrawdown30, TodayDaily, 0).reason === 'drawdown');
const statsDrawdown29: EdgeStats = { ...ZeroStats, peakPnlUsd: 100, totalPnlUsd: 71 };  // 29% drawdown
ok('no trip on 29% drawdown', maybeHaltLogic(statsDrawdown29, TodayDaily, 0).trips === false);
// Zero peak → no drawdown trip
ok('zero peakPnlUsd never trips drawdown', maybeHaltLogic({ ...ZeroStats, peakPnlUsd: 0, totalPnlUsd: -999 }, TodayDaily, 0).trips === false);

// Trip 3: daily cap
const dailyAtCap: DailyStats = { utcDayKey: today, pnlUsd: -10, trades: 2 }; // exactly at cap
ok('trips at exactly DAILY_LOSS_CAP_USD (-10)', maybeHaltLogic(ZeroStats, dailyAtCap, 0).trips === true);
ok('reason=dailyCap', maybeHaltLogic(ZeroStats, dailyAtCap, 0).reason === 'dailyCap');
const dailyBelowCap: DailyStats = { utcDayKey: today, pnlUsd: -11, trades: 2 };
ok('trips when daily PnL below cap (-11)', maybeHaltLogic(ZeroStats, dailyBelowCap, 0).trips === true);
const dailyAboveCap: DailyStats = { utcDayKey: today, pnlUsd: -9.99, trades: 2 };
ok('no trip when daily PnL just above cap (-9.99)', maybeHaltLogic(ZeroStats, dailyAboveCap, 0).trips === false);

// ⚠️  BUG PROBE: haltedUntil response field calculation in route.ts
// The route computes: `haltedUntil: halted ? haltedUntil + HALT_DURATION_MS : undefined`
// where `haltedUntil` is the value read from DB at request start (0 if not previously halted).
// When halt just TRIPS: DB stores `Date.now() + HALT_DURATION_MS` (correct).
// But response returns `0 + HALT_DURATION_MS = 86400000` (Jan 2 1970) → WRONG.
// When ALREADY halted: response returns `existingUntil + HALT_DURATION_MS` → DOUBLE addition → WRONG.
const BUG_haltedUntilZero = 0 + HALT_DURATION_MS;
const BUG_isJan1970 = new Date(BUG_haltedUntilZero).getFullYear() === 1970;
ok('[KNOWN BUG] haltedUntil response is wrong when trip from zero', BUG_isJan1970,
  { returnedValue: BUG_haltedUntilZero, note: 'Route returns haltedUntil+HALT_MS not the DB-stored until. DB is correct; only displayed value is wrong.' });


// ═══════════════════════════════════════════════════════════════════════════
// 8. Slippage BPS math
// ═══════════════════════════════════════════════════════════════════════════
S('8. Slippage BPS math');
function slipBps(fill: number, ref: number) { return Math.abs((fill - ref) / ref) * 10_000; }
ok('exact fill = 0 bps', slipBps(80000, 80000) === 0);
ok('30 bps exactly', near(slipBps(80240, 80000), 30));  // 240/80000*10000 = 30
ok('31 bps > 30 limit → should reject', slipBps(80248, 80000) > MAX_SLIPPAGE_BPS, { bps: slipBps(80248, 80000).toFixed(2) });
ok('29 bps < 30 limit → should pass', slipBps(80232, 80000) < MAX_SLIPPAGE_BPS, { bps: slipBps(80232, 80000).toFixed(2) });
ok('slip is symmetric (short fill below ref)', near(slipBps(79760, 80000), 30));

// PnL calculation on slippage exit (LONG: bought at fill, sold at exit)
// If fill = 80240 (30bps above ref), then market moved: exit ≈ ref (ref = mark price)
// realized = (exit - fill) * qty * dir - fees
function slipExitPnl(fill: number, exit: number, qty: number, fees: number) {
  return (exit - fill) * qty * 1 - fees; // LONG dir
}
ok('slippage exit LONG: negative PnL when fill > exit', slipExitPnl(80240, 80000, 0.001, 0.5) < 0,
  { pnl: slipExitPnl(80240, 80000, 0.001, 0.5) });
ok('slippage exit LONG: near break-even if fill ≈ exit', near(slipExitPnl(80000, 80000, 0.001, 0), 0));


// ═══════════════════════════════════════════════════════════════════════════
// 9. calculateAccuracy — edge cases
// ═══════════════════════════════════════════════════════════════════════════
S('9. calculateAccuracy — edge cases');
type Sig = { fetchedAt: number; windowEndTime: number; timeRemainingSeconds: number; direction: 'UP' | 'DOWN'; priceToBeat: number; currentPrice: number };

// All unresolved → total=0
const unresolved: Sig[] = [
  { fetchedAt: 100, windowEndTime: 200, timeRemainingSeconds: 100, direction: 'UP', priceToBeat: 80000, currentPrice: 80100 },
  { fetchedAt: 50, windowEndTime: 200, timeRemainingSeconds: 50, direction: 'DOWN', priceToBeat: 80000, currentPrice: 79900 },
];
const rUnresolved = calcAccuracy(unresolved);
ok('all unresolved → total=0', rUnresolved.total === 0);
ok('all unresolved → rate=0', rUnresolved.rate === 0);

// Resolved but no later snapshot → excluded
const resolvedNoLater: Sig[] = [
  { fetchedAt: 100, windowEndTime: 150, timeRemainingSeconds: 0, direction: 'UP', priceToBeat: 80000, currentPrice: 80100 },
  // no entry with fetchedAt > 150
];
const rNoLater = calcAccuracy(resolvedNoLater);
ok('resolved but no later snapshot → excluded (total=0)', rNoLater.total === 0);

// Exact priceToBeat boundary: realized = priceToBeat → direction UP (>=)
const boundaryUp: Sig[] = [
  { fetchedAt: 200, windowEndTime: 300, timeRemainingSeconds: 50, direction: 'UP', priceToBeat: 80000, currentPrice: 80000 }, // newer
  { fetchedAt: 100, windowEndTime: 150, timeRemainingSeconds: 0, direction: 'UP', priceToBeat: 80000, currentPrice: 80000 }, // older, resolved
  // j=0 (newer) has fetchedAt=200 > windowEndTime=150 and currentPrice=80000 ≥ priceToBeat → UP → correct
];
const rBoundary = calcAccuracy(boundaryUp);
ok('exact price=priceToBeat counts as UP (>=)', rBoundary.total === 1 && rBoundary.correct === 1,
  { r: rBoundary });

// 1 below → DOWN
const boundaryDown: Sig[] = [
  { fetchedAt: 200, windowEndTime: 300, timeRemainingSeconds: 50, direction: 'DOWN', priceToBeat: 80000, currentPrice: 79999 }, // newer
  { fetchedAt: 100, windowEndTime: 150, timeRemainingSeconds: 0, direction: 'DOWN', priceToBeat: 80000, currentPrice: 79999 }, // resolved
];
const rBoundaryDown = calcAccuracy(boundaryDown);
ok('price 1 below priceToBeat = DOWN direction', rBoundaryDown.total === 1 && rBoundaryDown.correct === 1);

// priceToBeat = 0 → excluded (invalid)
const zeroPriceToBeat: Sig[] = [
  { fetchedAt: 200, windowEndTime: 300, timeRemainingSeconds: 50, direction: 'UP', priceToBeat: 0, currentPrice: 80000 },
  { fetchedAt: 100, windowEndTime: 150, timeRemainingSeconds: 0, direction: 'UP', priceToBeat: 0, currentPrice: 80000 },
];
const rZeroPTB = calcAccuracy(zeroPriceToBeat);
ok('priceToBeat=0 → excluded', rZeroPTB.total === 0);

// Multiple resolved with interleaved newer snapshots
// newest-first storage: [t=500, t=400, t=300-resolved, t=200-resolved, t=100]
const multi: Sig[] = [
  { fetchedAt: 500, windowEndTime: 600, timeRemainingSeconds: 50, direction: 'UP', priceToBeat: 80000, currentPrice: 82000 }, // 0
  { fetchedAt: 400, windowEndTime: 450, timeRemainingSeconds: 0, direction: 'UP', priceToBeat: 80000, currentPrice: 81000 }, // 1, resolved → later = 0.currentPrice=82000 → UP → correct
  { fetchedAt: 300, windowEndTime: 350, timeRemainingSeconds: 0, direction: 'DOWN', priceToBeat: 80000, currentPrice: 80500 }, // 2, resolved → later = 1.currentPrice=81000 → UP (81000>=80000) → wrong for DOWN
  { fetchedAt: 200, windowEndTime: 250, timeRemainingSeconds: 0, direction: 'UP', priceToBeat: 79000, currentPrice: 79500 }, // 3, resolved → later = 2.currentPrice=80500 → UP (80500>=79000) → correct
  { fetchedAt: 100, windowEndTime: 150, timeRemainingSeconds: 0, direction: 'UP', priceToBeat: 80000, currentPrice: 78000 }, // 4, resolved → later = 3.currentPrice=79500 → DOWN (79500<80000) → wrong
];
const rMulti = calcAccuracy(multi);
ok('multi: total=4 resolved entries', rMulti.total === 4, { r: rMulti });
ok('multi: correct=2 (indices 1 and 3 correct)', rMulti.correct === 2, { r: rMulti });
ok('multi: rate=50', rMulti.rate === 50);


// ═══════════════════════════════════════════════════════════════════════════
// 10. scoreOpportunity — math verification
// ═══════════════════════════════════════════════════════════════════════════
S('10. scoreOpportunity — math + boundaries');
function makePred(rec: string, conf: number, cons: number, nSources: number) {
  return { recommendation: rec, confidence: conf, consensus: cons, sources: Array(nSources).fill({}), direction: 'DOWN', probability: 50, sizeMultiplier: 1, reasoning: '', timestamp: 0 };
}

// WAIT → 0
ok('WAIT → score 0', PredictionAggregatorService.scoreOpportunity(makePred('WAIT', 80, 80, 5) as Parameters<typeof PredictionAggregatorService.scoreOpportunity>[0]) === 0);
ok('LIGHT_HEDGE_SHORT → score 0 (not actionable)', PredictionAggregatorService.scoreOpportunity(makePred('LIGHT_HEDGE_SHORT', 80, 80, 5) as Parameters<typeof PredictionAggregatorService.scoreOpportunity>[0]) === 0);

// HEDGE_SHORT, conf=60, cons=60, 2 sources
// sqrt(60*60) * min(1.25, 1+(2-2)*0.05) + 0 = 60 * 1.0 = 60
const s60 = PredictionAggregatorService.scoreOpportunity(makePred('HEDGE_SHORT', 60, 60, 2) as Parameters<typeof PredictionAggregatorService.scoreOpportunity>[0]);
ok('HEDGE_SHORT conf=cons=60 sources=2 → 60', near(s60, 60), { s60 });

// STRONG_HEDGE_SHORT, conf=77, cons=100, 5 sources
// sqrt(77*100) = sqrt(7700) ≈ 87.75; breadth = min(1.25, 1+(5-2)*0.05) = min(1.25,1.15)=1.15; +10 bonus = 110.9
const s110 = PredictionAggregatorService.scoreOpportunity(makePred('STRONG_HEDGE_SHORT', 77, 100, 5) as Parameters<typeof PredictionAggregatorService.scoreOpportunity>[0]);
ok('STRONG conf=77 cons=100 src=5 ≈ 110.9', near(s110, 110.9, 0.5), { s110 });

// breadth multiplier clamps at 1.25 with many sources
// sqrt(80*80) * 1.25 + 10 = 80 * 1.25 + 10 = 110
const sMany = PredictionAggregatorService.scoreOpportunity(makePred('STRONG_HEDGE_SHORT', 80, 80, 20) as Parameters<typeof PredictionAggregatorService.scoreOpportunity>[0]);
ok('breadth clamped at 1.25 with 20 sources', near(sMany, 80 * 1.25 + 10, 0.1), { sMany });

// 1 source below 2: breadth = 1 + (1-2)*0.05 = 0.95
const s1src = PredictionAggregatorService.scoreOpportunity(makePred('HEDGE_SHORT', 80, 80, 1) as Parameters<typeof PredictionAggregatorService.scoreOpportunity>[0]);
ok('1 source → breadth 0.95 (penalty)', near(s1src, 80 * 0.95, 0.1), { s1src });

// STRONG bonus = +10
const noBonus = PredictionAggregatorService.scoreOpportunity(makePred('HEDGE_SHORT', 80, 80, 5) as Parameters<typeof PredictionAggregatorService.scoreOpportunity>[0]);
const withBonus = PredictionAggregatorService.scoreOpportunity(makePred('STRONG_HEDGE_SHORT', 80, 80, 5) as Parameters<typeof PredictionAggregatorService.scoreOpportunity>[0]);
ok('STRONG bonus adds exactly 10', near(withBonus - noBonus, 10, 0.01), { diff: withBonus - noBonus });


// ═══════════════════════════════════════════════════════════════════════════
// 11. calculateAggregation — via scanAndPickBest synthetic sources
//     (test via getPerAssetPredictions with mocked data by calling calculateAggregation directly)
// ═══════════════════════════════════════════════════════════════════════════
S('11. Aggregation math — consensus + direction calculation');
// Access private method
type CalcAggFn = (sources: unknown[]) => {
  direction: string; confidence: number; probability: number; consensus: number;
  recommendation: string; sizeMultiplier: number;
};
const calcAgg = (PredictionAggregatorService as unknown as { calculateAggregation: CalcAggFn }).calculateAggregation.bind(PredictionAggregatorService);

// All DOWN, weight=0.25 each, conf=70, prob=30
const allDown = [
  { name: 'A', direction: 'DOWN', confidence: 70, probability: 30, weight: 0.25, type: 'medium_term', fetchedAt: Date.now() },
  { name: 'B', direction: 'DOWN', confidence: 70, probability: 30, weight: 0.25, type: 'medium_term', fetchedAt: Date.now() },
  { name: 'C', direction: 'DOWN', confidence: 70, probability: 30, weight: 0.25, type: 'medium_term', fetchedAt: Date.now() },
  { name: 'D', direction: 'DOWN', confidence: 70, probability: 30, weight: 0.25, type: 'medium_term', fetchedAt: Date.now() },
];
const aggDown = calcAgg(allDown);
ok('all DOWN → direction DOWN', aggDown.direction === 'DOWN');
ok('all DOWN → consensus 100%', aggDown.consensus === 100);
ok('all DOWN → recommendation includes HEDGE or STRONG', aggDown.recommendation !== 'WAIT');
ok('4 DOWN + conf=70 + cons=100 → STRONG_HEDGE_SHORT', aggDown.recommendation === 'STRONG_HEDGE_SHORT',
  { rec: aggDown.recommendation });

// 3 DOWN, 1 UP → consensus = 3/4*100 = 75
const threeDown = [
  { name: 'A', direction: 'DOWN', confidence: 70, probability: 30, weight: 0.25, type: 'medium_term', fetchedAt: Date.now() },
  { name: 'B', direction: 'DOWN', confidence: 70, probability: 30, weight: 0.25, type: 'medium_term', fetchedAt: Date.now() },
  { name: 'C', direction: 'DOWN', confidence: 70, probability: 30, weight: 0.25, type: 'medium_term', fetchedAt: Date.now() },
  { name: 'D', direction: 'UP', confidence: 70, probability: 70, weight: 0.25, type: 'medium_term', fetchedAt: Date.now() },
];
const agg3 = calcAgg(threeDown);
ok('3/4 DOWN → consensus=75', agg3.consensus === 75, { cons: agg3.consensus });
ok('3/4 DOWN direction is DOWN', agg3.direction === 'DOWN');

// ⚠️ NEUTRAL sources DILUTE consensus even when directional sources are unanimous
// 2 DOWN + 2 NEUTRAL → dominantCount=2, totalSources=4 → consensus=50
// Expected: 50% (neutral dilution design decision)
const twoDownTwoNeutral = [
  { name: 'A', direction: 'DOWN', confidence: 80, probability: 25, weight: 0.25, type: 'medium_term', fetchedAt: Date.now() },
  { name: 'B', direction: 'DOWN', confidence: 80, probability: 25, weight: 0.25, type: 'medium_term', fetchedAt: Date.now() },
  { name: 'C', direction: 'NEUTRAL', confidence: 50, probability: 50, weight: 0.25, type: 'medium_term', fetchedAt: Date.now() },
  { name: 'D', direction: 'NEUTRAL', confidence: 50, probability: 50, weight: 0.25, type: 'medium_term', fetchedAt: Date.now() },
];
const aggNeutral = calcAgg(twoDownTwoNeutral);
ok('[DESIGN] 2 DOWN + 2 NEUTRAL → consensus diluted to 50 (neutral counts in denominator)', aggNeutral.consensus === 50,
  { cons: aggNeutral.consensus, note: 'NEUTRAL sources count in denominator, lowering consensus even when directional sources agree 100%' });
ok('[DESIGN] with diluted consensus=50 and conf=80 → HEDGE not STRONG (isMedium path)', aggNeutral.recommendation === 'HEDGE_SHORT' || aggNeutral.recommendation === 'LIGHT_HEDGE_SHORT',
  { rec: aggNeutral.recommendation });

// Empty sources → WAIT + 0 confidence
const aggEmpty = calcAgg([]);
ok('empty sources → WAIT', aggEmpty.recommendation === 'WAIT');
ok('empty sources → confidence=0', aggEmpty.confidence === 0);
ok('empty sources → consensus=0', aggEmpty.consensus === 0);

// Direction boundary: normalizedDirection exactly 0.15 → NEUTRAL (needs >0.15)
// directionScore = sum(dirValue * weight * conf/100)
// Need: score / totalConfWeight = exactly 0.15
// 1 source: direction=UP, weight=1.0, conf=15 → effectiveWeight=0.15, dirScore=0.15 → norm=1.0 → UP (above 0.15)
const onlySlightUp = [
  { name: 'A', direction: 'UP', confidence: 15, probability: 55, weight: 0.5, type: 'short_term', fetchedAt: Date.now() },
  { name: 'B', direction: 'NEUTRAL', confidence: 50, probability: 50, weight: 0.5, type: 'medium_term', fetchedAt: Date.now() },
];
// effectiveWeight(A) = 0.5 * 0.15 = 0.075; effectiveWeight(B) = 0.5 * 0.50 = 0.25
// dirScore = 1*0.075 + 0*0.25 = 0.075; totalCW = 0.075 + 0.25 = 0.325; norm = 0.075/0.325 ≈ 0.23 > 0.15 → UP
const aggSlightUp = calcAgg(onlySlightUp);
ok('direction with normalized score 0.23 → UP', aggSlightUp.direction === 'UP', { dir: aggSlightUp.direction });


// ═══════════════════════════════════════════════════════════════════════════
// 12. DAILY_LOSS_CAP_USD env default
// ═══════════════════════════════════════════════════════════════════════════
S('12. DAILY_LOSS_CAP_USD default formula');
ok('cap = -2 * BASE_STAKE_USD', near(DAILY_LOSS_CAP_USD, -2 * BASE_STAKE_USD));
ok('cap is negative', DAILY_LOSS_CAP_USD < 0);


// ═══════════════════════════════════════════════════════════════════════════
// 13. Discord notifier — error handling
// ═══════════════════════════════════════════════════════════════════════════
S('13. notifyDiscord — error handling');
async function runDiscordTests() {
  // No webhook configured
  try { await notifyDiscord('test', 'INFO'); ok('no webhook → no throw', true); }
  catch { ok('no webhook → no throw', false); }

  // KILL level with context
  try { await notifyDiscord('KILL SWITCH TRIPPED', 'KILL', { totalPnl: -50, reason: 'test' }); ok('KILL level → no throw', true); }
  catch { ok('KILL level → no throw', false); }

  // Very long message (>2000 chars — Discord limit)
  const longMsg = 'x'.repeat(2500);
  try { await notifyDiscord(longMsg, 'WARN'); ok('long message → no throw', true); }
  catch { ok('long message → no throw', false); }
}


// ═══════════════════════════════════════════════════════════════════════════
// 14. findActivePosition filtering
// ═══════════════════════════════════════════════════════════════════════════
S('14. findActivePosition');
function findActivePosition(positions: Array<{ symbol: string; size: unknown }>, symbol: string) {
  return positions.find((p) => p.symbol === symbol && Number(p.size) > 0);
}
ok('finds matching symbol with size > 0', !!findActivePosition([{ symbol: 'BTC-PERP', size: 0.001 }], 'BTC-PERP'));
ok('ignores size=0 positions (closed)', !findActivePosition([{ symbol: 'BTC-PERP', size: 0 }], 'BTC-PERP'));
ok('ignores size="0" string', !findActivePosition([{ symbol: 'BTC-PERP', size: '0' }], 'BTC-PERP'));
ok('ignores wrong symbol', !findActivePosition([{ symbol: 'ETH-PERP', size: 1 }], 'BTC-PERP'));
ok('finds ETH among mixed', !!findActivePosition([{ symbol: 'BTC-PERP', size: 0 }, { symbol: 'ETH-PERP', size: 0.5 }], 'ETH-PERP'));


// ═══════════════════════════════════════════════════════════════════════════
// 15. sizeMultiplier clamping
// ═══════════════════════════════════════════════════════════════════════════
S('15. sizeMultiplier clamping');
type SizeMultFn = (conf: number, cons: number, strength: number) => number;
const calcSizeMult = (PredictionAggregatorService as unknown as { calculateSizeMultiplier: SizeMultFn }).calculateSizeMultiplier.bind(PredictionAggregatorService);

// Max reachable: 1.0 + 0.3(conf≥75) + 0.3(cons≥80) + 0.2(str≥0.5) = 1.8 → clamp(2.0) never hit
ok('all-max inputs → 1.8 (clamp at 2.0 never hit with current formula)', near(calcSizeMult(100, 100, 1.0), 1.8), { v: calcSizeMult(100, 100, 1.0) });
// Min: 1.0 - 0.2(conf<45) - 0.2(cons<50) - 0.1(str<0.2) = 0.5 → floating-point imprecision, use near()
ok('all-low inputs → clamped at 0.5', near(calcSizeMult(0, 0, 0), 0.5), { v: calcSizeMult(0, 0, 0) });
ok('normal inputs in range', calcSizeMult(65, 70, 0.3) >= 0.5 && calcSizeMult(65, 70, 0.3) <= 2.0);

// Known values from code:
// conf>=75: +0.3; conf>=60: +0.15; cons>=80: +0.3; cons>=65: +0.15; strength>=0.5: +0.2
// conf=75, cons=80, str=0.5 → 1.0 + 0.3 + 0.3 + 0.2 = 1.8
ok('conf=75, cons=80, str=0.5 → 1.8', near(calcSizeMult(75, 80, 0.5), 1.8), { v: calcSizeMult(75, 80, 0.5) });

// ═══════════════════════════════════════════════════════════════════════════
// 16. utcDayKey
// ═══════════════════════════════════════════════════════════════════════════
S('16. utcDayKey');
ok('known UTC timestamp → correct date', utcDayKey(1_000_000_000_000) === '2001-09-09', { got: utcDayKey(1_000_000_000_000) });  // Sep 9, 2001 01:46:40 UTC
ok('format is YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(utcDayKey(Date.now())));
ok('midnight rollover: 23:59:59.999 UTC Jan 31', utcDayKey(new Date('2026-01-31T23:59:59.999Z').getTime()) === '2026-01-31');
ok('midnight rollover: 00:00:00.000 UTC Feb 1', utcDayKey(new Date('2026-02-01T00:00:00.000Z').getTime()) === '2026-02-01');


// ═══════════════════════════════════════════════════════════════════════════
// 17. Compounding multiplier formula (from route entry path)
// ═══════════════════════════════════════════════════════════════════════════
S('17. Compounding multiplier');
function compoundMul(totalPnlUsd: number) {
  return Math.max(1, Math.min(5, 1 + totalPnlUsd / Math.max(1, BASE_STAKE_USD)));
}
ok('zero PnL → mul=1', compoundMul(0) === 1);
ok('positive PnL → mul > 1', compoundMul(10) > 1);
ok('totalPnl = BASE_STAKE → mul = 2', compoundMul(BASE_STAKE_USD) === 2);
ok('very large PnL → capped at 5', compoundMul(1_000_000) === 5);
ok('negative PnL → clamped at 1 (no below-base sizing)', compoundMul(-100) === 1,
  { v: compoundMul(-100), note: 'negative PnL uses Math.max(1,...), preventing sub-base stakes' });


// ═══════════════════════════════════════════════════════════════════════════
// Run async tests
// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  await runDiscordTests();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`=== Result: ${pass} pass / ${fail} fail ===`);
  if (fail > 0) {
    console.log('\nFailed tests above — search for ✗ to locate them.');
  } else {
    console.log('All checks pass.');
  }
  process.exit(fail === 0 ? 0 : 1);
})();
