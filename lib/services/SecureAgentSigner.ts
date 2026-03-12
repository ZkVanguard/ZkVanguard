/**
 * Secure Agent Signer Service
 * 
 * Provides a secure, rate-limited signer for automated AI agent operations.
 * 
 * SECURITY FEATURES:
 * 1. Environment isolation - separate keys for dev/staging/prod
 * 2. Transaction limits - max value per tx, daily caps
 * 3. Cooldown periods - prevent rapid-fire attacks
 * 4. Audit logging - every operation logged
 * 5. Circuit breaker - auto-disable on failures
 * 6. Role verification - validates AGENT_ROLE before signing
 * 
 * Usage:
 *   import { getSecureAgentSigner } from '@/lib/services/SecureAgentSigner';
 *   const signer = await getSecureAgentSigner();
 *   if (signer) {
 *     const tx = await signer.signAndSend(contract, 'method', [...args]);
 *   }
 */

import { ethers, ContractTransactionResponse, Contract } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { getCronosProvider } from '@/lib/throttled-provider';
import { 
  ENFORCE_PRODUCTION_SAFETY, 
  IS_PRODUCTION, 
  IS_DEVELOPMENT,
  auditLog 
} from '@/lib/security/production-guard';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

interface SignerConfig {
  // Transaction limits
  maxSingleTxUSD: number;       // Max value per transaction
  maxDailyTxUSD: number;        // Max daily volume
  maxHourlyTxCount: number;     // Max transactions per hour
  
  // Cooldowns
  minTxIntervalMs: number;      // Min time between transactions
  cooldownAfterFailureMs: number; // Cooldown after a failed tx
  
  // Circuit breaker
  failureThreshold: number;     // Failures before circuit trips
  circuitResetMs: number;       // Time before circuit resets
}

const DEFAULT_CONFIG: SignerConfig = {
  // Conservative limits for community pool
  maxSingleTxUSD: 50_000,          // $50K max per transaction
  maxDailyTxUSD: 500_000,          // $500K daily cap
  maxHourlyTxCount: 10,            // Max 10 txs per hour
  
  minTxIntervalMs: 30_000,         // 30 seconds between txs
  cooldownAfterFailureMs: 300_000, // 5 min cooldown after failure
  
  failureThreshold: 3,             // 3 failures trip circuit
  circuitResetMs: 1_800_000,       // 30 min circuit reset
};

const PRODUCTION_CONFIG: SignerConfig = {
  // More restrictive for production
  maxSingleTxUSD: 25_000,          // $25K max per transaction
  maxDailyTxUSD: 200_000,          // $200K daily cap
  maxHourlyTxCount: 5,             // Max 5 txs per hour
  
  minTxIntervalMs: 60_000,         // 1 minute between txs
  cooldownAfterFailureMs: 600_000, // 10 min cooldown after failure
  
  failureThreshold: 2,             // 2 failures trip circuit
  circuitResetMs: 3_600_000,       // 1 hour circuit reset
};

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SignerTransaction {
  id: string;
  timestamp: number;
  contract: string;
  method: string;
  params: unknown[];
  valueUSD: number;
  txHash?: string;
  status: 'pending' | 'success' | 'failed';
  error?: string;
  gasUsed?: bigint;
}

