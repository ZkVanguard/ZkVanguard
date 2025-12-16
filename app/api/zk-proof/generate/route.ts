import { NextRequest, NextResponse } from 'next/server';

const ZK_API_URL = process.env.ZK_API_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { scenario, statement, witness } = body;

    // Prepare data based on scenario type
    let proofData: Record<string, unknown> = {};
    
    if (scenario === 'portfolio_risk') {
      proofData = {
        portfolio_risk: witness.actual_risk_score,
        portfolio_value: witness.portfolio_value,
        threshold: statement.threshold
      };
    } else if (scenario === 'settlement_batch') {
      proofData = {
        transaction_count: witness.transactions?.length || 5,
        total_amount: witness.total_amount,
        batch_id: witness.batch_id
      };
    } else if (scenario === 'compliance_check') {
      proofData = {
        kyc_score: witness.kyc_score,
        risk_level: witness.risk_level,
        jurisdiction: witness.jurisdiction
      };
    } else {
      // Generic data format
      proofData = { ...statement, ...witness };
    }

    // Call the real FastAPI ZK server
    const response = await fetch(`${ZK_API_URL}/api/zk/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        proof_type: 'settlement', // Map all to settlement for now
        data: proofData
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ZK API error: ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    
    // Check if proof generation is complete
    if (result.status === 'pending' || result.job_id) {
      // Poll for completion
      const jobId = result.job_id;
      const maxAttempts = 30;
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const statusResponse = await fetch(`${ZK_API_URL}/api/zk/proof/${jobId}`);
        if (!statusResponse.ok) {
          throw new Error('Failed to check proof status');
        }
        
        const statusResult = await statusResponse.json();
        
        if (statusResult.status === 'completed' && statusResult.proof) {
          return NextResponse.json({
            success: true,
            proof: statusResult.proof,
            claim: statusResult.claim,
            statement: statement,
            scenario: scenario,
            duration_ms: statusResult.duration_ms
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
      claim: result.claim,
      statement: statement,
      scenario: scenario
    });
  } catch (error: unknown) {
    console.error('Error generating proof:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
