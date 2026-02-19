// Fix ownership for existing gasless hedges that are missing from hedge_ownership table
const { neon } = require('@neondatabase/serverless');
const sql = neon('postgresql://neondb_owner:npg_Kt7IEjubwA2V@ep-fancy-frost-ahtb29ry-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=verify-full');

// Your wallet address
const USER_WALLET = '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c';

(async () => {
  console.log('=== Fixing Hedge Ownership for Gasless Hedges ===\n');

  // Get all active on-chain hedges that have commitment_hash but might be missing ownership
  const activeHedges = await sql`
    SELECT order_id, commitment_hash, hedge_id_onchain, wallet_address, asset, side, size, leverage, tx_hash, created_at
    FROM hedges 
    WHERE status = 'active' 
      AND on_chain = true
      AND commitment_hash IS NOT NULL
    ORDER BY created_at DESC
  `;
  
  console.log(`Found ${activeHedges.length} active on-chain hedges with commitment_hash:\n`);
  
  for (const h of activeHedges) {
    console.log(`${h.asset} ${h.side}:`);
    console.log(`  commitment: ${h.commitment_hash}`);
    console.log(`  hedge_wallet: ${h.wallet_address}`);
    
    // Check if already in hedge_ownership
    const existing = await sql`
      SELECT wallet_address FROM hedge_ownership WHERE commitment_hash = ${h.commitment_hash}
    `;
    
    if (existing.length > 0) {
      console.log(`  ✅ Already in ownership table: ${existing[0].wallet_address}\n`);
      continue;
    }
    
    // Not in ownership table - add it
    console.log(`  ⚠️ MISSING from ownership table - adding entry...`);
    
    // Determine pair_index from asset
    const pairMap = { BTC: 0, ETH: 1, CRO: 2, ATOM: 3, DOGE: 4, SOL: 5, WBTC: 0 };
    const pairIndex = pairMap[h.asset] || 0;
    
    await sql`
      INSERT INTO hedge_ownership (
        commitment_hash, wallet_address, pair_index, asset, side, 
        collateral, leverage, opened_at, tx_hash, on_chain_hedge_id
      ) VALUES (
        ${h.commitment_hash}, ${USER_WALLET}, ${pairIndex}, ${h.asset}, ${h.side},
        ${h.size}, ${h.leverage}, ${h.created_at.toISOString()}, ${h.tx_hash}, ${h.hedge_id_onchain}
      )
      ON CONFLICT (commitment_hash) DO UPDATE SET
        wallet_address = ${USER_WALLET}
    `;
    
    console.log(`  ✅ Added to hedge_ownership with wallet: ${USER_WALLET}\n`);
  }
  
  console.log('\n=== VERIFICATION ===');
  const allOwnership = await sql`
    SELECT commitment_hash, wallet_address, asset, side FROM hedge_ownership ORDER BY opened_at DESC
  `;
  console.log(`\nHedge ownership table now has ${allOwnership.length} entries:`);
  allOwnership.forEach((o, i) => {
    console.log(`  ${i+1}. ${o.asset} ${o.side} → ${o.wallet_address}`);
  });
})();
