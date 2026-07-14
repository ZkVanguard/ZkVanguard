/**
 * Locks the asset → BlueFin perp pair mapping. Called by every hedge
 * open/close path — a bad mapping would route trades to the wrong pair.
 */
import { describe, it, expect } from '@jest/globals';
import { BluefinService } from '@/lib/services/sui/BluefinService';

describe('BluefinService.assetToPair', () => {
  it('maps the primary trader assets to their BlueFin pairs', () => {
    expect(BluefinService.assetToPair('BTC')).toBe('BTC-PERP');
    expect(BluefinService.assetToPair('ETH')).toBe('ETH-PERP');
    expect(BluefinService.assetToPair('SUI')).toBe('SUI-PERP');
    expect(BluefinService.assetToPair('SOL')).toBe('SOL-PERP');
  });

  it('is case-insensitive', () => {
    expect(BluefinService.assetToPair('btc')).toBe('BTC-PERP');
    expect(BluefinService.assetToPair('Eth')).toBe('ETH-PERP');
  });

  it('returns null for unknown assets', () => {
    expect(BluefinService.assetToPair('XRP')).toBeNull();
    expect(BluefinService.assetToPair('')).toBeNull();
    expect(BluefinService.assetToPair('foo')).toBeNull();
  });

  it('supports secondary assets in the mapping', () => {
    // These are less-common but present in the router
    expect(BluefinService.assetToPair('GOLD')).toBe('GOLD-PERP');
    expect(BluefinService.assetToPair('HYPE')).toBe('HYPE-PERP');
    expect(BluefinService.assetToPair('DEEP')).toBe('DEEP-PERP');
    expect(BluefinService.assetToPair('WAL')).toBe('WAL-PERP');
  });
});
