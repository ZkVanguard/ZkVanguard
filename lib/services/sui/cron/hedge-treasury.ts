/**
 * SUI Community Pool — Hedge Treasury Helpers
 *
 * Pool ↔ admin USDC plumbing extracted from the cron route. These helpers
 * call the Move `open_hedge` / `close_hedge` entries to move USDC between
 * the pool balance and the admin/treasury wallet, plus a Bluefin-aggregator
 * reverse-swap helper that converts non-USDC dust back into USDC when the
 * admin runs short.
 *
 * Pure-data inputs/outputs only — no globals, no `recentHedgeTokens`. The
 * route remains the single source of truth for orchestration.
 */

import { logger } from '@/lib/utils/logger';
import {
  SUI_USDC_POOL_CONFIG,
  SUI_USDC_COIN_TYPE,
} from '@/lib/services/sui/SuiCommunityPoolService';
import {
  getBluefinAggregatorService,
  type PoolAsset as BluefinPoolAsset,
} from '@/lib/services/sui/BluefinAggregatorService';
import { POOL_ASSETS } from '@/lib/services/sui/cron/allocation';
import { canonicalizeCoinType } from '@/lib/services/sui/coin-type';

/**
 * Minimum USDC value for a meaningful on-chain hedge.
 * Below this, every close emits a deceptive sub-cent "profit" event due to
 * rounding / DEX dust, which clogs the Sui explorer and inflates win-rate stats.
 * Override with HEDGE_MIN_OPEN_USDC env var (decimal USD).
 */
export const HEDGE_MIN_OPEN_USDC = Math.max(
  0.10,
  Number(process.env.HEDGE_MIN_OPEN_USDC) || 0.10,
);

/**
 * Return USDC from admin wallet back to the pool via close_hedge.
 * This settles active hedges by returning collateral (+ optional PnL) to the pool.
 *
 * The Move contract's close_hedge:
 *  1. Finds the hedge by ID in active_hedges
 *  2. Removes it and decrements total_hedged_value
 *  3. Joins the passed-in Coin<T> into the pool balance
 *
 * This MUST be called after DEX swaps to return any unused USDC to the pool.
 */
export async function returnUsdcToPool(
  network: 'mainnet' | 'testnet',
  hedgeId: number[],
  amountUsdc: number,
  pnlUsdc: number,
  isProfit: boolean,
): Promise<{ success: boolean; txDigest?: string; error?: string }> {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const agentCapId = (process.env.SUI_AGENT_CAP_ID || process.env.SUI_ADMIN_CAP_ID || '').trim();
  const poolConfig = SUI_USDC_POOL_CONFIG[network];

  if (!adminKey || !agentCapId || !poolConfig.packageId || !poolConfig.poolStateId) {
    return { success: false, error: 'Missing admin key, agent cap, or pool config' };
  }

  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { Transaction } = await import('@mysten/sui/transactions');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    let keypair: InstanceType<typeof Ed25519Keypair>;
    try {
      keypair = adminKey.startsWith('suiprivkey')
        ? Ed25519Keypair.fromSecretKey(adminKey)
        : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
    } catch {
      return { success: false, error: 'Invalid admin key format' };
    }

    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
    const suiClient = new SuiClient({ url: rpcUrl });

    const usdcType = SUI_USDC_COIN_TYPE[network];
    const amountRaw = Math.floor(amountUsdc * 1e6);
    const pnlRaw = Math.floor(pnlUsdc * 1e6);

    // Get admin's USDC coins and merge them into a single coin for the return
    const address = keypair.getPublicKey().toSuiAddress();
    const coins = await suiClient.getCoins({ owner: address, coinType: usdcType });

    if (!coins.data || coins.data.length === 0) {
      return { success: false, error: 'Admin has no USDC coins to return' };
    }

    const totalAvailable = coins.data.reduce((sum, c) => sum + Number(c.balance), 0);
    if (totalAvailable < amountRaw) {
      return { success: false, error: `Admin only has ${(totalAvailable / 1e6).toFixed(6)} USDC, need ${amountUsdc}` };
    }

    const tx = new Transaction();

    // Merge all USDC coins into one, then split the exact amount needed
    let primaryCoin: ReturnType<typeof tx.object>;
    if (coins.data.length === 1) {
      primaryCoin = tx.object(coins.data[0].coinObjectId);
    } else {
      // Merge all coins into the first one
      primaryCoin = tx.object(coins.data[0].coinObjectId);
      const mergeCoins = coins.data.slice(1).map(c => tx.object(c.coinObjectId));
      if (mergeCoins.length > 0) {
        tx.mergeCoins(primaryCoin, mergeCoins);
      }
    }

    // Split exact amount to return to pool
    const [returnCoin] = tx.splitCoins(primaryCoin, [amountRaw]);

    tx.moveCall({
      target: `${poolConfig.packageId}::${poolConfig.moduleName}::close_hedge`,
      typeArguments: [usdcType],
      arguments: [
        tx.object(agentCapId),              // AgentCap
        tx.object(poolConfig.poolStateId!), // UsdcPoolState
        tx.pure.vector('u8', hedgeId),      // hedge_id bytes
        tx.pure.u64(pnlRaw),               // pnl_usdc
        tx.pure.bool(isProfit),             // is_profit
        returnCoin,                          // Coin<USDC> to return to pool
        tx.object('0x6'),                   // Clock
      ],
    });

    tx.setGasBudget(50_000_000);

    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showEvents: true },
    });

    const success = result.effects?.status?.status === 'success';
    if (success) {
      logger.info('[SUI Cron] close_hedge result', {
        success,
        txDigest: result.digest,
        amountUsdc,
        pnlUsdc,
        isProfit,
      });

      // DB sync: mark the corresponding row closed by hedge_id_onchain.
      // This keeps the DB authoritative even when the close came from a
      // background settlement, not the hedge-monitor cron.
      try {
        const hedgeIdHex = Buffer.from(hedgeId).toString('hex');
        const { closeHedgeByOnchainId } = await import('@/lib/db/hedges');
        const realized = isProfit ? pnlUsdc : -pnlUsdc;
        const dbRes = await closeHedgeByOnchainId({
          hedgeIdOnchain: hedgeIdHex,
          realizedPnl: realized,
          status: 'closed',
          closeTxDigest: result.digest,
        });
        if (dbRes.updated === 0) {
          logger.debug('[SUI Cron] close_hedge: no matching DB row (orphan or already closed)', {
            hedgeIdHex: hedgeIdHex.slice(0, 16),
          });
        }
      } catch (dbErr) {
        logger.warn('[SUI Cron] close_hedge DB sync failed (non-fatal)', {
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
        });
      }
    } else {
      logger.warn('[SUI Cron] close_hedge tx failed', {
        txDigest: result.digest,
        error: result.effects?.status?.error,
        amountUsdc,
        pnlUsdc,
        isProfit,
      });
    }

    return { success, txDigest: result.digest, error: success ? undefined : result.effects?.status?.error };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[SUI Cron] returnUsdcToPool failed', { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Read active hedges from on-chain pool state.
 * Returns hedge IDs and collateral amounts for settlement.
 */
