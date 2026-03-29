/**
 * BlueFin Testnet Programmatic Onboarding
 * 
 * Attempts to onboard account on BlueFin testnet by:
 * 1. Authenticating via wallet signature
 * 2. Calling the set_account_type / authorize_account endpoint
 * 3. Checking if account exists afterwards
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient } from '@mysten/sui/client';

const PRIVATE_KEY = process.env.BLUEFIN_PRIVATE_KEY || '';
const AUTH_URL = 'https://auth.api.sui-staging.bluefin.io';
const TRADE_URL = 'https://trade.api.sui-staging.bluefin.io';
const EXCHANGE_URL = 'https://api.sui-staging.bluefin.io';

function initKeypair(privateKey: string): Ed25519Keypair {
  const hexKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  return Ed25519Keypair.fromSecretKey(Buffer.from(hexKey, 'hex'));
}

async function main() {
  console.log('🔑 BlueFin Testnet Onboarding\n');

  if (!PRIVATE_KEY) {
    console.error('❌ BLUEFIN_PRIVATE_KEY not set');
    process.exit(1);
  }

  const keypair = initKeypair(PRIVATE_KEY);
  const address = keypair.toSuiAddress();
  console.log(`Wallet: ${address}\n`);

  // Step 1: Authenticate
  console.log('--- Step 1: Authenticate ---');
  const signedAtMillis = Date.now();
  const authPayload = {
    accountAddress: address,
    signedAtMillis,
    audience: 'api',
  };
  const payloadString = JSON.stringify(authPayload);
  const messageBytes = new TextEncoder().encode(payloadString);
  const { signature: payloadSignature } = await keypair.signPersonalMessage(messageBytes);

  const authResp = await fetch(`${AUTH_URL}/auth/v2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'payloadSignature': payloadSignature,
    },
    body: payloadString,
  });

  if (!authResp.ok) {
    console.error('Auth failed:', authResp.status, await authResp.text());
    process.exit(1);
  }

  const authData = await authResp.json();
  const token = authData.accessToken || authData.token;
  console.log(`✅ Authenticated (token: ${token?.slice(0, 20)}...)\n`);

  const authHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // Step 2: Check account status
  console.log('--- Step 2: Check Account ---');
  const acctResp = await fetch(`${TRADE_URL}/api/v1/account`, { headers: authHeaders });
  console.log(`Account status: ${acctResp.status}`);
  if (acctResp.ok) {
    const acctData = await acctResp.json();
    console.log('✅ Account already exists:', JSON.stringify(acctData).slice(0, 200));
    return;
  }
  const acctError = await acctResp.text();
  console.log(`Account response: ${acctError.slice(0, 200)}\n`);

  // Step 3: Try various onboarding approaches
  console.log('--- Step 3: Try Onboarding Endpoints ---');

  // 3a: POST /api/v1/account (create account)
  const endpoints = [
    { method: 'POST', url: `${TRADE_URL}/api/v1/account`, body: { accountAddress: address } },
    { method: 'PUT', url: `${TRADE_URL}/api/v1/account`, body: { accountAddress: address } },
    { method: 'POST', url: `${TRADE_URL}/api/v1/onboard`, body: { accountAddress: address } },
    { method: 'POST', url: `${TRADE_URL}/api/v1/user/onboard`, body: { accountAddress: address } },
    { method: 'PUT', url: `${TRADE_URL}/api/v1/authorize-account`, body: {} },
    { method: 'PUT', url: `${TRADE_URL}/api/v1/account/authorize`, body: {} },
    { method: 'POST', url: `${TRADE_URL}/api/v1/user`, body: { accountAddress: address } },
  ];

  for (const ep of endpoints) {
    try {
      const resp = await fetch(ep.url, {
        method: ep.method,
        headers: authHeaders,
        body: JSON.stringify(ep.body),
      });
      const text = await resp.text();
      console.log(`  ${ep.method} ${new URL(ep.url).pathname}: ${resp.status} ${text.slice(0, 150)}`);
    } catch (e: any) {
      console.log(`  ${ep.method} ${new URL(ep.url).pathname}: ERROR ${e.message}`);
    }
  }

  // Step 4: Try authorize_account via SDK-style signed request
  console.log('\n--- Step 4: SDK-style authorize_account ---');
  const authorizePayload = {
    accountAddress: address,
    authorizedAccountAddress: address,
    status: 'APPROVED',
  };
  const authorizeJson = JSON.stringify(authorizePayload, null, 2);
  const authorizeMsgBytes = new TextEncoder().encode(authorizeJson);
  const { signature: authorizeSig } = await keypair.signPersonalMessage(authorizeMsgBytes);

  const authorizeResp = await fetch(`${TRADE_URL}/api/v1/authorize-account`, {
    method: 'PUT',
    headers: {
      ...authHeaders,
      'payloadSignature': authorizeSig,
    },
    body: authorizeJson,
  });
  console.log(`  Authorize: ${authorizeResp.status} ${(await authorizeResp.text()).slice(0, 200)}`);

  // Step 5: Check if we can deposit on-chain (this often creates accounts)
  console.log('\n--- Step 5: SUI On-chain Deposit Check ---');
  const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
  
  // Check for BlueFin custom USDC tokens  
  const bfUsdcType = '0x84b4840bcb2766eebad6717b83c2b2f5c272673d0fbc6789ed35307f837997d4::coin::COIN';
  const coins = await suiClient.getCoins({ owner: address, coinType: bfUsdcType });
  console.log(`BlueFin USDC coins: ${coins.data.length}`);
  
  if (coins.data.length > 0) {
    console.log(`Balance: ${coins.data.reduce((sum, c) => sum + BigInt(c.balance), 0n)} units`);
    console.log('Can attempt on-chain deposit!');
  } else {
    console.log('No BlueFin USDC tokens. Need faucet.');
    
    // Try to find faucet/mint capability
    console.log('\nSearching for TreasuryCap...');
    const treasuryCapType = `0x2::coin::TreasuryCap<${bfUsdcType}>`;
    const treasuryObjs = await suiClient.getOwnedObjects({
      owner: address,
      filter: { StructType: treasuryCapType },
    });
    console.log(`TreasuryCap owned: ${treasuryObjs.data.length}`);
  }

  // Step 6: Re-check account
  console.log('\n--- Step 6: Re-check Account ---');
  const acctResp2 = await fetch(`${TRADE_URL}/api/v1/account`, { headers: authHeaders });
  console.log(`Account status: ${acctResp2.status}`);
  if (acctResp2.ok) {
    console.log('✅ Account created!', (await acctResp2.text()).slice(0, 200));
  } else {
    console.log('❌ Still not onboarded:', (await acctResp2.text()).slice(0, 200));
    console.log('\n📝 Next steps:');
    console.log('  The testnet UI at testnet.bluefin.io requires browser wallet onboarding.');
    console.log('  The wallet needs to accept terms via the web interface.');
    console.log('  Try: https://testnet.bluefin.io with your wallet set to SUI Mainnet (their UI bug).');
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
