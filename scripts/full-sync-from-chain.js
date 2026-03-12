/**
 * Complete sync script - syncs all pool data from on-chain to DB
 * FIXED: Properly zeros out all DB entries not found on-chain
 */
const hre = require("hardhat");
const { neon } = require('@neondatabase/serverless');

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  const POOL_ADDRESS = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';

  const Pool = await hre.ethers.getContractFactory("CommunityPool");
  const pool = Pool.attach(POOL_ADDRESS);

  console.log('=== AUTHORITATIVE ON-CHAIN SYNC ===\n');

  // 1. Get all on-chain state
  console.log('1. Fetching on-chain pool state...');
  const [totalShares, nav, memberCount] = await Promise.all([
    pool.totalShares(),
    pool.calculateTotalNAV(),
    pool.getMemberCount()
  ]);

  const sharesNum = Number(totalShares) / 1e18;
  const navNum = Number(nav) / 1e6;
  const sharePrice = sharesNum > 0 ? navNum / sharesNum : 1.0;
  
  console.log(`   Total Shares: ${sharesNum.toFixed(4)}`);
  console.log(`   NAV: $${navNum.toFixed(2)}`);
  console.log(`   Share Price: $${sharePrice.toFixed(6)}`);
  console.log(`   On-chain memberList count: ${memberCount}`);

  // 2. Get ALL members from on-chain with their shares
  console.log('\n2. Fetching all on-chain members...');
  const count = Number(memberCount);
  const onChainMembers = new Map(); // address -> { shares, depositedUSD }
  
  for (let i = 0; i < count; i++) {
    const addr = await pool.memberList(i);
    const memberData = await pool.members(addr);
    const shares = Number(memberData[0]) / 1e18;
    const depositedUSD = Number(memberData[1]) / 1e6;
    
    onChainMembers.set(addr.toLowerCase(), { shares, depositedUSD });
    
    if (shares > 0) {
      console.log(`   [ACTIVE] ${addr.slice(0,10)}...: ${shares.toFixed(2)} shares`);
    } else {
      console.log(`   [INACTIVE] ${addr.slice(0,10)}...: 0 shares`);
    }
  }

  // 3. Get ALL DB records
  console.log('\n3. Syncing DB with on-chain (authoritative)...');
  const dbRecords = await sql`SELECT id, wallet_address, shares FROM community_pool_shares`;
  console.log(`   DB has ${dbRecords.length} records`);

  let zeroed = 0;
  let updated = 0;
  let removed = 0;

  for (const record of dbRecords) {
    const addrLower = record.wallet_address.toLowerCase();
    const onChainData = onChainMembers.get(addrLower);
    
    if (!onChainData) {
      // Address NOT in on-chain memberList at all - DELETE it
      const currentShares = Number(record.shares);
      if (currentShares > 0) {
        console.log(`   DELETING ghost: ${record.wallet_address.slice(0,10)}... (had ${currentShares.toFixed(2)} shares - NOT ON CHAIN)`);
        await sql`DELETE FROM community_pool_shares WHERE id = ${record.id}`;
        removed++;
      }
    } else {
      // Address is in on-chain - sync shares
      const onChainShares = onChainData.shares;
      const currentShares = Number(record.shares);
      
      if (Math.abs(currentShares - onChainShares) > 0.001) {
        console.log(`   UPDATING: ${record.wallet_address.slice(0,10)}... ${currentShares.toFixed(2)} -> ${onChainShares.toFixed(2)}`);
        await sql`UPDATE community_pool_shares SET shares = ${onChainShares} WHERE id = ${record.id}`;
        if (onChainShares === 0 && currentShares > 0) zeroed++;
        else updated++;
      }
    }
  }

  // 4. Add any on-chain members missing from DB
  for (const [addr, data] of onChainMembers) {
    if (data.shares > 0) {
      const exists = await sql`SELECT 1 FROM community_pool_shares WHERE LOWER(wallet_address) = ${addr}`;
      if (exists.length === 0) {
        console.log(`   ADDING missing: ${addr.slice(0,10)}... ${data.shares.toFixed(2)} shares`);
        await sql`INSERT INTO community_pool_shares (wallet_address, shares, cost_basis_usd) VALUES (${addr}, ${data.shares}, ${data.depositedUSD})`;
      }
    }
  }

  // 5. Update pool state
  console.log('\n4. Updating pool state...');
  await sql`
    UPDATE community_pool_state 
    SET 
      total_shares = ${sharesNum},
      total_value_usd = ${navNum},
      share_price = ${sharePrice},
      updated_at = NOW()
    WHERE id = 1
  `;

  // 6. Verify
  console.log('\n5. Final verification...');
  const activeDb = await sql`SELECT wallet_address, shares FROM community_pool_shares WHERE shares > 0 ORDER BY shares DESC`;
  const dbTotal = await sql`SELECT SUM(shares) as total, COUNT(*) as count FROM community_pool_shares WHERE shares > 0`;
  
  console.log(`\n=== FINAL DB STATE ===`);
  for (const r of activeDb) {
    const pct = (Number(r.shares) / sharesNum * 100).toFixed(1);
    console.log(`   ${r.wallet_address}: ${Number(r.shares).toFixed(2)} shares (${pct}%)`);
  }
  console.log(`\n   DB Total: ${Number(dbTotal[0].total).toFixed(2)} shares`);
  console.log(`   On-chain: ${sharesNum.toFixed(2)} shares`);
  console.log(`   Active shareholders: ${dbTotal[0].count}`);
  console.log(`   Operations: ${removed} deleted, ${zeroed} zeroed, ${updated} updated`);
  
  const match = Math.abs(Number(dbTotal[0].total) - sharesNum) < 0.01;
  console.log(`\n=== SYNC ${match ? 'SUCCESS ✓' : 'MISMATCH ✗'} ===`);
}

main().catch(console.error);
