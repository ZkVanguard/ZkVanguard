/**
 * X402 Payment Challenge API Route
 * 
 * Creates 402 Payment Required challenges for protected resources.
 * This is the entry point for x402-protected operations.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getX402FacilitatorService } from '@/lib/services/x402-facilitator';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * POST /api/x402/challenge
 * 
 * Creates a payment challenge for accessing a protected resource.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      amount = '10000', // Default 0.01 USDC (6 decimals)
      description = 'ZkVanguard Service Access',
      resource = '/api/protected-resource',
    } = body;

    const facilitatorService = getX402FacilitatorService();
    const challenge = facilitatorService.createPaymentChallenge(
      amount,
      description,
      resource
    );

    // Return 402 Payment Required with challenge
    return NextResponse.json(challenge, { status: 402 });
  } catch (error) {
    console.error('[X402 Challenge] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create payment challenge' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/x402/challenge
 * 
 * Returns information about x402 payment challenges.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const paymentId = searchParams.get('paymentId');

  const facilitatorService = getX402FacilitatorService();

  // Check entitlement if paymentId provided
  if (paymentId) {
    const entitlement = facilitatorService.getEntitlement(paymentId);
    
    if (entitlement) {
      return NextResponse.json({
        entitled: true,
        paymentId,
        txHash: entitlement.txHash,
        settledAt: entitlement.settledAt,
      });
    } else {
      return NextResponse.json({
        entitled: false,
        paymentId,
      });
    }
  }

  // Return general info
  const config = facilitatorService.getNetworkConfig();
  return NextResponse.json({
    x402Version: 1,
    network: config.network,
    isTestnet: config.isTestnet,
    supportedOperations: [
      'settlement',
      'zk-proof-storage',
      'batch-payment',
      'hedge-execution',
    ],
  });
}
