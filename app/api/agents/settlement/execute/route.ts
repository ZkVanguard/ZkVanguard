import { NextRequest, NextResponse } from 'next/server';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import { requireAuth } from '@/lib/security/auth-middleware';
import { mutationLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { ProductionGuard } from '@/lib/security/production-guard';

export const runtime = 'nodejs';

/**
 * Settlement Execution API Route
 * Real SettlementAgent integration with x402 gasless transfers
 * SECURITY: Requires authentication (internal service or wallet signature)
 */
export async function POST(request: NextRequest) {
  // Rate limiting — distributed enforcement for money-moving operation
  const limited = await mutationLimiter.checkDistributed(request);
  if (limited) return limited;

  try {
    const body = await request.json();

    // Authentication required
    const authResult = await requireAuth(request, body);
    if (authResult instanceof NextResponse) return authResult;

    const { transactions } = body;

    if (!transactions || !Array.isArray(transactions)) {
      return NextResponse.json(
        { error: 'Transactions array is required' },
        { status: 400 }
      );
    }

    // Always use real agent orchestration
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
    
    // Real agent failed — return error (never fabricate settlement responses)
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
  } catch (error) {
    console.error('Settlement execution failed:', error);
    return safeErrorResponse(error, 'Settlement execution');
  }
}
