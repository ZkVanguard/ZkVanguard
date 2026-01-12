/**
 * X402 Settlement API Route
 * 
 * This is the CORE x402 settlement endpoint that uses the official
 * @crypto.com/facilitator-client SDK for payment processing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getX402FacilitatorService } from '@/lib/services/x402-facilitator';

/**
 * POST /api/x402/settle
 * 
 * Verifies and settles an x402 payment using the official Facilitator SDK.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { paymentId, paymentHeader, paymentRequirements } = body;

    if (!paymentId || !paymentHeader || !paymentRequirements) {
      return NextResponse.json(
        { 
          ok: false, 
          error: 'Missing required fields: paymentId, paymentHeader, paymentRequirements',
        },
        { status: 400 }
      );
    }

    const facilitatorService = getX402FacilitatorService();
    
    const result = await facilitatorService.settlePayment({
      paymentId,
      paymentHeader,
      paymentRequirements,
    });

    if (result.ok) {
      return NextResponse.json({
        ok: true,
        txHash: result.txHash,
        paymentId: result.paymentId,
        x402Powered: true,
        network: facilitatorService.getNetworkConfig().network,
        timestamp: new Date().toISOString(),
      });
    } else {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          details: result.details,
        },
        { status: 402 }
      );
    }
  } catch (error) {
    console.error('[X402 Settle] Error:', error);
    return NextResponse.json(
      { 
        ok: false, 
        error: 'Settlement failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/x402/settle
 * 
 * Returns x402 payment configuration and network info.
 */
export async function GET() {
  const facilitatorService = getX402FacilitatorService();
  const config = facilitatorService.getNetworkConfig();

  return NextResponse.json({
    x402Version: 1,
    network: config.network,
    isTestnet: config.isTestnet,
    usdcContract: config.usdcContract,
    merchantAddress: config.merchantAddress,
    supportedSchemes: ['exact'],
    timestamp: new Date().toISOString(),
  });
}
