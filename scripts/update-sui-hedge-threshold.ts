/**
 * Update SUI Pool Auto-Hedge Threshold
 * 
 * Lowers the risk threshold so hedging triggers more easily for testing.
 * 
 * Usage: npx tsx scripts/update-sui-hedge-threshold.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { query } from '../lib/db/postgres';
import { SUI_COMMUNITY_POOL_PORTFOLIO_ID } from '../lib/constants';

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('   UPDATE SUI POOL RISK THRESHOLD');
  console.log('═══════════════════════════════════════════════════════\n');

  const newThreshold = parseInt(process.argv[2] || '1');
  
  console.log(`📝 Updating risk_threshold to ${newThreshold} for portfolio ${SUI_COMMUNITY_POOL_PORTFOLIO_ID}`);

  const result = await query(`
    UPDATE auto_hedge_configs 
    SET risk_threshold = $1, updated_at = CURRENT_TIMESTAMP
    WHERE portfolio_id = $2
    RETURNING *
  `, [newThreshold, SUI_COMMUNITY_POOL_PORTFOLIO_ID]);

  if (result.length > 0) {
    const row = result[0];
    console.log('\n✅ Config updated:');
    console.log(`   Portfolio ID: ${row.portfolio_id}`);
    console.log(`   Enabled: ${row.enabled}`);
    console.log(`   Risk Threshold: ${row.risk_threshold} (was 2)`);
    console.log(`   Max Leverage: ${row.max_leverage}`);
    console.log('\n🔔 Hedging will now trigger when risk >= ' + newThreshold + '/10');
  } else {
    console.log('❌ Config not found for portfolio ' + SUI_COMMUNITY_POOL_PORTFOLIO_ID);
  }
}

main().catch(console.error);
