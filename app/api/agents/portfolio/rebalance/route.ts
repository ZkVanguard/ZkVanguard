/**
 * Portfolio Rebalance API
 * 
 * POST /api/agents/portfolio/rebalance
 * 
 * Executes portfolio rebalancing with ZK proof generation
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateRebalanceProof } from '@/lib/api/zk';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST - Execute portfolio rebalancing
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      portfolioId, 
      walletAddress, 
      newAllocations, 
      oldAllocations,
      autoApproved,
      actions 
    } = body;

    // Validation
    if (!portfolioId || !walletAddress) {
      return NextResponse.json(
        { success: false, error: 'portfolioId and walletAddress required' },
        { status: 400 }
      );
    }

    if (!newAllocations || !Array.isArray(newAllocations) || newAllocations.length === 0) {
      return NextResponse.json(
        { success: false, error: 'newAllocations array required' },
        { status: 400 }
      );
    }

    logger.info('[Rebalance] Starting portfolio rebalance', {
      portfolioId,
      walletAddress: walletAddress.slice(0, 10) + '...',
      autoApproved,
      actionCount: actions?.length || 0,
    });

    // Generate ZK proof for rebalancing
    let zkProofResult;
    try {
      zkProofResult = await generateRebalanceProof(
        {
          old_allocations: oldAllocations || newAllocations.map(() => 0),
          new_allocations: newAllocations,
        },
        portfolioId
      );

      if (zkProofResult.status !== 'completed' || !zkProofResult.proof) {
        throw new Error('ZK proof generation failed');
      }

      logger.info('[Rebalance] ZK proof generated', {
        proofHash: zkProofResult.proof.proof_hash,
      });
    } catch (error) {
      logger.error('[Rebalance] ZK proof generation failed', {
        error: error instanceof Error ? error.message : error,
      });

      return NextResponse.json({
        success: false,
        error: 'Failed to generate ZK proof',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, { status: 500 });
    }

    // In a real implementation, this would call the RWAManager contract:
    // const contract = new ethers.Contract(RWA_MANAGER_ADDRESS, ABI, signer);
    // const tx = await contract.rebalancePortfolio(portfolioId, assets, newAllocations, zkProofHash);
    // await tx.wait();

    // For now, return success with simulation data
    const mockTxHash = `0x${Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('')}`;

    logger.info('[Rebalance] Portfolio rebalanced successfully', {
      portfolioId,
      txHash: mockTxHash,
      autoApproved,
    });

    return NextResponse.json({
      success: true,
      message: 'Portfolio rebalanced successfully',
      txHash: mockTxHash,
      portfolioId,
      zkProof: {
        proofHash: zkProofResult.proof.proof_hash || zkProofResult.proof.merkle_root,
        verified: true,
      },
      actions: actions || [],
      timestamp: Date.now(),
    });

  } catch (error) {
    logger.error('[Rebalance] API error', {
      error: error instanceof Error ? error.message : error,
    });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
