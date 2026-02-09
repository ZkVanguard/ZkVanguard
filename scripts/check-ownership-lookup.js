// Quick debug to check hedge ownership lookup
const { neon } = require('@neondatabase/serverless');
const sql = neon('postgresql://neondb_owner:npg_Kt7IEjubwA2V@ep-fancy-frost-ahtb29ry-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require');

(async () => {
  console.log('=== CHECKING HEDGE OWNERSHIP LOOKUP ===\n');
  
  // Check hedges table
  const hedges = await sql`
    SELECT commitment_hash, hedge_id_onchain, wallet_address, asset, side, status
    FROM hedges 
    WHERE status = 'active' OR created_at > NOW() - INTERVAL '1 day'
    ORDER BY created_at DESC
    LIMIT 3
  `;
  
  console.log('HEDGES TABLE (recent):');
  hedges.forEach((h, i) => {
    console.log(`  #${i+1} ${h.asset} ${h.side} (${h.status}):`);
    console.log(`     wallet: ${h.wallet_address}`);
    console.log(`     commitment_hash: ${h.commitment_hash || 'NULL'}`);
    console.log(`     hedge_id_onchain: ${h.hedge_id_onchain || 'NULL'}`);
  });
  
  // Check hedge_ownership table
  const ownership = await sql`
    SELECT commitment_hash, on_chain_hedge_id, wallet_address, asset
    FROM hedge_ownership
    ORDER BY opened_at DESC
    LIMIT 3
  `;
  
  console.log('\nHEDGE_OWNERSHIP TABLE:');
  if (ownership.length === 0) {
    console.log('  (empty)');
  } else {
    ownership.forEach((o, i) => {
      console.log(`  #${i+1} ${o.asset}:`);
      console.log(`     wallet: ${o.wallet_address}`);
      console.log(`     commitment_hash: ${o.commitment_hash || 'NULL'}`);
      console.log(`     on_chain_hedge_id: ${o.on_chain_hedge_id || 'NULL'}`);
    });
  }

  // If we have a hedge, simulate the lookup
  if (hedges.length > 0) {
    const h = hedges[0];
    console.log('\n=== SIMULATING CLOSE LOOKUP ===');
    console.log(`Looking for hedgeId: ${h.hedge_id_onchain}`);
    
    // Check if it would be found
    const found = await sql`
      SELECT wallet_address FROM hedges 
      WHERE commitment_hash = ${h.hedge_id_onchain} OR hedge_id_onchain = ${h.hedge_id_onchain}
    `;
    console.log(`Found in hedges table: ${found.length > 0 ? 'YES - ' + found[0].wallet_address : 'NO'}`);
    
    const foundOwnership = await sql`
      SELECT wallet_address FROM hedge_ownership 
      WHERE commitment_hash = ${h.hedge_id_onchain} OR on_chain_hedge_id = ${h.hedge_id_onchain}
    `;
    console.log(`Found in ownership table: ${foundOwnership.length > 0 ? 'YES - ' + foundOwnership[0].wallet_address : 'NO'}`);
  }
})();
