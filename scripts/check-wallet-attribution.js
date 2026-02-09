// Check wallet_address vs proxy_wallet for active hedges
const { neon } = require('@neondatabase/serverless');
const sql = neon('postgresql://neondb_owner:npg_Kt7IEjubwA2V@ep-fancy-frost-ahtb29ry-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require');

(async () => {
  const hedges = await sql`
    SELECT order_id, wallet_address, proxy_wallet, commitment_hash, asset, side, status 
    FROM hedges 
    WHERE status = 'active' 
    ORDER BY created_at DESC 
    LIMIT 5
  `;
  
  console.log('=== Active Hedges - Wallet Attribution ===\n');
  
  if (hedges.length === 0) {
    console.log('No active hedges in DB');
  } else {
    hedges.forEach((h, i) => {
      console.log(`#${i + 1} ${h.asset} ${h.side}:`);
      console.log(`   wallet_address: ${h.wallet_address}`);
      console.log(`   proxy_wallet:   ${h.proxy_wallet}`);
      console.log(`   commitment:     ${h.commitment_hash?.slice(0, 20) || 'null'}...`);
      console.log();
    });
  }
  
  // Also check hedge_ownership table
  const ownership = await sql`
    SELECT commitment_hash, wallet_address, asset, side 
    FROM hedge_ownership 
    ORDER BY opened_at DESC 
    LIMIT 5
  `;
  
  console.log('=== Hedge Ownership Registry ===\n');
  if (ownership.length === 0) {
    console.log('No entries in hedge_ownership table');
  } else {
    ownership.forEach((o, i) => {
      console.log(`#${i + 1} ${o.asset} ${o.side}:`);
      console.log(`   wallet_address: ${o.wallet_address}`);
      console.log(`   commitment:     ${o.commitment_hash?.slice(0, 20)}...`);
      console.log();
    });
  }
})();