export async function getActiveHedges(network: 'mainnet' | 'testnet'): Promise<Array<{
  hedgeId: number[];
  collateralUsdc: number;
  pairIndex: number;
  openTime: number;
}>> {
  const poolConfig = SUI_USDC_POOL_CONFIG[network];
  if (!poolConfig.poolStateId) return [];

  try {
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
    const suiClient = new SuiClient({ url: rpcUrl });

    const obj = await suiClient.getObject({
      id: poolConfig.poolStateId,
      options: { showContent: true },
    });
    const fields = (obj.data?.content as { fields?: Record<string, unknown> } | null)?.fields;
    const hedgeStateRaw = (fields as { hedge_state?: { fields?: { active_hedges?: unknown[] } } } | undefined)?.hedge_state;
    const hedges = hedgeStateRaw?.fields?.active_hedges || [];

    return hedges.map((h) => {
      const hf = (h as { fields?: Record<string, unknown> }).fields || (h as Record<string, unknown>);
      return {
        hedgeId: Array.isArray((hf as Record<string, unknown>).hedge_id)
          ? ((hf as Record<string, unknown>).hedge_id as number[])
          : [],
        collateralUsdc: Number((hf as Record<string, unknown>).collateral_usdc || 0) / 1e6,
        pairIndex: Number((hf as Record<string, unknown>).pair_index || 0),
        openTime: Number((hf as Record<string, unknown>).open_time || 0),
      };
    });
  } catch (err) {
    logger.warn('[SUI Cron] Failed to read active hedges', { error: err });
    return [];
  }
}

/**
 * Settle all active hedges by returning USDC from admin wallet to pool.
 * Called after DEX swap execution to ensure pool balance is restored.
 *
 * The amount returned for each hedge = original collateral (no PnL tracking
 * since the pool is USDC-denominated and token positions are held externally).
 */
export async function settleActiveHedges(
  network: 'mainnet' | 'testnet',
): Promise<{ settled: number; failed: number; details: Array<{ hedgeId: string; amount: number; success: boolean; pnl?: number; error?: string }> }> {
  const hedges = await getActiveHedges(network);
  if (hedges.length === 0) {
    logger.info('[SUI Cron] No active hedges to settle');
    return { settled: 0, failed: 0, details: [] };
  }

  // Check admin USDC balance
  const adminUsdc = await getAdminUsdcBalance(network);
  const totalNeeded = hedges.reduce((sum, h) => sum + h.collateralUsdc, 0);

  logger.info('[SUI Cron] Settling active hedges', {
    hedgeCount: hedges.length,
    totalCollateral: totalNeeded.toFixed(6),
    adminUsdc: adminUsdc.toFixed(6),
  });

  const details: Array<{ hedgeId: string; amount: number; success: boolean; pnl?: number; error?: string }> = [];
  let settled = 0;
  let failed = 0;
  let remainingUsdc = adminUsdc;

  // Distribute ALL admin USDC proportionally across hedges.
  // If assets appreciated → pool gets back MORE than collateral (profit).
  // If assets depreciated → pool gets back LESS than collateral (loss).
  for (const hedge of hedges) {
    const proportion = totalNeeded > 0 ? hedge.collateralUsdc / totalNeeded : 1 / hedges.length;
    const returnAmount = Math.min(adminUsdc * proportion, remainingUsdc);
    if (returnAmount < 0.000001) {
      logger.warn('[SUI Cron] Insufficient admin USDC to settle hedge', {
        needed: hedge.collateralUsdc,
        available: remainingUsdc,
      });
      details.push({
        hedgeId: Buffer.from(hedge.hedgeId).toString('hex').slice(0, 16),
        amount: hedge.collateralUsdc,
        success: false,
        error: 'Insufficient admin USDC',
      });
      failed++;
      continue;
    }

    const pnlAmount = Math.abs(returnAmount - hedge.collateralUsdc);
    const isProfit = returnAmount >= hedge.collateralUsdc;

    const result = await returnUsdcToPool(
      network,
      hedge.hedgeId,
      returnAmount,
      pnlAmount,
      isProfit,
    );

    details.push({
      hedgeId: Buffer.from(hedge.hedgeId).toString('hex').slice(0, 16),
      amount: returnAmount,
      success: result.success,
      pnl: isProfit ? pnlAmount : -pnlAmount,
      error: result.error,
    });

    if (result.success) {
      settled++;
      remainingUsdc -= returnAmount;
      // Small delay between transactions to avoid nonce issues
      await new Promise(r => setTimeout(r, 1500));
    } else {
      failed++;
    }
  }

  logger.info('[SUI Cron] Hedge settlement complete', { settled, failed, totalHedges: hedges.length });
  return { settled, failed, details };
}

