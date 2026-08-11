/**
 * BlueFin markPrice divergence check — pure function, unit-tested.
 *
 * Context: PR #48 (2026-08-10) added a fallback where closeHedge uses
 * `position.unrealizedPnl` as the recorded realizedPnl when BlueFin's
 * MARKET-order response omits realizedPnl. That fallback is derived from
 * BlueFin's own markPrice. If markPrice is stale/wrong (unusual but
 * observed during volatile candles or venue-side lag), the recorded
 * realizedPnl will be off in the same direction — a silent PnL corruption.
 *
 * This helper compares BlueFin's markPrice against an independent price
 * source (Crypto.com / Delphi aggregator via RealMarketDataService) and
 * flags divergence > threshold. Non-blocking — caller records the PnL
 * anyway but logs a WARN + fires Discord alert so operators can spot
 * a systemic issue before it costs meaningful capital.
 *
 * Tests: test/unit/markprice-divergence.test.ts
 */

export interface DivergenceCheck {
  /** Absolute percentage divergence, > 0. Zero when either input is invalid. */
  divergencePct: number;
  /** True when divergence exceeds threshold AND both inputs are valid. */
  warn: boolean;
  /** Human-readable summary for logs / Discord. Empty when no warn. */
  detail: string;
}

/**
 * Compare BlueFin markPrice against an independent reference.
 *
 * @param bluefinMark      Price from position.markPrice at close time
 * @param independentMark  Price from RealMarketDataService (Crypto.com / Delphi)
 * @param thresholdPct     Divergence % that triggers warn. Default 2.0
 *                          (calibrated against normal cross-venue basis of
 *                          BTC/ETH/SUI perps vs spot — under 1% in calm
 *                          markets, 1-2% during volatility, > 2% suggests
 *                          venue-side markPrice lag or bad feed).
 */
export function checkMarkPriceDivergence(
  bluefinMark: number,
  independentMark: number,
  thresholdPct: number = 2,
): DivergenceCheck {
  const bf = Number(bluefinMark);
  const ind = Number(independentMark);
  if (!Number.isFinite(bf) || bf <= 0 || !Number.isFinite(ind) || ind <= 0) {
    return { divergencePct: 0, warn: false, detail: '' };
  }
  const divergencePct = Math.abs(bf - ind) / ind * 100;
  if (divergencePct <= thresholdPct) {
    return { divergencePct, warn: false, detail: '' };
  }
  return {
    divergencePct,
    warn: true,
    detail: `BlueFin mark $${bf.toFixed(4)} vs independent $${ind.toFixed(4)} (${divergencePct.toFixed(2)}% > ${thresholdPct}% threshold) — recorded realizedPnl may be off in the same direction`,
  };
}
