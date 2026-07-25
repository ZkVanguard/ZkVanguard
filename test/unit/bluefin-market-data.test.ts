/**
 * Contract lock for the extracted BlueFin exchange-API read parsers.
 *
 * Wire format matters — if the E9 → decimal parsing drifts (missing
 * divide by 1e9, wrong fallback field), price feeds go silently wrong
 * (2026-06-01 incident: BTC OI reported $117B pre-fix).
 *
 * Tests use a fake apiRequest so no HTTP; every branch of the E9-vs-legacy
 * fallback logic is exercised.
 */
import { describe, it, expect } from '@jest/globals';
import {
  fetchMarketData, fetchOrderBook, fetchFundingRates,
  type ExchangeApiCaller,
} from '@/lib/services/sui/bluefin/market-data';

function fakeApi<T>(response: T): ExchangeApiCaller {
  return async () => response as unknown as never;
}

describe('fetchMarketData', () => {
  it('parses E9-format price + funding + change24h + OI', async () => {
    const api = fakeApi({
      lastPriceE9: '4000000000000',     // 4000 * 1e9 → $4000
      lastFundingRateE9: '10000',       // 0.00001 (1 bps / 8h)
      priceChangePercent24hrE9: '25000000',  // 2.5% * 1e9 → wait no...
      // priceChangePercent24hrE9 is percent * 1e9, then *100 in the code
      // So 25000000 / 1e9 = 0.025, * 100 = 2.5%
      openInterestE9: '5000000000000',  // $5000 USD (assumed by parser)
      quoteVolume24hrE9: '1000000000000',
    });
    const md = await fetchMarketData(api, 'ETH-PERP');
    expect(md).not.toBeNull();
    expect(md!.price).toBe(4000);
    expect(md!.fundingRate).toBeCloseTo(0.00001, 8);
    expect(md!.change24h).toBeCloseTo(2.5, 3);
    expect(md!.openInterestUsd).toBeDefined();
  });

  it('falls back to legacy lastPrice when E9 field is missing', async () => {
    const api = fakeApi({ lastPrice: '3500.5' });
    const md = await fetchMarketData(api, 'ETH-PERP');
    expect(md!.price).toBe(3500.5);
  });

  it('returns null on NaN price', async () => {
    const api = fakeApi({ lastPriceE9: 'garbage' });
    const md = await fetchMarketData(api, 'ETH-PERP');
    expect(md).toBeNull();
  });

  it('defaults fundingRate to 0 if unparseable', async () => {
    const api = fakeApi({ lastPriceE9: '1000000000', lastFundingRateE9: 'x' });
    const md = await fetchMarketData(api, 'ETH-PERP');
    expect(md!.fundingRate).toBe(0);
  });

  it('returns null when the fetch throws', async () => {
    const api: ExchangeApiCaller = async () => { throw new Error('network down'); };
    const md = await fetchMarketData(api, 'ETH-PERP');
    expect(md).toBeNull();
  });
});

describe('fetchOrderBook', () => {
  it('parses E9 format bids/asks', async () => {
    const api = fakeApi({
      bidsE9: [['4000000000000', '1000000000']] as [string, string][], // $4000 × 1 unit
      asksE9: [['4001000000000', '500000000']] as [string, string][],  // $4001 × 0.5 unit
    });
    const ob = await fetchOrderBook(api, 'ETH-PERP');
    expect(ob.bids).toHaveLength(1);
    expect(ob.bids[0].price).toBe(4000);
    expect(ob.bids[0].size).toBe(1);
    expect(ob.asks[0].price).toBe(4001);
    expect(ob.asks[0].size).toBe(0.5);
  });

  it('falls back to legacy non-E9 format', async () => {
    const api = fakeApi({
      bids: [['4000', '1']] as [string, string][],
      asks: [['4001', '0.5']] as [string, string][],
    });
    const ob = await fetchOrderBook(api, 'ETH-PERP');
    expect(ob.bids[0].price).toBe(4000);
    expect(ob.bids[0].size).toBe(1);
  });

  it('returns empty book on error (not empty book from venue)', async () => {
    const api: ExchangeApiCaller = async () => { throw new Error('down'); };
    const ob = await fetchOrderBook(api, 'ETH-PERP');
    expect(ob.bids).toEqual([]);
    expect(ob.asks).toEqual([]);
  });
});

describe('fetchFundingRates', () => {
  it('parses E9 format history', async () => {
    const api = fakeApi([
      { fundingTimeAtMillis: 1000, fundingRateE9: '1000' },        // 0.000001
      { fundingTimeAtMillis: 2000, fundingRateE9: '2000000000' },  // 2.0
    ]);
    const rates = await fetchFundingRates(api, 'ETH-PERP');
    expect(rates).toHaveLength(2);
    expect(rates[0].rate).toBeCloseTo(0.000001, 9);
    expect(rates[1].rate).toBe(2);
  });

  it('falls back to legacy time/fundingRate fields', async () => {
    const api = fakeApi([{ time: 5000, fundingRate: '0.0005' }]);
    const rates = await fetchFundingRates(api, 'ETH-PERP');
    expect(rates[0]).toEqual({ time: 5000, rate: 0.0005 });
  });

  it('returns empty on error (never throws)', async () => {
    const api: ExchangeApiCaller = async () => { throw new Error('rate-limited'); };
    const rates = await fetchFundingRates(api, 'ETH-PERP');
    expect(rates).toEqual([]);
  });
});
