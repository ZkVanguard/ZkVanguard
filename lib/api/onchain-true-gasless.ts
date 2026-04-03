/**
 * TRUE Gasless On-Chain ZK Commitment Storage
 * Powered by x402 + USDC - Users pay ZERO CRO gas!
 * 
 * How it works:
 * 1. User pays tiny USDC fee (~$0.01) via x402 gaslessly
 * 2. x402 Facilitator executes USDC transfer (user pays $0.00 CRO)
 * 3. Contract receives USDC and stores commitment
 * 4. Contract sponsors CRO gas from its balance
 * 
 * Result: User needs ZERO CRO, only USDC!
 * 
 * Uses ethers.js for direct contract interactions (WDK migration)
 */

import { logger } from '../utils/logger';
import { ethers } from 'ethers';
import { getCronosRpcUrl } from '@/lib/throttled-provider';
import { getContractAddresses } from '@/lib/contracts/addresses';
import { getCronosChainId } from '@/lib/throttled-provider';

// RPC URL resolved from env
const CRONOS_RPC = getCronosRpcUrl();

// Import X402Client only on server-side to avoid node:crypto issues in browser
const getX402Client = async () => {
  if (typeof window === 'undefined') {
    const { X402Client } = await import('@/integrations/x402/X402Client.server');
    return X402Client;
  }
  throw new Error('X402Client can only be used server-side');
};

const X402_VERIFIER_ADDRESS = (process.env.NEXT_PUBLIC_X402_GASLESS_VERIFIER || getContractAddresses(getCronosChainId()).gaslessZKCommitmentVerifier) as `0x${string}`;
const USDC_TOKEN = (getContractAddresses(getCronosChainId()).usdtToken) as `0x${string}`; // USDC/USDT token

