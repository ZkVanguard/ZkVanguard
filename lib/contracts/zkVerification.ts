/**
 * On-Chain ZK Proof Verification Utilities
 * Converts ZK-STARK proofs to contract format and submits to blockchain
 */

import type { Address } from 'viem';
import type { ZKProof } from '../api/zk';

/**
 * Convert ZK-STARK proof to contract-compatible format
 * Contracts expect specific structure for verification
 */
export function convertProofToContractFormat(proof: ZKProof) {
  // Extract key commitments from STARK proof
  const statementHash = typeof proof.statement_hash === 'string' 
    ? BigInt(proof.statement_hash) 
    : BigInt(proof.statement_hash);
    
  const challenge = typeof proof.challenge === 'string'
    ? BigInt(proof.challenge)
    : BigInt(proof.challenge);
    
  const response = typeof proof.response === 'string'
    ? BigInt(proof.response)
    : BigInt(proof.response);
  
  // Merkle root as bytes32
  const merkleRoot = proof.merkle_root.startsWith('0x') 
    ? proof.merkle_root 
    : `0x${proof.merkle_root}`;

  // Contract expects: [a, b, c, publicSignals[]]
  // Where a=statement, b=challenge, c=response
  return {
    a: statementHash.toString(),
    b: challenge.toString(),
    c: response.toString(),
    publicSignals: proof.public_inputs || [],
    merkleRoot: merkleRoot as `0x${string}`,
    metadata: {
      field_prime: proof.field_prime,
      security_level: proof.security_level,
      privacy_enhancements: proof.privacy_enhancements
    }
  };
}

/**
 * Verify proof on-chain using ZKVerifier contract
 */
export async function verifyProofOnChain(
  proof: ZKProof,
  zkVerifierAddress: Address,
  writeContract: (args: unknown) => Promise<`0x${string}`>
): Promise<{ hash: `0x${string}`; success: boolean }> {
  try {
    const contractFormat = convertProofToContractFormat(proof);
    
    // Call the verifyProof function on the ZKVerifier contract
    const hash = await writeContract({
      address: zkVerifierAddress,
      abi: [
        {
          name: 'verifyProof',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'a', type: 'uint256' },
            { name: 'b', type: 'uint256' },
            { name: 'c', type: 'uint256' },
            { name: 'publicSignals', type: 'uint256[]' }
          ],
          outputs: [{ name: '', type: 'bool' }]
        }
      ],
      functionName: 'verifyProof',
      args: [
        BigInt(contractFormat.a),
        BigInt(contractFormat.b),
        BigInt(contractFormat.c),
        contractFormat.publicSignals.map(BigInt)
      ],
    });

    return { hash, success: true };
  } catch (error) {
    console.error('On-chain verification failed:', error);
    throw error;
  }
}

/**
 * Verify proof gaslessly using UniversalRelayer
 */
export async function verifyProofGasless(
  proof: ZKProof,
  gaslessVerifierAddress: Address,
  relayerAddress: Address,
  signer: unknown
): Promise<{ hash: `0x${string}`; success: boolean }> {
  try {
    const contractFormat = convertProofToContractFormat(proof);
    
    // Create meta-transaction for gasless verification
    const functionData = {
      functionName: 'verifyProofGasless',
      args: [
        BigInt(contractFormat.a),
        BigInt(contractFormat.b),
        BigInt(contractFormat.c),
        contractFormat.publicSignals.map(BigInt)
      ]
    };

    // Sign meta-transaction
    const message = JSON.stringify(functionData);
    const signature = await signer.signMessage({ message });

    // Submit via relayer
    const response = await fetch('/api/gasless/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: gaslessVerifierAddress,
        functionData,
        signature,
        from: await signer.getAddress()
      })
    });

    if (!response.ok) {
      throw new Error('Gasless relay failed');
    }

    const result = await response.json();
    return { hash: result.txHash, success: true };
  } catch (error) {
    console.error('Gasless verification failed:', error);
    throw error;
  }
}

/**
 * Check if proof is already verified on-chain
 */
export async function isProofVerifiedOnChain(
  proofHash: string,
  zkVerifierAddress: Address,
  publicClient: unknown
): Promise<boolean> {
  try {
    const result = await publicClient.readContract({
      address: zkVerifierAddress,
      abi: [
        {
          name: 'isProofVerified',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'proofHash', type: 'bytes32' }],
          outputs: [{ name: '', type: 'bool' }]
        }
      ],
      functionName: 'isProofVerified',
      args: [proofHash as `0x${string}`],
    });

    return result as boolean;
  } catch (error) {
    console.error('Failed to check on-chain verification status:', error);
    return false;
  }
}

/**
 * Get verification history for an address
 */
export async function getVerificationHistory(
  address: Address,
  zkVerifierAddress: Address,
  publicClient: unknown
): Promise<Array<{ proofHash: string; timestamp: number; verified: boolean }>> {
  try {
    // Query VerificationComplete events
    const logs = await publicClient.getLogs({
      address: zkVerifierAddress,
      event: {
        name: 'VerificationComplete',
        type: 'event',
        inputs: [
          { name: 'user', type: 'address', indexed: true },
          { name: 'proofHash', type: 'bytes32', indexed: true },
          { name: 'verified', type: 'bool' },
          { name: 'timestamp', type: 'uint256' }
        ]
      },
      args: {
        user: address
      },
      fromBlock: 'earliest',
      toBlock: 'latest'
    });

    return logs.map((log: Record<string, unknown>) => ({
      proofHash: log.args.proofHash,
      timestamp: Number(log.args.timestamp),
      verified: log.args.verified
    }));
  } catch (error) {
    console.error('Failed to get verification history:', error);
    return [];
  }
}
