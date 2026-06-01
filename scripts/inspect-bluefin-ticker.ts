#!/usr/bin/env npx tsx
/**
 * Dump the raw BlueFin /v1/exchange/ticker response for BTC/ETH/SUI -PERP
 * so we can see what field semantics actually are — getMarketData's
 * openInterest parsing produces $121B for BTC which is clearly wrong.
 */
async function main() {
  // Public exchange endpoint — no auth needed.
  const base = 'https://api.sui-prod.bluefin.io';
  for (const symbol of ['BTC-PERP', 'ETH-PERP', 'SUI-PERP']) {
    console.log(`\n── ${symbol} ──`);
    try {
      const r = await fetch(`${base}/v1/exchange/ticker?symbol=${encodeURIComponent(symbol)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const body = await r.json();
      console.log(JSON.stringify(body, null, 2));
    } catch (e: any) {
      console.log('  FAIL:', e?.message);
    }
  }
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
