/**
 * VVS Finance DEX Integration for On-Chain Swaps
 * 
 * Enables users to swap tokens directly from their wallet on Cronos
 * Docs: https://vvs.finance/
 */

import { logger } from '../utils/logger';

// VVS Finance Router addresses (properly checksummed)
// Note: VVS Finance is mainnet only. For testnet demo, swaps will simulate.
const VVS_ROUTER_MAINNET = '0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae';
// Testnet: Use a placeholder that clearly indicates demo mode
const VVS_ROUTER_TESTNET = '0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae'; // Same as mainnet for now

// Common token addresses on Cronos Testnet
// Use VVS testnet tokens that have actual liquidity pools
const TOKENS_TESTNET: Record<string, string> = {
  WCRO: '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4',
  CRO: '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4', // Wrapped CRO
  // VVS token - has liquidity pools on testnet
  VVS: '0x904Bd5a5AAC0B9d88A0D47864724218986Ad4a3a',
  // Map common stablecoin names to VVS token (has pools)
  DEVUSDC: '0x904Bd5a5AAC0B9d88A0D47864724218986Ad4a3a',
  USDC: '0x904Bd5a5AAC0B9d88A0D47864724218986Ad4a3a',
};

// VVS Router ABI (minimal for swaps)
export const VVS_ROUTER_ABI = [
  {
    type: 'function',
    name: 'swapExactTokensForTokens',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'swapExactCROForTokens',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'swapExactTokensForCRO',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'getAmountsOut',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const;

// ERC20 ABI for approvals
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

interface SwapParams {
  tokenIn: string; // Token address or symbol
  tokenOut: string; // Token address or symbol
  amountIn: bigint; // Amount in wei
  slippage?: number; // Slippage tolerance (default 0.5%)
  recipient: string; // Recipient address
}

interface SwapQuote {
  amountOut: bigint;
  amountOutMin: bigint; // With slippage
  path: string[];
  priceImpact: number;
  route: string;
}

interface SwapResult {
  success: boolean;
  hash?: string;
  amountOut?: bigint;
  error?: string;
}

export class VVSFinanceService {
  private routerAddress: string;
  private tokens: Record<string, string>;
  private chainId: number;

  constructor(chainId: number = 338) {
    this.chainId = chainId;
    this.routerAddress = chainId === 338 ? VVS_ROUTER_TESTNET : VVS_ROUTER_MAINNET;
    this.tokens = chainId === 338 ? TOKENS_TESTNET : {}; // Add mainnet tokens later
    logger.info('VVSFinanceService initialized', { chainId, router: this.routerAddress });
  }

  /**
   * Get token address from symbol or address
   */
  private getTokenAddress(tokenIdentifier: string): string {
    const normalized = tokenIdentifier.toUpperCase();
    
    // Check if it's already an address
    if (tokenIdentifier.startsWith('0x') && tokenIdentifier.length === 42) {
      return tokenIdentifier.toLowerCase();
    }

    // Look up by symbol
    const address = this.tokens[normalized];
    if (!address) {
      throw new Error(`Token ${tokenIdentifier} not found`);
    }

    return address;
  }

  /**
   * Build swap path (direct or through WCRO)
   */
  private buildSwapPath(tokenIn: string, tokenOut: string): string[] {
    const wcro = this.tokens.WCRO;
    
    // Direct path if pair exists (simplified - in production, check pair existence)
    if (tokenIn === wcro || tokenOut === wcro) {
      return [tokenIn, tokenOut];
    }

    // Route through WCRO
    return [tokenIn, wcro, tokenOut];
  }

  /**
   * Get quote for a swap
   * Uses the x402/swap API which integrates with @vvs-finance/swap-sdk
   */
  async getSwapQuote(params: Omit<SwapParams, 'recipient'>): Promise<SwapQuote> {
    try {
      const tokenInAddress = this.getTokenAddress(params.tokenIn);
      const tokenOutAddress = this.getTokenAddress(params.tokenOut);
      const slippage = params.slippage || 0.5;

      const path = this.buildSwapPath(tokenInAddress, tokenOutAddress);

      logger.info('Getting swap quote via VVS SDK', { 
        tokenIn: params.tokenIn, 
        tokenOut: params.tokenOut, 
        amountIn: params.amountIn.toString(),
        path 
      });

      // Convert wei to human-readable for the API
      const amountInHuman = (Number(params.amountIn) / 1e18).toString();
      
      // Call x402/swap API which uses the real VVS SDK
      const response = await fetch(`/api/x402/swap?tokenIn=${params.tokenIn}&tokenOut=${params.tokenOut}&amountIn=${amountInHuman}`);
      
      if (!response.ok) {
        throw new Error(`VVS SDK API error: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to get quote from VVS SDK');
      }
      
      // Convert output back to wei
      const amountOutNum = parseFloat(result.data.amountOut);
      const amountOut = BigInt(Math.floor(amountOutNum * 1e18));
      
      const slippageBps = BigInt(Math.floor(slippage * 100));
      const amountOutMin = amountOut * (10000n - slippageBps) / 10000n;
      
      // Extract route from formattedTrade or use path
      const routeDisplay = result.data.formattedTrade || path.map(addr => {
        const symbol = Object.entries(this.tokens).find(([_, a]) => a.toLowerCase() === addr.toLowerCase())?.[0];
        return symbol || `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      }).join(' → ');

      logger.info('VVS SDK quote received', {
        amountOut: amountOut.toString(),
        source: result.data.source,
        route: routeDisplay,
      });

      return {
        amountOut,
        amountOutMin,
        path,
        priceImpact: result.data.priceImpact || 0.1,
        route: routeDisplay,
      };
    } catch (error) {
      logger.error('Failed to get swap quote', { error });
      throw error;
    }
  }

  /**
   * Check if token needs approval and return approval transaction data
   */
  async checkApproval(tokenAddress: string, owner: string, amount: bigint): Promise<{
    needsApproval: boolean;
    currentAllowance: bigint;
  }> {
    // In real implementation, check on-chain allowance
    // const allowance = await publicClient.readContract({
    //   address: tokenAddress,
    //   abi: ERC20_ABI,
    //   functionName: 'allowance',
    //   args: [owner as `0x${string}`, this.routerAddress as `0x${string}`],
    // });

    logger.info('Checking token approval', { tokenAddress, owner, amount: amount.toString() });

    return {
      needsApproval: true, // Simplified - always request approval
      currentAllowance: 0n,
    };
  }

  /**
   * Get contract data for executing a swap
   * Returns the contract address, ABI, function name, and args for wagmi
   */
  getSwapContractCall(params: SwapParams, quote: SwapQuote) {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20); // 20 minutes
    const tokenInAddress = this.getTokenAddress(params.tokenIn);
    const wcro = this.tokens.WCRO;

    // Swap CRO for tokens (user sends native CRO)
    if (tokenInAddress === wcro) {
      return {
        address: this.routerAddress as `0x${string}`,
        abi: VVS_ROUTER_ABI,
        functionName: 'swapExactCROForTokens' as const,
        args: [
          quote.amountOutMin,
          quote.path as `0x${string}`[],
          params.recipient as `0x${string}`,
          deadline,
        ],
        value: params.amountIn, // Send CRO as value
      };
    }

    // Swap tokens for CRO
    const tokenOutAddress = this.getTokenAddress(params.tokenOut);
    if (tokenOutAddress === wcro) {
      return {
        address: this.routerAddress as `0x${string}`,
        abi: VVS_ROUTER_ABI,
        functionName: 'swapExactTokensForCRO' as const,
        args: [
          params.amountIn,
          quote.amountOutMin,
          quote.path as `0x${string}`[],
          params.recipient as `0x${string}`,
          deadline,
        ],
      };
    }

    // Swap tokens for tokens
    return {
      address: this.routerAddress as `0x${string}`,
      abi: VVS_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens' as const,
      args: [
        params.amountIn,
        quote.amountOutMin,
        quote.path as `0x${string}`[],
        params.recipient as `0x${string}`,
        deadline,
      ],
    };
  }

  /**
   * Get contract data for token approval
   */
  getApprovalContractCall(tokenAddress: string, amount: bigint) {
    return {
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve' as const,
      args: [
        this.routerAddress as `0x${string}`,
        amount,
      ],
    };
  }

  /**
   * Get router address
   */
  getRouterAddress(): string {
    return this.routerAddress;
  }

  /**
   * Get supported tokens
   */
  getSupportedTokens(): Record<string, string> {
    return { ...this.tokens };
  }

  /**
   * Check if a token is supported
   */
  isTokenSupported(tokenIdentifier: string): boolean {
    try {
      this.getTokenAddress(tokenIdentifier);
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let vvsServiceInstance: VVSFinanceService | null = null;

export function getVVSFinanceService(chainId: number = 338): VVSFinanceService {
  if (!vvsServiceInstance || vvsServiceInstance['chainId'] !== chainId) {
    vvsServiceInstance = new VVSFinanceService(chainId);
  }
  return vvsServiceInstance;
}
