/**
 * Verify X402 Gasless ZK Commitment Verifier Deployment
 * Usage: npx hardhat run scripts/verify-x402-deployment.js --network cronos-testnet
 */

const hre = require("hardhat");
const ethers = hre.ethers;

async function main() {
  console.log("\n🔍 Verifying X402 Gasless ZK Commitment Verifier Deployment...\n");

  const CONTRACT_ADDRESS = "0x44098d0dE36e157b4C1700B48d615285C76fdE47";
  const USDC_TOKEN = "0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0";

  // Get contract instance
  const verifier = await ethers.getContractAt("X402GaslessZKCommitmentVerifier", CONTRACT_ADDRESS);

  console.log("📋 Contract Details:");
  console.log("  Address:", CONTRACT_ADDRESS);
  console.log("  Network: Cronos Testnet (Chain ID 338)");
  
  // Check contract state
  const usdcAddress = await verifier.USDC_TOKEN();
  console.log("\n💰 Payment Configuration:");
  console.log("  USDC Token:", usdcAddress);
  console.log("  Expected:", USDC_TOKEN);
  console.log("  Match:", usdcAddress.toLowerCase() === USDC_TOKEN.toLowerCase() ? "✅ YES" : "❌ NO");

  const feePerCommitment = await verifier.feePerCommitment();
  console.log("  Fee per commitment:", ethers.formatUnits(feePerCommitment, 6), "USDC (~$0.01)");

  const owner = await verifier.owner();
  console.log("\n👤 Owner:", owner);

  // Check contract balance (for gas sponsorship)
  const balance = await ethers.provider.getBalance(CONTRACT_ADDRESS);
  console.log("\n⛽ Gas Sponsorship:");
  console.log("  Contract CRO Balance:", ethers.formatEther(balance), "CRO");
  console.log("  Can sponsor ~", Math.floor(parseFloat(ethers.formatEther(balance)) / 0.005), "transactions");

  // Check statistics
  const totalCommitments = await verifier.totalCommitments();
  const totalFeesCollected = await verifier.totalFeesCollected();
  const totalGasSponsored = await verifier.totalGasSponsored();
  
  console.log("\n📊 Statistics:");
  console.log("  Total Commitments:", totalCommitments.toString());
  console.log("  Total USDC Fees:", ethers.formatUnits(totalFeesCollected, 6), "USDC");
  console.log("  Total Gas Sponsored:", ethers.formatEther(totalGasSponsored), "CRO");

  console.log("\n✅ Verification Complete!");
  console.log("\n🌐 View on Cronoscan:");
  console.log(`  https://explorer.cronos.org/testnet/address/${CONTRACT_ADDRESS}`);
  
  console.log("\n🚀 Ready for x402 TRUE Gasless Transactions!");
  console.log("  • Users approve USDC via x402 (gasless)");
  console.log("  • Call storeCommitmentWithUSDC()");
  console.log("  • User pays ~$0.01 USDC, ZERO CRO!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
