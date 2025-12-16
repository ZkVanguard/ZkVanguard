import { NextRequest, NextResponse } from 'next/server';

const ZK_API_URL = process.env.ZK_API_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scenario, statement, witness } = body;

    // Call the real FastAPI ZK server
    const response = await fetch(`${ZK_API_URL}/api/zk/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        proof_type: scenario,
        data: {
          statement: statement,
          witness: witness
        }
      })
    });

    if (!response.ok) {
      throw new Error(`ZK API error: ${response.statusText}`);
    }

    const result = await response.json();
    
    // Check if proof generation is complete
    if (result.status === 'pending') {
      // Poll for completion
      const jobId = result.job_id;
      const maxAttempts = 30; // 30 seconds max
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        
        const statusResponse = await fetch(`${ZK_API_URL}/api/zk/proof/${jobId}`);
        if (!statusResponse.ok) {
          throw new Error('Failed to check proof status');
        }
        
        const statusResult = await statusResponse.json();
        
        if (statusResult.status === 'completed' && statusResult.proof) {
          return NextResponse.json({
            success: true,
            proof: statusResult.proof,
            statement: statement,
            scenario: scenario
          });
        } else if (statusResult.status === 'failed') {
          throw new Error(statusResult.error || 'Proof generation failed');
        }
      }
      
      throw new Error('Proof generation timeout');
    }

    return NextResponse.json({
      success: true,
      proof: result.proof,
      statement: statement,
      scenario: scenario
    });
  } catch (error: any) {
    console.error('Error generating proof:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
