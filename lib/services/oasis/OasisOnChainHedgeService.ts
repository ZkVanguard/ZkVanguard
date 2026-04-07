/**
 * Oasis On-Chain Hedge Service
 * 
 * Hedge execution on Oasis Sapphire using the deployed HedgeExecutor
 * and ZKVerifier contracts. Leverages Sapphire's confidential EVM
 * for private hedge commitments.
 * 
 * Mirrors OnChainHedgeService (Cronos) with Oasis-specific adaptations:
 * - Uses Oasis Sapphire RPC
 * - Deployed HedgeExecutor at Oasis addresses
 * - Optional: Sapphire confidential state for hiding hedge details
 * 
 * @see lib/services/OnChainHedgeService.ts  (Cronos equivalent)
 * @see lib/services/SuiOnChainHedgeService.ts (SUI equivalent)
 */

import { ethers, type Signer, type Provider } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { getOasisSapphireProvider } from '@/lib/throttled-provider';
import { OASIS_CONTRACT_ADDRESSES } from '@/lib/contracts/addresses';

// ============================================
// CONFIGURATION
// ============================================

const OASIS_HEDGE_DEPLOYMENTS = {
  testnet: {
    hedgeExecutor: process.env.NEXT_PUBLIC_OASIS_HEDGE_EXECUTOR_ADDRESS || '0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8',
    zkVerifier: process.env.NEXT_PUBLIC_OASIS_ZKVERIFIER_ADDRESS || '0xA50E3d2C2110EBd08567A322e6e7B0Ca25341bF1',
    gaslessVerifier: process.env.NEXT_PUBLIC_OASIS_GASLESS_COMMITMENT_VERIFIER || '0xfd6B402b860aD57f1393E2b60E1D676b57e0E63B',
    chainId: 23295,
    rpc: process.env.OASIS_SAPPHIRE_TESTNET_RPC || 'https://testnet.sapphire.oasis.io',
  },
  mainnet: {
    hedgeExecutor: process.env.NEXT_PUBLIC_OASIS_MAINNET_HEDGE_EXECUTOR_ADDRESS || '',
    zkVerifier: process.env.NEXT_PUBLIC_OASIS_MAINNET_ZKVERIFIER_ADDRESS || '',
    gaslessVerifier: process.env.NEXT_PUBLIC_OASIS_MAINNET_GASLESS_COMMITMENT_VERIFIER || '',
    chainId: 23294,
    rpc: process.env.OASIS_SAPPHIRE_MAINNET_RPC || 'https://sapphire.oasis.io',
  },
} as const;

type OasisHedgeNetwork = keyof typeof OASIS_HEDGE_DEPLOYMENTS;
const OASIS_NETWORK = (process.env.NEXT_PUBLIC_OASIS_NETWORK || 'testnet') as OasisHedgeNetwork;

// HedgeExecutor ABI (matches deployed contract)
const HEDGE_EXECUTOR_ABI = [
  'function createHedge(bytes32 commitment, uint256 notionalValue, uint8 hedgeType, uint256 leverage) returns (uint256 hedgeId)',
  'function closeHedge(uint256 hedgeId, bytes calldata proof)',
  'function getHedge(uint256 hedgeId) view returns (bytes32 commitment, uint256 notionalValue, uint8 hedgeType, uint256 leverage, uint256 createdAt, bool isActive)',
  'function hedgeCount() view returns (uint256)',
  'function getUserHedges(address user) view returns (uint256[] memory)',
  'event HedgeCreated(uint256 indexed hedgeId, bytes32 commitment, uint256 notionalValue)',
  'event HedgeClosed(uint256 indexed hedgeId, uint256 pnl)',
];

// ZKVerifier ABI
const ZK_VERIFIER_ABI = [
  'function verifyProof(bytes calldata proof, uint256[] calldata publicInputs) view returns (bool)',
  'function isProofTypeSupported(uint8 proofType) view returns (bool)',
];

// ============================================
// TYPES
// ============================================

export interface OasisHedgeRequest {
  ownerAddress: string;
  ownerSecret: string;
  notionalValue: number;
  asset: string;
  side: 'LONG' | 'SHORT';
  leverage: number;
  depositAmount?: string;
}

export interface OasisHedgeResult {
  success: boolean;
  hedgeId?: number;
  commitment?: string;
  txHash?: string;
  error?: string;
}

export interface OasisHedgeInfo {
  hedgeId: number;
  commitment: string;
  notionalValue: string;
  hedgeType: number;
  leverage: number;
  createdAt: number;
  isActive: boolean;
}

