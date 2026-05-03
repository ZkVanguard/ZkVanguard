/**
 * Cron Job: SUI Community Pool AI Management (USDC)
 * 
 * Invoked by Upstash QStash every 30 minutes to:
 * 1. Fetch SUI pool on-chain stats (USDC balance, shares, members)
 * 2. Record NAV snapshot with 4-asset allocation tracking
 * 3. Sync member data from on-chain → DB
 * 4. Run AI allocation decision (BTC/ETH/SUI)
 * 5. Trigger auto-hedge via BlueFin when risk is elevated
 * 
 * 3 Assets: BTC, ETH, SUI
 * Deposit token: USDC on SUI
 * 
 * Security: QStash signature verification + CRON_SECRET fallback
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { getSuiUsdcPoolService, validateSuiMainnetConfig, SUI_USDC_POOL_CONFIG, SUI_USDC_COIN_TYPE } from '@/lib/services/sui/SuiCommunityPoolService';
import {
  initCommunityPoolTables,
  recordNavSnapshot,
  saveUserSharesToDb,
  savePoolStateToDb,
  addPoolTransactionToDb,
} from '@/lib/db/community-pool';
import { query } from '@/lib/db/postgres';
import { getMultiSourceValidatedPrice } from '@/lib/services/market-data/unified-price-provider';
import { getBluefinAggregatorService, type PoolAsset as BluefinPoolAsset } from '@/lib/services/sui/BluefinAggregatorService';
import { getSuiPoolAgent, type AllocationDecision } from '@/agents/specialized/SuiPoolAgent';
import { getAutoHedgeConfigs } from '@/lib/storage/auto-hedge-storage';
import { BluefinService } from '@/lib/services/sui/BluefinService';
import { bluefinTreasury } from '@/lib/services/sui/BluefinTreasuryService';
import { SUI_COMMUNITY_POOL_PORTFOLIO_ID, isSuiCommunityPool } from '@/lib/constants';
import { createHedge } from '@/lib/db/hedges';
import {
  tryClaimCronRun,
  setCronHalt,
  getCronHalt,
  endOfUtcDayMs,
} from '@/lib/db/cron-state';
import {
  safeLeverage,
  buildDecisionToken,
  isPriceFreshEnough,
  computeSafeCollateralUsd,
  type QualifiedSignal,
} from '@/lib/services/hedging/calibration';
import { microUsdcToUsdNumber } from '@/lib/services/sui/safe-bigint';
import {
  POOL_ASSETS,
  type PoolAsset,
} from '@/lib/services/sui/cron/allocation';
import {
  HEDGE_MIN_OPEN_USDC,
  returnUsdcToPool,
  getActiveHedges,
  settleActiveHedges,
  replenishAdminUsdc,
  transferUsdcFromPoolToAdmin,
  getAdminUsdcBalance,
} from '@/lib/services/sui/cron/hedge-treasury';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Rate limiting: prevent duplicate cron runs within 5 minutes.
// `lastSuccessfulRunTimestamp` is per-instance and survives only within a
// single Vercel container. The authoritative cluster-wide rate-limit lives
// in Postgres via `tryClaimCronRun(...)`. The in-memory copy is a cheap
// short-circuit for the common case where the same instance handles the
// next QStash delivery.
let lastSuccessfulRunTimestamp = 0;
const MIN_CRON_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CRON_SINGLETON_ID = 'sui-community-pool';

// ── Hedge decision idempotency (5-min sliding window per {asset, side, risk-bucket}) ──
// Prevents duplicate Bluefin orders if cron clock skews and fires twice in
// the same risk window. Cleared on process restart (Vercel cold start).
const recentHedgeTokens: Map<string, number> = new Map();
const HEDGE_TOKEN_TTL_MS = 5 * 60 * 1000;

// Slippage tolerance for market orders. Anything beyond this between
// the price we sized against and Bluefin's last trade abort the order.
const HEDGE_MAX_SLIPPAGE_PCT = 0.5; // 0.5%

// 3 pool assets (BTC, ETH, SUI) — defined in `lib/services/sui/cron/allocation.ts`
// and re-exported via the imports above.

interface SuiCronResult {
  success: boolean;
  chain: 'sui';
  poolStats?: {
    totalNAV_USDC: string;
    totalShares: string;
    sharePrice: string;
    memberCount: number;
    allocations: Record<PoolAsset, number>;
  };
  aiDecision?: {
    action: string;
    allocations: Record<PoolAsset, number>;
    confidence: number;
    reasoning: string;
    swappableAssets?: string[];
    hedgedAssets?: string[];
    riskScore?: number;
  };
  riskScore?: number;
  pricesUSD?: Record<string, number>;
  autoHedge?: {
    triggered: boolean;
    hedges?: Array<{
      symbol: string;
      side: string;
      size: number;
      status: string;
      orderId?: string;
      error?: string;
    }>;
  };
  rebalanceSwaps?: {
    planned: number;
    executable: number;
    quotes: Array<{
      asset: string;
      amountInUsdc: string;
      expectedOut: string;
      route: string;
      canSwap: boolean;
    }>;
    simulated?: number;
    swappableAssets?: string[];
    hedgedAssets?: string[];
    executed?: number;
    failed?: number;
    txDigests?: Array<{ asset: string; digest: string }>;
  };
  /** Operator wallet gas state — surfaced so the UI can warn users when low */
  operatorGas?: {
    address?: string;
    suiBalance: string;
    gasFloorSui: number;
    sufficient: boolean;
  };
  /** Three-layer reconciliation result — DB ↔ on-chain ↔ Bluefin */
  reconciliation?: {
    onchainOrphans: number;
    dbOrphans: number;
    healed: number;
  };
  duration: number;
  error?: string;
}

// ============================================================================
// AI Allocation Engine � extracted to `lib/services/sui/cron/allocation.ts`
// (`fetchMarketIndicators`, `generateAllocation`, `AssetIndicator`, `POOL_ASSETS`)
// ============================================================================

// ============================================================================
// Pool ? Admin USDC Transfers � extracted to `lib/services/sui/cron/hedge-treasury.ts`
// (`returnUsdcToPool`, `getActiveHedges`, `settleActiveHedges`,
//  `replenishAdminUsdc`, `transferUsdcFromPoolToAdmin`,
//  `getAdminUsdcBalance`, `HEDGE_MIN_OPEN_USDC`)
// ============================================================================

// ============================================================================
// GET Handler — QStash / Vercel Cron
// ============================================================================

