/**
 * VVS Swap SDK Service
 * Wrapper for @vvs-finance/swap-sdk to enable swaps on Cronos Testnet
 */

import { 
  fetchBestTrade, 
  executeTrade,
  approveIfNeeded,
  PoolType, 
  BuiltInChainId,
  utils as SwapSdkUtils,
  type Trade
} from '@vvs-finance/swap-sdk';
import type { Signer } from 'ethers';

export interface VVSSwapQuote {
  amountIn: string;
  amountOut: string;
  priceImpact: number;
  route: string[];
  trade: Trade;
  formattedTrade: string;
}

export class VVSSwapSDKService {
  private chainId: number;
  private quoteApiClientId: string | undefined;

  constructor(chainId: number = 338) {
    this.chainId = chainId;
    // Quote API Client ID (optional - request from VVS Discord if needed for production)
    this.quoteApiClientId = process.env.NEXT_PUBLIC_VVS_QUOTE_API_CLIENT_ID || 
                            process.env[`SWAP_SDK_QUOTE_API_CLIENT_ID_${chainId}`];
  }

  /**
   * Get the best trade quote from VVS Finance
   */
  async getQuote(
    inputToken: string,
    outputToken: string,
    amount: string
  ): Promise<VVSSwapQuote> {
    try {
      // Convert token addresses (use "NATIVE" for CRO)
      const inputTokenArg = inputToken === 'CRO' || inputToken === 'TCRO' ? 'NATIVE' : inputToken;
      const outputTokenArg = outputToken === 'CRO' || outputToken === 'TCRO' ? 'NATIVE' : outputToken;

      console.log('🔄 Fetching VVS swap quote:', {
        chainId: this.chainId,
        inputToken: inputTokenArg,
        outputToken: outputTokenArg,
        amount,
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
      console.log('✅ VVS quote received:', formattedTrade);

      // Extract route information
      const route = this.extractRoute(trade);

      // Calculate price impact (if available)
      const priceImpact = this.calculatePriceImpact(trade);

      return {
        amountIn: amount,
        amountOut: trade.outputAmount.toExact(),
        priceImpact,
        route,
        trade,
        formattedTrade,
      };
    } catch (error) {
      console.error('Failed to fetch VVS quote:', error);
      throw new Error(`Failed to fetch swap quote: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Execute a swap using VVS SDK
   */
  async executeSwap(
    trade: Trade,
    signer: Signer
  ): Promise<{ hash: string; success: boolean }> {
    try {
      console.log('🔄 Executing VVS swap...');

      // Step 1: Approve token if needed
      const approvalTx = await approveIfNeeded(this.chainId, trade, signer);
      if (approvalTx) {
        console.log('✅ Token approval tx:', approvalTx.hash);
        await approvalTx.wait();
        console.log('✅ Token approved');
      }

      // Step 2: Execute the trade
      const tx = await executeTrade(this.chainId, trade, signer);
      console.log('✅ Swap tx submitted:', tx.hash);

      return {
        hash: tx.hash,
        success: true,
      };
    } catch (error) {
      console.error('Failed to execute VVS swap:', error);
      throw new Error(`Swap failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
        const tradeData = trade as any;
        
        if (tradeData.route?.path) {
          return tradeData.route.path.map((token: any) => 
            token.symbol || token.address
          );
        }
        
        if (tradeData.swaps) {
          const tokens = new Set<string>();
          tokens.add(tradeData.inputAmount?.currency?.symbol || 'Unknown');
          tradeData.swaps.forEach((swap: any) => {
            if (swap.route?.path) {
              swap.route.path.forEach((token: any) => {
                tokens.add(token.symbol || token.address);
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
      console.warn('Failed to extract route:', error);
      return ['Input Token', 'Output Token'];
    }
  }

  /**
   * Calculate price impact from trade
   */
  private calculatePriceImpact(trade: Trade): number {
    try {
      const tradeData = trade as any;
      
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
      console.warn('Failed to calculate price impact:', error);
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
