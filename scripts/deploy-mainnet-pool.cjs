/**
 * Deploy CommunityPool to Mainnet (Ethereum or Cronos)
 * 
 * STEPS TO DEPLOY TO MAINNET:
 * 1. Set PRIVATE_KEY environment variable (deployer wallet with ETH/CRO for gas)
 * 2. Run: npx hardhat run scripts/deploy-mainnet-pool.cjs --network <network>
 * 
 * Supported Networks:
 *   - ethereum (chainId: 1, uses USDT: 0xdAC17F958D2ee523a2206206994597C13D831ec7)
 *   - cronos (chainId: 25, uses USDT: 0x66e428c3f67a68878562e79A0234c1F83c208770)
 * 
 * WARNING: This deploys to MAINNET with REAL funds. Double-check everything!
 */

const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

// Mainnet USDT addresses (official Tether)
const MAINNET_USDT = {
  1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',     // Ethereum Mainnet
  25: '0x66e428c3f67a68878562e79A0234c1F83c208770',    // Cronos Mainnet
  42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // Arbitrum One
  296: process.env.HEDERA_USDT_ADDRESS || '0x0000000000000000000000000000000000068cc2', // Hedera Testnet (USDT)
};

// Pyth Oracle addresses
const PYTH_ORACLES = {
  1: '0x4305FB66699C3B2702D4d05CF36551390A4c69C6',     // Ethereum Mainnet
  25: '0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B',    // Cronos Mainnet
  42161: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C', // Arbitrum One
  296: process.env.HEDERA_PYTH_ORACLE || '0x000000000000000000000000000000000004ae4cf', // Hedera Testnet (Pyth)
};

const NETWORK_NAMES = {
  1: 'Ethereum Mainnet',
  25: 'Cronos Mainnet',
  42161: 'Arbitrum One',
  296: 'Hedera Testnet',
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  
  console.log('\n' + '═'.repeat(70));
  console.log('   🚀 MAINNET COMMUNITY POOL DEPLOYMENT');
  console.log('═'.repeat(70));
  console.log(`\n📍 Network: ${NETWORK_NAMES[chainId] || `Unknown (${chainId})`}`);
  console.log(`👛 Deployer: ${deployer.address}`);
  
  // Check if this is a supported network
  if (![1, 25, 42161, 296].includes(chainId)) {
    console.error(`\n❌ Error: Chain ${chainId} is not a supported network.`);
    console.log('   Supported: ethereum (1), cronos (25), arbitrum (42161), hedera-testnet (296)');
    process.exit(1);
  }
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance: ${hre.ethers.formatEther(balance)} ${chainId === 25 ? 'CRO' : chainId === 296 ? 'HBAR' : 'ETH'}`);
  if (chainId === 296 && balance.eq(0)) {
    console.error('\n❌ Error: Hedera testnet account balance is 0. Fund this account with testnet HBAR gas before deploying.');
    process.exit(1);
  }

  const usdtAddress = MAINNET_USDT[chainId];
  const pythAddress = PYTH_ORACLES[chainId];
  
  console.log(`\n📋 Configuration:`);
  console.log(`   USDT Address: ${usdtAddress}`);
  console.log(`   Pyth Oracle:  ${pythAddress}`);
  
  // Safety prompt
  console.log('\n' + '⚠️'.repeat(35));
  if (chainId !== 296) {
    console.log('   WARNING: YOU ARE DEPLOYING TO MAINNET');
    console.log('   This will use REAL funds and create a REAL contract.');
  } else {
    console.log('   WARNING: YOU ARE DEPLOYING TO HEDERA TESTNET');
    console.log('   Confirm the account exists and has enough testnet gas tokens.');
  }
  console.log('⚠️'.repeat(35));

  // Verify USDT is correct
  const usdt = await hre.ethers.getContractAt(
    ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'],
    usdtAddress
  );
  
  try {
    if (chainId !== 296) {
      const symbol = await usdt.symbol();
      const decimals = await usdt.decimals();
      console.log(`\n✅ Verified USDT: ${symbol} (${decimals} decimals)`);
      
      if (symbol !== 'USDT' && symbol !== 'USD₮') {
        console.error(`\n❌ Error: Token at ${usdtAddress} is ${symbol}, not USDT!`);
        process.exit(1);
      }
    } else {
      console.log('\n⚠️ Hedera testnet: skipping USDT symbol verification, using provided address');
    }
  } catch (e) {
    console.error(`\n❌ Error: Could not verify USDT at ${usdtAddress}`);
    console.error(e.message);
    process.exit(1);
  }
  
  console.log('\n🏗️  Deploying CommunityPool Implementation...');
  
  // Deploy implementation
  const CommunityPool = await hre.ethers.getContractFactory('CommunityPool');
  const implementation = await CommunityPool.deploy();
  await implementation.waitForDeployment();
  const implAddress = await implementation.getAddress();
  console.log(`   Implementation: ${implAddress}`);
  
  // Initialize data
  console.log('\n🏗️  Deploying Proxy...');
  const initData = implementation.interface.encodeFunctionData('initialize', [
    usdtAddress,
    deployer.address, // treasury
    deployer.address, // manager
  ]);
  
  // Deploy proxy
  const ERC1967Proxy = await hre.ethers.getContractFactory(
    '@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy'
  );
  const proxy = await ERC1967Proxy.deploy(implAddress, initData);
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  console.log(`   Proxy: ${proxyAddress}`);
  
  // Verify deployment
  const pool = await hre.ethers.getContractAt('CommunityPool', proxyAddress);
  const depositToken = await pool.depositToken();
  console.log(`\n✅ Pool verified, deposit token: ${depositToken}`);
  
  // Save deployment info
  const networkKey = chainId === 1 ? 'ethereum' : chainId === 25 ? 'cronos' : chainId === 42161 ? 'arbitrum' : chainId === 296 ? 'hedera-testnet' : 'unknown';
  const explorerUrl =
    chainId === 1
      ? `https://etherscan.io/address/${proxyAddress}`
      : chainId === 25
      ? `https://explorer.cronos.org/address/${proxyAddress}`
      : chainId === 42161
      ? `https://arbiscan.io/address/${proxyAddress}`
      : chainId === 296
      ? `https://hashscan.io/testnet/account/${deployer.address}`
      : 'unknown';

  const deploymentInfo = {
    network: NETWORK_NAMES[chainId],
    chainId,
    timestamp: new Date().toISOString(),
    contracts: {
      CommunityPool: {
        proxy: proxyAddress,
        implementation: implAddress,
      },
    },
    tokens: {
      USDT: {
        address: usdtAddress,
        symbol: 'USDT',
        decimals: 6,
      },
    },
    deployer: deployer.address,
    explorer: explorerUrl,
  };
  
  const deploymentPath = path.join(__dirname, '..', 'deployments', `community-pool-${networkKey}-mainnet.json`);
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n📄 Deployment saved: ${deploymentPath}`);
  
  console.log('\n' + '═'.repeat(70));
  console.log('   ✅ MAINNET DEPLOYMENT COMPLETE');
  console.log('═'.repeat(70));
  console.log(`\n   Pool Address: ${proxyAddress}`);
  console.log(`   Deposit Token: USDT (${usdtAddress})`);
  console.log(`   Explorer: ${deploymentInfo.explorer}`);
  console.log('\n   NEXT STEPS:');
  console.log('   1. Update lib/contracts/community-pool-config.ts with the new address');
  console.log('   2. Verify contract on block explorer');
  console.log('   3. Test with a small deposit before going live');
  console.log('═'.repeat(70) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
