// Deployment script for ZKProxyVault and ZKSTARKVerifier
// Network: Cronos Testnet
const { ethers, upgrades } = require("hardhat");

async function main() {
  console.log("\n");
  console.log("=".repeat(70));
  console.log("   DEPLOYING BULLETPROOF ZK PROXY VAULT SYSTEM");
  console.log("   Network: Cronos Testnet");
  console.log("=".repeat(70));
  console.log("\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "TCRO");
  console.log("\n");

  // Step 1: Deploy ZKSTARKVerifier
  console.log("[1/3] Deploying ZKSTARKVerifier...");
  const ZKSTARKVerifier = await ethers.getContractFactory("ZKSTARKVerifier");
  const zkVerifier = await ZKSTARKVerifier.deploy();
  await zkVerifier.waitForDeployment();
  const verifierAddress = await zkVerifier.getAddress();
  console.log("  ✅ ZKSTARKVerifier deployed to:", verifierAddress);

  // Step 2: Deploy ZKProxyVault (Upgradeable)
  console.log("\n[2/3] Deploying ZKProxyVault (UUPS Proxy)...");
  const ZKProxyVault = await ethers.getContractFactory("ZKProxyVault");
  
  // Deploy using UUPS proxy pattern
  // initialize(address _zkVerifier, uint256 _timeLockThreshold, uint256 _timeLockDuration)
  const zkVault = await upgrades.deployProxy(
    ZKProxyVault,
    [
      verifierAddress,         // ZK Verifier address
      ethers.parseEther("10"), // Time-lock threshold: 10 ETH
      86400                    // Time-lock duration: 24 hours
    ],
    { 
      initializer: "initialize",
      kind: "uups"
    }
  );
  await zkVault.waitForDeployment();
  const vaultAddress = await zkVault.getAddress();
  console.log("  ✅ ZKProxyVault (Proxy) deployed to:", vaultAddress);

  // Get implementation address
  const implAddress = await upgrades.erc1967.getImplementationAddress(vaultAddress);
  console.log("  ✅ ZKProxyVault (Implementation) at:", implAddress);

  // Step 3: Verify deployment
  console.log("\n[3/3] Verifying deployment...");
  
  // Check verifier is set correctly
  const configuredVerifier = await zkVault.zkVerifier();
  console.log("  Configured ZK Verifier:", configuredVerifier);
  console.log("  Match:", configuredVerifier === verifierAddress ? "✅ YES" : "❌ NO");

  // Check time-lock settings
  const threshold = await zkVault.timeLockThreshold();
  const duration = await zkVault.timeLockDuration();
  console.log("  Time-lock threshold:", ethers.formatEther(threshold), "ETH");
  console.log("  Time-lock duration:", duration.toString(), "seconds (24 hours)");

  // Summary
  console.log("\n");
  console.log("=".repeat(70));
  console.log("   DEPLOYMENT COMPLETE!");
  console.log("=".repeat(70));
  console.log("\n");
  console.log("  Contract Addresses:");
  console.log("  -------------------");
  console.log("  ZKSTARKVerifier:", verifierAddress);
  console.log("  ZKProxyVault (Proxy):", vaultAddress);
  console.log("  ZKProxyVault (Implementation):", implAddress);
  console.log("\n");
  console.log("  Guardian:", deployer.address);
  console.log("  (Replace with multi-sig for production!)");
  console.log("\n");

  // Save deployment info
  const fs = require("fs");
  const deploymentInfo = {
    network: "cronos-testnet",
    chainId: 338,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      ZKSTARKVerifier: verifierAddress,
      ZKProxyVault: {
        proxy: vaultAddress,
        implementation: implAddress
      }
    },
    configuration: {
      guardian: deployer.address,
      timeLockThreshold: "10 ETH",
      timeLockDelay: "86400 seconds (24 hours)"
    }
  };

  fs.writeFileSync(
    "deployments/zk-proxy-vault.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("  Deployment info saved to: deployments/zk-proxy-vault.json");
  console.log("\n");

  return deploymentInfo;
}

main()
  .then((result) => {
    console.log("Deployment successful!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
