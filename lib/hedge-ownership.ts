/**
 * On-Chain Hedge Ownership Registry
 * 
 * Maps commitmentHash (used as hedgeId in the gasless flow) → user walletAddress.
 * Persisted as a JSON file so the close API can verify the caller truly owns the hedge
 * without relying on the on-chain trader field (which is the relayer in ZK-private mode).
 * 
 * Security model:
 *  - On OPEN: walletAddress is recorded against the hedgeId
 *  - On CLOSE: user must present an EIP-712 signature from that same wallet
 *  - The relayer never reveals user wallets on-chain, but the API can verify ownership off-chain
 */

import fs from 'fs';
import path from 'path';

const REGISTRY_PATH = path.join(process.cwd(), 'deployments', 'hedge-ownership.json');

export interface HedgeOwnershipEntry {
  walletAddress: string;
  pairIndex: number;
  asset: string;
  side: string;
  collateral: number;
  leverage: number;
  openedAt: string;  // ISO timestamp
  txHash: string;
  onChainHedgeId?: string; // bytes32 from HedgeExecutor events, if available
}

type OwnershipRegistry = Record<string, HedgeOwnershipEntry>;

function loadRegistry(): OwnershipRegistry {
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
    }
  } catch {
    console.warn('⚠️ Could not load hedge ownership registry, starting fresh');
  }
  return {};
}

function saveRegistry(registry: OwnershipRegistry): void {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

/**
 * Register hedge ownership when a gasless hedge is opened.
 * Called by the open-onchain-gasless route after successful tx.
 */
export function registerHedgeOwnership(
  commitmentHash: string,
  entry: HedgeOwnershipEntry
): void {
  const registry = loadRegistry();
  registry[commitmentHash.toLowerCase()] = entry;
  saveRegistry(registry);
  console.log(`🔑 Registered hedge ownership: ${commitmentHash.slice(0, 18)}... → ${entry.walletAddress}`);
}

/**
 * Look up the wallet that owns a hedge.
 * Returns null if the hedge isn't in the registry (e.g., opened before this feature).
 */
export function getHedgeOwner(commitmentHash: string): HedgeOwnershipEntry | null {
  const registry = loadRegistry();
  return registry[commitmentHash.toLowerCase()] ?? null;
}

/**
 * Remove a hedge from the registry (called after successful close).
 */
export function removeHedgeOwnership(commitmentHash: string): void {
  const registry = loadRegistry();
  delete registry[commitmentHash.toLowerCase()];
  saveRegistry(registry);
}

/**
 * Get all hedges owned by a wallet address.
 */
export function getHedgesByWallet(walletAddress: string): Record<string, HedgeOwnershipEntry> {
  const registry = loadRegistry();
  const result: Record<string, HedgeOwnershipEntry> = {};
  const normalized = walletAddress.toLowerCase();
  for (const [hash, entry] of Object.entries(registry)) {
    if (entry.walletAddress.toLowerCase() === normalized) {
      result[hash] = entry;
    }
  }
  return result;
}

/**
 * The EIP-712 domain and types used by both the API and the frontend.
 * Exported so the dashboard can construct the same typed data for signing.
 */
export const CLOSE_HEDGE_DOMAIN = {
  name: 'Chronos Vanguard',
  version: '1',
  chainId: 338, // Cronos testnet
  verifyingContract: '0x090b6221137690EbB37667E4644287487CE462B9' as `0x${string}`,
};

export const CLOSE_HEDGE_TYPES = {
  CloseHedge: [
    { name: 'hedgeId', type: 'bytes32' },
    { name: 'action', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
};
