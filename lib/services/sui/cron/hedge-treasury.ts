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

    // Normalize SUI coin type strings for comparison (RPC may return different
    // address case/padding than our static config).
    const normalizeCoinType = (t: string): string => {
      const parts = t.split('::');
      if (parts.length !== 3) return t.toLowerCase();
      const addr = parts[0].toLowerCase().replace(/^0x/, '').replace(/^0+/, '') || '0';
      return `0x${addr}::${parts[1]}::${parts[2]}`;
    };

    const balanceDebug: Array<{ coinType: string; raw: string; matched?: string }> = [];

    for (const bal of allBalances) {
      const coinType = bal.coinType;
      const raw = Number(bal.totalBalance);
      if (raw <= 0) continue;

      // Match coin type to known assets (skip USDC and SUI gas reserve)
      let asset: BluefinPoolAsset | null = null;
      let decimals = 8;

      const normBal = normalizeCoinType(coinType);
      for (const a of POOL_ASSETS) {
        const assetType = aggregator.getAssetCoinType(a as BluefinPoolAsset);
        if (assetType && normalizeCoinType(assetType) === normBal) {
          asset = a as BluefinPoolAsset;
          decimals = a === 'SUI' ? 9 : 8;
          break;
        }
      }

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
