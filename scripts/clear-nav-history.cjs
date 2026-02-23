const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

async function clearNavHistory() {
  console.log('Clearing NAV history with only $1.00 entries...');
  
  // Delete entries where all prices are $1.00 (no variation)
  await sql`DELETE FROM community_pool_nav_history WHERE share_price = 1.0`;
  
  console.log('Cleared!');
  
  // Verify
  const remaining = await sql`SELECT COUNT(*) as count FROM community_pool_nav_history`;
  console.log('Remaining NAV entries:', remaining[0].count);
  
  // Show transaction data
  const txPrices = await sql`
    SELECT DISTINCT share_price, COUNT(*) as count 
    FROM community_pool_transactions 
    WHERE share_price IS NOT NULL 
    GROUP BY share_price 
    ORDER BY share_price
  `;
  console.log('Transaction prices (will be used for metrics):', JSON.stringify(txPrices, null, 2));
}

clearNavHistory()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
