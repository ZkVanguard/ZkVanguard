/**
 * ZK Paymaster Integration - Base-style gasless transactions
 * Users call paymaster directly, no backend needed!
 */

import { config } from '@/app/providers';
import { writeContract, waitForTransactionReceipt } from '@wagmi/core';

const PAYMASTER_ADDRESS = '0x81E2d8d860847Ca1b3ADd950dBeED6191be23D87' as `0x${string}`;

const PAYMASTER_ABI = [
  {
    "inputs": [
      { "internalType": "bytes32", "name": "proofHash", "type": "bytes32" },
      { "internalType": "bytes32", "name": "merkleRoot", "type": "bytes32" },
      { "internalType": "uint256", "name": "securityLevel", "type": "uint256" }
    ],
    "name": "sponsorCommitment",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "nonpayable",
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
    "name": "balance",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

/**
 * Store commitment gasless via paymaster
 * TRUE GASLESS - User pays ZERO, paymaster covers everything
 */
export async function storeCommitmentViaPaymaster(
  proofHash: string,
  merkleRoot: string,
  securityLevel: bigint
): Promise<string> {
  console.log('⚡ Storing commitment via ZKPaymaster (TRUE GASLESS)...');
  console.log('   Proof Hash:', proofHash);
  console.log('   Merkle Root:', merkleRoot);
  console.log('   Security Level:', securityLevel.toString(), 'bits');
  console.log('   💎 YOU PAY ZERO GAS - Paymaster covers everything!');

  // Call paymaster's sponsorCommitment function
  const hash = await writeContract(config, {
    address: PAYMASTER_ADDRESS,
    abi: PAYMASTER_ABI,
    functionName: 'sponsorCommitment',
    args: [proofHash as `0x${string}`, merkleRoot as `0x${string}`, securityLevel],
  });

  console.log('📤 Transaction submitted:', hash);
  console.log('⏳ Waiting for confirmation...');

  const receipt = await waitForTransactionReceipt(config, { hash });

  if (receipt.status === 'success') {
    console.log('✅ Commitment stored GASLESS!');
    console.log('   Transaction:', hash);
    console.log('   🎉 YOU PAID $0.00 - Paymaster paid for you!');
    return hash;
  } else {
    throw new Error('Transaction failed');
  }
}

/**
 * Get paymaster statistics
 */
export async function getPaymasterStats() {
  const { readContract } = await import('@wagmi/core');
  
  const stats = await readContract(config, {
    address: PAYMASTER_ADDRESS,
    abi: PAYMASTER_ABI,
    functionName: 'getStats',
  });

  return {
    totalGasSponsored: stats[0],
    totalTransactions: stats[1],
    balance: stats[2],
    avgGasPerTx: stats[3],
  };
}

/**
 * Get paymaster balance
 */
export async function getPaymasterBalance(): Promise<bigint> {
  const { readContract } = await import('@wagmi/core');
  
  return await readContract(config, {
    address: PAYMASTER_ADDRESS,
    abi: PAYMASTER_ABI,
    functionName: 'balance',
  }) as bigint;
}
