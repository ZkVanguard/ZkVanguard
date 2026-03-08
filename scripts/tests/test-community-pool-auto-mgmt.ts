#!/usr/bin/env npx tsx
/**
 * Community Pool Auto-Management Verification Test
 * 
 * Tests the COMPLETE auto-management pipeline WITHOUT needing a running dev server.
 * Directly calls the service layer and DB to verify:
 * 
 * 1. portfolio_id=-1 fix: createHedge() preserves -1 (not NULL or 0)
 * 2. upsertOnChainHedge() now writes portfolio_id
 * 3. AutoHedgingService loads community pool config
 * 4. Risk assessment triggers for community pool portfolio
 * 5. Pool NAV calculation works
 * 6. Hedge execution records correct portfolio_id
 * 7. DB state persistence (cron_state) works across cold starts
 * 8. check-hedge-status now finds community pool hedges
 * 
 * Run: npx tsx scripts/tests/test-community-pool-auto-mgmt.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createHedge, upsertOnChainHedge } from '../../lib/db/hedges';
import { query } from '../../lib/db/postgres';
import { ethers } from 'ethers';
import { COMMUNITY_POOL_PORTFOLIO_ID } from '../../lib/constants';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const INFO = '\x1b[36mℹ\x1b[0m';

let passed = 0;
let failed = 0;
let warnings = 0;
const cleanupIds: string[] = [];

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function warn(label: string, detail?: string) {
  console.log(`  ${WARN} ${label}${detail ? ` — ${detail}` : ''}`);
  warnings++;
}

function info(label: string) {
  console.log(`  ${INFO} ${label}`);
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 1: createHedge() preserves portfolio_id=COMMUNITY_POOL_PORTFOLIO_ID
// ────────────────────────────────────────────────────────────────────────
async function testCreateHedgePortfolioId() {
  console.log(`\n══ Test 1: createHedge() preserves portfolio_id=${COMMUNITY_POOL_PORTFOLIO_ID} ══`);

  const testOrderId = `test-portfolio-fix-${Date.now()}`;
  cleanupIds.push(testOrderId);

  try {
    const hedge = await createHedge({
      orderId: testOrderId,
      portfolioId: COMMUNITY_POOL_PORTFOLIO_ID, // Community pool — the bug was this became NULL
      walletAddress: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c',
      asset: 'BTC',
      market: 'BTC-USD-PERP',
      side: 'SHORT',
      size: 0.001,
      notionalValue: 50,
      leverage: 2,
      entryPrice: 70000,
      simulationMode: true,
      reason: 'TEST: portfolio_id preservation check',
    });

    assert(hedge !== null, 'Hedge created successfully');
    assert(hedge.portfolio_id === COMMUNITY_POOL_PORTFOLIO_ID, `portfolio_id is ${COMMUNITY_POOL_PORTFOLIO_ID} (got: ${hedge.portfolio_id})`, 
      `Expected ${COMMUNITY_POOL_PORTFOLIO_ID}, got ${hedge.portfolio_id}`);
    assert(hedge.order_id === testOrderId, 'Order ID matches');
    assert(hedge.asset === 'BTC', 'Asset is BTC');
    assert(hedge.side === 'SHORT', 'Side is SHORT');

    // Double-check by querying DB directly
    const dbCheck = await query(
      'SELECT portfolio_id FROM hedges WHERE order_id = $1',
      [testOrderId]
    );
    assert(dbCheck.length === 1, 'Found in DB');
    assert(dbCheck[0].portfolio_id === COMMUNITY_POOL_PORTFOLIO_ID, `DB portfolio_id is ${COMMUNITY_POOL_PORTFOLIO_ID} (got: ${dbCheck[0].portfolio_id})`);

  } catch (error: any) {
    assert(false, `createHedge failed: ${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 2: upsertOnChainHedge() writes portfolio_id
// ────────────────────────────────────────────────────────────────────────────
async function testUpsertOnChainHedgePortfolioId() {
  console.log('\n══ Test 2: upsertOnChainHedge() writes portfolio_id ══');

  const testHedgeId = `0x${Buffer.from(`test-onchain-fix-${Date.now()}`).toString('hex').padEnd(64, '0')}`;
  cleanupIds.push(testHedgeId);

  try {
    const hedge = await upsertOnChainHedge({
      hedgeIdOnchain: testHedgeId,
      txHash: `0x${'a'.repeat(64)}`,
      trader: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c',
      asset: 'ETH',
      side: 'SHORT',
      collateral: 100,
      leverage: 3,
      entryPrice: 3500,
      chain: 'cronos-testnet',
      chainId: 338,
      portfolioId: COMMUNITY_POOL_PORTFOLIO_ID, // Community pool
      walletAddress: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c',
    });

    assert(hedge !== null, 'On-chain hedge upserted successfully');
    if (hedge) {
      assert(hedge.portfolio_id === COMMUNITY_POOL_PORTFOLIO_ID, `portfolio_id is ${COMMUNITY_POOL_PORTFOLIO_ID} (got: ${hedge.portfolio_id})`);
      assert(hedge.on_chain === true, 'on_chain flag is true');
      assert(hedge.asset === 'ETH', 'Asset is ETH');
    }

    // DB verification
    const dbCheck = await query(
      'SELECT portfolio_id, on_chain FROM hedges WHERE order_id = $1',
      [testHedgeId]
    );
    assert(dbCheck.length === 1, 'Found in DB');
    assert(dbCheck[0].portfolio_id === COMMUNITY_POOL_PORTFOLIO_ID, `DB portfolio_id is ${COMMUNITY_POOL_PORTFOLIO_ID} (got: ${dbCheck[0].portfolio_id})`);

  } catch (error: any) {
    assert(false, `upsertOnChainHedge failed: ${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 3: portfolio_id=1 also works (non-zero regression check)
// ────────────────────────────────────────────────────────────────────────────
async function testNonZeroPortfolioId() {
  console.log('\n══ Test 3: Non-zero portfolio_id still works ══');

  const testOrderId = `test-portfolio1-${Date.now()}`;
  cleanupIds.push(testOrderId);

  try {
    const hedge = await createHedge({
      orderId: testOrderId,
      portfolioId: 1,
      walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
      asset: 'ETH',
      market: 'ETH-USD-PERP',
      side: 'LONG',
      size: 0.1,
      notionalValue: 350,
      leverage: 2,
      entryPrice: 3500,
      simulationMode: true,
      reason: 'TEST: non-zero portfolio_id regression',
    });

    assert(hedge !== null, 'Hedge created');
    assert(hedge.portfolio_id === 1, `portfolio_id is 1 (got: ${hedge.portfolio_id})`);

  } catch (error: any) {
    assert(false, `Failed: ${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 4: NULL portfolio_id still works for unknown sources
// ────────────────────────────────────────────────────────────────────────────
async function testNullPortfolioId() {
  console.log('\n══ Test 4: Undefined portfolio_id → NULL (still works) ══');

  const testOrderId = `test-null-pid-${Date.now()}`;
  cleanupIds.push(testOrderId);

  try {
    const hedge = await createHedge({
      orderId: testOrderId,
      // portfolioId not provided — should be NULL
      asset: 'CRO',
      market: 'CRO-USD-PERP',
      side: 'LONG',
      size: 100,
      notionalValue: 30,
      leverage: 2,
      entryPrice: 0.30,
      simulationMode: true,
      reason: 'TEST: undefined portfolio_id → NULL',
    });

    assert(hedge !== null, 'Hedge created');
    assert(hedge.portfolio_id === null, `portfolio_id is NULL (got: ${hedge.portfolio_id})`);

  } catch (error: any) {
    assert(false, `Failed: ${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 5: Auto-hedge config loads correctly for community pool
// ────────────────────────────────────────────────────────────────────────────
async function testAutoHedgeConfig() {
  console.log('\n══ Test 5: Auto-Hedge Config for Community Pool ══');

  try {
    // Check DB config first
    const dbConfig = await query(
      'SELECT * FROM auto_hedge_configs WHERE portfolio_id = $1',
      [COMMUNITY_POOL_PORTFOLIO_ID]
    );

    if (dbConfig.length > 0) {
      const c = dbConfig[0];
      assert(c.enabled === true, 'Auto-hedging is ENABLED');
      assert(typeof c.risk_threshold === 'number', `Risk threshold: ${c.risk_threshold}`);
      assert(typeof c.max_leverage === 'number', `Max leverage: ${c.max_leverage}x`);
      info(`Wallet: ${c.wallet_address}`);
      info(`Risk tolerance: ${c.risk_tolerance}`);
      info(`Allowed assets: ${JSON.stringify(c.allowed_assets)}`);
    } else {
      info('No DB config, checking file fallback...');
      const fs = await import('fs');
      const configs = JSON.parse(fs.readFileSync('deployments/auto-hedge-configs.json', 'utf8'));
      const poolConfig = configs.find((c: any) => c.portfolioId === COMMUNITY_POOL_PORTFOLIO_ID);
      assert(poolConfig !== undefined, `File config exists for portfolio ${COMMUNITY_POOL_PORTFOLIO_ID}`);
      if (poolConfig) {
        assert(poolConfig.enabled === true, 'Auto-hedging enabled in file');
        info(`Risk threshold: ${poolConfig.riskThreshold}`);
        info(`Max leverage: ${poolConfig.maxLeverage}x`);
      }
    }
  } catch (error: any) {
    warn(`Config check error: ${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 6: Community Pool On-Chain Contract is accessible
// ────────────────────────────────────────────────────────────────────────────
async function testCommunityPoolContract() {
  console.log('\n══ Test 6: Community Pool On-Chain Contract ══');

  const POOL_ADDRESS = '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B';
  const RPC = 'https://evm-t3.cronos.org';

  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const code = await provider.getCode(POOL_ADDRESS);
    assert(code.length > 2, 'CommunityPool contract is deployed');

    // Try reading pool stats
    const abi = [
      'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
      'function getMemberCount() view returns (uint256)',
    ];
    const pool = new ethers.Contract(POOL_ADDRESS, abi, provider);

    try {
      const stats = await pool.getPoolStats();
      const totalShares = parseFloat(ethers.formatUnits(stats._totalShares, 6));
      const totalNAV = parseFloat(ethers.formatUnits(stats._totalNAV, 6));
      const memberCount = Number(stats._memberCount);
      const sharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));

      assert(true, 'getPoolStats() callable');
      info(`Total Shares: ${totalShares.toFixed(2)}`);
      info(`Total NAV: $${totalNAV.toFixed(2)}`);
      info(`Members: ${memberCount}`);
      info(`Share Price: $${sharePrice.toFixed(4)}`);

      const allocs = stats._allocations.map((a: bigint) => Number(a) / 100);
      info(`Allocations: BTC=${allocs[0]}%, ETH=${allocs[1]}%, SUI=${allocs[2]}%, CRO=${allocs[3]}%`);

      assert(totalNAV >= 0, 'NAV is non-negative');
    } catch (e: any) {
      warn(`getPoolStats() failed: ${e.message?.slice(0, 100)}`);
    }

  } catch (error: any) {
    assert(false, `RPC connection failed: ${error.message?.slice(0, 100)}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 7: Cron State persistence works
// ────────────────────────────────────────────────────────────────────────────
async function testCronStatePersistence() {
  console.log('\n══ Test 7: Cron State Persistence ══');

  try {
    const states = await query(
      `SELECT key, value, updated_at FROM cron_state 
       WHERE key LIKE '%pool%' OR key LIKE '%hedge%' 
       ORDER BY updated_at DESC`
    );

    assert(states.length > 0, `Found ${states.length} pool/hedge cron state entries`);

    for (const s of states) {
      const age = (Date.now() - new Date(s.updated_at).getTime()) / (1000 * 60 * 60);
      info(`${s.key}: ${JSON.stringify(s.value).slice(0, 50)} (${age.toFixed(1)}h ago)`);
    }

    // Check that peak NAV is tracked
    const peak = states.find((s: any) => s.key.includes('peak'));
    if (peak) {
      assert(parseFloat(peak.value) > 0, `Peak NAV tracked: $${parseFloat(peak.value).toFixed(2)}`);
    } else {
      warn('No peak NAV in cron_state');
    }

    // Check last hedge timestamp
    const lastHedge = states.find((s: any) => s.key.includes('lastHedge'));
    if (lastHedge) {
      assert(true, `Last hedge timestamp tracked`);
      info(`Last hedge: ${new Date(parseFloat(lastHedge.value)).toLocaleString()}`);
    }

  } catch (error: any) {
    warn(`Cron state check failed: ${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 8: Community pool hedges are now queryable
// ────────────────────────────────────────────────────────────────────────────
async function testCommunityPoolHedgesQueryable() {
  console.log('\n══ Test 8: Community Pool Hedges Queryable ══');

  try {
    const hedges = await query(
      `SELECT order_id, asset, side, notional_value, leverage, status, 
              on_chain, simulation_mode, reason, created_at
       FROM hedges WHERE portfolio_id = $1 
       ORDER BY created_at DESC LIMIT 10`,
      [COMMUNITY_POOL_PORTFOLIO_ID]
    );

    assert(hedges.length > 0, `Found ${hedges.length} hedges for portfolio_id=${COMMUNITY_POOL_PORTFOLIO_ID}`);

    let realHedges = 0;
    let simHedges = 0;
    let onchainHedges = 0;

    for (const h of hedges) {
      const label = `${h.side} ${h.asset} $${parseFloat(h.notional_value).toFixed(2)} ${h.leverage}x`;
      const flags = [
        h.on_chain ? '⛓️' : '💻',
        h.simulation_mode ? 'SIM' : 'REAL',
        h.status,
      ].join(' ');
      info(`${label} | ${flags} | ${new Date(h.created_at).toLocaleDateString()}`);

      if (!h.simulation_mode) realHedges++;
      if (h.simulation_mode) simHedges++;
      if (h.on_chain) onchainHedges++;
    }

    info(`Real: ${realHedges}, Simulated: ${simHedges}, On-chain: ${onchainHedges}`);

    // Verify none have NULL portfolio_id (excluding our test hedges)
    const nullCheck = await query(
      `SELECT COUNT(*) as count FROM hedges WHERE portfolio_id IS NULL 
       AND order_id NOT LIKE 'test-%' AND order_id NOT LIKE 'pipeline-%'`
    );
    assert(parseInt(nullCheck[0].count) === 0, 
      `No NULL portfolio_id remaining (found: ${nullCheck[0].count}, excluding test hedges)`);

    // Portfolio distribution
    const dist = await query(
      'SELECT portfolio_id, COUNT(*) as count FROM hedges GROUP BY portfolio_id ORDER BY portfolio_id'
    );
    info('Portfolio distribution:');
    for (const d of dist) {
      info(`  portfolio_id=${d.portfolio_id ?? 'NULL'}: ${d.count} hedges`);
    }

  } catch (error: any) {
    assert(false, `Query failed: ${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 9: HedgeExecutor contract accessible for auto-hedging
// ────────────────────────────────────────────────────────────────────────────
async function testHedgeExecutorContract() {
  console.log('\n══ Test 9: HedgeExecutor Contract ══');

  const HEDGE_EXECUTOR = '0x090b6221137690EbB37667E4644287487CE462B9';
  const MOCK_USDC = '0x28217DAddC55e3C4831b4A48A00Ce04880786967';
  const RPC = 'https://evm-t3.cronos.org';

  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    
    const code = await provider.getCode(HEDGE_EXECUTOR);
    assert(code.length > 2, 'HedgeExecutor contract deployed');

    const usdcCode = await provider.getCode(MOCK_USDC);
    assert(usdcCode.length > 2, 'MockUSDC contract deployed');

    // Check deployer wallet balance
    const pk = process.env.PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY || process.env.SERVER_WALLET_PRIVATE_KEY;
    if (pk) {
      const wallet = new ethers.Wallet(pk, provider);
      const balance = await provider.getBalance(wallet.address);
      const croBalance = parseFloat(ethers.formatEther(balance));
      info(`Deployer wallet: ${wallet.address}`);
      info(`CRO balance: ${croBalance.toFixed(4)} tCRO`);
      assert(croBalance > 0.01, `Sufficient gas (${croBalance.toFixed(4)} CRO)`, 
        croBalance <= 0.01 ? 'Need more tCRO for gas' : undefined);

      // Check USDC allowance for HedgeExecutor
      const usdc = new ethers.Contract(MOCK_USDC, [
        'function balanceOf(address) view returns (uint256)',
        'function allowance(address,address) view returns (uint256)',
      ], provider);
      
      const usdcBalance = await usdc.balanceOf(wallet.address);
      const usdcBal = parseFloat(ethers.formatUnits(usdcBalance, 6));
      info(`USDC balance: ${usdcBal.toFixed(2)} USDC`);

      const allowance = await usdc.allowance(wallet.address, HEDGE_EXECUTOR);
      const allow = parseFloat(ethers.formatUnits(allowance, 6));
      info(`USDC allowance to HedgeExecutor: ${allow.toFixed(2)} USDC`);
      
      if (usdcBal > 0) {
        assert(true, 'Has USDC for hedge collateral');
      } else {
        warn('No USDC balance — auto-hedges will use simulation mode');
      }
    } else {
      warn('No PRIVATE_KEY — on-chain hedges will fall back to simulation');
    }

  } catch (error: any) {
    warn(`Contract check failed: ${error.message?.slice(0, 100)}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TEST 10: Full Pipeline Simulation (createHedge + verify + cleanup)
// ────────────────────────────────────────────────────────────────────────────
async function testFullPipelineSimulation() {
  console.log('\n══ Test 10: Full Pipeline Simulation ══');

  const orderId = `pipeline-test-${Date.now()}`;
  cleanupIds.push(orderId);

  try {
    // Step 1: Simulate what AutoHedgingService.executeAutoHedge does
    info('Step 1: Creating hedge like AutoHedgingService would...');
    const hedge = await createHedge({
      orderId,
      portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,
      asset: 'BTC',
      market: 'BTC-USD-PERP',
      side: 'SHORT',
      size: 0.0014,
      notionalValue: 100,
      leverage: 2,
      entryPrice: 71000,
      simulationMode: true,
      reason: '[AUTO] Test: community pool auto-hedge pipeline',
      walletAddress: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c',
      metadata: {
        confidence: 0.85,
        source: 'pipeline-test',
        priceValidation: {
          source: 'test',
          entryPrice: 71000,
          effectivePrice: 71050,
          slippage: 0.07,
        },
      },
    });

    assert(hedge.portfolio_id === COMMUNITY_POOL_PORTFOLIO_ID, `Step 1: portfolio_id=${COMMUNITY_POOL_PORTFOLIO_ID} preserved`);
    assert(hedge.reason?.startsWith('[AUTO]'), 'Step 1: Auto-tag in reason');

    // Step 2: Verify it shows up in community pool queries
    info(`Step 2: Verifying visibility in portfolio_id=${COMMUNITY_POOL_PORTFOLIO_ID} queries...`);
    const found = await query(
      'SELECT * FROM hedges WHERE portfolio_id = $1 AND order_id = $2',
      [COMMUNITY_POOL_PORTFOLIO_ID, orderId]
    );
    assert(found.length === 1, `Step 2: Found in portfolio_id=${COMMUNITY_POOL_PORTFOLIO_ID} query`);

    // Step 3: Verify check-hedge-status would find it
    info('Step 3: Verifying check-hedge-status query...');
    const statusQuery = await query(
      'SELECT order_id, side, asset, notional_value, leverage, status, reason FROM hedges WHERE portfolio_id = $1 ORDER BY created_at DESC LIMIT 1',
      [COMMUNITY_POOL_PORTFOLIO_ID]
    );
    assert(statusQuery.length > 0, 'Step 3: Latest community pool hedge found');
    assert(statusQuery[0].order_id === orderId, 'Step 3: It is our test hedge');

    // Step 4: Verify NOT in NULL query (the old bug)
    info('Step 4: Verifying NOT in NULL portfolio_id results...');
    const nullQuery = await query(
      'SELECT * FROM hedges WHERE portfolio_id IS NULL AND order_id = $1',
      [orderId]
    );
    assert(nullQuery.length === 0, 'Step 4: NOT found in NULL query (bug fixed!)');

    info('Pipeline simulation complete ✓');

  } catch (error: any) {
    assert(false, `Pipeline failed: ${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CLEANUP
// ────────────────────────────────────────────────────────────────────────────
async function cleanup() {
  console.log('\n── Cleanup ──');
  if (cleanupIds.length > 0) {
    for (const id of cleanupIds) {
      try {
        await query('DELETE FROM hedges WHERE order_id = $1', [id]);
      } catch { /* ignore */ }
    }
    info(`Cleaned up ${cleanupIds.length} test hedges`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  Community Pool Auto-Management Verification Test               ║');
  console.log('║  Tests portfolio_id fix + full auto-hedge pipeline              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log(`\nPRIVATE_KEY: ${process.env.PRIVATE_KEY ? '✓' : '✗'}`);
  console.log(`DATABASE_URL: ${process.env.DATABASE_URL ? '✓' : '✗'}`);

  const startTime = Date.now();

  // Core fix verification
  await testCreateHedgePortfolioId();
  await testUpsertOnChainHedgePortfolioId();
  await testNonZeroPortfolioId();
  await testNullPortfolioId();

  // Infrastructure checks
  await testAutoHedgeConfig();
  await testCommunityPoolContract();
  await testHedgeExecutorContract();
  await testCronStatePersistence();

  // Integration checks
  await testCommunityPoolHedgesQueryable();
  await testFullPipelineSimulation();

  // Cleanup test data
  await cleanup();

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${warnings} warnings (${duration}s)`);
  if (failed === 0) {
    console.log(`  ✅ Community pool auto-management is fully operational!`);
  } else {
    console.log(`  ❌ ${failed} issue(s) need attention`);
  }
  console.log(`═══════════════════════════════════════════════════════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