/**
 * Replenish admin USDC by reverse-swapping non-USDC assets via Bluefin.
 *
 * When the cron needs USDC (e.g., to settle hedges or refund depositors) but
 * admin wallet is short, this swaps wBTC/ETH/SUI back to USDC automatically
 * using the Bluefin 7k aggregator.
 *
 * Strategy: swap from the largest-value non-USDC asset first to minimize fees.
 */
export async function replenishAdminUsdc(
  network: 'mainnet' | 'testnet',
  usdcShortfall: number,
  pricesUSD: Record<string, number>,
): Promise<{ swapped: number; details: Array<{ asset: string; amountSwapped: number; txDigest?: string; error?: string }> }> {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  if (!adminKey || usdcShortfall <= 0) {
    return { swapped: 0, details: [] };
  }

  const details: Array<{ asset: string; amountSwapped: number; txDigest?: string; error?: string }> = [];
  let totalSwapped = 0;
  let remainingShortfall = usdcShortfall;

  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    const keypair = adminKey.startsWith('suiprivkey')
      ? Ed25519Keypair.fromSecretKey(adminKey)
      : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
    const address = keypair.getPublicKey().toSuiAddress();

    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
    const suiClient = new SuiClient({ url: rpcUrl });

    const aggregator = getBluefinAggregatorService(network);

    // Get admin's non-USDC balances, ranked by USD value (largest first)
    const allBalances = await suiClient.getAllBalances({ owner: address });
    const candidates: Array<{ asset: BluefinPoolAsset; amount: number; valueUsd: number }> = [];

    // Build canonical lookup so `0x27792d9…` from getAllBalances matches
    // `0x027792d9…` from MAINNET_COIN_TYPES. See canonicalizeCoinType() —
    // same bug that broke getAdminAssetValuesUsd; the local (route) copy of
    // this function had the fix but the shared copy did not until 2026-07-18.
    const canonMap = new Map<string, BluefinPoolAsset>();
    for (const a of POOL_ASSETS) {
      const t = aggregator.getAssetCoinType(a as BluefinPoolAsset);
      if (t) canonMap.set(canonicalizeCoinType(t), a as BluefinPoolAsset);
    }

    const balanceDebug: Array<{ coinType: string; raw: string; matched?: string }> = [];

    for (const bal of allBalances) {
      const coinType = bal.coinType;
      const raw = Number(bal.totalBalance);
      if (raw <= 0) continue;

      // Match coin type to known assets (skip USDC and SUI gas reserve)
      const asset: BluefinPoolAsset | undefined = canonMap.get(canonicalizeCoinType(coinType));
      const decimals = asset === 'SUI' ? 9 : 8;

      balanceDebug.push({ coinType, raw: bal.totalBalance, matched: asset || undefined });

      if (!asset) continue;

      const amount = raw / Math.pow(10, decimals);
      const price = pricesUSD[asset] || 0;
      const valueUsd = amount * price;

      // Reserve a minimum SUI balance for gas (keep 1 SUI untouchable)
      if (asset === 'SUI') {
        const reserveSui = 1.0;
        const swappable = Math.max(0, amount - reserveSui);
        if (swappable <= 0) continue;
        candidates.push({ asset, amount: swappable, valueUsd: swappable * price });
      } else {
        candidates.push({ asset, amount, valueUsd });
      }
    }

    // Sort by USD value descending — swap largest holdings first
    candidates.sort((a, b) => b.valueUsd - a.valueUsd);

    logger.info('[SUI Cron] Replenish candidates', {
      shortfall: usdcShortfall.toFixed(6),
      candidates: candidates.map(c => `${c.asset}: ${c.amount.toFixed(6)} (~$${c.valueUsd.toFixed(2)})`),
      allBalances: balanceDebug,
    });

    // Swap from each asset until shortfall is covered
    for (const c of candidates) {
      if (remainingShortfall <= 0.01) break; // Done

      // Calculate how much of this asset to swap (with 5% buffer for slippage)
      const usdcTarget = Math.min(remainingShortfall * 1.05, c.valueUsd);
      // Lower floor to $0.05 so tiny orphaned dust can still be cleared.
      // Anything smaller than that can't beat gas anyway.
      if (usdcTarget < 0.05) continue;

      const price = pricesUSD[c.asset] || 0;
      if (price <= 0) continue;

      const assetAmountToSwap = Math.min(c.amount, usdcTarget / price);
      if (assetAmountToSwap <= 0) continue;

      logger.info(`[SUI Cron] Reverse swap ${c.asset} → USDC`, {
        assetAmount: assetAmountToSwap.toFixed(8),
        targetUsdc: usdcTarget.toFixed(4),
        remainingShortfall: remainingShortfall.toFixed(4),
      });

      // Try with progressively higher slippage tolerance — small/illiquid positions
      // (e.g. residual wBTC dust) often need wider slippage to clear.
      // Tightened from [2%, 5%, 10%] → [0.5%, 1%, 2%] for near-zero loss on swap legs.
      // If even 2% won't clear, hold the asset (better than realising 10% loss).
      // Override via HEDGE_REVERSE_SWAP_LADDER="0.005,0.01,0.02".
      const slippageLadder = (process.env.HEDGE_REVERSE_SWAP_LADDER || '0.005,0.01,0.02')
        .split(',')
        .map(s => Number(s.trim()))
        .filter(n => Number.isFinite(n) && n > 0 && n <= 0.10);
      let cleared = false;

      for (const slippage of slippageLadder) {
        try {
          const reverseQuote = await aggregator.getReverseSwapQuote(c.asset, assetAmountToSwap);

          if (!reverseQuote.canSwapOnChain || !reverseQuote.routerData) {
            logger.warn(`[SUI Cron] ${c.asset} → USDC not swappable on-chain, skipping`);
            details.push({ asset: c.asset, amountSwapped: 0, error: 'No on-chain route' });
            cleared = true; // Don't retry — no route exists
            break;
          }

          const swapResult = await aggregator.executeSwap(reverseQuote, slippage);
          const usdcReceived = Number(swapResult.amountOut || '0') / 1e6;

          if (swapResult.success) {
            totalSwapped += usdcReceived;
            remainingShortfall -= usdcReceived;
            details.push({
              asset: c.asset,
              amountSwapped: usdcReceived,
              txDigest: swapResult.txDigest,
            });
            logger.info(`[SUI Cron] ${c.asset} → USDC swap success`, {
              txDigest: swapResult.txDigest,
              usdcReceived: usdcReceived.toFixed(6),
              slippageUsed: slippage,
            });
            await new Promise(r => setTimeout(r, 2500));
            cleared = true;
            break;
          }

          // Failed at this slippage — retry with wider slippage if more tolerance left
          const errMsg = swapResult.error || 'unknown';
          const isSlippageError = /slippage|deviation|amount.?out/i.test(errMsg);
          if (!isSlippageError) {
            // Non-slippage error (e.g. gas, RPC) — don't retry
            details.push({ asset: c.asset, amountSwapped: 0, error: errMsg });
            logger.warn(`[SUI Cron] ${c.asset} → USDC swap failed (non-slippage)`, { error: errMsg });
            cleared = true;
            break;
          }
          logger.warn(`[SUI Cron] ${c.asset} → USDC slippage at ${(slippage * 100).toFixed(0)}% — retrying`, { error: errMsg });
        } catch (swapErr) {
          const msg = swapErr instanceof Error ? swapErr.message : String(swapErr);
          // If it's a clearly transient error, allow retry; otherwise bail
          if (!/slippage|deviation|amount.?out/i.test(msg)) {
            details.push({ asset: c.asset, amountSwapped: 0, error: msg });
            logger.warn(`[SUI Cron] Reverse swap ${c.asset} threw fatal error`, { error: msg });
            cleared = true;
            break;
          }
          logger.warn(`[SUI Cron] ${c.asset} threw at slippage ${(slippage * 100).toFixed(0)}% — retrying`, { error: msg });
        }
      }

      if (!cleared) {
        details.push({ asset: c.asset, amountSwapped: 0, error: `Failed after ${slippageLadder.length} slippage retries (up to ${slippageLadder[slippageLadder.length - 1] * 100}%)` });
        logger.warn(`[SUI Cron] ${c.asset} → USDC exhausted slippage ladder`);
      }
    }
  } catch (err) {
    logger.error('[SUI Cron] replenishAdminUsdc failed', { error: err });
  }

  return { swapped: totalSwapped, details };
}

