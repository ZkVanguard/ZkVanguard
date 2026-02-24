/**
 * Sync Community Pool database with on-chain state
 * 
 * This script:
 * 1. Reads actual state from blockchain
 * 2. Updates database user shares
 * 3. Resets NAV history with correct values
 * 
 * Usage: npx hardhat run scripts/sync-pool-db.cjs --network cronos-testnet
 */

const { ethers } = require("hardhat");

const CONFIG = {
  communityPool: "0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B",
  apiUrl: process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}/api/community-pool` 
    : "https://zkvanguard.vercel.app/api/community-pool",
  cronSecret: process.env.CRON_SECRET || ""
};

const POOL_ABI = [
  "function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)",
  "function getMemberPosition(address member) view returns (uint256 shares, uint256 valueUSD, uint256 percentage)",
  "function getMemberPositions(uint256 offset, uint256 limit) view returns (address[] memory members, uint256[] memory shares)",
];

async function main() {
  console.log("\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║     COMMUNITY POOL DATABASE SYNC                              ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");

  const [signer] = await ethers.getSigners();
  console.log(`🔑 Account: ${signer.address}\n`);

  // Get on-chain pool state
  const pool = await ethers.getContractAt("CommunityPool", CONFIG.communityPool);
  
  console.log("📊 Fetching on-chain pool stats...");
  const stats = await pool.getPoolStats();
  
  const totalShares = parseFloat(ethers.formatUnits(stats._totalShares, 18));
  const totalNAV = parseFloat(ethers.formatUnits(stats._totalNAV, 6));
  const memberCount = Number(stats._memberCount);
  const sharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));
  
  console.log(`   Total Shares: ${totalShares.toFixed(4)}`);
  console.log(`   Total NAV: $${totalNAV.toFixed(2)}`);
  console.log(`   Share Price: $${sharePrice.toFixed(4)}`);
  console.log(`   Members: ${memberCount}`);
  console.log(`   Allocations: BTC=${Number(stats._allocations[0])/100}%, ETH=${Number(stats._allocations[1])/100}%, CRO=${Number(stats._allocations[2])/100}%, SUI=${Number(stats._allocations[3])/100}%`);
  
  // Get deployer position
  console.log("\n👤 Fetching member positions...");
  const [shares, valueUSD, percentage] = await pool.getMemberPosition(signer.address);
  console.log(`   ${signer.address}: ${ethers.formatUnits(shares, 18)} shares (${Number(percentage)/100}%)`);
  
  // Output sync data
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("SYNC DATA (copy to production database)");
  console.log("═══════════════════════════════════════════════════════════════");
  
  console.log(`
Pool State to update:
{
  "totalValueUSD": ${totalNAV},
  "totalShares": ${totalShares},
  "sharePrice": ${sharePrice},
  "totalMembers": ${memberCount},
  "allocations": {
    "BTC": ${Number(stats._allocations[0])/100},
    "ETH": ${Number(stats._allocations[1])/100},
    "CRO": ${Number(stats._allocations[2])/100},
    "SUI": ${Number(stats._allocations[3])/100}
  }
}

User Shares to update:
{
  "walletAddress": "${signer.address}",
  "shares": ${parseFloat(ethers.formatUnits(shares, 18))},
  "valueUSD": ${parseFloat(ethers.formatUnits(valueUSD, 6))}
}

NAV History Reset:
  Current NAV: $${totalNAV.toFixed(2)}
  Share Price: $${sharePrice.toFixed(4)}
  Total Shares: ${totalShares.toFixed(4)}
  Member Count: ${memberCount}
`);

  // Try to call reset API
  if (CONFIG.cronSecret) {
    console.log("\n📡 Calling reset API...");
    try {
      const response = await fetch(`${CONFIG.apiUrl}?action=reset-nav-history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': CONFIG.cronSecret,
        },
      });
      const result = await response.json();
      console.log("   Reset result:", result);
    } catch (err) {
      console.log("   ⚠️ Could not call API:", err.message);
    }
  } else {
    console.log("\n⚠️ CRON_SECRET not set - cannot auto-reset NAV history");
    console.log("   Set CRON_SECRET env var and re-run, or reset manually via:");
    console.log(`   curl -X POST "${CONFIG.apiUrl}?action=reset-nav-history" -H "x-cron-secret: YOUR_SECRET"`);
  }

  console.log("\n✅ Sync data collected. Apply manually if API call failed.\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
