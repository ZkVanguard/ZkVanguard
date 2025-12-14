/**
 * VVS Finance Client
 * Integration with VVS Finance DEX on Cronos for token swaps
 */

import { ethers } from 'ethers';
import { logger } from '@shared/utils/logger';
import { config } from '@shared/utils/config';

// VVS Router ABI (simplified)
const VVS_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
  'function getAmountsIn(uint amountOut, address[] memory path) public view returns (uint[] memory amounts)',
  'function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)',
  'function removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB)',
];

// ERC20 ABI (simplified)
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
];

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  recipient?: string;
  deadline?: number;
  slippageTolerance?: number; // percentage
}

export interface SwapResult {
  txHash: string;
  amountIn: string;
  amountOut: string;
  path: string[];
  gasUsed: string;
  executionPrice: string;
}

export interface LiquidityParams {
  tokenA: string;
  tokenB: string;
  amountA: string;
  amountB: string;
  minAmountA?: string;
  minAmountB?: string;
  recipient?: string;
  deadline?: number;
}

export interface PoolInfo {
  token0: string;
  token1: string;
  reserve0: string;
  reserve1: string;
  totalSupply: string;
  lpToken: string;
}

export interface PriceQuote {
  amountIn: string;
  amountOut: string;
  path: string[];
  priceImpact: number;
  executionPrice: string;
}

export class VVSClient {
  private router: ethers.Contract;
  private signer: ethers.Wallet | ethers.Signer;
  private initialized: boolean = false;

  // VVS Router address on Cronos
  private routerAddress: string;

  // Common token addresses on Cronos
  private tokens: Map<string, string> = new Map([
    ['WCRO', '0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23'],
    ['USDC', '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59'],
    ['USDT', '0x66e428c3f67a68878562e79A0234c1F83c208770'],
    ['VVS', '0x2D03bECE6747ADC00E1a131BBA1469C15fD11e03'],
    ['WETH', '0xe44Fd7fCb2b1581822D0c862B68222998a0c299a'],
    ['WBTC', '0x062E66477Faf219F25D27dCED647BF57C3107d52'],
  ]);

  constructor(
    private provider: ethers.Provider,
    signerOrPrivateKey: ethers.Wallet | ethers.Signer | string
  ) {
    // Initialize signer
    if (typeof signerOrPrivateKey === 'string') {
      this.signer = new ethers.Wallet(signerOrPrivateKey, provider);
    } else {
      this.signer = signerOrPrivateKey;
    }

    // VVS Router on Cronos
    this.routerAddress = process.env.NEXT_PUBLIC_VVS_ROUTER || '0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae';
    
    // Initialize router contract
    this.router = new ethers.Contract(this.routerAddress, VVS_ROUTER_ABI, this.signer);

    logger.info('VVSClient initialized', {
      routerAddress: this.routerAddress,
    });
  }

  /**
   * Initialize client
   */
  async initialize(): Promise<void> {
    try {
      // Verify router contract exists
      const code = await this.provider.getCode(this.routerAddress);
      if (code === '0x') {
        throw new Error('VVS Router contract not found at address');
      }

      this.initialized = true;
      logger.info('VVSClient initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize VVSClient', { error });
      throw error;
    }
  }