/**
 * Transfer USDC from SUI pool contract to admin wallet using open_hedge.
 * The Move contract's open_hedge splits USDC from the pool Balance<T> and
 * sends a Coin<T> to state.treasury (the admin/treasury wallet).
 *
 * Requires: SUI_AGENT_CAP_ID env var (the AgentCap object owned by admin).
 *
 * Returns the tx digest on success, or null if transfer is not possible.
 */
export async function transferUsdcFromPoolToAdmin(
  network: 'mainnet' | 'testnet',
  amountUsdc: number,
): Promise<{ success: boolean; txDigest?: string; error?: string }> {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const agentCapId = (process.env.SUI_AGENT_CAP_ID || process.env.SUI_ADMIN_CAP_ID || '').trim();
  const poolConfig = SUI_USDC_POOL_CONFIG[network];

  if (!adminKey) {
    return { success: false, error: 'SUI_POOL_ADMIN_KEY not configured' };
  }
  if (!agentCapId) {
    return { success: false, error: 'SUI_AGENT_CAP_ID / SUI_ADMIN_CAP_ID not configured — cannot call open_hedge' };
  }
  if (!poolConfig.packageId || !poolConfig.poolStateId) {
    return { success: false, error: 'Pool package or state ID not configured' };
  }

  // Refuse to open dust hedges. They produce noise on the explorer and
  // distort the apparent win-rate without ever moving meaningful capital.
  if (amountUsdc < HEDGE_MIN_OPEN_USDC) {
    return {
      success: false,
      error: `amount $${amountUsdc.toFixed(6)} below HEDGE_MIN_OPEN_USDC=$${HEDGE_MIN_OPEN_USDC.toFixed(2)} — refusing dust open_hedge`,
    };
  }

  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { Transaction } = await import('@mysten/sui/transactions');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    let keypair: InstanceType<typeof Ed25519Keypair>;
    try {
      keypair = adminKey.startsWith('suiprivkey')
        ? Ed25519Keypair.fromSecretKey(adminKey)
        : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
    } catch {
      return { success: false, error: 'Invalid SUI_POOL_ADMIN_KEY format' };
    }

    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet'))
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet'));
    const suiClient = new SuiClient({ url: rpcUrl });

    const amountRaw = Math.floor(amountUsdc * 1e6); // USDC has 6 decimals on SUI
    const usdcType = SUI_USDC_COIN_TYPE[network];

    const tx = new Transaction();
    tx.moveCall({
      target: `${poolConfig.packageId}::${poolConfig.moduleName}::open_hedge`,
      typeArguments: [usdcType],
      arguments: [
        tx.object(agentCapId),              // AgentCap
        tx.object(poolConfig.poolStateId!), // UsdcPoolState
        tx.pure.u8(0),                       // pair_index (0 = rebalance)
        tx.pure.u64(amountRaw),             // collateral_usdc
        tx.pure.u64(1),                     // leverage (1x = spot)
        tx.pure.bool(true),                 // is_long (buying assets)
        tx.pure.string('Cron rebalance: transfer USDC from pool to admin for DEX swaps'),
        tx.object('0x6'),                   // Clock
      ],
    });

    tx.setGasBudget(50_000_000);

    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showEvents: true },
    });

    const success = result.effects?.status?.status === 'success';
    if (success) {
      logger.info('[SUI Cron] Pool → admin USDC transfer via open_hedge', {
        txDigest: result.digest,
        amountUsdc,
      });

      // DB sync: persist a synthetic row so this on-chain hedge is visible
      // to the hedge-monitor and reconciliation. Pulls the hedge_id from the
      // emitted UsdcHedgeOpened event so we can match it on close.
      try {
        const evs = (result.events || []) as Array<{ type: string; parsedJson?: Record<string, unknown> }>;
        const opened = evs.find(e => e.type.endsWith('::UsdcHedgeOpened'));
        const idArr = opened?.parsedJson?.hedge_id;
        if (Array.isArray(idArr) && idArr.length === 32) {
          const hex = Buffer.from(idArr as number[]).toString('hex');
          const { recordSuiOnchainHedge } = await import('@/lib/db/hedges');
          await recordSuiOnchainHedge({
            hedgeIdOnchain: hex,
            collateralUsdc: amountUsdc,
            pairIndex: 0, // cron always opens with pair_index=0 (rebalance)
            isLong: true,
            leverage: 1,
            txDigest: result.digest,
            walletAddress: keypair.getPublicKey().toSuiAddress(),
            reason: 'Cron rebalance: pool → admin USDC transfer',
          });
        }
      } catch (dbErr) {
        logger.warn('[SUI Cron] open_hedge DB sync failed (non-fatal)', {
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
        });
      }
    } else {
      logger.error('[SUI Cron] Pool → admin USDC transfer failed', {
        txDigest: result.digest,
        error: result.effects?.status?.error,
      });
    }

    return { success, txDigest: result.digest, error: success ? undefined : result.effects?.status?.error };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[SUI Cron] transferUsdcFromPoolToAdmin failed', { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Check admin wallet's USDC balance on SUI.
 */
