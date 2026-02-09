/**
 * Gasless ZK Commitment API
 * TRUE $0.00 gasless via ZKPaymaster meta-transactions
 * 
 * Flow:
 * 1. POST /prepare - Get signature request for user
 * 2. User signs in frontend (FREE)
 * 3. POST /execute - We relay the signed message (user pays $0.00)
 */

import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { getCronosProvider } from '@/lib/throttled-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Contract address (update after deployment)
const ZK_PAYMASTER_ADDRESS = process.env.ZK_PAYMASTER_ADDRESS || '0x0000000000000000000000000000000000000000';
const RPC_URL = process.env.NEXT_PUBLIC_CRONOS_TESTNET_RPC || 'https://evm-t3.cronos.org';
const CHAIN_ID = 338; // Cronos Testnet

// Minimal ABI
const ZK_PAYMASTER_ABI = [
  'function storeCommitmentGasless(address user, bytes32 proofHash, bytes32 merkleRoot, uint256 securityLevel, uint256 deadline, bytes signature) external',
  'function getNonce(address user) external view returns (uint256)',
  'function getContractBalance() external view returns (uint256)',
  'function getStats() external view returns (uint256, uint256, uint256, uint256)',
];

// Module-level cached contract instances (reused across requests)
let _readContract: ethers.Contract | null = null;
function getPaymasterReadContract() {
  if (!_readContract) {
    const provider = getCronosProvider(RPC_URL).provider;
    _readContract = new ethers.Contract(
      ZK_PAYMASTER_ADDRESS, ZK_PAYMASTER_ABI, provider
    );
  }
  return _readContract;
}

// EIP-712 Domain
const DOMAIN = {
  name: 'ZKPaymaster',
  version: '1',
  chainId: CHAIN_ID,
  verifyingContract: ZK_PAYMASTER_ADDRESS,
};

