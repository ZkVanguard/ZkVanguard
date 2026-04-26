// Create AgentCap for admin wallet by calling add_agent on the USDC pool contract
const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { Transaction } = require('@mysten/sui/transactions');
const fs = require('fs');

async function main() {
  // Read admin private key from env
  const envContent = fs.readFileSync('.env.vercel-test', 'utf-8');
  const keyMatch = envContent.match(/^SUI_POOL_ADMIN_KEY="?([^"\r\n]+)"?/m) 
    || envContent.match(/^SUI_PRIVATE_KEY="?([^"\r\n]+)"?/m);
  if (!keyMatch) { console.error('No admin key found'); return; }
  const adminKey = keyMatch[1].replace(/\\r\\n/g, '').trim();
  console.log('Key format:', adminKey.substring(0, 12) + '...');
  
  const keypair = adminKey.startsWith('suiprivkey')
    ? Ed25519Keypair.fromSecretKey(adminKey)
    : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
  
  const adminAddress = keypair.getPublicKey().toSuiAddress();
  console.log('Admin address:', adminAddress);
  
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  
  const PACKAGE_ID = '0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88';
  const POOL_STATE_ID = '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a';
  const ADMIN_CAP_ID = '0x8109e15aec55e5ad22e0f91641eda16398b6541d0c0472b113f35b1b59431d78'; // community_pool_usdc::AdminCap
  const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::community_pool_usdc::add_agent`,
    typeArguments: [USDC_TYPE],
    arguments: [
      tx.object(ADMIN_CAP_ID),           // AdminCap
      tx.object(POOL_STATE_ID),           // UsdcPoolState
      tx.pure.address(adminAddress),      // agent address (admin itself)
    ],
  });
  
  tx.setGasBudget(50_000_000);
  
  console.log('Sending add_agent transaction...');
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showObjectChanges: true },
  });
  
  console.log('TX digest:', result.digest);
  console.log('Status:', result.effects?.status?.status);
  
  if (result.effects?.status?.status === 'success') {
    // Find the created AgentCap object
    const created = result.objectChanges?.filter(c => c.type === 'created');
    console.log('Created objects:', JSON.stringify(created, null, 2));
    const agentCap = created?.find(c => c.objectType?.includes('AgentCap'));
    if (agentCap) {
      console.log('\n=== AGENT CAP CREATED ===');
      console.log('AgentCap ID:', agentCap.objectId);
      console.log('Set this as SUI_AGENT_CAP_ID in Vercel env vars');
    }
  } else {
    console.log('Error:', result.effects?.status?.error);
  }
}

main().catch(console.error);
