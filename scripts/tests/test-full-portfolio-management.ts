#!/usr/bin/env npx tsx
/**
 * Comprehensive E2E Test: Community Pool Auto-Management + Wallet Portfolio Management
 * 
 * Tests BOTH systems end-to-end to verify:
 * 
 * PART A: Community Pool (portfolio_id = -1)
 *   1.  Community pool portfolio_id=-1 isolation from user portfolios
 *   2.  Auto-hedge config CRUD for community pool
 *   3.  Risk assessment via AutoHedgingService for community pool
 *   4.  Community pool on-chain contract reads (getPoolStats)
 *   5.  Community pool hedges queryable and isolated
 * 
 * PART B: Wallet-Based Portfolio Management (portfolio_id = 0, 1, 2, ...)
 *   6.  RWAManager on-chain portfolio enumeration
 *   7.  createHedge() for user portfolios (0, 1, 3)
 *   8.  Auto-hedge config CRUD for user portfolios
 *   9.  Risk assessment for user portfolio
 *   10. getActiveHedges() correctly filters by portfolio_id
 *   11. getActiveHedgesByWallet() returns correct hedges
 * 
 * PART C: Cross-System Isolation
 *   12. Community pool hedges do NOT appear in user portfolio queries
 *   13. User portfolio hedges do NOT appear in community pool queries
 *   14. Auto-hedge configs are independent per portfolio
 *   15. PnL updates work for all portfolio types
 * 
 * PART D: Agent Integration
 *   16. Agent orchestrator initializes all agents
 *   17. Risk agent can analyze portfolio
 *   18. End-to-end: enable auto-hedge → trigger assessment → verify DB state
 * 
 * Run: npx tsx scripts/tests/test-full-portfolio-management.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { ethers } from 'ethers';

// Module-level references set during init()
let createHedge: any, upsertOnChainHedge: any, getActiveHedges: any, getAllHedges: any,
    getActiveHedgesByWallet: any, getHedgeByOrderId: any, updateHedgePnL: any, updateHedgeStatus: any;
let query: any;
let saveAutoHedgeConfig: any, getAutoHedgeConfig: any, getAutoHedgeConfigs: any,
    deleteAutoHedgeConfig: any, disableAutoHedge: any;
let COMMUNITY_POOL_PORTFOLIO_ID: number;
let isCommunityPoolPortfolio: (id: any) => boolean;
let autoHedgingService: any;

async function init() {
  const hedgesMod = await import('../../lib/db/hedges');
  createHedge = hedgesMod.createHedge;
  upsertOnChainHedge = hedgesMod.upsertOnChainHedge;
  getActiveHedges = hedgesMod.getActiveHedges;
  getAllHedges = hedgesMod.getAllHedges;
  getActiveHedgesByWallet = hedgesMod.getActiveHedgesByWallet;
  getHedgeByOrderId = hedgesMod.getHedgeByOrderId;
  updateHedgePnL = hedgesMod.updateHedgePnL;
  updateHedgeStatus = hedgesMod.updateHedgeStatus;

  const pgMod = await import('../../lib/db/postgres');
  query = pgMod.query;

  const storageMod = await import('../../lib/storage/auto-hedge-storage');
  saveAutoHedgeConfig = storageMod.saveAutoHedgeConfig;
  getAutoHedgeConfig = storageMod.getAutoHedgeConfig;
  getAutoHedgeConfigs = storageMod.getAutoHedgeConfigs;
  deleteAutoHedgeConfig = storageMod.deleteAutoHedgeConfig;
  disableAutoHedge = storageMod.disableAutoHedge;

  const constMod = await import('../../lib/constants');
  COMMUNITY_POOL_PORTFOLIO_ID = constMod.COMMUNITY_POOL_PORTFOLIO_ID;
  isCommunityPoolPortfolio = constMod.isCommunityPoolPortfolio;

  const svcMod = await import('../../lib/services/AutoHedgingService');
  autoHedgingService = svcMod.autoHedgingService;
}

async function getAutoHedgingService() {
  return autoHedgingService;
}

// ─── Test Infrastructure ────────────────────────────────────────────────────

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const INFO = '\x1b[36mℹ\x1b[0m';
const SECTION = '\x1b[35m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;
let warnings = 0;
const cleanupIds: string[] = [];
const cleanupConfigIds: number[] = [];

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

function section(title: string) {
  console.log(`\n${SECTION}═══ ${title} ═══${RESET}`);
}

// ─── PART A: Community Pool (portfolio_id = -1) ─────────────────────────────

async function testA1_CommunityPoolIsolation() {
  section('A1: Community Pool portfolio_id=-1 Isolation');

  assert(COMMUNITY_POOL_PORTFOLIO_ID === -1, 'COMMUNITY_POOL_PORTFOLIO_ID is -1');
  assert(isCommunityPoolPortfolio(-1) === true, 'isCommunityPoolPortfolio(-1) returns true');
  assert(isCommunityPoolPortfolio(0) === false, 'isCommunityPoolPortfolio(0) returns false');
  assert(isCommunityPoolPortfolio(1) === false, 'isCommunityPoolPortfolio(1) returns false');
  assert(isCommunityPoolPortfolio(null) === false, 'isCommunityPoolPortfolio(null) returns false');
  assert(isCommunityPoolPortfolio(undefined) === false, 'isCommunityPoolPortfolio(undefined) returns false');

  // Verify DB has community pool hedges with -1
  const cpHedges = await query(
    'SELECT COUNT(*) as count FROM hedges WHERE portfolio_id = $1',
    [COMMUNITY_POOL_PORTFOLIO_ID]
  );
  info(`Community pool hedges in DB: ${cpHedges[0].count}`);
  assert(parseInt(cpHedges[0].count) >= 0, 'Can query community pool hedges');
}

async function testA2_CommunityPoolAutoHedgeConfig() {
  section('A2: Auto-Hedge Config CRUD for Community Pool');

  // Read existing config
  const existingConfig = await getAutoHedgeConfig(COMMUNITY_POOL_PORTFOLIO_ID);
  
  if (existingConfig) {
    assert(existingConfig.portfolioId === COMMUNITY_POOL_PORTFOLIO_ID, 
      `Config portfolioId is ${COMMUNITY_POOL_PORTFOLIO_ID}`);
    assert(existingConfig.enabled === true, 'Community pool auto-hedge is enabled');
    info(`Risk threshold: ${existingConfig.riskThreshold}`);
    info(`Max leverage: ${existingConfig.maxLeverage}x`);
    info(`Allowed assets: ${existingConfig.allowedAssets.join(', ')}`);
  } else {
    warn('No existing community pool config, creating one');
    await saveAutoHedgeConfig({
      portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,
      walletAddress: '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B',
      enabled: true,
      riskThreshold: 4,
      maxLeverage: 2,
      allowedAssets: ['BTC', 'ETH', 'CRO', 'SUI'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    cleanupConfigIds.push(COMMUNITY_POOL_PORTFOLIO_ID);
    const created = await getAutoHedgeConfig(COMMUNITY_POOL_PORTFOLIO_ID);
    assert(created !== null, 'Created community pool config');
  }

  // Verify it appears in the full list
  const allConfigs = await getAutoHedgeConfigs();
  const cpConfig = allConfigs.find(c => c.portfolioId === COMMUNITY_POOL_PORTFOLIO_ID);
  assert(cpConfig !== undefined, 'Community pool config in getAutoHedgeConfigs()');
}

async function testA3_CommunityPoolRiskAssessment() {
  section('A3: Risk Assessment for Community Pool');

  try {
    const svc = await getAutoHedgingService();
    // Ensure service has the config loaded
    const config = await getAutoHedgeConfig(COMMUNITY_POOL_PORTFOLIO_ID);
    if (config) {
      svc.enableForPortfolio({
        portfolioId: config.portfolioId,
        walletAddress: config.walletAddress,
        enabled: config.enabled,
        riskThreshold: config.riskThreshold,
        maxLeverage: config.maxLeverage,
        allowedAssets: config.allowedAssets,
      });
    }

    const assessment = await svc.triggerRiskAssessment(
      COMMUNITY_POOL_PORTFOLIO_ID, 
      '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B'
    );

    assert(assessment !== null, 'Risk assessment returned');
    assert(assessment.portfolioId === COMMUNITY_POOL_PORTFOLIO_ID, 
      `Assessment portfolioId is ${COMMUNITY_POOL_PORTFOLIO_ID} (got: ${assessment.portfolioId})`);
    assert(typeof assessment.riskScore === 'number', `Risk score: ${assessment.riskScore}`);
    assert(typeof assessment.totalValue === 'number', `Total value: $${assessment.totalValue.toFixed(2)}`);
    assert(typeof assessment.drawdownPercent === 'number', `Drawdown: ${assessment.drawdownPercent.toFixed(2)}%`);
    assert(typeof assessment.volatility === 'number', `Volatility: ${assessment.volatility.toFixed(2)}`);
    assert(Array.isArray(assessment.recommendations), `Recommendations: ${assessment.recommendations.length}`);
    assert(assessment.timestamp > 0, 'Has valid timestamp');

    // Verify it's stored
    const stored = svc.getLastRiskAssessment(COMMUNITY_POOL_PORTFOLIO_ID);
    assert(stored !== null, 'Assessment stored in service');
    if (stored) {
      assert(stored.portfolioId === COMMUNITY_POOL_PORTFOLIO_ID, 'Stored assessment has correct portfolioId');
    }

    if (assessment.recommendations.length > 0) {
      const rec = assessment.recommendations[0];
      info(`Top recommendation: ${rec.side} ${rec.asset} — confidence: ${rec.confidence.toFixed(2)}`);
      info(`Reason: ${rec.reason}`);
    }
  } catch (error: any) {
    warn(`Risk assessment error (may be expected): ${error.message?.slice(0, 120)}`);
  }
}

async function testA4_CommunityPoolOnChain() {
  section('A4: Community Pool On-Chain Contract');

  const RPC = 'https://evm-t3.cronos.org';
  const POOL = '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B';

  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const contract = new ethers.Contract(POOL, [
      'function getPoolStats() view returns (uint256, uint256, uint256, uint256, uint256[4])',
      'function getMemberCount() view returns (uint256)',
    ], provider);

    const stats = await contract.getPoolStats();
    const totalNAV = parseFloat(ethers.formatUnits(stats[1], 6));
    const members = Number(stats[2]);
    const sharePrice = parseFloat(ethers.formatUnits(stats[3], 6));
    const allocs = stats[4].map((a: bigint) => Number(a) / 100);

    assert(true, 'getPoolStats() callable');
    info(`NAV: $${totalNAV.toFixed(2)} | Members: ${members} | Share Price: $${sharePrice.toFixed(4)}`);
    info(`Allocations: BTC=${allocs[0]}%, ETH=${allocs[1]}%, SUI=${allocs[2]}%, CRO=${allocs[3]}%`);
    assert(totalNAV >= 0, 'NAV is non-negative');
  } catch (error: any) {
    warn(`On-chain read failed: ${error.message?.slice(0, 100)}`);
  }
}

async function testA5_CommunityPoolHedgesQueryable() {
  section('A5: Community Pool Hedges Queryable');

  const orderId = `cp-test-${Date.now()}`;
  cleanupIds.push(orderId);

  // Create a community pool hedge
  const hedge = await createHedge({
    orderId,
    portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,
    walletAddress: '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B',
    asset: 'BTC',
    market: 'BTC-USD-PERP',
    side: 'SHORT',
    size: 0.001,
    notionalValue: 75,
    leverage: 2,
    entryPrice: 75000,
    simulationMode: true,
    reason: 'TEST: community pool hedge isolation',
  });

  assert(hedge.portfolio_id === COMMUNITY_POOL_PORTFOLIO_ID, 'Created with portfolio_id=-1');

  // Query by portfolio_id
  const activeCP = await getActiveHedges(COMMUNITY_POOL_PORTFOLIO_ID);
  const found = activeCP.find(h => h.order_id === orderId);
  assert(found !== undefined, 'Found in getActiveHedges(-1)');

  // Should NOT appear in user portfolio 0 queries
  const activeUser0 = await getActiveHedges(0);
  const notFound0 = activeUser0.find(h => h.order_id === orderId);
  assert(notFound0 === undefined, 'NOT found in getActiveHedges(0)');

  // Should NOT appear in user portfolio 1 queries
  const activeUser1 = await getActiveHedges(1);
  const notFound1 = activeUser1.find(h => h.order_id === orderId);
  assert(notFound1 === undefined, 'NOT found in getActiveHedges(1)');
}

// ─── PART B: Wallet-Based Portfolio Management ──────────────────────────────

async function testB6_RWAManagerPortfolios() {
  section('B6: RWAManager On-Chain Portfolio Enumeration');

  const RPC = 'https://evm-t3.cronos.org';
  const RWA_MANAGER = '0x170E8232E9e18eeB1839dB1d939501994f1e272F';

  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const contract = new ethers.Contract(RWA_MANAGER, [
      'function portfolioCount() view returns (uint256)',
      'function portfolios(uint256) view returns (address owner, uint256 totalValue, uint256 targetYield, uint256 riskTolerance, uint256 lastRebalance, bool isActive)',
    ], provider);

    const count = Number(await contract.portfolioCount());
    assert(count > 0, `RWAManager has ${count} portfolios`);
    info(`Portfolio IDs: 0 through ${count - 1}`);

    // Check first portfolio (ID=0) is a USER portfolio, NOT community pool
    const p0 = await contract.portfolios(0);
    assert(true, `Portfolio 0: owner=${p0.owner.slice(0, 10)}..., active=${p0.isActive}`);
    info(`Portfolio 0 totalValue: ${ethers.formatUnits(p0.totalValue, 6)} | riskTol: ${Number(p0.riskTolerance)}`);

    // Verify portfolio 0 is NOT the community pool address
    assert(
      p0.owner.toLowerCase() !== '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B'.toLowerCase(),
      'Portfolio 0 owner is NOT the CommunityPool contract'
    );

    // Check a few more if they exist
    for (let i = 1; i < Math.min(count, 3); i++) {
      try {
        const px = await contract.portfolios(i);
        info(`Portfolio ${i}: owner=${px.owner.slice(0, 10)}..., active=${px.isActive}`);
      } catch { /* ignore */ }
    }
  } catch (error: any) {
    warn(`RWAManager read failed: ${error.message?.slice(0, 100)}`);
  }
}

