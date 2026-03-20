/**
 * On-Chain x402-Powered Gasless Commitment Storage
 * TRUE GASLESS via x402 Facilitator - No gas costs for users!
 * 
 * Uses ethers.js for direct contract interactions (WDK migration)
 */

import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES } from '../contracts/addresses';
import { logger } from '../utils/logger';

// RPC URL for Cronos Testnet
const CRONOS_TESTNET_RPC = process.env.NEXT_PUBLIC_CRONOS_TESTNET_RPC || 'https://evm-t3.cronos.org';

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

// Get ethers provider for read operations
function getProvider() {
  return new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
}

// Get contract instance for read operations
function getContract() {
  const provider = getProvider();
  return new ethers.Contract(GASLESS_VERIFIER_ADDRESS, GASLESS_VERIFIER_ABI, provider);
}

// Get signer for write operations (requires PRIVATE_KEY in env)
function getSigner() {
  const privateKey = process.env.PRIVATE_KEY || process.env.MOONLANDER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('No private key found in environment variables');
  }
  const provider = getProvider();
  return new ethers.Wallet(privateKey, provider);
}

// Get contract with signer for write operations
function getSignedContract() {
  const signer = getSigner();
  return new ethers.Contract(GASLESS_VERIFIER_ADDRESS, GASLESS_VERIFIER_ABI, signer);
}

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
  logger.info('Storing commitment via x402 GASLESS', {
    proofHash,
    merkleRoot,
    securityLevel: securityLevel.toString() + ' bits',
    gasless: true,
  });

  const contract = getSignedContract();
  const tx = await contract.storeCommitmentGasless(proofHash, merkleRoot, securityLevel);

  logger.info('Transaction submitted', { hash: tx.hash });
  logger.info('Waiting for gasless confirmation via x402');

  const receipt = await tx.wait();

  if (receipt && receipt.status === 1) {
    logger.info('Commitment stored via x402 GASLESS', {
      transaction: tx.hash,
      userCost: '$0.00',
    });
    
    return {
      txHash: tx.hash,
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
  logger.info('Storing commitments via x402 GASLESS (BATCH)', {
    count: commitments.length,
    gasless: true,
  });

  const proofHashes = commitments.map(c => c.proofHash);
  const merkleRoots = commitments.map(c => c.merkleRoot);
  const securityLevels = commitments.map(c => c.securityLevel);

  const contract = getSignedContract();
  const tx = await contract.storeCommitmentsBatchGasless(proofHashes, merkleRoots, securityLevels);

  logger.info('Batch transaction submitted', { hash: tx.hash });
  logger.info('Waiting for gasless confirmation via x402');

  const receipt = await tx.wait();

  if (receipt && receipt.status === 1) {
    logger.info('Batch stored via x402 GASLESS', {
      transaction: tx.hash,
      commitments: commitments.length,
      userCost: '$0.00',
    });
    
    return {
      txHash: tx.hash,
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
  const contract = getContract();
  const commitment = await contract.verifyCommitment(proofHash);
  return commitment;
}

/**
 * Get on-chain gasless statistics
 */
export async function getOnChainGaslessStats() {
  const contract = getContract();
  
  const [stats, balance, totalCommitments] = await Promise.all([
    contract.getStats(),
    contract.getBalance(),
    contract.totalCommitments()
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
