/**
 * Deploy CommunityPool to Hedera Testnet
 *
 * Prerequisites:
 * 1. Set HEDERA_PRIVATE_KEY in .env file or env (deployer must have HBAR for gas)
 * 2. Set HEDERA_TESTNET_RPC_URL to an operational Hedera EVM endpoint
 * 3. Set HEDERA_USDT_ADDRESS and HEDERA_PYTH_ORACLE to valid addresses on Hedera
 *
 * Usage:
 *   npx hardhat run scripts/deploy/deploy-community-pool-hedera.cjs --network hedera-testnet
 */

const { ethers, upgrades } = require('hardhat');
const fs = require('fs');
const path = require('path');

const NETWORK_NAME = 'Hedera Testnet';
const CHAIN_ID = 296;

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('   COMMUNITY POOL DEPLOYMENT - Hedera Testnet');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Deployer:', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance:', ethers.formatEther(balance), 'HBAR');

  const minBalance = ethers.parseEther('0.05');
  if (typeof balance === 'bigint' ? balance < minBalance : balance.lt(minBalance)) {
    console.log('⚠️  Low balance on Hedera testnet. Fund with HBAR from a faucet before deployment.');
    throw new Error('Insufficient HBAR balance');
  }

  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== CHAIN_ID) {
    throw new Error(`Expected Hedera chainId ${CHAIN_ID}, got ${network.chainId}`);
  }

  const usdtAddress = process.env.HEDERA_USDT_ADDRESS || '0x0000000000000000000000000000000000068cc2';
  const pythOracle = process.env.HEDERA_PYTH_ORACLE || '0x000000000000000000000000000000000004ae4cf';

  console.log('\nConfig:' );
  console.log('  USDT:', usdtAddress);
  console.log('  Pyth oracle:', pythOracle);

  if (usdtAddress === '0x0000000000000000000000000000000000000000' || pythOracle === '0x0000000000000000000000000000000000000000') {
    console.log('⚠️  Warning: Using zero address for USDT or Pyth on Hedera, please set HEDERA_USDT_ADDRESS and HEDERA_PYTH_ORACLE.');
  }

  // Fee override for Hedera EVM (avoid INSUFFICIENT_TX_FEE on simulation)
  const providerFeeData = await ethers.provider.getFeeData();
  const finalMaxFee = ethers.parseUnits('20000', 'gwei');
  const maxPriority = ethers.parseUnits('1', 'gwei');

  console.log('Current Hedera feeData:', {
    providerMaxFeePerGas: ethers.formatUnits(providerFeeData.maxFeePerGas || 0n, 'gwei') + ' gwei',
    providerPriority: ethers.formatUnits(providerFeeData.maxPriorityFeePerGas || 0n, 'gwei') + ' gwei',
    finalMaxFeePerGas: ethers.formatUnits(finalMaxFee, 'gwei') + ' gwei',
    finalPriority: ethers.formatUnits(maxPriority, 'gwei') + ' gwei',
  });

  const feeOverrides = {
    gasLimit: 15_000_000,
    maxFeePerGas: finalMaxFee,
    maxPriorityFeePerGas: maxPriority,
    type: 2,
  };

  // Validate USDT contract exists
  const usdtCode = await ethers.provider.getCode(usdtAddress);
  if (usdtAddress !== '0x0000000000000000000000000000000000000000' && usdtCode === '0x') {
    console.warn('⚠️ USDT contract not found at provided address; continuing deployment anyway for test purposes.');
  }

  // Deploy CommunityPool (UUPS preferred, direct fallback for Hedera fee constraints)
  console.log('\n🚀 Deploying CommunityPool proxy (first attempt)...');
  const CommunityPool = await ethers.getContractFactory('CommunityPool');

  let pool;
  let proxyAddress;
  let implAddress;
  let deployedViaProxy = true;
  let deployTxHash = null;
  let initTxHash = null;

  try {
    pool = await upgrades.deployProxy(
      CommunityPool,
      [
        usdtAddress,
        [
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
        ],
        deployer.address, // treasury
        deployer.address, // admin
      ],
      {
        initializer: 'initialize',
        kind: 'uups',
        timeout: 120000,
        ...feeOverrides,
      }
    );

    await pool.waitForDeployment();
    proxyAddress = await pool.getAddress();
    implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    deployTxHash = pool.deployTransaction?.hash || null;

    console.log('✅ Proxy deployed');
    if (deployTxHash) console.log('   Deploy tx hash:', deployTxHash);
    console.log('   Proxy:', proxyAddress);
    console.log('   Implementation:', implAddress);
  } catch (proxyErr) {
    deployedViaProxy = false;
    console.warn('⚠️ deployProxy failed, falling back to direct implementation path:', proxyErr.message);
    pool = await CommunityPool.deploy({ ...feeOverrides });
    await pool.waitForDeployment();

    proxyAddress = await pool.getAddress();
    implAddress = proxyAddress;
    deployTxHash = pool.deployTransaction?.hash || null;

    console.log('✅ Direct implementation deployed (proxy fallback) at', proxyAddress);
    if (deployTxHash) console.log('   Deploy tx hash:', deployTxHash);

    if (usdtAddress === '0x0000000000000000000000000000000000000000' || pythOracle === '0x0000000000000000000000000000000000000000') {
      console.log('⚠️ Initialization skipped due to zero USDT/Pyth settings. Set HEDERA_USDT_ADDRESS and HEDERA_PYTH_ORACLE to initialize.');
    } else {
      console.log('\n🔧 Running initialize() on direct implementation...');
      const initTx = await pool.initialize(
        usdtAddress,
        [
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
        ],
        deployer.address,
        deployer.address,
        { ...feeOverrides }
      );
      initTxHash = initTx.hash;
      await initTx.wait();
      console.log('✅ Direct implementation initialized');
      if (initTxHash) console.log('   init tx hash:', initTxHash);
    }
  }

  console.log('Deployment mode:', deployedViaProxy ? 'UUPS proxy' : 'Direct implementation');

  if (pythOracle !== '0x0000000000000000000000000000000000000000') {
    console.log('\n🔧 Setting Pyth oracle...');
    const tx = await pool.setPythOracle(pythOracle, {
      ...feeOverrides,
      gasLimit: 200000,
    });
    await tx.wait();
    console.log('✅ Pyth oracle configured');
  }

  console.log('\n🔍 Verifying deployment (pool stats)');
  try {
    const stats = await pool.getPoolStats();
    console.log('   Total shares:', stats._totalShares.toString());
    console.log('   Total NAV:', ethers.formatUnits(stats._totalNAV, 6));
  } catch (statsErr) {
    console.warn('⚠️ Could not read pool stats (likely uninitialized or not available):', statsErr.message);
  }

  const deploymentInfo = {
    network: NETWORK_NAME,
    chainId: CHAIN_ID,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    txHash: deployTxHash,
    initTxHash: initTxHash,
    contracts: {
      CommunityPool: {
        proxy: proxyAddress,
        implementation: implAddress,
      },
    },
    tokens: {
      USDT: usdtAddress,
      PythOracle: pythOracle,
    },
  };

  const outPath = path.join(__dirname, '..', '..', 'deployments', 'community-pool-hedera-testnet.json');
  fs.writeFileSync(outPath, JSON.stringify(deploymentInfo, null, 2));
  console.log('📁 Deployment saved to', outPath);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('   Hedera deployment complete');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch((error) => {
  console.error('ERROR', error.message || error);
  process.exit(1);
});
