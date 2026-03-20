/**
 * Tether WDK Wallet Service
 * 
 * Integrates the Tether Wallet Development Kit for USDT operations.
 * Supports multichain USDT deposits, withdrawals, and balance queries
 * across Cronos and Arbitrum networks.
 * 
 * @see https://docs.wdk.tether.io/
 * 
 * ARCHITECTURE:
 * - WDK handles wallet creation, key management, and signing
 * - This service provides high-level USDT operations
 * - Integrates with existing viem wallet connections
 */

import { logger } from '../utils/logger';
import {
  getUSDTAddress,
  getChainConfig,
  isMainnet,
  WDK_SUPPORTED_CHAINS,
  USDT_METADATA,
  type WDKChainConfig,
} from '../config/wdk';

// ============================================
// Types
// ============================================

export interface USDTBalance {
  chainId: number;
  chainName: string;
  balance: bigint;
  balanceFormatted: string;
  usdValue: number;
  usdtAddress: string | null;
}

export interface MultiChainBalance {
  balances: USDTBalance[];
  totalUsdValue: number;
}

export interface TransferParams {
  to: string;
  amount: bigint;
  chainId: number;
}

export interface TransferResult {
  hash: string;
  chainId: number;
  from: string;
  to: string;
  amount: bigint;
  status: 'pending' | 'confirmed' | 'failed';
}

export interface ApprovalParams {
  spender: string;
  amount: bigint;
  chainId: number;
}

// ============================================
// ERC20 ABI (minimal for USDT operations)
// ============================================

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: 'remaining', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'decimals', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'symbol', type: 'string' }],
  },
] as const;

// ============================================
// WDK Wallet Service Class
// ============================================

/**
 * Service for Tether WDK-powered USDT operations.
 * 
 * This service can be used standalone or integrated with
 * existing wallet connections (viem).
 */
export class WDKWalletService {
  private static instance: WDKWalletService | null = null;
  
  private constructor() {}
  
  /**
   * Get singleton instance of WDKWalletService.
   */
  static getInstance(): WDKWalletService {
    if (!WDKWalletService.instance) {
      WDKWalletService.instance = new WDKWalletService();
    }
    return WDKWalletService.instance;
  }
  
  // ============================================
  // Balance Queries
  // ============================================
  
  /**
   * Get USDT balance for an address on a specific chain.
   */
  async getUSDTBalance(
    address: string,
    chainId: number,
    publicClient: any // viem PublicClient
  ): Promise<USDTBalance> {
    const chain = getChainConfig(chainId);
    if (!chain) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }
    
    const usdtAddress = chain.usdtAddress;
    if (!usdtAddress) {
      logger.warn('[WDK] No USDT address for chain, returning zero balance', { chainId });
      return {
        chainId,
        chainName: chain.name,
        balance: BigInt(0),
        balanceFormatted: '0.00',
        usdValue: 0,
        usdtAddress: null,
      };
    }
    