export async function GET(request: NextRequest): Promise<NextResponse<SuiCronResult>> {
  const startTime = Date.now();

  // Verify QStash signature or CRON_SECRET
  const authResult = await verifyCronRequest(request, 'SUI CommunityPool Cron');
  if (authResult !== true) {
    return NextResponse.json(
      { success: false, chain: 'sui', error: 'Unauthorized', duration: Date.now() - startTime },
      { status: 401 }
    );
  }

  const network = ((process.env.SUI_NETWORK || 'testnet').trim()) as 'mainnet' | 'testnet';
  logger.info('[SUI Cron] Starting SUI community pool AI management', { network });

  // MAINNET SAFETY: Reject if contract addresses not configured
  if (network === 'mainnet') {
    const missing = validateSuiMainnetConfig();
    if (missing.length > 0) {
      logger.error('[SUI Cron] MAINNET CONFIG INCOMPLETE — aborting cron', { missing });
      return NextResponse.json(
        { success: false, chain: 'sui' as const, error: `Mainnet not configured. Missing: ${missing.join(', ')}`, duration: Date.now() - startTime },
        { status: 503 }
      );
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // STAGE 1 — Per-instance in-memory rate limit (cheap, hot-path short-circuit)
  // ════════════════════════════════════════════════════════════════════════
  const timeSinceLastRun = startTime - lastSuccessfulRunTimestamp;
  if (lastSuccessfulRunTimestamp > 0 && timeSinceLastRun < MIN_CRON_INTERVAL_MS) {
    logger.warn('[SUI Cron] Rate limited (in-memory) — too soon since last run', {
      secondsSinceLast: Math.round(timeSinceLastRun / 1000),
      minIntervalSeconds: MIN_CRON_INTERVAL_MS / 1000,
    });
    return NextResponse.json(
      { success: false, chain: 'sui' as const, error: `Rate limited. Last run ${Math.round(timeSinceLastRun / 1000)}s ago, min interval is ${MIN_CRON_INTERVAL_MS / 1000}s`, duration: Date.now() - startTime },
      { status: 429 }
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // STAGE 2 — Cluster-wide CAS via Postgres. The in-memory check above only
  // protects the SAME Vercel instance; QStash retries can land on a fresh
  // cold-start which has `lastSuccessfulRunTimestamp = 0`. The Postgres CAS
  // is the authoritative singleton that survives instance churn.
  // ════════════════════════════════════════════════════════════════════════
  try {
    const claim = await tryClaimCronRun(CRON_SINGLETON_ID, MIN_CRON_INTERVAL_MS, startTime);
    if (!claim.claimed) {
      logger.warn('[SUI Cron] Rate limited (cluster CAS) — concurrent or recent run', {
        reason: claim.reason,
        lastRunMs: claim.lastRunMs,
        gapMs: claim.lastRunMs ? startTime - claim.lastRunMs : null,
      });
      return NextResponse.json(
        { success: false, chain: 'sui' as const, error: `Cluster rate-limit: ${claim.reason}`, duration: Date.now() - startTime },
        { status: 429 }
      );
    }
  } catch (claimErr) {
    // Fail-closed: if we can't claim the cluster lock, we cannot guarantee
    // we're the only running instance — refuse to proceed with state-mutating work.
    logger.error('[SUI Cron] tryClaimCronRun failed — refusing to run (fail-closed)', {
      error: claimErr instanceof Error ? claimErr.message : String(claimErr),
    });
    return NextResponse.json(
      { success: false, chain: 'sui' as const, error: 'Cluster lock unavailable — fail-closed', duration: Date.now() - startTime },
      { status: 503 }
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // STAGE 3 — Daily-loss circuit breaker. If a previous run tripped the
  // daily-loss cap, `setCronHalt` will have written a halt-until timestamp.
  // We honour that across instances (DB-backed) until UTC end-of-day.
  // ════════════════════════════════════════════════════════════════════════
  try {
    const halt = await getCronHalt(CRON_SINGLETON_ID, startTime);
    if (halt) {
      logger.warn('[SUI Cron] Halted by daily-loss circuit breaker', halt);
      return NextResponse.json(
        { success: false, chain: 'sui' as const, error: `Halted: ${halt.reason} until ${new Date(halt.untilMs).toISOString()}`, duration: Date.now() - startTime },
        { status: 503 }
      );
    }
  } catch (haltErr) {
    // getCronHalt fails-closed internally with a 60s synthetic halt; if it
    // throws here that's a bug — log and proceed (don't permanently block
    // the cron on a transient query bug).
    logger.error('[SUI Cron] getCronHalt threw — proceeding', {
      error: haltErr instanceof Error ? haltErr.message : String(haltErr),
    });
  }

  try {
    // M3: Validate admin key format early (fail-fast, not during swap execution)
    const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
    if (adminKey) {
      // Reject if someone accidentally set a wallet address (0x + 64 hex) instead of a private key
      // A proper key is either bech32 (suiprivkey...) or will derive a DIFFERENT address than its own hex
      if (!adminKey.startsWith('suiprivkey') && /^0x[0-9a-fA-F]{64}$/.test(adminKey)) {
        // Could be hex key OR an address — derive and check
        try {
          const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
          const kp = Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.slice(2), 'hex'));
          const derived = kp.getPublicKey().toSuiAddress();
          if (derived !== adminKey) {
            // Valid hex key — derives to a different address (expected)
            logger.info('[SUI Cron] Admin key validated', { derivedWallet: derived.slice(0, 16) + '...' });
          }
          // If derived === adminKey, that would be astronomically unlikely for a real key
          // but we don't block it since the key format is technically valid
        } catch {
          logger.error('[SUI Cron] Invalid SUI_POOL_ADMIN_KEY — cannot derive keypair from hex');
          return NextResponse.json(
            { success: false, chain: 'sui' as const, error: 'Invalid SUI_POOL_ADMIN_KEY — failed to derive keypair', duration: Date.now() - startTime },
            { status: 503 }
          );
        }
      } else if (!adminKey.startsWith('suiprivkey')) {
        const isValidHex = /^[0-9a-fA-F]{64}$/.test(adminKey);
        if (!isValidHex) {
          logger.error('[SUI Cron] Invalid SUI_POOL_ADMIN_KEY format — must be suiprivkey... or 64-char hex');
          return NextResponse.json(
            { success: false, chain: 'sui' as const, error: 'Invalid SUI_POOL_ADMIN_KEY format', duration: Date.now() - startTime },
            { status: 503 }
          );
        }
      }
    }

    // Step 0: Ensure DB tables exist
    await initCommunityPoolTables();

    // Step 0.5: Three-layer reconciliation — heal sync gaps between
    //   (a) on-chain Move active_hedges
    //   (b) DB hedges table (chain='sui', on_chain=true)
    //   (c) Bluefin perp positions (handled by stale-close path later)
    //
    // For each on-chain hedge with no DB row, insert a synthetic row.
    // For each DB row whose hedge_id_onchain is no longer in active_hedges,
    // mark it closed with realized_pnl=0 (best effort; the originating
    // close_hedge tx may have happened in a prior cycle and been logged then).
    let reconciliation: { onchainOrphans: number; dbOrphans: number; healed: number } | undefined;
    try {
      const onchain = await getActiveHedges(network);
      const { listActiveSuiOnchainHedges, recordSuiOnchainHedge, closeHedgeByOnchainId } =
        await import('@/lib/db/hedges');
      const dbActive = await listActiveSuiOnchainHedges();
      const onchainIds = new Set(
        onchain.map(h => Buffer.from(h.hedgeId).toString('hex')),
      );
      const dbIds = new Set(
        dbActive
          .map(d => (d.hedgeIdOnchain || '').replace(/^0x/, '').toLowerCase())
          .filter(Boolean),
      );

      let healed = 0;
      // (a) on-chain orphans → insert DB row so monitor sees them
      for (const h of onchain) {
        const hex = Buffer.from(h.hedgeId).toString('hex');
        if (!dbIds.has(hex.toLowerCase())) {
          const r = await recordSuiOnchainHedge({
            hedgeIdOnchain: hex,
            collateralUsdc: h.collateralUsdc,
            pairIndex: h.pairIndex,
            isLong: true,
            leverage: 1,
            txDigest: 'reconcile-on-chain',
            reason: 'Reconciler: on-chain hedge present without DB row',
          });
          if (r.inserted) healed++;
        }
      }
      // (b) DB orphans → mark closed (on-chain has already settled them)
      for (const d of dbActive) {
        const id = (d.hedgeIdOnchain || '').replace(/^0x/, '').toLowerCase();
        if (id && !onchainIds.has(id)) {
          const r = await closeHedgeByOnchainId({
            hedgeIdOnchain: id,
            realizedPnl: 0,
            status: 'closed',
          });
          if (r.updated > 0) healed++;
        }
      }

      const onchainOrphans = onchain.filter(h => !dbIds.has(Buffer.from(h.hedgeId).toString('hex').toLowerCase())).length;
      const dbOrphans = dbActive.filter(d => {
        const id = (d.hedgeIdOnchain || '').replace(/^0x/, '').toLowerCase();
        return id && !onchainIds.has(id);
      }).length;
      reconciliation = { onchainOrphans, dbOrphans, healed };
      if (onchainOrphans + dbOrphans > 0 || healed > 0) {
        logger.info('[SUI Cron] Step 0.5 reconciliation', reconciliation);
      }

      // (c) Bluefin perp positions ↔ DB perp rows.
      // Surface drift but do NOT auto-close — a live position with PnL is
      // valuable; we want a DB row to monitor it, not premature liquidation.
      try {
        const bluefinKey = (process.env.BLUEFIN_PRIVATE_KEY || process.env.SUI_POOL_ADMIN_KEY || '').trim();
        if (bluefinKey) {
          const bf = BluefinService.getInstance();
          if (!bf.isInitialized()) await bf.initialize(bluefinKey, network);
          const livePerps = await bf.getPositions();

          if (livePerps.length > 0) {
            const { query } = await import('@/lib/db/postgres');
            // NOTE: query() returns rows[] directly (not { rows: [...] }).
            // Earlier code mis-typed the result and treated dbPerpKeys as
            // always-empty, causing the reconciler to insert a fresh
            // BF_RECONCILE_* row every 30-min cron cycle for the SAME live
            // Bluefin position (118 phantom rows observed for 1 real perp).
            const dbPerpRows = await query<{ market: string; side: string }>(
              `SELECT order_id, market, side FROM hedges
                WHERE chain='sui' AND (on_chain=false OR on_chain IS NULL)
                  AND status='active'`,
              [],
            );
            const dbPerpKeys = new Set(
              (dbPerpRows || []).map(r => `${r.market}|${r.side}`),
            );
            const perpOrphans = livePerps.filter(p => !dbPerpKeys.has(`${p.symbol}|${p.side}`));
            if (perpOrphans.length > 0) {
              logger.warn('[SUI Cron] Bluefin perp orphans (live position, no DB row)', {
                count: perpOrphans.length,
                positions: perpOrphans.map(p => ({
                  symbol: p.symbol,
                  side: p.side,
                  size: p.size,
                  entry: p.entryPrice,
                  pnl: p.unrealizedPnl,
                })),
              });
              // Insert tracking rows so hedge-monitor can watch them.
              const { createHedge } = await import('@/lib/db/hedges');
              for (const p of perpOrphans) {
                try {
                  const orderId = `BF_RECONCILE_${p.symbol}_${p.side}_${Date.now()}`;
                  await createHedge({
                    orderId,
                    portfolioId: SUI_COMMUNITY_POOL_PORTFOLIO_ID,
                    walletAddress: bf.getAddress() || '',
                    asset: p.symbol.replace('-PERP', '') as PoolAsset,
                    market: p.symbol,
                    side: p.side as 'LONG' | 'SHORT',
                    size: p.size,
                    notionalValue: p.size * p.entryPrice,
                    leverage: p.leverage,
                    entryPrice: p.entryPrice,
                    simulationMode: false,
                    chain: 'sui',
                    reason: 'Reconciler: Bluefin orphan perp adopted into DB',
                  });
                  reconciliation.healed++;
                } catch (insErr) {
                  logger.warn('[SUI Cron] Failed to adopt Bluefin orphan', {
                    symbol: p.symbol,
                    error: insErr instanceof Error ? insErr.message : String(insErr),
                  });
                }
              }
            }
          }
        }
      } catch (bfRecErr) {
        logger.warn('[SUI Cron] Bluefin reconciliation skipped', {
          error: bfRecErr instanceof Error ? bfRecErr.message : String(bfRecErr),
        });
      }
    } catch (recErr) {
      logger.warn('[SUI Cron] Reconciliation step failed (non-fatal)', {
        error: recErr instanceof Error ? recErr.message : String(recErr),
      });
    }

    // Step 1: Fetch on-chain SUI pool stats
    const suiService = getSuiUsdcPoolService(network);
    const poolStats = await suiService.getPoolStats();

    logger.info('[SUI Cron] Pool stats fetched', {
      totalNAV: poolStats.totalNAV,
      totalNAVUsd: poolStats.totalNAVUsd,
      members: poolStats.memberCount,
      sharePrice: poolStats.sharePrice,
    });

    // Step 2: Fetch live prices for all 4 assets
    const pricesUSD: Record<string, number> = {};
    let pricesFetched = false;
    try {
      const results = await Promise.allSettled(
        POOL_ASSETS.map(async (asset) => {
          const validated = await getMultiSourceValidatedPrice(asset);
          return { asset, price: validated.price };
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          pricesUSD[r.value.asset] = r.value.price;
        }
      }
      pricesFetched = Object.keys(pricesUSD).length === POOL_ASSETS.length;
      logger.info('[SUI Cron] Prices fetched', pricesUSD);
    } catch (priceErr) {
      logger.error('[SUI Cron] Price fetch failed - aborting allocation decisions', { error: priceErr });
      return NextResponse.json({
        success: false,
        chain: 'sui' as const,
        duration: Date.now() - startTime,
        error: 'Price fetch failed - cannot make allocation decisions without prices',
      }, { status: 500 });
    }

    if (!pricesFetched) {
      logger.error('[SUI Cron] Incomplete prices - only got prices for: ' + Object.keys(pricesUSD).join(', '));
      return NextResponse.json({
        success: false,
        chain: 'sui' as const,
        duration: Date.now() - startTime,
        error: `Incomplete price data: got ${Object.keys(pricesUSD).length}/${POOL_ASSETS.length} prices`,
      }, { status: 500 });
    }

    // Step 3: Get AI allocation decision via SuiPoolAgent
    // Uses enhanced pipeline: prediction markets + risk cascade + sentiment + correlation
    const suiAgent = getSuiPoolAgent(network);

    // Fetch current allocations from last AI decision in DB (no hardcoded defaults)
    const currentAllocations: Record<string, number> = {
      BTC: 0,
      ETH: 0,
      SUI: 0,
    };
    try {
      const lastDecisions = await query(
        `SELECT details FROM community_pool_transactions 
         WHERE type = 'AI_DECISION' AND details->>'chain' = 'sui'
         ORDER BY created_at DESC LIMIT 1`
      ) as Array<{ details: Record<string, unknown> }>;
      if (lastDecisions.length > 0 && lastDecisions[0].details?.allocations) {
        const saved = lastDecisions[0].details.allocations as Record<string, number>;
        for (const asset of POOL_ASSETS) {
          if (typeof saved[asset] === 'number') {
            currentAllocations[asset] = saved[asset];
          }
        }
        logger.info('[SUI Cron] Loaded last AI allocations from DB', currentAllocations);
      } else {
        logger.info('[SUI Cron] No previous AI decision found, using zero allocations (first run)');
      }
    } catch (allocErr) {
      logger.warn('[SUI Cron] Could not load previous allocations from DB', { error: allocErr });
    }

    // Try enhanced allocation (prediction markets + AI intelligence) first,
    // fall back to basic allocation if external APIs are unavailable
    let aiResult: AllocationDecision;
    let enhancedContext: {
      marketSentiment?: string;
      recommendations?: string[];
      riskAlerts?: string[];
      correlationInsight?: string;
      predictionSignals?: Array<{ market: string; signal: string; probability: number }>;
      urgency?: string;
    } = {};

    try {
      const enhanced = await suiAgent.getEnhancedAllocationContext();

      // Pull live 5-min Polymarket signal (high-accuracy crowd-sourced BTC direction).
      // Strong directional signals from prediction markets justify acting even on small drift.
      let fiveMinSignal: { direction: 'UP' | 'DOWN'; confidence: number; signalStrength: 'STRONG' | 'MODERATE' | 'WEAK' } | null = null;
      try {
        const { Polymarket5MinService } = await import('@/lib/services/market-data/Polymarket5MinService');
        const sig = await Polymarket5MinService.getLatest5MinSignal();
        if (sig) {
          fiveMinSignal = { direction: sig.direction, confidence: sig.confidence, signalStrength: sig.signalStrength };
          logger.info('[SUI Cron] Polymarket 5-min signal', fiveMinSignal);

          // ═══ Track signal + resolve any expired prior signals ═══
          // Records ground truth so we can compute true win-rate over time.
          // Disable with HEDGE_TRACK_SIGNAL_OUTCOMES=false.
          if ((process.env.HEDGE_TRACK_SIGNAL_OUTCOMES || 'true').toLowerCase() !== 'false') {
            try {
              const { trackSignalAndResolve } = await import('@/lib/db/signal-outcomes');
              const probabilityFraction = sig.direction === 'UP'
                ? (sig.upProbability ?? sig.probability) / 100
                : (sig.downProbability ?? sig.probability) / 100;
              await trackSignalAndResolve({
                source: 'polymarket-5min',
                marketId: (sig as unknown as { marketId?: string }).marketId,
                windowEndTime: sig.windowEndTime,
                direction: sig.direction,
                probability: probabilityFraction,
                confidence: sig.confidence,
                signalStrength: sig.signalStrength,
                volume: (sig as unknown as { volume?: number }).volume,
                liquidity: (sig as unknown as { liquidity?: number }).liquidity,
                entryPrice: pricesUSD['BTC'] || 0,
              });
            } catch (trackErr) {
              logger.warn('[SUI Cron] signal-outcome tracking failed (non-critical)', {
                error: trackErr instanceof Error ? trackErr.message : String(trackErr),
              });
            }
          }
        }
      } catch (sigErr) {
        logger.warn('[SUI Cron] 5-min signal fetch failed (non-critical)', { error: sigErr });
      }

      aiResult = {
        allocations: enhanced.allocations,
        confidence: enhanced.confidence,
        reasoning: enhanced.reasoning,
        shouldRebalance: true, // Enhanced context triggers rebalance when urgency is medium+
        swappableAssets: ['BTC', 'ETH', 'SUI'] as PoolAsset[],
        hedgedAssets: [] as PoolAsset[],
        riskScore: enhanced.urgency === 'CRITICAL' ? 9 : enhanced.urgency === 'HIGH' ? 7 : enhanced.urgency === 'MEDIUM' ? 5 : 3,
      };
      // Check drift to decide if rebalance is actually needed
      const maxDrift = Math.max(
        ...POOL_ASSETS.map(a => Math.abs((enhanced.allocations[a] || 25) - (currentAllocations[a] || 25)))
      );
      // Never open long positions in bearish markets — hold USDC instead to stop losses.
      // Only buy assets when sentiment is neutral or better AND confidence is high enough.
      const sentimentStr = String(enhanced.marketSentiment).toUpperCase();
      let isBearish = sentimentStr === 'BEARISH' || sentimentStr === 'VERY_BEARISH';

      // Polymarket 5-min signal override: a STRONG crowd-sourced signal (>90% historical
      // resolution accuracy via Chainlink) can flip our gate.
      //   STRONG UP   + high confidence → force action even in bearish sentiment (catch reversals)
      //   STRONG DOWN + high confidence → force defensive (treat as bearish even if sentiment was neutral)
      let strongSignalOverride = false;
      if (fiveMinSignal && fiveMinSignal.signalStrength === 'STRONG' && fiveMinSignal.confidence >= 70) {
        if (fiveMinSignal.direction === 'DOWN') {
          isBearish = true; // Force defensive
          logger.info('[SUI Cron] Strong DOWN signal — forcing defensive (USDC) posture', fiveMinSignal);
        } else if (fiveMinSignal.direction === 'UP') {
          // Strong UP overrides bearish gate so we don't miss reversals
          isBearish = false;
          strongSignalOverride = true;
          logger.info('[SUI Cron] Strong UP signal — overriding bearish gate to allow long entries', fiveMinSignal);
        }
      }

      const confidenceThreshold = isBearish ? 85 : 70; // stricter gate in downtrends
      // Standardised drift threshold (env-driven, single source of truth).
      // Default 5% — tighter values cause excessive friction on small pools.
      const driftThresholdPct = Number(process.env.HEDGE_REBALANCE_DRIFT_PCT || 5);
      aiResult.shouldRebalance = !isBearish && (
        maxDrift > driftThresholdPct ||
        enhanced.confidence >= confidenceThreshold ||
        enhanced.urgency === 'HIGH' ||
        enhanced.urgency === 'CRITICAL' ||
        strongSignalOverride
      );

      // ═══════════════════════════════════════════════════════════════════
      // COST-BENEFIT GATE — refuse to rebalance when expected swap cost
      // exceeds expected alpha. Each rebalance touches ~25% of NAV across
      // 2 swap legs; conservative cost = 2 × (slippage 0.1% + gas 0.05%) ≈ 0.30%
      // of swapped notional. Only proceed if drift is large enough that
      // realigning is worth that cost (heuristic: drift × confidence ≥ cost%).
      // ═══════════════════════════════════════════════════════════════════
      if (aiResult.shouldRebalance) {
        const baseCostPct = Number(process.env.HEDGE_REBALANCE_COST_PCT || 0.3);
        // Scale cost threshold by NAV: small pools have smaller orders → less slippage.
        // 0.5x at NAV ≤ $500, scaling up to 1.0x at NAV ≥ $1000. Keeps the bar tight
        // for large pools while letting small pools rebalance on smaller drifts.
        const _navUsdForGate = poolStats.totalNAVUsd || (poolStats.totalNAV * (pricesUSD['SUI'] || 0));
        const navScale = Math.max(0.5, Math.min(1.0, _navUsdForGate / 1000));
        const expectedSwapCostPct = baseCostPct * navScale;
        const expectedAlphaPct = (maxDrift / 100) * (enhanced.confidence / 100) * 100;
        if (expectedAlphaPct < expectedSwapCostPct &&
            enhanced.urgency !== 'CRITICAL' &&
            !strongSignalOverride) {
          logger.warn('[SUI Cron] Cost-benefit gate — rebalance suppressed', {
            maxDrift: maxDrift.toFixed(2),
            confidence: enhanced.confidence,
            expectedAlphaPct: expectedAlphaPct.toFixed(3),
            expectedSwapCostPct: expectedSwapCostPct.toFixed(3),
            navScale: navScale.toFixed(2),
          });
          aiResult.shouldRebalance = false;
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // DRAWDOWN BRAKE — if share price has fallen below par by more than
      // HEDGE_MAX_DRAWDOWN_PCT (default 1%), halt all NEW rebalance swaps
      // and let the hedge logic protect remaining capital. Existing positions
      // still close on next cycle. This enforces "near 0 loss" by refusing
      // to chase prices on declining markets.
      // ═══════════════════════════════════════════════════════════════════
      const _sharePriceUsdEarly = poolStats.sharePriceUsd || (poolStats.sharePrice * (pricesUSD['SUI'] || 0));
      const drawdownPct = _sharePriceUsdEarly > 0 ? Math.max(0, (1 - _sharePriceUsdEarly) * 100) : 0;
      const maxDrawdownPct = Number(process.env.HEDGE_MAX_DRAWDOWN_PCT || 1);
      if (drawdownPct >= maxDrawdownPct) {
        if (aiResult.shouldRebalance) {
          logger.warn('[SUI Cron] Drawdown brake engaged — disabling rebalance swaps', {
            sharePriceUsd: _sharePriceUsdEarly.toFixed(4),
            drawdownPct: drawdownPct.toFixed(2),
            maxDrawdownPct,
          });
        }
        aiResult.shouldRebalance = false;
      }

      // Also short-circuit if KILL_SWITCH is set — no new buys, period.
      const killActive = (process.env.KILL_SWITCH || process.env.TRADING_KILL_SWITCH || '').toLowerCase().trim();
      if (['true','1','on','yes','disable','halt'].includes(killActive)) {
        if (aiResult.shouldRebalance) {
          logger.warn('[SUI Cron] KILL_SWITCH active — disabling rebalance swaps');
        }
        aiResult.shouldRebalance = false;
      }

      // ═══════════════════════════════════════════════════════════════════
      // DAILY-LOSS CIRCUIT BREAKER — auto-halt new swaps + new hedges if
      // realized losses + funding paid in the last 24h exceed the cap
      // (env HEDGE_DAILY_LOSS_CAP_USD, default $5). Existing positions
      // continue to settle normally; only new entries are blocked.
      // ═══════════════════════════════════════════════════════════════════
      let dailyLossHalted = false;
      try {
        const { getRealizedPnlSince } = await import('@/lib/db/hedges');
        const last24h = await getRealizedPnlSince(Date.now() - 24 * 60 * 60 * 1000);
        const dailyLossCap = Number(process.env.HEDGE_DAILY_LOSS_CAP_USD || 5);
        if (last24h.netPnl < -Math.abs(dailyLossCap)) {
          dailyLossHalted = true;
          logger.error('[SUI Cron] Daily-loss circuit breaker TRIPPED', {
            netPnl24h: last24h.netPnl.toFixed(2),
            realized: last24h.realized.toFixed(2),
            fundingPaid: last24h.fundingPaid.toFixed(2),
            closedHedges: last24h.count,
            cap: dailyLossCap,
          });
          if (aiResult.shouldRebalance) {
            aiResult.shouldRebalance = false;
          }
          // Persist the halt across instances/restarts — `getCronHalt(...)`
          // at the top of the next GET will short-circuit until UTC end-of-day.
          // Without this, a fresh Vercel cold start would happily re-run.
          try {
            await setCronHalt(
              CRON_SINGLETON_ID,
              endOfUtcDayMs(Date.now()),
              `daily-loss-cap-tripped: netPnl=${last24h.netPnl.toFixed(2)} cap=${dailyLossCap}`,
            );
          } catch (haltSetErr) {
            logger.error('[SUI Cron] setCronHalt failed — halt is in-memory only', {
              error: haltSetErr instanceof Error ? haltSetErr.message : String(haltSetErr),
            });
          }
        } else if (last24h.count >= 5) {
          logger.info('[SUI Cron] Daily PnL window', {
            netPnl24h: last24h.netPnl.toFixed(2),
            realized: last24h.realized.toFixed(2),
            fundingPaid: last24h.fundingPaid.toFixed(2),
            closedHedges: last24h.count,
            cap: dailyLossCap,
          });
        }
      } catch (lossErr) {
        logger.warn('[SUI Cron] daily-loss check failed (non-critical)', {
          error: lossErr instanceof Error ? lossErr.message : String(lossErr),
        });
      }
      // Stash for hedge-block to consult.
      (globalThis as Record<string, unknown>).__suiDailyLossHalted = dailyLossHalted;

      enhancedContext = {
        marketSentiment: enhanced.marketSentiment,
        recommendations: enhanced.recommendations,
        riskAlerts: enhanced.riskAlerts,
        correlationInsight: enhanced.correlationInsight,
        predictionSignals: enhanced.predictionSignals,
        urgency: enhanced.urgency,
      };

      logger.info('[SUI Cron] Enhanced AI allocation (prediction markets + intelligence)', {
        allocations: aiResult.allocations,
        confidence: aiResult.confidence,
        sentiment: enhanced.marketSentiment,
        urgency: enhanced.urgency,
        predictionSignals: enhanced.predictionSignals?.length || 0,
        riskAlerts: enhanced.riskAlerts?.length || 0,
        recommendations: enhanced.recommendations?.length || 0,
      });
    } catch (enhancedErr) {
      logger.warn('[SUI Cron] Enhanced allocation failed, falling back to basic', {
        error: enhancedErr instanceof Error ? enhancedErr.message : String(enhancedErr),
      });
      const indicators = await suiAgent.analyzeMarket();
      aiResult = suiAgent.generateAllocation(indicators, currentAllocations);
    }

    logger.info('[SUI Cron] AI Agent decision', {
      allocations: aiResult.allocations,
      confidence: aiResult.confidence,
      shouldRebalance: aiResult.shouldRebalance,
      swappableAssets: aiResult.swappableAssets,
      hedgedAssets: aiResult.hedgedAssets,
      riskScore: aiResult.riskScore,
      enhanced: Object.keys(enhancedContext).length > 0,
    });

    // Step 4: Record NAV snapshot
    // For SUI pool, totalNAV is in SUI. Convert to USD for consistent tracking.
    const navUsd = poolStats.totalNAVUsd || (poolStats.totalNAV * (pricesUSD['SUI'] || 0));
    const sharePriceUsd = poolStats.sharePriceUsd || (poolStats.sharePrice * (pricesUSD['SUI'] || 0));

    try {
      await recordNavSnapshot({
        sharePrice: sharePriceUsd || poolStats.sharePrice,
        totalNav: navUsd || poolStats.totalNAV,
        totalShares: poolStats.totalShares,
        memberCount: poolStats.memberCount,
        allocations: aiResult.allocations,
        source: 'sui-usdc-pool',
        chain: 'sui',
      });
      logger.info('[SUI Cron] NAV snapshot recorded');
    } catch (navErr) {
      logger.warn('[SUI Cron] Failed to record NAV (non-critical)', { error: navErr });
    }

    // Step 5: Sync members to DB from on-chain
    try {
      const members = await suiService.getAllMembers();
      let synced = 0;
      for (const m of members) {
        if (m.shares > 0) {
          await saveUserSharesToDb({
            walletAddress: m.address.toLowerCase(),
            shares: m.shares,
            costBasisUSD: m.valueUsd || m.valueSui * (pricesUSD['SUI'] || 0),
            chain: 'sui',
          });
          synced++;
        }
      }
      logger.info('[SUI Cron] Members synced to DB', { synced, total: members.length });
    } catch (syncErr) {
      logger.warn('[SUI Cron] Member sync failed (non-critical)', { error: syncErr });
    }

    // Step 6: Save pool state to DB
    try {
      const poolAllocRecord: Record<string, { percentage: number; valueUSD: number; amount: number; price: number }> = {};
      for (const asset of POOL_ASSETS) {
        const pct = aiResult.allocations[asset] || 25;
        poolAllocRecord[asset] = {
          percentage: pct,
          valueUSD: navUsd * (pct / 100),
          amount: 0,
          price: pricesUSD[asset] || 0,
        };
      }

      await savePoolStateToDb({
        totalValueUSD: navUsd,
        totalShares: poolStats.totalShares,
        sharePrice: sharePriceUsd || 1,
        allocations: poolAllocRecord,
        lastRebalance: Date.now(),
        lastAIDecision: {
          timestamp: Date.now(),
          reasoning: aiResult.reasoning,
          allocations: aiResult.allocations,
        },
        chain: 'sui',
      });
      logger.info('[SUI Cron] Pool state saved to DB');
    } catch (dbErr) {
      logger.warn('[SUI Cron] DB pool state save failed (non-critical)', { error: dbErr });
    }

    // Step 6.5: Settle PREVIOUS cycle's hedges — return USDC from admin back to pool
    // This runs BEFORE new swaps so the pool gets its money back first.
    // Flow: reverse-swap ALL admin-held assets → USDC, then close_hedge for each.
    // Profits/losses from asset price changes are captured proportionally.
    let hedgeSettlement: { settled: number; failed: number; details: any[]; replenishment?: any; debug?: any; skipped?: string } | undefined;

    // Gas pre-check — abort the whole settle/swap path if operator gas is low.
    // Each cycle needs ~0.1 SUI for open_hedge + swaps + close_hedge. If we
    // start a cycle and run out mid-way, we leave orphaned admin-side coins
    // that can't be returned. Better to skip the cycle and emit a clear log.
    let gasCheckPassed = true;
    let gasStatus: { suiBalance: string; gasFloorSui: number; address?: string } | null = null;
    if (process.env.SUI_POOL_ADMIN_KEY && process.env.SUI_AGENT_CAP_ID) {
      try {
        const aggregator = getBluefinAggregatorService(network);
        const wallet = await aggregator.checkAdminWallet();
        gasStatus = {
          suiBalance: wallet.suiBalance || '0',
          gasFloorSui: wallet.gasFloorSui || 0.1,
          address: wallet.address,
        };
        if (!wallet.hasGas) {
          gasCheckPassed = false;
          logger.warn('[SUI Cron] Gas pre-check FAILED — operator wallet has insufficient SUI for a full cycle', {
            suiBalance: wallet.suiBalance,
            floor: wallet.gasFloorSui,
            address: wallet.address,
            action: 'Skipping settle + swap steps. Top up the operator wallet with SUI to resume trading.',
          });
          hedgeSettlement = {
            settled: 0,
            failed: 0,
            details: [],
            skipped: `Operator wallet has ${wallet.suiBalance} SUI, below ${wallet.gasFloorSui} SUI floor. Top up to resume.`,
          };
        }
      } catch (gasErr) {
        logger.warn('[SUI Cron] Gas pre-check threw — proceeding cautiously', { error: gasErr });
      }
    }

    if (gasCheckPassed && process.env.SUI_POOL_ADMIN_KEY && process.env.SUI_AGENT_CAP_ID) {
      try {
        const activeHedges = await getActiveHedges(network);
        logger.info('[SUI Cron] Step 6.5 getActiveHedges result', { count: activeHedges.length, hedges: activeHedges });

        // Step 6.4: Close orphaned dust hedges (collateral < $0.01 USDC).
        // These are leftover from interrupted prior cycles or from cron
        // attempts when gas ran out mid-way. They serve no risk-management
        // purpose, are filtered out of the user-facing UI, and clog the
        // on-chain active_hedges vector. Close them aggressively.
        // Match HEDGE_MIN_OPEN_USDC so any hedge below that floor is treated
        // as orphan dust and force-closed (no PnL emitted).
        const ORPHAN_DUST_FLOOR_USDC = HEDGE_MIN_OPEN_USDC;
        const dustHedges = activeHedges.filter(h => h.collateralUsdc > 0 && h.collateralUsdc < ORPHAN_DUST_FLOOR_USDC);
        if (dustHedges.length > 0) {
          logger.info('[SUI Cron] Closing orphaned dust hedges', {
            count: dustHedges.length,
            totalValue: dustHedges.reduce((s, h) => s + h.collateralUsdc, 0).toFixed(8),
          });
          for (const dust of dustHedges) {
            try {
              // returnUsdcToPool calls close_hedge for one hedge id with the
              // exact collateral amount (no PnL — these are sub-cent).
              const r = await returnUsdcToPool(network, dust.hedgeId, dust.collateralUsdc, 0, false);
              logger.info('[SUI Cron] Dust hedge close', {
                amount: dust.collateralUsdc,
                ok: r.success,
                tx: r.txDigest,
                err: r.error,
              });
            } catch (dustErr) {
              logger.warn('[SUI Cron] Dust hedge close threw (non-fatal)', { error: dustErr });
            }
            // Tiny pause between closures to avoid RPC rate limits
            await new Promise(r => setTimeout(r, 500));
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // BOUNDED REPLENISH — convert only what's actually needed.
        //  • If active hedges exist, target = totalCollateralNeeded × 1.10
        //  • If none, only clear dust (per-asset value ≤ HEDGE_REPLENISH_DUST_USD,
        //    default $10) so larger holdings can wait for price recovery
        //    rather than be force-converted at a loss.
        // Override the cap entirely with HEDGE_REPLENISH_FORCE_FULL=true.
        // ═══════════════════════════════════════════════════════════════
        const totalCollateralNeededPre = activeHedges.reduce((sum, h) => sum + h.collateralUsdc, 0);
        const forceFull = (process.env.HEDGE_REPLENISH_FORCE_FULL || 'false').toLowerCase() === 'true';
        const replenishTarget = forceFull
          ? 1_000_000
          : (activeHedges.length > 0
              ? totalCollateralNeededPre * 1.10
              : Number(process.env.HEDGE_REPLENISH_DUST_USD || 10));
        const replenishment = await replenishAdminUsdc(network, replenishTarget, pricesUSD);
        logger.info('[SUI Cron] Step 6.5 replenishment result', {
          swapped: replenishment.swapped,
          target: replenishTarget,
          activeHedges: activeHedges.length,
          forceFull,
          details: replenishment.details,
        });
        if (replenishment.swapped > 0) {
          await new Promise(r => setTimeout(r, 2000));
          logger.info('[SUI Cron] Admin assets → USDC replenishment', {
            swapped: replenishment.swapped.toFixed(6),
            details: replenishment.details,
          });
        }

        if (activeHedges.length > 0) {
          const totalCollateralNeeded = activeHedges.reduce((sum, h) => sum + h.collateralUsdc, 0);

          logger.info('[SUI Cron] Settling previous hedges before new allocation', {
            activeHedges: activeHedges.length,
            totalCollateral: totalCollateralNeeded.toFixed(6),
          });

          // Check total admin USDC after replenishment
          const adminUsdcForSettlement = await getAdminUsdcBalance(network);
          logger.info('[SUI Cron] Admin USDC for settlement', {
            adminUsdc: adminUsdcForSettlement.toFixed(6),
            totalCollateral: totalCollateralNeeded.toFixed(6),
            pnl: (adminUsdcForSettlement - totalCollateralNeeded).toFixed(6),
          });

          // Settle all hedges — returns ALL admin USDC to pool proportionally
          if (adminUsdcForSettlement > 0.001) {
            const settlement = await settleActiveHedges(network);
            hedgeSettlement = {
              settled: settlement.settled,
              failed: settlement.failed,
              details: settlement.details,
              replenishment,
            };
            logger.info('[SUI Cron] Previous hedges settled — USDC returned to pool', {
              settled: settlement.settled,
              failed: settlement.failed,
              adminUsdcReturned: adminUsdcForSettlement.toFixed(6),
              pnl: (adminUsdcForSettlement - totalCollateralNeeded).toFixed(6),
            });
            // Wait for on-chain state to propagate before opening new hedges
            if (settlement.settled > 0) {
              await new Promise(r => setTimeout(r, 2000));
            }
          } else {
            logger.warn('[SUI Cron] No USDC available to settle hedges', {
              adminUsdc: adminUsdcForSettlement.toFixed(6),
            });
            hedgeSettlement = {
              settled: 0, failed: 0, details: [],
              replenishment,
              debug: { adminUsdcForSettlement, totalCollateralNeeded, activeHedgesCount: activeHedges.length },
            };
          }
        } else {
          // No open hedges on-chain, but admin may hold orphaned USDC from a prior replenishment.
          // Use a mini hedge roundtrip to officially return these funds to the pool:
          //   open_hedge($0.01 from pool) → get hedge_id → close_hedge(full admin balance) → pool gets it all
          // Threshold raised so we don't burn gas on dust amounts that produce 0-PnL cycles.
          const adminUsdcAfter = await getAdminUsdcBalance(network);
          const ORPHAN_RECOVERY_MIN_USD = Number(process.env.HEDGE_ORPHAN_RECOVERY_MIN_USD || 5.0);
          if (adminUsdcAfter > ORPHAN_RECOVERY_MIN_USD) {
            logger.info('[SUI Cron] Orphaned USDC in admin wallet — recovering to pool via mini-hedge', {
              adminUsdc: adminUsdcAfter.toFixed(6),
              replenished: replenishment.swapped.toFixed(6),
            });
            try {
              const MICRO_HEDGE = HEDGE_MIN_OPEN_USDC; // honour dust floor
              const openResult = await transferUsdcFromPoolToAdmin(network, MICRO_HEDGE);
              if (openResult.success) {
                await new Promise(r => setTimeout(r, 3000));
                const freshHedges = await getActiveHedges(network);
                if (freshHedges.length > 0) {
                  const hedge = freshHedges[0];
                  const totalAdminUsdc = await getAdminUsdcBalance(network);
                  const pnl = Math.max(0, totalAdminUsdc - MICRO_HEDGE);
                  const returnResult = await returnUsdcToPool(network, hedge.hedgeId, totalAdminUsdc, pnl, pnl > 0);
                  if (returnResult.success) {
                    logger.info('[SUI Cron] Orphaned USDC successfully returned to pool', {
                      returned: totalAdminUsdc.toFixed(6), pnl: pnl.toFixed(6), txDigest: returnResult.txDigest,
                    });
                    hedgeSettlement = { settled: 1, failed: 0, details: [{ returned: totalAdminUsdc, pnl }], replenishment };
                  } else {
                    logger.warn('[SUI Cron] Mini-hedge close failed', { error: returnResult.error });
                    hedgeSettlement = { settled: 0, failed: 1, details: [], replenishment, debug: { closeError: returnResult.error } };
                  }
                } else {
                  logger.warn('[SUI Cron] Mini-hedge opened but no hedge found on-chain');
                  hedgeSettlement = { settled: 0, failed: 0, details: [], replenishment, debug: { activeHedgesFound: 0, adminUsdcAfter } };
                }
              } else {
                logger.warn('[SUI Cron] Mini-hedge open failed — admin USDC stays for next cycle', { error: openResult.error });
                hedgeSettlement = { settled: 0, failed: 0, details: [], replenishment, debug: { openError: openResult.error, adminUsdcAfter } };
              }
            } catch (recoveryErr) {
              logger.warn('[SUI Cron] Orphaned USDC recovery threw', { error: recoveryErr });
              hedgeSettlement = { settled: 0, failed: 0, details: [], replenishment, debug: { recoveryError: String(recoveryErr), adminUsdcAfter } };
            }
          } else {
            logger.info('[SUI Cron] No orphaned USDC to recover', { adminUsdc: adminUsdcAfter.toFixed(6) });
            hedgeSettlement = { settled: 0, failed: 0, details: [], replenishment, debug: { activeHedgesFound: 0, adminUsdcAfter } };
          }
        }
      } catch (settleErr) {
        const errMsg = settleErr instanceof Error ? settleErr.message : String(settleErr);
        logger.warn('[SUI Cron] Pre-swap hedge settlement failed (non-critical)', { error: settleErr });
        hedgeSettlement = { settled: 0, failed: 0, details: [], debug: { error: errMsg } };
      }
    } else {
      hedgeSettlement = { settled: 0, failed: 0, details: [], debug: { envMissing: { adminKey: !process.env.SUI_POOL_ADMIN_KEY, agentCap: !process.env.SUI_AGENT_CAP_ID } } };
    }

    // ═══════════════════════════════════════════════════════════════════
    // POSITION-AGE TIMEOUT — force-close any active BlueFin perp hedge
    // older than HEDGE_MAX_AGE_HOURS (default 8). This prevents naked
    // shorts from accumulating funding cost across cycles when the
    // signal that opened them is no longer fresh.
    // ═══════════════════════════════════════════════════════════════════
    let stalePositionCloses = 0;
    try {
      const maxAgeHours = Number(process.env.HEDGE_MAX_AGE_HOURS || 8);
      if (maxAgeHours > 0) {
        const { getStaleActiveHedges } = await import('@/lib/db/hedges');
        const stale = await getStaleActiveHedges(maxAgeHours * 60 * 60 * 1000);
        if (stale.length > 0) {
          logger.warn('[SUI Cron] Stale active perps detected — force-closing', {
            count: stale.length,
            maxAgeHours,
            positions: stale.map(s => ({
              market: s.market,
              side: s.side,
              ageH: (s.ageMs / 3600000).toFixed(1),
            })),
          });
          const { BluefinService } = await import('@/lib/services/sui/BluefinService');
          const bf = BluefinService.getInstance();
          // Deduplicate by market — closeHedge closes the entire position for that symbol.
          const seen = new Set<string>();
          const { closeHedge: dbCloseHedge } = await import('@/lib/db/hedges');
          // Profit-protection: don't force-close stale positions that are still
          // making money. Override with HEDGE_FORCE_CLOSE_PROFITABLE=true.
          const forceCloseProfitable = (process.env.HEDGE_FORCE_CLOSE_PROFITABLE || 'false').toLowerCase() === 'true';
          let livePositions: Array<{ symbol: string; unrealizedPnl?: number }> = [];
          if (!forceCloseProfitable) {
            try {
              livePositions = (await bf.getPositions()) as Array<{ symbol: string; unrealizedPnl?: number }>;
            } catch { /* ignore — fall through to close */ }
          }
          for (const s of stale) {
            if (seen.has(s.market)) continue;
            seen.add(s.market);
            // Skip force-close if position is currently profitable. The next cycle
            // will re-evaluate and close on a normal trigger (signal flip / risk drop).
            if (!forceCloseProfitable) {
              const live = livePositions.find(p => p.symbol === s.market);
              const upnl = Number(live?.unrealizedPnl ?? 0);
              if (live && upnl > 0) {
                logger.info('[SUI Cron] Stale perp is profitable — preserving', {
                  market: s.market,
                  ageH: (s.ageMs / 3600000).toFixed(1),
                  unrealizedPnl: upnl.toFixed(4),
                });
                continue;
              }
            }
            try {
              const closed = await bf.closeHedge({
                symbol: s.market,
              });
              if (closed?.success) {
                stalePositionCloses++;
                // DB sync: mark the originating row closed with realized PnL
                // returned by Bluefin. Without this the row stays 'active'
                // forever and the next cycle keeps re-trying close_hedge.
                try {
                  const realized = Number((closed as { realizedPnl?: number }).realizedPnl ?? 0);
                  await dbCloseHedge(s.orderId, realized, 'closed');
                } catch (dbErr) {
                  logger.warn('[SUI Cron] Stale perp DB close failed (non-fatal)', {
                    orderId: s.orderId,
                    error: dbErr instanceof Error ? dbErr.message : String(dbErr),
                  });
                }
                logger.info('[SUI Cron] Stale perp force-closed', {
                  market: s.market,
                  side: s.side,
                  ageH: (s.ageMs / 3600000).toFixed(1),
                });
              } else {
                logger.warn('[SUI Cron] Stale perp close failed', {
                  market: s.market,
                  side: s.side,
                  error: closed?.error,
                });
              }
            } catch (closeErr) {
              logger.warn('[SUI Cron] Stale perp close threw (non-critical)', {
                market: s.market,
                error: closeErr instanceof Error ? closeErr.message : String(closeErr),
              });
            }
          }
        }
      }
    } catch (staleErr) {
      logger.warn('[SUI Cron] position-age timeout failed (non-critical)', {
        error: staleErr instanceof Error ? staleErr.message : String(staleErr),
      });
    }

    // Step 7: Plan + Execute rebalance via SuiPoolAgent
    // Trigger swaps when:
    //  a) AI detects allocation drift and recommends rebalancing, OR
    //  b) Pool has USDC that hasn't been converted to assets yet (first allocation)
    //     If all previous DB-stored allocations are 0, it's the first run and all USDC
    //     needs to be swapped/hedged into assets. Also force rebalance when the pool has
    //     never had successful swaps (no DB swap records).
    let rebalanceSwaps: SuiCronResult['rebalanceSwaps'] = undefined;

    // On-chain pool state — populated inside the admin-USDC branch below
    // (Step 7b's pool-state read), but Step 8 (auto-hedge sizing) ALSO needs
    // these values for Kelly cap math, balance-drift checks, and exposure
    // fallback. Declared at the GET-handler scope so they survive past the
    // swap-planning try block. Defaults are safe ("no existing hedge",
    // contract default 25% ratio, full NAV as balance).
    let contractBalance = navUsd;
    let existingHedgedValue = 0;
    let maxHedgeRatioBps = 2500;
    const hasUnallocatedUsdc = navUsd > 30 && (
      currentAllocations.BTC === 0 &&
      currentAllocations.ETH === 0 &&
      currentAllocations.SUI === 0
    );
    // Minimum pool NAV to execute swaps.
    // At $30 each swap gets ~$10 per asset (acceptable DEX pricing on SUI mainnet).
    // Below $30 the per-asset amounts are too small — fee drag exceeds any realistic gain.
    // When bearish the shouldRebalance gate (above) will block new buys anyway.
    const MIN_SWAP_NAV_USD = 30;
    // Per-asset minimum: skip any single swap below $8 to avoid high-fee micro-routes.
    const MIN_PER_ASSET_SWAP_USD = 8;
    const shouldExecuteSwaps = navUsd >= MIN_SWAP_NAV_USD && gasCheckPassed;
    if (hasUnallocatedUsdc) {
      logger.info('[SUI Cron] Unallocated USDC detected — triggering initial asset allocation', { navUsd });
    }
    if (navUsd > 0.50 && navUsd < MIN_SWAP_NAV_USD) {
      logger.info('[SUI Cron] Pool NAV $' + navUsd.toFixed(2) + ' below $' + MIN_SWAP_NAV_USD + ' swap minimum — skipping swaps to avoid slippage losses');
    }
    if (!gasCheckPassed) {
      logger.warn('[SUI Cron] Skipping swap execution — gas pre-check failed earlier', gasStatus || {});
    }
    if (shouldExecuteSwaps) {
      try {
        const aggregator = getBluefinAggregatorService(network);

        const plan = await aggregator.planRebalanceSwaps(
          navUsd,
          aiResult.allocations as Record<BluefinPoolAsset, number>,
        );

        const onChainCount = plan.swaps.filter(s => s.canSwapOnChain).length;
        const simulatedCount = plan.swaps.filter(s => s.isSimulated).length;

        rebalanceSwaps = {
          planned: plan.swaps.length,
          executable: onChainCount,
          quotes: plan.swaps.map(s => ({
            asset: s.asset,
            amountInUsdc: (Number(s.amountIn) / 1e6).toFixed(2),
            expectedOut: s.expectedAmountOut,
            route: s.route,
            canSwap: s.canSwapOnChain,
          })),
        };

        // Attach agent metadata
        rebalanceSwaps.simulated = simulatedCount;
        rebalanceSwaps.swappableAssets = aiResult.swappableAssets;
        rebalanceSwaps.hedgedAssets = aiResult.hedgedAssets;

        logger.info('[SUI Cron] Agent rebalance plan', {
          planned: plan.swaps.length,
          onChain: onChainCount,
          simulated: simulatedCount,
          quotes: plan.swaps.map(q => 
            `${q.asset}: $${(Number(q.amountIn) / 1e6).toFixed(2)} → ${q.expectedAmountOut} (${q.route})${q.isSimulated ? ' [simulated]' : ''}`
          ),
        });

        // Step 7b: Ensure admin wallet has USDC for swaps (transfer from pool if needed)
        const hedgeableCount = plan.swaps.filter(s => !s.canSwapOnChain && s.hedgeVia === 'bluefin').length;

        if (process.env.SUI_POOL_ADMIN_KEY && (onChainCount > 0 || hedgeableCount > 0)) {
          // Calculate total USDC needed for on-chain swaps + hedges
          const totalUsdcNeeded = plan.swaps
            .filter(s => s.canSwapOnChain || s.hedgeVia === 'bluefin')
            .reduce((sum, s) => sum + Number(s.amountIn) / 1e6, 0);

          // Check admin wallet USDC balance
          const adminUsdcBalance = await getAdminUsdcBalance(network);
          logger.info('[SUI Cron] Admin wallet USDC check', {
            available: adminUsdcBalance.toFixed(2),
            needed: totalUsdcNeeded.toFixed(2),
          });

          // If admin wallet doesn't have enough USDC, transfer from pool via open_hedge
          if (adminUsdcBalance < totalUsdcNeeded * 0.95) { // 5% tolerance
            const deficit = totalUsdcNeeded - adminUsdcBalance;

            // Read on-chain state to get exact contract-side balance and hedge values.
            // (contractBalance / existingHedgedValue / maxHedgeRatioBps are hoisted
            //  into the parent scope so Step 8 can use them for Kelly cap math.)
            let dailyHedgedToday = 0;
            // DAILY_HEDGE_CAP_BPS is a hardcoded constant in the Move contract.
            const DAILY_HEDGE_CAP_BPS_CONST = 5000; // 50% — must match Move const DAILY_HEDGE_CAP_BPS
            try {
              const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
              const rpcUrl = network === 'mainnet'
                ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
                : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
              const tmpClient = new SuiClient({ url: rpcUrl });
              const poolConfig = SUI_USDC_POOL_CONFIG[network];
              if (poolConfig.poolStateId) {
                const obj = await tmpClient.getObject({ id: poolConfig.poolStateId, options: { showContent: true } });
                const fields = (obj.data?.content as any)?.fields;
                if (fields) {
                  const rawBal = typeof fields.balance === 'string'
                    ? fields.balance
                    : (fields.balance?.fields?.value || '0');
                  // microUsdcToUsdNumber rejects non-integer / negative / out-of-range
                  // values and audit-logs malformed RPC responses, so a poisoned
                  // u64 cannot silently inflate `contractBalance`.
                  contractBalance = microUsdcToUsdNumber(rawBal, 'pool.balance');
                  existingHedgedValue = microUsdcToUsdNumber(
                    fields.hedge_state?.fields?.total_hedged_value || '0',
                    'hedge_state.total_hedged_value',
                  );

                  // Read daily hedge counter & on-chain max_hedge_ratio_bps
                  const hedgeState = fields.hedge_state?.fields;
                  if (hedgeState) {
                    const currentDay = Math.floor(Date.now() / 86400000);
                    const onChainDay = Number(hedgeState.current_hedge_day || 0);
                    if (onChainDay === currentDay) {
                      dailyHedgedToday = microUsdcToUsdNumber(
                        hedgeState.daily_hedge_total || '0',
                        'hedge_state.daily_hedge_total',
                      );
                    }
                    const cfgBps = Number(
                      hedgeState.auto_hedge_config?.fields?.max_hedge_ratio_bps ?? 0,
                    );
                    if (cfgBps > 0 && cfgBps <= 5000) {
                      maxHedgeRatioBps = cfgBps;
                    }
                  }

                  logger.info('[SUI Cron] On-chain contract state for limit calc', {
                    contractBalance: contractBalance.toFixed(2),
                    existingHedgedValue: existingHedgedValue.toFixed(2),
                    maxHedgeRatioBps: fields.hedge_state?.fields?.auto_hedge_config?.fields?.max_hedge_ratio_bps,
                    dailyHedgedToday: dailyHedgedToday.toFixed(2),
                  });
                }
              }
            } catch (stateErr) {
              logger.warn('[SUI Cron] Failed to read on-chain state for limit calc, using fallback', { error: stateErr });
            }

            // Contract's get_total_nav() returns balance + total_hedged_value (fixed in v5 redeploy).
            const contractNav = contractBalance + existingHedgedValue;
            // Use on-chain max_hedge_ratio_bps (default 2500 = 25%). Admin may tune this.
            const maxHedgeTotal = contractNav * (maxHedgeRatioBps / 10000);
            const maxByHedgeRatio = Math.max(0, maxHedgeTotal - existingHedgedValue);
            const maxByReserve = contractBalance * 0.8;     // 20% reserve must stay in pool

            // Daily cap: DAILY_HEDGE_CAP_BPS (50%) of NAV minus what's already been hedged today
            // NOTE: contract resets daily_hedge_total at day boundary when open_hedge is called.
            const maxByDailyCap = Math.max(
              0,
              contractNav * (DAILY_HEDGE_CAP_BPS_CONST / 10000) - dailyHedgedToday,
            );

            const maxTransferable = Math.min(maxByHedgeRatio, maxByReserve, maxByDailyCap);
            // Use a tighter 5% safety margin and floor at 6 decimal precision.
            const cappedDeficit = Math.min(deficit, maxTransferable * 0.95);

            if (maxByHedgeRatio <= 0) {
              logger.warn('[SUI Cron] Already at max hedge ratio — skipping pool transfer', {
                existingHedgedValue: existingHedgedValue.toFixed(2),
                maxHedgeTotal: maxHedgeTotal.toFixed(2),
              });
              (rebalanceSwaps as any).poolTransfer = {
                requested: '0.00',
                success: false,
                error: 'Max hedge ratio reached',
              };
            } else if (maxTransferable <= 0 || cappedDeficit < HEDGE_MIN_OPEN_USDC) {
              // ═══════════════════════════════════════════════════════════
              // DAILY-CAP HARD STOP. Previously we fell back to a
              // "safe-attempt" that ignored maxByDailyCap and tried with
              // maxByHedgeRatio only — this caused every single cycle to
              // hit MoveAbort 20 (E_MAX_HEDGE_EXCEEDED) once the daily
              // cumulative open_hedge volume reached 50% NAV (the
              // contract's hardcoded DAILY_HEDGE_CAP_BPS). The Move
              // contract is the source of truth: if its daily counter is
              // exhausted, NO `open_hedge` call will succeed until the
              // UTC day boundary. Trying anyway just burns RPCs.
              // ═══════════════════════════════════════════════════════════
              const utcMsToReset = 86400000 - (Date.now() % 86400000);
              const minsToReset = Math.ceil(utcMsToReset / 60000);
              logger.warn('[SUI Cron] Skip pool→admin transfer — on-chain limits exhausted (daily cap is the source of truth)', {
                deficit: deficit.toFixed(2),
                maxByHedgeRatio: maxByHedgeRatio.toFixed(6),
                maxByDailyCap: maxByDailyCap.toFixed(6),
                maxByReserve: maxByReserve.toFixed(6),
                cappedDeficit: cappedDeficit.toFixed(6),
                floor: HEDGE_MIN_OPEN_USDC,
                minsToUtcReset: minsToReset,
              });
              (rebalanceSwaps as { poolTransfer?: unknown }).poolTransfer = {
                requested: '0.00',
                success: false,
                error: `On-chain limits exhausted (daily=${maxByDailyCap.toFixed(4)} ratio=${maxByHedgeRatio.toFixed(4)}); resets in ${minsToReset}m`,
              };
            } else {
            logger.info('[SUI Cron] Admin USDC insufficient — transferring from pool via open_hedge', {
              deficit: deficit.toFixed(2),
              contractNav: contractNav.toFixed(2),
              maxTransferable: maxTransferable.toFixed(2),
              cappedDeficit: cappedDeficit.toFixed(2),
            });


            const transferResult = await transferUsdcFromPoolToAdmin(network, cappedDeficit);
            (rebalanceSwaps as any).poolTransfer = {
              requested: cappedDeficit.toFixed(2),
              success: transferResult.success,
              txDigest: transferResult.txDigest,
              error: transferResult.error,
            };
            if (transferResult.success) {
              logger.info('[SUI Cron] Pool → admin USDC transfer successful', {
                txDigest: transferResult.txDigest,
                amount: cappedDeficit.toFixed(2),
              });
              // Small delay for state propagation
              await new Promise(r => setTimeout(r, 2000));
            } else {
              logger.warn('[SUI Cron] Pool → admin USDC transfer failed', {
                error: transferResult.error,
              });
            }
            } // close else block for maxByHedgeRatio > 0
          }

          // Step 7c: Check actual admin USDC balance before proceeding
          const actualAdminUsdc = await getAdminUsdcBalance(network);

          // BAIL OUT if admin has no meaningful USDC (transfer failed or wasn't needed)
          if (actualAdminUsdc < 0.10) {
            logger.warn('[SUI Cron] Admin USDC too low to execute swaps — skipping', {
              actualAdminUsdc: actualAdminUsdc.toFixed(4),
            });
            (rebalanceSwaps as any).swapBudget = actualAdminUsdc.toFixed(2);
            (rebalanceSwaps as any).executed = 0;
            (rebalanceSwaps as any).failed = 0;
            (rebalanceSwaps as any).swapResults = [];
          } else {
          // Re-plan swaps with actual available admin USDC budget
          let swapPlan = plan;
          if (actualAdminUsdc < totalUsdcNeeded * 0.95 && actualAdminUsdc > 0.10) {
            // Budget is limited — re-plan with available USDC
            logger.info('[SUI Cron] Re-planning swaps with available budget', {
              available: actualAdminUsdc.toFixed(2),
              originalNeeded: totalUsdcNeeded.toFixed(2),
            });
            try {
              swapPlan = await aggregator.planRebalanceSwaps(
                actualAdminUsdc,
                aiResult.allocations as Record<BluefinPoolAsset, number>,
              );
            } catch (replanErr) {
              logger.warn('[SUI Cron] Re-plan failed, using original plan', { error: replanErr });
            }
          }

          // Drop any individual swap whose USDC value is below the per-asset minimum.
          // This prevents high-fee micro-routes when the pool is small.
          const filteredSwaps = swapPlan.swaps.filter(s => {
            const usdcValue = Number(s.amountIn) / 1e6;
            if (usdcValue < MIN_PER_ASSET_SWAP_USD) {
              logger.info(`[SUI Cron] Skipping ${s.asset} swap — $${usdcValue.toFixed(2)} below $${MIN_PER_ASSET_SWAP_USD} per-asset minimum`);
              return false;
            }
            return true;
          });
          if (filteredSwaps.length < swapPlan.swaps.length) {
            swapPlan = { ...swapPlan, swaps: filteredSwaps };
          }

          // Execute on-chain swaps
          try {
            const execResult = await aggregator.executeRebalance(swapPlan, 0.015);
            
            rebalanceSwaps.executed = execResult.totalExecuted;
            rebalanceSwaps.failed = execResult.totalFailed;
            rebalanceSwaps.txDigests = execResult.results
              .filter((r): r is typeof r & { txDigest: string } => !!r.txDigest)
              .map(r => ({ asset: r.asset, digest: r.txDigest }));
            // Include per-swap error details for diagnostics
            (rebalanceSwaps as any).swapResults = execResult.results.map(r => ({
              asset: r.asset,
              success: r.success,
              amountIn: r.amountIn,
              amountOut: r.amountOut,
              txDigest: r.txDigest,
              error: r.error,
            }));
            (rebalanceSwaps as any).swapBudget = actualAdminUsdc.toFixed(2);

            logger.info('[SUI Cron] On-chain swaps executed', {
              executed: execResult.totalExecuted,
              failed: execResult.totalFailed,
              budget: actualAdminUsdc.toFixed(2),
              digests: execResult.results.filter(r => r.txDigest).map(r => r.txDigest),
              errors: execResult.results.filter(r => !r.success).map(r => `${r.asset}: ${r.error}`),
            });
          } catch (execErr) {
            logger.error('[SUI Cron] On-chain swap execution failed', { error: execErr });
            (rebalanceSwaps as any).executionError = execErr instanceof Error ? execErr.message : String(execErr);
          }
          } // end else (admin has enough USDC)
        } else if (!process.env.SUI_POOL_ADMIN_KEY) {
          logger.info('[SUI Cron] Swap execution skipped — SUI_POOL_ADMIN_KEY not set (quotes only)');
        }

        // Step 7d: Log hedged/simulated positions
        const hedgedPositions = plan.swaps.filter(s => s.isSimulated || !s.canSwapOnChain);
        if (hedgedPositions.length > 0) {
          (rebalanceSwaps as any).hedgedPositions = hedgedPositions.map(s => ({
            asset: s.asset,
            method: s.hedgeVia || 'price-tracked',
            usdcAllocated: (Number(s.amountIn) / 1e6).toFixed(2),
            estimatedQty: s.expectedAmountOut,
            route: s.route,
          }));
          logger.info('[SUI Cron] Hedged positions tracked', {
            count: hedgedPositions.length,
            assets: hedgedPositions.map(s => `${s.asset}: $${(Number(s.amountIn) / 1e6).toFixed(2)} via ${s.hedgeVia || 'virtual'}`),
          });
        }

      } catch (swapErr) {
        logger.warn('[SUI Cron] Rebalance planning failed (non-critical)', { error: swapErr });
      }
    }

    // Step 8: Auto-Hedge via BlueFin perpetuals
    // DISABLED: BlueFin perp hedging is inappropriate for this pool:
    //  - Pool NAV is too small for viable perp positions
    //  - On-chain hedge system (open_hedge/close_hedge) already handles rebalancing
    //  - Perp hedges were spamming 241+ DB records with no real risk reduction
    // To re-enable: set risk_threshold >= 8 in auto_hedge_configs DB table
    let autoHedgeResult: { triggered: boolean; hedges?: Array<{ symbol: string; side: string; size: number; status: string; orderId?: string; error?: string }> } = { triggered: false };

    // ═══════════════════════════════════════════════════════════════════
    // KILL SWITCH — set KILL_SWITCH=true (or =1, =on) to halt all new
    // directional exposure. Existing positions still close on next cycle.
    // Also enforced inside swap planning via isTradingHalted().
    // ═══════════════════════════════════════════════════════════════════
    const { isTradingHalted } = await import('@/lib/services/hedging/calibration');
    if (isTradingHalted()) {
      logger.warn('[SUI Cron] KILL_SWITCH active — skipping all new perp hedges this cycle');
      autoHedgeResult = {
        triggered: false,
        hedges: [{ symbol: 'KILL_SWITCH', side: 'N/A', size: 0, status: 'HALTED',
          error: 'KILL_SWITCH env var is set — no new positions opened.' }],
      };
    } else if ((globalThis as Record<string, unknown>).__suiDailyLossHalted === true) {
      // Daily-loss circuit breaker tripped earlier in this cycle.
      logger.error('[SUI Cron] Daily-loss circuit breaker tripped — skipping new perp hedges');
      autoHedgeResult = {
        triggered: false,
        hedges: [{ symbol: 'DAILY_LOSS_HALT', side: 'N/A', size: 0, status: 'HALTED',
          error: 'Realized 24h loss exceeds HEDGE_DAILY_LOSS_CAP_USD — no new positions opened.' }],
      };
    } else if (navUsd >= Number(process.env.HEDGE_AUTO_MIN_NAV_USD || 30)) {
      // Auto-hedge enabled when pool NAV exceeds the configured floor (default $30,
      // matching MIN_SWAP_NAV_USD). Position sizing scales with NAV downstream so
      // small pools get proportionally smaller hedges that still respect Bluefin
      // minQty/stepSize. Set HEDGE_AUTO_MIN_NAV_USD=1000 to restore prior behavior.
      try {
        const allConfigs = await getAutoHedgeConfigs();
        const suiPoolConfig = allConfigs.find(c => 
          isSuiCommunityPool(c.portfolioId) || 
          c.portfolioId === SUI_COMMUNITY_POOL_PORTFOLIO_ID ||
          (c as any).poolAddress === process.env.NEXT_PUBLIC_SUI_POOL_STATE_ID
        );

        if (suiPoolConfig?.enabled) {
          const riskScore = aiResult.riskScore ?? 0;
          // Default threshold is moderate (5) so risk scores in the typical 4-7 range
          // can trigger protective hedges. Override per-pool via riskThreshold or
          // globally via HEDGE_RISK_THRESHOLD_DEFAULT.
          const threshold = suiPoolConfig.riskThreshold ?? Number(process.env.HEDGE_RISK_THRESHOLD_DEFAULT || 5);

          logger.info('[SUI Cron] Auto-hedge check', {
            enabled: true,
            riskScore,
            threshold,
            shouldHedge: riskScore >= threshold,
            navUsd: navUsd.toFixed(2),
          });

          if (riskScore >= threshold) {
          // Risk exceeds threshold - open protective hedges on BlueFin
          const hedges: typeof autoHedgeResult.hedges = [];
          
          // Only hedge if BlueFin credentials are configured
          if (process.env.BLUEFIN_PRIVATE_KEY) {
            try {
              const bluefin = BluefinService.getInstance();
              const leverage = safeLeverage(suiPoolConfig.maxLeverage || 3, 5);

              // ═══ PREFLIGHT — verify Bluefin account is funded & reachable ═══
              // Skip the entire hedge block (not just one asset) if the account
              // can't trade or has no margin. Avoids 3 sequential 404s per cron tick.
              let freeCollateral = 0;
              try {
                freeCollateral = await bluefin.getBalance();
              } catch (balErr) {
                logger.error('[SUI Cron] Bluefin getBalance failed — aborting hedge cycle', {
                  error: balErr instanceof Error ? balErr.message : String(balErr),
                  walletAddress: bluefin.getAddress(),
                });
                autoHedgeResult = {
                  triggered: false,
                  hedges: [{ symbol: 'PREFLIGHT', side: 'N/A', size: 0, status: 'BLOCKED',
                    error: `Bluefin account check failed: ${balErr instanceof Error ? balErr.message : String(balErr)}` }],
                };
                throw new Error('preflight-failed');
              }

              // ═══ AUTO TOP-UP — keep margin >= MIN by depositing from spot wallet ═══
              // Pulls from the operator's spot USDC into Bluefin Margin Bank when
              // freeCollateral falls below BLUEFIN_MIN_MARGIN_USD (default $20).
              // Top-up is opt-out: set BLUEFIN_AUTO_TOPUP=false to disable.
              const autoTopUpEnabled = (process.env.BLUEFIN_AUTO_TOPUP || 'true').toLowerCase() !== 'false';
              const minMargin = Number(process.env.BLUEFIN_MIN_MARGIN_USD || 20);
              const targetMargin = Number(process.env.BLUEFIN_TARGET_MARGIN_USD || 50);
              const spotReserve = Number(process.env.BLUEFIN_SPOT_RESERVE_USD || 1);
              const swapFromSui = (process.env.BLUEFIN_TOPUP_SWAP_FROM_SUI || 'true').toLowerCase() !== 'false';
              const suiReserve = Number(process.env.BLUEFIN_SUI_RESERVE || 0.5);
              const maxSwapSui = Number(process.env.BLUEFIN_MAX_SWAP_SUI || 25);
              if (autoTopUpEnabled && freeCollateral < minMargin) {
                try {
                  const topUp = await bluefinTreasury.autoTopUp({
                    minMargin, targetMargin, spotReserve,
                    swapFromSui, suiReserve, maxSwapSui,
                  });
                  if ('skipped' in topUp) {
                    logger.warn('[SUI Cron] Auto top-up skipped', topUp);
                  } else {
                    logger.info('[SUI Cron] Auto top-up executed', topUp);
                    if (topUp.ok) {
                      // Refresh free collateral after on-chain settlement
                      try { freeCollateral = await bluefin.getBalance(); } catch { /* keep stale */ }
                    }
                  }
                } catch (topUpErr) {
                  logger.error('[SUI Cron] Auto top-up failed (non-fatal)', {
                    error: topUpErr instanceof Error ? topUpErr.message : String(topUpErr),
                  });
                }
              }

              if (freeCollateral <= 0) {
                logger.warn('[SUI Cron] Bluefin freeCollateral=0 — aborting hedge cycle', {
                  walletAddress: bluefin.getAddress(),
                });
                autoHedgeResult = {
                  triggered: false,
                  hedges: [{ symbol: 'PREFLIGHT', side: 'N/A', size: 0, status: 'BLOCKED',
                    error: `Bluefin wallet ${bluefin.getAddress()} has 0 free collateral after top-up attempt. Fund operator wallet with USDC.` }],
                };
                throw new Error('preflight-no-margin');
              }
              logger.info('[SUI Cron] Bluefin preflight OK', {
                walletAddress: bluefin.getAddress(),
                freeCollateral,
              });

              // ═══════════════════════════════════════════════════════════════════
              // PREDICTION-SIGNAL GATE (defensive) — only open NEW SHORT hedges
              // when the Polymarket BTC 5-min market is qualified DOWN.
              //
              // Rationale: SHORT hedges *cost* funding + slippage. If we open one
              // and the market actually goes UP, the hedge loses money while spot
              // appreciates (wash) — but we still pay funding + execution fees.
              // To enforce "near 0 loss", we ONLY open a hedge when an external,
              // calibrated, sufficiently-confident signal agrees with the
              // protective direction (DOWN ⇒ short profitable).
              //
              // BTC signal is used as the macro proxy for ETH and SUI as well
              // (correlation > 0.7 historically). Override per-asset signals can
              // be added later, but for now BTC = market regime.
              //
              // Disable this gate (NOT RECOMMENDED) by setting
              //   HEDGE_REQUIRE_PREDICTION_SIGNAL=false
              // Tighten further with HEDGE_MIN_POLY_CONFIDENCE (default 70).
              // ═══════════════════════════════════════════════════════════════════
              const requireSignal = (process.env.HEDGE_REQUIRE_PREDICTION_SIGNAL || 'true').toLowerCase() !== 'false';
              // Hold the FULL QualifiedSignal so we can pass it to
              // `computeSafeCollateralUsd` for Kelly sizing. Previously we
              // stored only a partial copy and then approximated Kelly with
              // an ad-hoc `signalScale` — that's now replaced by the
              // calibrated path.
              let qualifiedHedgeSignal: QualifiedSignal | null = null;
              if (requireSignal) {
                try {
                  const { Polymarket5MinService } = await import('@/lib/services/market-data/Polymarket5MinService');
                  const {
                    qualifyPolymarketSignal,
                    qualifyAggregatedPrediction,
                    SIZING_LIMITS,
                  } = await import('@/lib/services/hedging/calibration');
                  const rawSig = await Polymarket5MinService.getLatest5MinSignal();
                  const qualified = qualifyPolymarketSignal(rawSig ?? undefined);
                  if (qualified) {
                    qualifiedHedgeSignal = qualified;
                    logger.info('[SUI Cron] Qualified Polymarket signal for hedge gate', {
                      direction: qualified.direction,
                      probability: qualified.probability,
                      edge: qualified.edge,
                      weight: qualified.weight,
                      source: qualified.source,
                      minConfidence: SIZING_LIMITS.MIN_POLY_CONFIDENCE,
                      minEdge: SIZING_LIMITS.MIN_EDGE,
                    });
                  } else {
                    // Fallback — try the cross-source aggregator before giving up.
                    try {
                      const { PredictionAggregatorService } = await import('@/lib/services/market-data/PredictionAggregatorService');
                      const agg = await PredictionAggregatorService.getAggregatedPrediction();
                      const qAgg = qualifyAggregatedPrediction(agg ?? undefined);
                      if (qAgg) {
                        qualifiedHedgeSignal = qAgg;
                        logger.info('[SUI Cron] Qualified aggregator signal (Polymarket fallback)', {
                          direction: qAgg.direction,
                          probability: qAgg.probability,
                          edge: qAgg.edge,
                          weight: qAgg.weight,
                          source: qAgg.source,
                        });
                      } else {
                        logger.warn('[SUI Cron] No qualified signal from Polymarket OR aggregator — skipping all NEW hedges (defensive)', {
                          rawSignalPresent: !!rawSig,
                          rawDirection: rawSig?.direction,
                          rawConfidence: rawSig?.confidence,
                          rawStrength: rawSig?.signalStrength,
                        });
                      }
                    } catch (aggErr) {
                      logger.warn('[SUI Cron] Aggregator fallback failed — skipping all NEW hedges (defensive)', {
                        error: aggErr instanceof Error ? aggErr.message : String(aggErr),
                      });
                    }
                  }
                } catch (sigErr) {
                  logger.warn('[SUI Cron] Polymarket signal fetch failed — skipping all NEW hedges (defensive)', {
                    error: sigErr instanceof Error ? sigErr.message : String(sigErr),
                  });
                }

                // Hard gate: no qualified signal → no new exposure. Period.
                if (!qualifiedHedgeSignal || qualifiedHedgeSignal.direction !== 'DOWN') {
                  autoHedgeResult = {
                    triggered: false,
                    hedges: [{
                      symbol: 'SIGNAL_GATE',
                      side: 'N/A',
                      size: 0,
                      status: 'BLOCKED',
                      error: qualifiedHedgeSignal
                        ? `Signal direction is ${qualifiedHedgeSignal.direction} (need DOWN for protective SHORT). No hedge opened.`
                        : 'No qualified DOWN signal — no hedge opened. (HEDGE_REQUIRE_PREDICTION_SIGNAL=true)',
                    }],
                  };
                  throw new Error('signal-gate-blocked');
                }
              }

              // ═══════════════════════════════════════════════════════════════════
              // PRICE-FRESHNESS GATE — `pricesUSD` was fetched at the very top
              // of the cron run. If we've been running for > MAX_SIGNAL_AGE_MS
              // (network latency, retries, slow swap legs), Bluefin's mark may
              // have moved meaningfully. Refuse to size a hedge against a stale
              // reference price. Caller can either re-fetch or this run aborts.
              // ═══════════════════════════════════════════════════════════════════
              const cronAgeMs = Date.now() - startTime;
              if (!isPriceFreshEnough(cronAgeMs)) {
                autoHedgeResult = {
                  triggered: false,
                  hedges: [{
                    symbol: 'PRICE_STALE',
                    side: 'N/A',
                    size: 0,
                    status: 'BLOCKED',
                    error: `Cron run age ${cronAgeMs}ms exceeds price-freshness window. Aborting to avoid sizing on stale mark.`,
                  }],
                };
                throw new Error('price-stale');
              }

              // ═══════════════════════════════════════════════════════════════════
              // CURRENT EXPOSURE — fail-closed read of how much we're already
              // hedged. Tries Bluefin first (authoritative), then on-chain
              // `existingHedgedValue` (already in scope from the limit-calc
              // step), then aborts. We CANNOT size correctly without knowing
              // current exposure — silently treating it as 0 would let us
              // double-hedge on top of an existing position.
              // ═══════════════════════════════════════════════════════════════════
              let currentHedgedUsd: number | null = null;
              try {
                const positions = await bluefin.getPositions();
                if (Array.isArray(positions)) {
                  currentHedgedUsd = positions.reduce((sum, p) => {
                    const notional = Math.abs(Number(p?.size || 0) * Number(p?.markPrice || 0));
                    return sum + (Number.isFinite(notional) ? notional : 0);
                  }, 0);
                }
              } catch (posErr) {
                logger.warn('[SUI Cron] Bluefin getPositions failed — falling back to on-chain hedge_state', {
                  error: posErr instanceof Error ? posErr.message : String(posErr),
                });
              }
              if (currentHedgedUsd === null || !Number.isFinite(currentHedgedUsd)) {
                if (Number.isFinite(existingHedgedValue) && existingHedgedValue >= 0) {
                  currentHedgedUsd = existingHedgedValue;
                  logger.info('[SUI Cron] Using on-chain existingHedgedValue as currentHedgedUsd fallback', {
                    currentHedgedUsd,
                  });
                } else {
                  autoHedgeResult = {
                    triggered: false,
                    hedges: [{
                      symbol: 'EXPOSURE_UNKNOWN',
                      side: 'N/A',
                      size: 0,
                      status: 'BLOCKED',
                      error: 'Could not determine current hedged exposure (Bluefin + on-chain both unavailable). Refusing to size new hedge.',
                    }],
                  };
                  throw new Error('exposure-unknown');
                }
              }

              // ═══════════════════════════════════════════════════════════════════
              // KELLY-SAFE SIZING — single authoritative source. Replaces the
              // ad-hoc `navUsd × allocation × 0.5 × signalScale` formula with
              // calibrated math: quarter-Kelly, TVL-cap (mirrors on-chain
              // max_hedge_ratio_bps), per-trade cap, $50 floor. Returns 0 if
              // any guard fails (NaN/Infinity, signal out of bounds, etc.).
              // ═══════════════════════════════════════════════════════════════════
              // After the gates above, both are guaranteed non-null. Local
              // const aliases give TS the narrowing it can't infer through the
              // throw-then-assign pattern.
              const signalForKelly: QualifiedSignal = qualifiedHedgeSignal!;
              const currentHedgedUsdSafe: number = currentHedgedUsd!;
              const kellySafeCollateralUsd = computeSafeCollateralUsd({
                signal: signalForKelly,
                poolTvlUsd: navUsd,
                currentHedgedUsd: currentHedgedUsdSafe,
                maxHedgeRatioOfTvl: maxHedgeRatioBps / 10_000,
              });
              if (kellySafeCollateralUsd <= 0) {
                autoHedgeResult = {
                  triggered: false,
                  hedges: [{
                    symbol: 'KELLY_GATE',
                    side: 'N/A',
                    size: 0,
                    status: 'BLOCKED',
                    error: `Kelly-safe collateral is 0 (TVL=$${navUsd.toFixed(2)}, currentHedged=$${currentHedgedUsdSafe.toFixed(2)}, prob=${signalForKelly.probability.toFixed(3)}, weight=${signalForKelly.weight.toFixed(2)}). No hedge opened.`,
                  }],
                };
                throw new Error('kelly-gate-blocked');
              }
              logger.info('[SUI Cron] Kelly-safe sizing computed', {
                navUsd: navUsd.toFixed(2),
                currentHedgedUsd: currentHedgedUsdSafe.toFixed(2),
                maxHedgeRatioBps,
                probability: signalForKelly.probability,
                weight: signalForKelly.weight,
                kellySafeCollateralUsd: kellySafeCollateralUsd.toFixed(2),
              });

              // BlueFin minimum order sizes and step sizes
              const PERP_SPECS: Record<string, { minQty: number; stepSize: number }> = {
                BTC: { minQty: 0.001, stepSize: 0.001 },
                ETH: { minQty: 0.01, stepSize: 0.01 },
                SUI: { minQty: 1, stepSize: 1 },
              };

              // Sweep expired in-memory tokens (still kept as a same-tick guard)
              const nowMs = Date.now();
              for (const [k, exp] of recentHedgeTokens) if (exp <= nowMs) recentHedgeTokens.delete(k);
              const HEDGE_DECISION_LOCK_TTL_S = Math.floor(HEDGE_TOKEN_TTL_MS / 1000);
              const { tryAcquireHedgeDecisionLock, releaseHedgeDecisionLock } = await import('@/lib/db/hedges');

              // Track collateral budget consumed across this cycle so we don't
              // over-commit if multiple assets cross the threshold simultaneously.
              let collateralBudgetUsed = 0;
              const collateralBudget = freeCollateral * 0.9; // keep 10% margin headroom

              // Sum of allocations among assets we'll actually hedge — used to
              // distribute the Kelly-safe pool across assets proportionally.
              const eligibleAllocSum = (['BTC', 'ETH', 'SUI'] as const)
                .map(a => aiResult.allocations[a] || 0)
                .filter(p => p >= 5)
                .reduce((s, p) => s + p, 0) || 1;

              for (const asset of ['BTC', 'ETH', 'SUI'] as const) {
                const allocation = aiResult.allocations[asset] || 0;
                if (allocation < 5) continue; // Hedge any meaningful allocation (>5%)

                // Per-asset collateral = Kelly-safe budget × this asset's allocation share
                const assetCollateralUsd = kellySafeCollateralUsd * (allocation / eligibleAllocSum);
                // Use leverage to amplify collateral into notional (notional = collateral × L)
                const effectiveValue = assetCollateralUsd * leverage;
                const sizingPrice = pricesUSD[asset] || 0;
                if (sizingPrice <= 0) {
                  logger.warn(`[SUI Cron] Skip ${asset}-PERP: no reference price`);
                  continue;
                }
                const hedgeSizeBase = effectiveValue / sizingPrice;

                // Snap to step size and check against actual BlueFin minimum
                const spec = PERP_SPECS[asset] || { minQty: 0.001, stepSize: 0.001 };
                const snappedSize = Math.floor(hedgeSizeBase / spec.stepSize) * spec.stepSize;

                if (snappedSize < spec.minQty) {
                  logger.info(`[SUI Cron] Skip ${asset}-PERP: snappedSize ${snappedSize} < minQty ${spec.minQty} (raw=${hedgeSizeBase}, leverage=${leverage})`);
                  continue;
                }

                // ═══ IDEMPOTENCY GATE — drop duplicate decisions in same window ═══
                const decisionToken = buildDecisionToken({
                  portfolioId: SUI_COMMUNITY_POOL_PORTFOLIO_ID,
                  asset,
                  side: 'SHORT',
                  riskScore,
                  now: nowMs,
                });
                if (recentHedgeTokens.has(decisionToken)) {
                  logger.info(`[SUI Cron] Skip ${asset}-PERP: duplicate decision token (in-memory)`, { token: decisionToken });
                  continue;
                }
                // Persistent guard — survives Vercel cold starts. Fails closed on DB error.
                const lockAcquired = await tryAcquireHedgeDecisionLock(decisionToken, HEDGE_DECISION_LOCK_TTL_S);
                if (!lockAcquired) {
                  logger.info(`[SUI Cron] Skip ${asset}-PERP: decision lock already held (Postgres)`, { token: decisionToken });
                  continue;
                }

                // ═══ COLLATERAL BUDGET — don't exceed wallet's free collateral ═══
                // Required margin ≈ notional / leverage (plus a small buffer for fees/funding)
                const requiredMargin = (snappedSize * sizingPrice / leverage) * 1.02;
                if (collateralBudgetUsed + requiredMargin > collateralBudget) {
                  logger.warn(`[SUI Cron] Skip ${asset}-PERP: required margin ${requiredMargin.toFixed(2)} would exceed budget`, {
                    used: collateralBudgetUsed.toFixed(2),
                    budget: collateralBudget.toFixed(2),
                    requiredMargin: requiredMargin.toFixed(2),
                  });
                  continue;
                }

                // ═══ SLIPPAGE GATE — abort if Bluefin's mark diverges from our sizing price ═══
                let bluefinPrice = sizingPrice;
                try {
                  const md = await bluefin.getMarketData(`${asset}-PERP`);
                  if (md && Number.isFinite(md.price) && md.price > 0) bluefinPrice = md.price;
                } catch (mdErr) {
                  logger.warn(`[SUI Cron] Could not fetch Bluefin mark for ${asset}-PERP, using sizingPrice`, {
                    error: mdErr instanceof Error ? mdErr.message : String(mdErr),
                  });
                }
                const slippagePct = Math.abs(bluefinPrice - sizingPrice) / sizingPrice * 100;
                if (slippagePct > HEDGE_MAX_SLIPPAGE_PCT) {
                  logger.error(`[SUI Cron] Skip ${asset}-PERP: slippage ${slippagePct.toFixed(3)}% > ${HEDGE_MAX_SLIPPAGE_PCT}%`, {
                    sizingPrice,
                    bluefinPrice,
                  });
                  continue;
                }

                try {
                  // ═══ POOL-BALANCE DRIFT CHECK — re-read pool.balance just
                  // before submit. If a deposit/withdraw has shifted TVL
                  // significantly between sizing and now, the cap math we
                  // computed at the top of Step 8 is no longer valid.
                  // Threshold: HEDGE_MAX_BALANCE_DRIFT_PCT (default 5%).
                  // Best-effort: skip on RPC failure rather than blocking
                  // (the on-chain `max_hedge_ratio_bps` is the final guard).
                  // ═══════════════════════════════════════════════════════
                  try {
                    const driftPctMax = Number(process.env.HEDGE_MAX_BALANCE_DRIFT_PCT || 5);
                    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
                    const rpcUrl = network === 'mainnet'
                      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
                      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
                    const driftClient = new SuiClient({ url: rpcUrl });
                    const poolConfig = SUI_USDC_POOL_CONFIG[network];
                    if (poolConfig.poolStateId) {
                      const obj = await driftClient.getObject({
                        id: poolConfig.poolStateId,
                        options: { showContent: true },
                      });
                      const fields = (obj.data?.content as { fields?: Record<string, unknown> } | null)?.fields;
                      if (fields) {
                        const balRaw = typeof (fields as Record<string, unknown>).balance === 'string'
                          ? (fields as Record<string, string>).balance
                          : ((fields as { balance?: { fields?: { value?: string } } }).balance?.fields?.value || '0');
                        const liveBalance = microUsdcToUsdNumber(balRaw, 'pool.balance(drift-check)');
                        if (contractBalance > 0) {
                          const driftPct = Math.abs(liveBalance - contractBalance) / contractBalance * 100;
                          if (driftPct > driftPctMax) {
                            logger.error(`[SUI Cron] Skip ${asset}-PERP: pool balance drift ${driftPct.toFixed(2)}% > ${driftPctMax}%`, {
                              sizingBalance: contractBalance.toFixed(2),
                              liveBalance: liveBalance.toFixed(2),
                            });
                            await releaseHedgeDecisionLock(decisionToken);
                            continue;
                          }
                        }
                      }
                    }
                  } catch (driftErr) {
                    logger.warn(`[SUI Cron] Pool drift check failed (non-fatal) for ${asset}-PERP`, {
                      error: driftErr instanceof Error ? driftErr.message : String(driftErr),
                    });
                  }

                  logger.info(`[SUI Cron] Attempting ${asset}-PERP hedge`, {
                    allocation,
                    assetCollateralUsd: assetCollateralUsd.toFixed(2),
                    effectiveValue: effectiveValue.toFixed(2),
                    hedgeSizeBase, snappedSize, leverage,
                    minQty: spec.minQty,
                    sizingPrice,
                    bluefinPrice,
                    slippagePct: slippagePct.toFixed(3),
                    requiredMargin: requiredMargin.toFixed(2),
                    decisionToken,
                  });

                  // Reserve token BEFORE calling Bluefin so a concurrent run can't double-fire
                  recentHedgeTokens.set(decisionToken, nowMs + HEDGE_TOKEN_TTL_MS);

                  const result = await bluefin.openHedge({
                    symbol: `${asset}-PERP`,
                    side: 'SHORT', // Protective short to hedge long spot exposure
                    size: snappedSize, // Use snapped size that meets BlueFin minimums
                    leverage,
                    portfolioId: -2, // SUI pool special ID
                    reason: `Auto-hedge: Risk ${riskScore}/10 > threshold ${threshold}/10 (token=${decisionToken})`,
                    // Wire-level idempotency: same decisionToken on retry → Bluefin
                    // dedup'd at clientOrderId → cannot create a duplicate position
                    // even if the previous response dropped between fill and ack.
                    clientOrderId: decisionToken,
                  });

                  if (!result.success) {
                    // Failed — release both locks so the next cycle can retry
                    recentHedgeTokens.delete(decisionToken);
                    await releaseHedgeDecisionLock(decisionToken);
                  } else {
                    collateralBudgetUsed += requiredMargin;
                  }

                  hedges.push({
                    symbol: `${asset}-PERP`,
                    side: 'SHORT',
                    size: snappedSize,
                    status: result.success ? 'OPENED' : 'FAILED',
                    orderId: result.orderId,
                    error: result.error,
                  });

                  // Persist successful hedges to DB for UI display
                  if (result.success && result.orderId) {
                    try {
                      await createHedge({
                        orderId: result.orderId,
                        portfolioId: SUI_COMMUNITY_POOL_PORTFOLIO_ID,
                        walletAddress: (process.env.SUI_ADMIN_ADDRESS || '').trim(),
                        asset,
                        market: `${asset}-PERP`,
                        side: 'SHORT',
                        size: snappedSize,
                        notionalValue: effectiveValue,
                        leverage,
                        entryPrice: bluefinPrice || sizingPrice,
                        simulationMode: false,
                        chain: 'sui',
                        reason: `Auto-hedge: Risk ${riskScore}/10 > threshold ${threshold}/10`,
                      });
                      logger.info(`[SUI Cron] Hedge saved to DB`, { asset, orderId: result.orderId });
                    } catch (dbErr) {
                      logger.warn(`[SUI Cron] Failed to save hedge to DB (non-critical)`, { asset, error: dbErr });
                    }
                  }

                  logger.info(`[SUI Cron] Opened ${asset} hedge`, {
                    symbol: `${asset}-PERP`,
                    side: 'SHORT',
                    size: snappedSize,
                    leverage,
                    success: result.success,
                    orderId: result.orderId,
                  });
                } catch (hedgeErr) {
                  // Always release locks on exception
                  recentHedgeTokens.delete(decisionToken);
                  await releaseHedgeDecisionLock(decisionToken);
                  hedges.push({
                    symbol: `${asset}-PERP`,
                    side: 'SHORT',
                    size: snappedSize,
                    status: 'ERROR',
                    error: hedgeErr instanceof Error ? hedgeErr.message : String(hedgeErr),
                  });
                  logger.error(`[SUI Cron] Failed to hedge ${asset}`, { error: hedgeErr });
                }
              }

              autoHedgeResult = { triggered: true, hedges };
            } catch (bfErr) {
              const msg = bfErr instanceof Error ? bfErr.message : String(bfErr);
              // preflight-failed / preflight-no-margin / signal-gate-blocked already populated autoHedgeResult above
              if (msg !== 'preflight-failed' && msg !== 'preflight-no-margin' && msg !== 'signal-gate-blocked') {
                logger.error('[SUI Cron] BlueFin hedging failed', { error: bfErr });
                autoHedgeResult = {
                  triggered: true,
                  hedges: [{ symbol: 'ALL', side: 'N/A', size: 0, status: 'ERROR', error: msg }]
                };
              }
            }
          } else {
            logger.info('[SUI Cron] Risk threshold exceeded but BLUEFIN_PRIVATE_KEY not set (hedge skipped)');
            autoHedgeResult = { triggered: false };
          }
        }
      } else {
        logger.debug('[SUI Cron] Auto-hedging disabled for SUI pool');
      }
    } catch (hedgeConfigErr) {
      logger.warn('[SUI Cron] Auto-hedge config check failed (non-critical)', { error: hedgeConfigErr });
    }
    } else if (navUsd > 0.50) {
      logger.info('[SUI Cron] Pool NAV $' + navUsd.toFixed(2) + ' too low for perp hedging (min $1000) — skipping Step 8');
    }

    // Step 9: Log AI decision to transaction history
    try {
      const decisionId = `sui_ai_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await addPoolTransactionToDb({
        id: decisionId,
        type: 'AI_DECISION',
        chain: 'sui',
        details: {
          chain: 'sui',
          agent: 'SuiPoolAgent',
          enhanced: Object.keys(enhancedContext).length > 0,
          action: aiResult.shouldRebalance ? 'REBALANCE' : 'HOLD',
          allocations: aiResult.allocations,
          confidence: aiResult.confidence,
          reasoning: aiResult.reasoning,
          swappableAssets: aiResult.swappableAssets,
          hedgedAssets: aiResult.hedgedAssets,
          riskScore: aiResult.riskScore,
          prices: pricesUSD,
          rebalanceQuotes: rebalanceSwaps,
          poolNAV_USDC: navUsd,
          poolSharePrice: sharePriceUsd,
          memberCount: poolStats.memberCount,
          ...(enhancedContext.marketSentiment && { marketSentiment: enhancedContext.marketSentiment }),
          ...(enhancedContext.urgency && { urgency: enhancedContext.urgency }),
          ...(enhancedContext.predictionSignals && { predictionSignals: enhancedContext.predictionSignals }),
          ...(enhancedContext.riskAlerts?.length && { riskAlerts: enhancedContext.riskAlerts }),
          ...(enhancedContext.correlationInsight && { correlationInsight: enhancedContext.correlationInsight }),
        },
      });
    } catch (txErr) {
      logger.warn('[SUI Cron] Transaction log failed (non-critical)', { error: txErr });
    }

    // Reconcile on-chain hedge state into the DB. The Move pool's
    // `hedge_state.active_hedges` is the source of truth — this mirrors any
    // new on-chain HedgePosition objects (real hedges + operational rebalance
    // transfers) into the `hedges` table and closes DB rows whose on-chain
    // counterpart is gone. Idempotent and non-fatal.
    let reconcile: { inserted: number; closed: number; errors: number } | undefined;
    try {
      const { reconcileSuiHedges } = await import('@/lib/services/sui/SuiHedgeReconciler');
      const r = await reconcileSuiHedges();
      reconcile = { inserted: r.inserted, closed: r.closed, errors: r.errors.length };
      if (r.inserted > 0 || r.closed > 0) {
        logger.info('[SUI Cron] Hedge reconciliation', reconcile);
      }
    } catch (recErr) {
      logger.warn('[SUI Cron] Hedge reconciliation failed (non-critical)', { error: recErr });
    }

    // Build response
    const result: SuiCronResult = {
      success: true,
      chain: 'sui',
      poolStats: {
        totalNAV_USDC: navUsd.toFixed(2),
        totalShares: poolStats.totalShares.toFixed(4),
        sharePrice: (sharePriceUsd || poolStats.sharePrice).toFixed(6),
        memberCount: poolStats.memberCount,
        allocations: aiResult.allocations,
      },
      aiDecision: {
        action: aiResult.shouldRebalance ? 'REBALANCE' : 'HOLD',
        allocations: aiResult.allocations,
        confidence: aiResult.confidence,
        reasoning: aiResult.reasoning,
        swappableAssets: aiResult.swappableAssets,
        hedgedAssets: aiResult.hedgedAssets,
        riskScore: aiResult.riskScore,
        ...(enhancedContext.marketSentiment && { marketSentiment: enhancedContext.marketSentiment }),
        ...(enhancedContext.urgency && { urgency: enhancedContext.urgency }),
        ...(enhancedContext.predictionSignals && { predictionSignals: enhancedContext.predictionSignals }),
        ...(enhancedContext.riskAlerts?.length && { riskAlerts: enhancedContext.riskAlerts }),
        ...(enhancedContext.correlationInsight && { correlationInsight: enhancedContext.correlationInsight }),
        ...(enhancedContext.recommendations?.length && { recommendations: enhancedContext.recommendations }),
      },
      pricesUSD,
      autoHedge: autoHedgeResult.triggered ? autoHedgeResult : undefined,
      rebalanceSwaps,
      ...(hedgeSettlement && { hedgeSettlement }),
      ...(gasStatus && { operatorGas: { ...gasStatus, sufficient: gasCheckPassed } }),
      ...(reconciliation && { reconciliation }),
      duration: Date.now() - startTime,
    };

    logger.info('[SUI Cron] Completed successfully', {
      duration: result.duration,
      action: result.aiDecision?.action,
      autoHedgeTriggered: autoHedgeResult.triggered,
    });

    // Update rate limit timestamp on success
    lastSuccessfulRunTimestamp = Date.now();

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[SUI Cron] Failed', { error: message });

    return NextResponse.json(
      {
        success: false,
        chain: 'sui' as const,
        error: message,
        duration: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// QStash sends POST by default — support both methods
export const POST = GET;
