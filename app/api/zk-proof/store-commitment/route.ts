import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';

const RPC_URL = 'https://evm-t3.cronos.org';
const X402_VERIFIER_ADDRESS = '0x85bC6BE2ee9AD8E0f48e94Eae90464723EE4E852';

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
      { "internalType": "bytes32", "name": "proofHash", "type": "bytes32" }
    ],
    "name": "getCommitment",
    "outputs": [
      {
        "components": [
          { "internalType": "bytes32", "name": "merkleRoot", "type": "bytes32" },
          { "internalType": "uint256", "name": "timestamp", "type": "uint256" },
          { "internalType": "uint256", "name": "securityLevel", "type": "uint256" },
          { "internalType": "bool", "name": "verified", "type": "bool" }
        ],
        "internalType": "struct IX402GaslessZKCommitmentVerifier.Commitment",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { proofHash, merkleRoot, securityLevel } = body;

    if (!proofHash || !merkleRoot) {
      return NextResponse.json(
        { success: false, error: 'proofHash and merkleRoot are required' },
        { status: 400 }
      );
    }

    // For demo purposes, we'll simulate the on-chain storage
    // In production, this would use x402 facilitator for true gasless
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Check if contract exists
    const code = await provider.getCode(X402_VERIFIER_ADDRESS);
    const contractExists = code !== '0x';

    if (contractExists) {
      // Try to read from the contract to verify it's working
      const contract = new ethers.Contract(X402_VERIFIER_ADDRESS, X402_VERIFIER_ABI, provider);
      
      try {
        // Simulate the commitment storage (would need private key for actual tx)
        // For demo, we return success with simulated tx hash
        const simulatedTxHash = `0x${Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
        
        return NextResponse.json({
          success: true,
          txHash: simulatedTxHash,
          trueGasless: true,
          x402Powered: true,
          usdcFee: '$0.01',
          croGasPaid: '$0.00',
          message: 'Commitment stored via x402 gasless (simulated for demo)',
          commitment: {
            proofHash,
            merkleRoot,
            securityLevel: securityLevel || 521,
            timestamp: Date.now(),
            verified: true,
          },
        });
      } catch (contractError) {
        console.error('Contract interaction error:', contractError);
      }
    }

    // Fallback: Return simulated success for demo
    return NextResponse.json({
      success: true,
      txHash: `0x${Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
      trueGasless: true,
      x402Powered: true,
      usdcFee: '$0.01',
      croGasPaid: '$0.00',
      message: 'Commitment stored (demo mode - contract simulation)',
      commitment: {
        proofHash,
        merkleRoot,
        securityLevel: securityLevel || 521,
        timestamp: Date.now(),
        verified: true,
      },
    });

  } catch (error) {
    console.error('Store commitment error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to store commitment',
      },
      { status: 500 }
    );
  }
}
