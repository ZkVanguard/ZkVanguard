// Enable auto-hedge on the USDC pool and verify it works
const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { Transaction } = require('@mysten/sui/transactions');
const fs = require('fs');

async function main() {
  const envContent = fs.readFileSync('.env.vercel-test', 'utf-8');
  const keyMatch = envContent.match(/^SUI_POOL_ADMIN_KEY="?([^"\r\n]+)"?/m) 
    || envContent.match(/^SUI_PRIVATE_KEY="?([^"\r\n]+)"?/m);
  if (!keyMatch) { console.error('No admin key found'); return; }
  const adminKey = keyMatch[1].replace(/\\r\\n/g, '').trim();
  
  const keypair = adminKey.startsWith('suiprivkey')
    ? Ed25519Keypair.fromSecretKey(adminKey)
    : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
  
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  
  const PACKAGE_ID = '0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88';
  const POOL_STATE_ID = '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a';
  const AGENT_CAP_ID = '0xdeecf4483ba7729f91c1a4349a5c6b9a5b776981726b1c0136e5cf788889d46d';
  const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::community_pool_usdc::set_auto_hedge_config`,
    typeArguments: [USDC_TYPE],
    arguments: [
      tx.object(AGENT_CAP_ID),
      tx.object(POOL_STATE_ID),
      tx.pure.bool(true),          // enabled
      tx.pure.u64(500),            // risk_threshold_bps (5%)
      tx.pure.u64(5000),           // max_hedge_ratio_bps (50%) — contract max
      tx.pure.u64(2),              // default_leverage (2x min required by contract)
      tx.pure.u64(300000),         // cooldown_ms (5 minutes)
      tx.object('0x6'),            // Clock
    ],
  });
  
  tx.setGasBudget(50_000_000);
  
  console.log('Enabling auto-hedge...');
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true },
  });
  
  console.log('TX digest:', result.digest);
  console.log('Status:', result.effects?.status?.status);
  if (result.effects?.status?.status !== 'success') {
    console.log('Error:', result.effects?.status?.error);
  }
  
  // Verify
  const poolObj = await client.getObject({ id: POOL_STATE_ID, options: { showContent: true } });
  const hedgeConfig = poolObj.data.content.fields.hedge_state?.fields?.auto_hedge_config?.fields;
  console.log('\nUpdated hedge config:', JSON.stringify(hedgeConfig, null, 2));
}

main().catch(console.error);
