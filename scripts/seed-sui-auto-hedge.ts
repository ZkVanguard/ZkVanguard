/**
 * Seed SUI USDC Pool Auto-Hedge Config to Database
 * 
 * This adds the SUI community pool to the auto_hedge_configs table
 * so that automatic hedging via BlueFin will work in production.
 * 
 * Usage: npx tsx scripts/seed-sui-auto-hedge.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { saveAutoHedgeConfig, getAutoHedgeConfigs } from '../lib/storage/auto-hedge-storage';
import { SUI_COMMUNITY_POOL_PORTFOLIO_ID, SUI_COMMUNITY_POOL_STATE } from '../lib/constants';

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('   SEED SUI USDC POOL AUTO-HEDGE CONFIG');
  console.log('═══════════════════════════════════════════════════════\n');

  // Check if already exists
  const existingConfigs = await getAutoHedgeConfigs();
  const existing = existingConfigs.find(c => c.portfolioId === SUI_COMMUNITY_POOL_PORTFOLIO_ID);
  
  if (existing) {
    console.log('✅ SUI pool config already exists:');
    console.log(`   Portfolio ID: ${existing.portfolioId}`);
    console.log(`   Enabled: ${existing.enabled}`);
    console.log(`   Risk Threshold: ${existing.riskThreshold}`);
    console.log(`   Max Leverage: ${existing.maxLeverage}`);
    console.log(`   Allowed Assets: ${existing.allowedAssets.join(', ')}`);
    return;
  }

  // Create SUI pool config
  const suiAdminAddress = process.env.SUI_ADMIN_ADDRESS;
  if (!suiAdminAddress) {
    console.error('\n❌ SUI_ADMIN_ADDRESS not set in environment');
    process.exit(1);
  }
  
  const suiPoolConfig = {
    portfolioId: SUI_COMMUNITY_POOL_PORTFOLIO_ID, // -2
    walletAddress: suiAdminAddress,
    enabled: true,
    riskThreshold: 2, // Hedge when risk >= 2/10
    maxLeverage: 3,
    allowedAssets: ['BTC', 'ETH', 'SUI', 'CRO'],
    riskTolerance: 20,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  console.log('📝 Creating SUI pool config:');
  console.log(`   Portfolio ID: ${suiPoolConfig.portfolioId}`);
  console.log(`   Pool State: ${SUI_COMMUNITY_POOL_STATE}`);
  console.log(`   Enabled: ${suiPoolConfig.enabled}`);
  console.log(`   Risk Threshold: ${suiPoolConfig.riskThreshold}`);
  console.log(`   Max Leverage: ${suiPoolConfig.maxLeverage}`);
  console.log(`   Allowed Assets: ${suiPoolConfig.allowedAssets.join(', ')}`);

  try {
    await saveAutoHedgeConfig(suiPoolConfig);
    console.log('\n✅ ✅ ✅  SUI POOL CONFIG SAVED! ✅ ✅ ✅');
    console.log('\nAuto-hedging is now enabled for the SUI USDC pool.');
    console.log('When risk score >= 2/10, SHORT hedges will open on BlueFin.');
  } catch (error) {
    console.error('\n❌ Failed to save config:', error);
    process.exit(1);
  }
}

main().catch(console.error);
