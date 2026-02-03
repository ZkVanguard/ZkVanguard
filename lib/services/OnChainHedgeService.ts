/**
 * On-Chain Hedge Service
 * 
 * Integrates manual hedge execution with the bulletproof ZKProxyVault
 * for production-grade security with on-chain fund escrow.
 * 
 * Flow:
 * 1. User creates hedge via frontend
 * 2. Service creates on-chain proxy via ZKProxyVault
 * 3. Funds are deposited to on-chain proxy (optional)
 * 4. Hedge executes on Moonlander with proxy as visible address
 * 5. On close, ZK proof required to withdraw funds
 */

import { ethers, Signer, Provider } from 'ethers';
import { ZKProxyVaultClient, OnChainProxyPDA, ZKProofData } from '@/lib/crypto/ZKProxyVaultClient';
import { logger } from '@/lib/utils/logger';
import * as crypto from 'crypto';

// Contract addresses on Cronos Testnet (from deployment)
const DEPLOYED_ADDRESSES = {
  'cronos-testnet': {
    ZKProxyVault: '0x7F75Ca65D32752607fF481F453E4fbD45E61FdFd',
    ZKSTARKVerifier: '0x47812EFFe0Aed4D46C489E002214A05B26b71b0b',
    chainId: 338,
    rpc: 'https://evm-t3.cronos.org',
  },
  // Add mainnet when deployed
  'cronos-mainnet': {
    ZKProxyVault: '', // TBD after mainnet deployment
    ZKSTARKVerifier: '', // TBD after mainnet deployment
    chainId: 25,
    rpc: 'https://evm.cronos.org',
  }
};

export interface OnChainHedgeRequest {
  ownerAddress: string;       // User's wallet address (receives funds on close)
  ownerSecret: string;        // Secret for ZK proof generation (store securely!)
  notionalValue: number;      // USD value of hedge
  depositAmount?: string;     // Amount to escrow in vault (in wei)
  asset: string;
  side: 'LONG' | 'SHORT';
  leverage: number;
}

export interface OnChainHedgeResult {
  success: boolean;
  proxyAddress?: string;      // On-chain proxy address (visible on-chain)
  ownerCommitment?: string;   // Hash of owner+secret (stored on-chain)
  zkBindingHash?: string;     // ZK binding hash
  txHash?: string;            // Transaction hash
  error?: string;
}

export interface WithdrawResult {
  success: boolean;
  txHash?: string;
  amountWithdrawn?: string;
  error?: string;
  requiresTimelock?: boolean;
  timelockEndsAt?: number;
}

/**
 * Service for on-chain hedge operations with ZK protection
 */
export class OnChainHedgeService {
  private client: ZKProxyVaultClient;
  private network: keyof typeof DEPLOYED_ADDRESSES;
  private provider: Provider;
  
  constructor(
    network: keyof typeof DEPLOYED_ADDRESSES = 'cronos-testnet',
    signerOrProvider?: Signer | Provider
  ) {
    this.network = network;
    const config = DEPLOYED_ADDRESSES[network];
    
    if (!config.ZKProxyVault) {
      throw new Error(`ZKProxyVault not deployed on ${network}`);
    }
    
    // Use provided signer/provider or create default provider
    const providerOrSigner = signerOrProvider || 
      new ethers.JsonRpcProvider(config.rpc);
    
    this.provider = 'provider' in providerOrSigner && providerOrSigner.provider 
      ? providerOrSigner.provider 
      : providerOrSigner as Provider;
    
    this.client = new ZKProxyVaultClient(
      config.ZKProxyVault,
      config.ZKSTARKVerifier,
      providerOrSigner
    );
    
    logger.info('🔐 OnChainHedgeService initialized', { 
      network, 
      vault: config.ZKProxyVault.slice(0, 10) + '...' 
    });
  }
  
