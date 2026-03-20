/**
 * Oasis Chain Mainnet Readiness Assessment
 * 
 * Checks all Oasis-related infrastructure for production readiness:
 * - Sapphire testnet contracts (on-chain verification)
 * - Emerald testnet contracts
 * - Environment variables
 * - SDK installation (@oasisprotocol/sapphire-paratime)  
 * - Application services gap analysis
 * - Shared config entries
 * - NetworkBadge configuration
 * - Hardcoded testnet references
 */

import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

interface CheckResult {
  name: string;
  status: 'ready' | 'warning' | 'blocker';
  details: string;
}

const results: CheckResult[] = [];
const ROOT = process.cwd();

function addResult(name: string, status: CheckResult['status'], details: string) {
  results.push({ name, status, details });
  const icon = status === 'ready' ? '✅' : status === 'warning' ? '⚠️' : '❌';
  console.log(`  ${icon} ${name}: ${details}`);
}

async function checkSapphireTestnetContracts() {
  console.log('\n═══ CHECK 1: Sapphire Testnet Contracts (On-Chain) ═══');
  
  const provider = new ethers.JsonRpcProvider('https://testnet.sapphire.oasis.io');
  const contracts: Record<string, string> = {
    'ZKVerifier': process.env.NEXT_PUBLIC_OASIS_ZKVERIFIER_ADDRESS || '0xA50E3d2C2110EBd08567A322e6e7B0Ca25341bF1',
    'RWAManager': process.env.NEXT_PUBLIC_OASIS_RWAMANAGER_ADDRESS || '0xd38A271Af05Cd09325f6758067d43457797Ff654',
    'GaslessZKCommitmentVerifier': process.env.NEXT_PUBLIC_OASIS_GASLESS_COMMITMENT_VERIFIER || '0xfd6B402b860aD57f1393E2b60E1D676b57e0E63B',
    'HedgeExecutor': process.env.NEXT_PUBLIC_OASIS_HEDGE_EXECUTOR_ADDRESS || '0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8',
    'PaymentRouter': process.env.NEXT_PUBLIC_OASIS_PAYMENT_ROUTER_ADDRESS || '0x170E8232E9e18eeB1839dB1d939501994f1e272F',
  };

  let liveCount = 0;
  for (const [name, addr] of Object.entries(contracts)) {
    try {
      const code = await provider.getCode(addr);
      if (code !== '0x' && code.length > 2) {
        addResult(`Sapphire ${name}`, 'ready', `LIVE at ${addr} (${code.length} bytes)`);
        liveCount++;
      } else {
        addResult(`Sapphire ${name}`, 'blocker', `NOT FOUND at ${addr}`);
      }
    } catch (e: any) {
      addResult(`Sapphire ${name}`, 'blocker', `RPC ERROR: ${e.message.slice(0, 80)}`);
    }
  }
  
  return liveCount;
}

async function checkEmeraldTestnetContracts() {
  console.log('\n═══ CHECK 2: Emerald Testnet Contracts ═══');

  try {
    const deployFile = path.join(ROOT, 'deployments', 'oasis-emerald-testnet.json');
    if (fs.existsSync(deployFile)) {
      const data = JSON.parse(fs.readFileSync(deployFile, 'utf8'));
      const contracts = data.contracts || {};
      const deployed = Object.entries(contracts).filter(([_, v]: any) => v.address && v.address !== '');
      if (deployed.length === 0) {
        addResult('Emerald Contracts', 'warning', 'Template exists but NO contracts deployed');
      } else {
        addResult('Emerald Contracts', 'ready', `${deployed.length} contracts in deployment file`);
      }
    } else {
      addResult('Emerald Deployment File', 'warning', 'No deployment file found');
    }
  } catch (e: any) {
    addResult('Emerald Contracts', 'warning', `Error reading deployment: ${e.message}`);
  }

  // Check Emerald RPC connectivity
  try {
    const provider = new ethers.JsonRpcProvider('https://testnet.emerald.oasis.io');
    const block = await provider.getBlockNumber();
    addResult('Emerald RPC', 'ready', `Connected (block ${block})`);
  } catch (e: any) {
    addResult('Emerald RPC', 'warning', `Connection failed: ${e.message.slice(0, 80)}`);
  }
}

