/**
 * Sync On-Chain Hedges to Database
 * 
 * Updates the hedges in the database with their on-chain transaction hashes
 * and marks them as on_chain = true
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.join(__dirname, "../.env.local") });

async function main() {
  console.log("======================================");
  console.log("  SYNC ON-CHAIN HEDGES TO DATABASE");
  console.log("======================================\n");
  
  // Load the on-chain hedge data
  const hedgeDataPath = path.join(__dirname, "../deployments/portfolio-3-hedges.json");
  const hedgeData = JSON.parse(fs.readFileSync(hedgeDataPath, "utf8"));
  
  console.log(`Portfolio ID: ${hedgeData.portfolioId}`);
  console.log(`Created At: ${hedgeData.createdAt}`);
  console.log(`Total Hedges: ${hedgeData.hedges.length}`);
  console.log(`Successful: ${hedgeData.hedges.filter(h => h.status === "SUCCESS").length}\n`);
  
  // Connect to database
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL
  });
  
  try {
    const client = await pool.connect();
    console.log("✅ Connected to database\n");
    
    // First, update existing hedges for Portfolio #3 to be on-chain
    for (const hedge of hedgeData.hedges) {
      if (hedge.status !== "SUCCESS") {
        console.log(`⚠️  Skipping ${hedge.name} (failed)`);
        continue;
      }
      
      const assetMap = {
        "BTC SHORT": "BTC",
        "ETH SHORT": "ETH",
        "CRO LONG": "CRO",
        "SUI LONG": "SUI"
      };
      
      const asset = assetMap[hedge.name] || hedge.name.split(" ")[0];
      const direction = hedge.isLong ? "LONG" : "SHORT";
      
      console.log(`─── ${hedge.name} ───`);
      console.log(`  On-chain ID: ${hedge.hedgeId.slice(0, 20)}...`);
      console.log(`  Tx Hash: ${hedge.txHash.slice(0, 20)}...`);
      
      // Check if hedge already exists for this portfolio/asset
      const existing = await client.query(`
        SELECT id, hedge_id_onchain, on_chain 
        FROM hedges 
        WHERE portfolio_id = $1 AND UPPER(asset) = UPPER($2) AND side = $3
        ORDER BY created_at DESC
        LIMIT 1
      `, [hedgeData.portfolioId, asset, direction]);
      
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        console.log(`  Existing hedge found: ID ${row.id}`);
        
        // Update to on-chain
        await client.query(`
          UPDATE hedges 
          SET 
            on_chain = true,
            hedge_id_onchain = $1,
            tx_hash = $2,
            updated_at = NOW()
          WHERE id = $3
        `, [hedge.hedgeId, hedge.txHash, row.id]);
        
        console.log(`  ✅ Updated to on-chain!\n`);
      } else {
        // Create new hedge record
        console.log(`  Creating new hedge record...`);
        
        const leverage = hedge.leverage;
        const size = parseFloat(hedge.collateral) * leverage;
        
        await client.query(`
          INSERT INTO hedges (
            order_id, portfolio_id, wallet_address, asset, market, side, leverage, size, notional_value, entry_price,
            status, on_chain, hedge_id_onchain, tx_hash, created_at, updated_at,
            simulation_mode
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            'active', true, $11, $12, NOW(), NOW(),
            false
          )
        `, [
          `ONCHAIN_${hedge.name.replace(' ', '_')}_${Date.now()}`,
          hedgeData.portfolioId,
          '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c', // deployer wallet
          asset,
          `${asset}/USDC`,
          direction,
          leverage,
          size,
          size, // notional = size for now
          0, // Entry price to be updated
          hedge.hedgeId,
          hedge.txHash
        ]);
        
        console.log(`  ✅ Created new on-chain hedge!\n`);
      }
    }
    
    // Show final state
    console.log("\n══════════════════════════════════════");
    console.log("  FINAL STATE");
    console.log("══════════════════════════════════════");
    
    const finalState = await client.query(`
      SELECT id, asset, side, leverage, size, on_chain, hedge_id_onchain, status
      FROM hedges 
      WHERE portfolio_id = $1
      ORDER BY created_at DESC
    `, [hedgeData.portfolioId]);
    
    console.log(`\nPortfolio #${hedgeData.portfolioId} Hedges:`);
    for (const row of finalState.rows) {
      const onChainIcon = row.on_chain ? "🔗" : "📝";
      console.log(`  ${onChainIcon} ${row.asset} ${row.side} ${row.leverage}x - $${row.size} - ${row.status}`);
      if (row.hedge_id_onchain) {
        console.log(`     └─ ${row.hedge_id_onchain.slice(0, 30)}...`);
      }
    }
    
    // Count on-chain vs off-chain
    const counts = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE on_chain = true) AS on_chain_count,
        COUNT(*) FILTER (WHERE on_chain = false OR on_chain IS NULL) AS off_chain_count
      FROM hedges 
      WHERE portfolio_id = $1 AND status = 'active'
    `, [hedgeData.portfolioId]);
    
    console.log(`\nOn-chain: ${counts.rows[0].on_chain_count}`);
    console.log(`Off-chain: ${counts.rows[0].off_chain_count}`);
    
    client.release();
    console.log("\n✅ Sync complete!");
    
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await pool.end();
  }
}

main();