// ============================================
// SERVICE
// ============================================

export class OasisOnChainHedgeService {
  private provider: Provider;
  private signer: Signer | null = null;
  private network: OasisHedgeNetwork;
  private config: typeof OASIS_HEDGE_DEPLOYMENTS[OasisHedgeNetwork];

  constructor(
    network: OasisHedgeNetwork = OASIS_NETWORK,
    signerOrProvider?: Signer | Provider
  ) {
    this.network = network;
    this.config = OASIS_HEDGE_DEPLOYMENTS[network];

    if (signerOrProvider) {
      if ('getAddress' in signerOrProvider) {
        this.signer = signerOrProvider as Signer;
        this.provider = (signerOrProvider as Signer).provider || 
          getOasisSapphireProvider(this.config.rpc).provider;
      } else {
        this.provider = signerOrProvider as Provider;
      }
    } else {
      this.provider = getOasisSapphireProvider(this.config.rpc).provider;
    }

    logger.info('🔐 [OasisHedge] Initialized', {
      network,
      hedgeExecutor: this.config.hedgeExecutor?.slice(0, 10) + '...',
      zkVerifier: this.config.zkVerifier?.slice(0, 10) + '...',
    });
  }

  /**
   * Generate a commitment hash for a hedge (mirrors Cronos pattern)
   */
  generateCommitment(ownerAddress: string, ownerSecret: string): string {
    return ethers.keccak256(
      ethers.solidityPacked(
        ['address', 'bytes32'],
        [ownerAddress, ethers.id(ownerSecret)]
      )
    );
  }

  /**
   * Read hedge executor state
   */
  async getHedgeCount(): Promise<number> {
    if (!this.config.hedgeExecutor) return 0;
    try {
      const contract = new ethers.Contract(
        this.config.hedgeExecutor,
        HEDGE_EXECUTOR_ABI,
        this.provider
      );
      return Number(await contract.hedgeCount());
    } catch (e) {
      logger.warn('⚠️ [OasisHedge] hedgeCount() failed', { error: String(e) });
      return 0;
    }
  }

  /**
   * Get hedge details by ID
   */
  async getHedge(hedgeId: number): Promise<OasisHedgeInfo | null> {
    if (!this.config.hedgeExecutor) return null;
    try {
      const contract = new ethers.Contract(
        this.config.hedgeExecutor,
        HEDGE_EXECUTOR_ABI,
        this.provider
      );
      const h = await contract.getHedge(hedgeId);
      return {
        hedgeId,
        commitment: h.commitment,
        notionalValue: h.notionalValue.toString(),
        hedgeType: Number(h.hedgeType),
        leverage: Number(h.leverage),
        createdAt: Number(h.createdAt),
        isActive: h.isActive,
      };
    } catch (e) {
      logger.warn('⚠️ [OasisHedge] getHedge() failed', { hedgeId, error: String(e) });
      return null;
    }
  }

  /**
   * Verify a ZK proof on-chain
   */
  async verifyProof(proof: string, publicInputs: number[]): Promise<boolean> {
    if (!this.config.zkVerifier) return false;
    try {
      const contract = new ethers.Contract(
        this.config.zkVerifier,
        ZK_VERIFIER_ABI,
        this.provider
      );
      return await contract.verifyProof(proof, publicInputs);
    } catch (e) {
      logger.warn('⚠️ [OasisHedge] verifyProof() failed', { error: String(e) });
      return false;
    }
  }

  /**
   * Get contract addresses for this network
   */
  getContractAddresses() {
    return {
      hedgeExecutor: this.config.hedgeExecutor,
      zkVerifier: this.config.zkVerifier,
      gaslessVerifier: this.config.gaslessVerifier,
      chainId: this.config.chainId,
      network: this.network,
    };
  }

  /**
   * Get explorer URL for a transaction
   */
  getExplorerUrl(txHash: string): string {
    const base = this.network === 'mainnet'
      ? 'https://explorer.oasis.io/mainnet/sapphire'
      : 'https://explorer.oasis.io/testnet/sapphire';
    return `${base}/tx/${txHash}`;
  }
}

// ─── Singleton Factory ───────────────────────────────────────

let _instance: OasisOnChainHedgeService | null = null;

export function getOasisOnChainHedgeService(): OasisOnChainHedgeService {
  if (!_instance) {
    _instance = new OasisOnChainHedgeService();
  }
  return _instance;
}
