/**
 * Test new Arbitrum CommunityPool deployment
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const POOL = "0x2DCbd1EDaD4638e836E78E65A2831D077ce0eB72";
const USDC = "0xA50E3d2C2110EBd08567A322e6e7B0Ca25341bF1";

async function main() {
  console.log("\n=== Test Arbitrum CommunityPool ===\n");
  
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  
  const pool = await ethers.getContractAt("CommunityPool", POOL);
  const usdc = await ethers.getContractAt("MockUSDC", USDC);
  
  // Verify ERC20 functions work
  console.log("Pool name:", await pool.name());
  console.log("Pool symbol:", await pool.symbol());
  console.log("Pool decimals:", await pool.decimals());
  
  // Check balances
  const usdcBal = await usdc.balanceOf(signer.address);
  console.log("\nUSDC Balance:", ethers.formatUnits(usdcBal, 6));
  
  // Ensure approved
  let tx = await usdc.approve(POOL, ethers.MaxUint256);
  await tx.wait();
  console.log("✅ Approved");
  
  // Deposit
  console.log("\nDepositing 100 USDC...");
  tx = await pool.deposit(100n * 10n**6n);  // Only amount - no minShares
  const depositReceipt = await tx.wait();
  console.log("✅ Deposit successful! Gas:", depositReceipt.gasUsed.toString());
  
  const shares = await pool.balanceOf(signer.address);
  console.log("Shares received:", ethers.formatEther(shares));
  
  const totalSupply = await pool.totalSupply();
  console.log("Total supply:", ethers.formatEther(totalSupply));
  
  // Withdraw half
  console.log("\nWithdrawing 50% of shares...");
  const withdrawShares = shares / 2n;
  tx = await pool.withdraw(withdrawShares, 0n);  // shares, minOut
  const withdrawReceipt = await tx.wait();
  console.log("✅ Withdraw successful! Gas:", withdrawReceipt.gasUsed.toString());
  
  const newShares = await pool.balanceOf(signer.address);
  const newUsdc = await usdc.balanceOf(signer.address);
  console.log("Remaining shares:", ethers.formatEther(newShares));
  console.log("USDC Balance:", ethers.formatUnits(newUsdc, 6));
  
  // Save deployment info
  const deployment = {
    network: "Arbitrum Sepolia",
    chainId: 421614,
    deployedAt: new Date().toISOString(),
    deployer: signer.address,
    contracts: {
      CommunityPool: {
        proxy: POOL,
        implementation: await ethers.provider.getStorage(POOL, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc").then(r => "0x" + r.slice(26))
      },
      MockUSDC: USDC
    },
    configuration: {
      depositToken: USDC,
      pythOracle: "0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF"
    },
    verified: {
      name: true,
      symbol: true,
      decimals: true,
      deposit: true,
      withdraw: true,
      balanceOf: true,
      totalSupply: true
    }
  };

  const deploymentPath = path.join(__dirname, "../deployments/community-pool-arbitrum-sepolia.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("   ARBITRUM SEPOLIA DEPLOYMENT VERIFIED");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   Pool:", POOL);
  console.log("   All functions: ✅ WORKING");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
