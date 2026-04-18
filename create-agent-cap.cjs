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
  
  const PACKAGE_ID = '0x900bca6461ad24c86b83c974788b457cb76c3f6f4fd7b061c5b58cb40d974bab';
  const POOL_STATE_ID = '0xf7127c7d55131847b702481deb2ebee0c81150f9738d5f679cd7b1a998e620d8';
  const ADMIN_CAP_ID = '0xb329669a572b1ae94bab33bbc9f2b8f5808658c2d3b5d713c49d7afbcd94176b'; // community_pool_usdc::AdminCap
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