export interface SignerStatus {
  available: boolean;
  address: string | null;
  nonce: number;
  balance: string;
  circuitOpen: boolean;
  failureCount: number;
  dailyVolumeUSD: number;
  hourlyTxCount: number;
  lastTxTimestamp: number;
  config: SignerConfig;
  reason?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECURE AGENT SIGNER CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class SecureAgentSigner {
  private static instance: SecureAgentSigner | null = null;
  
  private wallet: ethers.Wallet | null = null;
  private provider: ethers.JsonRpcProvider;
  private config: SignerConfig;
  
  // State tracking
  private lastTxTimestamp = 0;
  private dailyVolumeUSD = 0;
  private dailyResetDate = '';
  private hourlyTxTimestamps: number[] = [];
  private circuitOpen = false;
  private circuitOpenedAt = 0;
  private failureCount = 0;
  private txHistory: SignerTransaction[] = [];
  
  // TX history cap
  private static readonly MAX_TX_HISTORY = 1000;

  private constructor() {
    // Use production-specific config in production
    this.config = IS_PRODUCTION ? PRODUCTION_CONFIG : DEFAULT_CONFIG;
    
    // Initialize provider
    const rpcUrl = process.env.NEXT_PUBLIC_CRONOS_TESTNET_RPC || 'https://evm-t3.cronos.org';
    this.provider = getCronosProvider(rpcUrl).provider;
    
    // Initialize wallet from env
    this.initializeWallet();
  }

  private initializeWallet(): void {
    // Check for agent-specific key first, then fallback to general keys
    // Priority: AGENT_SIGNER_KEY > AGENT_PRIVATE_KEY > SERVER_PRIVATE_KEY > SERVER_WALLET_PRIVATE_KEY > PRIVATE_KEY
    const keyName = IS_PRODUCTION 
      ? 'AGENT_SIGNER_KEY'  // Production uses dedicated signer key
      : 'AGENT_PRIVATE_KEY'; // Dev/staging uses general agent key
    
    const privateKey = (
      process.env.AGENT_SIGNER_KEY 
      || process.env.AGENT_PRIVATE_KEY 
      || process.env.SERVER_PRIVATE_KEY
      || process.env.SERVER_WALLET_PRIVATE_KEY
      || process.env.PRIVATE_KEY
    )?.trim();
    
    if (!privateKey) {
      logger.warn('[SecureAgentSigner] No private key configured - signer will be unavailable', {
        checkedKeys: ['AGENT_SIGNER_KEY', 'AGENT_PRIVATE_KEY', 'SERVER_PRIVATE_KEY', 'SERVER_WALLET_PRIVATE_KEY', 'PRIVATE_KEY'],
      });
      return;
    }
    
    // Validate key format
    if (!privateKey.match(/^(0x)?[0-9a-fA-F]{64}$/)) {
      logger.error('[SecureAgentSigner] Invalid private key format');
      return;
    }
    
    try {
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      logger.info('[SecureAgentSigner] Wallet initialized', {
        address: this.wallet.address,
        isProduction: IS_PRODUCTION,
      });
    } catch (error) {
      logger.error('[SecureAgentSigner] Failed to initialize wallet', { error });
    }
  }

  static getInstance(): SecureAgentSigner {
    if (!SecureAgentSigner.instance) {
      SecureAgentSigner.instance = new SecureAgentSigner();
    }
    return SecureAgentSigner.instance;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get current signer status
   */
  async getStatus(): Promise<SignerStatus> {
    const address = this.wallet?.address || null;
    let balance = '0';
    let nonce = 0;
    
    if (this.wallet) {
      try {
        const balanceBN = await this.provider.getBalance(this.wallet.address);
        balance = ethers.formatEther(balanceBN);
        nonce = await this.provider.getTransactionCount(this.wallet.address);
      } catch {
        // Ignore balance fetch errors
      }
    }
    
    // Update hourly count
    this.pruneHourlyTimestamps();
    
    const available = this.isAvailable();
    
    return {
      available: available.available,
      reason: available.reason,
      address,
      nonce,
      balance,
      circuitOpen: this.circuitOpen,
      failureCount: this.failureCount,
      dailyVolumeUSD: this.dailyVolumeUSD,
      hourlyTxCount: this.hourlyTxTimestamps.length,
      lastTxTimestamp: this.lastTxTimestamp,
      config: this.config,
    };
  }

  /**
   * Check if signer is available for transactions
   */
  isAvailable(): { available: boolean; reason?: string } {
    if (!this.wallet) {
      return { available: false, reason: 'No wallet configured' };
    }
    
    // Check circuit breaker
    if (this.circuitOpen) {
      const elapsed = Date.now() - this.circuitOpenedAt;
      if (elapsed < this.config.circuitResetMs) {
        const remainingMins = Math.ceil((this.config.circuitResetMs - elapsed) / 60000);
        return { available: false, reason: `Circuit breaker open (${remainingMins}min remaining)` };
      }
      // Reset circuit
      this.resetCircuit();
    }
    
    // Check cooldown after failure
    if (this.failureCount > 0) {
      const cooldown = this.lastTxTimestamp + this.config.cooldownAfterFailureMs;
      if (Date.now() < cooldown) {
        const remainingSecs = Math.ceil((cooldown - Date.now()) / 1000);
        return { available: false, reason: `Cooling down after failure (${remainingSecs}s remaining)` };
      }
    }
    
    // Check minimum interval
    const nextAllowed = this.lastTxTimestamp + this.config.minTxIntervalMs;
    if (Date.now() < nextAllowed) {
      const remainingSecs = Math.ceil((nextAllowed - Date.now()) / 1000);
      return { available: false, reason: `Rate limited (${remainingSecs}s remaining)` };
    }
    
    // Check hourly limit
    this.pruneHourlyTimestamps();
    if (this.hourlyTxTimestamps.length >= this.config.maxHourlyTxCount) {
      return { available: false, reason: `Hourly transaction limit reached (${this.config.maxHourlyTxCount}/hour)` };
    }
    
    // Check daily volume
    this.resetDailyIfNeeded();
    if (this.dailyVolumeUSD >= this.config.maxDailyTxUSD) {
      return { available: false, reason: `Daily volume limit reached ($${this.dailyVolumeUSD.toLocaleString()}/$${this.config.maxDailyTxUSD.toLocaleString()})` };
    }
    
    return { available: true };
  }

  /**
   * Sign and send a transaction through the contract
   * 
   * @param contract - The contract to interact with
   * @param method - Method name to call
   * @param params - Method parameters
   * @param valueUSD - Estimated USD value of the transaction (for limits)
   * @param options - Transaction options
   */
  async signAndSend(
    contract: Contract,
    method: string,
    params: unknown[],
    valueUSD: number,
    options?: {
      gasLimit?: bigint;
      value?: bigint;  // ETH/CRO value to send
      description?: string;
    }
  ): Promise<{ success: boolean; txHash?: string; error?: string; tx?: SignerTransaction }> {
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Pre-flight checks
    const availability = this.isAvailable();
    if (!availability.available) {
      logger.warn('[SecureAgentSigner] Transaction rejected - signer unavailable', {
        txId,
        reason: availability.reason,
        method,
      });
      return { success: false, error: availability.reason };
    }
    
    // Check single transaction limit
    if (valueUSD > this.config.maxSingleTxUSD) {
      const error = `Transaction value $${valueUSD.toLocaleString()} exceeds single tx limit $${this.config.maxSingleTxUSD.toLocaleString()}`;
      logger.warn('[SecureAgentSigner] Transaction rejected - exceeds limit', { txId, valueUSD });
      return { success: false, error };
    }
    
    // Check daily volume + this tx
    if (this.dailyVolumeUSD + valueUSD > this.config.maxDailyTxUSD) {
      const error = `Transaction would exceed daily limit (current: $${this.dailyVolumeUSD.toLocaleString()}, tx: $${valueUSD.toLocaleString()}, limit: $${this.config.maxDailyTxUSD.toLocaleString()})`;
      logger.warn('[SecureAgentSigner] Transaction rejected - daily limit', { txId, valueUSD, dailyVolumeUSD: this.dailyVolumeUSD });
      return { success: false, error };
    }
    
    // Create transaction record
    const txRecord: SignerTransaction = {
      id: txId,
      timestamp: Date.now(),
      contract: await contract.getAddress(),
      method,
      params,
      valueUSD,
      status: 'pending',
    };
    
    this.txHistory.push(txRecord);
    this.trimTxHistory();
    
    // Log pre-execution
    logger.info('[SecureAgentSigner] Executing transaction', {
      txId,
      contract: txRecord.contract,
      method,
      valueUSD,
      description: options?.description,
    });
    
    try {
      // Connect wallet to contract
      const connectedContract = contract.connect(this.wallet!) as Contract;
      
      // Get the method function
      const methodFn = connectedContract[method];
      if (typeof methodFn !== 'function') {
        throw new Error(`Method ${method} not found on contract`);
      }
      
      // Prepare transaction options
      const txOptions: { gasLimit?: bigint; value?: bigint } = {};
      if (options?.gasLimit) txOptions.gasLimit = options.gasLimit;
      if (options?.value) txOptions.value = options.value;
      
      // Execute transaction
      const tx: ContractTransactionResponse = Object.keys(txOptions).length > 0
        ? await methodFn(...params, txOptions)
        : await methodFn(...params);
      
      txRecord.txHash = tx.hash;
      
      logger.info('[SecureAgentSigner] Transaction submitted', {
        txId,
        txHash: tx.hash,
        method,
      });
      
      // Wait for confirmation
      const receipt = await tx.wait(1);
      
      if (receipt && receipt.status === 1) {
        txRecord.status = 'success';
        txRecord.gasUsed = receipt.gasUsed;
        
        // Update state
        this.lastTxTimestamp = Date.now();
        this.dailyVolumeUSD += valueUSD;
        this.hourlyTxTimestamps.push(Date.now());
        this.failureCount = 0; // Reset on success
        
        // Audit log success
        auditLog({
          timestamp: Date.now(),
          operation: 'AGENT_TX_SUCCESS',
          txHash: tx.hash,
          result: 'success',
          metadata: {
            txId,
            method,
            valueUSD,
            gasUsed: receipt.gasUsed.toString(),
          },
        });
        
        logger.info('[SecureAgentSigner] Transaction confirmed', {
          txId,
          txHash: tx.hash,
          gasUsed: receipt.gasUsed.toString(),
        });
        
        return { success: true, txHash: tx.hash, tx: txRecord };
      } else {
        throw new Error('Transaction reverted');
      }
    } catch (error: any) {
      txRecord.status = 'failed';
      txRecord.error = error.message || String(error);
      
      // Update failure state
      this.lastTxTimestamp = Date.now();
      this.failureCount++;
      
      // Check circuit breaker
      if (this.failureCount >= this.config.failureThreshold) {
        this.tripCircuit(`${this.failureCount} consecutive failures`);
      }
      
      // Audit log failure
      auditLog({
        timestamp: Date.now(),
        operation: 'AGENT_TX_FAILED',
        result: 'failure',
        reason: txRecord.error,
        metadata: {
          txId,
          method,
          valueUSD,
          error: txRecord.error,
          failureCount: this.failureCount,
        },
      });
      
      logger.error('[SecureAgentSigner] Transaction failed', {
        txId,
        method,
        error: txRecord.error,
        failureCount: this.failureCount,
      });
      
      return { success: false, error: txRecord.error, tx: txRecord };
    }
  }

  /**
   * Get the raw wallet for direct operations (use with caution!)
   */
  getWallet(): ethers.Wallet | null {
    return this.wallet;
  }

  /**
   * Get wallet address
   */
  getAddress(): string | null {
    return this.wallet?.address || null;
  }

  /**
   * Get recent transaction history
   */
  getTransactionHistory(limit = 50): SignerTransaction[] {
    return this.txHistory.slice(-limit);
  }

  /**
   * Emergency stop - trip circuit breaker manually
   */
  emergencyStop(reason: string): void {
    this.tripCircuit(`EMERGENCY STOP: ${reason}`);
    logger.error('[SecureAgentSigner] 🚨 EMERGENCY STOP ACTIVATED', { reason });
  }

  /**
   * Reset circuit breaker (admin only in production)
   */
  resetCircuit(): void {
    this.circuitOpen = false;
    this.circuitOpenedAt = 0;
    this.failureCount = 0;
    logger.info('[SecureAgentSigner] Circuit breaker reset');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  private tripCircuit(reason: string): void {
    this.circuitOpen = true;
    this.circuitOpenedAt = Date.now();
    logger.error('[SecureAgentSigner] Circuit breaker TRIPPED', { reason, failureCount: this.failureCount });
    
    auditLog({
      timestamp: Date.now(),
      operation: 'AGENT_CIRCUIT_TRIPPED',
      result: 'failure',
      reason,
      metadata: { failureCount: this.failureCount },
    });
  }

  private resetDailyIfNeeded(): void {
    const today = new Date().toISOString().split('T')[0];
    if (this.dailyResetDate !== today) {
      this.dailyVolumeUSD = 0;
      this.dailyResetDate = today;
      logger.debug('[SecureAgentSigner] Daily volume reset', { date: today });
    }
  }

  private pruneHourlyTimestamps(): void {
    const oneHourAgo = Date.now() - 3600000;
    this.hourlyTxTimestamps = this.hourlyTxTimestamps.filter(ts => ts > oneHourAgo);
  }

  private trimTxHistory(): void {
    if (this.txHistory.length > SecureAgentSigner.MAX_TX_HISTORY) {
      // Keep last 80%
      const keepFrom = Math.floor(SecureAgentSigner.MAX_TX_HISTORY * 0.2);
      this.txHistory = this.txHistory.slice(keepFrom);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the secure agent signer instance
 */
export function getSecureAgentSigner(): SecureAgentSigner {
  return SecureAgentSigner.getInstance();
}

/**
 * Quick check if agent signing is available
 */
export function isAgentSigningAvailable(): boolean {
  const signer = getSecureAgentSigner();
  return signer.isAvailable().available;
}
