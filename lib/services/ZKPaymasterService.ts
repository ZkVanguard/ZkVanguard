/**
 * ZK Paymaster Service - TRUE Gasless via Meta-Transactions
 * 
 * Cost Breakdown:
 * - User: $0.00 (just signs EIP-712 message)
 * - Relayer: $0.00 (gets refunded by contract)
 * - Contract: Uses CRO balance (FREE on testnet from faucet)
 * 
 * TOTAL COST: $0.00
 */

import { ethers, TypedDataDomain, TypedDataField } from 'ethers';
import { logger } from '../utils/logger';
import { getCronosProvider } from '../throttled-provider';

// Contract ABI (minimal for meta-transactions)
const ZK_PAYMASTER_ABI = [
  'function storeCommitmentGasless(address user, bytes32 proofHash, bytes32 merkleRoot, uint256 securityLevel, uint256 deadline, bytes signature) external',
  'function getNonce(address user) external view returns (uint256)',
  'function getContractBalance() external view returns (uint256)',
  'function getStats() external view returns (uint256, uint256, uint256, uint256)',
  'function domainSeparator() external view returns (bytes32)',
  'function getCommitment(bytes32 proofHash) external view returns (tuple(bytes32 proofHash, bytes32 merkleRoot, uint256 timestamp, address verifier, bool verified, uint256 securityLevel))',
];

export interface GaslessCommitmentParams {
  proofHash: string;
  merkleRoot: string;
  securityLevel: number;
}

export interface GaslessResult {
  success: boolean;
  txHash?: string;
  error?: string;
  gasSponsored?: string;
  userCost: string; // Always "$0.00"
}

export class ZKPaymasterService {
  private provider: ethers.JsonRpcProvider;
  private relayerWallet: ethers.Wallet;
  private contract: ethers.Contract;
  private contractAddress: string;
  private chainId: number;

  // EIP-712 Domain
  private domain: TypedDataDomain;

