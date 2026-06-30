/**
 * SUI Private Hedge Service
 *
 * Privacy-preserving hedging on SUI using deployed ZK contracts.
 * Wraps:
 *   - zk_hedge_commitment.move  (commitment storage + nullifier replay-protection)
 *   - zk_verifier.move          (ed25519-attested on-chain proof verification)
 *   - zk_proxy_vault.move       (proxy vault — deposit / time-locked withdraw with ZK proof)
 *
 * Privacy architecture:
 *   1. COMMITMENT   — SHA-256 over canonical hedge JSON; stored as 32 bytes on chain
 *   2. NULLIFIER    — SHA-256(commitment || secret) — prevents double-settle
 *   3. STARK PROOF  — real NIST P-521 ZK-STARK from the Python prover at $ZK_PYTHON_API_URL
 *   4. ATTESTATION  — Python prover signs the commitment_hash with the configured
 *                     ed25519 prover key; on-chain `verify_proof` checks the sig.
 *                     Bundle: proof_data = sig(64) || stark_json (off-chain re-verifiable)
 *   5. ENCRYPTION   — local AES-256-GCM of the hedge details for the operator's own
 *                     records; never sent on-chain.
 *
 * @see contracts/sui/sources/zk_hedge_commitment.move
 * @see contracts/sui/sources/zk_verifier.move
 * @see contracts/sui/sources/zk_proxy_vault.move
 * @see zkp/api/server.py — /api/zk/generate, /api/zk/verify, /api/zk/attest
 */

import { logger } from '@/lib/utils/logger';
import crypto from 'crypto';

// ============================================
// DEPLOYMENT CONFIG (env-driven)
// ============================================

interface ZkDeployment {
  packageId: string;
  zkHedgeCommitmentState: string;
  zkVerifierState: string;
  zkProxyVaultState: string;
  rpcUrl: string;
  explorerUrl: string;
}

const TESTNET_PRIVACY: ZkDeployment = {
  packageId: '0xb1442796d8593b552c7c27a072043639e3e6615a79ba11b87666d31b42fa283a',
  zkHedgeCommitmentState: '0x9c33f0df3d6a2e9a0f137581912aefb6aafcf0423d933fea298d44e222787b02',
  zkVerifierState: '0x6c75de60a47a9704625ecfb29c7bb05b49df215729133349345d0a15bec84be8',
  zkProxyVaultState: '0x5a0c81e3c95abe2b802e65d69439923ba786cdb87c528737e1680a0c791378a4',
  rpcUrl: 'https://fullnode.testnet.sui.io:443',
  explorerUrl: 'https://suiscan.xyz/testnet',
};

/** Read a SUI mainnet privacy-contract address from env, with optional fallback. */
function readEnv(name: string, fallback = ''): string {
  return ((typeof process !== 'undefined' ? process.env?.[name] : undefined) ?? fallback).trim();
}

function loadMainnetPrivacy(): ZkDeployment {
  return {
    packageId: readEnv('NEXT_PUBLIC_SUI_MAINNET_ZK_PRIVACY_PACKAGE_ID'),
    zkHedgeCommitmentState: readEnv('NEXT_PUBLIC_SUI_MAINNET_ZK_HEDGE_COMMITMENT_STATE'),
    zkVerifierState: readEnv('NEXT_PUBLIC_SUI_MAINNET_ZK_VERIFIER_STATE'),
    zkProxyVaultState: readEnv('NEXT_PUBLIC_SUI_MAINNET_ZK_PROXY_VAULT_STATE'),
    rpcUrl: readEnv('SUI_MAINNET_RPC', 'https://fullnode.mainnet.sui.io:443'),
    explorerUrl: 'https://suiscan.xyz/mainnet',
  };
}

// ============================================
// TYPES
// ============================================

export interface SuiHedgeCommitment {
  asset: string;
  side: 'LONG' | 'SHORT';
  size: number;
  notionalValue: number;
  leverage: number;
  entryPrice: number;
  salt: string;
}

export interface SuiPrivateHedge {
  commitmentHash: string;       // 32 bytes hex (on-chain)
  nullifier: string;            // 32 bytes hex (on-chain)
  timestamp: number;
  encryptedData: string;        // local-only — AES-256-GCM ciphertext + tag
  iv: string;                   // 12 bytes hex
}

/** Bundle returned by the Python prover for on-chain `zk_verifier::verify_proof`. */
export interface AttestedProofBundle {
  commitmentHashHex: string;
  signatureHex: string;          // 64 bytes — ed25519(commitment_hash)
  proverPubkeyHex: string;       // 32 bytes — what admin_set_prover_pubkey expects
  proofDataHex: string;          // sig(64) || stark JSON bytes — the `proof_data` Move arg
  starkProof: Record<string, unknown>;   // for off-chain re-verification
  starkProofSizeBytes: number;
}

