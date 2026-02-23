/**
 * Approve USDC for CommunityPool
 */
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  const POOL = "0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30";
  const USDC = "0x28217DAddC55e3C4831b4A48A00Ce04880786967";
  
  const usdc = await ethers.getContractAt("MockUSDC", USDC);
  
  console.log("Approving USDC for CommunityPool...");
  console.log("From:", deployer.address);
  
  const tx = await usdc.approve(POOL, ethers.MaxUint256);
  console.log("Tx:", tx.hash);
  await tx.wait();
  console.log("✅ Done!");
  
  const allowance = await usdc.allowance(deployer.address, POOL);
  console.log("New Allowance:", ethers.formatUnits(allowance, 6), "USDC");
}

main().catch(console.error);
