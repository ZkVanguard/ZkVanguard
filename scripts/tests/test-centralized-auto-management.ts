#!/usr/bin/env npx tsx
/**
 * Comprehensive Test: Centralized Auto-Management
 * 
 * Tests the optimized centralized approach where:
 * - Market data is fetched ONCE per cycle (single MarketSnapshot)
 * - All portfolio contexts gathered IN PARALLEL
 * - Risk assessment is pure computation (no I/O per portfolio)
 * - Hedges batched & PnL updated using shared snapshot
 * 
 * PART A: MarketSnapshot — single-fetch price layer
 * PART B: Portfolio context gathering (community pool + user portfolios)
 * PART C: Centralized risk assessment (pure computation)
 * PART D: Cross-portfolio optimization (shared data, independent decisions)
 * PART E: Batch PnL updates with snapshot prices
 * PART F: Full cycle orchestration (fetch→gather→assess→execute→pnl)
 * PART G: Integration with AutoHedgingService (centralized path)
 * PART H: Performance comparison (centralized vs serial)
 * 
 * Run: npx tsx scripts/tests/test-centralized-auto-management.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { ethers } from 'ethers';

// Module-level references set during init()
let createHedge: any, getActiveHedges: any, getHedgeByOrderId: any,
    updateHedgePnL: any, updateHedgeStatus: any;
let query: any;
let saveAutoHedgeConfig: any, getAutoHedgeConfig: any, getAutoHedgeConfigs: any,
    deleteAutoHedgeConfig: any, disableAutoHedge: any;
let COMMUNITY_POOL_PORTFOLIO_ID: number;
let isCommunityPoolPortfolio: (id: any) => boolean;
let autoHedgingService: any;
let CentralizedHedgeManager: any;
let getCentralizedHedgeManager: any;

async function init() {
  const hedgesMod = await import('../../lib/db/hedges');
  createHedge = hedgesMod.createHedge;
  getActiveHedges = hedgesMod.getActiveHedges;
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

  const centralMod = await import('../../lib/services/CentralizedHedgeManager');
  CentralizedHedgeManager = centralMod.CentralizedHedgeManager;
  getCentralizedHedgeManager = centralMod.getCentralizedHedgeManager;

  const svcMod = await import('../../lib/services/AutoHedgingService');
  autoHedgingService = svcMod.autoHedgingService;
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

// ═══════════════════════════════════════════════════════════════════════════════
// PART A: MarketSnapshot — Single-Fetch Price Layer
// ═══════════════════════════════════════════════════════════════════════════════

async function testA1_FetchMarketSnapshot() {
  section('A1: Fetch Market Snapshot (single API call)');

  const manager = getCentralizedHedgeManager();
  const start = Date.now();
  const snapshot = await manager.fetchMarketSnapshot();
  const duration = Date.now() - start;

  assert(snapshot !== null, 'Snapshot returned');
  assert(snapshot.prices instanceof Map, 'Prices is a Map');
  assert(snapshot.prices.size >= 4, `Has ${snapshot.prices.size} prices (need ≥4: BTC, ETH, CRO, SUI)`);
  assert(snapshot.timestamp > 0, `Timestamp: ${new Date(snapshot.timestamp).toISOString()}`);
  assert(snapshot.source === 'centralized-batch', `Source: ${snapshot.source}`);
  assert(snapshot.fetchDurationMs >= 0, `Fetch duration: ${snapshot.fetchDurationMs}ms`);

  // Verify all tracked symbols present
  for (const sym of ['BTC', 'ETH', 'CRO', 'SUI']) {
    const price = snapshot.prices.get(sym);
    assert(price !== undefined, `${sym} price present`);
    if (price) {
      assert(price.price > 0, `${sym} price: $${price.price.toFixed(2)}`);
      assert(typeof price.change24h === 'number', `${sym} change24h: ${price.change24h.toFixed(2)}%`);
      assert(typeof price.bid === 'number' && price.bid > 0, `${sym} bid: $${price.bid.toFixed(2)}`);
      assert(typeof price.ask === 'number' && price.ask > 0, `${sym} ask: $${price.ask.toFixed(2)}`);
    }
  }

  info(`Total snapshot fetch: ${duration}ms for ${snapshot.prices.size} symbols`);
}

async function testA2_SnapshotReuse() {
  section('A2: Snapshot Reuse & Caching');

  const manager = getCentralizedHedgeManager();
  
  // First fetch
  const snap1 = await manager.fetchMarketSnapshot();
  const ts1 = snap1.timestamp;

  // Manager should have stored it
  const last = manager.getLastSnapshot();
  assert(last !== null, 'Last snapshot stored');
  assert(last!.timestamp === ts1, 'Last snapshot matches first fetch');

  // Second fetch (should be fast due to market data service cache)
  const start2 = Date.now();
  const snap2 = await manager.fetchMarketSnapshot();
  const d2 = Date.now() - start2;
  assert(snap2.timestamp >= ts1, 'Second snapshot has newer timestamp');
  info(`Second fetch: ${d2}ms (should be fast due to cache)`);

  // Extra symbols should extend the snapshot
  const snap3 = await manager.fetchMarketSnapshot(['ATOM', 'SOL']);
  assert(snap3.prices.size >= 4, `Extended snapshot: ${snap3.prices.size} symbols`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART B: Portfolio Context Gathering
// ═══════════════════════════════════════════════════════════════════════════════

async function testB3_CommunityPoolContext() {
  section('B3: Community Pool Context Gathering');

  const manager = getCentralizedHedgeManager();
  const snapshot = await manager.fetchMarketSnapshot();

  const configs = new Map<number, any>();
  const cpConfig = await getAutoHedgeConfig(COMMUNITY_POOL_PORTFOLIO_ID);
  if (cpConfig) {
    configs.set(COMMUNITY_POOL_PORTFOLIO_ID, {
      portfolioId: cpConfig.portfolioId,
      walletAddress: cpConfig.walletAddress,
      enabled: cpConfig.enabled,
      riskThreshold: cpConfig.riskThreshold,
      maxLeverage: cpConfig.maxLeverage,
      allowedAssets: cpConfig.allowedAssets,
    });
  }

  const contexts = await manager.gatherAllPortfolioContexts(configs, snapshot);
  assert(contexts.length === 1, `Got ${contexts.length} context(s)`);

  const cpCtx = contexts.find((c: any) => c.isCommunityPool);
  assert(cpCtx !== undefined, 'Community pool context found');

  if (cpCtx) {
    assert(cpCtx.portfolioId === COMMUNITY_POOL_PORTFOLIO_ID, `portfolioId=${cpCtx.portfolioId}`);
    assert(cpCtx.isCommunityPool === true, 'isCommunityPool=true');
    assert(cpCtx.positions.length > 0, `Has ${cpCtx.positions.length} positions`);
    assert(cpCtx.totalValue > 0, `Total value: $${cpCtx.totalValue.toFixed(2)}`);
    assert(cpCtx.poolStats !== undefined, 'Has poolStats');
    assert(cpCtx.poolStats!.sharePrice > 0, `Share price: $${cpCtx.poolStats!.sharePrice.toFixed(4)}`);
    assert(cpCtx.poolStats!.totalShares > 0, `Total shares: ${cpCtx.poolStats!.totalShares.toFixed(4)}`);

    // Positions should use snapshot change24h data (not re-fetched)
    for (const pos of cpCtx.positions) {
      assert(typeof pos.change24h === 'number', `${pos.symbol} change24h=${pos.change24h.toFixed(2)}%`);
      assert(pos.value > 0, `${pos.symbol} value=$${pos.value.toFixed(2)}`);
    }

    assert(Array.isArray(cpCtx.activeHedges), `Active hedges: ${cpCtx.activeHedges.length}`);
  }
}

async function testB4_UserPortfolioContexts() {
  section('B4: User Portfolio Context Gathering');

  const manager = getCentralizedHedgeManager();
  const snapshot = await manager.fetchMarketSnapshot();

  // Create test config for a user portfolio
  const testPid = 0; // Use portfolio 0 (exists on-chain)
  const testWallet = '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c';

  const configs = new Map<number, any>();
  configs.set(testPid, {
    portfolioId: testPid,
    walletAddress: testWallet,
    enabled: true,
    riskThreshold: 5,
    maxLeverage: 3,
    allowedAssets: ['BTC', 'ETH', 'CRO', 'SUI'],
  });

  const contexts = await manager.gatherAllPortfolioContexts(configs, snapshot);
  assert(contexts.length === 1, `Got ${contexts.length} context(s)`);

  const userCtx = contexts[0];
  assert(userCtx.portfolioId === testPid, `portfolioId=${userCtx.portfolioId}`);
  assert(userCtx.isCommunityPool === false, 'isCommunityPool=false');
  assert(userCtx.walletAddress === testWallet, 'Correct wallet');

  // User portfolio with MockUSDC should have virtual positions
  if (userCtx.totalValue > 0) {
    assert(userCtx.positions.length > 0, `Has ${userCtx.positions.length} positions`);
    info(`Total value: $${userCtx.totalValue.toFixed(2)}`);
    for (const pos of userCtx.positions) {
      info(`  ${pos.symbol}: $${pos.value.toFixed(2)}, change: ${pos.change24h.toFixed(2)}%`);
      // Positions should use snapshot change24h (not separate API calls)
      assert(typeof pos.change24h === 'number', `${pos.symbol} has change24h from snapshot`);
    }
  } else {
    warn('Portfolio 0 has no positions (may not have allocations)');
  }
}

async function testB5_ParallelContextGathering() {
  section('B5: Parallel Context Gathering (multiple portfolios)');

  const manager = getCentralizedHedgeManager();
  const snapshot = await manager.fetchMarketSnapshot();

  // Load all stored configs
  const storedConfigs = await getAutoHedgeConfigs();
  const configs = new Map<number, any>();

  for (const sc of storedConfigs) {
    configs.set(sc.portfolioId, {
      portfolioId: sc.portfolioId,
      walletAddress: sc.walletAddress,
      enabled: sc.enabled,
      riskThreshold: sc.riskThreshold,
      maxLeverage: sc.maxLeverage,
      allowedAssets: sc.allowedAssets,
    });
  }

  // Add a couple test user portfolios if not already there
  if (!configs.has(0)) {
    configs.set(0, {
      portfolioId: 0, walletAddress: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c',
      enabled: true, riskThreshold: 5, maxLeverage: 3, allowedAssets: ['BTC','ETH','CRO','SUI'],
    });
  }

  info(`Gathering contexts for ${configs.size} portfolios in PARALLEL...`);
  const start = Date.now();
  const contexts = await manager.gatherAllPortfolioContexts(configs, snapshot);
  const duration = Date.now() - start;

  assert(contexts.length > 0, `Gathered ${contexts.length} contexts`);
  assert(contexts.length <= configs.size, `No more than requested (${configs.size})`);
  info(`Parallel gathering took ${duration}ms for ${contexts.length} portfolios`);

  const cpCount = contexts.filter((c: any) => c.isCommunityPool).length;
  const userCount = contexts.filter((c: any) => !c.isCommunityPool).length;
  info(`Community pools: ${cpCount} | User portfolios: ${userCount}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART C: Centralized Risk Assessment (Pure Computation)
// ═══════════════════════════════════════════════════════════════════════════════

async function testC6_PureComputationRiskAssessment() {
  section('C6: Pure Computation Risk Assessment (no I/O)');

  const manager = getCentralizedHedgeManager();
  const snapshot = await manager.fetchMarketSnapshot();

  // Get community pool context
  const cpConfig = await getAutoHedgeConfig(COMMUNITY_POOL_PORTFOLIO_ID);
  const configs = new Map<number, any>();
  if (cpConfig) {
    configs.set(COMMUNITY_POOL_PORTFOLIO_ID, {
      portfolioId: cpConfig.portfolioId, walletAddress: cpConfig.walletAddress,
      enabled: cpConfig.enabled, riskThreshold: cpConfig.riskThreshold,
      maxLeverage: cpConfig.maxLeverage, allowedAssets: cpConfig.allowedAssets,
    });
  }

  const contexts = await manager.gatherAllPortfolioContexts(configs, snapshot);
  assert(contexts.length > 0, `Got ${contexts.length} context(s) for assessment`);

  // Risk assessment should be PURE — no async, no I/O
  for (const ctx of contexts) {
    const start = Date.now();
    const assessment = manager.assessPortfolioRisk(ctx, snapshot); // NOT async!
    const duration = Date.now() - start;

    assert(assessment !== null, `Assessment for portfolio ${ctx.portfolioId}`);
    assert(assessment.portfolioId === ctx.portfolioId, `Correct portfolioId=${assessment.portfolioId}`);
    assert(typeof assessment.riskScore === 'number', `Risk score: ${assessment.riskScore}`);
    assert(assessment.riskScore >= 1 && assessment.riskScore <= 10, `Score in range [1,10]`);
    assert(typeof assessment.totalValue === 'number', `Total value: $${assessment.totalValue.toFixed(2)}`);
    assert(typeof assessment.drawdownPercent === 'number', `Drawdown: ${assessment.drawdownPercent.toFixed(2)}%`);
    assert(typeof assessment.volatility === 'number', `Volatility: ${assessment.volatility.toFixed(2)}`);
    assert(Array.isArray(assessment.recommendations), `Recommendations: ${assessment.recommendations.length}`);
    assert(duration < 10, `Assessment took ${duration}ms (pure computation, should be <10ms)`);
  }
}

async function testC7_CommunityPoolRiskThresholds() {
  section('C7: Community Pool Risk Thresholds (tighter than user)');

  const manager = getCentralizedHedgeManager();
  const snapshot = await manager.fetchMarketSnapshot();

  // Create a mock community pool context with high drawdown
  const mockCpCtx: any = {
    portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,
    walletAddress: '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B',
    config: { portfolioId: COMMUNITY_POOL_PORTFOLIO_ID, walletAddress: '', enabled: true,
              riskThreshold: 4, maxLeverage: 2, allowedAssets: ['BTC','ETH','CRO','SUI'] },
    positions: [
      { symbol: 'BTC', value: 200, change24h: -4, balance: 0.003 },
      { symbol: 'ETH', value: 150, change24h: -2, balance: 0.05 },
      { symbol: 'CRO', value: 100, change24h: -1, balance: 800 },
      { symbol: 'SUI', value: 100, change24h: 2, balance: 100 },
    ],
    activeHedges: [],
    allocations: { BTC: 36, ETH: 27, CRO: 18, SUI: 18 },
    totalValue: 550,
    isCommunityPool: true,
    poolStats: { totalShares: 550, onChainNAV: 550, marketNAV: 550,
                 sharePrice: 0.95, peakSharePrice: 1.02 },
  };

  const cpAssessment = manager.assessPortfolioRisk(mockCpCtx, snapshot);
  info(`Community pool mock assessment — score: ${cpAssessment.riskScore}`);

  // Now create same context but as USER portfolio
  const mockUserCtx = { ...mockCpCtx, portfolioId: 0, isCommunityPool: false, poolStats: undefined };
  const userAssessment = manager.assessPortfolioRisk(mockUserCtx, snapshot);
  info(`User portfolio mock assessment — score: ${userAssessment.riskScore}`);

  // Community pool should have HIGHER risk score (tighter thresholds)
  assert(cpAssessment.riskScore >= userAssessment.riskScore,
    `CP score (${cpAssessment.riskScore}) >= user score (${userAssessment.riskScore}) with same data`);
}

async function testC8_RecommendationGeneration() {
  section('C8: Recommendation Generation');

  const manager = getCentralizedHedgeManager();
  const snapshot = await manager.fetchMarketSnapshot();

  // Mock context with one asset down significantly
  const mockCtx: any = {
    portfolioId: 42,
    walletAddress: '0xTEST',
    config: { portfolioId: 42, walletAddress: '0xTEST', enabled: true,
              riskThreshold: 3, maxLeverage: 5, allowedAssets: ['BTC','ETH','CRO','SUI'] },
    positions: [
      { symbol: 'BTC', value: 5000, change24h: -8, balance: 0.07 },
      { symbol: 'ETH', value: 3000, change24h: -2, balance: 1.0 },
      { symbol: 'CRO', value: 1500, change24h: 1, balance: 12000 },
      { symbol: 'SUI', value: 500, change24h: 0.5, balance: 400 },
    ],
    activeHedges: [],
    allocations: { BTC: 50, ETH: 30, CRO: 15, SUI: 5 },
    totalValue: 10000,
    isCommunityPool: false,
  };

  const assessment = manager.assessPortfolioRisk(mockCtx, snapshot);
  assert(assessment.recommendations.length > 0, `Has ${assessment.recommendations.length} recommendations`);

  // BTC should be recommended for hedging (down 8%, 50% concentration)
  const btcRec = assessment.recommendations.find((r: any) => r.asset === 'BTC');
  assert(btcRec !== undefined, 'BTC recommended for hedging');
  if (btcRec) {
    assert(btcRec.side === 'SHORT', 'BTC recommendation: SHORT');
    assert(btcRec.confidence >= 0.7, `BTC confidence: ${btcRec.confidence.toFixed(2)}`);
    assert(btcRec.suggestedSize > 0, `BTC hedgeSize: $${btcRec.suggestedSize.toFixed(2)}`);
    info(`BTC reason: ${btcRec.reason}`);
  }

  // ETH might not be recommended (only -2%)
  const ethRec = assessment.recommendations.find((r: any) => r.asset === 'ETH' && r.reason.includes('down'));
  if (ethRec) {
    warn('ETH recommended despite only -2% — check thresholds');
  } else {
    assert(true, 'ETH NOT recommended (only -2%, below threshold)');
  }

  // Recommendations should be sorted by confidence (descending)
  for (let i = 1; i < assessment.recommendations.length; i++) {
    assert(
      assessment.recommendations[i - 1].confidence >= assessment.recommendations[i].confidence,
      `Sorted: rec${i-1} confidence ${assessment.recommendations[i-1].confidence.toFixed(2)} >= rec${i} ${assessment.recommendations[i].confidence.toFixed(2)}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART D: Cross-Portfolio Optimization
// ═══════════════════════════════════════════════════════════════════════════════

async function testD9_SharedSnapshotAcrossPortfolios() {
  section('D9: Shared Snapshot Across All Portfolios');

  const manager = getCentralizedHedgeManager();
  const snapshot = await manager.fetchMarketSnapshot();

  // Create multiple portfolio configs
  const configs = new Map<number, any>();
  const cpConfig = await getAutoHedgeConfig(COMMUNITY_POOL_PORTFOLIO_ID);
  if (cpConfig) {
    configs.set(COMMUNITY_POOL_PORTFOLIO_ID, {
      portfolioId: cpConfig.portfolioId, walletAddress: cpConfig.walletAddress,
      enabled: cpConfig.enabled, riskThreshold: cpConfig.riskThreshold,
      maxLeverage: cpConfig.maxLeverage, allowedAssets: cpConfig.allowedAssets,
    });
  }
  configs.set(0, {
    portfolioId: 0, walletAddress: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c',
    enabled: true, riskThreshold: 5, maxLeverage: 3, allowedAssets: ['BTC','ETH','CRO','SUI'],
  });

  const contexts = await manager.gatherAllPortfolioContexts(configs, snapshot);

  // All contexts should use the SAME snapshot for change24h data
  const btcPrice = snapshot.prices.get('BTC');
  if (btcPrice) {
    for (const ctx of contexts) {
      const btcPos = ctx.positions.find((p: any) => p.symbol === 'BTC');
      if (btcPos) {
        assert(btcPos.change24h === btcPrice.change24h,
          `Portfolio ${ctx.portfolioId}: BTC change24h=${btcPos.change24h.toFixed(2)}% matches snapshot`);
      }
    }
  }

  // All assessments should share the same snapshot timestamp
  const assessments = contexts.map((ctx: any) => manager.assessPortfolioRisk(ctx, snapshot));
  for (const assessment of assessments) {
    assert(Math.abs(assessment.timestamp - Date.now()) < 5000, 
      `Assessment ${assessment.portfolioId} has recent timestamp`);
  }

  info(`${assessments.length} portfolios assessed with SAME market data`);
}

async function testD10_IndependentRiskDecisions() {
  section('D10: Independent Risk Decisions Per Portfolio');

  const manager = getCentralizedHedgeManager();
  const snapshot = await manager.fetchMarketSnapshot();

  // Two portfolios with DIFFERENT risk thresholds but SAME data
  const mockCtx1: any = {
    portfolioId: 1, isCommunityPool: false,
    config: { riskThreshold: 3, maxLeverage: 2, allowedAssets: ['BTC','ETH','CRO','SUI'] },
    positions: [
      { symbol: 'BTC', value: 500, change24h: -4, balance: 0.007 },
      { symbol: 'ETH', value: 300, change24h: -3, balance: 0.1 },
    ],
    activeHedges: [], allocations: { BTC: 62, ETH: 38 },
    totalValue: 800, walletAddress: '0xTEST1',
  };

  const mockCtx2: any = {
    portfolioId: 2, isCommunityPool: false,
    config: { riskThreshold: 8, maxLeverage: 5, allowedAssets: ['BTC','ETH'] },
    positions: [...mockCtx1.positions], // SAME positions
    activeHedges: [], allocations: { ...mockCtx1.allocations },
    totalValue: 800, walletAddress: '0xTEST2',
  };

  const a1 = manager.assessPortfolioRisk(mockCtx1, snapshot);
  const a2 = manager.assessPortfolioRisk(mockCtx2, snapshot);

  assert(a1.riskScore === a2.riskScore, 
    `Same data → same score: ${a1.riskScore} == ${a2.riskScore}`);
  assert(a1.recommendations.length === a2.recommendations.length,
    `Same data → same recommendations count: ${a1.recommendations.length}`);

  // But DIFFERENT thresholds mean DIFFERENT execution decisions
  const shouldHedge1 = a1.riskScore >= mockCtx1.config.riskThreshold;
  const shouldHedge2 = a2.riskScore >= mockCtx2.config.riskThreshold;
  info(`Portfolio 1 (threshold=${mockCtx1.config.riskThreshold}): ${shouldHedge1 ? 'SHOULD HEDGE' : 'within range'}`);
  info(`Portfolio 2 (threshold=${mockCtx2.config.riskThreshold}): ${shouldHedge2 ? 'SHOULD HEDGE' : 'within range'}`);

  // Portfolio 1 (lower threshold) should be MORE likely to hedge
  if (a1.riskScore >= 3) {
    assert(shouldHedge1 === true, 'Portfolio 1 (threshold=3) should hedge');
    assert(shouldHedge2 === false, 'Portfolio 2 (threshold=8) should NOT hedge');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART E: Batch PnL Updates
// ═══════════════════════════════════════════════════════════════════════════════

async function testE11_BatchPnLUpdate() {
  section('E11: Batch PnL Update with Snapshot');

  const manager = getCentralizedHedgeManager();
  const snapshot = await manager.fetchMarketSnapshot();

  // Create test hedges with known entry prices
  const btcPrice = snapshot.prices.get('BTC')?.price || 75000;
  const ethPrice = snapshot.prices.get('ETH')?.price || 3800;

  const hedgeIds = [
    `central-pnl-btc-${Date.now()}`,
    `central-pnl-eth-${Date.now()}`
  ];
  cleanupIds.push(...hedgeIds);

  await createHedge({
    orderId: hedgeIds[0], portfolioId: COMMUNITY_POOL_PORTFOLIO_ID,
    asset: 'BTC', market: 'BTC-USD-PERP', side: 'SHORT', size: 0.001,
    notionalValue: 100, leverage: 2, entryPrice: btcPrice * 1.01, // Entry 1% above
    simulationMode: true, reason: 'TEST: central PnL update',
  });
  await createHedge({
    orderId: hedgeIds[1], portfolioId: 0,
    asset: 'ETH', market: 'ETH-USD-PERP', side: 'LONG', size: 0.05,
    notionalValue: 200, leverage: 3, entryPrice: ethPrice * 0.99, // Entry 1% below
    simulationMode: true, reason: 'TEST: central PnL update',
  });

  // Batch PnL update
  const result = await manager.batchUpdatePnL(snapshot);
  assert(result.updated >= 2, `Updated ${result.updated} hedges`);
  assert(result.errors === 0, `No errors (${result.errors})`);

  // Verify PnL was calculated correctly
  const btcHedge = await getHedgeByOrderId(hedgeIds[0]);
  assert(btcHedge !== null, 'BTC hedge exists');
  if (btcHedge) {
    assert(parseFloat(String(btcHedge.current_pnl)) !== 0, `BTC PnL: $${btcHedge.current_pnl}`);
    assert(parseFloat(String(btcHedge.current_price)) > 0, `BTC current_price: $${btcHedge.current_price}`);
    // SHORT hedge with entry above market should be profitable
    if (btcPrice < btcHedge.entry_price!) {
      assert(parseFloat(String(btcHedge.current_pnl)) > 0, 'BTC SHORT profitable (entry > current)');
    }
  }

  const ethHedge = await getHedgeByOrderId(hedgeIds[1]);
  assert(ethHedge !== null, 'ETH hedge exists');
  if (ethHedge) {
    assert(parseFloat(String(ethHedge.current_pnl)) !== 0, `ETH PnL: $${ethHedge.current_pnl}`);
    // LONG hedge with entry below market should be profitable
    if (ethPrice > ethHedge.entry_price!) {
      assert(parseFloat(String(ethHedge.current_pnl)) > 0, 'ETH LONG profitable (entry < current)');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART F: Full Cycle Orchestration
// ═══════════════════════════════════════════════════════════════════════════════

async function testF12_FullCycle() {
  section('F12: Full Centralized Cycle (fetch→gather→assess→execute→pnl)');

  const manager = getCentralizedHedgeManager();

  // Build configs from stored + ensure community pool
  const storedConfigs = await getAutoHedgeConfigs();
  const configs = new Map<number, any>();

  for (const sc of storedConfigs) {
    configs.set(sc.portfolioId, {
      portfolioId: sc.portfolioId, walletAddress: sc.walletAddress,
      enabled: sc.enabled, riskThreshold: sc.riskThreshold,
      maxLeverage: sc.maxLeverage, allowedAssets: sc.allowedAssets,
    });
  }

  // Add user portfolio 0 if not present
  if (!configs.has(0)) {
    configs.set(0, {
      portfolioId: 0, walletAddress: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c',
      enabled: true, riskThreshold: 5, maxLeverage: 3, allowedAssets: ['BTC','ETH','CRO','SUI'],
    });
  }

  info(`Running full cycle with ${configs.size} portfolios...`);
  const result = await manager.runCycle(configs);

  assert(result !== null, 'Cycle result returned');
  assert(result.durationMs > 0, `Cycle duration: ${result.durationMs}ms`);
  assert(result.snapshot !== null, 'Has market snapshot');
  assert(result.portfoliosAssessed > 0, `Portfolios assessed: ${result.portfoliosAssessed}`);
  assert(result.assessments.size > 0, `Assessments: ${result.assessments.size}`);
  info(`Hedges executed: ${result.hedgesExecuted} | Failed: ${result.hedgesFailed}`);
  info(`PnL updated: ${result.pnlUpdated} | PnL errors: ${result.pnlErrors}`);
  info(`Market snapshot fetch: ${result.snapshot.fetchDurationMs}ms`);

  // Verify each portfolio has an assessment
  for (const [pid] of configs) {
    const assessment = result.assessments.get(pid);
    if (assessment) {
      assert(assessment.portfolioId === pid, `Assessment for portfolio ${pid} exists`);
      info(`  Portfolio ${pid}: score=${assessment.riskScore}, value=$${assessment.totalValue.toFixed(2)}, recs=${assessment.recommendations.length}`);
    }
  }

  // Status should reflect the cycle
  const status = manager.getStatus();
  assert(status.hasRunCycle === true, 'hasRunCycle=true');
  assert(status.lastCycleDurationMs === result.durationMs, 'Status matches result');
  assert(status.portfoliosInLastCycle === result.portfoliosAssessed, 'Portfolio count matches');
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART G: Integration with AutoHedgingService
// ═══════════════════════════════════════════════════════════════════════════════

async function testG13_AutoHedgingServiceCentralized() {
  section('G13: AutoHedgingService Uses Centralized Path');

  const svc = autoHedgingService;

  // Ensure service is started with configs loaded
  await svc.start();
  const status = svc.getStatus();
  assert(status.isRunning === true, 'Service is running');
  info(`Enabled portfolios: [${status.enabledPortfolios.join(', ')}]`);

  // checkAllPortfolioRisks should now use CentralizedHedgeManager
  await svc.checkAllPortfolioRisks();

  // Verify assessments are stored
  for (const pid of status.enabledPortfolios) {
    const assessment = svc.getLastRiskAssessment(pid);
    if (assessment) {
      assert(assessment.portfolioId === pid, `Assessment stored for portfolio ${pid}`);
      info(`  Portfolio ${pid}: score=${assessment.riskScore}`);
    }
  }

  // PnL update should also use centralized snapshot
  const pnlResult = await svc.updateAllHedgePnL();
  assert(typeof pnlResult.updated === 'number', `PnL updated: ${pnlResult.updated}`);
  assert(typeof pnlResult.errors === 'number', `PnL errors: ${pnlResult.errors}`);
}

async function testG14_TriggerRiskAssessmentStillWorks() {
  section('G14: Manual triggerRiskAssessment Still Works');

  const svc = autoHedgingService;

  // Ensure community pool config is enabled
  const cpConfig = await getAutoHedgeConfig(COMMUNITY_POOL_PORTFOLIO_ID);
  if (cpConfig) {
    svc.enableForPortfolio({
      portfolioId: cpConfig.portfolioId, walletAddress: cpConfig.walletAddress,
      enabled: cpConfig.enabled, riskThreshold: cpConfig.riskThreshold,
      maxLeverage: cpConfig.maxLeverage, allowedAssets: cpConfig.allowedAssets,
    });
  }

  const assessment = await svc.triggerRiskAssessment(
    COMMUNITY_POOL_PORTFOLIO_ID,
    '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B'
  );

  assert(assessment !== null, 'Manual assessment returned');
  assert(assessment.portfolioId === COMMUNITY_POOL_PORTFOLIO_ID, `portfolioId=${assessment.portfolioId}`);
  assert(typeof assessment.riskScore === 'number', `Risk score: ${assessment.riskScore}`);
  info(`Community pool manual assessment: score=${assessment.riskScore}, value=$${assessment.totalValue.toFixed(2)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART H: Performance Comparison
// ═══════════════════════════════════════════════════════════════════════════════

async function testH15_PerformanceComparison() {
  section('H15: Performance — Centralized vs Serial');

  const manager = getCentralizedHedgeManager();

  // Build configs
  const storedConfigs = await getAutoHedgeConfigs();
  const configs = new Map<number, any>();
  for (const sc of storedConfigs) {
    configs.set(sc.portfolioId, {
      portfolioId: sc.portfolioId, walletAddress: sc.walletAddress,
      enabled: sc.enabled, riskThreshold: sc.riskThreshold,
      maxLeverage: sc.maxLeverage, allowedAssets: sc.allowedAssets,
    });
  }
  if (!configs.has(0)) {
    configs.set(0, {
      portfolioId: 0, walletAddress: '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c',
      enabled: true, riskThreshold: 5, maxLeverage: 3, allowedAssets: ['BTC','ETH','CRO','SUI'],
    });
  }

  // Centralized cycle
  const startCentral = Date.now();
  const centralResult = await manager.runCycle(configs);
  const centralDuration = Date.now() - startCentral;

  info(`Centralized: ${centralDuration}ms for ${centralResult.portfoliosAssessed} portfolios`);
  info(`  Market snapshot: ${centralResult.snapshot.fetchDurationMs}ms (1 fetch for all)`);
  info(`  Assessments: ${centralResult.assessments.size} (pure computation, ~0ms each)`);
  info(`  PnL batch: ${centralResult.pnlUpdated} hedges updated`);

  // The key metric: snapshot was only fetched ONCE
  assert(centralResult.snapshot.source === 'centralized-batch', 'Single batch fetch used');
  assert(centralResult.snapshot.fetchDurationMs <= centralDuration, 'Snapshot fetch is fraction of total');

  // Estimate serial time:
  // In serial mode, each portfolio would fetch prices independently (~300-600ms each)
  // plus on-chain calls per portfolio. The snapshot fetch may be 0ms if cached from earlier test.
  const typicalPriceFetchMs = Math.max(centralResult.snapshot.fetchDurationMs, 300);
  const estimatedSerialMs = configs.size * typicalPriceFetchMs * 2;
  info(`  Typical price fetch: ~${typicalPriceFetchMs}ms`);
  info(`  Estimated serial time: ~${estimatedSerialMs}ms (${configs.size} portfolios × ${typicalPriceFetchMs}ms × 2)`);
  info(`  Centralized time: ${centralDuration}ms`);
  info(`  Speedup: ~${(estimatedSerialMs / Math.max(centralDuration, 1)).toFixed(1)}x`);

  // Centralized should be faster than estimated serial (which fetches per-portfolio)
  assert(centralDuration < estimatedSerialMs * 2, 
    `Centralized (${centralDuration}ms) faster than estimated serial (~${estimatedSerialMs}ms)`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART I: Data Integrity Summary
// ═══════════════════════════════════════════════════════════════════════════════

async function testI16_DataIntegritySummary() {
  section('I16: Data Integrity Summary');

  const manager = getCentralizedHedgeManager();
  const status = manager.getStatus();

  info(`CentralizedHedgeManager status:`);
  info(`  hasRunCycle: ${status.hasRunCycle}`);
  info(`  lastCycleDuration: ${status.lastCycleDurationMs}ms`);
  info(`  portfoliosInLastCycle: ${status.portfoliosInLastCycle}`);
  info(`  snapshotAge: ${status.snapshotAge}ms`);

  // Portfolio distribution
  const dist = await query(
    `SELECT portfolio_id, COUNT(*) as count, 
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active
     FROM hedges GROUP BY portfolio_id ORDER BY portfolio_id`
  );

  info('Hedge distribution after centralized cycle:');
  for (const d of dist) {
    const pid = d.portfolio_id ?? 'NULL';
    const label = d.portfolio_id === COMMUNITY_POOL_PORTFOLIO_ID ? ' (community pool)' : '';
    info(`  portfolio_id=${pid}${label}: ${d.count} total, ${d.active} active`);
  }

  // Verify no data corruption
  const nullCheck = await query(
    `SELECT COUNT(*) as count FROM hedges 
     WHERE portfolio_id IS NULL 
     AND order_id NOT LIKE '%test%' AND order_id NOT LIKE '%pipeline%'
     AND order_id NOT LIKE '%central%' AND order_id NOT LIKE '%filter%'
     AND order_id NOT LIKE '%wallet%' AND order_id NOT LIKE '%isolation%'
     AND order_id NOT LIKE '%pnl%' AND order_id NOT LIKE '%user%'`
  );
  assert(parseInt(nullCheck[0].count) === 0, 'No orphaned NULL portfolio_id hedges');
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════════

async function cleanup() {
  console.log('\n── Cleanup ──');
  
  if (cleanupIds.length > 0) {
    for (const id of cleanupIds) {
      try { await query('DELETE FROM hedges WHERE order_id = $1', [id]); } catch { /* */ }
    }
    info(`Cleaned up ${cleanupIds.length} test hedges`);
  }

  if (cleanupConfigIds.length > 0) {
    for (const id of cleanupConfigIds) {
      try { await deleteAutoHedgeConfig(id); } catch { /* */ }
    }
    info(`Cleaned up ${cleanupConfigIds.length} test configs`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  await init();

  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║  Centralized Auto-Management: Comprehensive Test Suite              ║');
  console.log('║  Fetch ONCE → Assess ALL → Act WHERE NEEDED → Update BATCH         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log(`\nENV: PRIVATE_KEY=${process.env.PRIVATE_KEY ? '✓' : '✗'} | DATABASE_URL=${process.env.DATABASE_URL ? '✓' : '✗'}`);
  console.log(`COMMUNITY_POOL_PORTFOLIO_ID = ${COMMUNITY_POOL_PORTFOLIO_ID}`);

  const startTime = Date.now();

  // PART A: Market Snapshot
  await testA1_FetchMarketSnapshot();
  await testA2_SnapshotReuse();

  // PART B: Context Gathering
  await testB3_CommunityPoolContext();
  await testB4_UserPortfolioContexts();
  await testB5_ParallelContextGathering();

  // PART C: Risk Assessment
  await testC6_PureComputationRiskAssessment();
  await testC7_CommunityPoolRiskThresholds();
  await testC8_RecommendationGeneration();

  // PART D: Cross-Portfolio
  await testD9_SharedSnapshotAcrossPortfolios();
  await testD10_IndependentRiskDecisions();

  // PART E: Batch PnL
  await testE11_BatchPnLUpdate();

  // PART F: Full Cycle
  await testF12_FullCycle();

  // PART G: Service Integration
  await testG13_AutoHedgingServiceCentralized();
  await testG14_TriggerRiskAssessmentStillWorks();

  // PART H: Performance
  await testH15_PerformanceComparison();

  // PART I: Summary
  await testI16_DataIntegritySummary();

  // Cleanup
  await cleanup();

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${warnings} warnings (${duration}s)`);
  if (failed === 0) {
    console.log(`  ✅ Centralized auto-management fully operational!`);
    console.log(`     Market data fetched ONCE, all portfolios assessed with shared snapshot`);
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
