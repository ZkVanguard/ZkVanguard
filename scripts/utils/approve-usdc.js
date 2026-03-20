/**
 * Approve USDT for CommunityPool
 */
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  // CommunityPool V3 Proxy (upgraded 2026-03-12)
  const POOL = "0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30";
  const USDT = "0x28217DAddC55e3C4831b4A48A00Ce04880786967";
  
  const usdt = await ethers.getContractAt("MockUSDC", USDT);
  
  console.log("Approving USDT for CommunityPool...");
  console.log("From:", deployer.address);
  
  const tx = await usdt.approve(POOL, ethers.MaxUint256);
  console.log("Tx:", tx.hash);
  await tx.wait();
  console.log("✅ Done!");
  
  const allowance = await usdt.allowance(deployer.address, POOL);
  console.log("New Allowance:", ethers.formatUnits(allowance, 6), "USDT");
}

main().catch(console.error);
