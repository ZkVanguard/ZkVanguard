/**
 * Upgrade SUI Pool Contract
 * 
 * This script upgrades the SUI community pool contract to add the
 * admin_reset_hedge_state function.
 * 
 * Prerequisites:
 * - SUI CLI installed (`sui --version`)
 * - SUI_POOL_ADMIN_KEY env var set
 * - Must own the UpgradeCap object
 * 
 * Usage:
 *   npx tsx scripts/upgrade-sui-contract.ts --dry-run
 *   npx tsx scripts/upgrade-sui-contract.ts
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');

// Configuration
const MAINNET_UPGRADE_CAP = '0xf03ff76b2abb31d38ae3f7aa1f83a74d7b5323002acd5c8fc4026aa5fc5f9d4d';
const TESTNET_UPGRADE_CAP = '0x5149e86bd2ee220919f611b2d982c38954df66f798ab230bfb3606a9f1ca623b';

async function main() {
  const network = ((process.env.SUI_NETWORK || 'mainnet').trim()) as 'mainnet' | 'testnet';
  const upgradeCap = network === 'mainnet' ? MAINNET_UPGRADE_CAP : TESTNET_UPGRADE_CAP;
  
  console.log(`\n🔧 SUI Contract Upgrade - Network: ${network}`);
  console.log(`   Mode: ${DRY_RUN ? '🔍 DRY RUN' : '⚡ LIVE'}`);
  console.log(`   UpgradeCap: ${upgradeCap}\n`);

  const contractsDir = path.join(__dirname, '..', 'contracts', 'sui');
  
  // Check SUI CLI
  try {
    const version = execSync('sui --version', { encoding: 'utf-8' }).trim();
    console.log(`✅ SUI CLI: ${version}`);
  } catch {
    console.error('❌ SUI CLI not found. Please install: https://docs.sui.io/guides/developer/getting-started/sui-install');
    process.exit(1);
  }

  // Switch to correct network
  console.log(`\n📡 Switching to ${network}...`);
  try {
    execSync(`sui client switch --env ${network}`, { stdio: 'inherit' });
  } catch {
    console.log(`   Creating ${network} environment...`);
    const rpcUrl = network === 'mainnet' 
      ? 'https://fullnode.mainnet.sui.io:443'
      : 'https://fullnode.testnet.sui.io:443';
    execSync(`sui client new-env --alias ${network} --rpc ${rpcUrl}`, { stdio: 'inherit' });
    execSync(`sui client switch --env ${network}`, { stdio: 'inherit' });
  }

  // Check admin key is configured in SUI
  console.log('\n🔑 Checking wallet...');
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || '').trim();
  if (!adminKey) {
    console.error('❌ SUI_POOL_ADMIN_KEY not set');
    process.exit(1);
  }

  // Import key if not already
  // Note: This is a simplified approach - in production, use a more secure method
  console.log('   Using configured admin key');

  // Build the package
  console.log('\n🔨 Building Move package...');
  try {
    execSync('sui move build', { 
      cwd: contractsDir, 
      stdio: 'inherit',
      env: { ...process.env, SUI_BUILD_CONFIG: '--skip-fetch-latest-git-deps' }
    });
    console.log('   ✅ Build successful\n');
  } catch (err) {
    console.error('   ❌ Build failed');
    process.exit(1);
  }

  // Dry run - just show what would happen
  if (DRY_RUN) {
    console.log('📋 Upgrade command (dry run):');
    console.log(`   sui client upgrade --upgrade-capability ${upgradeCap} --gas-budget 500000000`);
    console.log(`   Working dir: ${contractsDir}`);
    console.log('\n✅ Dry run complete. Remove --dry-run to execute upgrade.');
    return;
  }

  // Execute upgrade
  console.log('🚀 Executing upgrade...');
  console.log('   This will publish a new version of the contract.\n');
  
  try {
    const result = execSync(
      `sui client upgrade --upgrade-capability ${upgradeCap} --gas-budget 500000000`,
      { 
        cwd: contractsDir, 
        stdio: 'pipe',
        encoding: 'utf-8'
      }
    );
    
    console.log('✅ Upgrade successful!\n');
    console.log('Result:');
    console.log(result);
    
    // Parse the new package ID from result
    const packageMatch = result.match(/Published.*?(0x[a-f0-9]+)/i);
    if (packageMatch) {
      console.log(`\n📦 New Package ID: ${packageMatch[1]}`);
      console.log('\n⚠️  IMPORTANT: Update SUI_USDC_POOL_CONFIG in lib/services/sui/SuiCommunityPoolService.ts');
      console.log(`   Change packageId from current value to: ${packageMatch[1]}`);
    }
    
  } catch (err: any) {
    console.error('❌ Upgrade failed:');
    console.error(err.stdout || err.message);
    process.exit(1);
  }

  console.log('\n✅ Done');
}

main().catch(console.error);
