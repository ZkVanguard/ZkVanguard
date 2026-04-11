/**
 * Create Community Pool on SUI Mainnet
 * Calls create_pool() to initialize the shared CommunityPoolState
 */
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

const PACKAGE_ID = '0x900bca6461ad24c86b83c974788b457cb76c3f6f4fd7b061c5b58cb40d974bab';
const ADMIN_CAP = '0x13ce930ebffc3888e1c1376a7f6726714bc9a2e9dbe113744a02c7a44a60fce2';
const TREASURY = '0x83b9f1bc3a2d32685e67fc52dce547e4e817afeeed90a996e8c6931e0ba35f2b';

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  const { secretKey } = decodeSuiPrivateKey(process.env.SUI_PRIVATE_KEY!);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const address = keypair.toSuiAddress();

  console.log('Address:', address);

  const bal = await client.getBalance({ owner: address });
  console.log('Balance:', Number(bal.totalBalance) / 1e9, 'SUI');

  // Check for existing pool
  console.log('Checking for existing PoolCreated events...');
  const events = await client.queryEvents({
    query: { MoveEventType: `${PACKAGE_ID}::community_pool::PoolCreated` },
    limit: 5,
  });

  if (events.data.length > 0) {
    console.log('Pool already created!');
    console.log(JSON.stringify(events.data, null, 2));
    return;
  }

  console.log('No existing pool. Creating...');

  const tx = new Transaction();
  tx.setSender(address);
  tx.moveCall({
    target: `${PACKAGE_ID}::community_pool::create_pool`,
    arguments: [
      tx.object(ADMIN_CAP),
      tx.pure.address(TREASURY),
      tx.object('0x6'),
    ],
  });
  tx.setGasBudget(50_000_000);

  // Dry run
  console.log('Dry running...');
  const dryRun = await client.dryRunTransactionBlock({
    transactionBlock: await tx.build({ client }),
  });

  if (dryRun.effects.status.status !== 'success') {
    console.log('Dry run FAILED:', JSON.stringify(dryRun.effects.status, null, 2));
    return;
  }
  console.log('Dry run OK, gas:', JSON.stringify(dryRun.effects.gasUsed));

  // Execute
  console.log('Executing create_pool()...');
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
  });

  console.log('TX Digest:', result.digest);
  console.log('TX Link: https://suiscan.xyz/mainnet/tx/' + result.digest);

  await client.waitForTransaction({ digest: result.digest });

  const txDetails = await client.getTransactionBlock({
    digest: result.digest,
    options: { showObjectChanges: true, showEvents: true },
  });

  console.log('\nEvents:', JSON.stringify(txDetails.events, null, 2));
  console.log('\nCreated Objects:');
  txDetails.objectChanges?.forEach(obj => {
    if (obj.type === 'created') {
      console.log(`  ${obj.objectType} => ${obj.objectId}`);
    }
  });

  const poolState = txDetails.objectChanges?.find(
    obj => obj.type === 'created' && obj.objectType?.includes('CommunityPoolState')
  );

  if (poolState && 'objectId' in poolState) {
    console.log('\n════════════════════════════════════════');
    console.log('  POOL STATE ID:', poolState.objectId);
    console.log('════════════════════════════════════════');
    console.log('\nAdd to .env.local:');
    console.log(`NEXT_PUBLIC_SUI_POOL_STATE_ID=${poolState.objectId}`);
    console.log(`NEXT_PUBLIC_SUI_MAINNET_COMMUNITY_POOL_STATE=${poolState.objectId}`);
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
