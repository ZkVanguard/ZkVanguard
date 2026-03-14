/**
 * Quick debug script for Arbitrum CommunityPool
 */
const { ethers } = require("hardhat");

const PROXY = "0xfd6B402b860aD57f1393E2b60E1D676b57e0E63B";

async function main() {
  console.log("Checking Arbitrum CommunityPool proxy...\n");
  
  // Check bytecode at proxy
  const code = await ethers.provider.getCode(PROXY);
  console.log("Bytecode length:", code.length);
  
  if (code === "0x") {
    console.log("❌ No contract at proxy address!");
    return;
  }
  
  // Get ERC1967 implementation slot
  const implSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const implRaw = await ethers.provider.getStorage(PROXY, implSlot);
  const impl = "0x" + implRaw.slice(26); // Extract address
  console.log("Implementation address:", impl);
  
  // Check impl bytecode
  const implCode = await ethers.provider.getCode(impl);
  console.log("Implementation bytecode length:", implCode.length);
  
  // Try simple view call
  const abi = ["function name() view returns (string)", "function symbol() view returns (string)"];
  const contract = new ethers.Contract(PROXY, abi, ethers.provider);
  
  try {
    const name = await contract.name();
    console.log("Name:", name);
    const symbol = await contract.symbol();
    console.log("Symbol:", symbol);
  } catch (e) {
    console.log("ERC20 name/symbol failed:", e.message.slice(0, 100));
  }
  
  // Try depositToken
  const poolAbi = ["function depositToken() view returns (address)"];
  const pool = new ethers.Contract(PROXY, poolAbi, ethers.provider);
  
  try {
    const dt = await pool.depositToken();
    console.log("Deposit Token:", dt);
  } catch (e) {
    console.log("depositToken() failed:", e.message.slice(0, 100));
  }
}

main();
