/**
 * MAINNET DEPLOYMENT - CommunityPool + Timelock
 * 
 * This script deploys the complete production infrastructure:
 * 1. CommunityPoolTimelock (48h delay, multisig controlled)
 * 2. CommunityPool (upgradeable, admin = timelock)
 * 
 * PREREQUISITES:
 * - Create Gnosis Safe multisig at https://safe.cronos.org
 * - Update deployments/mainnet-config.json with multisig address
 * - Deployer wallet has minimum 50 CRO for gas
 * - Run pre-flight checks first: npx hardhat run scripts/deploy/mainnet-preflight.cjs --network cronos-mainnet
 * 
 * USAGE:
 * npx hardhat run scripts/deploy/deploy-mainnet-full.cjs --network cronos-mainnet
 */

const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Load mainnet config
const CONFIG_PATH = path.join(__dirname, "..", "..", "deployments", "mainnet-config.json");

async function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error("Mainnet config not found. Create deployments/mainnet-config.json first.");
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

async function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function banner(text) {
  console.log("\n" + "═".repeat(70));
  console.log(`  ${text}`);
  console.log("═".repeat(70));
}

async function main() {
  banner("CHRONOS VANGUARD - MAINNET DEPLOYMENT");
  console.log("  CommunityPool + Timelock Infrastructure\n");
  
  // Load config
  const config = await loadConfig();
  const [deployer] = await ethers.getSigners();
  
  // ══════════════════════════════════════════════════════════════════
  // STEP 1: PRE-FLIGHT VALIDATION
  // ══════════════════════════════════════════════════════════════════
  banner("STEP 1: PRE-FLIGHT VALIDATION");
  
  // Check network
  const network = await ethers.provider.getNetwork();
  console.log(`📡 Network: Chain ID ${network.chainId}`);
  
  if (Number(network.chainId) !== 25) {
    console.error("❌ ERROR: Not on Cronos Mainnet (Chain ID 25)");
    console.log("   Use: npx hardhat run <script> --network cronos-mainnet");
    process.exit(1);
  }
  console.log("   ✅ Connected to Cronos Mainnet");
  
  // Check deployer balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`\n💰 Deployer: ${deployer.address}`);
  console.log(`   Balance: ${ethers.formatEther(balance)} CRO`);
  
  if (balance < ethers.parseEther("50")) {
    console.error("❌ ERROR: Insufficient CRO. Need minimum 50 CRO for deployment.");
    process.exit(1);
  }
  console.log("   ✅ Sufficient balance");
  
  // Validate multisig address
  const multisigAddr = config.addresses.multisig.admin;
  console.log(`\n🔐 Multisig: ${multisigAddr}`);
  
  if (multisigAddr === "REPLACE_WITH_GNOSIS_SAFE_ADDRESS" || 
      !ethers.isAddress(multisigAddr)) {
    console.error("❌ ERROR: Invalid multisig address in mainnet-config.json");
    console.log("   Create a Gnosis Safe at https://safe.cronos.org first");
    process.exit(1);
  }
  
  const multisigCode = await ethers.provider.getCode(multisigAddr);
  if (multisigCode === "0x") {
    console.error("❌ ERROR: Multisig address has no contract code");
    console.log("   Ensure Gnosis Safe is deployed before proceeding");
    process.exit(1);
  }
  console.log("   ✅ Multisig verified");
  
  // Validate treasury
  const treasuryAddr = config.addresses.multisig.treasury;
  console.log(`\n💎 Treasury: ${treasuryAddr}`);
  
  if (treasuryAddr === "REPLACE_WITH_TREASURY_SAFE_ADDRESS" || 
      !ethers.isAddress(treasuryAddr)) {
    console.error("❌ ERROR: Invalid treasury address in mainnet-config.json");
    process.exit(1);
  }
  console.log("   ✅ Treasury address valid");
  
  // Verify USDC
  const usdcAddr = config.addresses.tokens.usdc;
  const usdcCode = await ethers.provider.getCode(usdcAddr);
  if (usdcCode === "0x") {
    console.error("❌ ERROR: USDC contract not found");
    process.exit(1);
  }
  console.log(`\n💵 USDC: ${usdcAddr}`);
  console.log("   ✅ USDC verified");
  
  // Verify Pyth
  const pythAddr = config.addresses.oracles.pyth;
  const pythCode = await ethers.provider.getCode(pythAddr);
  if (pythCode === "0x") {
    console.error("❌ ERROR: Pyth Oracle contract not found");
    process.exit(1);
  }
  console.log(`\n📊 Pyth Oracle: ${pythAddr}`);
  console.log("   ✅ Pyth verified");
  
  // Confirmation
  console.log("\n" + "─".repeat(70));
  console.log("⚠️  MAINNET DEPLOYMENT - THIS IS IRREVERSIBLE");
  console.log("─".repeat(70));
  console.log(`
  Timelock:     48 hour delay
  Proposers:    ${multisigAddr}
  Admin after:  Timelock (no bypass)
  Treasury:     ${treasuryAddr}
  USDC:         ${usdcAddr}
  `);
  
  // Auto-proceed for scripted deployment (comment out for interactive)
  // const readline = require('readline');
  // const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // const answer = await new Promise(resolve => rl.question('Type "DEPLOY" to continue: ', resolve));
  // rl.close();
  // if (answer !== 'DEPLOY') { console.log('Aborted.'); process.exit(0); }
  
  // ══════════════════════════════════════════════════════════════════
  // STEP 2: DEPLOY TIMELOCK
  // ══════════════════════════════════════════════════════════════════
  banner("STEP 2: DEPLOY TIMELOCK");
  
  const Timelock = await ethers.getContractFactory("CommunityPoolTimelock");
  
  const minDelay = config.timelock.minDelay; // 48 hours in seconds
  const proposers = [multisigAddr]; // Multisig can propose
  const executors = [ethers.ZeroAddress]; // Anyone can execute after delay
  const admin = ethers.ZeroAddress; // No admin bypass
  
  console.log("📝 Deploying CommunityPoolTimelock...");
  console.log(`   Min Delay: ${minDelay} seconds (${minDelay / 3600} hours)`);
  console.log(`   Proposers: ${proposers.join(", ")}`);
  console.log(`   Executors: Anyone (permissionless)`);
  console.log(`   Admin bypass: DISABLED (secure)`);
  
  const timelock = await Timelock.deploy(minDelay, proposers, executors, admin);
  await timelock.waitForDeployment();
  const timelockAddr = await timelock.getAddress();
  
  console.log(`\n   ✅ Timelock deployed: ${timelockAddr}`);
  
  // Save to config
  config.deployment.timelock = {
    address: timelockAddr,
    deployedAt: new Date().toISOString()
  };
  config.preflightChecklist.timelockDeployed = true;
  await saveConfig(config);
  
  // ══════════════════════════════════════════════════════════════════
  // STEP 3: DEPLOY COMMUNITYPOOL
  // ══════════════════════════════════════════════════════════════════
  banner("STEP 3: DEPLOY COMMUNITYPOOL");
  
  const CommunityPool = await ethers.getContractFactory("CommunityPool");
  
  // Asset tokens (wrapped tokens on Cronos mainnet)
  const assetTokens = [
    config.addresses.tokens.wbtc || ethers.ZeroAddress,
    config.addresses.tokens.weth || ethers.ZeroAddress,
    ethers.ZeroAddress, // SUI - bridge later
    config.addresses.tokens.wcro || ethers.ZeroAddress
  ];
  
  console.log("📝 Deploying CommunityPool (UUPS Proxy)...");
  console.log(`   USDC: ${usdcAddr}`);
  console.log(`   Treasury: ${treasuryAddr}`);
  console.log(`   Admin: ${deployer.address} (temporary)`);
  
  const pool = await upgrades.deployProxy(
    CommunityPool,
    [
      usdcAddr,      // depositToken
      assetTokens,   // assetTokens[4]
      treasuryAddr,  // treasury
      deployer.address // admin (temporary, will transfer to timelock)
    ],
    { initializer: "initialize", kind: "uups" }
  );
  
  await pool.waitForDeployment();
  const proxyAddr = await pool.getAddress();
  const implAddr = await upgrades.erc1967.getImplementationAddress(proxyAddr);
  
  console.log(`\n   ✅ Proxy deployed: ${proxyAddr}`);
  console.log(`   ✅ Implementation: ${implAddr}`);
  
  // ══════════════════════════════════════════════════════════════════
  // STEP 4: CONFIGURE POOL
  // ══════════════════════════════════════════════════════════════════
  banner("STEP 4: CONFIGURE POOL");
  
  // Configure Pyth Oracle
  console.log("📊 Setting Pyth Oracle...");
  let tx = await pool.setPythOracle(pythAddr);
  await tx.wait();
  console.log("   ✅ Pyth Oracle set");
  
  // Set price feed IDs
  console.log("📊 Setting Price Feed IDs...");
  tx = await pool.setAllPriceIds([
    config.priceIds.BTC,
    config.priceIds.ETH,
    config.priceIds.SUI,
    config.priceIds.CRO
  ]);
  await tx.wait();
  console.log("   ✅ Price feed IDs configured");
  
  // Set stale threshold (1 hour)
  console.log("⏰ Setting stale threshold...");
  tx = await pool.setPriceStaleThreshold(3600);
  await tx.wait();
  console.log("   ✅ Stale threshold: 1 hour");
  
  // Set circuit breakers
  console.log("🛡️  Setting circuit breakers...");
  tx = await pool.setMaxSingleDeposit(config.circuitBreakers.maxSingleDeposit);
  await tx.wait();
  tx = await pool.setMaxSingleWithdrawalBps(config.circuitBreakers.maxSingleWithdrawalBps);
  await tx.wait();
  tx = await pool.setDailyWithdrawalCapBps(config.circuitBreakers.dailyWithdrawalCapBps);
  await tx.wait();
  console.log("   ✅ Circuit breakers configured");
  console.log(`      Max deposit: ${config.circuitBreakers.maxSingleDepositHuman}`);
  console.log(`      Max withdrawal: ${config.circuitBreakers.maxSingleWithdrawalHuman}`);
  console.log(`      Daily cap: ${config.circuitBreakers.dailyWithdrawalCapHuman}`);
  
  // ══════════════════════════════════════════════════════════════════
  // STEP 5: TRANSFER ADMIN TO TIMELOCK
  // ══════════════════════════════════════════════════════════════════
  banner("STEP 5: TRANSFER ADMIN TO TIMELOCK");
  
  const DEFAULT_ADMIN_ROLE = await pool.DEFAULT_ADMIN_ROLE();
  const UPGRADER_ROLE = await pool.UPGRADER_ROLE();
  
  console.log("🔐 Granting admin role to Timelock...");
  tx = await pool.grantRole(DEFAULT_ADMIN_ROLE, timelockAddr);
  await tx.wait();
  console.log(`   ✅ DEFAULT_ADMIN_ROLE granted to Timelock`);
  
  console.log("🔐 Granting upgrader role to Timelock...");
  tx = await pool.grantRole(UPGRADER_ROLE, timelockAddr);
  await tx.wait();
  console.log(`   ✅ UPGRADER_ROLE granted to Timelock`);
  
  console.log("🔐 Revoking deployer admin role...");
  tx = await pool.revokeRole(DEFAULT_ADMIN_ROLE, deployer.address);
  await tx.wait();
  console.log(`   ✅ Deployer admin role revoked`);
  
  console.log("🔐 Revoking deployer upgrader role...");
  tx = await pool.revokeRole(UPGRADER_ROLE, deployer.address);
  await tx.wait();
  console.log(`   ✅ Deployer upgrader role revoked`);
  
  // ══════════════════════════════════════════════════════════════════
  // STEP 6: VERIFY FINAL STATE
  // ══════════════════════════════════════════════════════════════════
  banner("STEP 6: VERIFICATION");
  
  // Verify admin is timelock
  const isTimelockAdmin = await pool.hasRole(DEFAULT_ADMIN_ROLE, timelockAddr);
  const isDeployerAdmin = await pool.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
  
  console.log("\n🔍 Role Verification:");
  console.log(`   Timelock is admin: ${isTimelockAdmin ? "✅ YES" : "❌ NO"}`);
  console.log(`   Deployer is admin: ${isDeployerAdmin ? "❌ DANGER" : "✅ NO (correct)"}`);
  
  if (!isTimelockAdmin || isDeployerAdmin) {
    console.error("\n❌ CRITICAL: Admin role transfer verification failed!");
    process.exit(1);
  }
  
  // Save final deployment
  config.deployment.communityPool = {
    proxy: proxyAddr,
    implementation: implAddr,
    deployedAt: new Date().toISOString()
  };
  config.preflightChecklist.communityPoolDeployed = true;
  config.preflightChecklist.adminTransferredToTimelock = true;
  config.status = "DEPLOYED";
  await saveConfig(config);
  
  // ══════════════════════════════════════════════════════════════════
  // DEPLOYMENT SUMMARY
  // ══════════════════════════════════════════════════════════════════
  banner("🎉 DEPLOYMENT COMPLETE");
  
  console.log(`
  ╔════════════════════════════════════════════════════════════════╗
  ║  CRONOS MAINNET DEPLOYMENT SUMMARY                             ║
  ╠════════════════════════════════════════════════════════════════╣
  ║                                                                ║
  ║  CommunityPool:                                                ║
  ║    Proxy:          ${proxyAddr}     ║
  ║    Implementation: ${implAddr}     ║
  ║                                                                ║
  ║  CommunityPoolTimelock:                                        ║
  ║    Address:        ${timelockAddr}     ║
  ║    Min Delay:      48 hours                                    ║
  ║                                                                ║
  ║  Security:                                                     ║
  ║    Admin:          Timelock (48h delay)                        ║
  ║    Proposer:       Multisig                                    ║
  ║    Deployer:       NO ACCESS                                   ║
  ║                                                                ║
  ╚════════════════════════════════════════════════════════════════╝
  `);
  
  console.log("📋 NEXT STEPS:");
  console.log("   1. Verify contracts on CronosScan:");
  console.log(`      npx hardhat verify --network cronos-mainnet ${proxyAddr}`);
  console.log(`      npx hardhat verify --network cronos-mainnet ${timelockAddr}`);
  console.log("\n   2. Push Pyth prices:");
  console.log("      npx hardhat run scripts/update-pyth-prices-mainnet.cjs --network cronos-mainnet");
  console.log("\n   3. Test with small deposit from multisig");
  console.log("\n   4. Update frontend config with new addresses");
  console.log("\n   5. Announce mainnet launch! 🚀\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ DEPLOYMENT FAILED:", error);
    process.exit(1);
  });
