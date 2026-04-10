/**
 * BlueFin Mainnet Combined Test
 * Tests swap quotes (aggregator) and hedge API (Pro) on mainnet
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { getBluefinAggregatorService } from '../lib/services/sui/BluefinAggregatorService';

const PRIVATE_KEY = process.env.BLUEFIN_PRIVATE_KEY || '';

function initKeypair(pk: string): { keypair: Ed25519Keypair; address: string } {
  let keypair: Ed25519Keypair;
  if (pk.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(pk);
    keypair = Ed25519Keypair.fromSecretKey(secretKey);
  } else {
    const hexKey = pk.startsWith('0x') ? pk.slice(2) : pk;
    keypair = Ed25519Keypair.fromSecretKey(Buffer.from(hexKey, 'hex'));
  }
  return { keypair, address: keypair.toSuiAddress() };
}

let pass = 0, fail = 0;
function ok(label: string, detail?: string) { pass++; console.log(`  ✅ ${label}${detail ? ': ' + detail : ''}`); }
function err(label: string, detail: string) { fail++; console.log(`  ❌ ${label}: ${detail}`); }

async function testSwaps() {
  console.log('\n═══ SWAP AGGREGATOR (mainnet DEX quotes) ═══');
  const agg = getBluefinAggregatorService('mainnet');

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

async function testHedgeApi(keypair: Ed25519Keypair, address: string) {
  const exchangeBase = 'https://api.sui-prod.bluefin.io';
  const authBase = 'https://auth.api.sui-prod.bluefin.io';
  const tradeBase = 'https://trade.api.sui-prod.bluefin.io';

  console.log('\n═══ HEDGE API — MAINNET (trade.bluefin.io) ═══');

  // 1. Public exchange endpoints
  console.log(`\n  --- Public Market Data (${exchangeBase}) ---`);
  for (const ep of ['/v1/exchange/info', '/v1/exchange/ticker?symbol=BTC-PERP', '/v1/exchange/ticker?symbol=ETH-PERP', '/v1/exchange/ticker?symbol=SUI-PERP']) {
    try {
      const r = await fetch(`${exchangeBase}${ep}`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const d = await r.json();
        const preview = JSON.stringify(d).slice(0, 100);
        ok(`MAINNET ${ep}`, preview + '...');
      } else {
        err(`MAINNET ${ep}`, `${r.status} ${r.statusText}`);
      }
    } catch (e: any) {
      err(`MAINNET ${ep}`, e.message);
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
      ok('MAINNET Auth', `JWT obtained (${authToken!.slice(0, 40)}...)`);
    } else {
      err('MAINNET Auth', `${r.status} — ${JSON.stringify(data).slice(0, 120)}`);
    }
  } catch (e: any) {
    err('MAINNET Auth', e.message);
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
        ok('MAINNET Account', `freeCollateral=${d.freeCollateral || 'N/A'}, canTrade=${d.canTrade}`);
      } else if (r.status === 404 || !text) {
        ok('MAINNET Account', `not onboarded (${r.status}) — visit trade.bluefin.io to register`);
      } else {
        err('MAINNET Account', `${r.status} — ${text.slice(0, 100)}`);
      }
    } catch (e: any) {
      err('MAINNET Account', e.message);
    }

    // Open orders
    try {
      const r = await fetch(`${tradeBase}/api/v1/openOrders`, { headers, signal: AbortSignal.timeout(10000) });
      const text = await r.text();
      if (r.ok && text) {
        const d = JSON.parse(text);
        ok('MAINNET Open Orders', `${Array.isArray(d) ? d.length : '?'} orders`);
      } else if (r.status === 404 || !text) {
        ok('MAINNET Open Orders', `no account — expected for unregistered wallet`);
      } else {
        err('MAINNET Open Orders', `${r.status} — ${text.slice(0, 100)}`);
      }
    } catch (e: any) {
      err('MAINNET Open Orders', e.message);
    }

    // Positions
    try {
      const r = await fetch(`${exchangeBase}/api/v1/account?accountAddress=${address}`, { headers, signal: AbortSignal.timeout(10000) });
      const text = await r.text();
      if (r.ok && text) {
        const d = JSON.parse(text);
        const positions = d.positions || [];
        ok('MAINNET Positions', `${positions.length} open position(s)`);
      } else if (r.status === 404 || !text) {
        ok('MAINNET Positions', 'no positions (account not onboarded or empty)');
      } else {
        err('MAINNET Positions', `${r.status} — ${text.slice(0, 100)}`);
      }
    } catch (e: any) {
      err('MAINNET Positions', e.message);
    }

    // Live SUI-PERP market data
    try {
      const r = await fetch(`${exchangeBase}/v1/exchange/ticker?symbol=SUI-PERP`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const d = await r.json();
        const price = d.lastPriceE9 ? (parseFloat(d.lastPriceE9) / 1e9).toFixed(4) : d.lastPrice || '?';
        const funding = d.avgFundingRate8hrE9 ? (parseFloat(d.avgFundingRate8hrE9) / 1e9 * 100).toFixed(6) : '?';
        ok('MAINNET SUI-PERP Live', `price=$${price}, 8hr funding=${funding}%`);
      } else {
        err('MAINNET SUI-PERP Live', `${r.status}`);
      }
    } catch (e: any) {
      err('MAINNET SUI-PERP Live', e.message);
    }
  }
}

async function main() {
  console.log('🌊 BlueFin Mainnet Test: Swap + Hedge');
  console.log('═'.repeat(60));

  if (!PRIVATE_KEY) {
    console.error('❌ BLUEFIN_PRIVATE_KEY not set in .env.local');
    process.exit(1);
  }

  const { keypair, address } = initKeypair(PRIVATE_KEY);
  console.log(`Wallet: ${address}`);
  console.log(`Network: MAINNET (sui-prod.bluefin.io)`);

  // Test swap aggregator (mainnet DEX data)
  await testSwaps();

  // Test hedge API on mainnet
  await testHedgeApi(keypair, address);

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