  /**
   * Create an on-chain proxy for a hedge with ZK binding
   * The proxy address will be visible on-chain, but owner identity is hidden
   */
  async createHedgeProxy(request: OnChainHedgeRequest): Promise<OnChainHedgeResult> {
    try {
      logger.info('🔐 Creating on-chain hedge proxy...', {
        owner: request.ownerAddress.slice(0, 10) + '...',
        asset: request.asset,
        side: request.side,
        notionalValue: request.notionalValue,
      });
      
      // Generate owner commitment (hash of owner + secret)
      const ownerCommitment = ethers.keccak256(
        ethers.solidityPacked(
          ['address', 'bytes32'],
          [request.ownerAddress, ethers.id(request.ownerSecret)]
        )
      );
      
      // Create proxy on-chain
      const result = await this.client.createProxy(ownerCommitment);
      
      logger.info('✅ On-chain proxy created', {
        proxy: result.proxyAddress.slice(0, 10) + '...',
        txHash: result.txHash?.slice(0, 20) + '...',
      });
      
      // Deposit funds if specified
      if (request.depositAmount && parseFloat(request.depositAmount) > 0) {
        const depositTxHash = await this.client.deposit(
          result.proxyAddress,
          BigInt(request.depositAmount)
        );
        
        logger.info('💰 Funds deposited to proxy', {
          amount: ethers.formatEther(request.depositAmount),
          txHash: depositTxHash?.slice(0, 20) + '...',
        });
      }
      
      return {
        success: true,
        proxyAddress: result.proxyAddress,
        ownerCommitment,
        zkBindingHash: result.zkBindingHash,
        txHash: result.txHash,
      };
      
    } catch (error) {
      logger.error('❌ Failed to create on-chain proxy', { error: String(error) });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Withdraw funds from on-chain proxy using ZK proof
   * This is the ONLY way to get funds out - ZK proof is REQUIRED
   */
  async withdrawFromProxy(
    proxyAddress: string,
    ownerAddress: string,
    ownerSecret: string,
    amount: string
  ): Promise<WithdrawResult> {
    try {
      logger.info('🔐 Initiating ZK-protected withdrawal...', {
        proxy: proxyAddress.slice(0, 10) + '...',
        amount: ethers.formatEther(amount),
      });
      
      // Get proxy info
      const proxyInfo = await this.client.getProxyInfo(proxyAddress);
      
      if (!proxyInfo || !proxyInfo.isActive) {
        return { success: false, error: 'Proxy not found or inactive' };
      }
      
      // Generate ZK proof
      const zkProof = await this.client.generateWithdrawalProof(
        ownerAddress,
        proxyAddress,
        proxyInfo.zkBindingHash,
        ethers.id(ownerSecret) // Convert secret to bytes32
      );
      
      // Attempt withdrawal
      const result = await this.client.withdraw(proxyAddress, amount, zkProof);
      
      if (result.requiresTimeLock) {
        logger.info('⏰ Withdrawal requires time-lock (large amount)', {
          unlockTime: new Date(result.unlockTime! * 1000).toISOString(),
        });
        
        return {
          success: true,
          requiresTimelock: true,
          timelockEndsAt: result.unlockTime,
          txHash: result.txHash,
        };
      }
      
      logger.info('✅ Withdrawal successful', {
        amount: ethers.formatEther(amount),
        txHash: result.txHash?.slice(0, 20) + '...',
      });
      
      return {
        success: true,
        txHash: result.txHash,
        amountWithdrawn: ethers.formatEther(amount),
      };
      
    } catch (error) {
      logger.error('❌ Withdrawal failed', { error: String(error) });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Get all proxies owned by an address
   */
  async getOwnerProxies(ownerAddress: string): Promise<OnChainProxyPDA[]> {
    return this.client.getOwnerProxies(ownerAddress);
  }
  
  /**
   * Get proxy balance
   */
  async getProxyBalance(proxyAddress: string): Promise<string> {
    const balance = await this.client.getProxyBalance(proxyAddress);
    return ethers.formatEther(balance);
  }
  
  /**
   * Verify proxy ownership (without revealing owner)
   */
  async verifyOwnership(proxyAddress: string, claimedOwner: string): Promise<boolean> {
    return this.client.verifyProxyOwnership(proxyAddress, claimedOwner);
  }
  
  /**
   * Get contract addresses for frontend
   */
  getContractAddresses(): typeof DEPLOYED_ADDRESSES[keyof typeof DEPLOYED_ADDRESSES] {
    return DEPLOYED_ADDRESSES[this.network];
  }
}

// Singleton instance for API use
let _serviceInstance: OnChainHedgeService | null = null;

/**
 * Get or create the OnChainHedgeService instance
 */
export function getOnChainHedgeService(
  network: keyof typeof DEPLOYED_ADDRESSES = 'cronos-testnet',
  signer?: Signer
): OnChainHedgeService {
  if (!_serviceInstance || signer) {
    _serviceInstance = new OnChainHedgeService(network, signer);
  }
  return _serviceInstance;
}

/**
 * Helper to create service with wallet connection (for frontend use)
 */
export async function createOnChainServiceWithWallet(
  walletProvider: any, // ethers or wagmi provider
  network: keyof typeof DEPLOYED_ADDRESSES = 'cronos-testnet'
): Promise<OnChainHedgeService> {
  const provider = new ethers.BrowserProvider(walletProvider);
  const signer = await provider.getSigner();
  return new OnChainHedgeService(network, signer);
}
