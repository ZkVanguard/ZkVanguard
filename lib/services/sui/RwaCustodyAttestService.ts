/**
 * RWA Custody Attestation Service (TypeScript SDK)
 *
 * Wraps the `rwa_custody_attestor.move` Move contract: builds canonical signed
 * messages, submits attestations, fetches active attestations for a wallet,
 * and verifies signatures off-chain.
 *
 * Off-chain custodians use `buildSignedMessage` + their own ed25519 signer to
 * produce a signature; portfolio holders pass that signature into
 * `submitAttestation` to commit the attestation on-chain.
 *
 * Canonical signed message layout (must match Move build_signed_message):
 *   bytes 0..8    portfolio_id (big-endian u64)
 *   bytes 8..40   asset_list_hash (32 bytes, SHA-256)
 *   bytes 40..48  nonce (big-endian u64)
 *   bytes 48..56  valid_until (big-endian u64)
 *   total: 56 bytes
 */
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2.js';
import { logger } from '@/lib/utils/logger';

export const CUSTODY_ATTESTOR_MODULE = 'rwa_custody_attestor';
export const MAX_VALIDITY_MS = 31_536_000_000; // 365 days, must match Move constant

export interface AssetEntry {
  type: string;     // e.g. "US_TBILL_3MO", "GOLD_OZ", "REAL_ESTATE_TITLE"
  identifier: string; // e.g. ISIN, ticker, parcel ID
  quantity: string; // decimal-as-string for precision
  custodian_account?: string; // custodian's internal account reference
}

export interface AttestationParams {
  portfolioId: bigint;
  assetListHash: Uint8Array; // 32 bytes
  nonce: bigint;
  validUntil: bigint; // unix ms
  custodianPubkey: Uint8Array; // 32 bytes
  signature: Uint8Array; // 64 bytes
}

export interface CustodyAttestationView {
  objectId: string;
  portfolioId: bigint;
  custodianPubkey: string; // hex
  assetListHash: string; // hex
  nonce: bigint;
  attestedAt: bigint;
  validUntil: bigint;
  signature: string; // hex
  isValid: boolean;
}

export class RwaCustodyAttestService {
  constructor(
    private readonly client: SuiClient,
    private readonly packageId: string,
    private readonly registryId: string,
  ) {}

  /**
   * Hash a canonical asset list for use as the on-chain commitment.
   * The off-chain asset list itself stays private — only its hash hits chain.
   */
  hashAssetList(assets: AssetEntry[]): Uint8Array {
    // Canonical serialization: sorted by (type, identifier), JSON-encoded with
    // sorted keys, hashed with SHA-256. Off-chain custodian and holder MUST
    // use this exact canonicalization to produce matching hashes.
    const sorted = [...assets].sort((a, b) => {
      if (a.type !== b.type) return a.type < b.type ? -1 : 1;
      return a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0;
    });
    const canonical = sorted.map((a) => ({
      custodian_account: a.custodian_account ?? '',
      identifier: a.identifier,
      quantity: a.quantity,
      type: a.type,
    }));
    return sha256(new TextEncoder().encode(JSON.stringify(canonical)));
  }

  /**
   * Build the canonical 56-byte message the custodian must sign with their
   * ed25519 private key. Mirrors the Move `build_signed_message` helper.
   */
  buildSignedMessage(params: {
    portfolioId: bigint;
    assetListHash: Uint8Array;
    nonce: bigint;
    validUntil: bigint;
  }): Uint8Array {
    if (params.assetListHash.length !== 32) {
      throw new Error(`assetListHash must be 32 bytes, got ${params.assetListHash.length}`);
    }
    const msg = new Uint8Array(56);
    writeU64BE(msg, 0, params.portfolioId);
    msg.set(params.assetListHash, 8);
    writeU64BE(msg, 40, params.nonce);
    writeU64BE(msg, 48, params.validUntil);
    return msg;
  }

  /**
   * Verify an attestation signature off-chain. Useful for counterparties who
   * want to re-check independently before trusting on-chain state.
   */
  verifySignature(params: AttestationParams): boolean {
    try {
      const msg = this.buildSignedMessage({
        portfolioId: params.portfolioId,
        assetListHash: params.assetListHash,
        nonce: params.nonce,
        validUntil: params.validUntil,
      });
      return ed25519.verify(params.signature, msg, params.custodianPubkey);
    } catch (e) {
      logger.warn('[CustodyAttest] signature verification threw', { error: String(e) });
      return false;
    }
  }

