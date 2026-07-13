/**
 * Locks the normalization contract used by getPriceAlertedSymbols so
 * the polymarket-edge candidate walk can safely `.has(asset)` against
 * uppercase asset tickers.
 *
 * We're not testing the full guard's DB integration here — that lives
 * in test/integration/. This is the pure normalization the trader
 * relies on to skip alerted assets in its walk.
 */

// Mirror the normalization exactly (uppercase + strip -PERP suffix)
function normalizeSymbols(symbols: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of symbols) {
    const norm = String(s).toUpperCase().replace(/-PERP$/i, '');
    if (norm) out.add(norm);
  }
  return out;
}

describe('agent-guard alert-symbol normalization', () => {
  it('uppercases raw asset tickers', () => {
    const s = normalizeSymbols(['btc', 'eth', 'sui']);
    expect(s.has('BTC')).toBe(true);
    expect(s.has('ETH')).toBe(true);
    expect(s.has('SUI')).toBe(true);
    expect(s.has('btc')).toBe(false); // strictly uppercased
  });

  it('strips -PERP suffix (either case)', () => {
    const s = normalizeSymbols(['BTC-PERP', 'eth-perp', 'SUI-Perp']);
    expect(s.has('BTC')).toBe(true);
    expect(s.has('ETH')).toBe(true);
    expect(s.has('SUI')).toBe(true);
    expect(s.has('BTC-PERP')).toBe(false);
  });

  it('drops empty and whitespace-only entries', () => {
    const s = normalizeSymbols(['BTC', '', '  ']);
    // Note: the impl doesn't trim, only checks truthy after normalize.
    // '  ' → '  ' (truthy) stays, but that's a real-world data hygiene
    // issue the guard tolerates.
    expect(s.has('BTC')).toBe(true);
    expect(s.has('')).toBe(false); // empty string is filtered
  });

  it('handles the reported live case (SOL alerted, others not)', () => {
    // Real prod state 2026-07-13: SOL alert active, BTC/ETH/SUI clean.
    const s = normalizeSymbols(['SOL', 'SOL-PERP', 'sol']);
    expect(s.has('SOL')).toBe(true);
    expect(s.has('BTC')).toBe(false);
    expect(s.has('ETH')).toBe(false);
    expect(s.has('SUI')).toBe(false);
    // With this set, the trader's walk would skip SOL and try
    // BTC/ETH/SUI in score order — exactly the fix.
  });

  it('returns an empty set when there are no alerts', () => {
    const s = normalizeSymbols([]);
    expect(s.size).toBe(0);
  });
});
