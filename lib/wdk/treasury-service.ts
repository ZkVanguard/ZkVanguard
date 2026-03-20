/**
 * WDK Treasury Service
 * 
 * Uses Tether WDK for backend/treasury operations:
 * - Executing hedges on Cronos
 * - Processing withdrawals (gasless relayer)
 * - Managing pool allocations
 * - Cross-chain USDT transfers
 * 
 * This is a SERVER-SIDE service - seed phrase stored in env vars.
 * Fully non-custodial for users - they use their own wallets.
 */

// CRITICAL: This must only run server-side - contains sensitive operations
import 'server-only';

import WdkManager from '@tetherto/wdk';
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';
import { WDK_CHAINS } from '@/lib/config/wdk';
import { WDK_USDT_CONFIGS } from '@/lib/config/wdk-usdt';

// Types
export interface TreasuryConfig {
  seedPhrase: string;
  defaultChain: 'sepolia' | 'cronos-mainnet' | 'arbitrum-mainnet';
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
 * Treasury wallet service powered by WDK
 * Used for automated operations - NOT for user custody
 */
export class WdkTreasuryService {
  private wdk: WdkManager | null = null;
  private accounts: Map<string, any> = new Map();
  private initialized = false;
  
  constructor(private config: TreasuryConfig) {}
  
  /**
   * Initialize the treasury with registered chains
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return true;
    
    try {
      // Validate seed
      if (!WdkManager.isValidSeed(this.config.seedPhrase)) {
        console.error('[WdkTreasury] Invalid seed phrase');
        return false;
      }
      
      // Create WDK manager
      this.wdk = new WdkManager(this.config.seedPhrase);
      
      // Register chains we need for treasury operations
      const chainsToRegister = [
        'sepolia',        // WDK USDT testnet
        'cronos-mainnet', // Hedge execution
        'arbitrum-mainnet', // Alternative USDT
      ];
      
      for (const chainKey of chainsToRegister) {
        const chainConfig = WDK_CHAINS[chainKey];
        if (chainConfig && chainConfig.usdtAddress) {
          // Cast config to any - WDK types may not match exact runtime API
          this.wdk.registerWallet(chainKey, WalletManagerEvm, {
            chainId: chainConfig.chainId,
            rpcUrl: chainConfig.rpcUrl,
          } as any);
          
          // Pre-derive account
          const account = await this.wdk.getAccount(chainKey, 0);
          this.accounts.set(chainKey, account);
        }
      }
      
      this.initialized = true;
      console.log('[WdkTreasury] Initialized with', this.accounts.size, 'chains');
      return true;
    } catch (err) {
      console.error('[WdkTreasury] Initialization error:', err);
      return false;
    }
  }
  
  /**
   * Get treasury address for a chain
   */
  async getAddress(chainKey: string): Promise<string | null> {
    const account = this.accounts.get(chainKey);
    if (!account) return null;
    
    try {
      return await account.getAddress();
    } catch {
      return null;
    }
  }
  
  /**
   * Get USDT balance on a chain
   */
  async getUsdtBalance(chainKey: string): Promise<string> {
    const account = this.accounts.get(chainKey);
    if (!account) return '0';
    
    const chainConfig = WDK_CHAINS[chainKey];
    if (!chainConfig?.usdtAddress) return '0';
    
    try {
      const balance = await account.getTokenBalance(chainConfig.usdtAddress);
      return balance.toString();
    } catch (err) {
      console.error('[WdkTreasury] Balance error:', err);
      return '0';
    }
  }
  
  /**
   * Transfer USDT from treasury to an address
   * Used for: Processing withdrawals, funding hedges
   */
  async transferUsdt(chainKey: string, to: string, amount: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const account = this.accounts.get(chainKey);
    if (!account) {
      return { success: false, error: `Chain ${chainKey} not registered` };
    }
    
    const chainConfig = WDK_CHAINS[chainKey];
    if (!chainConfig?.usdtAddress) {
      return { success: false, error: `No USDT on ${chainKey}` };
    }
    
    try {
      const result = await account.transfer({
        to,
        amount,
        token: chainConfig.usdtAddress,
      });
      
      console.log('[WdkTreasury] Transfer successful:', result.txHash);
      return { success: true, txHash: result.txHash };
    } catch (err: any) {
      console.error('[WdkTreasury] Transfer error:', err);
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Sign a transaction for relay (meta-transaction support)
   * Used for: Gasless user withdrawals
   */
  async signForRelay(chainKey: string, txData: any): Promise<{ signature: string; signerAddress: string } | null> {
    const account = this.accounts.get(chainKey);
    if (!account) return null;
    
    try {
      const address = await account.getAddress();
      const signature = await account.signMessage(JSON.stringify(txData));
      
      return { signature, signerAddress: address };
    } catch (err) {
      console.error('[WdkTreasury] Sign error:', err);
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
    const account = this.accounts.get(chainKey);
    if (!account) {
      return { success: false, error: `Chain ${chainKey} not registered` };
    }
    
    try {
      const result = await account.sendTransaction({
        to: contractAddress,
        data: account.encodeFunction(abi, functionName, args),
      });
      
      return { success: true, txHash: result.txHash };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
  
  /**
   * Dispose and clear sensitive data
   */
  dispose(): void {
    if (this.wdk) {
      this.wdk.dispose();
    }
    this.accounts.clear();
    this.initialized = false;
  }
}

// Singleton factory
let treasuryInstance: WdkTreasuryService | null = null;

/**
 * Get or create treasury service instance
 * Requires TREASURY_SEED_PHRASE env var
 */
export function getTreasuryService(): WdkTreasuryService | null {
  if (treasuryInstance) return treasuryInstance;
  
  const seedPhrase = process.env.TREASURY_SEED_PHRASE;
  if (!seedPhrase) {
    console.warn('[WdkTreasury] TREASURY_SEED_PHRASE not set - treasury operations disabled');
    return null;
  }
  
  treasuryInstance = new WdkTreasuryService({
    seedPhrase,
    defaultChain: 'sepolia',
  });
  
  return treasuryInstance;
}
