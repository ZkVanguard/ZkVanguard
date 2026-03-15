/**
 * Update Auto-Hedge Config to V3
 */

const { neon } = require('@neondatabase/serverless');
const path = require('path');

// Load env
const envFiles = ['.env.local', '.env.vercel.temp', '.env.prod'];
for (const envFile of envFiles) {
  require('dotenv').config({ path: path.join(__dirname, '..', envFile) });
  if (process.env.DATABASE_URL) break;
}

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const V3_ADDRESS = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';

async function main() {
  const sql = neon(DATABASE_URL);
  
  console.log('Updating auto-hedge config to use V3 address...\n');
  
  // Update the config (wallet_address is the pool address for Community Pool)
  await sql`UPDATE auto_hedge_configs SET wallet_address = ${V3_ADDRESS} WHERE portfolio_id = -1`;
  
  // Verify
  const result = await sql`SELECT * FROM auto_hedge_configs WHERE portfolio_id = -1`;
  
  if (result.length > 0) {
    console.log('✅ Auto-Hedge Config Updated:');
    console.log(`   Portfolio ID: ${result[0].portfolio_id}`);
    console.log(`   Wallet/Pool Address: ${result[0].wallet_address}`);
    console.log(`   Enabled: ${result[0].enabled}`);
    console.log(`   Risk Threshold: ${result[0].risk_threshold}/10`);
    console.log(`   Max Leverage: ${result[0].max_leverage}x`);
    console.log(`   Allowed Assets: ${JSON.stringify(result[0].allowed_assets)}`);
  } else {
    console.log('⚠️  No config found, creating...');
    await sql`
      INSERT INTO auto_hedge_configs (portfolio_id, wallet_address, enabled, risk_threshold, max_leverage, allowed_assets)
      VALUES (-1, ${V3_ADDRESS}, true, 4, 3, '["BTC", "ETH", "CRO", "SUI"]'::jsonb)
    `;
    console.log('✅ Created auto-hedge config for Community Pool');
  }
  
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