// EIP-712 Types
const TYPES = {
  StoreCommitment: [
    { name: 'user', type: 'address' },
    { name: 'proofHash', type: 'bytes32' },
    { name: 'merkleRoot', type: 'bytes32' },
    { name: 'securityLevel', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

/**
 * GET /api/gasless/paymaster
 * Get contract stats and prepare endpoint info
 */
export async function GET() {
  try {
    if (ZK_PAYMASTER_ADDRESS === '0x0000000000000000000000000000000000000000') {
      return NextResponse.json({
        success: false,
        error: 'ZKPaymaster not deployed. Set ZK_PAYMASTER_ADDRESS in .env',
        deployed: false,
      });
    }

    const provider = getCronosProvider(RPC_URL).provider;
    const contract = getPaymasterReadContract();

    const [totalCommitments, totalGasSponsored, totalTxRelayed, balance] = await contract.getStats();

    return NextResponse.json({
      success: true,
      deployed: true,
      contract: ZK_PAYMASTER_ADDRESS,
      chainId: CHAIN_ID,
      stats: {
        totalCommitments: Number(totalCommitments),
        totalGasSponsored: ethers.formatEther(totalGasSponsored) + ' CRO',
        totalTransactionsRelayed: Number(totalTxRelayed),
        balance: ethers.formatEther(balance) + ' CRO',
        estimatedTxRemaining: Math.floor(Number(balance) / 0.001), // ~0.001 CRO per tx
      },
      costBreakdown: {
        userCost: '$0.00',
        relayerCost: '$0.00 (refunded)',
        contractCost: 'Testnet CRO (FREE)',
        totalCost: '$0.00 ✅',
      },
    });
  } catch (error) {
    logger.error('❌ Failed to get paymaster stats', { error });
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * POST /api/gasless/paymaster
 * Two actions:
 * - action: "prepare" - Get signature request for user
 * - action: "execute" - Relay signed message
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'prepare') {
      return handlePrepare(body);
    } else if (action === 'execute') {
      return handleExecute(body);
    } else {
      return NextResponse.json({
        success: false,
        error: 'Invalid action. Use "prepare" or "execute"',
      }, { status: 400 });
    }
  } catch (error) {
    logger.error('❌ Gasless paymaster error', { error });
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * Prepare signature request for user
 * User will sign this message (costs $0.00)
 */
async function handlePrepare(body: {
  userAddress: string;
  proofHash: string;
  merkleRoot: string;
  securityLevel: number;
}) {
  const { userAddress, proofHash, merkleRoot, securityLevel } = body;

  if (!userAddress || !proofHash || !merkleRoot) {
    return NextResponse.json({
      success: false,
      error: 'Missing required fields: userAddress, proofHash, merkleRoot',
    }, { status: 400 });
  }

  const provider = getCronosProvider(RPC_URL).provider;
  const contract = getPaymasterReadContract();

  // Get user's nonce
  const nonce = await contract.getNonce(userAddress);
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour

  // Create message for user to sign
  const message = {
    user: userAddress,
    proofHash,
    merkleRoot,
    securityLevel: securityLevel || 521,
    nonce: nonce.toString(),
    deadline,
  };

  logger.info('📝 Prepared gasless signature request', {
    user: userAddress,
    nonce: nonce.toString(),
  });

  return NextResponse.json({
    success: true,
    signatureRequest: {
      domain: DOMAIN,
      types: TYPES,
      primaryType: 'StoreCommitment',
      message,
    },
    instructions: [
      '1. Sign this message with your wallet (FREE - no gas)',
      '2. Send signature to POST /api/gasless/paymaster with action: "execute"',
      '3. We relay your transaction - you pay $0.00',
    ],
    userCost: '$0.00',
  });
}

/**
 * Execute gasless transaction
 * User provides signature, we relay and pay gas (get refunded)
 */
async function handleExecute(body: {
  userAddress: string;
  proofHash: string;
  merkleRoot: string;
  securityLevel: number;
  signature: string;
}) {
  const { userAddress, proofHash, merkleRoot, securityLevel, signature } = body;

  if (!userAddress || !proofHash || !merkleRoot || !signature) {
    return NextResponse.json({
      success: false,
      error: 'Missing required fields: userAddress, proofHash, merkleRoot, signature',
    }, { status: 400 });
  }

  // Initialize relayer
  const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!relayerPrivateKey) {
    return NextResponse.json({
      success: false,
      error: 'Relayer not configured',
    }, { status: 500 });
  }

  const provider = getCronosProvider(RPC_URL).provider;
  const relayer = new ethers.Wallet(relayerPrivateKey, provider);
  const contract = new ethers.Contract(ZK_PAYMASTER_ADDRESS, ZK_PAYMASTER_ABI, relayer);

  // Use deadline from now (nonce is verified on-chain, no need to fetch it here)
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  logger.info('🚀 Relaying gasless transaction', {
    user: userAddress,
    relayer: relayer.address,
    proofHash: proofHash.substring(0, 18) + '...',
  });

  // Execute meta-transaction
  const tx = await contract.storeCommitmentGasless(
    userAddress,
    proofHash,
    merkleRoot,
    securityLevel || 521,
    deadline,
    signature,
    { gasLimit: 300000 }
  );

  const receipt = await tx.wait();

  logger.info('✅ Gasless transaction relayed', {
    txHash: receipt.hash,
    gasUsed: receipt.gasUsed.toString(),
    userCost: '$0.00',
  });

  return NextResponse.json({
    success: true,
    txHash: receipt.hash,
    explorerUrl: `https://explorer.cronos.org/testnet3/tx/${receipt.hash}`,
    gasUsed: receipt.gasUsed.toString(),
    costBreakdown: {
      userCost: '$0.00 ✅',
      relayerCost: '$0.00 (refunded by contract)',
      message: 'TRUE gasless - you paid nothing!',
    },
  });
}
