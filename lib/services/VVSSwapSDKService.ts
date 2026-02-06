/**
 * VVS Swap SDK Service
 * Wrapper for @vvs-finance/swap-sdk to enable swaps on Cronos Testnet
 */

import { logger } from '../utils/logger';
import { 
  fetchBestTrade, 
  executeTrade,
  approveIfNeeded,
  PoolType, 
  BuiltInChainId,
  utils as SwapSdkUtils,
  type Trade
} from '@vvs-finance/swap-sdk';
import { ethers } from 'ethers';
import type { Signer } from 'ethers';
import { X402GaslessService } from './X402GaslessService';
import { addTransactionToCache } from '../utils/transactionCache';

export interface VVSSwapQuote {
  amountIn: string;
  amountOut: string;
  priceImpact: number;
  route: string[];
  trade: Trade;
  formattedTrade: string;
}

/** Extended trade data shape (VVS SDK runtime properties beyond type definitions) */
interface VVSTradeData {
  amountOut?: {
    amount?: { numerator: unknown; denominator: unknown };
    toExact?: () => string;
    toSignificant?: (digits: number) => string;
  };
  outputAmount?: {
    toExact?: () => string;
    toSignificant?: (digits: number) => string;
    currency?: { symbol?: string; address?: string };
    quotient?: { toString: () => string };
  };
  inputAmount?: {
    toExact?: () => string;
    toSignificant?: (digits: number) => string;
    currency?: { symbol?: string; address?: string };
    quotient?: { toString: () => string };
  };
  minimumAmountOut?: {
    quotient?: { toString: () => string };
  };
  route?: {
    path?: Array<{ symbol?: string; address?: string }>;
  };
  swaps?: Array<{
    route?: {
      path?: Array<{ symbol?: string; address?: string }>;
    };
  }>;
  priceImpact?: {
    toSignificant: (digits: number) => string;
  };
}

export class VVSSwapSDKService {
  private chainId: number;
  private quoteApiClientId: string | undefined;

  constructor(chainId: number = BuiltInChainId.CRONOS_TESTNET) {
    this.chainId = chainId;
    // Quote API Client ID - check multiple environment variable patterns
    // VVS SDK looks for SWAP_SDK_QUOTE_API_CLIENT_ID_{chainId}
    const envKey = `SWAP_SDK_QUOTE_API_CLIENT_ID_${chainId}`;
    this.quoteApiClientId = 
      process.env[envKey] || // Server-side env variable
      process.env.NEXT_PUBLIC_VVS_QUOTE_API_CLIENT_ID || // Public fallback
      (typeof window !== 'undefined' ? (window as unknown as Record<string, string | undefined>)[envKey] : undefined); // Client-side fallback
    
    logger.debug(`VVS SDK initialized for chain ${chainId}`, {
      envKey,
      hasApiKey: !!this.quoteApiClientId,
      apiKeyPreview: this.quoteApiClientId ? `${this.quoteApiClientId.slice(0, 8)}...` : 'none',
      processEnvKeys: Object.keys(process.env).filter(k => k.includes('VVS') || k.includes('SWAP_SDK')),
    });
  }