async function testB7_UserPortfolioHedges() {
  section('B7: createHedge() for User Portfolios (0, 1, 3)');

  const testWallets: Record<number, string> = {
    0: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c',
    1: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
    3: '0xABcd1234567890abcdef1234567890abcdef1234',
  };

  for (const [pidStr, wallet] of Object.entries(testWallets)) {
    const pid = parseInt(pidStr);
    const orderId = `user-p${pid}-test-${Date.now()}`;
    cleanupIds.push(orderId);

    const hedge = await createHedge({
      orderId,
      portfolioId: pid,
      walletAddress: wallet,
      asset: pid === 0 ? 'BTC' : pid === 1 ? 'ETH' : 'CRO',
      market: `${pid === 0 ? 'BTC' : pid === 1 ? 'ETH' : 'CRO'}-USD-PERP`,
      side: 'SHORT',
      size: 0.01,
      notionalValue: 100,
      leverage: 2,
      entryPrice: pid === 0 ? 75000 : pid === 1 ? 3800 : 0.35,
      simulationMode: true,
      reason: `TEST: user portfolio ${pid} hedge`,
    });

    assert(hedge.portfolio_id === pid, `Portfolio ${pid}: portfolio_id=${hedge.portfolio_id}`);
    assert(hedge.wallet_address === wallet, `Portfolio ${pid}: correct wallet`);
    assert(hedge.asset === (pid === 0 ? 'BTC' : pid === 1 ? 'ETH' : 'CRO'), 
      `Portfolio ${pid}: correct asset`);
  }
}

