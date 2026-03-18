/**
 * Tether WDK On-Chain Test Script
 * 
 * Tests USDT/MockUSDT integration on both:
 * - Cronos Testnet (chainId: 338)
 * - Arbitrum Sepolia (chainId: 421614)
 * 
 * Run: node scripts/test-wdk-integration.js
 */

const { ethers } = require('ethers');

// Import addresses from wdk config (manual copy for Node.js script)
const USDT_ADDRESSES = {
  cronos: {
    mainnet: '0x66e428c3f67a68878562e79A0234c1F83c208770',
    testnet: '0x28217DAddC55e3C4831b4A48A00Ce04880786967', // MockUSDT
  },
  arbitrum: {
    mainnet: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    testnet: '0xA50E3d2C2110EBd08567A322e6e7B0Ca25341bF1', // MockUSDT on Arbitrum Sepolia
  },
};

const CHAIN_CONFIGS = {
  'cronos-testnet': {
    chainId: 338,
    name: 'Cronos Testnet',
    rpcUrl: 'https://evm-t3.cronos.org',
    usdtAddress: USDT_ADDRESSES.cronos.testnet,
    explorerUrl: 'https://explorer.cronos.org/testnet',
  },
  'arbitrum-sepolia': {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    usdtAddress: USDT_ADDRESSES.arbitrum.testnet,
    explorerUrl: 'https://sepolia.arbiscan.io',
  },
};

// ERC20 ABI for balance/decimals/symbol queries
const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)',
];

// Test wallet address (read-only queries)
const TEST_ADDRESS = process.env.TEST_WALLET || '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c';

async function testChain(chainName, config) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${config.name} (Chain ID: ${config.chainId})`);
  console.log(`${'='.repeat(60)}`);
  
  try {
    // Connect to RPC
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    
    // Verify chain ID
    const network = await provider.getNetwork();
    console.log(`✓ Connected to ${chainName}`);
    console.log(`  Chain ID: ${network.chainId}`);
    
    if (Number(network.chainId) !== config.chainId) {
      throw new Error(`Chain ID mismatch! Expected ${config.chainId}, got ${network.chainId}`);
    }
    
    // Test USDT/MockUSDT contract
    if (!config.usdtAddress) {
      console.log(`⚠ No USDT address configured for ${chainName}`);
      return { chain: chainName, success: false, error: 'No USDT address' };
    }
    
    console.log(`\n📍 USDT Address: ${config.usdtAddress}`);
    
    const token = new ethers.Contract(config.usdtAddress, ERC20_ABI, provider);
    
    // Query token info
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      token.name().catch(() => 'Unknown'),
      token.symbol().catch(() => 'USDT'),
      token.decimals().catch(() => 6),
      token.totalSupply().catch(() => BigInt(0)),
    ]);
    
    console.log(`\n📊 Token Info:`);
    console.log(`  Name: ${name}`);
    console.log(`  Symbol: ${symbol}`);
    console.log(`  Decimals: ${decimals}`);
    console.log(`  Total Supply: ${ethers.formatUnits(totalSupply, decimals)} ${symbol}`);
    
    // Query test wallet balance
    const balance = await token.balanceOf(TEST_ADDRESS);
    const formattedBalance = ethers.formatUnits(balance, decimals);
    
    console.log(`\n💰 Test Wallet Balance:`);
    console.log(`  Address: ${TEST_ADDRESS}`);
    console.log(`  Balance: ${formattedBalance} ${symbol}`);
    
    // Get native balance
    const nativeBalance = await provider.getBalance(TEST_ADDRESS);
    const nativeSymbol = chainName.includes('cronos') ? 'tCRO' : 'ETH';
    console.log(`  Native: ${ethers.formatEther(nativeBalance)} ${nativeSymbol}`);
    
    // Verify contract is accessible
    const code = await provider.getCode(config.usdtAddress);
    if (code === '0x' || code === '0x0') {
      console.log(`\n⚠ Warning: No contract at ${config.usdtAddress}`);
      return { chain: chainName, success: false, error: 'No contract at address' };
    }
    
    console.log(`\n✅ ${config.name} USDT Integration: PASSED`);
    console.log(`  Explorer: ${config.explorerUrl}/address/${config.usdtAddress}`);
    
    return {
      chain: chainName,
      success: true,
      tokenInfo: { name, symbol, decimals: Number(decimals) },
      balance: formattedBalance,
      totalSupply: ethers.formatUnits(totalSupply, decimals),
    };
    
  } catch (error) {
    console.error(`\n❌ ${config.name} Test Failed:`);
    console.error(`  Error: ${error.message}`);
    return { chain: chainName, success: false, error: error.message };
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║      Tether WDK On-Chain Integration Test                  ║');
  console.log('║      Testing USDT on Cronos Testnet & Arbitrum Sepolia     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nTest Wallet: ${TEST_ADDRESS}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  
  const results = [];
  
  // Test both chains
  for (const [chainName, config] of Object.entries(CHAIN_CONFIGS)) {
    const result = await testChain(chainName, config);
    results.push(result);
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  for (const r of results) {
    const status = r.success ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} | ${r.chain}`);
    if (r.tokenInfo) {
      console.log(`       Token: ${r.tokenInfo.symbol} (${r.tokenInfo.decimals} decimals)`);
      console.log(`       Balance: ${r.balance} ${r.tokenInfo.symbol}`);
    }
    if (r.error) {
      console.log(`       Error: ${r.error}`);
    }
  }
  
  console.log(`\nTotal: ${passed} passed, ${failed} failed`);
  
  return failed === 0 ? 0 : 1;
}

main()
  .then(exitCode => process.exit(exitCode))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