  /**
   * Get the best trade quote from VVS Finance
   * Uses official @vvs-finance/swap-sdk
   */
  async getQuote(
    inputToken: string,
    outputToken: string,
    amount: string
  ): Promise<VVSSwapQuote> {
    try {
      // Convert token inputs - VVS SDK accepts 'NATIVE' for native CRO
      const inputTokenArg = inputToken === 'CRO' || inputToken === 'TCRO' ? 'NATIVE' : inputToken;
      const outputTokenArg = outputToken === 'CRO' || outputToken === 'TCRO' ? 'NATIVE' : outputToken;

      logger.debug('Fetching VVS swap quote', {
        chainId: this.chainId,
        inputToken: inputTokenArg,
        outputToken: outputTokenArg,
        amount,
        quoteApiClientId: this.quoteApiClientId ? `${this.quoteApiClientId.slice(0, 8)}...` : 'none',
      });

      // Fetch best trade using VVS SDK
      const trade = await fetchBestTrade(
        this.chainId,
        inputTokenArg,
        outputTokenArg,
        amount,
        {
          poolTypes: [
            PoolType.V2,
            PoolType.V3_100,
            PoolType.V3_500,
            PoolType.V3_3000,
            PoolType.V3_10000,
          ],
          maxHops: 3,
          maxSplits: 2,
          quoteApiClientId: this.quoteApiClientId,
        }
      );

      const formattedTrade = SwapSdkUtils.formatTrade(trade);
      logger.info('VVS quote received', { formattedTrade });

      // Extract route information
      const route = this.extractRoute(trade);

      // Calculate price impact (if available)
      const priceImpact = this.calculatePriceImpact(trade);

      // Extract output amount from trade object
      // VVS SDK trade object has: type, amountIn, amountOut, routes, price, lpFeeRatio, lpFee, slippage
      // amountOut structure: { amount: Fraction, address, symbol, decimals }
      let amountOut = '0';
      const tradeAny = trade as unknown as VVSTradeData;
      
      // Try to extract from amountOut object structure
      if (tradeAny.amountOut) {
        if (tradeAny.amountOut.amount?.numerator !== undefined && tradeAny.amountOut.amount?.denominator !== undefined) {
          // It's a Fraction - calculate the decimal value
          const num = Number(tradeAny.amountOut.amount.numerator);
          const denom = Number(tradeAny.amountOut.amount.denominator);
          amountOut = (num / denom).toFixed(8);
        } else if (typeof tradeAny.amountOut === 'string') {
          amountOut = tradeAny.amountOut;
        } else if (tradeAny.amountOut.toExact) {
          amountOut = tradeAny.amountOut.toExact();
        } else if (tradeAny.amountOut.toSignificant) {
          amountOut = tradeAny.amountOut.toSignificant(8);
        }
      }
      // Try outputAmount (older SDK versions)
      else if (tradeAny.outputAmount?.toExact) {
        amountOut = tradeAny.outputAmount.toExact();
      }
      
      // Fallback: parse from formatted trade string: "X.XXXXX TOKEN => Y.YYYYY TOKEN (...)"
      if (amountOut === '0' || !amountOut) {
        const match = formattedTrade.match(/=>\s*([\d.]+)/);
        if (match) {
          amountOut = match[1];
        }
      }
      
      logger.debug('Extracted amountOut', { amountOut });

      return {
        amountIn: amount,
        amountOut,
        priceImpact,
        route,
        trade,
        formattedTrade,
      };
    } catch (error) {
      logger.error('Failed to fetch VVS quote', error);
      throw new Error(`Failed to fetch swap quote: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Execute a swap using VVS SDK with optional x402 gasless support
   * Automatically detects if gasless mode should be used
   */
  async executeSwap(
    trade: Trade,
    signer: Signer,
    options?: { forceGasless?: boolean; forceRegular?: boolean }
  ): Promise<{ hash: string; success: boolean; gasless?: boolean; gasSaved?: string }> {
    try {
      const userAddress = await signer.getAddress();
      
      // Determine if we should use gasless mode
      let useGasless = options?.forceGasless || false;
      
      if (!options?.forceRegular && !options?.forceGasless) {
        // Auto-detect based on user's situation
        const recommendation = await X402GaslessService.shouldUseGasless(
          signer.provider!,
          userAddress
        );
        useGasless = recommendation.shouldUse;
        
        if (useGasless) {
          logger.info('Using x402 gasless mode', { reason: recommendation.reason });
        }
      }

      // If gasless mode is requested/recommended, try it first
      if (useGasless) {
        try {
          const result = await this.executeSwapGasless(trade, signer);
          if (result.success) {
            return result;
          }
          logger.warn('Gasless swap failed, falling back to regular swap');
        } catch (gaslessError) {
          logger.warn('Gasless swap error, falling back to regular', { error: String(gaslessError) });
        }
      }

      // Execute regular swap
      logger.info('Executing regular VVS swap');

      // Step 1: Approve token if needed
      const approvalTx = await approveIfNeeded(this.chainId, trade, signer);
      if (approvalTx) {
        logger.info('Token approval tx', { hash: approvalTx.hash });
        await approvalTx.wait();
        logger.info('Token approved');
      }

      // Step 2: Execute the trade
      const tx = await executeTrade(this.chainId, trade, signer);
      logger.info('Swap tx submitted', { hash: tx.hash });

      // Cache the transaction
      const senderAddress = await signer.getAddress();
      const tradeAny = trade as unknown as VVSTradeData;
      addTransactionToCache({
        hash: tx.hash,
        type: 'swap',
        status: 'pending',
        timestamp: Date.now(),
        from: senderAddress,
        to: '0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae', // VVS Router
        value: tradeAny.inputAmount?.toSignificant(6) || '0',
        tokenSymbol: tradeAny.inputAmount?.currency?.symbol || 'Unknown',
        description: `Swap tokens via VVS`,
      });

      return {
        hash: tx.hash,
        success: true,
        gasless: false,
      };
    } catch (error) {
      logger.error('Failed to execute VVS swap', error);
      throw new Error(`Swap failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Execute swap using x402 gasless protocol
   */
  private async executeSwapGasless(
    trade: Trade,
    signer: Signer
  ): Promise<{ hash: string; success: boolean; gasless: boolean; gasSaved?: string }> {
    const userAddress = await signer.getAddress();
    const tradeData = trade as unknown as VVSTradeData;

    // Extract swap parameters
    const inputToken = tradeData.inputAmount?.currency?.address || '';
    const outputToken = tradeData.outputAmount?.currency?.address || '';
    const amountIn = tradeData.inputAmount?.quotient?.toString() || '0';
    const amountOutMin = tradeData.minimumAmountOut?.quotient?.toString() || '0';
    
    // Build path from trade route
    const path = [inputToken, outputToken];
    const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes

    // Execute gasless swap via x402
    const result = await X402GaslessService.executeGaslessSwap(signer, {
      tokenIn: inputToken,
      tokenOut: outputToken,
      amountIn,
      amountOutMin,
      path,
      userAddress,
      deadline,
    });

    if (!result.success) {
      throw new Error(result.error || 'Gasless swap failed');
    }

    // Cache the gasless swap
    if (result.txHash) {
      addTransactionToCache({
        hash: result.txHash,
        type: 'swap',
        status: 'success',
        timestamp: Date.now(),
        from: userAddress,
        to: '0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae',
        value: ethers.formatUnits(amountIn, 18),
        tokenSymbol: 'Token',
        gasUsed: '0',
        description: 'Gasless Swap via X402',
      });
    }

    return {
      hash: result.txHash || '',
      success: true,
      gasless: true,
      gasSaved: result.gasSponsored,
    };
  }

  /**
   * Extract route from trade
   */
  private extractRoute(trade: Trade): string[] {
    try {
      // Try to extract route from trade object
      // VVS SDK trade structure may vary, so handle gracefully
      if (trade && typeof trade === 'object') {
        // Check for common route patterns
        const tradeData = trade as unknown as VVSTradeData;
        
        if (tradeData.route?.path) {
          return tradeData.route.path.map((token) => 
            token.symbol || token.address || 'Unknown'
          );
        }
        
        if (tradeData.swaps) {
          const tokens = new Set<string>();
          tokens.add(tradeData.inputAmount?.currency?.symbol || 'Unknown');
          tradeData.swaps.forEach((swap) => {
            if (swap.route?.path) {
              swap.route.path.forEach((token) => {
                tokens.add(token.symbol || token.address || 'Unknown');
              });
            }
          });
          tokens.add(tradeData.outputAmount?.currency?.symbol || 'Unknown');
          return Array.from(tokens);
        }

        // Fallback: just input and output tokens
        return [
          tradeData.inputAmount?.currency?.symbol || 'Input',
          tradeData.outputAmount?.currency?.symbol || 'Output',
        ];
      }

      return ['Unknown', 'Unknown'];
    } catch (error) {
      logger.warn('Failed to extract route', { error: String(error) });
      return ['Input Token', 'Output Token'];
    }
  }

  /**
   * Calculate price impact from trade
   */
  private calculatePriceImpact(trade: Trade): number {
    try {
      const tradeData = trade as unknown as VVSTradeData;
      
      // Check if priceImpact is directly available
      if (tradeData.priceImpact !== undefined) {
        return parseFloat(tradeData.priceImpact.toSignificant(2));
      }

      // Fallback: estimate from amounts
      // This is a rough estimate
      const inputAmount = parseFloat(tradeData.inputAmount?.toExact() || '0');
      const outputAmount = parseFloat(tradeData.outputAmount?.toExact() || '0');

      if (inputAmount > 0 && outputAmount > 0) {
        // Simple price impact estimation (not accurate without price data)
        return 0.1; // Return small default impact
      }

      return 0;
    } catch (error) {
      logger.warn('Failed to calculate price impact', { error: String(error) });
      return 0;
    }
  }

  /**
   * Get supported chains
   */
  static getSupportedChains(): { chainId: number; name: string }[] {
    return [
      { chainId: BuiltInChainId.CRONOS_MAINNET, name: 'Cronos Mainnet' },
      { chainId: BuiltInChainId.CRONOS_TESTNET, name: 'Cronos Testnet' },
    ];
  }

  /**
   * Check if chain is supported
   */
  static isChainSupported(chainId: number): boolean {
    return chainId === BuiltInChainId.CRONOS_MAINNET || 
           chainId === BuiltInChainId.CRONOS_TESTNET;
  }
}

// Export singleton for Cronos Testnet
let vvsSDKService: VVSSwapSDKService | null = null;

export function getVVSSwapSDKService(chainId: number = 338): VVSSwapSDKService {
  if (!vvsSDKService || vvsSDKService['chainId'] !== chainId) {
    vvsSDKService = new VVSSwapSDKService(chainId);
  }
  return vvsSDKService;
}