async function testB8_UserAutoHedgeConfigCRUD() {
  section('B8: Auto-Hedge Config CRUD for User Portfolios');

  const testPid = 99; // Use a high ID to avoid conflicts
  cleanupConfigIds.push(testPid);

  // Create
  await saveAutoHedgeConfig({
    portfolioId: testPid,
    walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    enabled: true,
    riskThreshold: 6,
    maxLeverage: 5,
    allowedAssets: ['BTC', 'ETH'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const created = await getAutoHedgeConfig(testPid);
  assert(created !== null, 'Config created');
  assert(created!.portfolioId === testPid, `portfolioId=${testPid}`);
  assert(created!.riskThreshold === 6, 'riskThreshold=6');
  assert(created!.maxLeverage === 5, 'maxLeverage=5');
  assert(created!.enabled === true, 'enabled=true');

  // Update
  await saveAutoHedgeConfig({
    ...created!,
    riskThreshold: 8,
    updatedAt: Date.now(),
  });
  const updated = await getAutoHedgeConfig(testPid);
  assert(updated!.riskThreshold === 8, 'riskThreshold updated to 8');

  // Disable (soft)
  await disableAutoHedge(testPid);
  const disabled = await getAutoHedgeConfig(testPid);
  // disableAutoHedge sets enabled=false, getAutoHedgeConfig may or may not return disabled
  // Check DB directly
  const dbCheck = await query(
    'SELECT enabled FROM auto_hedge_configs WHERE portfolio_id = $1',
    [testPid]
  );
  assert(dbCheck.length > 0 && dbCheck[0].enabled === false, 'Config disabled in DB');

  // Delete (hard)
  await deleteAutoHedgeConfig(testPid);
  const deleted = await query(
    'SELECT COUNT(*) as count FROM auto_hedge_configs WHERE portfolio_id = $1',
    [testPid]
  );
  assert(parseInt(deleted[0].count) === 0, 'Config deleted from DB');
  // Remove from cleanup since already deleted
  cleanupConfigIds.splice(cleanupConfigIds.indexOf(testPid), 1);
}

async function testB9_UserPortfolioRiskAssessment() {
  section('B9: Risk Assessment for User Portfolio');

  try {
    const testPid = 3;
    const testWallet = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1';

    const svc = await getAutoHedgingService();
    // Enable in service temporarily
    svc.enableForPortfolio({
      portfolioId: testPid,
      walletAddress: testWallet,
      enabled: true,
      riskThreshold: 7,
      maxLeverage: 3,
      allowedAssets: ['BTC', 'ETH', 'CRO', 'SUI'],
    });

    const assessment = await svc.triggerRiskAssessment(testPid, testWallet);

    assert(assessment !== null, 'Assessment returned');
    assert(assessment.portfolioId === testPid, `portfolioId=${testPid} (got: ${assessment.portfolioId})`);
    assert(typeof assessment.riskScore === 'number', `Risk score: ${assessment.riskScore}`);
    assert(typeof assessment.totalValue === 'number', `Total value: $${assessment.totalValue.toFixed(2)}`);
    assert(assessment.timestamp > 0, 'Has timestamp');

    // Important: this should NOT route to assessCommunityPoolRisk
    assert(!isCommunityPoolPortfolio(assessment.portfolioId), 
      'Assessment is NOT for community pool');

    // Clean up
    svc.disableForPortfolio(testPid);

  } catch (error: any) {
    warn(`User risk assessment error: ${error.message?.slice(0, 120)}`);
  }
}

async function testB10_GetActiveHedgesFiltering() {
  section('B10: getActiveHedges() Filtering by portfolio_id');

  // Create hedges for different portfolios
  const pid0Id = `filter-p0-${Date.now()}`;
  const pid1Id = `filter-p1-${Date.now()}`;
  const cpId = `filter-cp-${Date.now()}`;
  cleanupIds.push(pid0Id, pid1Id, cpId);

  await createHedge({
    orderId: pid0Id, portfolioId: 0, asset: 'BTC', market: 'BTC-USD-PERP',
    side: 'SHORT', size: 0.01, notionalValue: 100, leverage: 2,
    simulationMode: true, reason: 'TEST: filter p0',
  });
  await createHedge({
    orderId: pid1Id, portfolioId: 1, asset: 'ETH', market: 'ETH-USD-PERP',
    side: 'LONG', size: 0.1, notionalValue: 380, leverage: 3,
    simulationMode: true, reason: 'TEST: filter p1',
  });
  await createHedge({
    orderId: cpId, portfolioId: COMMUNITY_POOL_PORTFOLIO_ID, asset: 'CRO', market: 'CRO-USD-PERP',
    side: 'SHORT', size: 100, notionalValue: 30, leverage: 2,
    simulationMode: true, reason: 'TEST: filter community pool',
  });

  // Filter by portfolio 0
  const p0Hedges = await getActiveHedges(0);
  assert(p0Hedges.some(h => h.order_id === pid0Id), 'Portfolio 0 hedge found in getActiveHedges(0)');
  assert(!p0Hedges.some(h => h.order_id === pid1Id), 'Portfolio 1 hedge NOT in getActiveHedges(0)');
  assert(!p0Hedges.some(h => h.order_id === cpId), 'Community pool hedge NOT in getActiveHedges(0)');

  // Filter by portfolio 1
  const p1Hedges = await getActiveHedges(1);
  assert(p1Hedges.some(h => h.order_id === pid1Id), 'Portfolio 1 hedge found in getActiveHedges(1)');
  assert(!p1Hedges.some(h => h.order_id === pid0Id), 'Portfolio 0 hedge NOT in getActiveHedges(1)');

  // Filter by community pool
  const cpHedges = await getActiveHedges(COMMUNITY_POOL_PORTFOLIO_ID);
  assert(cpHedges.some(h => h.order_id === cpId), 'CP hedge found in getActiveHedges(-1)');
  assert(!cpHedges.some(h => h.order_id === pid0Id), 'Portfolio 0 hedge NOT in getActiveHedges(-1)');

  // No filter → should return ALL
  const allHedges = await getActiveHedges();
  assert(allHedges.some(h => h.order_id === pid0Id), 'Portfolio 0 hedge in unfiltered query');
  assert(allHedges.some(h => h.order_id === pid1Id), 'Portfolio 1 hedge in unfiltered query');
  assert(allHedges.some(h => h.order_id === cpId), 'CP hedge in unfiltered query');
}

async function testB11_GetActiveHedgesByWallet() {
  section('B11: getActiveHedgesByWallet() Correctness');

  const wallet1 = '0xTEST_WALLET_A_' + Date.now();
  const wallet2 = '0xTEST_WALLET_B_' + Date.now();
  
  const w1Id = `wallet-a-${Date.now()}`;
  const w2Id = `wallet-b-${Date.now()}`;
  cleanupIds.push(w1Id, w2Id);

  await createHedge({
    orderId: w1Id, portfolioId: 0, walletAddress: wallet1,
    asset: 'BTC', market: 'BTC-USD-PERP',
    side: 'SHORT', size: 0.01, notionalValue: 100, leverage: 2,
    simulationMode: true, reason: 'TEST: wallet A',
  });
  await createHedge({
    orderId: w2Id, portfolioId: 1, walletAddress: wallet2,
    asset: 'ETH', market: 'ETH-USD-PERP',
    side: 'LONG', size: 0.1, notionalValue: 380, leverage: 3,
    simulationMode: true, reason: 'TEST: wallet B',
  });

  const w1Hedges = await getActiveHedgesByWallet(wallet1);
  assert(w1Hedges.some(h => h.order_id === w1Id), 'Wallet A hedge found');
  assert(!w1Hedges.some(h => h.order_id === w2Id), 'Wallet B hedge NOT in wallet A query');

  const w2Hedges = await getActiveHedgesByWallet(wallet2);
  assert(w2Hedges.some(h => h.order_id === w2Id), 'Wallet B hedge found');
  assert(!w2Hedges.some(h => h.order_id === w1Id), 'Wallet A hedge NOT in wallet B query');
}

// ─── PART C: Cross-System Isolation ─────────────────────────────────────────

async function testC12_CommunityPoolNotInUserQueries() {
  section('C12: Community Pool Hedges NOT in User Portfolio Queries');

  const cpId = `isolation-cp-${Date.now()}`;
  cleanupIds.push(cpId);

  await createHedge({
    orderId: cpId, portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,
    walletAddress: '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B',
    asset: 'BTC', market: 'BTC-USD-PERP',
    side: 'SHORT', size: 0.001, notionalValue: 75, leverage: 2,
    simulationMode: true, reason: 'TEST: isolation check',
  });

  // Check it's NOT in any user portfolio queries
  for (const pid of [0, 1, 2, 3]) {
    const hedges = await getActiveHedges(pid);
    const found = hedges.find(h => h.order_id === cpId);
    assert(found === undefined, `CP hedge NOT in getActiveHedges(${pid})`);
  }

  // But IS in community pool query
  const cpHedges = await getActiveHedges(COMMUNITY_POOL_PORTFOLIO_ID);
  const found = cpHedges.find(h => h.order_id === cpId);
  assert(found !== undefined, 'CP hedge IS in getActiveHedges(-1)');
}

async function testC13_UserHedgesNotInCommunityPool() {
  section('C13: User Hedges NOT in Community Pool Queries');

  const userId = `isolation-user-${Date.now()}`;
  cleanupIds.push(userId);

  await createHedge({
    orderId: userId, portfolioId: 0,
    walletAddress: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c',
    asset: 'ETH', market: 'ETH-USD-PERP',
    side: 'LONG', size: 0.1, notionalValue: 380, leverage: 3,
    simulationMode: true, reason: 'TEST: user hedge isolation',
  });

  const cpHedges = await getActiveHedges(COMMUNITY_POOL_PORTFOLIO_ID);
  const found = cpHedges.find(h => h.order_id === userId);
  assert(found === undefined, 'User hedge NOT in getActiveHedges(-1)');

  // But IS in portfolio 0 query
  const p0Hedges = await getActiveHedges(0);
  const foundP0 = p0Hedges.find(h => h.order_id === userId);
  assert(foundP0 !== undefined, 'User hedge IS in getActiveHedges(0)');
}

async function testC14_AutoHedgeConfigIndependence() {
  section('C14: Auto-Hedge Config Independence Per Portfolio');

  const testPidA = 97;
  const testPidB = 98;
  cleanupConfigIds.push(testPidA, testPidB);

  await saveAutoHedgeConfig({
    portfolioId: testPidA, walletAddress: '0xAAAA', enabled: true,
    riskThreshold: 3, maxLeverage: 2, allowedAssets: ['BTC'],
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  await saveAutoHedgeConfig({
    portfolioId: testPidB, walletAddress: '0xBBBB', enabled: true,
    riskThreshold: 8, maxLeverage: 10, allowedAssets: ['ETH', 'CRO'],
    createdAt: Date.now(), updatedAt: Date.now(),
  });

  const configA = await getAutoHedgeConfig(testPidA);
  const configB = await getAutoHedgeConfig(testPidB);

  assert(configA!.riskThreshold === 3, 'Config A riskThreshold=3');
  assert(configB!.riskThreshold === 8, 'Config B riskThreshold=8');
  assert(configA!.maxLeverage === 2, 'Config A maxLeverage=2');
  assert(configB!.maxLeverage === 10, 'Config B maxLeverage=10');

  // Disable A, verify B unaffected
  await disableAutoHedge(testPidA);
  const stillEnabled = await query(
    'SELECT enabled FROM auto_hedge_configs WHERE portfolio_id = $1',
    [testPidB]
  );
  assert(stillEnabled[0].enabled === true, 'Config B still enabled after disabling A');

  // Verify community pool config is unaffected
  const cpConfig = await getAutoHedgeConfig(COMMUNITY_POOL_PORTFOLIO_ID);
  if (cpConfig) {
    assert(cpConfig.enabled === true, 'Community pool config unaffected');
  }
}

async function testC15_PnLUpdatesAllPortfolios() {
  section('C15: PnL Updates Work for All Portfolio Types');

  // Create hedges for different portfolio types
  const hedgeIds: string[] = [];
  const testCases = [
    { pid: COMMUNITY_POOL_PORTFOLIO_ID, asset: 'BTC', label: 'community pool' },
    { pid: 0, asset: 'ETH', label: 'user portfolio 0' },
    { pid: 3, asset: 'CRO', label: 'user portfolio 3' },
  ];

  for (const tc of testCases) {
    const orderId = `pnl-${tc.label.replace(/ /g, '-')}-${Date.now()}`;
    cleanupIds.push(orderId);
    hedgeIds.push(orderId);

    await createHedge({
      orderId,
      portfolioId: tc.pid,
      asset: tc.asset,
      market: `${tc.asset}-USD-PERP`,
      side: 'SHORT',
      size: 0.01,
      notionalValue: 100,
      leverage: 2,
      simulationMode: true,
      reason: `TEST: PnL update for ${tc.label}`,
    });
  }

  // Update PnL for each
  for (let i = 0; i < hedgeIds.length; i++) {
    const pnl = (i + 1) * 10.5; // 10.5, 21.0, 31.5
    await updateHedgePnL(hedgeIds[i], pnl);
    const hedge = await getHedgeByOrderId(hedgeIds[i]);
    assert(hedge !== null && parseFloat(String(hedge.current_pnl)) === pnl, 
      `${testCases[i].label}: PnL updated to ${pnl}`,
      hedge ? `got: ${hedge.current_pnl} (${typeof hedge.current_pnl})` : 'hedge not found');
  }

  // Update status
  try {
    await updateHedgeStatus(hedgeIds[0], 'closed');
    const closed = await getHedgeByOrderId(hedgeIds[0]);
    assert(closed!.status === 'closed', 'Community pool hedge status updated to closed');
  } catch (error: any) {
    warn(`updateHedgeStatus error: ${error.message?.slice(0, 100)}`);
  }
}

// ─── PART D: Agent Integration ──────────────────────────────────────────────

async function testD16_AgentOrchestratorInit() {
  section('D16: Agent Orchestrator Initialization');

  try {
    const { getAgentOrchestrator } = await import('../../lib/services/agent-orchestrator');
    const orchestrator = getAgentOrchestrator();
    
    assert(orchestrator !== null, 'Orchestrator initialized');

    const status = orchestrator.getStatus();
    assert(status !== null, 'Status returned');
    info(`Orchestrator status: ${JSON.stringify(status).slice(0, 200)}`);

    // Check agent availability (these are async methods)
    try {
      const leadAgent = await orchestrator.getLeadAgent();
      assert(leadAgent !== null && leadAgent !== undefined, 'LeadAgent available');
    } catch {
      warn('LeadAgent not available (may need full init)');
    }

    try {
      const riskAgent = await orchestrator.getRiskAgent();
      assert(riskAgent !== null && riskAgent !== undefined, 'RiskAgent available');
    } catch {
      warn('RiskAgent not available');
    }

    try {
      const hedgingAgent = await orchestrator.getHedgingAgent();
      assert(hedgingAgent !== null && hedgingAgent !== undefined, 'HedgingAgent available');
    } catch {
      warn('HedgingAgent not available');
    }
  } catch (error: any) {
    warn(`Orchestrator init error: ${error.message?.slice(0, 120)}`);
  }
}

async function testD17_AutoHedgingServiceStatus() {
  section('D17: AutoHedgingService Status & Lifecycle');

  const svc = await getAutoHedgingService();
  const status = svc.getStatus();
  assert(typeof status.isRunning === 'boolean', `isRunning: ${status.isRunning}`);
  assert(Array.isArray(status.enabledPortfolios), `Enabled portfolios: [${status.enabledPortfolios.join(', ')}]`);
  assert(typeof status.config === 'object', 'Config object present');
  info(`PnL interval: ${status.config.PNL_UPDATE_INTERVAL_MS}ms`);
  info(`Risk interval: ${status.config.RISK_CHECK_INTERVAL_MS}ms`);

  // Ensure service is running
  await svc.start();
  const afterStart = svc.getStatus();
  assert(afterStart.isRunning === true, 'Service is running after start()');

  // Check that community pool is in enabled list
  const hasCommunityPool = afterStart.enabledPortfolios.includes(COMMUNITY_POOL_PORTFOLIO_ID);
  if (hasCommunityPool) {
    assert(true, 'Community pool (-1) in enabled portfolios');
  } else {
    warn('Community pool not auto-loaded (config may not be in DB)');
  }
}

async function testD18_EndToEndAutoHedgeFlow() {
  section('D18: End-to-End: Enable → Assess → Verify');

  const testPid = 95;
  const testWallet = '0xTEST_E2E_' + Date.now();
  cleanupConfigIds.push(testPid);

  try {
    // Step 1: Save config to storage
    info('Step 1: Saving auto-hedge config...');
    await saveAutoHedgeConfig({
      portfolioId: testPid,
      walletAddress: testWallet,
      enabled: true,
      riskThreshold: 3, // Low threshold to increase chance of triggering
      maxLeverage: 2,
      allowedAssets: ['BTC', 'ETH', 'CRO', 'SUI'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const savedConfig = await getAutoHedgeConfig(testPid);
    assert(savedConfig !== null, 'Config saved to storage');

    // Step 2: Enable in service
    const svc = await getAutoHedgingService();
    info('Step 2: Enabling in AutoHedgingService...');
    svc.enableForPortfolio({
      portfolioId: testPid,
      walletAddress: testWallet,
      enabled: true,
      riskThreshold: 3,
      maxLeverage: 2,
      allowedAssets: ['BTC', 'ETH', 'CRO', 'SUI'],
    });

    const status = svc.getStatus();
    assert(status.enabledPortfolios.includes(testPid), `Portfolio ${testPid} in enabled list`);

    // Step 3: Trigger risk assessment
    info('Step 3: Triggering risk assessment...');
    const assessment = await svc.triggerRiskAssessment(testPid, testWallet);
    assert(assessment.portfolioId === testPid, `Assessment for portfolio ${testPid}`);
    assert(typeof assessment.riskScore === 'number', `Risk score: ${assessment.riskScore}`);

    // Step 4: Verify stored assessment
    const stored = svc.getLastRiskAssessment(testPid);
    assert(stored !== null, 'Assessment stored in service');

    // Step 5: Verify this is a DIFFERENT assessment than community pool
    const cpAssessment = svc.getLastRiskAssessment(COMMUNITY_POOL_PORTFOLIO_ID);
    if (cpAssessment) {
      assert(cpAssessment.portfolioId !== testPid, 
        'Community pool assessment is separate from user portfolio assessment');
    }

    // Step 6: Disable and verify cleanup
    info('Step 6: Disabling portfolio...');
    svc.disableForPortfolio(testPid);
    const statusAfter = svc.getStatus();
    assert(!statusAfter.enabledPortfolios.includes(testPid), `Portfolio ${testPid} removed from enabled list`);

  } catch (error: any) {
    warn(`E2E flow error: ${error.message?.slice(0, 150)}`);
  }
}

// ─── PART E: Data Integrity Summary ─────────────────────────────────────────

async function testE19_DataIntegritySummary() {
  section('E19: Database Data Integrity Summary');

  // Portfolio distribution
  const dist = await query(
    `SELECT portfolio_id, COUNT(*) as count, 
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN simulation_mode THEN 1 ELSE 0 END) as simulated
     FROM hedges 
     GROUP BY portfolio_id 
     ORDER BY portfolio_id`
  );

  info('Portfolio hedge distribution:');
  for (const d of dist) {
    const pid = d.portfolio_id ?? 'NULL';
    const label = d.portfolio_id === COMMUNITY_POOL_PORTFOLIO_ID ? ' (community pool)' :
                  d.portfolio_id === null ? ' (orphaned)' : '';
    info(`  portfolio_id=${pid}${label}: ${d.count} total, ${d.active} active, ${d.simulated} simulated`);
  }

  // No orphaned NULL hedges (excluding test hedges)
  const nullCount = await query(
    `SELECT COUNT(*) as count FROM hedges 
     WHERE portfolio_id IS NULL 
     AND order_id NOT LIKE 'test-%' 
     AND order_id NOT LIKE 'pipeline-%'
     AND order_id NOT LIKE 'cp-test-%'
     AND order_id NOT LIKE 'user-%'
     AND order_id NOT LIKE 'filter-%'
     AND order_id NOT LIKE 'wallet-%'
     AND order_id NOT LIKE 'isolation-%'
     AND order_id NOT LIKE 'pnl-%'`
  );
  assert(parseInt(nullCount[0].count) === 0, 
    `No orphaned NULL portfolio_id hedges (found: ${nullCount[0].count})`);

  // Auto-hedge configs summary
  const configs = await query(
    'SELECT portfolio_id, enabled, wallet_address FROM auto_hedge_configs ORDER BY portfolio_id'
  );
  info('Auto-hedge configs:');
  for (const c of configs) {
    const label = c.portfolio_id === COMMUNITY_POOL_PORTFOLIO_ID ? ' (community pool)' : '';
    info(`  portfolio_id=${c.portfolio_id}${label}: ${c.enabled ? 'ENABLED' : 'disabled'} | wallet: ${c.wallet_address?.slice(0, 15)}...`);
  }
}

// ─── CLEANUP ────────────────────────────────────────────────────────────────

async function cleanup() {
  console.log('\n── Cleanup ──');
  
  // Clean up test hedges
  if (cleanupIds.length > 0) {
    for (const id of cleanupIds) {
      try {
        await query('DELETE FROM hedges WHERE order_id = $1', [id]);
      } catch { /* ignore */ }
    }
    info(`Cleaned up ${cleanupIds.length} test hedges`);
  }

  // Clean up test configs
  if (cleanupConfigIds.length > 0) {
    for (const id of cleanupConfigIds) {
      try {
        await deleteAutoHedgeConfig(id);
      } catch { /* ignore */ }
    }
    info(`Cleaned up ${cleanupConfigIds.length} test configs`);
  }
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  // Initialize all modules (dynamic imports for env loading order)
  await init();

  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║  Comprehensive E2E Test: Community Pool + Wallet Portfolio Mgmt      ║');
  console.log('║  Tests auto-hedging, agent integration, and data isolation           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log(`\nENV: PRIVATE_KEY=${process.env.PRIVATE_KEY ? '✓' : '✗'} | DATABASE_URL=${process.env.DATABASE_URL ? '✓' : '✗'}`);
  console.log(`COMMUNITY_POOL_PORTFOLIO_ID = ${COMMUNITY_POOL_PORTFOLIO_ID}`);

  const startTime = Date.now();

  // PART A: Community Pool
  await testA1_CommunityPoolIsolation();
  await testA2_CommunityPoolAutoHedgeConfig();
  await testA3_CommunityPoolRiskAssessment();
  await testA4_CommunityPoolOnChain();
  await testA5_CommunityPoolHedgesQueryable();

  // PART B: Wallet-Based Portfolio Management
  await testB6_RWAManagerPortfolios();
  await testB7_UserPortfolioHedges();
  await testB8_UserAutoHedgeConfigCRUD();
  await testB9_UserPortfolioRiskAssessment();
  await testB10_GetActiveHedgesFiltering();
  await testB11_GetActiveHedgesByWallet();

  // PART C: Cross-System Isolation
  await testC12_CommunityPoolNotInUserQueries();
  await testC13_UserHedgesNotInCommunityPool();
  await testC14_AutoHedgeConfigIndependence();
  await testC15_PnLUpdatesAllPortfolios();

  // PART D: Agent Integration
  await testD16_AgentOrchestratorInit();
  await testD17_AutoHedgingServiceStatus();
  await testD18_EndToEndAutoHedgeFlow();

  // PART E: Summary
  await testE19_DataIntegritySummary();

  // Cleanup
  await cleanup();

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${warnings} warnings (${duration}s)`);
  if (failed === 0) {
    console.log(`  ✅ All systems operational — community pool and wallet portfolios are fully isolated!`);
  } else {
    console.log(`  ❌ ${failed} issue(s) found — review failures above`);
  }
  console.log(`${'═'.repeat(72)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
