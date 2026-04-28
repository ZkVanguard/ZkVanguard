/**
 * Signal Outcomes Tracker
 *
 * Persists every Polymarket 5-min BTC signal we observed alongside its
 * realised outcome (from on-chain price feeds) so we can compute true
 * win-rate after the window resolves.
 *
 * Why this exists:
 *   The current `Polymarket5MinService.calculateAccuracy()` counts
 *   "signals with confidence > 60%" as accurate WITHOUT comparing to
 *   the actual BTC move. That is meaningless. This module records the
 *   ground truth so we can validate (or falsify) the signal as alpha.
 *
 * Lifecycle:
 *   1. `recordSignal(...)` — called when cron observes a fresh 5-min signal
 *      (status = 'pending', outcome columns null).
 *   2. `resolveOutcome(...)` — called for any pending signal whose window
 *      has closed. Fetches reference BTC price at window end, marks UP/DOWN,
 *      computes correct/incorrect.
 *   3. `getStats(windowDays)` — aggregates win-rate, expected-value, etc.
 *
 * Tracking only — does NOT make trade decisions. Use `getStats()` results
 * to decide whether to keep `HEDGE_REQUIRE_PREDICTION_SIGNAL=true`.
 */

import { query, queryOne } from '@/lib/db/postgres';
import { logger } from '@/lib/utils/logger';

let tableReady = false;

export async function ensureSignalOutcomesTable(): Promise<void> {
  if (tableReady) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS signal_outcomes (
        id SERIAL PRIMARY KEY,
        source VARCHAR(64) NOT NULL,
        market_id VARCHAR(255),
        window_end_time BIGINT NOT NULL,
        observed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        direction VARCHAR(8) NOT NULL,
        probability DECIMAL(8, 6) NOT NULL,
        confidence DECIMAL(8, 4),
        signal_strength VARCHAR(16),
        volume DECIMAL(20, 2),
        liquidity DECIMAL(20, 2),
        entry_price DECIMAL(20, 6),
        exit_price DECIMAL(20, 6),
        actual_direction VARCHAR(8),
        correct BOOLEAN,
        resolved_at TIMESTAMP,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        notes TEXT,
        UNIQUE(source, window_end_time)
      );
      CREATE INDEX IF NOT EXISTS idx_signal_outcomes_status ON signal_outcomes(status);
      CREATE INDEX IF NOT EXISTS idx_signal_outcomes_window ON signal_outcomes(window_end_time);
    `);
    tableReady = true;
  } catch (err) {
    logger.warn('[SignalOutcomes] ensureTable failed', { error: err instanceof Error ? err.message : err });
    tableReady = true; // avoid retry storm
  }
}

export interface RecordSignalArgs {
  source: string;          // e.g. 'polymarket-5min'
  marketId?: string;
  windowEndTime: number;   // ms epoch when this prediction window resolves
  direction: 'UP' | 'DOWN';
  probability: number;     // 0..1
  confidence?: number;     // 0..100
  signalStrength?: 'STRONG' | 'MODERATE' | 'WEAK';
  volume?: number;
  liquidity?: number;
  entryPrice?: number;     // BTC price observed when signal was recorded
}

/** Record a new signal observation. No-op if (source, windowEndTime) already exists. */
export async function recordSignal(args: RecordSignalArgs): Promise<void> {
  await ensureSignalOutcomesTable();
  try {
    await query(
      `INSERT INTO signal_outcomes
        (source, market_id, window_end_time, direction, probability,
         confidence, signal_strength, volume, liquidity, entry_price, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       ON CONFLICT (source, window_end_time) DO NOTHING`,
      [
        args.source,
        args.marketId ?? null,
        args.windowEndTime,
        args.direction,
        args.probability,
        args.confidence ?? null,
        args.signalStrength ?? null,
        args.volume ?? null,
        args.liquidity ?? null,
        args.entryPrice ?? null,
      ],
    );
  } catch (err) {
    logger.warn('[SignalOutcomes] recordSignal failed', { error: err instanceof Error ? err.message : err });
  }
}

/**
 * Resolve all pending signals whose windows have already closed.
 * Reads the asset price from the validated price provider as ground truth.
 *
 * `priceFetcher` lets the caller inject the price source (so we don't pin
 * an import at module load — the cron passes its own).
 */
export async function resolveExpiredSignals(
  asset: string,
  priceFetcher: () => Promise<number>,
  options: { maxBatch?: number } = {},
): Promise<{ resolved: number; correct: number; incorrect: number }> {
  await ensureSignalOutcomesTable();
  const maxBatch = options.maxBatch ?? 32;
  const now = Date.now();

  let pending: Array<{
    id: number;
    direction: 'UP' | 'DOWN';
    entry_price: number | null;
    window_end_time: string | number;
  }> = [];

  try {
    pending = await query(
      `SELECT id, direction, entry_price, window_end_time
       FROM signal_outcomes
       WHERE status = 'pending' AND window_end_time <= $1
       ORDER BY window_end_time ASC
       LIMIT $2`,
      [now, maxBatch],
    );
  } catch (err) {
    logger.warn('[SignalOutcomes] resolveExpired query failed', { error: err instanceof Error ? err.message : err });
    return { resolved: 0, correct: 0, incorrect: 0 };
  }

  if (pending.length === 0) return { resolved: 0, correct: 0, incorrect: 0 };

  let exitPrice = 0;
  try {
    exitPrice = await priceFetcher();
  } catch (err) {
    logger.warn('[SignalOutcomes] price fetch failed — leaving signals pending', {
      asset,
      error: err instanceof Error ? err.message : err,
    });
    return { resolved: 0, correct: 0, incorrect: 0 };
  }
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    return { resolved: 0, correct: 0, incorrect: 0 };
  }

  let correct = 0;
  let incorrect = 0;

  for (const row of pending) {
    const entry = Number(row.entry_price ?? 0);
    if (!Number.isFinite(entry) || entry <= 0) {
      // Cannot judge without entry — mark as void.
      try {
        await query(
          `UPDATE signal_outcomes SET status = 'void', resolved_at = CURRENT_TIMESTAMP,
           exit_price = $1, notes = 'no entry_price recorded' WHERE id = $2`,
          [exitPrice, row.id],
        );
      } catch { /* ignore */ }
      continue;
    }
    const actualDir: 'UP' | 'DOWN' = exitPrice >= entry ? 'UP' : 'DOWN';
    const isCorrect = actualDir === row.direction;
    if (isCorrect) correct++; else incorrect++;
    try {
      await query(
        `UPDATE signal_outcomes
         SET status = 'resolved', actual_direction = $1, exit_price = $2,
             correct = $3, resolved_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [actualDir, exitPrice, isCorrect, row.id],
      );
    } catch (err) {
      logger.warn('[SignalOutcomes] resolve update failed', { id: row.id, error: err instanceof Error ? err.message : err });
    }
  }

  return { resolved: correct + incorrect, correct, incorrect };
}

