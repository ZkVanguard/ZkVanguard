import { NextRequest, NextResponse } from 'next/server';
import { getCryptocomAIService } from '@/lib/ai/cryptocom-service';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';

/**
 * AI-Powered Portfolio Analysis API
 * Provides comprehensive portfolio insights using REAL market data + AI agents
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, useRealAgent = true } = body;

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    // Get REAL market data from blockchain
    const marketDataService = getMarketDataService();
    const realPortfolioData = await marketDataService.getPortfolioData(address);

    // Use real agent orchestration
    if (useRealAgent) {
      const orchestrator = getAgentOrchestrator();
      const result = await orchestrator.analyzePortfolio({ 
        address, 
        portfolioData: realPortfolioData 
      });

      if (result.success && result.data) {
        return NextResponse.json({
          success: true,
          analysis: {
            ...result.data,
            totalValue: realPortfolioData.totalValue,
            positions: realPortfolioData.tokens.length,
            tokens: realPortfolioData.tokens,
            realMarketData: true,
          },
          agentId: result.agentId,
          executionTime: result.executionTime,
          realAgent: true,
          realMarketData: true,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Use Enhanced AI Agent with real market data
    const { getEnhancedAIAgent } = await import('@/lib/ai/enhanced-ai-agent');
    const enhancedAgent = getEnhancedAIAgent();
    const analysis = await enhancedAgent.analyzePortfolioWithRealData(address);

    return NextResponse.json({
      success: true,
      analysis: {
        ...analysis,
        tokens: realPortfolioData.tokens,
      },
      aiPowered: true,
      realAgent: true,
      realMarketData: true,
      dataSource: 'blockchain',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Portfolio analysis error:', error);
    return NextResponse.json(
      { 
        error: 'Portfolio analysis failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  const aiService = getCryptocomAIService();
  return NextResponse.json({
    status: 'AI Portfolio Analysis API operational',
    aiAvailable: aiService.isAvailable(),
    provider: 'Crypto.com AI Agent Service',
  });
}