const X402_VERIFIER_ABI = [
  {
    "inputs": [
      { "internalType": "bytes32", "name": "proofHash", "type": "bytes32" },
      { "internalType": "bytes32", "name": "merkleRoot", "type": "bytes32" },
      { "internalType": "uint256", "name": "securityLevel", "type": "uint256" }
    ],
    "name": "storeCommitmentWithUSDC",
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
    "name": "storeCommitmentsBatchWithUSDC",
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
        "internalType": "struct X402GaslessZKCommitmentVerifier.ProofCommitment",
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
      { "internalType": "uint256", "name": "totalComm", "type": "uint256" },
      { "internalType": "uint256", "name": "totalFees", "type": "uint256" },
      { "internalType": "uint256", "name": "totalGas", "type": "uint256" },
      { "internalType": "uint256", "name": "usdcBalance", "type": "uint256" },
      { "internalType": "uint256", "name": "croBalance", "type": "uint256" },
      { "internalType": "uint256", "name": "feePerComm", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "feePerCommitment",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

const USDC_ABI = [
  {
    "inputs": [
      { "internalType": "address", "name": "spender", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "approve",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "account", "type": "address" }
    ],
    "name": "balanceOf",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// Get ethers provider for read operations
function getProvider() {
  return new ethers.JsonRpcProvider(CRONOS_RPC);
}

// Get contract instance for read operations
function getVerifierContract() {
  const provider = getProvider();
  return new ethers.Contract(X402_VERIFIER_ADDRESS, X402_VERIFIER_ABI, provider);
}

function getUsdcContract() {
  const provider = getProvider();
  return new ethers.Contract(USDC_TOKEN, USDC_ABI, provider);
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
function getSignedVerifierContract() {
  const signer = getSigner();
  return new ethers.Contract(X402_VERIFIER_ADDRESS, X402_VERIFIER_ABI, signer);
}

export interface TrueGaslessResult {
  txHash: string;
  trueGasless: true;
  x402Powered: true;
  usdcFee: string;
  croGasPaid: '$0.00';
  message: string;
}

/**
 * Store commitment with TRUE GASLESS via x402 + USDC
 * User pays ~$0.01 USDC via x402 (gaslessly), ZERO CRO needed!
 */
export async function storeCommitmentTrueGasless(
  proofHash: string,
  merkleRoot: string,
  securityLevel: bigint,
  signer: ethers.Signer
): Promise<TrueGaslessResult> {
  logger.info('TRUE GASLESS storage via x402 + USDC', {
    features: ['Zero CRO gas', 'Tiny USDC fee (~$0.01)', 'x402 Facilitator powered']
  });

  // Get fee amount
  const verifierContract = getVerifierContract();
  const feePerCommitment = await verifierContract.feePerCommitment();

  logger.info('USDC fee calculated', { usdcFee: (Number(feePerCommitment) / 1e6).toFixed(2) });

  // Step 1: Check USDC balance
  const userAddress = await signer.getAddress();
  const usdcContract = getUsdcContract();
  const usdcBalance = await usdcContract.balanceOf(userAddress);

  if (usdcBalance < feePerCommitment) {
    throw new Error(`Insufficient USDC. Need ${(Number(feePerCommitment) / 1e6).toFixed(2)} USDC`);
  }

  // Step 2: Approve USDC via x402 (gasless!)
  logger.info('Step 1: Approve USDC (x402 gasless)');
  
  // Use x402 for gasless USDC approval
  const X402ClientClass = await getX402Client();
  const x402Client = new X402ClientClass();
  x402Client.setSigner(signer);
  
  const _approvalResult = await x402Client.executeGaslessTransfer({
    token: USDC_TOKEN,
    from: userAddress,
    to: X402_VERIFIER_ADDRESS,
    amount: feePerCommitment.toString(),
  });

  logger.info('USDC approved via x402 (gasless)', { croPaid: '0.00' });

  // Step 3: Store commitment (contract pays CRO gas)
  logger.info('Step 2: Store commitment on-chain');
  
  const signedContract = getSignedVerifierContract();
  const tx = await signedContract.storeCommitmentWithUSDC(proofHash, merkleRoot, securityLevel);

  logger.info('Transaction submitted', { hash: tx.hash });
  logger.info('Waiting for TRUE gasless confirmation');

  const receipt = await tx.wait();

  if (receipt && receipt.status === 1) {
    logger.info('Commitment stored with TRUE GASLESS', {
      transaction: tx.hash,
      usdcPaid: (Number(feePerCommitment) / 1e6).toFixed(2) + ' USDC',
      croGasPaid: '$0.00',
    });
    
    return {
      txHash: tx.hash,
      trueGasless: true,
      x402Powered: true,
      usdcFee: (Number(feePerCommitment) / 1e6).toFixed(2) + ' USDC',
      croGasPaid: '$0.00',
      message: 'TRUE gasless via x402 + USDC - you paid $0.00 CRO!',
    };
  } else {
    throw new Error('Transaction failed');
  }
}

/**
 * Store multiple commitments in batch with TRUE GASLESS
 */
export async function storeCommitmentsBatchTrueGasless(
  commitments: Array<{
    proofHash: string;
    merkleRoot: string;
    securityLevel: bigint;
  }>,
  signer: ethers.Signer
): Promise<TrueGaslessResult> {
  logger.info('TRUE GASLESS BATCH storage via x402 + USDC', {
    commitments: commitments.length,
    userPaysZeroCRO: true,
  });

  const verifierContract = getVerifierContract();
  const feePerCommitment = await verifierContract.feePerCommitment();

  const totalFee = feePerCommitment * BigInt(commitments.length);
  logger.info('Total USDC fee calculated', {
    totalFee: (Number(totalFee) / 1e6).toFixed(2) + ' USDC',
  });

  // Approve and transfer via x402
  const userAddress = await signer.getAddress();
  const X402ClientClass = await getX402Client();
  const x402Client = new X402ClientClass();
  x402Client.setSigner(signer);
  
  await x402Client.executeGaslessTransfer({
    token: USDC_TOKEN,
    from: userAddress,
    to: X402_VERIFIER_ADDRESS,
    amount: totalFee.toString(),
  });

  // Store batch
  const proofHashes = commitments.map(c => c.proofHash);
  const merkleRoots = commitments.map(c => c.merkleRoot);
  const securityLevels = commitments.map(c => c.securityLevel);

  const signedContract = getSignedVerifierContract();
  const tx = await signedContract.storeCommitmentsBatchWithUSDC(proofHashes, merkleRoots, securityLevels);

  logger.info('Batch transaction submitted', { hash: tx.hash });
  const receipt = await tx.wait();

  if (receipt && receipt.status === 1) {
    logger.info('Batch stored with TRUE GASLESS', {
      commitments: commitments.length,
      txHash: tx.hash,
    });
    
    return {
      txHash: tx.hash,
      trueGasless: true,
      x402Powered: true,
      usdcFee: (Number(totalFee) / 1e6).toFixed(2) + ' USDC',
      croGasPaid: '$0.00',
      message: `${commitments.length} commitments stored - TRUE gasless!`,
    };
  } else {
    throw new Error('Transaction failed');
  }
}

/**
 * Verify a commitment exists on-chain
 */
export async function verifyCommitmentOnChain(proofHash: string) {
  const verifierContract = getVerifierContract();
  const commitment = await verifierContract.verifyCommitment(proofHash);
  return commitment;
}

/**
 * Get TRUE gasless statistics
 */
export async function getTrueGaslessStats() {
  const verifierContract = getVerifierContract();
  const stats = await verifierContract.getStats();

  return {
    totalCommitments: stats[0],
    totalUSDCCollected: stats[1],
    totalCROGasSponsored: stats[2],
    contractUSDCBalance: stats[3],
    contractCROBalance: stats[4],
    feePerCommitment: stats[5],
  };
}
