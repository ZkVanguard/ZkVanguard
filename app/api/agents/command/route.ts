import { NextRequest, NextResponse } from 'next/server';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import { logger } from '@/lib/utils/logger';

/**
 * Natural Language Command Processing API Route
 * Routes commands through LeadAgent for intelligent execution
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
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
function formatCommandResponse(report: any): string {
  const lines: string[] = [];
  
  if (report.status === 'success') {
    lines.push(`✅ Command executed successfully (${report.totalExecutionTime}ms)`);
  } else {
    lines.push(`❌ Command execution failed`);
  }
  
  if (report.riskAnalysis) {
    lines.push(`\n📊 Risk Analysis:`);
    lines.push(`  • Total Risk: ${report.riskAnalysis.totalRisk}`);
    lines.push(`  • Sentiment: ${report.riskAnalysis.sentiment}`);
  }
  
  if (report.hedgingStrategy) {
    lines.push(`\n🛡️ Hedging Strategy:`);
    lines.push(`  • Action: ${report.hedgingStrategy.action || 'Analyzed'}`);
    lines.push(`  • Confidence: ${report.hedgingStrategy.confidence || 'High'}`);
  }
  
  if (report.zkProofs?.length > 0) {
    lines.push(`\n🔐 ZK Proofs: ${report.zkProofs.length} generated`);
  }
  
  return lines.join('\n');
}