  /**
   * Get price quote for swap
   */
  async getQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }): Promise<PriceQuote> {
    this.ensureInitialized();

    try {
      const { tokenIn, tokenOut, amountIn } = params;
      
      // Resolve token addresses
      const tokenInAddress = this.resolveTokenAddress(tokenIn);
      const tokenOutAddress = this.resolveTokenAddress(tokenOut);

      // Find best path (direct or through WCRO)
      const path = await this.findBestPath(tokenInAddress, tokenOutAddress);

      // Get amounts out
      const amountInWei = ethers.parseUnits(amountIn, 18);
      const amounts = await this.router.getAmountsOut(amountInWei, path);
      
      const amountOut = amounts[amounts.length - 1];
      const amountOutFormatted = ethers.formatUnits(amountOut, 18);

      // Calculate price impact (simplified)
      const priceImpact = this.calculatePriceImpact(amountIn, amountOutFormatted, tokenIn, tokenOut);

      // Calculate execution price
      const executionPrice = (parseFloat(amountIn) / parseFloat(amountOutFormatted)).toFixed(6);

      return {
        amountIn,
        amountOut: amountOutFormatted,
        path,
        priceImpact,
        executionPrice,
      };
    } catch (error) {
      logger.error('Failed to get quote', { error });
      throw error;
    }
  }

  /**
   * Execute token swap
   */
  async swap(params: SwapParams): Promise<SwapResult> {
    this.ensureInitialized();

    try {
      const {
        tokenIn,
        tokenOut,
        amountIn,
        minAmountOut,
        recipient,
        deadline,
        slippageTolerance = 0.5,
      } = params;

      logger.info('Executing swap', { tokenIn, tokenOut, amountIn });

      // Resolve addresses
      const tokenInAddress = this.resolveTokenAddress(tokenIn);
      const tokenOutAddress = this.resolveTokenAddress(tokenOut);
      const to = recipient || await this.signer.getAddress();

      // Find best path
      const path = await this.findBestPath(tokenInAddress, tokenOutAddress);

      // Get quote
      const quote = await this.getQuote({ tokenIn, tokenOut, amountIn });

      // Calculate min amount out with slippage
      const minAmount = minAmountOut || 
        (parseFloat(quote.amountOut) * (1 - slippageTolerance / 100)).toFixed(18);

      // Approve token if needed
      await this.approveToken(tokenInAddress, amountIn);

      // Set deadline (10 minutes from now)
      const swapDeadline = deadline || Math.floor(Date.now() / 1000) + 600;

      // Execute swap
      const amountInWei = ethers.parseUnits(amountIn, 18);
      const minAmountWei = ethers.parseUnits(minAmount, 18);

      let tx;
      if (tokenIn === 'CRO' || tokenIn === 'WCRO') {
        // Swap CRO for tokens
        tx = await this.router.swapExactETHForTokens(
          minAmountWei,
          path,
          to,
          swapDeadline,
          { value: amountInWei }
        );
      } else if (tokenOut === 'CRO' || tokenOut === 'WCRO') {
        // Swap tokens for CRO
        tx = await this.router.swapExactTokensForETH(
          amountInWei,
          minAmountWei,
          path,
          to,
          swapDeadline
        );
      } else {
        // Swap tokens for tokens
        tx = await this.router.swapExactTokensForTokens(
          amountInWei,
          minAmountWei,
          path,
          to,
          swapDeadline
        );
      }

      const receipt = await tx.wait();

      logger.info('Swap executed successfully', {
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
      });

      return {
        txHash: receipt.hash,
        amountIn,
        amountOut: quote.amountOut,
        path,
        gasUsed: receipt.gasUsed.toString(),
        executionPrice: quote.executionPrice,
      };
    } catch (error) {
      logger.error('Failed to execute swap', { error });
      throw error;
    }
  }

  /**
   * Add liquidity to pool
   */
  async addLiquidity(params: LiquidityParams): Promise<{
    txHash: string;
    amountA: string;
    amountB: string;
    liquidity: string;
  }> {
    this.ensureInitialized();

    try {
      const {
        tokenA,
        tokenB,
        amountA,
        amountB,
        minAmountA,
        minAmountB,
        recipient,
        deadline,
      } = params;

      logger.info('Adding liquidity', { tokenA, tokenB, amountA, amountB });

      // Resolve addresses
      const tokenAAddress = this.resolveTokenAddress(tokenA);
      const tokenBAddress = this.resolveTokenAddress(tokenB);
      const to = recipient || await this.signer.getAddress();

      // Approve tokens
      await this.approveToken(tokenAAddress, amountA);
      await this.approveToken(tokenBAddress, amountB);

      // Set min amounts (95% of desired by default)
      const minA = minAmountA || (parseFloat(amountA) * 0.95).toFixed(18);
      const minB = minAmountB || (parseFloat(amountB) * 0.95).toFixed(18);

      // Set deadline
      const addDeadline = deadline || Math.floor(Date.now() / 1000) + 600;

      // Add liquidity
      const amountAWei = ethers.parseUnits(amountA, 18);
      const amountBWei = ethers.parseUnits(amountB, 18);
      const minAWei = ethers.parseUnits(minA, 18);
      const minBWei = ethers.parseUnits(minB, 18);

      const tx = await this.router.addLiquidity(
        tokenAAddress,
        tokenBAddress,
        amountAWei,
        amountBWei,
        minAWei,
        minBWei,
        to,
        addDeadline
      );

      const receipt = await tx.wait();

      // Parse events to get actual amounts (simplified)
      logger.info('Liquidity added successfully', { txHash: receipt.hash });

      return {
        txHash: receipt.hash,
        amountA,
        amountB,
        liquidity: '0', // Would parse from events in production
      };
    } catch (error) {
      logger.error('Failed to add liquidity', { error });
      throw error;
    }
  }

  /**
   * Remove liquidity from pool
   */
  async removeLiquidity(params: {
    tokenA: string;
    tokenB: string;
    liquidity: string;
    minAmountA?: string;
    minAmountB?: string;
    recipient?: string;
    deadline?: number;
  }): Promise<{
    txHash: string;
    amountA: string;
    amountB: string;
  }> {
    this.ensureInitialized();

    try {
      const {
        tokenA,
        tokenB,
        liquidity,
        minAmountA = '0',
        minAmountB = '0',
        recipient,
        deadline,
      } = params;

      logger.info('Removing liquidity', { tokenA, tokenB, liquidity });

      // Resolve addresses
      const tokenAAddress = this.resolveTokenAddress(tokenA);
      const tokenBAddress = this.resolveTokenAddress(tokenB);
      const to = recipient || await this.signer.getAddress();

      // Set deadline
      const removeDeadline = deadline || Math.floor(Date.now() / 1000) + 600;

      // Remove liquidity
      const liquidityWei = ethers.parseUnits(liquidity, 18);
      const minAWei = ethers.parseUnits(minAmountA, 18);
      const minBWei = ethers.parseUnits(minAmountB, 18);

      const tx = await this.router.removeLiquidity(
        tokenAAddress,
        tokenBAddress,
        liquidityWei,
        minAWei,
        minBWei,
        to,
        removeDeadline
      );

      const receipt = await tx.wait();

      logger.info('Liquidity removed successfully', { txHash: receipt.hash });

      return {
        txHash: receipt.hash,
        amountA: '0', // Would parse from events in production
        amountB: '0',
      };
    } catch (error) {
      logger.error('Failed to remove liquidity', { error });
      throw error;
    }
  }

  /**
   * Approve token spending
   */
  private async approveToken(tokenAddress: string, amount: string): Promise<void> {
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.signer);
      const owner = await this.signer.getAddress();
      
      // Check current allowance
      const allowance = await token.allowance(owner, this.routerAddress);
      const amountWei = ethers.parseUnits(amount, 18);

      if (allowance < amountWei) {
        logger.info('Approving token', { token: tokenAddress, amount });
        
        // Approve max amount for efficiency
        const tx = await token.approve(this.routerAddress, ethers.MaxUint256);
        await tx.wait();
        
        logger.info('Token approved', { token: tokenAddress });
      }
    } catch (error) {
      logger.error('Failed to approve token', { tokenAddress, error });
      throw error;
    }
  }

  /**
   * Find best path between tokens
   */
  private async findBestPath(tokenIn: string, tokenOut: string): Promise<string[]> {
    const WCRO = this.tokens.get('WCRO')!;

    // Direct path
    if (tokenIn !== WCRO && tokenOut !== WCRO) {
      // Try route through WCRO for better liquidity
      return [tokenIn, WCRO, tokenOut];
    }

    // Direct path if one is WCRO
    return [tokenIn, tokenOut];
  }

  /**
   * Calculate price impact (simplified)
   */
  private calculatePriceImpact(
    amountIn: string,
    amountOut: string,
    tokenIn: string,
    tokenOut: string
  ): number {
    // Simplified calculation
    // In production, compare against spot price from oracle
    return 0.5; // 0.5% default
  }

  /**
   * Resolve token symbol to address
   */
  private resolveTokenAddress(token: string): string {
    // Check if already an address
    if (token.startsWith('0x')) {
      return token;
    }

    // Look up token symbol
    const address = this.tokens.get(token.toUpperCase());
    if (!address) {
      throw new Error(`Unknown token: ${token}`);
    }

    return address;
  }

  /**
   * Add custom token
   */
  addToken(symbol: string, address: string): void {
    this.tokens.set(symbol.toUpperCase(), address);
    logger.info('Token added', { symbol, address });
  }

  /**
   * Get token balance
   */
  async getTokenBalance(token: string, account?: string): Promise<string> {
    try {
      const tokenAddress = this.resolveTokenAddress(token);
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const owner = account || await this.signer.getAddress();
      
      const balance = await tokenContract.balanceOf(owner);
      return ethers.formatUnits(balance, 18);
    } catch (error) {
      logger.error('Failed to get token balance', { token, error });
      throw error;
    }
  }

  /**
   * Ensure client is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('VVSClient not initialized. Call initialize() first.');
    }
  }

  /**
   * Disconnect client
   */
  async disconnect(): Promise<void> {
    this.initialized = false;
    logger.info('VVSClient disconnected');
  }
}

// Export singleton instance factory
let vvsClient: VVSClient | null = null;

export function getVVSClient(
  provider: ethers.Provider,
  signer: ethers.Wallet | ethers.Signer | string
): VVSClient {
  if (!vvsClient) {
    vvsClient = new VVSClient(provider, signer);
  }
  return vvsClient;
}
