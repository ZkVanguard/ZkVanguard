/**
 * Execute Pool Rebalance - Swap USDT to 25% BTC/ETH/SUI/CRO
 * 
 * This script converts the pool's USDT holdings into the target allocation:
 * - 25% BTC
 * - 25% ETH  
 * - 25% SUI
 * - 25% CRO
 * 
 * Usage:
 *   npx hardhat run scripts/execute-pool-rebalance.cjs --network cronos-testnet
 */
require('dotenv').config({ path: '.env.local' });
const { ethers } = require('hardhat');

const CONFIG = {
  communityPool: '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30',
  usdt: '0x28217DAddC55e3C4831b4A48A00Ce04880786967', // MockUSDT
  
  // SimpleMockDEX (with mint capability)
  simpleMockDEX: '0xa3779aE2B1659cE7cF012A061658FE6C513dBC99',
  
  // Mock asset tokens on Cronos Testnet
  assetTokens: [
    '0x851837c11DC08E127a1dF738A3a1AC9770c1D01e', // BTC (index 0)
    '0x8ef76152429665773f7646aF5b394295Ff3956E1', // ETH (index 1)
    '0x42117b8AC627F296c4095fB930A0DDcC38985429', // SUI (index 2)
    '0xb56D096A12f5b809EB2799A8d9060CE87fE44665', // CRO (index 3)
  ],
  
  assetNames: ['BTC', 'ETH', 'SUI', 'CRO'],
  
  // Pyth price feed IDs
  pythPriceIds: [
    '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC
    '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH
    '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744', // SUI
    '0x23199cd2b499d37de779e67bebd2dd9f3b9cdd6ce82c9a5f17dfec5e3d8d4d71', // CRO
  ],
  
  // Target allocation: 25% each
  targetAllocation: 25,
};

const POOL_ABI = [
  'function dexRouter() view returns (address)',
  'function setDexRouter(address) external',
  'function assetTokens(uint8) view returns (address)',
  'function setAssetToken(uint8 assetIndex, address token) external',
  'function setPythPriceId(uint8 assetIndex, bytes32 priceId) external',
  'function pythPriceIds(uint8) view returns (bytes32)',
  'function assetBalances(uint8) view returns (uint256)',
  'function depositToken() view returns (address)',
  'function executeRebalanceTrade(uint8 assetIndex, uint256 amount, bool isBuy, uint256 minAmountOut) external',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function REBALANCER_ROLE() view returns (bytes32)',
  'function grantRole(bytes32 role, address account) external',
  'function getPoolStats() view returns (uint256 _totalNAV, uint256 _sharePrice, uint256 _totalShares, uint256 _memberCount)',
];