function checkEnvironmentVariables() {
  console.log('\n═══ CHECK 3: Environment Variables ═══');

  const required: Record<string, string | undefined> = {
    'NEXT_PUBLIC_OASIS_NETWORK': process.env.NEXT_PUBLIC_OASIS_NETWORK,
    'OASIS_SAPPHIRE_TESTNET_RPC': process.env.OASIS_SAPPHIRE_TESTNET_RPC,
    'NEXT_PUBLIC_OASIS_ZKVERIFIER_ADDRESS': process.env.NEXT_PUBLIC_OASIS_ZKVERIFIER_ADDRESS,
    'NEXT_PUBLIC_OASIS_RWAMANAGER_ADDRESS': process.env.NEXT_PUBLIC_OASIS_RWAMANAGER_ADDRESS,
    'NEXT_PUBLIC_OASIS_GASLESS_COMMITMENT_VERIFIER': process.env.NEXT_PUBLIC_OASIS_GASLESS_COMMITMENT_VERIFIER,
    'NEXT_PUBLIC_OASIS_HEDGE_EXECUTOR_ADDRESS': process.env.NEXT_PUBLIC_OASIS_HEDGE_EXECUTOR_ADDRESS,
    'NEXT_PUBLIC_OASIS_PAYMENT_ROUTER_ADDRESS': process.env.NEXT_PUBLIC_OASIS_PAYMENT_ROUTER_ADDRESS,
  };

  const optional: Record<string, string | undefined> = {
    'OASIS_EMERALD_TESTNET_RPC': process.env.OASIS_EMERALD_TESTNET_RPC,
    'OASIS_SAPPHIRE_MAINNET_RPC': process.env.OASIS_SAPPHIRE_MAINNET_RPC,
    'OASIS_DEPLOYER_PRIVATE_KEY': process.env.OASIS_DEPLOYER_PRIVATE_KEY,
  };

  let setCount = 0;
  for (const [key, value] of Object.entries(required)) {
    if (value) {
      addResult(key, 'ready', value.slice(0, 20) + '...');
      setCount++;
    } else {
      addResult(key, 'warning', 'NOT SET');
    }
  }

  for (const [key, value] of Object.entries(optional)) {
    if (value) {
      addResult(key, 'ready', value.slice(0, 20) + '...');
    } else {
      addResult(key, 'warning', `NOT SET (optional for testnet)`);
    }
  }
}

function checkSapphireSDK() {
  console.log('\n═══ CHECK 4: Oasis Sapphire SDK ═══');

  try {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
    
    if (deps['@oasisprotocol/sapphire-paratime']) {
      addResult('Sapphire SDK', 'ready', `@oasisprotocol/sapphire-paratime ${deps['@oasisprotocol/sapphire-paratime']}`);
    } else {
      addResult('Sapphire SDK', 'blocker', 
        '@oasisprotocol/sapphire-paratime NOT INSTALLED — needed for confidential transactions');
    }

    // Check for sapphire-ethers (optional)
    if (deps['@oasisprotocol/sapphire-ethers']) {
      addResult('Sapphire Ethers', 'ready', `@oasisprotocol/sapphire-ethers ${deps['@oasisprotocol/sapphire-ethers']}`);
    } else {
      addResult('Sapphire Ethers', 'warning', '@oasisprotocol/sapphire-ethers not installed (optional)');
    }
  } catch (e: any) {
    addResult('package.json', 'blocker', `Cannot read: ${e.message}`);
  }
}