  // EIP-712 Types
  private types: Record<string, TypedDataField[]> = {
    StoreCommitment: [
      { name: 'user', type: 'address' },
      { name: 'proofHash', type: 'bytes32' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'securityLevel', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };

  constructor(
    contractAddress: string,
    rpcUrl: string = 'https://evm-t3.cronos.org',
    relayerPrivateKey?: string
  ) {
    this.contractAddress = contractAddress;
    this.chainId = 338; // Cronos Testnet

    // Initialize provider
    this.provider = getCronosProvider(rpcUrl).provider;

    // Initialize relayer wallet (our backend pays gas, gets refunded)
    const privateKey = relayerPrivateKey || process.env.RELAYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('Relayer private key required');
    }
    this.relayerWallet = new ethers.Wallet(privateKey, this.provider);

    // Initialize contract
    this.contract = new ethers.Contract(
      contractAddress,
      ZK_PAYMASTER_ABI,
      this.relayerWallet
    );

    // EIP-712 Domain
    this.domain = {
      name: 'ZKPaymaster',
      version: '1',
      chainId: this.chainId,
      verifyingContract: contractAddress,
    };

    logger.info('🎯 ZKPaymaster Service initialized', {
      contract: contractAddress,
      relayer: this.relayerWallet.address,
      chainId: this.chainId,
    });
  }

  /**
   * Get user's current nonce
   */
  async getNonce(userAddress: string): Promise<bigint> {
    return this.contract.getNonce(userAddress);
  }

  /**
   * Get contract balance (for gas sponsorship)
   */
  async getContractBalance(): Promise<string> {
    const balance = await this.contract.getContractBalance();
    return ethers.formatEther(balance);
  }

  /**
   * Get contract statistics
   */
  async getStats(): Promise<{
    totalCommitments: number;
    totalGasSponsored: string;
    totalTransactionsRelayed: number;
    balance: string;
  }> {
    const [commitments, gasSponsored, txRelayed, balance] = await this.contract.getStats();
    return {
      totalCommitments: Number(commitments),
      totalGasSponsored: ethers.formatEther(gasSponsored),
      totalTransactionsRelayed: Number(txRelayed),
      balance: ethers.formatEther(balance),
    };
  }

  /**
   * Create unsigned message for user to sign
   * User signs this with their wallet (costs $0.00 - just a signature)
   */
  async createSignatureRequest(
    userAddress: string,
    params: GaslessCommitmentParams
  ): Promise<{
    message: Record<string, string | number>;
    domain: TypedDataDomain;
    types: Record<string, TypedDataField[]>;
    primaryType: string;
  }> {
    const nonce = await this.getNonce(userAddress);
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    const message = {
      user: userAddress,
      proofHash: params.proofHash,
      merkleRoot: params.merkleRoot,
      securityLevel: params.securityLevel,
      nonce: nonce.toString(),
      deadline: deadline,
    };

    return {
      message,
      domain: this.domain,
      types: this.types,
      primaryType: 'StoreCommitment',
    };
  }

  /**
   * Execute gasless commitment storage
   * User provides signature, we relay the transaction
   * 
   * Cost:
   * - User: $0.00 (just signature)
   * - Relayer: $0.00 (gets refunded)
   * - Total: $0.00
   */
  async executeGaslessCommitment(
    userAddress: string,
    params: GaslessCommitmentParams,
    signature: string
  ): Promise<GaslessResult> {
    try {
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      logger.info('🚀 Executing gasless commitment', {
        user: userAddress,
        proofHash: params.proofHash.substring(0, 18) + '...',
      });

      // Execute meta-transaction (nonce is verified on-chain by the contract)
      const tx = await this.contract.storeCommitmentGasless(
        userAddress,
        params.proofHash,
        params.merkleRoot,
        params.securityLevel,
        deadline,
        signature,
        {
          gasLimit: 300000, // Generous limit
        }
      );

      const receipt = await tx.wait();

      // Compute gas cost from receipt (avoids 2 extra getBalance RPC calls)
      const gasCost = receipt.gasUsed * (receipt.gasPrice || 0n);

      logger.info('✅ Gasless commitment executed', {
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        relayerNetCost: ethers.formatEther(gasCost) + ' CRO',
        userCost: '$0.00',
      });

      return {
        success: true,
        txHash: receipt.hash,
        gasSponsored: ethers.formatEther(gasCost),
        userCost: '$0.00',
      };
    } catch (error) {
      logger.error('❌ Gasless commitment failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        userCost: '$0.00',
      };
    }
  }

  /**
   * Full gasless flow: Create request, sign, execute
   * This is for testing - in production, user signs in frontend
   */
  async testGaslessFlow(
    userWallet: ethers.Wallet,
    params: GaslessCommitmentParams
  ): Promise<GaslessResult> {
    try {
      // 1. Create signature request
      const signatureRequest = await this.createSignatureRequest(
        userWallet.address,
        params
      );

      // 2. User signs (FREE - just a signature, no gas)
      const signature = await userWallet.signTypedData(
        signatureRequest.domain,
        signatureRequest.types,
        signatureRequest.message
      );

      // 3. Relayer executes (we pay gas, get refunded)
      return this.executeGaslessCommitment(
        userWallet.address,
        params,
        signature
      );
    } catch (error) {
      logger.error('❌ Test gasless flow failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        userCost: '$0.00',
      };
    }
  }

  /**
   * Check if commitment exists
   */
  async commitmentExists(proofHash: string): Promise<boolean> {
    const commitment = await this.contract.getCommitment(proofHash);
    return commitment.verified;
  }
}

// Singleton instance
let paymasterInstance: ZKPaymasterService | null = null;

export function getZKPaymasterService(
  contractAddress?: string,
  rpcUrl?: string,
  relayerPrivateKey?: string
): ZKPaymasterService {
  if (!paymasterInstance && contractAddress) {
    paymasterInstance = new ZKPaymasterService(contractAddress, rpcUrl, relayerPrivateKey);
  }
  if (!paymasterInstance) {
    throw new Error('ZKPaymaster not initialized. Provide contract address.');
  }
  return paymasterInstance;
}

export default ZKPaymasterService;
