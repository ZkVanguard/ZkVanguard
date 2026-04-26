/**
 * Refund Old Pool Depositor
 * 
 * The depositor (0x880c) deposited $50 USDC into the old SUI community pool.
 * They withdrew $20.76 back, but $29.24 was transferred to admin via open_hedge
 * and never returned (close_hedge was never called).
 * 
 * This script sends $29.24 USDC from admin wallet to the depositor to make them whole.
 * 
 * PREREQUISITE: Admin must have >= $29.24 USDC in wallet.
 * Currently admin only has ~$0.04 USDC — need to swap wBTC → USDC first.
 * 
 * Usage: node scripts/refund-depositor.cjs [--dry-run]
 */

const DEPOSITOR = '0x880cfa491c497f5f3c8205ef43a9e1d4cd89169a20c708ab27676ec1fe7e8aac';
const ADMIN_KEY = '***REDACTED_LEAKED_KEY_1***';
const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const REFUND_AMOUNT_USDC = 29.24; // Exact amount owed
const REFUND_AMOUNT_RAW = Math.floor(REFUND_AMOUNT_USDC * 1e6); // 29240000

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
  const { Transaction } = await import('@mysten/sui/transactions');
  const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

  const keypair = Ed25519Keypair.fromSecretKey(ADMIN_KEY);
  const adminAddress = keypair.getPublicKey().toSuiAddress();
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });

  console.log('=== DEPOSITOR REFUND ===');
  console.log('Admin:', adminAddress);
  console.log('Depositor:', DEPOSITOR);
  console.log('Refund Amount:', REFUND_AMOUNT_USDC, 'USDC');
  console.log('Dry Run:', isDryRun);
  console.log('');

  // Check admin USDC balance
  const balance = await client.getBalance({ owner: adminAddress, coinType: USDC_TYPE });
  const adminUsdc = Number(balance.totalBalance) / 1e6;
  console.log('Admin USDC balance:', adminUsdc.toFixed(6));

  if (adminUsdc < REFUND_AMOUNT_USDC) {
    console.error(`\nERROR: Insufficient USDC. Need $${REFUND_AMOUNT_USDC} but admin only has $${adminUsdc.toFixed(6)}`);
    console.error('Action required: Swap wBTC → USDC on a DEX first.');
    
    // Show wBTC balance
    const allBal = await client.getAllBalances({ owner: adminAddress });
    for (const b of allBal) {
      if (b.coinType.includes('af8cd5ed') || b.coinType.includes('BTC')) {
        const wbtc = Number(b.totalBalance) / 1e8;
        console.log(`\nAdmin wBTC: ${wbtc.toFixed(8)} (~$${(wbtc * 85000).toFixed(2)} at $85k)`);
        console.log('Swap at least 0.00035 wBTC (~$30) to USDC to fund this refund.');
      }
    }
    process.exit(1);
  }

  // Check depositor's current USDC balance
  const depBal = await client.getBalance({ owner: DEPOSITOR, coinType: USDC_TYPE });
  console.log('Depositor USDC balance (before):', (Number(depBal.totalBalance) / 1e6).toFixed(6));

  if (isDryRun) {
    console.log('\n[DRY RUN] Would transfer', REFUND_AMOUNT_USDC, 'USDC to depositor');
    console.log('[DRY RUN] No transaction executed');
    return;
  }

  // Get admin's USDC coins
  const coins = await client.getCoins({ owner: adminAddress, coinType: USDC_TYPE });
  if (!coins.data?.length) {
    console.error('No USDC coin objects found');
    process.exit(1);
  }

  const tx = new Transaction();

  // Merge all USDC coins, then split exact refund amount
  let primaryCoin;
  if (coins.data.length === 1) {
    primaryCoin = tx.object(coins.data[0].coinObjectId);
  } else {
    primaryCoin = tx.object(coins.data[0].coinObjectId);
    const mergeCoins = coins.data.slice(1).map(c => tx.object(c.coinObjectId));
    if (mergeCoins.length > 0) {
      tx.mergeCoins(primaryCoin, mergeCoins);
    }
  }

  const [refundCoin] = tx.splitCoins(primaryCoin, [REFUND_AMOUNT_RAW]);
  tx.transferObjects([refundCoin], DEPOSITOR);
  tx.setGasBudget(10_000_000);

  console.log('\nExecuting refund transaction...');
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true },
  });

  const success = result.effects?.status?.status === 'success';
  console.log('Result:', success ? 'SUCCESS' : 'FAILED');
  console.log('TX Digest:', result.digest);
  
  if (!success) {
    console.error('Error:', result.effects?.status?.error);
    process.exit(1);
  }

  // Verify
  await new Promise(r => setTimeout(r, 3000));
  const depBalAfter = await client.getBalance({ owner: DEPOSITOR, coinType: USDC_TYPE });
  console.log('\nDepositor USDC balance (after):', (Number(depBalAfter.totalBalance) / 1e6).toFixed(6));
  console.log('Refund complete! Depositor is made whole.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