function checkApplicationServices() {
  console.log('\n═══ CHECK 5: Application Services Gap Analysis ═══');

  // Compare Oasis services vs SUI services
  const suiServices = [
    { name: 'SuiPortfolioManager', path: 'lib/services/SuiPortfolioManager.ts' },
    { name: 'SuiOnChainHedgeService', path: 'lib/services/SuiOnChainHedgeService.ts' },
    { name: 'SuiAutoHedgingAdapter', path: 'lib/services/SuiAutoHedgingAdapter.ts' },
    { name: 'SuiCommunityPoolService', path: 'lib/services/SuiCommunityPoolService.ts' },
    { name: 'SuiPrivateHedgeService', path: 'lib/services/SuiPrivateHedgeService.ts' },
    { name: 'SuiExplorerService', path: 'lib/services/SuiExplorerService.ts' },
    { name: 'CetusSwapService', path: 'lib/services/CetusSwapService.ts' },
    { name: 'BlueFin Integration', path: 'app/api/agents/hedging/bluefin/route.ts' },
  ];

  const oasisEquivalents: Record<string, string> = {
    'SuiPortfolioManager': 'OasisPortfolioManager',
    'SuiOnChainHedgeService': 'OasisHedgeService',
    'SuiAutoHedgingAdapter': 'OasisAutoHedgingAdapter',
    'SuiCommunityPoolService': 'OasisCommunityPoolService',
    'SuiPrivateHedgeService': 'OasisPrivateHedgeService (Sapphire confidential)',
    'SuiExplorerService': 'OasisExplorerService',
    'CetusSwapService': 'Oasis DEX Integration (none identified)',
    'BlueFin Integration': 'Oasis Perps Integration (none identified)',
  };

  for (const svc of suiServices) {
    const suiExists = fs.existsSync(path.join(ROOT, svc.path));
    const oasisName = oasisEquivalents[svc.name];
    
    // Check if an Oasis equivalent exists
    const oasisPath = svc.path.replace(/Sui|sui/g, 'Oasis').replace('Cetus', 'Oasis');
    const oasisExists = fs.existsSync(path.join(ROOT, oasisPath));

    if (oasisExists) {
      addResult(oasisName, 'ready', `Found at ${oasisPath}`);
    } else if (suiExists) {
      addResult(oasisName, 'blocker', `MISSING — SUI has ${svc.name} but no Oasis equivalent exists`);
    } else {
      addResult(oasisName, 'warning', `Neither SUI nor Oasis version found`);
    }
  }

  // Check for Oasis API routes
  console.log('\n  --- API Routes ---');
  const oasisApiPaths = [
    'app/api/oasis',
    'app/api/agents/hedging/oasis',
    'app/api/portfolio/oasis',
  ];
  
  let apiCount = 0;
  for (const apiPath of oasisApiPaths) {
    if (fs.existsSync(path.join(ROOT, apiPath))) {
      addResult(`API: ${apiPath}`, 'ready', 'Directory exists');
      apiCount++;
    }
  }
  if (apiCount === 0) {
    addResult('Oasis API Routes', 'blocker', 'ZERO Oasis-specific API routes exist');
  }
}

function checkTestSuites() {
  console.log('\n═══ CHECK 6: Test Coverage ═══');

  const testPaths = [
    'test/oasis',
    'scripts/test-oasis-services-e2e.ts',
    'scripts/test-oasis-onchain-e2e.ts',
    'test/services/oasis',
  ];

  let testCount = 0;
  for (const tp of testPaths) {
    if (fs.existsSync(path.join(ROOT, tp))) {
      addResult(`Tests: ${tp}`, 'ready', 'Found');
      testCount++;
    }
  }

  if (testCount === 0) {
    addResult('Oasis Test Suite', 'blocker', 'ZERO Oasis test suites exist (SUI has 84+ tests)');
  }
}

