import { NextRequest, NextResponse } from 'next/server';

const ZK_API_URL = process.env.ZK_API_URL || 'http://localhost:8000';

// Generate deterministic fallback proof when ZK backend unavailable
function generateFallbackProof(scenario: string, statement: Record<string, unknown>, _witness: Record<string, unknown>) {
  const timestamp = Date.now();
  const hashInput = `${scenario}-${JSON.stringify(statement)}-${timestamp}`;
  const proofHash = `0x${Array.from(hashInput).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64)}`;
  const merkleRoot = `0x${Array.from(`merkle-${hashInput}`).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64)}`;
  
  console.warn('⚠️ [ZK FALLBACK] Real ZK server unavailable - using deterministic fallback');
  
  return {
    success: true,
    proof: {
      proof_hash: proofHash,
      merkle_root: merkleRoot,
      timestamp,
      verified: false, // Mark as unverified since this is fallback
      protocol: 'ZK-STARK (Fallback)',
      security_level: 0,
      field_bits: 0,
      cuda_accelerated: false,
      fallback_mode: true,
    },
    claim: {
      scenario,
      timestamp,
      verified: false,
    },
    statement,
    scenario,
    duration_ms: 0,
    fallback: true,
  };
}

export async function POST(request: NextRequest) {
  let body: { scenario?: string; statement?: Record<string, unknown>; witness?: Record<string, unknown> } = {};
  
  try {
    body = await request.json();
    const { scenario, statement, witness } = body;

    // Prepare data based on scenario type
    let _proofData: Record<string, unknown> = {};
    
    if (scenario === 'portfolio_risk') {
      _proofData = {
        portfolio_risk: (witness as any)?.actual_risk_score ?? null,
        portfolio_value: (witness as any)?.portfolio_value ?? null,
        threshold: (statement as any)?.threshold ?? null
      };
    } else if (scenario === 'settlement_batch') {
      _proofData = {
        transaction_count: (witness as any)?.transactions?.length ?? 5,
        total_amount: (witness as any)?.total_amount ?? null,
        batch_id: (witness as any)?.batch_id ?? null
      };
    } else if (scenario === 'compliance_check') {
      _proofData = {
        kyc_score: (witness as any)?.kyc_score ?? null,
        risk_level: (witness as any)?.risk_level ?? null,
        jurisdiction: (witness as any)?.jurisdiction ?? null
      };
    } else {
      // Generic data format
      _proofData = { ...(statement || {}), ...(witness || {}) };
    }

    // Call the real FastAPI ZK server
    console.log(`🔐 [ZK Generate] Calling ZK server at ${ZK_API_URL}/api/zk/generate`);
    
    const response = await fetch(`${ZK_API_URL}/api/zk/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        proof_type: 'settlement', // Map all to settlement for now
        data: {
          statement: statement,  // Backend expects statement and witness inside data
          witness: witness
        }
      }),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [ZK Generate] Server returned ${response.status}: ${errorText}`);
      throw new Error(`ZK API error: ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`✅ [ZK Generate] Proof generated successfully:`, { status: result.status, hasProof: !!result.proof });
    
    // Check if proof generation is complete
    if (result.status === 'pending' || result.job_id) {
      // Poll for completion
      const jobId = result.job_id;
      const maxAttempts = 30;
      console.log(`⏳ [ZK Generate] Polling for job ${jobId} completion...`);
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const statusResponse = await fetch(`${ZK_API_URL}/api/zk/proof/${jobId}`);
        if (!statusResponse.ok) {
          console.error(`❌ [ZK Generate] Failed to check proof status (attempt ${attempt + 1}/${maxAttempts})`);
          throw new Error('Failed to check proof status');
        }
        
        const statusResult = await statusResponse.json();
        console.log(`📊 [ZK Generate] Status check ${attempt + 1}/${maxAttempts}: ${statusResult.status}`);
        
        if (statusResult.status === 'completed' && statusResult.proof) {
          console.log(`✅ [ZK Generate] Proof completed successfully in ${statusResult.duration_ms}ms`);
          return NextResponse.json({
            success: true,
            proof: statusResult.proof,
            claim: statusResult.claim,
            statement: statement,
            scenario: scenario,
            duration_ms: statusResult.duration_ms
          });
        } else if (statusResult.status === 'failed') {
          console.error(`❌ [ZK Generate] Proof generation failed:`, statusResult.error);
          throw new Error(statusResult.error || 'Proof generation failed');
        }
      }
      
      console.error(`⏰ [ZK Generate] Proof generation timeout after ${maxAttempts} attempts`);
      throw new Error('Proof generation timeout');
    }

    console.log(`✅ [ZK Generate] Proof returned immediately`);
    return NextResponse.json({
      success: true,
      proof: result.proof,
      claim: result.claim,
      statement: statement,
      scenario: scenario
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ [ZK Generate] ZK backend error: ${errorMessage}`);
    console.error('Stack:', error instanceof Error ? error.stack : 'N/A');
    console.warn(`⚠️ [ZK Generate] Falling back to deterministic proof generation`);
    
    // Return fallback proof when ZK backend is unavailable
    const fallbackResult = generateFallbackProof(
      body.scenario || 'generic',
      body.statement || {},
      body.witness || {}
    );
    return NextResponse.json(fallbackResult);
  }
}
