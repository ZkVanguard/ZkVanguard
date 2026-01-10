/**
 * Chat API Route - LLM-powered conversational interface with AI Agent orchestration
 * Supports both standard and streaming responses
 * Routes requests through LeadAgent for intelligent decision-making
 */

import { NextRequest, NextResponse } from 'next/server';
import { llmProvider } from '@/lib/ai/llm-provider';
import { logger } from '@/lib/utils/logger';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Keywords that indicate the user wants agent orchestration
const AGENT_KEYWORDS = [
  'hedge', 'hedging', 'risk', 'analyze', 'portfolio', 'rebalance',
  'optimize', 'swap', 'trade', 'buy', 'sell', 'position', 'exposure',
  'volatility', 'var', 'sharpe', 'settlement', 'gasless', 'prediction',
  'polymarket', 'delphi', 'market', 'btc', 'eth', 'cro', 'usdc'
];

/**
 * Check if message should be routed through agents
 */
function shouldUseAgents(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return AGENT_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
}

/**
 * POST /api/chat
 * Generate LLM response for user message, routing through agents when appropriate
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, conversationId = 'default', context, stream = false } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required and must be a string' },
        { status: 400 }
      );
    }

    // Check if this should go through agent orchestration
    const useAgents = shouldUseAgents(message);
    
    if (useAgents) {
      logger.info('Routing message through LeadAgent', { message: message.substring(0, 50) });
      
      try {
        const orchestrator = getAgentOrchestrator();
        const leadAgent = await orchestrator.getLeadAgent();
        
        if (leadAgent) {
          // Execute through LeadAgent
          const report = await leadAgent.executeStrategyFromIntent(message);
          
          // Format the agent response
          const agentResponse = formatAgentResponse(report);
          
          return NextResponse.json({
            success: true,
            response: agentResponse.content,
            metadata: {
              model: 'lead-agent-orchestration',
              tokensUsed: 0,
              confidence: 0.95,
              isRealAI: true,
              actionExecuted: true,
              agentReport: report,
              zkProof: report.zkProofs?.[0],
            },
          });
        }
      } catch (agentError) {
        logger.warn('LeadAgent execution failed, falling back to LLM', { error: agentError });
        // Fall through to LLM response
      }
    }

    // Handle streaming response
    if (stream) {
      const encoder = new TextEncoder();
      
      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of llmProvider.streamResponse(message, conversationId, context)) {
              const data = JSON.stringify(chunk);
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (error) {
            logger.error('Streaming error:', error);
            controller.error(error);
          }
        },
      });

      return new NextResponse(readableStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Handle standard response
    const response = await llmProvider.generateResponse(message, conversationId, context);

    return NextResponse.json({
      success: true,
      response: response.content,
      metadata: {
        model: response.model,
        tokensUsed: response.tokensUsed,
        confidence: response.confidence,
        isRealAI: llmProvider.isAvailable(),
        actionExecuted: response.actionExecuted || false,
        actionResult: response.actionResult,
        zkProof: response.zkProof,
      },
    });
  } catch (error) {
    logger.error('Chat API error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process chat request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * Format agent execution report into readable response
 */
function formatAgentResponse(report: any): { content: string } {
  const lines: string[] = [];
  
  lines.push(`## Agent Execution Report\n`);
  lines.push(`**Strategy:** ${report.strategy || 'Analysis'}`);
  lines.push(`**Status:** ${report.status === 'success' ? '✅ Success' : '❌ Failed'}`);
  lines.push(`**Execution Time:** ${report.totalExecutionTime}ms\n`);
  
  if (report.riskAnalysis) {
    lines.push(`### Risk Analysis`);
    lines.push(`- **Total Risk Score:** ${report.riskAnalysis.totalRisk || 'N/A'}`);
    lines.push(`- **Volatility:** ${report.riskAnalysis.volatility || 'N/A'}`);
    lines.push(`- **Market Sentiment:** ${report.riskAnalysis.sentiment || 'N/A'}`);
    if (report.riskAnalysis.recommendations?.length > 0) {
      lines.push(`\n**Recommendations:**`);
      report.riskAnalysis.recommendations.forEach((rec: string) => {
        lines.push(`- ${rec}`);
      });
    }
    lines.push('');
  }
  
  if (report.hedgingStrategy) {
    lines.push(`### Hedging Strategy`);
    lines.push(`- **Recommended Action:** ${report.hedgingStrategy.action || 'N/A'}`);
    lines.push(`- **Confidence:** ${report.hedgingStrategy.confidence || 'N/A'}`);
    if (report.hedgingStrategy.positions?.length > 0) {
      lines.push(`\n**Suggested Positions:**`);
      report.hedgingStrategy.positions.forEach((pos: any) => {
        lines.push(`- ${pos.asset}: ${pos.direction} ${pos.size}`);
      });
    }
    lines.push('');
  }
  
  if (report.settlement) {
    lines.push(`### Settlement`);
    lines.push(`- **Transactions:** ${report.settlement.transactionCount || 0}`);
    lines.push(`- **Gasless:** ${report.settlement.gasless ? '✅ Yes' : '❌ No'}`);
    lines.push('');
  }
  
  if (report.zkProofs?.length > 0) {
    lines.push(`### ZK Proofs Generated`);
    report.zkProofs.forEach((proof: any) => {
      lines.push(`- **${proof.proofType}:** ${proof.verified ? '✅ Verified' : '⏳ Pending'}`);
    });
  }
  
  return { content: lines.join('\n') };
}

/**
 * DELETE /api/chat
 * Clear conversation history
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId') || 'default';

    llmProvider.clearHistory(conversationId);

    return NextResponse.json({
      success: true,
      message: 'Conversation history cleared',
    });
  } catch (error) {
    logger.error('Chat clear error:', error);
    return NextResponse.json(
      { error: 'Failed to clear conversation' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/chat/history
 * Get conversation history
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId') || 'default';

    const history = llmProvider.getHistory(conversationId);

    return NextResponse.json({
      success: true,
      history,
      count: history.length,
    });
  } catch (error) {
    logger.error('Chat history error:', error);
    return NextResponse.json(
      { error: 'Failed to get conversation history' },
      { status: 500 }
    );
  }
}
