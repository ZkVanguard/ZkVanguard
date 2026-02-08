/**
 * Deploy HedgeExecutor + dependencies to Cronos zkEVM testnet
 * 
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-hedge-executor.cjs --network cronos-testnet
 */
const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYMENT_FILE = path.join(__dirname, "../../deployments/cronos-testnet.json");

function loadDeployment() {
  try {
    return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf-8"));
  } catch {
    return { network: "cronos-testnet", chainId: 338, contracts: {} };
  }
}

function saveDeployment(data) {
  data.lastDeployment = new Date().toISOString();
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(data, null, 2));
  console.log(`\nDeployment saved to ${DEPLOYMENT_FILE}`);
}

async function main() {
  const network = await ethers.provider.getNetwork();
  const [deployer] = await ethers.getSigners();

  console.log("\n=== HedgeExecutor Deployment ===");
  console.log(`Network: Chain ID ${network.chainId}`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} CRO\n`);

  const deployment = loadDeployment();

  // ============ Step 1: Deploy MockUSDC if needed ============
  let usdcAddress = deployment.usdcToken;
  if (!usdcAddress) {
    console.log("Deploying MockUSDC...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();
    usdcAddress = await mockUsdc.getAddress();
    deployment.usdcToken = usdcAddress;
    console.log(`  MockUSDC deployed: ${usdcAddress}`);
  } else {
    console.log(`  MockUSDC exists: ${usdcAddress}`);
  }

  // ============ Step 2: Deploy MockMoonlander if needed ============
  let moonlanderAddress = deployment.MockMoonlander;
  if (!moonlanderAddress) {
    console.log("Deploying MockMoonlander...");
    const MockMoonlander = await ethers.getContractFactory("MockMoonlander");
    const moonlander = await MockMoonlander.deploy(usdcAddress);
    await moonlander.waitForDeployment();
    moonlanderAddress = await moonlander.getAddress();
    deployment.MockMoonlander = moonlanderAddress;
    console.log(`  MockMoonlander deployed: ${moonlanderAddress}`);
  } else {
    console.log(`  MockMoonlander exists: ${moonlanderAddress}`);
  }

  // ============ Step 3: Deploy ZKHedgeCommitment if needed ============
  let zkCommitmentAddress = deployment.ZKHedgeCommitment;
  if (!zkCommitmentAddress) {
    console.log("Deploying ZKHedgeCommitment...");
    const ZKHedgeCommitment = await ethers.getContractFactory("ZKHedgeCommitment");
    const zkCommitment = await ZKHedgeCommitment.deploy(usdcAddress);
    await zkCommitment.waitForDeployment();
    zkCommitmentAddress = await zkCommitment.getAddress();
    deployment.ZKHedgeCommitment = zkCommitmentAddress;
    console.log(`  ZKHedgeCommitment deployed: ${zkCommitmentAddress}`);
  } else {
    console.log(`  ZKHedgeCommitment exists: ${zkCommitmentAddress}`);
  }

  // ============ Step 4: Deploy HedgeExecutor (UUPS Proxy) ============
  console.log("\nDeploying HedgeExecutor (UUPS Proxy)...");
  let hedgeExecutorAddress;

  const HedgeExecutor = await ethers.getContractFactory("HedgeExecutor");
  try {
    const hedgeExecutor = await upgrades.deployProxy(
      HedgeExecutor,
      [usdcAddress, moonlanderAddress, zkCommitmentAddress, deployer.address],
      { initializer: "initialize", kind: "uups" }
    );
    await hedgeExecutor.waitForDeployment();
    hedgeExecutorAddress = await hedgeExecutor.getAddress();
    console.log(`  HedgeExecutor proxy deployed: ${hedgeExecutorAddress}`);
  } catch (e) {
    console.log(`  Proxy failed (${e.message?.slice(0, 60)}), deploying directly...`);
    const hedgeExecutor = await HedgeExecutor.deploy();
    await hedgeExecutor.waitForDeployment();
    hedgeExecutorAddress = await hedgeExecutor.getAddress();
    const initTx = await hedgeExecutor.initialize(
      usdcAddress,
      moonlanderAddress,
      zkCommitmentAddress,
      deployer.address
    );
    await initTx.wait();
    console.log(`  HedgeExecutor deployed directly: ${hedgeExecutorAddress}`);
  }
  deployment.HedgeExecutor = hedgeExecutorAddress;

  // ============ Step 5: Configure ============
  console.log("\nConfiguring...");
  const hedgeExecutor = await ethers.getContractAt("HedgeExecutor", hedgeExecutorAddress);

  try {
    const AGENT_ROLE = await hedgeExecutor.AGENT_ROLE();
    const hasRole = await hedgeExecutor.hasRole(AGENT_ROLE, deployer.address);
    if (!hasRole) {
      const tx = await hedgeExecutor.grantRole(AGENT_ROLE, deployer.address);
      await tx.wait();
      console.log("  AGENT_ROLE granted to deployer");
    } else {
      console.log("  AGENT_ROLE already set");
    }
  } catch (e) {
    console.log(`  Role config skipped: ${e.message?.slice(0, 60)}`);
  }

  // Mint test USDC and approve
  try {
    const usdc = await ethers.getContractAt("MockUSDC", usdcAddress);
    const mintTx = await usdc.mint(deployer.address, ethers.parseUnits("1000000", 6));
    await mintTx.wait();
    console.log("  Minted 1M test USDC");

    const approveTx = await usdc.approve(hedgeExecutorAddress, ethers.parseUnits("1000000", 6));
    await approveTx.wait();
    console.log("  USDC approved for HedgeExecutor");
  } catch (e) {
    console.log(`  USDC setup: ${e.message?.slice(0, 60)}`);
  }

  // ============ Save ============
  saveDeployment(deployment);

  console.log("\n=== Deployment Summary ===");
  console.log(`  MockUSDC:          ${usdcAddress}`);
  console.log(`  MockMoonlander:    ${moonlanderAddress}`);
  console.log(`  ZKHedgeCommitment: ${zkCommitmentAddress}`);
  console.log(`  HedgeExecutor:     ${hedgeExecutorAddress}`);
  console.log(`  Deployer:          ${deployer.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
