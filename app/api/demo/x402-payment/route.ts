import { NextRequest, NextResponse } from 'next/server';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import { requireAuth } from '@/lib/security/auth-middleware';
import { mutationLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { ethers } from 'ethers';

export const runtime = 'nodejs';

export const maxDuration = 10;
const MAX_AMOUNT = 100_000; // $100k max per demo settlement
const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

/**
 * x402 Facilitator Gasless Payment API
 * SECURITY: Requires authentication + rate limiting. Disabled in production.
 */
export async function POST(request: NextRequest) {
  // SECURITY: Block in production — demo routes must not execute real settlements
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    return NextResponse.json(
      { success: false, error: 'Demo endpoints are disabled in production' },
      { status: 403 }
    );
  }

  // Rate limit
  const limited = mutationLimiter.check(request);
  if (limited) return limited;

  // Require authentication
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { 
      beneficiary,
      amount = '100',
      token = '0x0000000000000000000000000000000000000000', // Native CRO
      purpose = 'x402 gasless payment',
      priority = 'HIGH'
    } = body;

    // Input validation
    if (!beneficiary || !ethers.isAddress(beneficiary)) {
      return NextResponse.json(
        { success: false, error: 'Valid beneficiary address is required' },
        { status: 400 }
      );
    }
    const numAmount = parseFloat(amount);
    if (!isFinite(numAmount) || numAmount <= 0 || numAmount > MAX_AMOUNT) {
      return NextResponse.json(
        { success: false, error: `Amount must be between 0 and ${MAX_AMOUNT}` },
        { status: 400 }
      );
    }
    if (!VALID_PRIORITIES.includes(priority as typeof VALID_PRIORITIES[number])) {
      return NextResponse.json(
        { success: false, error: `Priority must be one of: ${VALID_PRIORITIES.join(', ')}` },
        { status: 400 }
      );
    }

    const orchestrator = getAgentOrchestrator();
    
    const result = await orchestrator.executeSettlement({
      portfolioId: 'demo-portfolio',
      beneficiary,
      amount,
      token,
      purpose,
      priority: priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        settlement: result.data,
        agentId: result.agentId,
        executionTime: result.executionTime,
        x402Powered: true,
        gasless: true,
        gasCost: '$0.00',
        zkProofGenerated: true,
        live: true,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { 
        success: false,
        error: 'Settlement failed',
      },
      { status: 500 }
    );
  } catch (error) {
    return safeErrorResponse(error, 'demo/x402-payment');
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'x402 Gasless Payment System operational',
    features: [
      'TRUE gasless via x402 Facilitator',
      'EIP-3009 compliant transfers',
      'Batch payment processing',
      'ZK-STARK proof generation',
      'Zero gas costs for users',
      'Multi-agent coordination',
    ],
    networks: ['Cronos Testnet', 'Cronos Mainnet'],
  });
}
