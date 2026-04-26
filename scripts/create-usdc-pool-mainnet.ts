/**
 * Create USDC Community Pool on SUI Mainnet
 * 
 * Calls community_pool_usdc::create_pool<USDC> with:
 * - AdminCap: 0xb329669a...
 * - Treasury: deployer address
 * - Allocation: BTC 30%, ETH 30%, SUI 25%, CRO 15%
 */
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

const PACKAGE_ID = '0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88';
const USDC_ADMIN_CAP = '0x8109e15aec55e5ad22e0f91641eda16398b6541d0c0472b113f35b1b59431d78';
const USDC_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

// Allocation: BTC 30%, ETH 30%, SUI 25%, CRO 15% = 10000 BPS
const BTC_BPS = 3000;
const ETH_BPS = 3000;
const SUI_BPS = 2500;
const CRO_BPS = 1500;

async function main() {
  const privKey = process.env.SUI_POOL_ADMIN_KEY || process.env.SUI_PRIVATE_KEY;
  if (!privKey) throw new Error('Set SUI_POOL_ADMIN_KEY or SUI_PRIVATE_KEY');

  const { secretKey } = decodeSuiPrivateKey(privKey);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const sender = keypair.getPublicKey().toSuiAddress();
  console.log('Sender:', sender);

  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });

  // Verify AdminCap ownership
  const adminCap = await client.getObject({ id: USDC_ADMIN_CAP, options: { showOwner: true } });
  const owner = (adminCap.data?.owner as any)?.AddressOwner;
  if (owner !== sender) {
    throw new Error(`AdminCap owned by ${owner}, not ${sender}`);
  }
  console.log('AdminCap verified ✓');

  // Use sender as treasury
  const treasury = sender;

  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::community_pool_usdc::create_pool`,
    typeArguments: [USDC_COIN_TYPE],
    arguments: [
      tx.object(USDC_ADMIN_CAP),   // &AdminCap
      tx.pure.address(treasury),    // treasury: address
      tx.pure.u64(BTC_BPS),         // btc_bps
      tx.pure.u64(ETH_BPS),         // eth_bps
      tx.pure.u64(SUI_BPS),         // sui_bps
      tx.pure.u64(CRO_BPS),         // cro_bps
      tx.object('0x6'),             // &Clock
    ],
  });

  console.log('Executing create_pool<USDC>...');
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showObjectChanges: true, showEffects: true },
  });

  console.log('TX Digest:', result.digest);
  console.log('Status:', result.effects?.status?.status);

  // Find the created UsdcPoolState
  const created = result.objectChanges?.filter(c => c.type === 'created');
  const poolState = created?.find(c => 
    'objectType' in c && c.objectType.includes('UsdcPoolState')
  );
  
  if (poolState && 'objectId' in poolState) {
    console.log('\n=== USDC POOL CREATED ===');
    console.log('Pool State ID:', poolState.objectId);
    console.log('Object Type:', (poolState as any).objectType);
    console.log('\nSet these env vars on Vercel:');
    console.log(`NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_PACKAGE_ID=${PACKAGE_ID}`);
    console.log(`NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE=${poolState.objectId}`);
  } else {
    console.log('Created objects:', JSON.stringify(created, null, 2));
  }
}

main().catch(console.error);
