import { NextRequest, NextResponse } from 'next/server';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import { requireAuth } from '@/lib/security/auth-middleware';
import { mutationLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { ProductionGuard } from '@/lib/security/production-guard';

/**
 * Settlement Execution API Route
 * Real SettlementAgent integration with x402 gasless transfers
 * SECURITY: Requires authentication (internal service or wallet signature)
 */
export async function POST(request: NextRequest) {
  // Rate limiting
  const limited = mutationLimiter.check(request);
  if (limited) return limited;

  try {
    const body = await request.json();

    // Authentication required
    const authResult = await requireAuth(request, body);
    if (authResult instanceof NextResponse) return authResult;

    const { transactions, useRealAgent = true } = body;

    if (!transactions || !Array.isArray(transactions)) {
      return NextResponse.json(
        { error: 'Transactions array is required' },
        { status: 400 }
      );
    }

    // PRODUCTION SAFETY: Never allow demo mode in production - real money at stake
    const forceRealAgent = ProductionGuard.ENFORCE_PRODUCTION_SAFETY || useRealAgent;

    // Use real agent orchestration
    if (forceRealAgent) {
      const orchestrator = getAgentOrchestrator();
      const result = await orchestrator.executeBatchSettlement({ transactions });

      if (result.success) {
        return NextResponse.json({
          ...(result.data as Record<string, unknown>),
          agentId: result.agentId,
          executionTime: result.executionTime,
          realAgent: true,
          x402Powered: true,
          timestamp: new Date().toISOString(),
        });
      }
      
      // In production, if real agent fails, return error instead of demo
      if (ProductionGuard.ENFORCE_PRODUCTION_SAFETY) {
        ProductionGuard.auditLog({
          timestamp: Date.now(),
          operation: 'SETTLEMENT_AGENT_FAILED',
          result: 'failure',
          reason: result.error,
          metadata: {
            transactionCount: transactions.length,
          },
        });
        
        return NextResponse.json({
          error: 'Settlement execution failed',
          details: result.error,
          realAgent: true,
          timestamp: new Date().toISOString(),
        }, { status: 503 });
      }
    }
    
    // Fallback demo response (DEVELOPMENT ONLY)
    return NextResponse.json({
      batchId: `batch-${Date.now()}`,
      transactionCount: transactions.length,
      gasSaved: 0.67,
      estimatedCost: `${(transactions.length * 0.0001).toFixed(4)} CRO`,
      status: 'completed',
      zkProofGenerated: true,
      realAgent: false,
      developmentMode: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Settlement execution failed:', error);
    return safeErrorResponse(error, 'Settlement execution');
  }
}
