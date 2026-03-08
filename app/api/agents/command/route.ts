import { NextRequest, NextResponse } from 'next/server';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import { logger } from '@/lib/utils/logger';
import { requireAuth } from '@/lib/security/auth-middleware';
import { mutationLimiter } from '@/lib/security/rate-limiter';

/**
 * Natural Language Command Processing API Route
 * Routes commands through LeadAgent for intelligent execution
 * SECURITY: Requires authentication — commands can trigger real operations
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

    const { command } = body;

    if (!command) {
      return NextResponse.json(
        { error: 'Command is required' },
        { status: 400 }
      );
    }

    logger.info('Processing natural language command', { command: command.substring(0, 50) });

    // Get LeadAgent from orchestrator
    const orchestrator = getAgentOrchestrator();
    const leadAgent = await orchestrator.getLeadAgent();

    if (!leadAgent) {
      return NextResponse.json({
        success: false,
        error: 'LeadAgent not available',
        fallback: true,
        response: `Command received: "${command}". Agent system initializing...`,
      }, { status: 503 });
    }

    // Execute command through LeadAgent
    const report = await leadAgent.executeStrategyFromIntent(command);

    logger.info('Command executed successfully', { 
      executionId: report.executionId,
      status: report.status,
      executionTime: report.totalExecutionTime 
    });

    return NextResponse.json({
      success: true,
      command,
      executionId: report.executionId,
      status: report.status,
      response: formatCommandResponse(report),
      details: {
        strategy: report.strategy,
        executionTime: report.totalExecutionTime,
        riskAnalysis: report.riskAnalysis,
        hedgingStrategy: report.hedgingStrategy,
        settlement: report.settlement,
        zkProofs: report.zkProofs,
      },
    });
  } catch (error) {
    logger.error('Command processing failed:', { error });
    return NextResponse.json(
      { 
        error: 'Failed to process command', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

/**
 * Format execution report into user-friendly response
 */
interface FormattableReport {
  status: string;
  totalExecutionTime: number;
  riskAnalysis?: {
    totalRisk: number;
    sentiment?: string;
    marketSentiment?: string;
  };
  hedgingStrategy?: {
    strategy?: string;
    action?: string;
    confidence?: string;
    executionStatus?: string;
  };
  zkProofs?: unknown[];
}

function formatCommandResponse(report: FormattableReport): string {
  const lines: string[] = [];
  
  if (report.status === 'success') {
    lines.push(`✅ Command executed successfully (${report.totalExecutionTime}ms)`);
  } else {
    lines.push(`❌ Command execution failed`);
  }
  
  if (report.riskAnalysis) {
    lines.push(`\n📊 Risk Analysis:`);
    lines.push(`  • Total Risk: ${report.riskAnalysis.totalRisk}`);
    lines.push(`  • Sentiment: ${report.riskAnalysis.sentiment || report.riskAnalysis.marketSentiment || 'unknown'}`);
  }
  
  if (report.hedgingStrategy) {
    lines.push(`\n🛡️ Hedging Strategy:`);
    lines.push(`  • Action: ${report.hedgingStrategy.action || report.hedgingStrategy.strategy || 'Analyzed'}`);
    lines.push(`  • Confidence: ${report.hedgingStrategy.confidence || report.hedgingStrategy.executionStatus || 'High'}`);
  }
  
  if (report.zkProofs && report.zkProofs.length > 0) {
    lines.push(`\n🔐 ZK Proofs: ${report.zkProofs.length} generated`);
  }
  
  return lines.join('\n');
}