// ============================================
// SUI PRIVATE HEDGE SERVICE
// ============================================

type Network = 'mainnet' | 'testnet';

export class SuiPrivateHedgeService {
  private network: Network;
  private config: ZkDeployment;
  private encryptionKeyHex: string;
  private proverApiUrl: string;

  constructor(network: Network = 'mainnet') {
    this.network = network;
    this.config = network === 'mainnet' ? loadMainnetPrivacy() : TESTNET_PRIVACY;

    // Mainnet readiness is per-installation. Operator sets the four
    // NEXT_PUBLIC_SUI_MAINNET_ZK_* env vars after deploying the privacy
    // package; tx builders short-circuit cleanly until then.
    if (network === 'mainnet' && !this.config.packageId) {
      logger.warn('[SuiZKHedge] Mainnet privacy contracts not configured — set NEXT_PUBLIC_SUI_MAINNET_ZK_PRIVACY_PACKAGE_ID + state IDs');
    }

    // AES key derivation: dev fallback is fine for local; production must set
    // HEDGE_ENCRYPTION_SEED to a 64-hex-char value so locally stored hedge
    // details aren't trivially decryptable.
    this.encryptionKeyHex = readEnv(
      'HEDGE_ENCRYPTION_SEED',
      'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    );

    this.proverApiUrl = readEnv('ZK_PYTHON_API_URL', 'http://127.0.0.1:8000');
    logger.info('[SuiZKHedge] Initialized', { network, prover: this.proverApiUrl });
  }

  isMainnetReady(): boolean {
    return Boolean(
      this.config.packageId &&
      this.config.zkHedgeCommitmentState &&
      this.config.zkVerifierState &&
      this.config.zkProxyVaultState,
    );
  }

  // ============================================
  // COMMITMENT + NULLIFIER
  // ============================================

  generateCommitment(hedge: SuiHedgeCommitment): { commitmentHash: string; salt: string } {
    const salt = hedge.salt || this.randomHex(32);
    // Canonical encoding: sort keys so commitment is stable across producers.
    const data = JSON.stringify({
      asset: hedge.asset,
      entryPrice: hedge.entryPrice,
      leverage: hedge.leverage,
      notionalValue: hedge.notionalValue,
      salt,
      side: hedge.side,
      size: hedge.size,
    });
    const commitmentHash = this.sha256(data);
    logger.info('[SuiZKHedge] Commitment generated', { hash: commitmentHash.slice(0, 16) + '...' });
    return { commitmentHash, salt };
  }

  generateNullifier(commitmentHash: string, secret: string): string {
    return this.sha256(commitmentHash + secret);
  }

  // ============================================
  // TRANSACTION BUILDERS — call REAL Move entry points
  // ============================================

  buildStoreCommitmentTransaction(commitmentHash: string, nullifier: string): {
    target: string;
    arguments: unknown[];
  } {
    this.requireMainnetConfigured();
    return {
      target: `${this.config.packageId}::zk_hedge_commitment::store_commitment`,
      arguments: [
        this.config.zkHedgeCommitmentState,
        this.hexToBytes(commitmentHash),
        this.hexToBytes(nullifier),
        '0x6', // Clock
      ],
    };
  }

  /**
   * Build on-chain ZK proof verification call.
   * `proofDataHex` MUST be produced by `getAttestedProofBundle()` — first 64
   * bytes are ed25519 sig over commitment_hash; chain rejects anything else.
   */
  buildVerifyProofTransaction(
    proofDataHex: string,
    commitmentHash: string,
    proofType: string,
    metadata: string = '',
  ): { target: string; arguments: unknown[] } {
    this.requireMainnetConfigured();
    return {
      target: `${this.config.packageId}::zk_verifier::verify_proof`,
      arguments: [
        this.config.zkVerifierState,
        this.hexToBytes(proofDataHex),
        this.hexToBytes(commitmentHash),
        proofType,
        metadata,
        '0x6', // Clock
      ],
    };
  }

  /**
   * Deposit into a proxy vault (no stealth — uses the live Move entry point).
   * Caller must own `proxyId` (proxy created via `zk_proxy_vault::create_proxy`).
   */
  buildProxyDepositTransaction(proxyId: string): {
    target: string;
    arguments: unknown[];
    coinAmountRequired: true;
  } {
    this.requireMainnetConfigured();
    return {
      target: `${this.config.packageId}::zk_proxy_vault::deposit`,
      arguments: [
        this.config.zkProxyVaultState,
        proxyId,
        // Caller PTB splits the Coin<SUI> and passes it as the 3rd arg.
        // Marked here so transaction builders know to inject the coin.
      ],
      coinAmountRequired: true,
    };
  }

  /**
   * Withdraw from a proxy vault. Requires a real attested ZK proof — Move
   * verifier rejects any payload whose first 64 bytes aren't a valid ed25519
   * signature over the proxy's zk_binding_hash.
   *
   * NOTE: For amounts ≥ time_lock_threshold the Move contract returns a
   * `PendingWithdrawal` object; the caller must wait the time-lock then
   * invoke `zk_proxy_vault::execute_withdrawal` separately.
   */
  buildProxyWithdrawTransaction(
    proxyId: string,
    amount: bigint,
    proofDataHex: string,
    publicInputsHex: string[],
  ): { target: string; arguments: unknown[] } {
    this.requireMainnetConfigured();
    if (!proofDataHex || this.hexToBytes(proofDataHex).length < 64) {
      throw new Error('proofDataHex must include a 64-byte ed25519 signature prefix');
    }
    return {
      target: `${this.config.packageId}::zk_proxy_vault::withdraw`,
      arguments: [
        this.config.zkProxyVaultState,
        proxyId,
        amount.toString(),
        this.hexToBytes(proofDataHex),
        publicInputsHex.map((h) => this.hexToBytes(h)),
        '0x6', // Clock
      ],
    };
  }

  // ============================================
  // PRIVATE HEDGE LIFECYCLE
  // ============================================

  async createPrivateHedge(
    asset: string,
    side: 'LONG' | 'SHORT',
    size: number,
    notionalValue: number,
    leverage: number,
    entryPrice: number,
  ): Promise<{
    privateHedge: SuiPrivateHedge;
    storeCommitmentTx: { target: string; arguments: unknown[] } | null;
  }> {
    const hedgeData: SuiHedgeCommitment = {
      asset, side, size, notionalValue, leverage, entryPrice,
      salt: this.randomHex(32),
    };
    const { commitmentHash } = this.generateCommitment(hedgeData);
    const nullifier = this.generateNullifier(commitmentHash, this.encryptionKeyHex);
    const { encrypted, iv } = this.encrypt(JSON.stringify(hedgeData));

    const privateHedge: SuiPrivateHedge = {
      commitmentHash, nullifier, timestamp: Date.now(),
      encryptedData: encrypted, iv,
    };
    const storeCommitmentTx = this.isMainnetReady() || this.network === 'testnet'
      ? this.buildStoreCommitmentTransaction(commitmentHash, nullifier)
      : null;

    logger.info('[SuiZKHedge] Private hedge created', {
      hash: commitmentHash.slice(0, 16) + '...',
      readyForOnChain: storeCommitmentTx !== null,
    });
    return { privateHedge, storeCommitmentTx };
  }

  // ============================================
  // REAL PROVER INTEGRATION (Python ZK-STARK + ed25519 attestation)
  // ============================================

  /**
   * Health check the Python prover. Returns false if unreachable; callers
   * should fall back to keeping the commitment off-chain.
   */
  async proverReachable(timeoutMs = 5000): Promise<boolean> {
    try {
      const r = await fetch(`${this.proverApiUrl}/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      return r.ok;
    } catch { return false; }
  }

  /**
   * Generate a real ZK-STARK solvency proof via the Python prover and bind
   * it to `commitmentHash` with an ed25519 signature. The returned
   * `proofDataHex` is exactly the format `zk_verifier::verify_proof` expects.
   *
   * Caller invariant: the operator MUST have set ZKV_PROVER_PRIV_KEY_HEX on
   * the Python server AND called `zk_verifier::admin_set_prover_pubkey` with
   * the matching pubkey, or on-chain verification rejects (insecure-mode
   * fallback is for testnet drills only).
   */
  async getAttestedSolvencyProof(
    commitment: SuiHedgeCommitment,
    commitmentHash: string,
    collateral: number,
    requiredMargin: number,
  ): Promise<AttestedProofBundle> {
    if (collateral < requiredMargin) {
      throw new Error('Cannot prove solvency: collateral < requiredMargin');
    }
    // Statement is what the verifier sees. Critical: public_inputs is now
    // folded into statement_hash by the prover (G1 fix), so a proof for
    // `requiredMargin = 200` won't pass verification when verifier asks
    // for `requiredMargin = 1_000_000`.
    const statement = {
      claim: `Hedge solvency: collateral >= required margin for commitment ${commitmentHash.slice(0, 16)}`,
      threshold: requiredMargin,
      public_inputs: [requiredMargin],
    };
    const witness = {
      secret_value: collateral,        // private — the actual collateral
      portfolio_value: commitment.notionalValue,
      volatility: 0,
    };

    const r = await fetch(`${this.proverApiUrl}/api/zk/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof_type: 'risk',
        statement,
        witness,
        commitment_hash_hex: commitmentHash,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      throw new Error(`Prover /api/zk/attest failed ${r.status}: ${detail.slice(0, 300)}`);
    }
    const body = await r.json() as {
      commitment_hash_hex: string;
      signature_hex: string;
      prover_pubkey_hex: string;
      proof_data_hex: string;
      stark_proof: Record<string, unknown>;
      stark_proof_size_bytes: number;
    };
    return {
      commitmentHashHex: body.commitment_hash_hex,
      signatureHex: body.signature_hex,
      proverPubkeyHex: body.prover_pubkey_hex,
      proofDataHex: body.proof_data_hex,
      starkProof: body.stark_proof,
      starkProofSizeBytes: body.stark_proof_size_bytes,
    };
  }

  /**
   * Off-chain proof verification — re-runs the STARK math on the Python prover
   * for independent confirmation. The on-chain Move check only validates the
   * ed25519 signature, so for end-to-end soundness any auditor needs to be
   * able to re-verify the STARK separately. That's what this method exposes.
   */
  async verifyAttestedProofOffChain(
    bundle: AttestedProofBundle,
    publicInputs: number[],
    claim: string,
  ): Promise<boolean> {
    const r = await fetch(`${this.proverApiUrl}/api/zk/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof: bundle.starkProof,
        public_inputs: publicInputs,
        claim,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return false;
    const body = await r.json() as { valid?: boolean };
    return body.valid === true;
  }

  // ============================================
  // READ OPERATIONS
  // ============================================

  async getCommitment(_commitmentHash: string): Promise<{ exists: boolean }> {
    if (!this.isMainnetReady() && this.network === 'mainnet') return { exists: false };
    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sui_getObject',
          params: [this.config.zkHedgeCommitmentState, { showContent: true }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      const fields = data.result?.data?.content?.fields;
      return { exists: !!fields };
    } catch (e) {
      logger.error('[SuiZKHedge] Failed to fetch commitment', { error: e });
      return { exists: false };
    }
  }

  // ============================================
  // CRYPTO HELPERS
  // ============================================

  private requireMainnetConfigured(): void {
    if (this.network === 'mainnet' && !this.isMainnetReady()) {
      throw new Error(
        'SUI mainnet privacy contracts not configured. Set NEXT_PUBLIC_SUI_MAINNET_ZK_PRIVACY_PACKAGE_ID and the three state IDs after deploying the privacy package (see docs/HEDGE_PRIVACY_MAINNET_DEPLOY.md).',
      );
    }
  }

  private sha256(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  private randomHex(bytes: number): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  private hexToBytes(hex: string): number[] {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes: number[] = [];
    for (let i = 0; i < clean.length; i += 2) {
      bytes.push(parseInt(clean.slice(i, i + 2), 16));
    }
    return bytes;
  }

  private encrypt(plaintext: string): { encrypted: string; iv: string } {
    const iv = crypto.randomBytes(12);
    const key = Buffer.from(this.encryptionKeyHex.slice(0, 64), 'hex');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encBuf = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      encrypted: Buffer.concat([encBuf, tag]).toString('hex'),
      iv: iv.toString('hex'),
    };
  }

  decrypt(encryptedHex: string, ivHex: string): SuiHedgeCommitment {
    const key = Buffer.from(this.encryptionKeyHex.slice(0, 64), 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const raw = Buffer.from(encryptedHex, 'hex');
    const tag = raw.subarray(raw.length - 16);
    const ciphertext = raw.subarray(0, raw.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const text = decipher.update(ciphertext) + decipher.final('utf8');
    return JSON.parse(text);
  }

  getDeploymentConfig(): ZkDeployment {
    return { ...this.config };
  }
}

// ============================================
// SINGLETON
// ============================================

let suiZKHedgeInstance: SuiPrivateHedgeService | null = null;
let suiZKHedgeInstanceNetwork: Network | null = null;

export function getSuiPrivateHedgeService(network: Network = 'mainnet'): SuiPrivateHedgeService {
  if (!suiZKHedgeInstance || suiZKHedgeInstanceNetwork !== network) {
    suiZKHedgeInstance = new SuiPrivateHedgeService(network);
    suiZKHedgeInstanceNetwork = network;
  }
  return suiZKHedgeInstance;
}
