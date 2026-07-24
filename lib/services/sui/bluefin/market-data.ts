/**
 * BlueFin Pro exchange-API read methods — market data, funding rates, orderbook.
 *
 * These three methods share:
 *   - `apiType: 'exchange'` (not `'trade'`)
 *   - No wallet address, no signing, no auth token needed
 *   - E9-format numeric encoding on every response field
 *
 * Extracted so BluefinService doesn't own 300+ LOC of ticker-parsing
 * boilerplate; each function takes a bound `apiRequest` callable and
 * returns typed data. Reuses `parseTickerOpenInterest` for the OI
 * sanity check (introduced after the 2026-06-01 "BTC OI $117B" bug).
 */
import { logger } from '@/lib/utils/logger';
import { parseTickerOpenInterest } from '@/lib/services/sui/bluefin-ticker-parsers';

/** Callable that BluefinService binds and hands us — the two `undefined`s
 *  are body + intentional gap; every read call is a GET with no payload. */
export type ExchangeApiCaller = <T>(
  method: 'GET',
  path: string,
  body: undefined,
  apiType: 'exchange',
) => Promise<T>;

export interface MarketDataSnapshot {
  price: number;
  fundingRate: number;
  change24h?: number;
  openInterestUsd?: number;
}

export interface OrderBookSnapshot {
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
}

export interface FundingRatePoint {
  time: number;
  rate: number;
}

/**
 * Fetch latest ticker for a symbol. Returns null on 404 / network error
 * so callers can degrade gracefully — some markets go dark briefly.
 */
export async function fetchMarketData(
  apiRequest: ExchangeApiCaller,
  symbol: string,
): Promise<MarketDataSnapshot | null> {
  try {
    const marketData = await apiRequest<{
      lastPriceE9?: string;
      lastPrice?: string;
      lastFundingRateE9?: string;
      fundingRate?: string;
      priceChangePercent24hrE9?: string;
      priceChange24h?: string;
      openInterestE9?: string;
      openInterest?: string;
      // 24h quote volume in USD × 1e9 — used as sanity cross-check against
      // openInterestE9, which has bitten us with stale/wrong values in the
      // past (BTC OI reported $117B on 2026-06-01 prior to the parsing fix).
      quoteVolume24hrE9?: string;
    }>('GET', `/v1/exchange/ticker?symbol=${encodeURIComponent(symbol)}`, undefined, 'exchange');

    let price = 0;
    if (marketData?.lastPriceE9) price = parseFloat(marketData.lastPriceE9) / 1e9;
    else if (marketData?.lastPrice) price = parseFloat(marketData.lastPrice);
    if (Number.isNaN(price)) {
      logger.warn('[BlueFin] NaN price detected', { symbol, raw: marketData });
      return null;
    }

    let fundingRate = 0;
    if (marketData?.lastFundingRateE9) fundingRate = parseFloat(marketData.lastFundingRateE9) / 1e9;
    else if (marketData?.fundingRate) fundingRate = parseFloat(marketData.fundingRate);
    if (Number.isNaN(fundingRate)) fundingRate = 0;

    let change24h: number | undefined;
    if (marketData?.priceChangePercent24hrE9) {
      change24h = (parseFloat(marketData.priceChangePercent24hrE9) / 1e9) * 100;
    } else if (marketData?.priceChange24h) {
      change24h = parseFloat(marketData.priceChange24h);
    }
    if (change24h !== undefined && Number.isNaN(change24h)) change24h = undefined;

    const oiSnap = parseTickerOpenInterest(
      {
        openInterestE9: marketData?.openInterestE9,
        openInterest: marketData?.openInterest,
        quoteVolume24hrE9: marketData?.quoteVolume24hrE9,
      },
      price,
    );
    if (oiSnap.rejectedReason) {
      logger.warn('[BlueFin] OI snapshot rejected by sanity check', {
        symbol,
        reason: oiSnap.rejectedReason,
      });
    }

    return { price, fundingRate, change24h, openInterestUsd: oiSnap.openInterestUsd };
  } catch (error) {
    logger.debug('Failed to get market data', {
      symbol,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Fetch orderbook snapshot. Returns empty arrays on error — callers must
 * handle empty gracefully (means "no data", not "empty book").
 */
export async function fetchOrderBook(
  apiRequest: ExchangeApiCaller,
  symbol: string,
  depth: number = 10,
): Promise<OrderBookSnapshot> {
  try {
    const orderbook = await apiRequest<{
      bidsE9?: [string, string][];
      asksE9?: [string, string][];
      bids?: [string, string][];
      asks?: [string, string][];
    }>(
      'GET',
      `/v1/exchange/depth?symbol=${encodeURIComponent(symbol)}&limit=${depth}`,
      undefined,
      'exchange',
    );
    const parseBids = orderbook?.bidsE9 || orderbook?.bids || [];
    const parseAsks = orderbook?.asksE9 || orderbook?.asks || [];
    return {
      bids: parseBids.map((b: [string, string]) => ({
        price: orderbook?.bidsE9 ? parseFloat(b[0]) / 1e9 : parseFloat(b[0]),
        size: orderbook?.bidsE9 ? parseFloat(b[1]) / 1e9 : parseFloat(b[1]),
      })),
      asks: parseAsks.map((a: [string, string]) => ({
        price: orderbook?.asksE9 ? parseFloat(a[0]) / 1e9 : parseFloat(a[0]),
        size: orderbook?.asksE9 ? parseFloat(a[1]) / 1e9 : parseFloat(a[1]),
      })),
    };
  } catch (error) {
    logger.error('Failed to get orderbook', error instanceof Error ? error : undefined);
    return { bids: [], asks: [] };
  }
}

/**
 * Fetch funding rate history for a symbol. Empty array on error.
 */
export async function fetchFundingRates(
  apiRequest: ExchangeApiCaller,
  symbol: string,
): Promise<FundingRatePoint[]> {
  try {
    const fundingHistory = await apiRequest<Array<{
      fundingTimeAtMillis?: number;
      time?: number;
      fundingRateE9?: string;
      fundingRate?: string;
    }>>(
      'GET',
      `/v1/exchange/fundingRateHistory?symbol=${encodeURIComponent(symbol)}`,
      undefined,
      'exchange',
    );
    return (fundingHistory || []).map((f) => ({
      time: f.fundingTimeAtMillis || f.time || 0,
      rate: f.fundingRateE9
        ? parseFloat(f.fundingRateE9) / 1e9
        : parseFloat(f.fundingRate || '0'),
    }));
  } catch (error) {
    logger.error('Failed to get funding rates', error instanceof Error ? error : undefined);
    return [];
  }
}