export async function getAdminUsdcBalance(network: 'mainnet' | 'testnet'): Promise<number> {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  if (!adminKey) return 0;

  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    let keypair: InstanceType<typeof Ed25519Keypair>;
    try {
      keypair = adminKey.startsWith('suiprivkey')
        ? Ed25519Keypair.fromSecretKey(adminKey)
        : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
    } catch {
      return 0;
    }

    const address = keypair.getPublicKey().toSuiAddress();
    const rpcUrl = network === 'mainnet'
      ? ((process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet')).trim())
      : ((process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet')).trim());
    const suiClient = new SuiClient({ url: rpcUrl });

    const usdcType = SUI_USDC_COIN_TYPE[network];
    const balance = await suiClient.getBalance({ owner: address, coinType: usdcType });
    return Number(balance.totalBalance) / 1e6; // USDC 6 decimals
  } catch {
    return 0;
  }
}

/**
 * Read pool contract's raw on-chain state relevant to hedge/withdraw sizing.
 * All raw amounts kept as bigint to mirror Move u64 semantics exactly.
 */
export async function readPoolLiquidityState(network: 'mainnet' | 'testnet'): Promise<{
  poolBalanceRaw: bigint;
  externalNavRaw: bigint;
  totalHedgedRaw: bigint;
  totalSharesRaw: bigint;
  onchainNavRaw: bigint;
  totalNavRaw: bigint;
  poolBalanceUsdc: number;
  externalNavUsdc: number;
  totalHedgedUsdc: number;
  onchainNavUsdc: number;
  totalNavUsdc: number;
  maxHedgeRatioBps: number;
  maxSingleWithdrawalBps: number;
  dailyWithdrawalCapBps: number;
  lastHedgeTime: number;
  cooldownMs: number;
  dailyHedgedTodayRaw: bigint;
} | null> {
  const poolConfig = SUI_USDC_POOL_CONFIG[network];
  if (!poolConfig.poolStateId) return null;

  try {
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet')).trim()
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet')).trim();
    const suiClient = new SuiClient({ url: rpcUrl });

    type PoolFields = {
      balance?: string | { fields?: { value?: string }; value?: string };
      hedge_state?: { fields?: {
        total_hedged_value?: string;
        current_hedge_day?: string;
        daily_hedge_total?: string;
        auto_hedge_config?: { fields?: {
          max_hedge_ratio_bps?: string;
          last_hedge_time?: string;
          cooldown_ms?: string;
        }};
      }};
      total_shares?: string;
      max_single_withdrawal_bps?: string;
      daily_withdrawal_cap_bps?: string;
    };

    const obj = await suiClient.getObject({
      id: poolConfig.poolStateId!,
      options: { showContent: true },
    });
    const fields = (obj.data?.content as { fields?: PoolFields } | null)?.fields;
    if (!fields) return null;

    const balanceValue = typeof fields.balance === 'string'
      ? fields.balance
      : (fields.balance?.fields?.value || fields.balance?.value || '0');
    const poolBalanceRaw = BigInt(balanceValue || '0');

    const hedgeState = fields.hedge_state?.fields || {};
    const totalHedgedRaw = BigInt(hedgeState.total_hedged_value || '0');
    const cfg = hedgeState.auto_hedge_config?.fields || {};
    const maxHedgeRatioBps = Number(cfg.max_hedge_ratio_bps || 5000);
    const lastHedgeTime = Number(cfg.last_hedge_time || 0);
    const cooldownMs = Number(cfg.cooldown_ms || 300000);

    const currentDay = Math.floor(Date.now() / 86400000);
    const onChainDay = Number(hedgeState.current_hedge_day || 0);
    const dailyHedgedTodayRaw = onChainDay === currentDay
      ? BigInt(hedgeState.daily_hedge_total || '0')
      : 0n;

    const totalSharesRaw = BigInt(fields.total_shares || '0');
    const onchainNavRaw = poolBalanceRaw + totalHedgedRaw;

    // External NAV is stored in a dynamic field. Fetch it separately so
    // withdraw sizing matches what calculate_assets_for_shares sees on-chain.
    let externalNavRaw = 0n;
    try {
      const extNavObj = await suiClient.getDynamicFieldObject({
        parentId: poolConfig.poolStateId!,
        name: { type: 'vector<u8>', value: Array.from(Buffer.from('external_nav_usdc')) },
      });
      const extFields = (extNavObj.data?.content as { fields?: { value?: string } } | null)?.fields;
      externalNavRaw = BigInt(extFields?.value || '0');
    } catch {
      externalNavRaw = 0n;
    }
    const totalNavRaw = poolBalanceRaw + externalNavRaw;

    return {
      poolBalanceRaw,
      externalNavRaw,
      totalHedgedRaw,
      totalSharesRaw,
      onchainNavRaw,
      totalNavRaw,
      poolBalanceUsdc: Number(poolBalanceRaw) / 1e6,
      externalNavUsdc: Number(externalNavRaw) / 1e6,
      totalHedgedUsdc: Number(totalHedgedRaw) / 1e6,
      onchainNavUsdc: Number(onchainNavRaw) / 1e6,
      totalNavUsdc: Number(totalNavRaw) / 1e6,
      maxHedgeRatioBps,
      maxSingleWithdrawalBps: Number(fields.max_single_withdrawal_bps || 2500),
      dailyWithdrawalCapBps: Number(fields.daily_withdrawal_cap_bps || 5000),
      lastHedgeTime,
      cooldownMs,
      dailyHedgedTodayRaw,
    };
  } catch (err) {
    logger.warn('[hedge-treasury] readPoolLiquidityState failed', { error: err instanceof Error ? err.message : err });
    return null;
  }
}

/**
 * Open a minimal-size operational hedge from the pool to admin, returning the
 * hedge_id emitted by the Move event so the caller can close it in a follow-up
 * transaction. Unlike transferUsdcFromPoolToAdmin(), this variant intentionally
 * BYPASSES the HEDGE_MIN_OPEN_USDC dust guard — the caller is expected to close
 * the hedge in the same operation, netting to a top-up rather than a real hedge.
 */
async function openMicroHedgeAndGetId(
  network: 'mainnet' | 'testnet',
  collateralUsdc: number,
): Promise<{ success: boolean; txDigest?: string; hedgeId?: number[]; error?: string }> {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  // open_hedge Move signature takes `&AgentCap`, NOT `&AdminCap`. Falling back
  // to SUI_ADMIN_CAP_ID here would produce a runtime TypeMismatch: the cap
  // object types are distinct in the community_pool_usdc module.
  const agentCapId = (process.env.SUI_AGENT_CAP_ID || '').trim();
  const poolConfig = SUI_USDC_POOL_CONFIG[network];

  if (!adminKey) return { success: false, error: 'SUI_POOL_ADMIN_KEY not configured' };
  if (!agentCapId) return { success: false, error: 'SUI_AGENT_CAP_ID not configured (do NOT fall back to SUI_ADMIN_CAP_ID — Move expects AgentCap, not AdminCap)' };
  if (!poolConfig.packageId || !poolConfig.poolStateId) {
    return { success: false, error: 'Pool package or state ID not configured' };
  }
  if (collateralUsdc <= 0) return { success: false, error: 'collateralUsdc must be > 0' };

  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { Transaction } = await import('@mysten/sui/transactions');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');

    const keypair = adminKey.startsWith('suiprivkey')
      ? Ed25519Keypair.fromSecretKey(adminKey)
      : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));

    const rpcUrl = network === 'mainnet'
      ? (process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet')).trim()
      : (process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet')).trim();
    const suiClient = new SuiClient({ url: rpcUrl });

    const amountRaw = Math.max(1, Math.floor(collateralUsdc * 1e6));
    const usdcType = SUI_USDC_COIN_TYPE[network];

    const tx = new Transaction();
    tx.moveCall({
      target: `${poolConfig.packageId}::${poolConfig.moduleName}::open_hedge`,
      typeArguments: [usdcType],
      arguments: [
        tx.object(agentCapId),
        tx.object(poolConfig.poolStateId!),
        tx.pure.u8(0), // pair_index=0 (operational rebalance/topup)
        tx.pure.u64(amountRaw),
        tx.pure.u64(1),  // leverage=1x
        tx.pure.bool(true),
        tx.pure.string('Withdraw liquidity top-up: pool<->admin USDC transport'),
        tx.object('0x6'),
      ],
    });
    tx.setGasBudget(50_000_000);

    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showEvents: true },
    });

    const success = result.effects?.status?.status === 'success';
    if (!success) {
      return { success: false, txDigest: result.digest, error: result.effects?.status?.error || 'open_hedge reverted' };
    }

    const evs = (result.events || []) as Array<{ type: string; parsedJson?: Record<string, unknown> }>;
    const opened = evs.find(e => e.type.endsWith('::UsdcHedgeOpened'));
    const idArr = opened?.parsedJson?.hedge_id;
    if (!Array.isArray(idArr) || idArr.length !== 32) {
      return { success: false, txDigest: result.digest, error: 'open_hedge succeeded but hedge_id event missing' };
    }
    return { success: true, txDigest: result.digest, hedgeId: idArr as number[] };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Ensure the pool contract's USDC balance is high enough to satisfy a user
 * withdrawal for `expectedPayoutUsdc`. When the balance is short, orchestrates:
 *
 *   1. (Optional) swap admin's non-USDC assets -> USDC so the admin has enough
 *      to fund the shortfall.
 *   2. open_hedge from pool -> admin, using the LARGEST hedge collateral the
 *      pool ratios allow (bounded by MIN_RESERVE and MAX_HEDGE_RATIO). This
 *      creates a hedge_id we can close.
 *   3. close_hedge with (collateral + shortfall) USDC from admin. Net effect
 *      on state.balance: +shortfall. Pool now has enough USDC to pay the user.
 *
 * Returns { success: true, alreadyLiquid: true } as a no-op when the pool
 * balance is already sufficient — cheap to call before every withdraw.
 */
export async function ensurePoolLiquidityForWithdraw(
  network: 'mainnet' | 'testnet',
  expectedPayoutUsdc: number,
): Promise<{
  success: boolean;
  alreadyLiquid?: boolean;
  toppedUpBy?: number;
  openTxDigest?: string;
  closeTxDigest?: string;
  swapDetails?: unknown;
  error?: string;
}> {
  if (!Number.isFinite(expectedPayoutUsdc) || expectedPayoutUsdc <= 0) {
    return { success: false, error: 'expectedPayoutUsdc must be a positive number' };
  }

  // Buffer over the exact payout to survive share-price drift between this
  // preflight and the user's on-chain withdraw. 0.5% relative + $0.001 floor:
  // relative-sizing keeps small pools from over-topping-up while still
  // covering NAV movement during the round-trip.
  const target = expectedPayoutUsdc * 1.005 + 0.001;

  const state = await readPoolLiquidityState(network);
  if (!state) {
    return { success: false, error: 'Failed to read pool liquidity state' };
  }

  if (state.poolBalanceUsdc >= target) {
    return { success: true, alreadyLiquid: true };
  }

  let shortfall = target - state.poolBalanceUsdc;
  logger.info('[hedge-treasury] Pool short of withdrawal liquidity', {
    poolBalance: state.poolBalanceUsdc.toFixed(6),
    expectedPayout: expectedPayoutUsdc.toFixed(6),
    shortfall: shortfall.toFixed(6),
  });

  // Strategy A (cooldown-free): if there's an active hedge whose collateral
  // the admin can afford to return in a single close_hedge, use that — close
  // has no cooldown check. Move's `close_hedge` requires `coin::value(funds)
  // >= expected_return`, where `expected_return = collateral + pnl` for a
  // profitable settlement. So admin needs to hand over `collateral +
  // shortfall` USDC to net-add `shortfall` to state.balance.
  //
  // Strategy B (fallback): no viable existing hedge, so open a new bridge
  // hedge with a tiny collateral of our choosing, then close it. Pays the
  // cooldown check.
  const activeHedges = await getActiveHedges(network);

  // Compute the largest collateral we can push into open_hedge, bounded by
  // MIN_RESERVE_RATIO_BPS (2000 = 20%) and the state's max_hedge_ratio_bps.
  const MIN_RESERVE_RATIO_BPS = 2000;
  const dailyHedgedTodayUsdc = Number(state.dailyHedgedTodayRaw) / 1e6;
  const maxByReserve = state.poolBalanceUsdc - (state.onchainNavUsdc * MIN_RESERVE_RATIO_BPS / 10000);
  const maxHedgeTotal = state.onchainNavUsdc * state.maxHedgeRatioBps / 10000;
  const maxByRatio = Math.max(0, maxHedgeTotal - state.totalHedgedUsdc);
  const maxByDaily = Math.max(0, state.onchainNavUsdc * 0.5 - dailyHedgedTodayUsdc);
  const maxCollateral = Math.min(maxByReserve, maxByRatio, maxByDaily);

  // Read admin USDC once — we'll iterate strategies against this budget.
  let adminUsdc = await getAdminUsdcBalance(network);

  // Score reusable hedges by admin affordability: cheapest collateral first,
  // filtered to ones we can actually pay off (collateral + shortfall ≤ admin).
  const reusableHedges = [...activeHedges]
    .filter(h => h.hedgeId.length === 32)
    .sort((a, b) => a.collateralUsdc - b.collateralUsdc);
  let reuseTarget: { hedgeId: number[]; collateralUsdc: number } | null = null;
  for (const h of reusableHedges) {
    if (h.collateralUsdc + shortfall <= adminUsdc) {
      reuseTarget = h;
      break;
    }
  }

  // Fallback plan for Strategy B (only relevant if we can't reuse).
  const bridgeCollateral = Math.min(maxCollateral * 0.5, 0.10);
  const canRunStrategyB = maxCollateral > 0.000001
    && Date.now() >= state.lastHedgeTime + state.cooldownMs;

  // If we can't reuse AND can't open a bridge, try to bring admin USDC up
  // via reverse swaps and re-evaluate reuse (the cheapest existing hedge
  // may become affordable).
  if (!reuseTarget && !canRunStrategyB && reusableHedges.length > 0) {
    const cheapest = reusableHedges[0];
    const usdcNeeded = cheapest.collateralUsdc + shortfall - adminUsdc;
    if (usdcNeeded > 0) {
      try {
        const { getMarketDataService } = await import('@/lib/services/market-data/RealMarketDataService');
        const mds = getMarketDataService();
        const prices: Record<string, number> = {};
        for (const a of POOL_ASSETS) {
          try {
            const p = await mds.getTokenPrice(a);
            if (p?.price > 0) prices[a] = p.price;
          } catch { /* skip missing prices */ }
        }
        const swap = await replenishAdminUsdc(network, usdcNeeded, prices);
        logger.info('[hedge-treasury] Replenished admin USDC to afford cheapest existing hedge', {
          hedgeCollateral: cheapest.collateralUsdc.toFixed(6),
          needed: usdcNeeded.toFixed(6),
          swapped: swap.swapped.toFixed(6),
        });
        adminUsdc = await getAdminUsdcBalance(network);
        if (cheapest.collateralUsdc + shortfall <= adminUsdc) {
          reuseTarget = cheapest;
        }
      } catch (err) {
        logger.warn('[hedge-treasury] Reverse-swap for reuse path failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Last-resort partial mode: reuseTarget is null (admin can't cover
  // collateral+shortfall) AND strategy B blocked. If admin has any USDC
  // above the cheapest collateral, bridge whatever fits — better to inject
  // $17 than to bail on a $30 shortfall. Full withdraws that need capital
  // beyond admin+swap reach are inherently constrained by BlueFin free
  // collateral which lives on the exchange (no direct withdraw path yet);
  // partial bridging surfaces the most we can move today.
  if (!reuseTarget && !canRunStrategyB && reusableHedges.length > 0) {
    const cheapest = reusableHedges[0];
    if (adminUsdc > cheapest.collateralUsdc + 0.01) {
      reuseTarget = cheapest;
      logger.info('[hedge-treasury] Partial-topup path selected — bridging what admin can cover', {
        adminUsdc: adminUsdc.toFixed(4),
        cheapestCollateral: cheapest.collateralUsdc.toFixed(4),
        fullShortfall: shortfall.toFixed(4),
        maxBridgeable: (adminUsdc - cheapest.collateralUsdc).toFixed(4),
      });
    }
  }

  // Nothing viable — surface a clear error.
  if (!reuseTarget && !canRunStrategyB) {
    const cooldownRemainingS = Math.max(0, Math.ceil((state.lastHedgeTime + state.cooldownMs - Date.now()) / 1000));
    return {
      success: false,
      error: reusableHedges.length > 0
        ? `Cannot top up: cheapest existing hedge collateral is $${reusableHedges[0].collateralUsdc.toFixed(4)}, admin has $${adminUsdc.toFixed(4)} (need $${(reusableHedges[0].collateralUsdc + shortfall).toFixed(4)}). Bridge hedge blocked: ${cooldownRemainingS}s cooldown or capacity=$${maxCollateral.toFixed(4)}.`
        : `Cannot top up: no existing hedge to reuse and bridge hedge blocked (${cooldownRemainingS}s cooldown, maxCollateral=$${maxCollateral.toFixed(4)}).`,
    };
  }

  // Ensure admin has enough USDC for the chosen path. If not, reverse-swap.
  const chosenCollateral = reuseTarget ? reuseTarget.collateralUsdc : bridgeCollateral;
  const adminNeedsUsdc = shortfall + chosenCollateral;
  if (adminUsdc < adminNeedsUsdc) {
    const usdcShortfall = adminNeedsUsdc - adminUsdc;
    try {
      const { getMarketDataService } = await import('@/lib/services/market-data/RealMarketDataService');
      const mds = getMarketDataService();
      const prices: Record<string, number> = {};
      for (const a of POOL_ASSETS) {
        try {
          const p = await mds.getTokenPrice(a);
          if (p?.price > 0) prices[a] = p.price;
        } catch { /* skip missing prices */ }
      }
      const swap = await replenishAdminUsdc(network, usdcShortfall, prices);
      logger.info('[hedge-treasury] Replenished admin USDC for withdraw top-up', {
        needed: usdcShortfall.toFixed(6),
        swapped: swap.swapped.toFixed(6),
      });
      adminUsdc = await getAdminUsdcBalance(network);
      // If still short, DON'T bail — bridge whatever admin now has. Better
      // to inject $18 than to reject the whole withdraw. Effective shortfall
      // becomes what admin can actually cover after paying the collateral.
      if (adminUsdc < adminNeedsUsdc) {
        const feasibleShortfall = Math.max(0, adminUsdc - chosenCollateral - 0.01);
        if (feasibleShortfall < 0.01) {
          return {
            success: false,
            error: `Admin has $${adminUsdc.toFixed(4)} USDC after swap attempt; needs $${adminNeedsUsdc.toFixed(4)} to top up pool.`,
            swapDetails: swap.details,
          };
        }
        logger.info('[hedge-treasury] Reducing to partial top-up', {
          adminAfterSwap: adminUsdc.toFixed(4),
          fullShortfall: shortfall.toFixed(4),
          feasibleShortfall: feasibleShortfall.toFixed(4),
        });
        shortfall = feasibleShortfall;
      }
    } catch (err) {
      return {
        success: false,
        error: `Failed to swap admin assets -> USDC: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Execute chosen strategy.
  let hedgeId: number[];
  let openTxDigest: string | undefined;
  let closingCollateral: number;
  if (reuseTarget) {
    hedgeId = reuseTarget.hedgeId;
    closingCollateral = reuseTarget.collateralUsdc;
    logger.info('[hedge-treasury] Reusing existing hedge for top-up (cooldown-free path)', {
      hedgeId: Buffer.from(hedgeId).toString('hex').slice(0, 16),
      collateralUsdc: closingCollateral.toFixed(6),
      activeCount: activeHedges.length,
    });
  } else {
    const openResult = await openMicroHedgeAndGetId(network, bridgeCollateral);
    if (!openResult.success || !openResult.hedgeId) {
      return { success: false, error: openResult.error || 'open_hedge failed', openTxDigest: openResult.txDigest };
    }
    hedgeId = openResult.hedgeId;
    openTxDigest = openResult.txDigest;
    closingCollateral = bridgeCollateral;
    await new Promise(r => setTimeout(r, 500));
  }

  const returnAmount = closingCollateral + shortfall;
  const closeResult = await returnUsdcToPool(
    network,
    hedgeId,
    returnAmount,
    shortfall,     // pnl_usdc — treated as profit accrual back to pool
    true,          // is_profit
  );

  if (!closeResult.success) {
    return {
      success: false,
      error: reuseTarget
        ? `close_hedge failed on existing hedge: ${closeResult.error || 'unknown'}.`
        : `open_hedge succeeded but close_hedge failed: ${closeResult.error || 'unknown'}. Hedge left open; cron will reconcile.`,
      openTxDigest,
      closeTxDigest: closeResult.txDigest,
    };
  }

  logger.info('[hedge-treasury] Pool topped up for withdrawal', {
    strategy: reuseTarget ? 'A (reuse existing hedge)' : 'B (open new bridge)',
    shortfall: shortfall.toFixed(6),
    closingCollateral: closingCollateral.toFixed(6),
    openTx: openTxDigest,
    closeTx: closeResult.txDigest,
  });

  return {
    success: true,
    toppedUpBy: shortfall,
    openTxDigest,
    closeTxDigest: closeResult.txDigest,
  };
}
