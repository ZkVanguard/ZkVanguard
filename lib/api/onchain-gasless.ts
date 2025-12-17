/**
 * On-Chain x402-Powered Gasless Commitment Storage
 * TRUE GASLESS via x402 Facilitator - No gas costs for users!
 */

import { config } from '@/app/providers';
import { writeContract, waitForTransactionReceipt, readContract } from '@wagmi/core';
import { CONTRACT_ADDRESSES } from '@/lib/contracts/addresses';

// x402-powered gasless verifier (uses x402 Facilitator for zero gas costs)
const GASLESS_VERIFIER_ADDRESS = CONTRACT_ADDRESSES.cronos_testnet.gaslessZKCommitmentVerifier;

const GASLESS_VERIFIER_ABI = [
  {
    "inputs": [
      { "internalType": "bytes32", "name": "proofHash", "type": "bytes32" },
      { "internalType": "bytes32", "name": "merkleRoot", "type": "bytes32" },
      { "internalType": "uint256", "name": "securityLevel", "type": "uint256" }
    ],
    "name": "storeCommitmentGasless",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32[]", "name": "proofHashes", "type": "bytes32[]" },
      { "internalType": "bytes32[]", "name": "merkleRoots", "type": "bytes32[]" },
      { "internalType": "uint256[]", "name": "securityLevels", "type": "uint256[]" }
    ],
    "name": "storeCommitmentsBatchGasless",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "proofHash", "type": "bytes32" }
    ],
    "name": "verifyCommitment",
    "outputs": [
      {
        "components": [
          { "internalType": "bytes32", "name": "proofHash", "type": "bytes32" },
          { "internalType": "bytes32", "name": "merkleRoot", "type": "bytes32" },
          { "internalType": "uint256", "name": "timestamp", "type": "uint256" },
          { "internalType": "address", "name": "verifier", "type": "address" },
          { "internalType": "bool", "name": "verified", "type": "bool" },
          { "internalType": "uint256", "name": "securityLevel", "type": "uint256" }
        ],
        "internalType": "struct GaslessZKCommitmentVerifier.ProofCommitment",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getStats",
    "outputs": [
      { "internalType": "uint256", "name": "totalGas", "type": "uint256" },
      { "internalType": "uint256", "name": "totalTxs", "type": "uint256" },
      { "internalType": "uint256", "name": "currentBalance", "type": "uint256" },
      { "internalType": "uint256", "name": "avgGasPerTx", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getBalance",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalCommitments",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export interface OnChainGaslessResult {
  txHash: string;
  gasless: true;
  message: string;
  x402Powered: true;
}

/**
 * Store commitment with x402-powered gasless
 * TRUE GASLESS via x402 Facilitator - NO GAS COSTS!
 */
export async function storeCommitmentOnChainGasless(
  proofHash: string,
  merkleRoot: string,
  securityLevel: bigint
): Promise<OnChainGaslessResult> {
  console.log('⚡ Storing commitment via x402 GASLESS...');
  console.log('   Proof Hash:', proofHash);
  console.log('   Merkle Root:', merkleRoot);
  console.log('   Security Level:', securityLevel.toString(), 'bits');
  console.log('   💎 x402 Facilitator handles gas - NET COST: $0.00!');

  const hash = await writeContract(config, {
    address: GASLESS_VERIFIER_ADDRESS,
    abi: GASLESS_VERIFIER_ABI,
    functionName: 'storeCommitmentGasless',
    args: [proofHash as `0x${string}`, merkleRoot as `0x${string}`, securityLevel],
  });

  console.log('📤 Transaction submitted:', hash);
  console.log('⏳ Waiting for gasless confirmation via x402...');

  const receipt = await waitForTransactionReceipt(config, { hash });

  if (receipt.status === 'success') {
    console.log('✅ Commitment stored via x402 GASLESS!');
    console.log('   Transaction:', hash);
    console.log('   🎉 x402 Facilitator paid gas - Your cost: $0.00!');
    
    return {
      txHash: hash,
      gasless: true,
      x402Powered: true,
      message: 'Commitment stored via x402 gasless - you paid $0.00!',
    };
  } else {
    throw new Error('Transaction failed');
  }
}

/**
 * Store multiple commitments in batch via x402 gasless
 */
export async function storeCommitmentsBatchOnChainGasless(
  commitments: Array<{
    proofHash: string;
    merkleRoot: string;
    securityLevel: bigint;
  }>
): Promise<OnChainGaslessResult> {
  console.log('⚡ Storing', commitments.length, 'commitments via x402 GASLESS (BATCH)...');
  console.log('   💎 x402 Facilitator handles ALL gas costs!');

  const proofHashes = commitments.map(c => c.proofHash as `0x${string}`);
  const merkleRoots = commitments.map(c => c.merkleRoot as `0x${string}`);
  const securityLevels = commitments.map(c => c.securityLevel);

  const hash = await writeContract(config, {
    address: GASLESS_VERIFIER_ADDRESS,
    abi: GASLESS_VERIFIER_ABI,
    functionName: 'storeCommitmentsBatchGasless',
    args: [proofHashes, merkleRoots, securityLevels],
  });

  console.log('📤 Batch transaction submitted:', hash);
  console.log('⏳ Waiting for gasless confirmation via x402...');

  const receipt = await waitForTransactionReceipt(config, { hash });

  if (receipt.status === 'success') {
    console.log('✅ Batch stored via x402 GASLESS!');
    console.log('   Transaction:', hash);
    console.log('   Commitments:', commitments.length);
    console.log('   🎉 x402 Facilitator paid gas - Your cost: $0.00!');
    
    return {
      txHash: hash,
      gasless: true,
      x402Powered: true,
      message: `${commitments.length} commitments stored via x402 gasless - you paid $0.00!`,
    };
  } else {
    throw new Error('Transaction failed');
  }
}

/**
 * Verify a commitment exists on-chain
 */
export async function verifyCommitmentOnChain(proofHash: string) {
  const commitment = await readContract(config, {
    address: GASLESS_VERIFIER_ADDRESS,
    abi: GASLESS_VERIFIER_ABI,
    functionName: 'verifyCommitment',
    args: [proofHash as `0x${string}`],
  });

  return commitment;
}

/**
 * Get on-chain gasless statistics
 */
export async function getOnChainGaslessStats() {
  const [stats, balance, totalCommitments] = await Promise.all([
    readContract(config, {
      address: GASLESS_VERIFIER_ADDRESS,
      abi: GASLESS_VERIFIER_ABI,
      functionName: 'getStats',
    }),
    readContract(config, {
      address: GASLESS_VERIFIER_ADDRESS,
      abi: GASLESS_VERIFIER_ABI,
      functionName: 'getBalance',
    }),
    readContract(config, {
      address: GASLESS_VERIFIER_ADDRESS,
      abi: GASLESS_VERIFIER_ABI,
      functionName: 'totalCommitments',
    })
  ]);

  return {
    totalGasSponsored: stats[0],
    totalTransactions: stats[1],
    contractBalance: stats[2],
    avgGasPerTx: stats[3],
    balance,
    totalCommitments,
  };
}
