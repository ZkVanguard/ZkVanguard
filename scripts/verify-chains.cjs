require('dotenv').config({ path: '.env.vercel.temp' });
const { neon } = require('@neondatabase/serverless');

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  
  console.log('=== COMMUNITY POOL CHAIN VERIFICATION ===\n');
  
  // Check auto_hedge_configs
  console.log('1. AUTO_HEDGE_CONFIGS:');
  const configs = await sql`SELECT portfolio_id, wallet_address, allowed_assets, enabled FROM auto_hedge_configs`;
  configs.forEach(c => {
    console.log(`   Portfolio ${c.portfolio_id}: ${c.wallet_address}`);
    console.log(`   Enabled: ${c.enabled} | Assets: ${JSON.stringify(c.allowed_assets)}`);
  });
  
  // Check community_pool_state columns
  console.log('\n2. COMMUNITY_POOL_STATE:');
  const statesCols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'community_pool_state'`;
  console.log('   Columns:', statesCols.map(c => c.column_name).join(', '));
  const states = await sql`SELECT * FROM community_pool_state LIMIT 3`;
  states.forEach(s => console.log('   Row:', JSON.stringify(s)));
  
  // Check NAV history
  console.log('\n3. NAV HISTORY (recent):');
  const nav = await sql`SELECT id, share_price, total_shares, member_count, source FROM community_pool_nav_history ORDER BY id DESC LIMIT 5`;
  nav.forEach(n => {
    console.log(`   ID: ${n.id} | Price: $${n.share_price} | Shares: ${n.total_shares} | Members: ${n.member_count} | Source: ${n.source}`);
  });
  
  // Check community_pool_shares columns
  console.log('\n4. COMMUNITY_POOL_SHARES:');
  const sharesCols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'community_pool_shares'`;
  console.log('   Columns:', sharesCols.map(c => c.column_name).join(', '));
  const shares = await sql`SELECT * FROM community_pool_shares WHERE shares > 0 LIMIT 5`;
  shares.forEach(s => console.log('   Row:', JSON.stringify(s)));
}

main().catch(console.error);