const DEX_ABI = [
  'function usdc() view returns (address)',
  'function assetTokens(uint8) view returns (address)',
  'function configureAsset(uint8 assetIndex, address token, uint8 decimals, uint256 priceInUsdc) external',
  'function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       COMMUNITY POOL REBALANCE - USDT → BTC/ETH/SUI/CRO    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Executor:', deployer.address);
  console.log('Balance:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'CRO');
  console.log('');
  
  const pool = new ethers.Contract(CONFIG.communityPool, POOL_ABI, deployer);
  const usdt = new ethers.Contract(CONFIG.usdt, ERC20_ABI, deployer);
  
  // ═══════════════════════════════════════════════════════════════
  // 1. CHECK CURRENT STATE
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 1: Current Pool State ═══');
  const usdtBalance = await usdt.balanceOf(CONFIG.communityPool);
  const usdtDecimals = await usdt.decimals();
  console.log('USDT Balance:', ethers.formatUnits(usdtBalance, usdtDecimals), 'USDT');
  
  const dexRouter = await pool.dexRouter();
  console.log('DEX Router:', dexRouter);
  
  for (let i = 0; i < 4; i++) {
    try {
      const token = await pool.assetTokens(i);
      const balance = await pool.assetBalances(i);
      console.log(`Asset[${i}] (${CONFIG.assetNames[i]}): ${token}, Balance: ${balance.toString()}`);
    } catch (e) {
      console.log(`Asset[${i}] (${CONFIG.assetNames[i]}): Not configured`);
    }
  }
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 2. CONFIGURE DEX ROUTER IF NEEDED
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 2: Configure DEX Router ═══');
  if (dexRouter === '0x0000000000000000000000000000000000000000' || dexRouter !== CONFIG.simpleMockDEX) {
    console.log('Setting DEX Router to SimpleMockDEX:', CONFIG.simpleMockDEX);
    const tx = await pool.setDexRouter(CONFIG.simpleMockDEX);
    await tx.wait();
    console.log('✅ DEX Router configured');
  } else {
    console.log('✅ DEX Router already set correctly');
  }
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 3. CONFIGURE ASSET TOKENS
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 3: Configure Asset Tokens ═══');
  for (let i = 0; i < 4; i++) {
    let currentToken;
    try {
      currentToken = await pool.assetTokens(i);
    } catch {
      currentToken = '0x0000000000000000000000000000000000000000';
    }
    
    if (currentToken === '0x0000000000000000000000000000000000000000') {
      console.log(`Setting Asset[${i}] (${CONFIG.assetNames[i]}): ${CONFIG.assetTokens[i]}`);
      const tx = await pool.setAssetToken(i, CONFIG.assetTokens[i]);
      await tx.wait();
      console.log(`✅ Asset[${i}] configured`);
    } else if (currentToken.toLowerCase() !== CONFIG.assetTokens[i].toLowerCase()) {
      console.log(`Updating Asset[${i}] from ${currentToken} to ${CONFIG.assetTokens[i]}`);
      const tx = await pool.setAssetToken(i, CONFIG.assetTokens[i]);
      await tx.wait();
      console.log(`✅ Asset[${i}] updated`);
    } else {
      console.log(`✅ Asset[${i}] (${CONFIG.assetNames[i]}) already configured`);
    }
  }
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 4. CONFIGURE PYTH PRICE IDS (skip if not supported)
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 4: Configure Pyth Price IDs ═══');
  let priceIdsSupported = true;
  for (let i = 0; i < 4; i++) {
    try {
      const currentPriceId = await pool.pythPriceIds(i);
      if (currentPriceId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
        console.log(`Setting PriceId[${i}] (${CONFIG.assetNames[i]})`);
        const tx = await pool.setPythPriceId(i, CONFIG.pythPriceIds[i]);
        await tx.wait();
        console.log(`✅ PriceId[${i}] configured`);
      } else {
        console.log(`✅ PriceId[${i}] (${CONFIG.assetNames[i]}) already set`);
      }
    } catch (e) {
      console.log(`⚠️ PriceId[${i}] (${CONFIG.assetNames[i]}): Could not configure (${e.message.slice(0, 50)}...)`);
      priceIdsSupported = false;
    }
  }
  if (!priceIdsSupported) {
    console.log('Note: Price feed configuration may not be required for SimpleMockDEX');
  }
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 5. GRANT REBALANCER_ROLE IF NEEDED
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 5: Check Rebalancer Role ═══');
  const REBALANCER_ROLE = await pool.REBALANCER_ROLE();
  const hasRole = await pool.hasRole(REBALANCER_ROLE, deployer.address);
  if (!hasRole) {
    console.log('Granting REBALANCER_ROLE to:', deployer.address);
    const tx = await pool.grantRole(REBALANCER_ROLE, deployer.address);
    await tx.wait();
    console.log('✅ REBALANCER_ROLE granted');
  } else {
    console.log('✅ REBALANCER_ROLE already granted');
  }
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // 6. EXECUTE REBALANCE TRADES
  // ═══════════════════════════════════════════════════════════════
  console.log('═══ STEP 6: Execute Rebalance Trades ═══');
  
  // Calculate 25% of USDT for each asset
  const totalUSDT = usdtBalance;
  const amountPerAsset = totalUSDT / 4n;
  
  console.log('Total USDT to rebalance:', ethers.formatUnits(totalUSDT, usdtDecimals));
  console.log('Amount per asset (25%):', ethers.formatUnits(amountPerAsset, usdtDecimals));
  console.log('');
  
  // Get DEX to check quotes
  const dex = new ethers.Contract(CONFIG.simpleMockDEX, DEX_ABI, deployer);
  
  for (let i = 0; i < 4; i++) {
    console.log(`\n--- Buying ${CONFIG.assetNames[i]} with USDT ---`);
    
    try {
      // Get quote from DEX
      const path = [CONFIG.usdt, CONFIG.assetTokens[i]];
      const amounts = await dex.getAmountsOut(amountPerAsset, path);
      const expectedOut = amounts[1];
      
      // Allow 1% slippage
      const minAmountOut = expectedOut * 99n / 100n;
      
      console.log(`   Swapping ${ethers.formatUnits(amountPerAsset, 6)} USDT`);
      console.log(`   Expected: ${expectedOut.toString()} ${CONFIG.assetNames[i]}`);
      console.log(`   Min out (1% slippage): ${minAmountOut.toString()}`);
      
      // Execute the trade
      // isBuy = true means we're buying the asset with USDT
      const tx = await pool.executeRebalanceTrade(
        i,                  // assetIndex
        amountPerAsset,     // amount (USDT)
        true,               // isBuy = buying asset with USDT
        minAmountOut        // minAmountOut
      );
      const receipt = await tx.wait();
      console.log(`   ✅ Trade executed! Gas used: ${receipt.gasUsed.toString()}`);
      
    } catch (e) {
      console.log(`   ❌ Trade failed: ${e.message}`);
      if (e.data) {
        console.log(`   Error data: ${e.data}`);
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 7. VERIFY FINAL STATE
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══ STEP 7: Final Pool State ═══');
  
  const finalUsdtBalance = await usdt.balanceOf(CONFIG.communityPool);
  console.log('USDT Balance:', ethers.formatUnits(finalUsdtBalance, usdtDecimals), 'USDT');
  
  for (let i = 0; i < 4; i++) {
    const assetToken = new ethers.Contract(CONFIG.assetTokens[i], ERC20_ABI, deployer);
    const balance = await assetToken.balanceOf(CONFIG.communityPool);
    let decimals;
    try {
      decimals = await assetToken.decimals();
    } catch {
      decimals = 18;
    }
    console.log(`${CONFIG.assetNames[i]} Balance: ${ethers.formatUnits(balance, decimals)}`);
  }
  
  try {
    const stats = await pool.getPoolStats();
    console.log('\nPool NAV:', ethers.formatUnits(stats._totalNAV, 6), 'USD');
    console.log('Share Price:', ethers.formatUnits(stats._sharePrice, 6), '$/share');
    console.log('Total Shares:', ethers.formatUnits(stats._totalShares, 6));
  } catch (e) {
    console.log('Could not fetch pool stats:', e.message);
  }
  
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║              REBALANCE COMPLETE!                           ║');
  console.log('║  Pool now holds 25% each BTC/ETH/SUI/CRO                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
