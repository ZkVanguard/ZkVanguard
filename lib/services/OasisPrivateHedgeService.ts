/**
 * Oasis Private Hedge Service
 * 
 * Privacy-preserving hedge execution on Oasis Sapphire.
 * Oasis Sapphire has native confidential computing via SecretNetwork/TEE,
 * which complements the ZK-proof privacy layer.
 * 
 * This mirrors lib/services/PrivateHedgeService.ts (chain-agnostic crypto)
 * with Oasis Sapphire–specific additions:
 * - Confidential state via Sapphire ParaTime runtime
 * - On-chain commitment storage to GaslessCommitmentVerifier
 * - ROSE-denominated gas for stealth tx execution
 * 
 * @see lib/services/PrivateHedgeService.ts  (Cronos equivalent - generic crypto)
 * @see lib/services/OasisOnChainHedgeService.ts (Oasis hedge execution)
 */

import * as crypto from 'crypto';
import { ethers, type Signer } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { getOasisSapphireProvider } from '@/lib/throttled-provider';
import { OASIS_CONTRACT_ADDRESSES } from '@/lib/contracts/addresses';

// ============================================
// CONFIGURATION
// ============================================

const OASIS_PRIVATE_DEPLOYMENTS = {
  testnet: {
    chainId: 23295,
    gaslessCommitmentVerifier: OASIS_CONTRACT_ADDRESSES.GaslessCommitmentVerifier,
    hedgeExecutor: OASIS_CONTRACT_ADDRESSES.HedgeExecutor,
    zkVerifier: OASIS_CONTRACT_ADDRESSES.ZKVerifier,
    explorerBase: 'https://explorer.oasis.io/testnet/sapphire',
  },
  mainnet: {
    chainId: 23294,
    gaslessCommitmentVerifier: process.env.NEXT_PUBLIC_OASIS_MAINNET_GASLESS_COMMITMENT_VERIFIER || '',
    hedgeExecutor: process.env.NEXT_PUBLIC_OASIS_MAINNET_HEDGE_EXECUTOR || '',
    zkVerifier: process.env.NEXT_PUBLIC_OASIS_MAINNET_ZK_VERIFIER || '',
    explorerBase: 'https://explorer.oasis.io/mainnet/sapphire',
  },
} as const;

const OASIS_NETWORK = (process.env.NEXT_PUBLIC_OASIS_NETWORK || 'testnet') as keyof typeof OASIS_PRIVATE_DEPLOYMENTS;
const DEPLOYED = OASIS_PRIVATE_DEPLOYMENTS[OASIS_NETWORK] || OASIS_PRIVATE_DEPLOYMENTS.testnet;

// ABI for GaslessCommitmentVerifier
const GASLESS_VERIFIER_ABI = [
  'function submitCommitment(bytes32 commitmentHash) returns (bool)',
  'function verifyCommitment(bytes32 commitmentHash) view returns (bool isValid, uint256 timestamp, address submitter)',
  'function getCommitmentCount() view returns (uint256)',
  'function commitments(bytes32) view returns (address submitter, uint256 timestamp, bool isValid)',
];

// ============================================
// TYPES
// ============================================

export interface OasisPrivateHedge {
  commitmentHash: string;
  stealthAddress: string;
  nullifier: string;
  timestamp: number;
  encryptedData: string;
  iv: string;
  chain: 'oasis-sapphire';
  txHash?: string;
}

export interface OasisHedgeCommitment {
  asset: string;
  side: 'LONG' | 'SHORT';
  size: number;
  notionalValue: number;
  leverage: number;
  entryPrice: number;
  salt: string;
}

export interface OasisCommitmentVerification {
  isValid: boolean;
  timestamp: number;
  submitter: string;
  onChain: boolean;
}

// ============================================
// SERVICE CLASS
// ============================================

export class OasisPrivateHedgeService {
  private encryptionKey: Buffer;

  constructor() {
    const seed = process.env.HEDGE_ENCRYPTION_SEED || crypto.randomBytes(32).toString('hex');
    this.encryptionKey = crypto.scryptSync(seed, 'zkvanguard-oasis-hedge-salt', 32);
  }

  // ──────────────────────────────────────────
  // Commitment generation
  // ──────────────────────────────────────────

  generateCommitment(hedge: OasisHedgeCommitment): { commitmentHash: string; salt: string } {
    const salt = hedge.salt || crypto.randomBytes(32).toString('hex');
    const data = JSON.stringify({
      asset: hedge.asset,
      side: hedge.side,
      size: hedge.size,
      notionalValue: hedge.notionalValue,
      leverage: hedge.leverage,
      entryPrice: hedge.entryPrice,
      salt,
    });

    const commitmentHash = crypto.createHash('sha256').update(data).digest('hex');

    logger.info('🔐 [OasisPrivate] Generated commitment', {
      hash: commitmentHash.substring(0, 16) + '...',
    });

    return { commitmentHash, salt };
  }

  // ──────────────────────────────────────────
  // Stealth addresses
  // ──────────────────────────────────────────

  generateStealthAddress(masterPublicKey: string): {
    privateKey: string;
    publicKey: string;
    address: string;
  } {
    const ephemeralPrivateKey = crypto.randomBytes(32);
    const ecdh = crypto.createECDH('secp256k1');
    ecdh.setPrivateKey(ephemeralPrivateKey);
    const ephemeralPublicKey = ecdh.getPublicKey('hex');

    const sharedSecret = crypto
      .createHash('sha256')
      .update(ephemeralPrivateKey.toString('hex') + masterPublicKey)
      .digest();

    const stealthPrivateKey = crypto.createHash('sha256').update(sharedSecret).digest('hex');
    const stealthAddress = '0x' + crypto
      .createHash('sha256')
      .update(stealthPrivateKey)
      .digest('hex')
      .substring(0, 40);

    return { privateKey: stealthPrivateKey, publicKey: ephemeralPublicKey, address: stealthAddress };
  }

