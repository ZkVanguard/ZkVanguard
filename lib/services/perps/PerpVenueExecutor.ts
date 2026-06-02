/**
 * Executes a RoutePlan across multiple venues. T5-A Phase 3 structural prep.
 *
 * Takes a plan computed by `routeHedge` and a registry of trading-capable
 * venue clients. For each leg, looks up the client, calls openPosition,
 * collects per-leg result. Aggregates into a single ExecutionResult.
 *
 * Designed so swapping `bf.openHedge(...)` for `executor.executePlan(...)`
 * in the cron is a one-line change once the venue registry has more than
 * one entry. Until Hyperliquid Phase 3 (live trading) is implemented,
 * the registry only has BlueFin, so router output that includes a
 * Hyperliquid leg will report it as "VENUE_NOT_CONFIGURED" instead of
 * silently dropping it.
 */
import { logger } from '@/lib/utils/logger';
import type { RoutePlan } from './PerpVenueRouter';
import type { TradingPerpVenue, PerpTradingResult } from './PerpVenue';

export interface ExecutionLegResult {
  venue: string;
  requestedNotionalUsd: number;
  result: PerpTradingResult | { success: false; venue: string; error: string };
}

export interface ExecutionResult {
  symbol: string;
  side: 'LONG' | 'SHORT';
  attemptedNotionalUsd: number;
  filledNotionalUsd: number;
  successCount: number;
  failureCount: number;
  legs: ExecutionLegResult[];
}

export class PerpVenueExecutor {
  private readonly clients = new Map<string, TradingPerpVenue>();

  register(venue: TradingPerpVenue): void {
    this.clients.set(venue.name, venue);
  }

  /** Returns the list of venue names that have a live trading client. */
  listTradableVenues(): string[] {
    return Array.from(this.clients.keys());
  }

  async executePlan(plan: RoutePlan, leverage: number): Promise<ExecutionResult> {
    const result: ExecutionResult = {
      symbol: plan.symbol,
      side: plan.side,
      attemptedNotionalUsd: plan.filledNotionalUsd,
      filledNotionalUsd: 0,
      successCount: 0,
      failureCount: 0,
      legs: [],
    };

    for (const leg of plan.legs) {
      const client = this.clients.get(leg.venue);
      if (!client) {
        logger.warn('[PerpExecutor] No trading client registered for venue', {
          venue: leg.venue,
          symbol: plan.symbol,
          notionalUsd: leg.notionalUsd,
        });
        result.legs.push({
          venue: leg.venue,
          requestedNotionalUsd: leg.notionalUsd,
          result: {
            success: false,
            venue: leg.venue,
            error: `VENUE_NOT_CONFIGURED — no trading client registered for "${leg.venue}". T5-A Phase 3 work needed.`,
          },
        });
        result.failureCount++;
        continue;
      }
      try {
        const r = await client.openPosition({
          symbol: plan.symbol,
          side: plan.side,
          notionalUsd: leg.notionalUsd,
          leverage,
          reason: `Multi-venue routed leg (${leg.notionalUsd.toFixed(2)} of ${plan.filledNotionalUsd.toFixed(2)})`,
        });
        result.legs.push({ venue: leg.venue, requestedNotionalUsd: leg.notionalUsd, result: r });
        if (r.success) {
          result.successCount++;
          result.filledNotionalUsd += r.filledNotionalUsd ?? leg.notionalUsd;
        } else {
          result.failureCount++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.legs.push({
          venue: leg.venue,
          requestedNotionalUsd: leg.notionalUsd,
          result: { success: false, venue: leg.venue, error: msg },
        });
        result.failureCount++;
      }
    }

    return result;
  }
}
