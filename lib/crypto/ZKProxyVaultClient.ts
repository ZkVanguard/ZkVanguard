/**
 * Bulletproof On-Chain ZK Proxy System
 * 
 * This module provides the client-side functionality for interacting with
 * the ZKProxyVault smart contract for bulletproof escrow with ZK verification.
 * 
 * Security Features:
 * - Funds held in smart contract, not API
 * - ZK proof verified ON-CHAIN before any withdrawal
 * - Time-locked withdrawals for large amounts
 * - Deterministic PDA addresses (no private key)
 * - Replay protection for proofs
 */

import { ethers, Contract, Signer, Provider } from 'ethers';
import * as crypto from 'crypto';

// Contract ABIs (simplified for key functions)
const ZK_PROXY_VAULT_ABI = [
  // Read functions
  'function proxyBindings(address) view returns (address owner, bytes32 zkBindingHash, uint256 depositedAmount, uint256 createdAt, bool isActive)',
  'function getOwnerProxies(address owner) view returns (address[])',
  'function verifyProxyOwnership(address proxyAddress, address claimedOwner) view returns (bool)',
  'function getProxyBalance(address proxyAddress) view returns (uint256)',
  'function deriveProxyAddress(address owner, uint256 nonce, bytes32 zkBindingHash) pure returns (address)',
  'function ownerNonces(address) view returns (uint256)',
  'function timeLockThreshold() view returns (uint256)',
  'function timeLockDuration() view returns (uint256)',
  'function totalValueLocked() view returns (uint256)',
  
  // Write functions
  'function createProxy(bytes32 zkBindingHash) returns (address proxyAddress)',
  'function deposit(address proxyAddress) payable',
  'function withdraw(address proxyAddress, uint256 amount, bytes zkProof, bytes32[] publicInputs)',
  'function executeWithdrawal(bytes32 withdrawalId)',
  'function cancelWithdrawal(bytes32 withdrawalId)',
  
  // Events
  'event ProxyCreated(address indexed owner, address indexed proxyAddress, bytes32 zkBindingHash, uint256 timestamp)',
  'event Deposited(address indexed proxyAddress, address indexed owner, uint256 amount, uint256 newBalance)',
  'event WithdrawalRequested(bytes32 indexed withdrawalId, address indexed owner, address indexed proxyAddress, uint256 amount, uint256 unlockTime)',
  'event WithdrawalExecuted(bytes32 indexed withdrawalId, address indexed owner, uint256 amount)',
  'event InstantWithdrawal(address indexed owner, address indexed proxyAddress, uint256 amount)',
];

const ZK_VERIFIER_ABI = [
  'function verify(bytes proof, bytes32[] publicInputs) view returns (bool)',
  'function verifyAndConsume(bytes proof, bytes32[] publicInputs) returns (bool)',
  'function computeProofComponents(address owner, address proxy, bytes32 bindingHash, uint256 timestamp) view returns (bytes32 commitment, bytes32 response)',
  'function proofValidityWindow() view returns (uint256)',
];

export interface OnChainProxyPDA {
  proxyAddress: string;
  ownerAddress: string;
  zkBindingHash: string;
  nonce: number;
  depositedAmount: string;
  createdAt: number;
  isActive: boolean;
  hasNoPrivateKey: true; // Always true - this is the security guarantee
  txHash?: string; // Transaction hash from creation
}

export interface ZKProofData {
  proof: string;         // Serialized proof bytes (hex)
  publicInputs: string[]; // Public inputs as bytes32 hex strings
  timestamp: number;
}

export interface WithdrawalRequest {
  withdrawalId: string;
  owner: string;
  proxyAddress: string;
  amount: string;
  unlockTime: number;
  isReady: boolean;
}

/**
 * Client for interacting with the bulletproof ZKProxyVault
 */
export class ZKProxyVaultClient {
  private vault: Contract;
  private verifier: Contract;
  private provider: Provider;
  private signer?: Signer;

  constructor(
    vaultAddress: string,
    verifierAddress: string,
    providerOrSigner: Provider | Signer
  ) {
    if ('getAddress' in providerOrSigner) {
      // It's a signer
      this.signer = providerOrSigner as Signer;
      this.provider = this.signer.provider!;
      this.vault = new Contract(vaultAddress, ZK_PROXY_VAULT_ABI, this.signer);
      this.verifier = new Contract(verifierAddress, ZK_VERIFIER_ABI, this.signer);
    } else {
      // It's a provider
      this.provider = providerOrSigner as Provider;
      this.vault = new Contract(vaultAddress, ZK_PROXY_VAULT_ABI, this.provider);
      this.verifier = new Contract(verifierAddress, ZK_VERIFIER_ABI, this.provider);
    }
  }

