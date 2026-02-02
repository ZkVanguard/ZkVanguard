import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { proofHash, merkleRoot, securityLevel, signature: _signature, address } = body;

    if (!proofHash || !merkleRoot || !securityLevel) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    logger.info('Server-side on-chain storage request', {
      proofHash,
      merkleRoot,
      securityLevel,
      address
    });

    // Import server-side only modules
    const { storeCommitmentTrueGaslessServerSide } = await import('@/lib/api/onchain-true-gasless-server');

    // Execute the gasless transaction server-side
    const result = await storeCommitmentTrueGaslessServerSide(
      proofHash,
      merkleRoot,
      BigInt(securityLevel),
      address
    );

    logger.info('On-chain storage successful', {
      txHash: result.txHash,
      usdcFee: result.usdcFee
    });

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
      usdcFee: result.usdcFee,
      croGasPaid: result.croGasPaid,
      trueGasless: result.trueGasless,
      x402Powered: result.x402Powered
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('On-chain storage failed', { error: errorMessage });

    const lowered = errorMessage.toLowerCase();
    const isUserRecoverable = lowered.includes('balance') || lowered.includes('wallet') || lowered.includes('allowance');
    const status = isUserRecoverable ? 400 : 500;
    
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status }
    );
  }
}
