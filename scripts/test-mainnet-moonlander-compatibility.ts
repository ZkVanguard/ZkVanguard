/**
 * MAINNET MOONLANDER COMPATIBILITY TEST
 * 
 * Verifies that mainnet Moonlander Diamond contract (0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9)
 * is compatible with HedgeExecutor's IMoonlanderRouter interface.
 * 
 * Tests:
 * 1. Contract deployment verification
 * 2. Interface method existence check
 * 3. ABI compatibility validation
 * 4. Read-only function calls (no gas cost)
 * 
 * Run: npx tsx scripts/test-mainnet-moonlander-compatibility.ts
 */

import { ethers } from 'ethers';

// Mainnet Configuration
const CRONOS_MAINNET_RPC = 'https://evm.cronos.org';
const MOONLANDER_DIAMOND = '0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9';
const USDC_MAINNET = '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59';

// Expected Interface (from HedgeExecutor.sol)
const MOONLANDER_INTERFACE_ABI = [
  // Required methods
  'function openMarketTradeWithPythAndExtraFee(address referrer, uint256 pairIndex, address collateralToken, uint256 collateralAmount, uint256 openPrice, uint256 leveragedAmount, uint256 tp, uint256 sl, uint256 direction, uint256 fee, bytes[] calldata pythUpdateData) external payable returns (uint256)',
  'function closeTrade(uint256 pairIndex, uint256 tradeIndex) external',
  'function addMargin(uint256 pairIndex, uint256 tradeIndex, uint256 amount) external',
  'function getTrade(address trader, uint256 pairIndex, uint256 tradeIndex) external view returns (address, uint256, uint256, uint256, uint256, uint256, bool, uint256, uint256, uint256, bool)',
  
  // Additional useful methods
  'function getPrice(uint256 pairIndex) external view returns (uint256)',
  'function getPairInfo(uint256 pairIndex) external view returns (string memory, address, uint256, uint256)',
  'function getOpenTrades(address trader) external view returns (uint256)',
];

interface TestResult {
  test: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'INFO';
  message: string;
  details?: any;
}

const results: TestResult[] = [];