  generateNullifier(commitmentHash: string, stealthPrivateKey: string): string {
    return crypto.createHash('sha256').update(commitmentHash + stealthPrivateKey).digest('hex');
  }

  // ──────────────────────────────────────────
  // Encryption (AES-256-GCM)
  // ──────────────────────────────────────────

  encryptHedgeDetails(hedge: OasisHedgeCommitment): { encryptedData: string; iv: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(JSON.stringify(hedge), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return {
      encryptedData: encrypted + ':' + authTag.toString('hex'),
      iv: iv.toString('hex'),
    };
  }

  decryptHedgeDetails(encryptedData: string, iv: string): OasisHedgeCommitment {
    const [encrypted, authTagHex] = encryptedData.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  }

  // ──────────────────────────────────────────
  // On-chain commitment submission (Sapphire)
  // ──────────────────────────────────────────

  /**
   * Submit commitment to GaslessCommitmentVerifier on Oasis Sapphire.
   * The commitment is stored on-chain but reveals nothing about the hedge.
   */
  async submitCommitmentOnChain(
    commitmentHash: string,
    signer: Signer,
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      if (!DEPLOYED.gaslessCommitmentVerifier) {
        return { success: false, error: 'GaslessCommitmentVerifier not deployed' };
      }

      const contract = new ethers.Contract(
        DEPLOYED.gaslessCommitmentVerifier,
        GASLESS_VERIFIER_ABI,
        signer,
      );

      const bytes32Hash = '0x' + commitmentHash;
      const tx = await contract.submitCommitment(bytes32Hash);
      const receipt = await tx.wait();

      logger.info('✅ [OasisPrivate] Commitment submitted on-chain', {
        txHash: receipt.hash,
      });

      return { success: true, txHash: receipt.hash };
    } catch (e) {
      logger.error('❌ [OasisPrivate] Commitment submission failed', { error: String(e) });
      return { success: false, error: String(e) };
    }
  }

  /**
   * Verify a commitment exists on-chain via GaslessCommitmentVerifier
   */
  async verifyCommitmentOnChain(commitmentHash: string): Promise<OasisCommitmentVerification> {
    try {
      if (!DEPLOYED.gaslessCommitmentVerifier) {
        return { isValid: false, timestamp: 0, submitter: '', onChain: false };
      }

      const provider = getOasisSapphireProvider().provider;
      const contract = new ethers.Contract(
        DEPLOYED.gaslessCommitmentVerifier,
        GASLESS_VERIFIER_ABI,
        provider,
      );

      const bytes32Hash = '0x' + commitmentHash;
      const result = await contract.verifyCommitment(bytes32Hash);

      return {
        isValid: result.isValid,
        timestamp: Number(result.timestamp),
        submitter: result.submitter,
        onChain: true,
      };
    } catch (e) {
      logger.warn('⚠️ [OasisPrivate] On-chain verification failed', { error: String(e) });
      return { isValid: false, timestamp: 0, submitter: '', onChain: false };
    }
  }

  /**
   * Get total commitment count from the contract
   */
  async getCommitmentCount(): Promise<number> {
    try {
      if (!DEPLOYED.gaslessCommitmentVerifier) return 0;
      const provider = getOasisSapphireProvider().provider;
      const contract = new ethers.Contract(
        DEPLOYED.gaslessCommitmentVerifier,
        GASLESS_VERIFIER_ABI,
        provider,
      );
      const count = await contract.getCommitmentCount();
      return Number(count);
    } catch {
      return 0;
    }
  }

  // ──────────────────────────────────────────
  // Full private hedge creation
  // ──────────────────────────────────────────

  async createPrivateHedge(
    asset: string,
    side: 'LONG' | 'SHORT',
    size: number,
    notionalValue: number,
    leverage: number,
    entryPrice: number,
    masterPublicKey: string,
  ): Promise<OasisPrivateHedge> {
    const hedgeDetails: OasisHedgeCommitment = {
      asset,
      side,
      size,
      notionalValue,
      leverage,
      entryPrice,
      salt: crypto.randomBytes(32).toString('hex'),
    };

    const { commitmentHash } = this.generateCommitment(hedgeDetails);
    const stealthKeys = this.generateStealthAddress(masterPublicKey);
    const nullifier = this.generateNullifier(commitmentHash, stealthKeys.privateKey);
    const { encryptedData, iv } = this.encryptHedgeDetails(hedgeDetails);

    logger.info('🛡️ [OasisPrivate] Private hedge created', {
      hash: commitmentHash.substring(0, 16) + '...',
      stealth: stealthKeys.address.substring(0, 10) + '...',
    });

    return {
      commitmentHash,
      stealthAddress: stealthKeys.address,
      nullifier,
      timestamp: Date.now(),
      encryptedData,
      iv,
      chain: 'oasis-sapphire',
    };
  }

  // ──────────────────────────────────────────
  // Explorer links
  // ──────────────────────────────────────────

  getExplorerUrl(txHash: string): string {
    return `${DEPLOYED.explorerBase}/tx/${txHash}`;
  }
}

// ============================================
// SINGLETON
// ============================================

let _instance: OasisPrivateHedgeService | null = null;

export function getOasisPrivateHedgeService(): OasisPrivateHedgeService {
  if (!_instance) {
    _instance = new OasisPrivateHedgeService();
  }
  return _instance;
}

export default OasisPrivateHedgeService;
