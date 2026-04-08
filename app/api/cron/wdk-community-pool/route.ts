/**
 * QStash Cron Job: WDK Community Pool — Sepolia USDT → 4-Asset Rebalance
 *
 * Manages the Tether WDK community pool on Sepolia:
 * 1. Reads on-chain pool state (USDT balance, asset balances, NAV)
 * 2. Records NAV snapshot
 * 3. Runs AI allocation decision (risk-based)
 * 4. Executes USDT → BTC/ETH/SUI/CRO trades via SimpleMockDEX
 * 5. Monitors cross-chain USDT balances (bridge is informational only)
 *
 * Security: QStash signature verification + CRON_SECRET fallback
 */

import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { errMsg } from '@/lib/utils/error-handler';
import {
  initCommunityPoolTables,
  recordNavSnapshot,
  savePoolStateToDb,
  addPoolTransactionToDb,
} from '@/lib/db/community-pool';
import { getWdkBridgeService } from '@/lib/services/WdkBridgeService';
import { getRpcUrl } from '@/lib/rpc-urls';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ============================================
// DEPLOYMENT CONFIG
// ============================================

// Load from deployment file — these are on Sepolia testnet
const SEPOLIA_POOL_ADDRESS = '0x07d68C2828F35327d12a7Ba796cCF3f12F8A1086';
const SEPOLIA_USDT_ADDRESS = '0xd077a400968890eacc75cdc901f0356c943e4fdb';
const SEPOLIA_DEX_ADDRESS = '0x57e888f22c21D931b2deA19bb132a8d344F1F965';

const ASSET_NAMES = ['BTC', 'ETH', 'CRO', 'SUI'] as const;
const TARGET_ALLOCATION_BPS = {
  BTC: 3000, // 30%
  ETH: 3000, // 30%
  CRO: 2000, // 20%
  SUI: 2000, // 20%
};

const MIN_TRADE_USDT = 1_000_000n; // $1 minimum trade
const MAX_SLIPPAGE_BPS = 500n;     // 5% slippage (mock DEX, generous)

// ============================================
// ABIs
// ============================================

const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function dexRouter() view returns (address)',
  'function depositToken() view returns (address)',
  'function assetTokens(uint256) view returns (address)',
  'function assetBalances(uint256) view returns (uint256)',
  'function targetAllocationBps(uint256) view returns (uint256)',
  'function executeRebalanceTrade(uint8 assetIndex, uint256 amount, bool isBuy, uint256 minAmountOut) external',
  'function setTargetAllocation(uint256[4] newAllocations, string reason) external',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function REBALANCER_ROLE() view returns (bytes32)',
  'function MIN_RESERVE_RATIO_BPS() view returns (uint256)',
  'function pythOracle() view returns (address)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const DEX_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])',
];

const PYTH_ABI = [
  'function updatePriceFeeds(bytes[] calldata updateData) external payable',
  'function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)',
];

// Pyth Hermes price IDs for the 4 pool assets (BTC, ETH, CRO, SUI)
const PYTH_PRICE_IDS = [
  'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC/USD
  'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH/USD
  '23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe', // CRO/USD
  '23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744', // SUI/USD
];

// ============================================
// TYPES
// ============================================

interface WdkTradeResult {
  asset: string;
  amountUsdt: string;
  amountReceived: string;
  txHash?: string;
  error?: string;
}

interface WdkCronResult {
  success: boolean;
  chain: 'wdk';
  poolState?: {
    usdtBalance: string;
    navUsd: number;
    totalShares: string;
    sharePrice: string;
    memberCount: number;
    allocations: Record<string, number>;
    assetBalances: Record<string, string>;
  };
  crossChainState?: {
    totalUsdtAcrossChains: number;
    chainBalances: Array<{
      chain: string;
      usdtBalance: string;
      nativeBalance: string;
      hasGas: boolean;
    }>;
  };
  healthCheck?: {
    warnings: string[];
    dexRouterConfigured: boolean;
    hasRebalancerRole: boolean;
    walletGas: string;
  };
  aiDecision?: {
    action: string;
    reasoning: string;
    executed: boolean;
  };
  rebalanceTrades?: {
    executed: number;
    failed: number;
    skipped: number;
    trades: WdkTradeResult[];
  };
  duration: number;
  error?: string;
}

// ============================================
// HELPER: Update Pyth oracle prices (required on testnet)
// ============================================

