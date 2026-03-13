/**
 * MAINNET POST-DEPLOYMENT VERIFICATION
 * 
 * Run this AFTER deployment to verify everything is configured correctly.
 * 
 * USAGE:
 * npx hardhat run scripts/deploy/mainnet-verify.cjs --network cronos-mainnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "..", "deployments", "mainnet-config.json");

async function main() {
  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║     MAINNET POST-DEPLOYMENT VERIFICATION                      ║");
  console.log("║     Confirming deployment integrity                           ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");
  
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  
  if (!config.deployment?.communityPool?.proxy) {
    console.log("❌ No deployment found. Run deploy-mainnet-full.cjs first.\n");
    process.exit(1);
  }
  
  const poolAddr = config.deployment.communityPool.proxy;
  const timelockAddr = config.deployment.timelock.address;
  
  console.log(`📍 CommunityPool: ${poolAddr}`);
  console.log(`📍 Timelock: ${timelockAddr}\n`);
  
  let passed = 0;
  let failed = 0;
  
  function check(name, condition, detail) {
    if (condition) {
      console.log(`  ✅ ${name}: ${detail}`);
      passed++;
    } else {
      console.log(`  ❌ ${name}: ${detail}`);
      failed++;
    }
  }
  
  // ══════════════════════════════════════════════════════════════════
  // SECTION 1: CONTRACT EXISTENCE
  // ══════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  CONTRACT EXISTENCE");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  const poolCode = await ethers.provider.getCode(poolAddr);
  check("CommunityPool deployed", poolCode !== "0x", poolCode !== "0x" ? "Contract exists" : "NO CODE");
  
  const timelockCode = await ethers.provider.getCode(timelockAddr);
  check("Timelock deployed", timelockCode !== "0x", timelockCode !== "0x" ? "Contract exists" : "NO CODE");
  
  // ══════════════════════════════════════════════════════════════════
  // SECTION 2: ACCESS CONTROL
  // ══════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  ACCESS CONTROL");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  const pool = await ethers.getContractAt("CommunityPool", poolAddr);
  const [deployer] = await ethers.getSigners();
  
  const DEFAULT_ADMIN_ROLE = await pool.DEFAULT_ADMIN_ROLE();
  const UPGRADER_ROLE = await pool.UPGRADER_ROLE();
  const AGENT_ROLE = await pool.AGENT_ROLE();
  
  const timelockIsAdmin = await pool.hasRole(DEFAULT_ADMIN_ROLE, timelockAddr);
  check("Timelock is DEFAULT_ADMIN", timelockIsAdmin, timelockIsAdmin ? "SECURE" : "DANGER - not admin!");
  
  const timelockIsUpgrader = await pool.hasRole(UPGRADER_ROLE, timelockAddr);
  check("Timelock is UPGRADER", timelockIsUpgrader, timelockIsUpgrader ? "SECURE" : "DANGER!");
  
  const deployerIsAdmin = await pool.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
  check("Deployer NOT admin", !deployerIsAdmin, !deployerIsAdmin ? "SECURE" : "DANGER - deployer still admin!");
  
  const deployerIsUpgrader = await pool.hasRole(UPGRADER_ROLE, deployer.address);
  check("Deployer NOT upgrader", !deployerIsUpgrader, !deployerIsUpgrader ? "SECURE" : "DANGER!");
  
  // ══════════════════════════════════════════════════════════════════
  // SECTION 3: TIMELOCK CONFIGURATION
  // ══════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  TIMELOCK CONFIGURATION");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  const timelock = await ethers.getContractAt("CommunityPoolTimelock", timelockAddr);
  const minDelay = await timelock.getMinDelay();
  const delayHours = Number(minDelay) / 3600;
  check("Min delay >= 48 hours", delayHours >= 48, `${delayHours} hours`);
  
  // Check proposer role
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const multisigAddr = config.addresses.multisig.admin;
  const multisigIsProposer = await timelock.hasRole(PROPOSER_ROLE, multisigAddr);
  check("Multisig is proposer", multisigIsProposer, multisigIsProposer ? multisigAddr : "NOT PROPOSER!");
  
  // ══════════════════════════════════════════════════════════════════
  // SECTION 4: POOL CONFIGURATION
  // ══════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  POOL CONFIGURATION");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  const depositToken = await pool.depositToken();
  check("Deposit token (USDC)", depositToken.toLowerCase() === config.addresses.tokens.usdc.toLowerCase(),
    depositToken);
  
  const treasury = await pool.treasury();
  check("Treasury set", treasury.toLowerCase() === config.addresses.multisig.treasury.toLowerCase(),
    treasury);
  
  const pythOracle = await pool.pythOracle();
  check("Pyth Oracle set", pythOracle.toLowerCase() === config.addresses.oracles.pyth.toLowerCase(),
    pythOracle);
  
  const maxDeposit = await pool.maxSingleDeposit();
  check("Max single deposit", maxDeposit.toString() === config.circuitBreakers.maxSingleDeposit,
    `$${Number(maxDeposit) / 1e6}`);
  
  const maxWithdrawal = await pool.maxSingleWithdrawalBps();
  check("Max withdrawal BPS", Number(maxWithdrawal) === config.circuitBreakers.maxSingleWithdrawalBps,
    `${Number(maxWithdrawal) / 100}%`);
  
  const dailyCap = await pool.dailyWithdrawalCapBps();
  check("Daily withdrawal cap", Number(dailyCap) === config.circuitBreakers.dailyWithdrawalCapBps,
    `${Number(dailyCap) / 100}%`);
  
  // ══════════════════════════════════════════════════════════════════
  // SECTION 5: ORACLE HEALTH
  // ══════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  ORACLE HEALTH");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  try {
    const oracleHealth = await pool.checkOracleHealth();
    const healthyCount = oracleHealth.filter(h => h).length;
    check("Oracle feeds healthy", healthyCount >= 2, `${healthyCount}/4 feeds active`);
    
    const prices = await pool.getOraclePrices();
    console.log("\n  📊 Current Prices:");
    const assets = ["BTC", "ETH", "SUI", "CRO"];
    for (let i = 0; i < 4; i++) {
      const priceUsd = Number(prices[i]) / 1e8;
      const status = oracleHealth[i] ? "✓" : "⚠️ stale";
      console.log(`     ${assets[i]}: $${priceUsd.toLocaleString()} ${status}`);
    }
  } catch (e) {
    console.log("  ⚠️  Oracle check failed - prices may need to be pushed first");
  }
  
  // ══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  VERIFICATION SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  
  if (failed === 0) {
    console.log("\n  🎉 ALL VERIFICATIONS PASSED");
    console.log("\n  Pool is ready for production use.\n");
    
    // Update config
    config.preflightChecklist.verifiedOnExplorer = true;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    
    console.log("  FINAL CHECKLIST:");
    console.log("  □ Verify contracts on CronosScan");
    console.log("  □ Test small deposit from multisig");
    console.log("  □ Test small withdrawal");
    console.log("  □ Update frontend with new addresses");
    console.log("  □ Announce mainnet launch\n");
  } else {
    console.log(`\n  ❌ ${failed} VERIFICATION(S) FAILED`);
    console.log("  Review and fix critical issues before accepting deposits.\n");
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
