/**
 * Treasury Service
 * 
 * Server-side treasury wallet management using ethers.js
 * Used for AI agent operations:
 * - Executing hedges on Cronos
 * - Processing withdrawals
 * - Managing pool allocations
 * 
 * This is a SERVER-SIDE only service.
 * Fully non-custodial for users - they use their own wallets.
 */

// CRITICAL: Server-side only - never bundle to client
import 'server-only';

import { ethers } from 'ethers';
import { WDK_CHAINS } from '@/lib/config/wdk';

// ERC20 ABI for USDT operations
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// Types
export interface TreasuryConfig {
  privateKey: string;
  defaultChain: 'sepolia' | 'cronos-mainnet' | 'hedera-mainnet';
}

export interface TransferParams {
  to: string;
  amount: string; // In USDT (6 decimals)
  chainId: number;
}

export interface HedgeExecutionParams {
  direction: 'long' | 'short';
  amount: string;
  leverage: number;
  targetChainId: number;
}

/**
 * Treasury wallet service powered by ethers.js
 * Used for automated operations - NOT for user custody
 */
export class TreasuryService {
  private wallets: Map<string, ethers.Wallet> = new Map();
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();
  private initialized = false;
  
  constructor(private config: TreasuryConfig) {}
  
  /**
   * Initialize the treasury with registered chains
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return true;
    
    try {
      // Validate private key format
      if (!this.config.privateKey || this.config.privateKey.length < 64) {
        console.error('[Treasury] Invalid private key');
        return false;
      }
      
      // Ensure key has 0x prefix
      const key = this.config.privateKey.startsWith('0x') 
        ? this.config.privateKey 
        : `0x${this.config.privateKey}`;
      
      // Register chains we need for treasury operations
      const chainsToRegister = [
        'sepolia',          // USDT testnet
        'cronos-mainnet',   // Hedge execution
        'hedera-mainnet', // Alternative USDT
      ];
      
      for (const chainKey of chainsToRegister) {
        const chainConfig = WDK_CHAINS[chainKey];
        if (chainConfig?.rpcUrl) {
          const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
          const wallet = new ethers.Wallet(key, provider);
          
          this.providers.set(chainKey, provider);
          this.wallets.set(chainKey, wallet);
        }
      }
      
      this.initialized = true;
      console.log('[Treasury] Initialized with', this.wallets.size, 'chains');
      return true;
    } catch (err) {
      console.error('[Treasury] Initialization error:', err);
      return false;
    }
  }
  
  /**
   * Get treasury address for a chain
   */
  async getAddress(chainKey: string): Promise<string | null> {
    const wallet = this.wallets.get(chainKey);
    if (!wallet) {
      // Try initializing first
      await this.initialize();
      const retryWallet = this.wallets.get(chainKey);
      return retryWallet?.address ?? null;
    }
    return wallet.address;
  }
  
  /**
   * Get USDT balance on a chain
   */
  async getUsdtBalance(chainKey: string): Promise<string> {
    const wallet = this.wallets.get(chainKey);
    if (!wallet) return '0';
    
    const chainConfig = WDK_CHAINS[chainKey];
    if (!chainConfig?.usdtAddress) return '0';
    
    try {
      const token = new ethers.Contract(
        chainConfig.usdtAddress,
        ERC20_ABI,
        wallet.provider
      );
      
      const balance = await token.balanceOf(wallet.address);
      // USDT has 6 decimals
      return ethers.formatUnits(balance, 6);
    } catch (err) {
      console.error('[Treasury] Balance error:', err);
      return '0';
    }
  }
  
  /**
   * Transfer USDT from treasury to an address
   * Used for: Processing withdrawals, funding hedges
   */
  async transferUsdt(
    chainKey: string, 
    to: string, 
    amount: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const wallet = this.wallets.get(chainKey);
    if (!wallet) {
      return { success: false, error: `Chain ${chainKey} not registered` };
    }
    
    const chainConfig = WDK_CHAINS[chainKey];
    if (!chainConfig?.usdtAddress) {
      return { success: false, error: `No USDT on ${chainKey}` };
    }
    
    try {
      const token = new ethers.Contract(
        chainConfig.usdtAddress,
        ERC20_ABI,
        wallet
      );
      
      // Parse amount to 6 decimals
      const amountWei = ethers.parseUnits(amount, 6);
      
      const tx = await token.transfer(to, amountWei);
      const receipt = await tx.wait();
      
      console.log('[Treasury] Transfer successful:', receipt.hash);
      return { success: true, txHash: receipt.hash };
    } catch (err: any) {
      console.error('[Treasury] Transfer error:', err);
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Sign a message for relay (meta-transaction support)
   * Used for: Gasless user withdrawals
   */
  async signForRelay(
    chainKey: string, 
    message: string
  ): Promise<{ signature: string; signerAddress: string } | null> {
    const wallet = this.wallets.get(chainKey);
    if (!wallet) return null;
    
    try {
      const signature = await wallet.signMessage(message);
      return { signature, signerAddress: wallet.address };
    } catch (err) {
      console.error('[Treasury] Sign error:', err);
      return null;
    }
  }
  
  /**
   * Execute a raw contract call
   * Used for: Hedge execution on Cronos HedgeExecutor
   */
  async executeContractCall(
    chainKey: string,
    contractAddress: string,
    abi: any[],
    functionName: string,
    args: any[]
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const wallet = this.wallets.get(chainKey);
    if (!wallet) {
      return { success: false, error: `Chain ${chainKey} not registered` };
    }
    
    try {
      const contract = new ethers.Contract(contractAddress, abi, wallet);
      const tx = await contract[functionName](...args);
      const receipt = await tx.wait();
      
      return { success: true, txHash: receipt.hash };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Get native token balance (for gas)
   */
  async getNativeBalance(chainKey: string): Promise<string> {
    const wallet = this.wallets.get(chainKey);
    if (!wallet) return '0';
    
    try {
      const balance = await wallet.provider?.getBalance(wallet.address);
      return balance ? ethers.formatEther(balance) : '0';
    } catch {
      return '0';
    }
  }
  
  /**
   * Dispose - clear references
   */
  dispose(): void {
    this.wallets.clear();
    this.providers.clear();
    this.initialized = false;
  }
}

// Singleton factory
let treasuryInstance: TreasuryService | null = null;

/**
 * Get or create treasury service instance
 * Uses PRIVATE_KEY from env vars
 */
export function getTreasuryService(): TreasuryService | null {
  if (treasuryInstance) return treasuryInstance;
  
  // Support both naming conventions
  const privateKey = process.env.TREASURY_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.warn('[Treasury] No private key configured - treasury operations disabled');
    return null;
  }
  
  treasuryInstance = new TreasuryService({
    privateKey,
    defaultChain: 'sepolia',
  });
  
  return treasuryInstance;
}

// Also export with old name for backward compatibility
export { TreasuryService as WdkTreasuryService };
