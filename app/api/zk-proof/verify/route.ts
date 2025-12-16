import { NextRequest, NextResponse } from 'next/server';

const ZK_API_URL = process.env.ZK_API_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { proof, statement } = body;

    // Call the real FastAPI ZK server
    const response = await fetch(`${ZK_API_URL}/api/zk/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        proof: proof,
        public_inputs: statement ? [statement.threshold || 0] : []
      })
    });

    if (!response.ok) {
      throw new Error(`ZK API error: ${response.statusText}`);
    }

    const result = await response.json();

    return NextResponse.json({
      success: true,
      verified: result.verified
    });
  } catch (error: any) {
    console.error('Error verifying proof:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
