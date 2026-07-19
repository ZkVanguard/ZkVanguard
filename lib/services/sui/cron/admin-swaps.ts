/**
 * Admin-wallet DEX operations.
 *
 * All the "admin wallet holds non-USDC, needs to swap" plumbing —
 * balance reads, largest-first bulk replenish via 7k aggregator, per-asset
 * targeted sell, and residual-value guard used by the settle-safety check.
 * Extracted from hedge-treasury.ts on 2026-07-19.
 */
import { logger } from '@/lib/utils/logger';
import { SUI_USDC_COIN_TYPE } from '@/lib/services/sui/SuiCommunityPoolService';
import {
  getBluefinAggregatorService,
  type PoolAsset as BluefinPoolAsset,
} from '@/lib/services/sui/BluefinAggregatorService';
import { POOL_ASSETS, type PoolAsset } from '@/lib/services/sui/cron/allocation';
import { canonicalizeCoinType } from '@/lib/services/sui/coin-type';


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
 * Read per-asset USD values held by the admin wallet (spot leg of the
 * dual-leg strategy). SUI is counted minus the 1-SUI gas reserve. USDC
 * and BlueFin margin are NOT counted here — this function returns only
 * the asset-spot values that the drift-rebalance compares against AI
 * target percentages.
 */
export async function getAdminAssetValuesUsd(
  network: 'mainnet' | 'testnet',
  pricesUSD: Record<string, number>,
): Promise<Record<PoolAsset, number>> {
  const empty: Record<PoolAsset, number> = { BTC: 0, ETH: 0, SUI: 0 };
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  if (!adminKey) return empty;
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
    const allBalances = await suiClient.getAllBalances({ owner: address });
    const result: Record<PoolAsset, number> = { BTC: 0, ETH: 0, SUI: 0 };
    // Build canonical lookup of {canonicalCoinType → PoolAsset} once.
    const canonMap = new Map<string, PoolAsset>();
    for (const a of POOL_ASSETS) {
      const assetType = aggregator.getAssetCoinType(a as BluefinPoolAsset);
      if (assetType) canonMap.set(canonicalizeCoinType(assetType), a as PoolAsset);
    }
    for (const bal of allBalances) {
      const raw = Number(bal.totalBalance);
      if (raw <= 0) continue;
      const a = canonMap.get(canonicalizeCoinType(bal.coinType));
      if (!a) continue;
      const decimals = a === 'SUI' ? 9 : 8;
      const amount = raw / Math.pow(10, decimals);
      const price = pricesUSD[a] || 0;
      let usd = 0;
      if (a === 'SUI') {
        const swappable = Math.max(0, amount - 1.0);
        usd = swappable * price;
      } else {
        usd = amount * price;
      }
      result[a] = (result[a] || 0) + usd;
    }
    return result;
  } catch (err) {
    logger.warn('[SUI Cron] getAdminAssetValuesUsd failed', { error: err instanceof Error ? err.message : String(err) });
    return empty;
  }
}


/**
 * Sell a specific dollar amount of a single asset to USDC via the 7k
 * aggregator. Used by Step 6.6 drift rebalance to free USDC from
 * overweight asset(s) for Step 7 to buy underweight ones. Unlike
 * replenishAdminUsdc (which iterates largest-first to cover a shortfall),
 * this targets one specific asset with one targeted swap.
 */
export async function sellAssetForUsdc(
  network: 'mainnet' | 'testnet',
  asset: BluefinPoolAsset,
  targetUsdc: number,
  pricesUSD: Record<string, number>,
): Promise<{ swapped: number; txDigest?: string; error?: string }> {
  if (targetUsdc < 0.10) return { swapped: 0, error: 'target below $0.10 minimum' };
  const price = pricesUSD[asset] || 0;
  if (price <= 0) return { swapped: 0, error: 'no price' };
  try {
    const aggregator = getBluefinAggregatorService(network);
    // Compute asset amount to swap (with 5% slippage buffer baked in)
    const assetAmountToSwap = (targetUsdc * 1.05) / price;
    const quote = await aggregator.getReverseSwapQuote(asset, assetAmountToSwap);
    if (!quote.canSwapOnChain || !quote.routerData) {
      return { swapped: 0, error: 'No on-chain route' };
    }
    const swapResult = await aggregator.executeSwap(quote, 0.02); // 2% slippage tolerance
    const usdcReceived = Number(swapResult.amountOut || '0') / 1e6;
    if (swapResult.success) {
      return { swapped: usdcReceived, txDigest: swapResult.txDigest };
    }
    return { swapped: 0, error: swapResult.error };
  } catch (err) {
    return { swapped: 0, error: err instanceof Error ? err.message : String(err) };
  }
}



/**
 * Sum the USD value of admin wallet's non-USDC, non-SUI-gas holdings.
 *
 * Used as a guard before settleActiveHedges: if replenishAdminUsdc only
 * partially converted wBTC/wETH/SUI back to USDC (e.g. aggregator route
 * missing for one asset, slippage tripped, RPC hiccup), settling hedges
 * with whatever USDC made it back writes a fake "realized loss" to the
 * hedge rows while the real value sits idle in the admin wallet. Skip the
 * settlement tick when residual non-USDC value > $1 so the loss path only
 * triggers after a clean replenish.
 *
 * SUI is excluded up to a small gas-reserve threshold — the cron always
 * keeps ~1 SUI for gas, not because replenishment failed.
 */
export async function getAdminNonUsdcUsdValue(
  network: 'mainnet' | 'testnet',
  prices: Record<string, number>,
): Promise<number> {
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  if (!adminKey) return 0;
  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { SuiClient, getFullnodeUrl } = await import('@mysten/sui/client');
    const keypair = adminKey.startsWith('suiprivkey')
      ? Ed25519Keypair.fromSecretKey(adminKey)
      : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
    const address = keypair.getPublicKey().toSuiAddress();
    const rpcUrl = network === 'mainnet'
      ? ((process.env.SUI_MAINNET_RPC || getFullnodeUrl('mainnet')).trim())
      : ((process.env.SUI_TESTNET_RPC || getFullnodeUrl('testnet')).trim());
    const suiClient = new SuiClient({ url: rpcUrl });
    const aggregator = getBluefinAggregatorService(network);
    const all = await suiClient.getAllBalances({ owner: address });
    let usdResidual = 0;
    const SUI_GAS_RESERVE = 1.5; // 1 SUI floor + 0.5 buffer
    for (const bal of all) {
      const raw = Number(bal.totalBalance);
      if (raw <= 0) continue;
      for (const asset of POOL_ASSETS) {
        const t = aggregator.getAssetCoinType(asset as BluefinPoolAsset);
        if (!t || bal.coinType !== t) continue;
        const decimals = asset === 'SUI' ? 9 : 8;
        const amount = raw / Math.pow(10, decimals);
        const swappable = asset === 'SUI' ? Math.max(0, amount - SUI_GAS_RESERVE) : amount;
        const price = prices[asset] || 0;
        usdResidual += swappable * price;
        break;
      }
    }
    return usdResidual;
  } catch {
    return 0;
  }
}
