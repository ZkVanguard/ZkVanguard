/**
 * BluefinService.dryRunHedge — extracted as a pure orchestrator.
 *
 * Validates a hedge parameter tuple against every check `openHedge`
 * would run (auth, account onboarding, pair, leverage, size, market
 * data, order construction, signing) WITHOUT submitting the order.
 * Used by `/api/admin/bluefin-trace-order` for pre-mainnet verification
 * and by BluefinAggregatorService's route probes.
 *
 * Takes a `DryRunContext` object so the function can be tested and
 * reused without pulling the whole BluefinService class into the caller.
 */
import crypto from 'crypto';
import { logger } from '@/lib/utils/logger';
import { BLUEFIN_PAIRS, BLUEFIN_NETWORKS } from '@/lib/services/sui/BluefinService';
import { snapToStepSize } from '@/lib/services/sui/bluefin-order-size';
import type { OrderSignedFields } from '@/lib/services/sui/bluefin/sign-request';

export interface DryRunContext {
  accessToken: string | null;
  walletAddress: string | null;
  network: 'mainnet' | 'testnet';
  /** Bound apiRequest (exchange-api caller for /v1/account read). */
  apiRequest<T>(method: 'GET', path: string, body: undefined, apiType: 'exchange'): Promise<T>;
  /** Bound getMarketData for the price/funding fetch. */
  getMarketData(symbol: string): Promise<{
    price: number;
    fundingRate: number;
    change24h?: number;
    openInterestUsd?: number;
  } | null>;
  /** Bound signer that builds the same fields shape openHedge would. */
  signOrder(fields: OrderSignedFields): Promise<string>;
}

export interface DryRunParams {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  leverage: number;
}

export interface DryRunStep {
  step: string;
  passed: boolean;
  detail: string;
}

export interface DryRunResult {
  success: boolean;
  steps: DryRunStep[];
  order?: Record<string, unknown>;
  error?: string;
}

export async function performDryRunHedge(
  ctx: DryRunContext,
  params: DryRunParams,
): Promise<DryRunResult> {
  const steps: DryRunStep[] = [];

  try {
    // Step 1: Authentication
    const hasToken = !!ctx.accessToken;
    steps.push({
      step: 'auth',
      passed: hasToken,
      detail: hasToken
        ? `JWT token acquired for ${ctx.walletAddress}`
        : 'No token — auth failed',
    });
    if (!hasToken) return { success: false, steps, error: 'Authentication failed' };

    // Step 2: Account onboarding check
    let freeCollateral = '0';
    try {
      const acctResp = await ctx.apiRequest<Record<string, unknown> | null>(
        'GET',
        `/api/v1/account?accountAddress=${ctx.walletAddress}`,
        undefined,
        'exchange',
      );
      const e9 = acctResp?.marginAvailableE9;
      if (e9 !== undefined && e9 !== null) {
        const n = parseFloat(String(e9));
        freeCollateral = Number.isFinite(n) ? (n / 1e9).toFixed(6) : '0';
      } else {
        freeCollateral = String(acctResp?.freeCollateral ?? '0');
      }
      steps.push({
        step: 'account', passed: true,
        detail: `Onboarded, freeCollateral=${freeCollateral}`,
      });
    } catch {
      steps.push({
        step: 'account', passed: false,
        detail: `Account ${ctx.walletAddress} NOT onboarded — register at https://trade.bluefin.io`,
      });
    }

    // Step 3: Validate pair
    const pair = Object.values(BLUEFIN_PAIRS).find((p) => p.symbol === params.symbol);
    if (!pair) {
      steps.push({ step: 'pair', passed: false, detail: `Invalid pair: ${params.symbol}` });
      return { success: false, steps, error: `Invalid pair: ${params.symbol}` };
    }
    steps.push({
      step: 'pair', passed: true,
      detail: `${pair.symbol} — maxLeverage=${pair.maxLeverage}x, minQty=${pair.minQuantity}, step=${pair.stepSize}`,
    });

    // Step 4: Leverage
    const leverageOk = params.leverage <= pair.maxLeverage;
    steps.push({
      step: 'leverage', passed: leverageOk,
      detail: `${params.leverage}x (max ${pair.maxLeverage}x)`,
    });

    // Step 4b: Minimum order size + step validation
    const sizeOk = params.size >= pair.minQuantity;
    const steppedSize = snapToStepSize(params.size, pair.stepSize);
    steps.push({
      step: 'order-size',
      passed: sizeOk && steppedSize >= pair.minQuantity,
      detail: `size=${params.size}, min=${pair.minQuantity}, snapped=${steppedSize}, step=${pair.stepSize}`,
    });

    // Step 5: Market data
    const marketData = await ctx.getMarketData(params.symbol);
    const price = marketData?.price || 0;
    steps.push({
      step: 'market-data', passed: price > 0,
      detail: price > 0
        ? `${params.symbol} price=$${price.toFixed(2)}, funding=${marketData?.fundingRate?.toFixed(6) || 'n/a'}`
        : 'No price data',
    });

    // Step 6: Order construction
    const quantityE9 = Math.floor(params.size * 1e9).toString();
    const leverageE9 = Math.floor(params.leverage * 1e9).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const signedAtMillis = Date.now();
    const salt = (Date.now() + crypto.randomInt(1000000)).toString();
    const networkConfig = BLUEFIN_NETWORKS[ctx.network];
    const signedFields: OrderSignedFields = {
      idsId: networkConfig.idsId,
      accountAddress: ctx.walletAddress!,
      symbol: params.symbol,
      priceE9: '0',
      quantityE9,
      leverageE9,
      side: params.side,
      isIsolated: true,   // ISOLATED only — see openHedge writeup
      expiresAtMillis: expiresAt,
      salt,
      signedAtMillis,
    };
    const notionalValue = params.size * price;
    steps.push({
      step: 'order-construction', passed: true,
      detail: `${params.side} ${params.size.toFixed(6)} ${pair.baseAsset} (~$${notionalValue.toFixed(2)}) @ market, 1x leverage`,
    });

    // Step 7: Signature
    try {
      const signature = await ctx.signOrder(signedFields);
      steps.push({
        step: 'signature', passed: !!signature,
        detail: `Signed (${signature.slice(0, 20)}...)`,
      });
      const allPassed = steps.every((s) => s.passed);
      return {
        success: allPassed, steps,
        order: {
          signedFields,
          signature: signature.slice(0, 30) + '...',
          type: 'MARKET',
          notionalValueUsd: notionalValue,
          wouldSubmitTo: `${networkConfig.tradeApiUrl}/api/v1/trade/orders`,
        },
      };
    } catch (sigErr) {
      steps.push({
        step: 'signature', passed: false,
        detail: `Signing failed: ${sigErr instanceof Error ? sigErr.message : String(sigErr)}`,
      });
      return { success: false, steps, error: 'Signature failed' };
    }
  } catch (error) {
    logger.warn('[dryRunHedge] unexpected failure', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false, steps,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
