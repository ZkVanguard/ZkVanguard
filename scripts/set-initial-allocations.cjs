/**
 * Set Initial Pool Allocations
 * 
 * Sets the Community Pool's target allocations to 25% each for BTC/ETH/SUI/CRO
 * This enables the pool to hedge into these assets and generate risk metrics.
 * 
 * Usage: npx hardhat run scripts/set-initial-allocations.cjs --network cronos-testnet
 */

const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.local' });

// CommunityPool V3 Proxy Address
const COMMUNITY_POOL_ADDRESS = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';
const CRONOS_TESTNET_RPC = 'https://evm-t3.cronos.org';

const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function setTargetAllocation(uint256[4] newAllocationBps, string reasoning)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function REBALANCER_ROLE() view returns (bytes32)',
  'function grantRole(bytes32 role, address account)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
];

async function setInitialAllocations() {
  // Load private key from env
  const privateKey = process.env.AGENT_SIGNER_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ No AGENT_SIGNER_KEY or PRIVATE_KEY found in .env.local');
    console.log('   Set your rebalancer wallet private key to execute this script.');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
  const wallet = new ethers.Wallet(privateKey, provider);
  const pool = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, wallet);

  console.log('🔄 Setting Initial Pool Allocations\n');
  console.log(`   Pool Address: ${COMMUNITY_POOL_ADDRESS}`);
  console.log(`   Wallet: ${wallet.address}\n`);

  // Get current stats
  console.log('⏳ Fetching current pool stats...');
  const stats = await pool.getPoolStats();
  
  const currentAllocations = {
    BTC: Number(stats._allocations[0]) / 100,
    ETH: Number(stats._allocations[1]) / 100,
    SUI: Number(stats._allocations[2]) / 100,
    CRO: Number(stats._allocations[3]) / 100,
  };
  
  console.log('📊 Current allocations:');
  console.log(`   BTC: ${currentAllocations.BTC}%`);
  console.log(`   ETH: ${currentAllocations.ETH}%`);
  console.log(`   SUI: ${currentAllocations.SUI}%`);
  console.log(`   CRO: ${currentAllocations.CRO}%\n`);
  
  // Check if already allocated
  const isAllocated = currentAllocations.BTC > 0 || currentAllocations.ETH > 0;
  if (isAllocated) {
    console.log('✅ Pool already has allocations set. Skipping...');
    console.log('   Use force=true to override if needed.');
    return;
  }

  // Check rebalancer role
  console.log('⏳ Checking permissions...');
  const REBALANCER_ROLE = await pool.REBALANCER_ROLE();
  const hasRebalancerRole = await pool.hasRole(REBALANCER_ROLE, wallet.address);
  
  if (!hasRebalancerRole) {
    console.log('❌ Wallet does not have REBALANCER_ROLE');
    console.log('   The pool admin needs to grant this role first.');
    console.log(`   REBALANCER_ROLE: ${REBALANCER_ROLE}`);
    
    // Try to grant if we have admin
    try {
      const DEFAULT_ADMIN_ROLE = await pool.DEFAULT_ADMIN_ROLE();
      const isAdmin = await pool.hasRole(DEFAULT_ADMIN_ROLE, wallet.address);
      if (isAdmin) {
        console.log('\n⏳ Granting REBALANCER_ROLE to wallet...');
        const tx = await pool.grantRole(REBALANCER_ROLE, wallet.address);
        await tx.wait();
        console.log('✅ Role granted!');
      } else {
        console.log('   (Wallet is not admin either)');
        process.exit(1);
      }
    } catch (err) {
      console.error('   Failed to check/grant role:', err.message);
      process.exit(1);
    }
  } else {
    console.log('✅ Wallet has REBALANCER_ROLE');
  }

  // Set new allocations: 25% each
  // [BTC, ETH, SUI, CRO] in basis points (10000 = 100%)
  const newAllocations = [2500, 2500, 2500, 2500];
  const reasoning = 'Initial allocation: Equal-weight portfolio across BTC, ETH, SUI, CRO for diversified hedging';

  console.log('\n⏳ Setting new allocations...');
  console.log('   Target:');
  console.log('   BTC: 25%');
  console.log('   ETH: 25%');
  console.log('   SUI: 25%');
  console.log('   CRO: 25%');
  console.log(`   Reasoning: "${reasoning}"\n`);

  try {
    const tx = await pool.setTargetAllocation(newAllocations, reasoning);
    console.log(`   Tx Hash: ${tx.hash}`);
    console.log('   Waiting for confirmation...');
    
    const receipt = await tx.wait();
    console.log(`   ✅ Confirmed in block ${receipt.blockNumber}\n`);
    
    // Verify
    const newStats = await pool.getPoolStats();
    console.log('📊 New allocations:');
    console.log(`   BTC: ${Number(newStats._allocations[0]) / 100}%`);
    console.log(`   ETH: ${Number(newStats._allocations[1]) / 100}%`);
    console.log(`   SUI: ${Number(newStats._allocations[2]) / 100}%`);
    console.log(`   CRO: ${Number(newStats._allocations[3]) / 100}%`);
    
    console.log('\n✅ Initial allocations set successfully!');
    console.log('   The pool will now allocate USDT deposits into BTC/ETH/SUI/CRO positions.');
    console.log('   Risk metrics will reflect portfolio volatility after the next cron run.');
    
  } catch (err) {
    console.error('❌ Failed to set allocations:', err.message);
    if (err.message.includes('RebalanceCooldown')) {
      console.log('   The pool has a rebalance cooldown active. Try again later.');
    }
    process.exit(1);
  }
}

setInitialAllocations().catch(console.error);
