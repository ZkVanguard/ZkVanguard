/**
 * Deploy Fixed MockMoonlander and Update HedgeExecutorV2
 */

const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("\n═══ Deploy Fixed MockMoonlander ═══\n");
  console.log("Deployer:", deployer.address);
  
  // Load existing deployment
  const deployment = require("../../deployments/cronos-testnet.json");
  const MockUSDC = deployment.MockUSDC;
  
  console.log("Using MockUSDC:", MockUSDC);
  
  // Deploy new MockMoonlander
  const MockMoonlander = await ethers.getContractFactory("MockMoonlander");
  const mockMoonlander = await MockMoonlander.deploy(MockUSDC);
  await mockMoonlander.waitForDeployment();
  
  const moonlanderAddress = await mockMoonlander.getAddress();
  console.log("\n✅ MockMoonlander deployed:", moonlanderAddress);
  
  // Fund the MockMoonlander with USDC for payouts
  const usdc = await ethers.getContractAt("MockUSDC", MockUSDC, deployer);
  const fundAmount = ethers.parseUnits("10000000", 6); // 10M USDC
  
  await usdc.mint(moonlanderAddress, fundAmount);
  console.log("   Funded with 10M USDC for payouts");
  
  // Update cronos-testnet.json
  deployment.MockMoonlander = moonlanderAddress;
  deployment.lastDeployment = new Date().toISOString();
  
  fs.writeFileSync(
    "./deployments/cronos-testnet.json",
    JSON.stringify(deployment, null, 2)
  );
  console.log("   Updated cronos-testnet.json");
  
  // Now redeploy HedgeExecutorV2 with the new MockMoonlander
  console.log("\n═══ Redeploying HedgeExecutorV2 ═══\n");
  
  const config = {
    collateralToken: MockUSDC,
    moonlanderRouter: moonlanderAddress,
    zkCommitment: deployment.ZKHedgeCommitment
  };
  
  console.log("Configuration:");
  console.log("  Collateral Token:", config.collateralToken);
  console.log("  Moonlander Router:", config.moonlanderRouter);
  console.log("  ZK Commitment:", config.zkCommitment);
  
  const HedgeExecutorV2 = await ethers.getContractFactory("HedgeExecutorV2");
  const hedgeExecutorV2 = await upgrades.deployProxy(
    HedgeExecutorV2,
    [config.collateralToken, config.moonlanderRouter, config.zkCommitment, deployer.address],
    { kind: "uups" }
  );
  await hedgeExecutorV2.waitForDeployment();
  
  const proxyAddress = await hedgeExecutorV2.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  
  console.log("\n✅ HedgeExecutorV2 deployed!");
  console.log("   Proxy:", proxyAddress);
  console.log("   Implementation:", implAddress);
  
  // Update hedge-executor-v2-testnet.json
  const hedgeDeployment = {
    network: "Cronos Testnet",
    chainId: 338,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      hedgeExecutorV2Proxy: proxyAddress,
      hedgeExecutorV2Implementation: implAddress,
      collateralToken: config.collateralToken,
      moonlanderRouter: config.moonlanderRouter,
      zkCommitment: config.zkCommitment
    },
    feeConfig: {
      executionFeeBps: 10,
      performanceFeeBps: 2000
    }
  };
  
  fs.writeFileSync(
    "./deployments/hedge-executor-v2-testnet.json",
    JSON.stringify(hedgeDeployment, null, 2)
  );
  console.log("   Updated hedge-executor-v2-testnet.json");
  
  console.log("\n═══ COMPLETE ═══\n");
}

// Import upgrades
const { upgrades } = require("hardhat");

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
