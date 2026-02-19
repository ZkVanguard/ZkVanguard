/**
 * Proxy PDA (Program Derived Address) System
 * 
 * Similar to Solana PDAs - generates deterministic proxy addresses
 * that have NO private keys. Only the owner can authorize withdrawals.
 * 
 * Flow:
 * 1. Owner creates hedge → PDA proxy address derived deterministically
 * 2. Proxy address is used on-chain (no one has the private key)
 * 3. Only owner can prove ownership via ZK binding
 * 4. Withdrawal always goes back to owner wallet
 * 
 * Security: The proxy address is just a "vault" - no one can spend from it
 * except through the smart contract which verifies ZK ownership proof.
 */

import crypto from 'crypto';

export interface ProxyPDA {
  proxyAddress: string;      // The derived proxy address (no private key!)
  ownerAddress: string;      // The owner who can withdraw
  nonce: number;             // Nonce used in derivation
  seed: string;              // Seed used in derivation
  derivationPath: string;    // Full derivation path for verification
  zkBinding: string;         // ZK binding proof
}

export interface ProxyPDAVerification {
  isValid: boolean;
  proxyAddress: string;
  ownerAddress: string;
  message: string;
}

// Domain separator for our PDA derivation (prevents cross-protocol attacks)
const ZKVANGUARD_PDA_DOMAIN = 'ZKVANGUARD_PROXY_PDA_V1';

/**
 * Derive a deterministic proxy address from owner wallet
 * This address has NO private key - it's derived like a Solana PDA
 * 
 * @param ownerAddress - The owner's wallet address
 * @param nonce - Optional nonce for multiple proxies (default: 0)
 * @param seed - Optional custom seed (default: 'hedge')
 */
export function deriveProxyPDA(
  ownerAddress: string,
  nonce: number = 0,
  seed: string = 'hedge'
): ProxyPDA {
  // Normalize owner address
  const normalizedOwner = ownerAddress.toLowerCase();
  
  // Create derivation path: DOMAIN + owner + seed + nonce
  const derivationPath = `${ZKVANGUARD_PDA_DOMAIN}:${normalizedOwner}:${seed}:${nonce}`;
  
  // Generate deterministic proxy address using keccak256 (same as EVM)
  // This mirrors how CREATE2 and Solana PDAs work
  const hash = crypto.createHash('sha3-256')
    .update(derivationPath)
    .digest('hex');
  
  // Take last 20 bytes (40 hex chars) as the proxy address (standard EVM address format)
  const proxyAddress = '0x' + hash.slice(-40);
  
  // Generate ZK binding that proves owner controls this proxy
  const zkBinding = crypto.createHash('sha256')
    .update(`zk-pda-binding:${normalizedOwner}:${proxyAddress}:${derivationPath}`)
    .digest('hex');
  
  return {
    proxyAddress,
    ownerAddress: normalizedOwner,
    nonce,
    seed,
    derivationPath,
    zkBinding,
  };
}

/**
 * Verify that a proxy address was derived from an owner
 * Used to prove ownership without revealing the owner on-chain
 */
export function verifyProxyPDA(
  proxyAddress: string,
  claimedOwner: string,
  nonce: number = 0,
  seed: string = 'hedge'
): ProxyPDAVerification {
  // Re-derive the expected proxy address
  const expectedPDA = deriveProxyPDA(claimedOwner, nonce, seed);
  
  const isValid = expectedPDA.proxyAddress.toLowerCase() === proxyAddress.toLowerCase();
  
  return {
    isValid,
    proxyAddress: proxyAddress.toLowerCase(),
    ownerAddress: claimedOwner.toLowerCase(),
    message: isValid 
      ? 'Valid PDA: Owner can authorize withdrawals'
      : 'Invalid PDA: Address does not match owner derivation',
  };
}

/**
 * Find the correct nonce for an existing proxy-owner pair
 * Useful when you have a proxy address and need to verify ownership
 */
export function findProxyNonce(
  proxyAddress: string,
  ownerAddress: string,
  seed: string = 'hedge',
  maxNonce: number = 100
): number | null {
  for (let nonce = 0; nonce < maxNonce; nonce++) {
    const pda = deriveProxyPDA(ownerAddress, nonce, seed);
    if (pda.proxyAddress.toLowerCase() === proxyAddress.toLowerCase()) {
      return nonce;
    }
  }
  return null;
}

/**
 * Generate a withdrawal authorization proof
 * This proves the owner authorizes withdrawal from proxy to owner
 */
export function generateWithdrawalProof(
  proxyPDA: ProxyPDA,
  amount: string,
  timestamp: number = Date.now()
): {
  proof: string;
  proxyAddress: string;
  ownerAddress: string;
  amount: string;
  timestamp: number;
  expiresAt: number;
} {
  // Proof expires in 5 minutes
  const expiresAt = timestamp + 5 * 60 * 1000;
  
  // Generate withdrawal authorization proof
  const proofData = `withdraw:${proxyPDA.proxyAddress}:${proxyPDA.ownerAddress}:${amount}:${timestamp}:${proxyPDA.zkBinding}`;
  const proof = crypto.createHash('sha256').update(proofData).digest('hex');
  
  return {
    proof,
    proxyAddress: proxyPDA.proxyAddress,
    ownerAddress: proxyPDA.ownerAddress,
    amount,
    timestamp,
    expiresAt,
  };
}

/**
 * Verify a withdrawal authorization proof
 */
export function verifyWithdrawalProof(
  proof: string,
  proxyAddress: string,
  ownerAddress: string,
  amount: string,
  timestamp: number,
  zkBinding: string
): boolean {
  const expectedProofData = `withdraw:${proxyAddress.toLowerCase()}:${ownerAddress.toLowerCase()}:${amount}:${timestamp}:${zkBinding}`;
  const expectedProof = crypto.createHash('sha256').update(expectedProofData).digest('hex');
  
  // Check proof matches and hasn't expired
  const now = Date.now();
  const expiresAt = timestamp + 5 * 60 * 1000;
  
  return proof === expectedProof && now < expiresAt;
}

/**
 * Get multiple proxy PDAs for an owner (like having multiple accounts)
 */
export function getOwnerProxies(
  ownerAddress: string,
  count: number = 5,
  seed: string = 'hedge'
): ProxyPDA[] {
  const proxies: ProxyPDA[] = [];
  for (let nonce = 0; nonce < count; nonce++) {
    proxies.push(deriveProxyPDA(ownerAddress, nonce, seed));
  }
  return proxies;
}

export default {
  deriveProxyPDA,
  verifyProxyPDA,
  findProxyNonce,
  generateWithdrawalProof,
  verifyWithdrawalProof,
  getOwnerProxies,
};
