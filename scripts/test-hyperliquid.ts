#!/usr/bin/env npx tsx
/**
 * Live smoke-test the read-only Hyperliquid integration.
 *   bun run scripts/test-hyperliquid.ts
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

async function main() {
  const { HyperliquidService } = await import('../lib/services/perps/HyperliquidService');
  const hl = HyperliquidService.getInstance();

  console.log('── per-symbol snapshot ──');
  for (const sym of ['BTC-PERP', 'ETH-PERP', 'SUI-PERP']) {
    const s = await hl.getMarketSnapshot(sym);
    if (!s) { console.log(`  ${sym.padEnd(10)} <unavailable>`); continue; }
    console.log(`  ${sym.padEnd(10)} mark=$${s.price.toFixed(2).padStart(10)}  OI=$${s.openInterestUsd.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(14)}  funding8h=${(s.fundingRate * 100).toFixed(4)}%`);
  }

  console.log('\n── top-5 markets by OI ──');
  const all = await hl.getAllSnapshots();
  const top = all.sort((a, b) => b.openInterestUsd - a.openInterestUsd).slice(0, 5);
  for (const s of top) {
    console.log(`  ${s.symbol.padEnd(12)} OI=$${s.openInterestUsd.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(14)}  funding8h=${(s.fundingRate * 100).toFixed(4)}%`);
  }
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