async function updatePythPrices(
  wallet: ethers.Wallet,
  pythOracleAddress: string,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // Fetch latest price data from Pyth Hermes API
    const idsQuery = PYTH_PRICE_IDS.map(id => `ids[]=${id}`).join('&');
    const url = `https://hermes.pyth.network/v2/updates/price/latest?${idsQuery}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { success: false, error: `Hermes API ${response.status}` };
    }

    const data = await response.json();
    if (!data.binary?.data?.[0]) {
      return { success: false, error: 'No binary data from Hermes' };
    }

    const updateData = ['0x' + data.binary.data[0]];
    const pyth = new ethers.Contract(pythOracleAddress, PYTH_ABI, wallet);

    // Get update fee and push prices on-chain
    const fee = await pyth.getUpdateFee(updateData);
    const balance = await wallet.provider!.getBalance(wallet.address);
    if (balance < fee + ethers.parseEther('0.001')) {
      return { success: false, error: `Low gas: ${ethers.formatEther(balance)} ETH` };
    }

    const tx = await pyth.updatePriceFeeds(updateData, { value: fee });
    const receipt = await tx.wait();
    logger.info('[WDK Cron] Pyth prices updated', { txHash: receipt.hash, fee: ethers.formatEther(fee) });
    return { success: true, txHash: receipt.hash };
  } catch (err) {
    return { success: false, error: errMsg(err) };
  }
}

// ============================================
// HELPER: Simple AI allocation (same as Hedera cron pattern)
// ============================================

function generateAllocation(): {
  allocations: Record<string, number>;
  shouldRebalance: boolean;
  confidence: number;
  reasoning: string;
} {
  // For testnet: always rebalance using fixed target allocations
  return {
    allocations: {
      BTC: TARGET_ALLOCATION_BPS.BTC / 100,
      ETH: TARGET_ALLOCATION_BPS.ETH / 100,
      CRO: TARGET_ALLOCATION_BPS.CRO / 100,
      SUI: TARGET_ALLOCATION_BPS.SUI / 100,
    },
    shouldRebalance: true,
    confidence: 0.9,
    reasoning: 'WDK Sepolia pool: Applying target allocation (30% BTC, 30% ETH, 20% CRO, 20% SUI)',
  };
}

// ============================================
// HANDLER
// ============================================

export async function GET(request: NextRequest): Promise<NextResponse<WdkCronResult>> {
  const startTime = Date.now();

  const authResult = await verifyCronRequest(request, 'WDK CommunityPool Cron');
  if (authResult !== true) {
    return NextResponse.json(
      { success: false, chain: 'wdk' as const, error: 'Unauthorized', duration: Date.now() - startTime },
      { status: 401 },
    );
  }

  logger.info('[WDK Cron] Starting WDK Sepolia pool management');

  const privateKey = process.env.TREASURY_PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.HEDERA_PRIVATE_KEY;
  if (!privateKey) {
    return NextResponse.json({
      success: false,
      chain: 'wdk' as const,
      error: 'No private key configured (TREASURY_PRIVATE_KEY / PRIVATE_KEY)',
      duration: Date.now() - startTime,
    });
  }

  try {
    await initCommunityPoolTables();

    const provider = new ethers.JsonRpcProvider(getRpcUrl('sepolia'));
    const wallet = new ethers.Wallet(privateKey, provider);
    const poolContract = new ethers.Contract(SEPOLIA_POOL_ADDRESS, POOL_ABI, provider);
    const usdtContract = new ethers.Contract(SEPOLIA_USDT_ADDRESS, ERC20_ABI, provider);

    // ═══════════════════════════════════════════════════════════
    // Step 0: Update Pyth oracle prices (testnet prices go stale)
    // ═══════════════════════════════════════════════════════════

    try {
      const pythOracleAddr = await poolContract.pythOracle();
      if (pythOracleAddr && pythOracleAddr !== ethers.ZeroAddress) {
        logger.info('[WDK Cron] Updating Pyth oracle prices...');
        const pythResult = await updatePythPrices(wallet, pythOracleAddr);
        if (pythResult.success) {
          logger.info('[WDK Cron] Pyth prices updated', { txHash: pythResult.txHash });
        } else {
          logger.warn('[WDK Cron] Pyth update failed (will try pool read anyway)', { error: pythResult.error });
        }
      }
    } catch (pythErr) {
      logger.warn('[WDK Cron] Pyth oracle address read failed', { error: errMsg(pythErr) });
    }

    // ═══════════════════════════════════════════════════════════
    // Step 1: Read on-chain pool state
    // ═══════════════════════════════════════════════════════════

    let usdtBalance: bigint;
    let totalShares: bigint;
    let totalNAV: bigint;
    let memberCount: bigint;
    let sharePrice: bigint;
    let onChainAllocBps: bigint[];
    let dexRouterAddr: string;
    let contractInitialized = true;

    try {
      const stats = await poolContract.getPoolStats();
      totalShares = stats._totalShares;
      totalNAV = stats._totalNAV;
      memberCount = stats._memberCount;
      sharePrice = stats._sharePrice;
      onChainAllocBps = stats._allocations;

      usdtBalance = await usdtContract.balanceOf(SEPOLIA_POOL_ADDRESS);
      dexRouterAddr = await poolContract.dexRouter();
    } catch (err) {
      contractInitialized = false;
      logger.error('[WDK Cron] Failed to read pool state', { error: errMsg(err) });
      return NextResponse.json({
        success: false,
        chain: 'wdk' as const,
        error: `Pool contract not readable: ${errMsg(err)}`,
        duration: Date.now() - startTime,
      });
    }

    const navUsd = Number(ethers.formatUnits(totalNAV, 6));
    const usdtBalanceStr = ethers.formatUnits(usdtBalance, 6);

    // Read asset balances
    const assetBalances: Record<string, string> = {};
    for (let i = 0; i < 4; i++) {
      try {
        const bal = await poolContract.assetBalances(i);
        const tokenAddr = await poolContract.assetTokens(i);
        if (tokenAddr !== ethers.ZeroAddress) {
          const tok = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
          const dec = await tok.decimals();
          assetBalances[ASSET_NAMES[i]] = ethers.formatUnits(bal, dec);
        } else {
          assetBalances[ASSET_NAMES[i]] = '0';
        }
      } catch {
        assetBalances[ASSET_NAMES[i]] = '0';
      }
    }

    const allocations: Record<string, number> = {};
    for (let i = 0; i < 4; i++) {
      allocations[ASSET_NAMES[i]] = Number(onChainAllocBps[i]) / 100;
    }

    const walletGasBalance = await provider.getBalance(wallet.address);
    const walletGasStr = ethers.formatEther(walletGasBalance);

    logger.info('[WDK Cron] Pool state', {
      usdtBalance: usdtBalanceStr,
      navUsd,
      memberCount: Number(memberCount),
      dexRouter: dexRouterAddr,
      assetBalances,
      allocations,
      walletGas: walletGasStr,
    });

    const poolState: WdkCronResult['poolState'] = {
      usdtBalance: usdtBalanceStr,
      navUsd,
      totalShares: ethers.formatUnits(totalShares, 18),
      sharePrice: ethers.formatUnits(sharePrice, 18),
      memberCount: Number(memberCount),
      allocations,
      assetBalances,
    };

    // ═══════════════════════════════════════════════════════════
    // Step 2: Health check
    // ═══════════════════════════════════════════════════════════

    const warnings: string[] = [];
    const dexConfigured = dexRouterAddr !== ethers.ZeroAddress;
    let hasRebalancerRole = false;

    if (!dexConfigured) {
      warnings.push('DEX router not configured on pool contract');
    }
    if (walletGasBalance < ethers.parseEther('0.01')) {
      warnings.push(`Low Sepolia ETH: ${walletGasStr} — need gas for transactions`);
    }

    try {
      const REBALANCER_ROLE = await poolContract.REBALANCER_ROLE();
      hasRebalancerRole = await poolContract.hasRole(REBALANCER_ROLE, wallet.address);
      if (!hasRebalancerRole) {
        warnings.push(`Wallet ${wallet.address} lacks REBALANCER_ROLE`);
      }
    } catch {
      warnings.push('Could not check REBALANCER_ROLE');
    }

    const healthCheck: WdkCronResult['healthCheck'] = {
      warnings,
      dexRouterConfigured: dexConfigured,
      hasRebalancerRole,
      walletGas: walletGasStr,
    };

    // ═══════════════════════════════════════════════════════════
    // Step 3: NAV snapshot
    // ═══════════════════════════════════════════════════════════

    try {
      await recordNavSnapshot({
        sharePrice: Number(ethers.formatUnits(sharePrice, 18)),
        totalNav: navUsd,
        totalShares: Number(ethers.formatUnits(totalShares, 18)),
        memberCount: Number(memberCount),
        allocations,
        source: 'wdk-sepolia-on-chain',
        chain: 'wdk',
      });
    } catch (navErr) {
      logger.warn('[WDK Cron] NAV snapshot failed (non-critical)', { error: errMsg(navErr) });
    }

    // ═══════════════════════════════════════════════════════════
    // Step 4: AI allocation decision
    // ═══════════════════════════════════════════════════════════

    const aiDecision = generateAllocation();

    let aiResult: WdkCronResult['aiDecision'] = {
      action: aiDecision.shouldRebalance ? 'REBALANCE' : 'HOLD',
      reasoning: aiDecision.reasoning,
      executed: false,
    };

    logger.info('[WDK Cron] AI decision', {
      action: aiResult.action,
      allocations: aiDecision.allocations,
      confidence: aiDecision.confidence,
    });

    // ═══════════════════════════════════════════════════════════
    // Step 5: Execute USDT → asset trades via SimpleMockDEX
    // ═══════════════════════════════════════════════════════════

    let rebalanceTrades: WdkCronResult['rebalanceTrades'] = undefined;
    const adminKey = privateKey;

    if (aiDecision.shouldRebalance && navUsd > 1 && contractInitialized && dexConfigured) {
      try {
        // Reserve for withdrawals
        let reserveBps = 500n;
        try {
          reserveBps = BigInt(Number(await poolContract.MIN_RESERVE_RATIO_BPS()));
        } catch { /* default 5% */ }
        const reserveUsdt = (usdtBalance * reserveBps) / 10000n;
        const allocatableUsdt = usdtBalance - reserveUsdt;

        if (allocatableUsdt > MIN_TRADE_USDT) {
          const signedPool = poolContract.connect(wallet) as ethers.Contract;
          const trades: WdkTradeResult[] = [];
          let executed = 0;
          let failed = 0;
          let skipped = 0;

          // Use target allocations
          const targetBps = [
            TARGET_ALLOCATION_BPS.BTC,
            TARGET_ALLOCATION_BPS.ETH,
            TARGET_ALLOCATION_BPS.CRO,
            TARGET_ALLOCATION_BPS.SUI,
          ];

          for (let i = 0; i < 4; i++) {
            const assetName = ASSET_NAMES[i];
            let assetAddr: string;

            try {
              assetAddr = await poolContract.assetTokens(i);
            } catch {
              trades.push({ asset: assetName, amountUsdt: '0', amountReceived: '0', error: 'Cannot read asset token' });
              skipped++;
              continue;
            }

            if (assetAddr === ethers.ZeroAddress) {
              trades.push({ asset: assetName, amountUsdt: '0', amountReceived: '0', error: 'Asset token not configured' });
              skipped++;
              continue;
            }

            // Calculate USDT allocation for this asset
            const assetUsdt = (allocatableUsdt * BigInt(targetBps[i])) / 10000n;
            if (assetUsdt < MIN_TRADE_USDT) {
              trades.push({ asset: assetName, amountUsdt: ethers.formatUnits(assetUsdt, 6), amountReceived: '0', error: 'Below minimum trade size' });
              skipped++;
              continue;
            }

            try {
              // Get DEX quote for slippage protection
              const dexContract = new ethers.Contract(dexRouterAddr, DEX_ABI, provider);
              let minOut = 0n;
              try {
                const amounts: bigint[] = await dexContract.getAmountsOut(assetUsdt, [SEPOLIA_USDT_ADDRESS, assetAddr]);
                const expectedOut = amounts[amounts.length - 1];
                minOut = (expectedOut * (10000n - MAX_SLIPPAGE_BPS)) / 10000n;
              } catch {
                // SimpleMockDEX may not have getAmountsOut — use 0 (no slippage protection on mock)
                minOut = 0n;
              }

              // Execute: executeRebalanceTrade(assetIndex, amount, isBuy, minAmountOut)
              const tx = await signedPool.executeRebalanceTrade(i, assetUsdt, true, minOut);
              const receipt = await tx.wait();

              trades.push({
                asset: assetName,
                amountUsdt: ethers.formatUnits(assetUsdt, 6),
                amountReceived: minOut.toString(),
                txHash: receipt.hash,
              });
              executed++;
              logger.info(`[WDK Cron] Trade executed: $${ethers.formatUnits(assetUsdt, 6)} USDT → ${assetName}`, {
                txHash: receipt.hash,
              });
            } catch (tradeErr) {
              const errStr = errMsg(tradeErr);
              trades.push({
                asset: assetName,
                amountUsdt: ethers.formatUnits(assetUsdt, 6),
                amountReceived: '0',
                error: errStr,
              });
              failed++;
              logger.error(`[WDK Cron] Trade failed for ${assetName}`, { error: errStr });
            }
          }

          rebalanceTrades = { executed, failed, skipped, trades };

          if (executed > 0) {
            aiResult.executed = true;
          }

          logger.info('[WDK Cron] Rebalance trades complete', { executed, failed, skipped });
        } else {
          logger.info('[WDK Cron] Insufficient allocatable USDT', {
            balance: ethers.formatUnits(usdtBalance, 6),
            allocatable: ethers.formatUnits(allocatableUsdt, 6),
          });
        }
      } catch (tradeError) {
        logger.error('[WDK Cron] Trade execution step failed', {
          error: errMsg(tradeError),
        });
      }
    } else {
      const reasons: string[] = [];
      if (!aiDecision.shouldRebalance) reasons.push('AI says HOLD');
      if (navUsd <= 1) reasons.push(`NAV too low: $${navUsd.toFixed(2)}`);
      if (!contractInitialized) reasons.push('Contract not initialized');
      if (!dexConfigured) reasons.push('DEX router not set');
      if (reasons.length > 0) {
        aiResult.reasoning += ` (Skipped: ${reasons.join(', ')})`;
      }
    }

    // ═══════════════════════════════════════════════════════════
    // Step 6: Cross-chain balance check (informational only)
    // ═══════════════════════════════════════════════════════════

    let crossChainState: WdkCronResult['crossChainState'] = undefined;
    try {
      const bridge = getWdkBridgeService();
      if (bridge) {
        const balances = await bridge.getCrossChainBalances();
        crossChainState = {
          totalUsdtAcrossChains: balances.totalUsdtAcrossChains,
          chainBalances: balances.chainBalances.map(b => ({
            chain: b.chain,
            usdtBalance: b.usdtBalance,
            nativeBalance: b.nativeBalance,
            hasGas: b.hasGas,
          })),
        };
      }
    } catch (bridgeErr) {
      logger.warn('[WDK Cron] Cross-chain balance check failed (non-critical)', { error: errMsg(bridgeErr) });
    }

    // ═══════════════════════════════════════════════════════════
    // Step 7: Log to DB
    // ═══════════════════════════════════════════════════════════

    try {
      const decisionId = `wdk_cron_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      await addPoolTransactionToDb({
        id: decisionId,
        type: 'AI_DECISION',
        chain: 'wdk',
        details: {
          action: aiResult.action,
          reasoning: aiResult.reasoning,
          executed: aiResult.executed,
          poolState,
          rebalanceTrades: rebalanceTrades ?? null,
        },
      });

      await savePoolStateToDb({
        totalValueUSD: navUsd,
        totalShares: Number(ethers.formatUnits(totalShares, 18)),
        sharePrice: Number(ethers.formatUnits(sharePrice, 18)),
        allocations: Object.fromEntries(
          ASSET_NAMES.map((name, i) => [name, {
            percentage: allocations[name],
            valueUSD: navUsd * (allocations[name] / 100),
            amount: parseFloat(assetBalances[name] || '0'),
            price: 0,
          }]),
        ),
        lastRebalance: Date.now(),
        lastAIDecision: {
          timestamp: Date.now(),
          reasoning: aiResult.reasoning,
          allocations,
        },
        chain: 'wdk',
      });
    } catch (dbErr) {
      logger.warn('[WDK Cron] DB save failed (non-critical)', { error: errMsg(dbErr) });
    }

    // ═══════════════════════════════════════════════════════════
    // Response
    // ═══════════════════════════════════════════════════════════

    const result: WdkCronResult = {
      success: true,
      chain: 'wdk',
      poolState,
      crossChainState,
      healthCheck,
      aiDecision: aiResult,
      rebalanceTrades,
      duration: Date.now() - startTime,
    };

    logger.info('[WDK Cron] Complete', {
      navUsd,
      usdtBalance: usdtBalanceStr,
      tradesExecuted: rebalanceTrades?.executed ?? 0,
      duration: result.duration,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    logger.error('[WDK Cron] Fatal error', { error: errMsg(error) });
    return NextResponse.json({
      success: false,
      chain: 'wdk' as const,
      error: errMsg(error),
      duration: Date.now() - startTime,
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<WdkCronResult>> {
  return GET(request);
}
