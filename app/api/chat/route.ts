/**
 * Chat API Route - LLM-powered conversational interface with AI Agent orchestration
 * Supports both standard and streaming responses
 * Routes requests through LeadAgent for intelligent decision-making
 */

import { NextRequest, NextResponse } from 'next/server';
import { llmProvider } from '@/lib/ai/llm-provider';
import { logger } from '@/lib/utils/logger';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import { getPortfolioData } from '@/lib/services/portfolio-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * OPTIONS /api/chat
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// Keywords that indicate the user wants agent orchestration
const AGENT_KEYWORDS = [
  'hedge', 'hedging', 'rebalance', 'optimize', 'swap', 'trade', 
  'buy', 'sell', 'position', 'exposure', 'settlement', 'gasless'
];

// Keywords that are analysis-related but should use LLM when no portfolio exists
const ANALYSIS_KEYWORDS = [
  'risk', 'analyze', 'portfolio', 'volatility', 'var', 'sharpe'
];

/**
 * Check if message should be routed through agents
 * Only routes to agents if there's actual portfolio data to analyze
 */
async function shouldUseAgents(message: string): Promise<boolean> {
  const lowerMessage = message.toLowerCase();
  
  // Check for direct action keywords (always route to agents)
  const hasActionKeyword = AGENT_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
  if (hasActionKeyword) {
    return true;
  }
  
  // Check for analysis keywords
  const hasAnalysisKeyword = ANALYSIS_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
  if (hasAnalysisKeyword) {
    // Only use agents if we have actual portfolio data
    try {
      const portfolioData = await getPortfolioData();
      const hasPortfolio = portfolioData?.portfolio?.totalValue > 0 || 
                          (portfolioData?.portfolio?.positions?.length || 0) > 0;
      if (!hasPortfolio) {
        logger.info('Analysis requested but no portfolio data - using LLM for intelligent response');
        return false;
      }
      return true;
    } catch (error) {
      logger.info('Cannot fetch portfolio - using LLM for intelligent response');
      return false;
    }
  }
  
  return false;
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
    // LeadAgent orchestrates all specialized agents for complex operations
    const useAgents = await shouldUseAgents(message);
    
    if (useAgents) {
      logger.info('Routing message through LeadAgent orchestration', { message: message.substring(0, 50) });
      
      try {
        const orchestrator = getAgentOrchestrator();
        await orchestrator.initialize(); // Ensure all agents are ready
        const leadAgent = await orchestrator.getLeadAgent();
        
        if (leadAgent) {
          // Execute through LeadAgent - it will coordinate all specialized agents
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
        const errorMessage = agentError instanceof Error ? agentError.message : String(agentError);
        const errorStack = agentError instanceof Error ? agentError.stack : undefined;
        logger.error('LeadAgent execution failed, falling back to LLM', { 
          error: errorMessage,
          stack: errorStack,
          message: message.substring(0, 100)
        });
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
 * Format agent execution report into concise, actionable response
 */
function formatAgentResponse(report: any): { content: string } {
  const lines: string[] = [];
  
  // Quick status line
  const status = report.status === 'success' ? '✅' : '❌';
  const strategy = report.strategy || 'analyze';
  
  // Concise metrics bar
  const risk = report.riskAnalysis?.totalRisk ?? '—';
  const vol = typeof report.riskAnalysis?.volatility === 'number' 
    ? (report.riskAnalysis.volatility * 100).toFixed(0) + '%' : '—';
  const sentiment = report.riskAnalysis?.marketSentiment || report.riskAnalysis?.sentiment || '—';
  
  lines.push(`${status} **${strategy.toUpperCase()}** | Risk: ${risk}/100 | Vol: ${vol} | ${sentiment}`);
  
  // AI summary (if available) - one line
  if (report.aiSummary) {
    const summary = report.aiSummary.split('.').slice(0, 2).join('.') + '.';
    lines.push(`\n${summary}`);
  }
  
  // Key recommendation (if hedging)
  if (report.hedgingStrategy) {
    const action = report.hedgingStrategy.action || 'open position';
    const conf = report.hedgingStrategy.confidence || 'medium';
    const positions = report.hedgingStrategy.positions;
    const suggested = report.hedgingStrategy.suggestedAction;
    
    if (suggested) {
      // Use suggestedAction if available (from HedgingAgent)
      const size = suggested.size || '0.1';
      const leverage = suggested.leverage || 2;
      const asset = suggested.market?.replace('-PERP', '') || 'BTC';
      const side = suggested.side || 'SHORT';
      lines.push(`\n📌 **Recommended:** ${side} ${asset}`);
      lines.push(`   💰 Size: **${size}** | ⚡ Leverage: **${leverage}x**`);
    } else if (positions?.length > 0) {
      const pos = positions[0];
      const size = pos.size || '0.1';
      const leverage = pos.leverage || 2;
      lines.push(`\n📌 **Recommended:** ${pos.direction?.toUpperCase() || 'HEDGE'} ${pos.asset || 'BTC'}`);
      lines.push(`   💰 Size: **${size}** | ⚡ Leverage: **${leverage}x**`);
    } else {
      lines.push(`\n📌 **Recommended:** ${action} (${conf} confidence)`);
    }
  }
  
  // ZK verification status
  if (report.zkProofs?.length > 0) {
    const verified = report.zkProofs.filter((p: any) => p.verified).length;
    lines.push(`\n🔐 ZK: ${verified}/${report.zkProofs.length} verified on-chain`);
  }
  
  // Settlement info (brief)
  if (report.settlement?.gasless) {
    lines.push(`⛽ Gasless ready via x402`);
  }
  
  // ACTION BUTTONS - Machine-readable actions for on-chain execution
  lines.push(`\n---`);
  
  // Build action data for buttons
  const actions: Array<{ id: string; label: string; type: string; params: any }> = [];
  
  if (report.strategy === 'hedge' || report.hedgingStrategy) {
    const suggested = report.hedgingStrategy?.suggestedAction;
    const positions = report.hedgingStrategy?.positions;
    const pos = suggested || positions?.[0];
    
    actions.push({
      id: 'execute_hedge',
      label: `⚡ Execute ${pos?.side || 'SHORT'} ${pos?.market?.replace('-PERP', '') || pos?.asset || 'BTC'}`,
      type: 'hedge',
      params: {
        asset: pos?.market || pos?.asset || 'BTC-PERP',
        side: pos?.side || 'SHORT',
        size: pos?.size || '0.1',
        leverage: pos?.leverage || 2,
        gasless: true
      }
    });
    
    actions.push({
      id: 'adjust_params',
      label: '⚙️ Adjust Parameters',
      type: 'adjust',
      params: { showModal: true }
    });
  } else {
    actions.push({
      id: 'create_hedge',
      label: '🛡️ Create Hedge',
      type: 'hedge',
      params: { asset: 'BTC-PERP', side: 'SHORT', size: '0.1', leverage: 2 }
    });
    
    actions.push({
      id: 'analyze',
      label: '📊 Full Analysis',
      type: 'analyze',
      params: {}
    });
  }
  
  actions.push({
    id: 'view_positions',
    label: '📋 View Positions',
    type: 'status',
    params: {}
  });
  
  // Encode actions as special format that EnhancedChat will parse
  lines.push(`<!--ACTIONS:${JSON.stringify(actions)}-->`);
  
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
