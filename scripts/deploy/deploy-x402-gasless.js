/**
 * Deploy X402 TRUE Gasless ZK Commitment Verifier
 * Usage: npx hardhat run scripts/deploy/deploy-x402-gasless.js --network cronos-testnet
 */

const hre = require("hardhat");
const ethers = hre.ethers;

async function main() {
  console.log("\n🚀 Deploying X402 TRUE Gasless ZK Commitment Verifier...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CRO\n");

  // Contract parameters
  const USDC_TOKEN = "0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0"; // DevUSDCe on Cronos Testnet
  const FEE_PER_COMMITMENT = "10000"; // 0.01 USDC (6 decimals)

  console.log("Configuration:");
  console.log("  USDC Token:", USDC_TOKEN);
  console.log("  Fee per commitment:", ethers.formatUnits(FEE_PER_COMMITMENT, 6), "USDC");
  console.log("  (Users pay ~$0.01 per commitment via x402 gaslessly)\n");

  // Deploy contract
  const X402GaslessZKCommitmentVerifier = await ethers.getContractFactory("X402GaslessZKCommitmentVerifier");
  const verifier = await X402GaslessZKCommitmentVerifier.deploy(USDC_TOKEN, FEE_PER_COMMITMENT);

  await verifier.waitForDeployment();
  const address = await verifier.getAddress();

  console.log("✅ X402GaslessZKCommitmentVerifier deployed to:", address);
  console.log("\n📋 Contract Details:");
  console.log("  • TRUE gasless via x402 + USDC");
  console.log("  • Users need ZERO CRO");
  console.log("  • Only ~$0.01 USDC per commitment");
  console.log("  • x402 Facilitator makes USDC payment gasless");
  console.log("  • Contract sponsors CRO gas from its balance\n");

  // Fund contract with CRO for gas sponsorship
  console.log("💰 Funding contract with CRO for gas sponsorship...");
  const fundAmount = ethers.parseEther("1.0"); // 1 CRO
  const tx = await deployer.sendTransaction({
    to: address,
    value: fundAmount,
  });
  await tx.wait();
  console.log("  ✅ Funded with", ethers.formatEther(fundAmount), "CRO\n");

  // Verification info
  console.log("🔍 To verify contract on Cronoscan:");
  console.log(`  npx hardhat verify --network cronosTestnet ${address} "${USDC_TOKEN}" "${FEE_PER_COMMITMENT}"\n`);

  // Environment variable
  console.log("📝 Add to .env.local:");
  console.log(`  NEXT_PUBLIC_X402_GASLESS_VERIFIER=${address}\n`);

  // Integration guide
  console.log("📚 Integration Guide:");
  console.log("  1. Users approve USDC via x402 (gasless)");
  console.log("  2. Call storeCommitmentWithUSDC()");
  console.log("  3. Contract receives USDC, stores commitment");
  console.log("  4. Contract pays CRO gas from its balance");
  console.log("  5. User pays ZERO CRO! 🎉\n");

  // Save deployment info
  const fs = require("fs");
  const deploymentInfo = {
    network: "cronos-testnet",
    contractName: "X402GaslessZKCommitmentVerifier",
    address: address,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    usdcToken: USDC_TOKEN,
    feePerCommitment: FEE_PER_COMMITMENT,
    initialCROFunding: ethers.formatEther(fundAmount),
  };

  fs.writeFileSync(
    `deployments/x402-gasless-${Date.now()}.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("✅ Deployment complete!\n");
  console.log("🏆 This is TRUE gasless:");
  console.log("  • User needs ZERO CRO");
  console.log("  • x402 makes USDC payment gasless");
  console.log("  • Contract sponsors on-chain gas");
  console.log("  • Total user cost: ~$0.01 USDC\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