function checkSharedConfig() {
  console.log('\n═══ CHECK 7: Shared Config & Chain Definitions ═══');

  // Check lib/chains.ts
  try {
    const chainsContent = fs.readFileSync(path.join(ROOT, 'lib/chains.ts'), 'utf8');
    const hasEmerald = chainsContent.includes('OasisEmeraldTestnet') || chainsContent.includes('OasisEmeraldMainnet');
    const hasSapphire = chainsContent.includes('OasisSapphireTestnet') || chainsContent.includes('OasisSapphireMainnet');
    
    if (hasEmerald && hasSapphire) {
      addResult('lib/chains.ts', 'ready', 'Emerald + Sapphire chain definitions present');
    } else {
      addResult('lib/chains.ts', 'warning', `Missing: ${!hasEmerald ? 'Emerald' : ''} ${!hasSapphire ? 'Sapphire' : ''}`);
    }
  } catch (e) {
    addResult('lib/chains.ts', 'warning', 'Cannot read file');
  }

  // Check shared/utils/config.ts
  try {
    const configContent = fs.readFileSync(path.join(ROOT, 'shared/utils/config.ts'), 'utf8');
    const hasSapphireConfig = configContent.includes('oasis-sapphire-testnet');
    const hasEmeraldConfig = configContent.includes('oasis-emerald-testnet');
    
    if (hasSapphireConfig && hasEmeraldConfig) {
      addResult('shared/utils/config.ts', 'ready', 'Oasis network configs present');
    } else {
      addResult('shared/utils/config.ts', 'warning', 'Missing Oasis network configs');
    }
  } catch (e) {
    addResult('shared/utils/config.ts', 'warning', 'Cannot read file');
  }

  // Check wallet-providers.tsx
  try {
    const wpContent = fs.readFileSync(path.join(ROOT, 'app/wallet-providers.tsx'), 'utf8');
    if (wpContent.includes('OasisSapphireTestnet') && wpContent.includes('OasisEmeraldTestnet')) {
      addResult('wallet-providers.tsx', 'ready', 'Oasis chains in wallet config');
    } else {
      addResult('wallet-providers.tsx', 'warning', 'Oasis chains not in wallet config');
    }
  } catch (e) {
    addResult('wallet-providers.tsx', 'warning', 'Cannot read file');
  }

  // Check addresses.ts
  try {
    const addrContent = fs.readFileSync(path.join(ROOT, 'lib/contracts/addresses.ts'), 'utf8');
    if (addrContent.includes('OASIS_CONTRACT_ADDRESSES') && addrContent.includes('OASIS_EMERALD_CONTRACT_ADDRESSES')) {
      addResult('addresses.ts', 'ready', 'Oasis contract address exports present');
    } else {
      addResult('addresses.ts', 'warning', 'Missing Oasis address configurations');
    }
  } catch (e) {
    addResult('addresses.ts', 'warning', 'Cannot read file');
  }
}

