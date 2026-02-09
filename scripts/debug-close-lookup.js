/**
 * Debug script to trace exactly what the close endpoint sees
 */
require('dotenv').config({ path: '.env.local' });
const { neon } = require('@neondatabase/serverless');
const { ethers } = require('ethers');

const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('=== DEBUG CLOSE LOOKUP ===\n');

  // 1. Get all hedges (any status) to see what's in DB
  const allHedges = await sql`
    SELECT id, asset, side, commitment_hash, hedge_id_onchain, wallet_address, status
    FROM hedges 
    ORDER BY created_at DESC
    LIMIT 10
  `;

  console.log('All hedges in DB:');
  for (const h of allHedges) {
    console.log(`  ${h.asset} ${h.side} | status: ${h.status} | hedge_id: ${h.hedge_id_onchain?.slice(0,20) || 'null'}`);
  }

  // 2. Check on-chain state (relayer owns gasless hedges)
  const provider = new ethers.JsonRpcProvider('https://evm-t3.cronos.org/');
  const hedge = new ethers.Contract('0x090b6221137690EbB37667E4644287487CE462B9', [
    'function getUserHedges(address) view returns (bytes32[])',
    'function hedges(bytes32) view returns (bytes32,address,uint256,uint256,uint256,uint256,bool,bytes32,bytes32,uint256,uint256,int256,uint8)',
  ], provider);

  const relayer = '0xb61C1cF5152015E66d547F9c1c45cC592a870D10';
  const ids = await hedge.getUserHedges(relayer);
  const statuses = ['PENDING','ACTIVE','CLOSED','LIQUIDATED','CANCELLED'];
  
  console.log('\nOn-chain hedges (relayer):');
  for (const id of ids) {
    const d = await hedge.hedges(id);
    console.log(`  ${id.slice(0,20)}... | status: ${statuses[Number(d[12])]}`);
  }

  // 3. Get active hedges for comparison
  const hedges = await sql`
    SELECT id, asset, side, commitment_hash, hedge_id_onchain, wallet_address, status
    FROM hedges 
    WHERE status = 'ACTIVE'
    ORDER BY created_at DESC
  `;

  console.log('Active hedges in DB:');
  for (const h of hedges) {
    console.log(`\n${h.asset} ${h.side}:`);
    console.log('  hedgeId (sent to close API):', h.hedge_id_onchain);
    console.log('  commitment_hash:', h.commitment_hash);
    console.log('  wallet_address in hedges table:', h.wallet_address);
  }

  // 2. Get all ownership entries
  const ownership = await sql`SELECT * FROM hedge_ownership`;
  
  console.log('\n\nOwnership table entries:');
  for (const o of ownership) {
    console.log(`\n${o.asset} ${o.side}:`);
    console.log('  commitment_hash:', o.commitment_hash);
    console.log('  on_chain_hedge_id:', o.on_chain_hedge_id);
    console.log('  wallet_address:', o.wallet_address);
  }

  // 3. Test actual lookups
  console.log('\n\n=== TESTING LOOKUPS ===');
  for (const h of hedges) {
    if (!h.hedge_id_onchain) {
      console.log(`\n${h.asset} ${h.side}: No hedge_id_onchain, skip lookup test`);
      continue;
    }
    
    const lookupValue = h.hedge_id_onchain.toLowerCase();
    console.log(`\nLooking up: ${lookupValue}`);
    
    const found = await sql`
      SELECT wallet_address, commitment_hash, on_chain_hedge_id
      FROM hedge_ownership 
      WHERE commitment_hash = ${lookupValue} OR on_chain_hedge_id = ${lookupValue}
    `;
    
    if (found.length > 0) {
      console.log('  ✅ FOUND in hedge_ownership:', found[0].wallet_address);
    } else {
      console.log('  ❌ NOT FOUND in hedge_ownership');
      
      // Check if it exists with different case
      const allOwnership = await sql`SELECT * FROM hedge_ownership`;
      for (const o of allOwnership) {
        if (o.on_chain_hedge_id && o.on_chain_hedge_id.toLowerCase() === lookupValue) {
          console.log('  ⚠️ Found with case mismatch! Stored as:', o.on_chain_hedge_id);
        }
        if (o.commitment_hash && o.commitment_hash.toLowerCase() === lookupValue) {
          console.log('  ⚠️ Found via commitment_hash:', o.commitment_hash);
        }
      }
    }
  }
}

main().catch(console.error);