  /**
   * Build the transaction that submits a signed attestation. The caller signs
   * + executes; the resulting CustodyAttestation object is transferred to the
   * signer's wallet.
   */
  buildSubmitAttestationTx(params: AttestationParams, clockId: string = '0x6'): Transaction {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.packageId}::${CUSTODY_ATTESTOR_MODULE}::submit_attestation`,
      arguments: [
        tx.object(this.registryId),
        tx.pure.u64(params.portfolioId),
        tx.pure.vector('u8', Array.from(params.assetListHash)),
        tx.pure.u64(params.nonce),
        tx.pure.u64(params.validUntil),
        tx.pure.vector('u8', Array.from(params.custodianPubkey)),
        tx.pure.vector('u8', Array.from(params.signature)),
        tx.object(clockId),
      ],
    });
    return tx;
  }

  /**
   * Build the transaction that enrolls a custodian. Caller must own the AdminCap.
   */
  buildEnrollCustodianTx(
    adminCapId: string,
    custodianPubkey: Uint8Array,
    label: string,
    jurisdiction: string,
    clockId: string = '0x6',
  ): Transaction {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.packageId}::${CUSTODY_ATTESTOR_MODULE}::enroll_custodian`,
      arguments: [
        tx.object(adminCapId),
        tx.object(this.registryId),
        tx.pure.vector('u8', Array.from(custodianPubkey)),
        tx.pure.string(label),
        tx.pure.string(jurisdiction),
        tx.object(clockId),
      ],
    });
    return tx;
  }

  buildRevokeCustodianTx(
    adminCapId: string,
    custodianPubkey: Uint8Array,
    clockId: string = '0x6',
  ): Transaction {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.packageId}::${CUSTODY_ATTESTOR_MODULE}::revoke_custodian`,
      arguments: [
        tx.object(adminCapId),
        tx.object(this.registryId),
        tx.pure.vector('u8', Array.from(custodianPubkey)),
        tx.object(clockId),
      ],
    });
    return tx;
  }

  /**
   * Fetch all CustodyAttestation objects owned by a wallet. Filters out
   * expired ones if requested.
   */
  async getAttestationsForWallet(
    walletAddress: string,
    options: { onlyValid?: boolean } = {},
  ): Promise<CustodyAttestationView[]> {
    try {
      const resp = await this.client.getOwnedObjects({
        owner: walletAddress,
        filter: {
          StructType: `${this.packageId}::${CUSTODY_ATTESTOR_MODULE}::CustodyAttestation`,
        },
        options: { showContent: true, showType: true },
      });
      const now = BigInt(Date.now());
      const results: CustodyAttestationView[] = [];
      for (const item of resp.data ?? []) {
        const content = item.data?.content;
        if (!content || content.dataType !== 'moveObject') continue;
        const fields = (content as { fields: Record<string, unknown> }).fields;
        if (!fields) continue;
        const portfolioId = BigInt(String(fields.portfolio_id ?? 0));
        const attestedAt = BigInt(String(fields.attested_at ?? 0));
        const validUntil = BigInt(String(fields.valid_until ?? 0));
        const isValid = validUntil > now;
        if (options.onlyValid && !isValid) continue;
        results.push({
          objectId: item.data?.objectId ?? '',
          portfolioId,
          custodianPubkey: toHex(fields.custodian_pubkey as number[] | string),
          assetListHash: toHex(fields.asset_list_hash as number[] | string),
          nonce: BigInt(String(fields.nonce ?? 0)),
          attestedAt,
          validUntil,
          signature: toHex(fields.signature as number[] | string),
          isValid,
        });
      }
      return results.sort((a, b) => (b.attestedAt > a.attestedAt ? 1 : -1));
    } catch (e) {
      logger.warn('[CustodyAttest] getAttestationsForWallet failed', { error: String(e) });
      return [];
    }
  }
}

function writeU64BE(buf: Uint8Array, offset: number, value: bigint): void {
  let v = value;
  for (let i = 7; i >= 0; i--) {
    buf[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function toHex(input: number[] | string | undefined): string {
  if (!input) return '';
  if (typeof input === 'string') return input.startsWith('0x') ? input : `0x${input}`;
  return '0x' + Array.from(input)
    .map((b) => (b & 0xff).toString(16).padStart(2, '0'))
    .join('');
}