  /**
   * Generate ZK binding hash for a new proxy
   * This cryptographically links the owner to their proxy
   */
  generateZKBindingHash(ownerAddress: string, seed: string = 'hedge'): string {
    const data = `${ownerAddress.toLowerCase()}:${seed}:${Date.now()}:CHRONOS_BINDING_V1`;
    return '0x' + crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Create a new PDA proxy on-chain
   * Returns the deterministic proxy address (no private key exists!)
   */
  async createProxy(zkBindingHash?: string): Promise<OnChainProxyPDA> {
    if (!this.signer) throw new Error('Signer required for write operations');
    
    const ownerAddress = await this.signer.getAddress();
    const binding = zkBindingHash || this.generateZKBindingHash(ownerAddress);
    
    // Get current nonce for preview
    const nonce = await this.vault.ownerNonces(ownerAddress);
    
    // Preview the proxy address
    const previewAddress = await this.vault.deriveProxyAddress(
      ownerAddress,
      nonce,
      binding
    );
    
    console.log('🔐 Creating on-chain PDA proxy...', {
      owner: ownerAddress.slice(0, 10) + '...',
      previewProxy: previewAddress.slice(0, 10) + '...',
      binding: binding.slice(0, 16) + '...',
    });
    
    // Create on-chain
    const tx = await this.vault.createProxy(binding);
    const receipt = await tx.wait();
    
    // Find ProxyCreated event
    const event = receipt.logs.find((log: any) => {
      try {
        const parsed = this.vault.interface.parseLog(log);
        return parsed?.name === 'ProxyCreated';
      } catch {
        return false;
      }
    });
    
    const proxyAddress = event 
      ? this.vault.interface.parseLog(event)?.args.proxyAddress 
      : previewAddress;
    
    console.log('✅ On-chain PDA created:', {
      proxy: proxyAddress,
      txHash: receipt.hash,
    });
    
    return {
      proxyAddress,
      ownerAddress,
      zkBindingHash: binding,
      nonce: Number(nonce),
      depositedAmount: '0',
      createdAt: Math.floor(Date.now() / 1000),
      isActive: true,
      hasNoPrivateKey: true,
      txHash: receipt.hash,
    };
  }

  /**
   * Deposit funds into a proxy address
   */
  async deposit(proxyAddress: string, amountWei: bigint): Promise<string> {
    if (!this.signer) throw new Error('Signer required for write operations');
    
    console.log('💰 Depositing to proxy vault...', {
      proxy: proxyAddress.slice(0, 10) + '...',
      amount: ethers.formatEther(amountWei) + ' ETH',
    });
    
    const tx = await this.vault.deposit(proxyAddress, { value: amountWei });
    const receipt = await tx.wait();
    
    console.log('✅ Deposit confirmed:', receipt.hash);
    return receipt.hash;
  }

  /**
   * Generate ZK proof for withdrawal
   * This proof verifies ownership on-chain
   */
  async generateWithdrawalProof(
    proxyAddress: string
  ): Promise<ZKProofData> {
    if (!this.signer) throw new Error('Signer required');
    
    const ownerAddress = await this.signer.getAddress();
    const binding = await this.vault.proxyBindings(proxyAddress);
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Get proof components from verifier contract
    const [commitment, response] = await this.verifier.computeProofComponents(
      ownerAddress,
      proxyAddress,
      binding.zkBindingHash,
      timestamp
    );
    
    // Construct proof bytes
    const proof = ethers.concat([commitment, response]);
    
    // Construct public inputs
    const ownerHash = ethers.keccak256(ethers.solidityPacked(['address'], [ownerAddress]));
    const proxyHash = ethers.keccak256(ethers.solidityPacked(['address'], [proxyAddress]));
    const timestampBytes32 = ethers.zeroPadValue(ethers.toBeHex(timestamp), 32);
    
    return {
      proof: ethers.hexlify(proof),
      publicInputs: [ownerHash, proxyHash, binding.zkBindingHash, timestampBytes32],
      timestamp,
    };
  }

  /**
   * Withdraw funds with ZK proof verification
   * Funds go ONLY to verified owner
   */
  async withdraw(
    proxyAddress: string,
    amountWei: bigint
  ): Promise<{ txHash: string; isTimeLocked: boolean; unlockTime?: number }> {
    if (!this.signer) throw new Error('Signer required for write operations');
    
    const ownerAddress = await this.signer.getAddress();
    
    // Verify ownership first
    const isOwner = await this.vault.verifyProxyOwnership(proxyAddress, ownerAddress);
    if (!isOwner) {
      throw new Error('Not the owner of this proxy');
    }
    
    // Generate ZK proof
    console.log('🔐 Generating ZK withdrawal proof...');
    const zkProof = await this.generateWithdrawalProof(proxyAddress);
    
    // Check if time-lock applies
    const threshold = await this.vault.timeLockThreshold();
    const duration = await this.vault.timeLockDuration();
    const isTimeLocked = amountWei >= threshold;
    
    console.log('📤 Initiating withdrawal...', {
      proxy: proxyAddress.slice(0, 10) + '...',
      amount: ethers.formatEther(amountWei) + ' ETH',
      timeLocked: isTimeLocked,
      ...(isTimeLocked && { lockDuration: Number(duration) / 3600 + ' hours' }),
    });
    
    // Execute withdrawal with ZK proof
    const tx = await this.vault.withdraw(
      proxyAddress,
      amountWei,
      zkProof.proof,
      zkProof.publicInputs
    );
    const receipt = await tx.wait();
    
    if (isTimeLocked) {
      // Find WithdrawalRequested event
      const event = receipt.logs.find((log: any) => {
        try {
          const parsed = this.vault.interface.parseLog(log);
          return parsed?.name === 'WithdrawalRequested';
        } catch {
          return false;
        }
      });
      
      const unlockTime = event 
        ? Number(this.vault.interface.parseLog(event)?.args.unlockTime)
        : Math.floor(Date.now() / 1000) + Number(duration);
      
      console.log('⏳ Time-locked withdrawal initiated:', {
        txHash: receipt.hash,
        unlockTime: new Date(unlockTime * 1000).toISOString(),
      });
      
      return { txHash: receipt.hash, isTimeLocked: true, unlockTime };
    }
    
    console.log('✅ Instant withdrawal completed:', receipt.hash);
    return { txHash: receipt.hash, isTimeLocked: false };
  }

  /**
   * Execute a time-locked withdrawal after unlock time
   */
  async executeTimeLocked(withdrawalId: string): Promise<string> {
    if (!this.signer) throw new Error('Signer required');
    
    const tx = await this.vault.executeWithdrawal(withdrawalId);
    const receipt = await tx.wait();
    
    console.log('✅ Time-locked withdrawal executed:', receipt.hash);
    return receipt.hash;
  }

  /**
   * Cancel a pending withdrawal
   */
  async cancelWithdrawal(withdrawalId: string): Promise<string> {
    if (!this.signer) throw new Error('Signer required');
    
    const tx = await this.vault.cancelWithdrawal(withdrawalId);
    const receipt = await tx.wait();
    
    console.log('❌ Withdrawal cancelled:', receipt.hash);
    return receipt.hash;
  }

  // ============ View Functions ============

  /**
   * Get all proxy addresses for an owner
   */
  async getOwnerProxies(ownerAddress: string): Promise<string[]> {
    return await this.vault.getOwnerProxies(ownerAddress);
  }

  /**
   * Get proxy details
   */
  async getProxy(proxyAddress: string): Promise<OnChainProxyPDA | null> {
    const binding = await this.vault.proxyBindings(proxyAddress);
    
    if (!binding.isActive) return null;
    
    return {
      proxyAddress,
      ownerAddress: binding.owner,
      zkBindingHash: binding.zkBindingHash,
      nonce: 0, // Not stored, but doesn't matter once created
      depositedAmount: ethers.formatEther(binding.depositedAmount),
      createdAt: Number(binding.createdAt),
      isActive: binding.isActive,
      hasNoPrivateKey: true,
    };
  }

  /**
   * Get proxy balance
   */
  async getProxyBalance(proxyAddress: string): Promise<string> {
    const balance = await this.vault.getProxyBalance(proxyAddress);
    return ethers.formatEther(balance);
  }

  /**
   * Verify ownership on-chain
   */
  async verifyOwnership(proxyAddress: string, claimedOwner: string): Promise<boolean> {
    return await this.vault.verifyProxyOwnership(proxyAddress, claimedOwner);
  }

  /**
   * Get total value locked in the vault
   */
  async getTVL(): Promise<string> {
    const tvl = await this.vault.totalValueLocked();
    return ethers.formatEther(tvl);
  }

  /**
   * Get time-lock configuration
   */
  async getTimeLockConfig(): Promise<{ threshold: string; duration: number }> {
    const [threshold, duration] = await Promise.all([
      this.vault.timeLockThreshold(),
      this.vault.timeLockDuration(),
    ]);
    
    return {
      threshold: ethers.formatEther(threshold),
      duration: Number(duration),
    };
  }
}

/**
 * Factory function for easy client creation
 */
export function createZKProxyVaultClient(
  vaultAddress: string,
  verifierAddress: string,
  providerOrSigner: Provider | Signer
): ZKProxyVaultClient {
  return new ZKProxyVaultClient(vaultAddress, verifierAddress, providerOrSigner);
}

/**
 * Contract addresses by network
 */
export const ZK_PROXY_VAULT_ADDRESSES: Record<string, { vault: string; verifier: string }> = {
  // Will be populated after deployment
  'cronos-testnet': {
    vault: '0x0000000000000000000000000000000000000000', // TODO: Deploy
    verifier: '0x0000000000000000000000000000000000000000', // TODO: Deploy
  },
  'cronos-mainnet': {
    vault: '0x0000000000000000000000000000000000000000', // TODO: Deploy
    verifier: '0x0000000000000000000000000000000000000000', // TODO: Deploy
  },
};