export interface SignalStats {
  total: number;
  resolved: number;
  pending: number;
  correct: number;
  incorrect: number;
  winRate: number;          // correct / resolved (0..1)
  avgConfidence: number;
  byStrength: Record<string, { resolved: number; correct: number; winRate: number }>;
}

export async function getSignalStats(windowDays = 7, source = 'polymarket-5min'): Promise<SignalStats> {
  await ensureSignalOutcomesTable();
  const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  try {
    const all = await query<{
      status: string;
      correct: boolean | null;
      confidence: string | null;
      signal_strength: string | null;
    }>(
      `SELECT status, correct, confidence, signal_strength
       FROM signal_outcomes
       WHERE source = $1 AND window_end_time >= $2`,
      [source, sinceMs],
    );

    const total = all.length;
    const resolved = all.filter(r => r.status === 'resolved').length;
    const pending = all.filter(r => r.status === 'pending').length;
    const correct = all.filter(r => r.correct === true).length;
    const incorrect = all.filter(r => r.correct === false).length;
    const winRate = resolved > 0 ? correct / resolved : 0;

    const confSum = all.reduce((acc, r) => acc + (r.confidence ? Number(r.confidence) : 0), 0);
    const avgConfidence = total > 0 ? confSum / total : 0;

    const byStrength: SignalStats['byStrength'] = {};
    for (const r of all) {
      if (r.status !== 'resolved' || !r.signal_strength) continue;
      const k = r.signal_strength;
      byStrength[k] ??= { resolved: 0, correct: 0, winRate: 0 };
      byStrength[k].resolved++;
      if (r.correct === true) byStrength[k].correct++;
    }
    for (const k of Object.keys(byStrength)) {
      const b = byStrength[k];
      b.winRate = b.resolved > 0 ? b.correct / b.resolved : 0;
    }

    return { total, resolved, pending, correct, incorrect, winRate, avgConfidence, byStrength };
  } catch (err) {
    logger.warn('[SignalOutcomes] getSignalStats failed', { error: err instanceof Error ? err.message : err });
    return { total: 0, resolved: 0, pending: 0, correct: 0, incorrect: 0, winRate: 0, avgConfidence: 0, byStrength: {} };
  }
}

/** Helper for cron: fetch BTC price for resolution. */
export async function fetchBtcExitPrice(): Promise<number> {
  const { getMultiSourceValidatedPrice } = await import('@/lib/services/market-data/unified-price-provider');
  const v = await getMultiSourceValidatedPrice('BTC');
  return v.price;
}

/** Convenience hook for the cron — record-and-resolve in one call. */
export async function trackSignalAndResolve(args: {
  source: string;
  marketId?: string;
  windowEndTime: number;
  direction: 'UP' | 'DOWN';
  probability: number;
  confidence?: number;
  signalStrength?: 'STRONG' | 'MODERATE' | 'WEAK';
  volume?: number;
  liquidity?: number;
  entryPrice: number;
}): Promise<void> {
  try {
    await recordSignal(args);
    // Try to resolve expired signals while we're here — cheap, max batch 32.
    await resolveExpiredSignals('BTC', fetchBtcExitPrice, { maxBatch: 32 });
  } catch (err) {
    logger.warn('[SignalOutcomes] trackSignalAndResolve non-fatal', { error: err instanceof Error ? err.message : err });
  }
}
