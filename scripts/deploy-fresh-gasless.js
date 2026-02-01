/**
 * Deploy Fresh GaslessZKCommitmentVerifier
 * This deploys a fresh instance for testing
 */

const hre = require("hardhat");
const ethers = hre.ethers;

async function main() {
  console.log("\n🚀 DEPLOYING FRESH GASLESS ZK VERIFIER");
  console.log("=".repeat(50) + "\n");

  const [deployer] = await ethers.getSigners();
  console.log("👤 Deployer:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "TCRO\n");

  // Deploy the contract
  console.log("📦 Deploying GaslessZKCommitmentVerifier...");
  const GaslessZK = await ethers.getContractFactory("GaslessZKCommitmentVerifier");
  const gaslessZK = await GaslessZK.deploy();
  await gaslessZK.waitForDeployment();
  
  const address = await gaslessZK.getAddress();
  console.log("✅ Deployed to:", address);

  // Fund the contract
  console.log("\n💰 Funding contract with 1 TCRO...");
  const depositTx = await gaslessZK.deposit({ value: ethers.parseEther("1.0") });
  await depositTx.wait();
  
  const contractBalance = await ethers.provider.getBalance(address);
  console.log("✅ Contract balance:", ethers.formatEther(contractBalance), "TCRO");

  // Verify deployment
  const owner = await gaslessZK.owner();
  console.log("\n📋 Contract Info:");
  console.log("   Owner:", owner);
  console.log("   Address:", address);

  // Save to deployment file
  const fs = require("fs");
  const deploymentPath = "deployments/cronos-testnet.json";
  let deployments = {};
  
  try {
    deployments = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  } catch (e) {
    // File doesn't exist
  }

  deployments.zkCommitmentVerifier = address;
  deployments.GaslessZKCommitmentVerifier = address;
  deployments.lastDeployment = new Date().toISOString();
  
  fs.writeFileSync(deploymentPath, JSON.stringify(deployments, null, 2));
  console.log("\n📝 Saved to", deploymentPath);

  console.log("\n" + "=".repeat(50));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("=".repeat(50) + "\n");
  
  return address;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
