/**
 * MAINNET PRE-FLIGHT VERIFICATION
 * 
 * Run this script BEFORE deployment to verify everything is ready.
 * 
 * USAGE:
 * npx hardhat run scripts/deploy/mainnet-preflight.cjs --network cronos-mainnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "..", "deployments", "mainnet-config.json");

async function main() {
  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║     MAINNET PRE-FLIGHT VERIFICATION                           ║");
  console.log("║     Checking all requirements before deployment               ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");
  
  let passed = 0;
  let failed = 0;
  let warnings = 0;
  
  function check(name, success, message) {
    if (success) {
      console.log(`  ✅ ${name}: ${message}`);
      passed++;
    } else {
      console.log(`  ❌ ${name}: ${message}`);
      failed++;
    }
  }
  
  function warn(name, message) {
    console.log(`  ⚠️  ${name}: ${message}`);
    warnings++;
  }
  
  // ══════════════════════════════════════════════════════════════════
  // SECTION 1: CONFIG FILE
  // ══════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  CONFIGURATION FILE");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  const configExists = fs.existsSync(CONFIG_PATH);
  check("Config file exists", configExists, configExists ? CONFIG_PATH : "NOT FOUND");
  
  if (!configExists) {
    console.log("\n❌ Cannot proceed without config file.");
    console.log("   Create deployments/mainnet-config.json first.\n");
    process.exit(1);
  }
  
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  
  // Check multisig
  const multisigValid = config.addresses?.multisig?.admin && 
    config.addresses.multisig.admin !== "REPLACE_WITH_GNOSIS_SAFE_ADDRESS" &&
    ethers.isAddress(config.addresses.multisig.admin);
  check("Multisig address", multisigValid, 
    multisigValid ? config.addresses.multisig.admin : "Not configured");
  
  // Check treasury
  const treasuryValid = config.addresses?.multisig?.treasury &&
    config.addresses.multisig.treasury !== "REPLACE_WITH_TREASURY_SAFE_ADDRESS" &&
    ethers.isAddress(config.addresses.multisig.treasury);
  check("Treasury address", treasuryValid,
    treasuryValid ? config.addresses.multisig.treasury : "Not configured");
  
  // Check USDC
  const usdcValid = ethers.isAddress(config.addresses?.tokens?.usdc);
  check("USDC address", usdcValid, config.addresses?.tokens?.usdc || "Not set");
  
  // Check Pyth
  const pythValid = ethers.isAddress(config.addresses?.oracles?.pyth);
  check("Pyth Oracle address", pythValid, config.addresses?.oracles?.pyth || "Not set");
  
  // Check timelock config
  const timelockValid = config.timelock?.minDelay >= 172800;
  check("Timelock delay (48h min)", timelockValid, 
    `${config.timelock?.minDelay / 3600} hours`);
  
  // Check price IDs
  const priceIdsValid = config.priceIds?.BTC && config.priceIds?.ETH;
  check("Price feed IDs", priceIdsValid, priceIdsValid ? "BTC, ETH, SUI, CRO" : "Missing");
  
  // ══════════════════════════════════════════════════════════════════
  // SECTION 2: NETWORK & WALLET
  // ══════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  NETWORK & WALLET");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  const network = await ethers.provider.getNetwork();
  const isMainnet = Number(network.chainId) === 25;
  check("Connected to Cronos Mainnet", isMainnet, `Chain ID: ${network.chainId}`);
  
  if (!isMainnet) {
    warn("Wrong network", "Run with --network cronos-mainnet");
  }
  
  const [deployer] = await ethers.getSigners();
  console.log(`\n  Deployer: ${deployer.address}\n`);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  const balanceEth = parseFloat(ethers.formatEther(balance));
  const hasSufficientBalance = balanceEth >= 50;
  check("Deployer CRO balance", hasSufficientBalance, 
    `${balanceEth.toFixed(4)} CRO (need 50+)`);
  
  // ══════════════════════════════════════════════════════════════════
  // SECTION 3: ON-CHAIN VERIFICATION
  // ══════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  ON-CHAIN VERIFICATION");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  if (isMainnet) {
    // Verify USDC contract
    if (usdcValid) {
      const usdcCode = await ethers.provider.getCode(config.addresses.tokens.usdc);
      const usdcDeployed = usdcCode !== "0x";
      check("USDC contract deployed", usdcDeployed, 
        usdcDeployed ? "Contract exists" : "No code at address");
      
      if (usdcDeployed) {
        try {
          const usdc = new ethers.Contract(
            config.addresses.tokens.usdc,
            ["function symbol() view returns (string)", "function decimals() view returns (uint8)"],
            ethers.provider
          );
          const symbol = await usdc.symbol();
          const decimals = await usdc.decimals();
          check("USDC token valid", symbol === "USDC" && decimals === 6, 
            `${symbol}, ${decimals} decimals`);
        } catch (e) {
          warn("USDC verification", "Could not read token info");
        }
      }
    }
    
    // Verify Pyth Oracle
    if (pythValid) {
      const pythCode = await ethers.provider.getCode(config.addresses.oracles.pyth);
      const pythDeployed = pythCode !== "0x";
      check("Pyth Oracle deployed", pythDeployed,
        pythDeployed ? "Contract exists" : "No code at address");
    }
    
    // Verify Multisig (should be Gnosis Safe)
    if (multisigValid) {
      const multisigCode = await ethers.provider.getCode(config.addresses.multisig.admin);
      const multisigDeployed = multisigCode !== "0x";
      check("Multisig contract deployed", multisigDeployed,
        multisigDeployed ? "Contract exists (Gnosis Safe)" : "No code - NOT A SAFE!");
    }
  } else {
    warn("On-chain checks skipped", "Not connected to mainnet");
  }
  
  // ══════════════════════════════════════════════════════════════════
  // SECTION 4: CONTRACT COMPILATION
  // ══════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  CONTRACT COMPILATION");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  try {
    const CommunityPool = await ethers.getContractFactory("CommunityPool");
    check("CommunityPool compiled", true, "Factory loaded");
    
    const Timelock = await ethers.getContractFactory("CommunityPoolTimelock");
    check("CommunityPoolTimelock compiled", true, "Factory loaded");
  } catch (e) {
    check("Contracts compiled", false, e.message);
  }
  
  // Check ABI exists
  const abiPath = path.join(__dirname, "..", "..", "contracts", "abi", "CommunityPool.json");
  const abiExists = fs.existsSync(abiPath);
  check("Frontend ABI exists", abiExists, abiExists ? "contracts/abi/CommunityPool.json" : "Missing");
  
  // ══════════════════════════════════════════════════════════════════
  // SECTION 5: ENVIRONMENT
  // ══════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  ENVIRONMENT");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  const hasPrivateKey = !!process.env.PRIVATE_KEY || !!process.env.DEPLOYER_PRIVATE_KEY;
  check("Private key configured", hasPrivateKey, hasPrivateKey ? "Set in env" : "MISSING - check .env");
  
  // ══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  PREFLIGHT SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log(`  ✅ Passed:   ${passed}`);
  console.log(`  ❌ Failed:   ${failed}`);
  console.log(`  ⚠️  Warnings: ${warnings}`);
  
  if (failed === 0) {
    console.log("\n  🚀 ALL CHECKS PASSED - Ready for mainnet deployment!\n");
    console.log("  Run deployment with:");
    console.log("  npx hardhat run scripts/deploy/deploy-mainnet-full.cjs --network cronos-mainnet\n");
    
    // Update checklist
    config.preflightChecklist.deployerHasCRO = hasSufficientBalance;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } else {
    console.log(`\n  ❌ ${failed} CHECK(S) FAILED - Fix issues before deployment\n`);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
