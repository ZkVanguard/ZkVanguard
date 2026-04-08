import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { heavyLimiter } from '@/lib/security/rate-limiter';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ZK_API_URL = process.env.ZK_API_URL || 'https://zk-api.starknova.xyz';

export async function POST(request: NextRequest) {
  const rateLimited = await heavyLimiter.checkDistributed(request);
  if (rateLimited) return rateLimited;

  try {
    const body = await request.json();
    const { proof, statement, claim } = body;

    // Use the claim from proof generation if available
    const verificationClaim = claim || JSON.stringify(statement, null, 0);

    // Call the real FastAPI ZK server
    const response = await fetch(`${ZK_API_URL}/api/zk/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        proof: proof,
        claim: verificationClaim,
        public_inputs: []
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ZK API error: ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();

    return NextResponse.json({
      success: true,
      verified: result.valid, // Backend returns 'valid' not 'verified'
      duration_ms: result.duration_ms
    });
  } catch (error: unknown) {
    logger.error('Error verifying proof:', error);
    return safeErrorResponse(error, 'ZK proof verification');
  }
}
