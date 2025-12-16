/**
 * ZK Commitment Verifier Contract Integration
 * Stores commitments for proofs verified off-chain with 521-bit security
 */

import { writeContract, readContract } from '@wagmi/core';
import { config } from '@/app/providers';
import ZKCommitmentVerifierABI from '@/contracts/abi/ZKCommitmentVerifier.json';

const COMMITMENT_VERIFIER_ADDRESS = '0xf4a4bBF21b2fa9C6Bd232ee1Cd0C847374Ccf6D3';

export interface CommitmentData {
  proofHash: string;
  merkleRoot: string;
  verifiedOffChain: boolean;
  timestamp: number;
  metadata: {
    security_level: number;
    field_bits: number;
    proof_type: string;
  };
}

export interface StoredCommitment {
  proofHash: string;
  merkleRoot: string;
  timestamp: bigint;
  verifier: string;
  verified: boolean;
  securityLevel: bigint;
}

/**
 * Store a commitment on-chain for a proof verified off-chain
 */
export async function storeCommitment(commitment: CommitmentData) {
  console.log('⛓️  Storing commitment on-chain...');
  console.log('   Proof Hash:', commitment.proofHash);
  console.log('   Merkle Root:', commitment.merkleRoot);
  console.log('   Security Level:', commitment.metadata.field_bits, 'bits');
  
  const hash = await writeContract(config, {
    address: COMMITMENT_VERIFIER_ADDRESS,
    abi: ZKCommitmentVerifierABI,
    functionName: 'storeCommitment',
    args: [
      commitment.proofHash,
      commitment.merkleRoot,
      BigInt(commitment.metadata.field_bits)
    ]
  });
  
  console.log('✅ Commitment stored! Transaction:', hash);
  return hash;
}

/**
 * Verify a commitment exists on-chain
 */
export async function verifyCommitmentOnChain(proofHash: string) {
  console.log('🔍 Checking commitment on-chain...');
  console.log('   Proof Hash:', proofHash);
  
  const result = await readContract(config, {
    address: COMMITMENT_VERIFIER_ADDRESS,
    abi: ZKCommitmentVerifierABI,
    functionName: 'verifyCommitment',
    args: [proofHash]
  }) as [boolean, bigint, string, bigint];
  
  const [valid, timestamp, verifier, securityLevel] = result;
  
  console.log('✅ Commitment found:');
  console.log('   Valid:', valid);
  console.log('   Timestamp:', new Date(Number(timestamp) * 1000).toISOString());
  console.log('   Verifier:', verifier);
  console.log('   Security:', securityLevel.toString(), 'bits');
  
  return {
    valid,
    timestamp,
    verifier,
    securityLevel
  };
}

/**
 * Get full commitment details
 */
export async function getCommitment(proofHash: string): Promise<StoredCommitment> {
  const commitment = await readContract(config, {
    address: COMMITMENT_VERIFIER_ADDRESS,
    abi: ZKCommitmentVerifierABI,
    functionName: 'getCommitment',
    args: [proofHash]
  }) as StoredCommitment;
  
  return commitment;
}

/**
 * Get total number of commitments stored
 */
export async function getCommitmentCount(): Promise<number> {
  const count = await readContract(config, {
    address: COMMITMENT_VERIFIER_ADDRESS,
    abi: ZKCommitmentVerifierABI,
    functionName: 'getCommitmentCount',
    args: []
  }) as bigint;
  
  return Number(count);
}

/**
 * Store a commitment GASLESS (relayer pays gas via ERC-2771)
 */
export async function storeCommitmentGasless(
  proofHash: string,
  merkleRoot: string,
  securityLevel: bigint
) {
  console.log('⚡ Preparing gasless commitment storage...');
  console.log('   Proof Hash:', proofHash);
  console.log('   Merkle Root:', merkleRoot);
  console.log('   Security Level:', securityLevel.toString(), 'bits');
  
  // Use the existing gasless infrastructure
  const { executeGasless } = await import('@/lib/gasless');
  const { ethers } = await import('ethers');
  const { getAccount, getWalletClient } = await import('@wagmi/core');
  const { walletClientToSigner } = await import('./utils');
  
  const account = getAccount(config);
  if (!account.address) throw new Error('No wallet connected');
  
  // Get wallet client from wagmi/RainbowKit
  const walletClient = await getWalletClient(config);
  if (!walletClient) throw new Error('Could not get wallet client');
  
  // Convert to ethers signer using the existing utility
  const signer = await walletClientToSigner(walletClient);
  
  // Encode the storeCommitment function call
  const iface = new ethers.Interface(ZKCommitmentVerifierABI);
  const data = iface.encodeFunctionData('storeCommitment', [
    proofHash,
    merkleRoot,
    securityLevel
  ]);
  
  // Execute gasless via ERC-2771 relayer
  const result = await executeGasless(signer, COMMITMENT_VERIFIER_ADDRESS, data, 0n, true);
  
  console.log('✅ Gasless commitment stored! Transaction:', result.txHash);
  console.log('   Relayer paid the gas - YOU PAID NOTHING! ⚡');
  
  return result;
}