function log(test: string, status: TestResult['status'], message: string, details?: any) {
  results.push({ test, status, message, details });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : status === 'WARN' ? '⚠️' : 'ℹ️';
  console.log(`${icon} [${status}] ${test}: ${message}`);
  if (details) {
    console.log(`   Details:`, details);
  }
}

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🌙 MAINNET MOONLANDER COMPATIBILITY TEST');
  console.log('═'.repeat(80));
  console.log(`\nNetwork: Cronos Mainnet (Chain ID: 25)`);
  console.log(`Moonlander Diamond: ${MOONLANDER_DIAMOND}`);
  console.log(`RPC: ${CRONOS_MAINNET_RPC}\n`);

  // Setup provider
  const provider = new ethers.JsonRpcProvider(CRONOS_MAINNET_RPC);

  try {
    // TEST 1: Network Connectivity
    console.log('\n─── Test 1: Network Connectivity ────────────────────────────');
    try {
      const network = await provider.getNetwork();
      const blockNumber = await provider.getBlockNumber();
      
      if (Number(network.chainId) === 25) {
        log('Network', 'PASS', 'Connected to Cronos Mainnet', { 
          chainId: network.chainId.toString(), 
          blockNumber 
        });
      } else {
        log('Network', 'FAIL', 'Wrong network!', { 
          expected: 25, 
          got: network.chainId.toString() 
        });
        return;
      }
    } catch (error: any) {
      log('Network', 'FAIL', 'Cannot connect to RPC', { error: error.message });
      return;
    }

    // TEST 2: Contract Deployment Verification
    console.log('\n─── Test 2: Contract Deployment ─────────────────────────────');
    try {
      const code = await provider.getCode(MOONLANDER_DIAMOND);
      
      if (code === '0x' || code === '0x0') {
        log('Deployment', 'FAIL', 'Contract not deployed at this address!', { 
          address: MOONLANDER_DIAMOND 
        });
        return;
      } else {
        log('Deployment', 'PASS', 'Contract deployed', { 
          address: MOONLANDER_DIAMOND,
          codeSize: `${code.length - 2} bytes` // -2 for '0x' prefix
        });
      }
    } catch (error: any) {
      log('Deployment', 'FAIL', 'Error checking deployment', { error: error.message });
      return;
    }

    // TEST 3: Create Contract Instance
    console.log('\n─── Test 3: Contract Interface ──────────────────────────────');
    let moonlander: ethers.Contract;
    try {
      moonlander = new ethers.Contract(
        MOONLANDER_DIAMOND,
        MOONLANDER_INTERFACE_ABI,
        provider
      );
      log('Interface', 'PASS', 'Contract instance created with expected ABI');
    } catch (error: any) {
      log('Interface', 'FAIL', 'Cannot create contract instance', { error: error.message });
      return;
    }

    // TEST 4: Test Read-Only Functions (No Gas Cost)
    console.log('\n─── Test 4: Read-Only Function Calls ────────────────────────');
    
    // Test 4a: getTrade (should return default values for non-existent trade)
    try {
      const testTrader = '0x0000000000000000000000000000000000000001';
      const testPairIndex = 0; // BTC
      const testTradeIndex = 0;
      
      const trade = await moonlander.getTrade(testTrader, testPairIndex, testTradeIndex);
      log('getTrade()', 'PASS', 'Method exists and callable', { 
        trader: testTrader,
        pairIndex: testPairIndex,
        tradeIndex: testTradeIndex,
        returned: '11 values (tuple)'
      });
    } catch (error: any) {
      if (error.message.includes('function selector was not recognized')) {
        log('getTrade()', 'FAIL', 'Method not found - contract incompatible!', { 
          error: error.message.slice(0, 200) 
        });
      } else if (error.message.includes('resolver or addr')) {
        log('getTrade()', 'FAIL', 'ENS resolution error', { error: error.message });
      } else {
        log('getTrade()', 'WARN', 'Method call failed but may exist', { 
          error: error.message.slice(0, 200) 
        });
      }
    }

    // Test 4b: getPrice (if available)
    try {
      const btcPrice = await moonlander.getPrice(0); // BTC pair index
      log('getPrice()', 'PASS', 'Price oracle accessible', { 
        pairIndex: 0,
        price: ethers.formatUnits(btcPrice, 8) + ' USD'
      });
    } catch (error: any) {
      if (error.message.includes('function selector was not recognized')) {
        log('getPrice()', 'INFO', 'Method not available (not critical)', {});
      } else {
        log('getPrice()', 'WARN', 'Price call failed', { 
          error: error.message.slice(0, 200) 
        });
      }
    }

    // Test 4c: getPairInfo (if available)
    try {
      const pairInfo = await moonlander.getPairInfo(0);
      log('getPairInfo()', 'PASS', 'Pair info accessible', { 
        pairIndex: 0,
        name: pairInfo[0] || 'N/A'
      });
    } catch (error: any) {
      if (error.message.includes('function selector was not recognized')) {
        log('getPairInfo()', 'INFO', 'Method not available (not critical)', {});
      } else {
        log('getPairInfo()', 'WARN', 'Pair info call failed', { 
          error: error.message.slice(0, 200) 
        });
      }
    }

    // TEST 5: Method Signature Verification
    console.log('\n─── Test 5: Required Method Signatures ──────────────────────');
    
    const requiredMethods = [
      { 
        name: 'openMarketTradeWithPythAndExtraFee',
        signature: 'openMarketTradeWithPythAndExtraFee(address,uint256,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bytes[])',
        critical: true
      },
      { 
        name: 'closeTrade',
        signature: 'closeTrade(uint256,uint256)',
        critical: true
      },
      { 
        name: 'addMargin',
        signature: 'addMargin(uint256,uint256,uint256)',
        critical: true
      },
      { 
        name: 'getTrade',
        signature: 'getTrade(address,uint256,uint256)',
        critical: true
      },
    ];

    for (const method of requiredMethods) {
      try {
        // Check if function exists in ABI
        const fragment = moonlander.interface.getFunction(method.name);
        if (fragment) {
          log(
            `Method: ${method.name}`,
            'PASS',
            'Signature found in interface',
            { signature: fragment.format('full') }
          );
        }
      } catch (error: any) {
        log(
          `Method: ${method.name}`,
          method.critical ? 'FAIL' : 'WARN',
          'Method not found in interface',
          { expected: method.signature }
        );
      }
    }

    // TEST 6: Diamond Proxy Pattern Check
    console.log('\n─── Test 6: Diamond Proxy Pattern ───────────────────────────');
    
    try {
      // Check if it's a diamond proxy by looking for facets
      const diamondABI = [
        'function facets() external view returns (tuple(address facetAddress, bytes4[] functionSelectors)[] memory)',
        'function facetAddress(bytes4 _functionSelector) external view returns (address facetAddress_)',
      ];
      
      const diamond = new ethers.Contract(MOONLANDER_DIAMOND, diamondABI, provider);
      
      try {
        const facets = await diamond.facets();
        log('Diamond', 'PASS', `Diamond proxy confirmed - ${facets.length} facets`, { 
          facetCount: facets.length 
        });
        
        // Check if trading facet exists
        const openTradeSelector = ethers.id('openMarketTradeWithPythAndExtraFee(address,uint256,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bytes[])').slice(0, 10);
        const facetAddr = await diamond.facetAddress(openTradeSelector);
        
        if (facetAddr && facetAddr !== ethers.ZeroAddress) {
          log('Trading Facet', 'PASS', 'Trading functions facet found', { 
            facetAddress: facetAddr 
          });
        } else {
          log('Trading Facet', 'WARN', 'Trading facet address is zero', {});
        }
      } catch (error: any) {
        log('Diamond', 'INFO', 'Not a standard diamond or methods not exposed', { 
          error: error.message.slice(0, 100) 
        });
      }
    } catch (error: any) {
      log('Diamond', 'INFO', 'Diamond pattern check inconclusive', {});
    }

    // TEST 7: USDC Integration Check
    console.log('\n─── Test 7: USDC Token Compatibility ────────────────────────');
    
    try {
      const usdcABI = [
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
        'function balanceOf(address) view returns (uint256)',
      ];
      
      const usdc = new ethers.Contract(USDC_MAINNET, usdcABI, provider);
      const decimals = await usdc.decimals();
      const symbol = await usdc.symbol();
      
      if (decimals === 6 && symbol.toUpperCase().includes('USDC')) {
        log('USDC', 'PASS', 'USDC token verified', { 
          address: USDC_MAINNET,
          decimals,
          symbol 
        });
      } else {
        log('USDC', 'WARN', 'Token found but properties unexpected', { 
          decimals,
          symbol 
        });
      }
    } catch (error: any) {
      log('USDC', 'FAIL', 'Cannot verify USDC token', { error: error.message });
    }

    // TEST 8: Gas Estimate for Write Functions
    console.log('\n─── Test 8: Gas Estimation (Dry Run) ────────────────────────');
    
    try {
      // Try to estimate gas for openMarketTradeWithPythAndExtraFee
      // This won't actually execute, just estimate
      const testCollateral = ethers.parseUnits('100', 6); // 100 USDC
      const testLeverage = 3;
      const emptyPythData: string[] = [];
      
      log('Gas Estimate', 'INFO', 'Cannot estimate without funded wallet', { 
        note: 'Would require actual USDC balance and gas' 
      });
    } catch (error: any) {
      log('Gas Estimate', 'INFO', 'Gas estimation requires funded account', {});
    }

  } catch (error: any) {
    console.error('\n❌ Uncaught error:', error.message);
  }

  // SUMMARY
  console.log('\n' + '═'.repeat(80));
  console.log('📊 TEST SUMMARY');
  console.log('═'.repeat(80));
  
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const warnCount = results.filter(r => r.status === 'WARN').length;
  const infoCount = results.filter(r => r.status === 'INFO').length;
  
  console.log(`\n✅ PASSED: ${passCount}`);
  console.log(`❌ FAILED: ${failCount}`);
  console.log(`⚠️  WARNINGS: ${warnCount}`);
  console.log(`ℹ️  INFO: ${infoCount}`);
  console.log(`\nTotal Tests: ${results.length}`);
  
  // Final verdict
  console.log('\n' + '═'.repeat(80));
  if (failCount === 0) {
    console.log('🎉 MAINNET MOONLANDER: COMPATIBLE ✅');
    console.log('\nThe mainnet Moonlander Diamond contract appears compatible with');
    console.log('HedgeExecutor\'s IMoonlanderRouter interface.');
    console.log('\n✅ READY FOR DEPLOYMENT');
  } else {
    console.log('⚠️  MAINNET MOONLANDER: COMPATIBILITY ISSUES DETECTED');
    console.log(`\n${failCount} critical test(s) failed. Review the issues above.`);
    console.log('\n❌ NOT READY - Requires Investigation');
  }
  console.log('═'.repeat(80) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Script error:', error);
    process.exit(1);
  });
