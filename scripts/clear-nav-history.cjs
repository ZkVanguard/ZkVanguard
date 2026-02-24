const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

async function clearNavHistory() {
  console.log('Clearing ALL NAV history (reset for accurate metrics)...');
  
  // Show current data
  const current = await sql`SELECT id, total_nav, share_price, timestamp FROM community_pool_nav_history ORDER BY timestamp DESC LIMIT 5`;
  console.log('Current NAV entries:', JSON.stringify(current, null, 2));
  
  // Delete ALL entries to reset metrics
  const deleted = await sql`DELETE FROM community_pool_nav_history RETURNING id`;
  console.log(`Deleted ${deleted.length} NAV history entries`);
  
  // Now insert a single correct starting point using real-time NAV
  // Pool has ~280 shares, share price ~$6.825 = ~$1911 NAV
  const realTimeNAV = 1911.0;  // Calculated from live prices
  const realSharePrice = 6.825; // NAV / 280 shares
  const totalShares = 280;
  
  await sql`
    INSERT INTO community_pool_nav_history 
    (total_nav, share_price, total_shares, member_count, allocations, source)
    VALUES (${realTimeNAV}, ${realSharePrice}, ${totalShares}, 28, 
      '{"BTC": 35, "ETH": 30, "SUI": 20, "CRO": 15}'::jsonb, 
      'manual-reset')
  `;
  console.log('Inserted fresh NAV snapshot: NAV=$1911, SharePrice=$6.825');
  
  // Verify
  const remaining = await sql`SELECT COUNT(*) as count FROM community_pool_nav_history`;
  console.log('NAV entries after reset:', remaining[0].count);
}

clearNavHistory()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