    try {
      const balance = await publicClient.readContract({
        address: usdtAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
      
      const formatted = this.formatUSDTAmount(balance);
      
      return {
        chainId,
        chainName: chain.name,
        balance,
        balanceFormatted: formatted,
        usdValue: parseFloat(formatted),
        usdtAddress,
      };
    } catch (error) {
      logger.error('[WDK] Failed to get USDT balance', { 
        address, 
        chainId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }
  
  /**
   * Get USDT balances across all supported chains.
   */
  async getMultiChainBalances(
    address: string,
    publicClients: Map<number, any> // Map<chainId, PublicClient>
  ): Promise<MultiChainBalance> {
    const balances: USDTBalance[] = [];
    let totalUsdValue = 0;
    
    for (const chainId of WDK_SUPPORTED_CHAINS) {
      const client = publicClients.get(chainId);
      if (!client) {
        logger.debug('[WDK] No client for chain, skipping', { chainId });
        continue;
      }
      
      try {
        const balance = await this.getUSDTBalance(address, chainId, client);
        balances.push(balance);
        totalUsdValue += balance.usdValue;
      } catch (error) {
        logger.error('[WDK] Failed to get balance for chain', { 
          chainId, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
    
    return { balances, totalUsdValue };
  }
  
  // ============================================
  // Approvals
  // ============================================
  
  /**
   * Check USDT allowance for a spender.
   */
  async getAllowance(
    owner: string,
    spender: string,
    chainId: number,
    publicClient: any
  ): Promise<bigint> {
    const chain = getChainConfig(chainId);
    const usdtAddress = chain?.usdtAddress;
    
    if (!usdtAddress) {
      throw new Error(`No USDT address for chain ${chainId}`);
    }
    
    return publicClient.readContract({
      address: usdtAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, spender],
    });
  }
  
  /**
   * Prepare USDT approval transaction data.
   */
  prepareApproval(params: ApprovalParams): {
    to: string;
    data: string;
    value: bigint;
  } {
    const chain = getChainConfig(params.chainId);
    const usdtAddress = chain?.usdtAddress;
    
    if (!usdtAddress) {
      throw new Error(`No USDT address for chain ${params.chainId}`);
    }
    
    // Encode approve(spender, amount) call
    const data = this.encodeApproveCall(params.spender, params.amount);
    
    return {
      to: usdtAddress,
      data,
      value: BigInt(0),
    };
  }
  
  // ============================================
  // Transfers
  // ============================================
  
  /**
   * Prepare USDT transfer transaction data.
   */
  prepareTransfer(params: TransferParams): {
    to: string;
    data: string;
    value: bigint;
  } {
    const chain = getChainConfig(params.chainId);
    const usdtAddress = chain?.usdtAddress;
    
    if (!usdtAddress) {
      throw new Error(`No USDT address for chain ${params.chainId}`);
    }
    
    // Encode transfer(to, amount) call
    const data = this.encodeTransferCall(params.to, params.amount);
    
    return {
      to: usdtAddress,
      data,
      value: BigInt(0),
    };
  }
  
  // ============================================
  // Formatting Utilities
  // ============================================
  
  /**
   * Format USDT amount from raw units to human-readable string.
   */
  formatUSDTAmount(amount: bigint): string {
    const divisor = BigInt(10 ** USDT_METADATA.decimals);
    const whole = amount / divisor;
    const fraction = amount % divisor;
    
    // Pad fraction to 6 digits, then take first 2
    const fractionStr = fraction.toString().padStart(USDT_METADATA.decimals, '0');
    const truncatedFraction = fractionStr.slice(0, 2);
    
    return `${whole}.${truncatedFraction}`;
  }
  
  /**
   * Parse human-readable USDT amount to raw units.
   */
  parseUSDTAmount(amount: string): bigint {
    const [whole, fraction = ''] = amount.split('.');
    const paddedFraction = fraction.padEnd(USDT_METADATA.decimals, '0').slice(0, USDT_METADATA.decimals);
    return BigInt(whole + paddedFraction);
  }
  
  /**
   * Get USDT token metadata.
   */
  getTokenMetadata() {
    return { ...USDT_METADATA };
  }
  
  // ============================================
  // Chain Information
  // ============================================
  
  /**
   * Get supported chain configurations.
   */
  getSupportedChains(): WDKChainConfig[] {
    return WDK_SUPPORTED_CHAINS
      .map(chainId => getChainConfig(chainId))
      .filter((c): c is WDKChainConfig => c !== undefined);
  }
  
  /**
   * Check if a chain is supported by WDK.
   */
  isChainSupported(chainId: number): boolean {
    return WDK_SUPPORTED_CHAINS.includes(chainId as any);
  }
  
  /**
   * Get chain config if supported.
   */
  getChainConfig(chainId: number): WDKChainConfig | undefined {
    return getChainConfig(chainId);
  }
  
  // ============================================
  // Private Helpers
  // ============================================
  
  /**
   * Encode ERC20 approve function call.
   */
  private encodeApproveCall(spender: string, amount: bigint): string {
    // approve(address,uint256) selector = 0x095ea7b3
    const selector = '0x095ea7b3';
    const paddedSpender = spender.slice(2).toLowerCase().padStart(64, '0');
    const paddedAmount = amount.toString(16).padStart(64, '0');
    return `${selector}${paddedSpender}${paddedAmount}`;
  }
  
  /**
   * Encode ERC20 transfer function call.
   */
  private encodeTransferCall(to: string, amount: bigint): string {
    // transfer(address,uint256) selector = 0xa9059cbb
    const selector = '0xa9059cbb';
    const paddedTo = to.slice(2).toLowerCase().padStart(64, '0');
    const paddedAmount = amount.toString(16).padStart(64, '0');
    return `${selector}${paddedTo}${paddedAmount}`;
  }
}

// ============================================
// Singleton Export
// ============================================

/**
 * Get the WDK wallet service instance.
 */
export function getWDKWalletService(): WDKWalletService {
  return WDKWalletService.getInstance();
}

// ============================================
// Convenience Functions
// ============================================

/**
 * Format USDT amount for display.
 */
export function formatUSDT(amount: bigint): string {
  return getWDKWalletService().formatUSDTAmount(amount);
}

/**
 * Parse USDT amount from string.
 */
export function parseUSDT(amount: string): bigint {
  return getWDKWalletService().parseUSDTAmount(amount);
}

/**
 * Check if a chain supports USDT via WDK.
 */
export function isWDKSupported(chainId: number): boolean {
  return getWDKWalletService().isChainSupported(chainId);
}
