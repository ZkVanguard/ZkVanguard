/**
 * BlueFin Testnet + Mainnet Combined Test
 * Tests swap quotes (aggregator) and hedge API (Pro) on both networks
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { getBluefinAggregatorService } from '../lib/services/sui/BluefinAggregatorService';

const PRIVATE_KEY = process.env.BLUEFIN_PRIVATE_KEY || '';

function initKeypair(pk: string): { keypair: Ed25519Keypair; address: string } {
  const hexKey = pk.startsWith('0x') ? pk.slice(2) : pk;
  const keypair = Ed25519Keypair.fromSecretKey(Buffer.from(hexKey, 'hex'));
  return { keypair, address: keypair.toSuiAddress() };
}

let pass = 0, fail = 0;
function ok(label: string, detail?: string) { pass++; console.log(`  ✅ ${label}${detail ? ': ' + detail : ''}`); }
function err(label: string, detail: string) { fail++; console.log(`  ❌ ${label}: ${detail}`); }

async function testSwaps() {
  console.log('\n═══ SWAP AGGREGATOR (testnet quotes via mainnet DEX data) ═══');
  const agg = getBluefinAggregatorService('testnet');

  for (const [asset, usd] of [['SUI', 10], ['BTC', 100], ['ETH', 50], ['CRO', 25]] as const) {
    try {
      const q = await agg.getSwapQuote(asset as any, usd);
      ok(`${asset} quote ($${usd})`, `out=${q.expectedAmountOut} route=${q.route.slice(0, 60)}... hedge=${q.hedgeVia || 'on-chain'}`);
    } catch (e: any) {
      err(`${asset} quote`, e.message);
    }
  }

  // Rebalance plan
  try {
    const plan = await agg.planRebalanceSwaps(500, { BTC: 30, ETH: 25, SUI: 25, CRO: 20 });
    ok('Rebalance plan ($500)', `${plan.swaps.length} swaps planned`);
  } catch (e: any) {
    err('Rebalance plan', e.message);
  }
}

async function testHedgeApi(network: 'testnet' | 'mainnet', keypair: Ed25519Keypair, address: string) {
  const label = network.toUpperCase();
  const exchangeBase = network === 'mainnet'
    ? 'https://api.sui-prod.bluefin.io'
    : 'https://api.sui-staging.bluefin.io';
  const authBase = network === 'mainnet'
    ? 'https://auth.api.sui-prod.bluefin.io'
    : 'https://auth.api.sui-staging.bluefin.io';
  const tradeBase = network === 'mainnet'
    ? 'https://trade.api.sui-prod.bluefin.io'
    : 'https://trade.api.sui-staging.bluefin.io';

  console.log(`\n═══ HEDGE API — ${label} (${network === 'mainnet' ? 'trade.bluefin.io' : 'staging'}) ═══`);

  // 1. Public exchange endpoints
  console.log(`\n  --- Public Market Data (${exchangeBase}) ---`);
  for (const ep of ['/v1/exchange/info', '/v1/exchange/ticker?symbol=BTC-PERP', '/v1/exchange/ticker?symbol=ETH-PERP', '/v1/exchange/ticker?symbol=SUI-PERP']) {
    try {
      const r = await fetch(`${exchangeBase}${ep}`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const d = await r.json();
        const preview = JSON.stringify(d).slice(0, 100);
        ok(`${label} ${ep}`, preview + '...');
      } else {
        err(`${label} ${ep}`, `${r.status} ${r.statusText}`);
      }
    } catch (e: any) {
      err(`${label} ${ep}`, e.message);
    }
  }

  // 2. Authentication
  console.log(`\n  --- Authentication (${authBase}) ---`);
  let authToken: string | null = null;
  try {
    const loginReq = { accountAddress: address, signedAtMillis: Date.now(), audience: 'api' };
    const payload = JSON.stringify(loginReq);
    const msgBytes = new TextEncoder().encode(payload);
    const { signature } = await keypair.signPersonalMessage(msgBytes);

    const r = await fetch(`${authBase}/auth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'payloadSignature': signature },
      body: payload,
      signal: AbortSignal.timeout(15000),
    });
    const data = await r.json();
    if (r.ok && data.accessToken) {
      authToken = data.accessToken;
      ok(`${label} Auth`, `JWT obtained (${authToken!.slice(0, 40)}...)`);
    } else {
      err(`${label} Auth`, `${r.status} — ${JSON.stringify(data).slice(0, 120)}`);
    }
  } catch (e: any) {
    err(`${label} Auth`, e.message);
  }

  // 3. Account & positions (requires auth)
  if (authToken) {
    console.log(`\n  --- Account & Positions (${tradeBase}) ---`);
    const headers = { 'Authorization': `Bearer ${authToken}`, 'Accept': 'application/json' };

    // Account info
    try {
      const r = await fetch(`${tradeBase}/api/v1/account`, { headers, signal: AbortSignal.timeout(10000) });
      const text = await r.text();
      if (r.ok && text) {
        const d = JSON.parse(text);
        ok(`${label} Account`, `freeCollateral=${d.freeCollateral || 'N/A'}`);
      } else if (r.status === 404 || !text) {
        ok(`${label} Account`, `not onboarded (${r.status}) — visit trade.bluefin.io to register`);
      } else {
        err(`${label} Account`, `${r.status} — ${text.slice(0, 100)}`);
      }
    } catch (e: any) {
      err(`${label} Account`, e.message);
    }

    // Open orders
    try {
      const r = await fetch(`${tradeBase}/api/v1/openOrders`, { headers, signal: AbortSignal.timeout(10000) });
      const text = await r.text();
      if (r.ok && text) {
        const d = JSON.parse(text);
        ok(`${label} Open Orders`, `${Array.isArray(d) ? d.length : '?'} orders`);
      } else if (r.status === 404 || !text) {
        ok(`${label} Open Orders`, `no account — expected for unregistered wallet`);
      } else {
        err(`${label} Open Orders`, `${r.status} — ${text.slice(0, 100)}`);
      }
    } catch (e: any) {
      err(`${label} Open Orders`, e.message);
    }
  }
}

async function main() {
  console.log('🌊 BlueFin Combined Test: Swap + Hedge (Testnet & Mainnet)');
  console.log('═'.repeat(60));

  if (!PRIVATE_KEY) {
    console.error('❌ BLUEFIN_PRIVATE_KEY not set in .env.local');
    process.exit(1);
  }

  const { keypair, address } = initKeypair(PRIVATE_KEY);
  console.log(`Wallet: ${address}`);

  // Test swap aggregator (uses mainnet DEX data for testnet quotes)
  await testSwaps();

  // Test hedge API on testnet
  await testHedgeApi('testnet', keypair, address);

  // Test hedge API on mainnet (trade.bluefin.io)
  await testHedgeApi('mainnet', keypair, address);

  // Summary
  console.log('\n═══ SUMMARY ═══');
  console.log(`  ✅ Passed: ${pass}`);
  console.log(`  ❌ Failed: ${fail}`);
  console.log(`  Total: ${pass + fail}`);

  if (fail === 0) {
    console.log('\n🟢 ALL TESTS PASSED');
  } else {
    console.log(`\n🟡 ${fail} issue(s) — check details above`);
  }

  // Force exit (RealMarketData has a refresh timer)
  setTimeout(() => process.exit(fail > 0 ? 1 : 0), 1000);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
