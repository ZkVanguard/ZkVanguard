import hre from "hardhat";

async function main() {
  console.log("🚀 Upgrading ZKVerifier contract...");
  
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "CRO");

  // Deploy new implementation
  console.log("\n📝 Deploying new ZKVerifier...");
  const ZKVerifier = await hre.ethers.getContractFactory("ZKVerifier");
  const zkVerifier = await ZKVerifier.deploy(deployer.address);
  await zkVerifier.waitForDeployment();
  
  const zkVerifierAddress = await zkVerifier.getAddress();
  console.log("✅ ZKVerifier deployed to:", zkVerifierAddress);

  // Grant VERIFIER_ROLE to deployer
  const VERIFIER_ROLE = await zkVerifier.VERIFIER_ROLE();
  const hasRole = await zkVerifier.hasRole(VERIFIER_ROLE, deployer.address);
  
  if (!hasRole) {
    console.log("\n🔐 Granting VERIFIER_ROLE to deployer...");
    const tx = await zkVerifier.grantRole(VERIFIER_ROLE, deployer.address);
    await tx.wait();
    console.log("✅ VERIFIER_ROLE granted");
  } else {
    console.log("✅ VERIFIER_ROLE already granted");
  }

  console.log("\n✅ Deployment complete!");
  console.log("=" + "=".repeat(60));
  console.log("ZKVerifier:", zkVerifierAddress);
  console.log("=" + "=".repeat(60));
  console.log("\n📝 Update your .env.local:");
  console.log(`NEXT_PUBLIC_ZKVERIFIER_ADDRESS=${zkVerifierAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