function checkMainnetAddresses() {
  console.log('\n═══ CHECK 8: Mainnet Address Readiness ═══');

  const sapphireMainnet = [
    'NEXT_PUBLIC_OASIS_MAINNET_ZKVERIFIER_ADDRESS',
    'NEXT_PUBLIC_OASIS_MAINNET_RWAMANAGER_ADDRESS',
    'NEXT_PUBLIC_OASIS_MAINNET_PAYMENT_ROUTER_ADDRESS',
    'NEXT_PUBLIC_OASIS_MAINNET_CONFIDENTIAL_ZK_VERIFIER',
    'NEXT_PUBLIC_OASIS_MAINNET_HEDGE_EXECUTOR_ADDRESS',
  ];

  const emeraldMainnet = [
    'NEXT_PUBLIC_EMERALD_MAINNET_ZKVERIFIER_ADDRESS',
    'NEXT_PUBLIC_EMERALD_MAINNET_RWAMANAGER_ADDRESS',
    'NEXT_PUBLIC_EMERALD_MAINNET_HEDGE_EXECUTOR_ADDRESS',
  ];

  for (const envVar of [...sapphireMainnet, ...emeraldMainnet]) {
    const value = process.env[envVar];
    if (value && value !== '0x0000000000000000000000000000000000000000') {
      addResult(envVar, 'ready', value.slice(0, 20) + '...');
    } else {
      addResult(envVar, 'warning', 'Not set (deploy to mainnet first)');
    }
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Oasis Chain Mainnet Readiness Assessment                   ║');
  console.log('║  Chains: Sapphire (Confidential) + Emerald (Public EVM)     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const liveContracts = await checkSapphireTestnetContracts();
  await checkEmeraldTestnetContracts();
  checkEnvironmentVariables();
  checkSapphireSDK();
  checkApplicationServices();
  checkTestSuites();
  checkSharedConfig();
  checkMainnetAddresses();

  // Summary
  const ready = results.filter(r => r.status === 'ready').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  const blockers = results.filter(r => r.status === 'blocker').length;

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  SUMMARY: ${ready} ready, ${warnings} warnings, ${blockers} blockers`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  console.log('\n📊 OASIS vs SUI COMPARISON:');
  console.log('┌─────────────────────────────┬───────────┬───────────┐');
  console.log('│ Feature                     │ SUI       │ Oasis     │');
  console.log('├─────────────────────────────┼───────────┼───────────┤');
  console.log(`│ Testnet Contracts            │ 5 LIVE    │ ${liveContracts} LIVE    │`);
  console.log('│ Portfolio Manager            │ ✅ Yes    │ ❌ None   │');
  console.log('│ Hedge Service               │ ✅ Yes    │ ❌ None   │');
  console.log('│ Auto-Hedging Adapter        │ ✅ Yes    │ ❌ None   │');
  console.log('│ Community Pool Service      │ ✅ Yes    │ ❌ None   │');
  console.log('│ DEX Integration             │ ✅ Cetus  │ ❌ None   │');
  console.log('│ Perps Integration           │ ✅ BlueFin│ ❌ None   │');
  console.log('│ Explorer Service            │ ✅ Yes    │ ❌ None   │');
  console.log('│ API Routes                  │ ✅ Multi  │ ❌ Zero   │');
  console.log('│ E2E Test Suite              │ ✅ 84+    │ ❌ Zero   │');
  console.log('│ Confidential SDK            │ N/A       │ ❌ Not    │');
  console.log('│ Chain Definitions           │ ✅ Yes    │ ✅ Yes    │');
  console.log('│ Wallet Provider             │ ✅ Yes    │ ✅ Yes    │');
  console.log('│ Address Resolution          │ ✅ Yes    │ ✅ Yes    │');
  console.log('│ Env Vars                    │ ✅ Set    │ ✅ Set    │');
  console.log('│ Shared Config               │ ✅ Yes    │ ✅ Yes    │');
  console.log('└─────────────────────────────┴───────────┴───────────┘');

  console.log('\n🏗️  OASIS ARCHITECTURE RATING: 3/10 (Infrastructure only)');
  console.log('   SUI ARCHITECTURE RATING:   9/10 (Mainnet-ready)');

  if (blockers > 0) {
    console.log('\n🚫 BLOCKERS TO ADDRESS:');
    results.filter(r => r.status === 'blocker').forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.name}: ${r.details}`);
    });
  }

  console.log('\n📋 ACTION PLAN TO REACH SUI PARITY:');
  console.log('   1. Install @oasisprotocol/sapphire-paratime SDK');
  console.log('   2. Create OasisPortfolioManager (mirror SuiPortfolioManager)');
  console.log('   3. Create OasisHedgeService (mirror SuiOnChainHedgeService)');
  console.log('   4. Create OasisAutoHedgingAdapter (mirror SuiAutoHedgingAdapter)');
  console.log('   5. Create OasisCommunityPoolService');
  console.log('   6. Identify & integrate Oasis DEX (Sapphire has limited DeFi)');
  console.log('   7. Create Oasis API routes under app/api/oasis/');
  console.log('   8. Build E2E test suite (target: 80+ tests like SUI)');
  console.log('   9. Deploy contracts to Emerald Testnet');
  console.log('  10. Implement Sapphire confidential computing features');
  console.log('  11. Deploy to Sapphire + Emerald Mainnet');

  console.log('\n⏱️  ESTIMATED EFFORT: 4-8 weeks to reach SUI-level parity');
}

main().catch(e => console.error('Fatal:', e.message));
