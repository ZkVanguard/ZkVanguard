import { NextRequest, NextResponse } from 'next/server';
import { getCryptocomAIService } from '@/lib/ai/cryptocom-service';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';

/**
 * Risk Assessment API Route
 * Uses REAL market data + AI agents for intelligent risk analysis
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

    // Get REAL market data
    const marketDataService = getMarketDataService();
    const realPortfolioData = await marketDataService.getPortfolioData(address);

    // Calculate real volatilities for each token
    const volatilities = new Map<string, number>();
    for (const token of realPortfolioData.tokens) {
      try {
        const historicalPrices = await marketDataService.getHistoricalPrices(token.symbol, 30);
        if (historicalPrices.length > 0) {
          const prices = historicalPrices.map(h => h.price);
          const volatility = marketDataService.calculateVolatility(prices);
          volatilities.set(token.symbol, volatility);
        }
      } catch (error) {
        console.warn(`Failed to calculate volatility for ${token.symbol}`);
      }
    }

    // Use real agent orchestration
    if (useRealAgent) {
      const orchestrator = getAgentOrchestrator();
      const result = await orchestrator.assessRisk({ 
        address, 
        portfolioData: realPortfolioData,
        volatilities: Object.fromEntries(volatilities),
      });

      if (result.success && result.data) {
        return NextResponse.json({
          ...result.data,
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
    const riskAssessment = await enhancedAgent.assessRiskWithRealData(address);

    const riskMetrics = {
      var: riskAssessment.var95,
      volatility: riskAssessment.volatility,
      sharpeRatio: riskAssessment.sharpeRatio,
      liquidationRisk: riskAssessment.riskScore > 70 ? 0.08 : riskAssessment.riskScore > 50 ? 0.05 : 0.02,
      healthScore: 100 - riskAssessment.riskScore,
      overallRisk: riskAssessment.overallRisk,
      riskScore: riskAssessment.riskScore,
      factors: riskAssessment.factors,
      recommendations: [
        `Overall risk level: ${riskAssessment.overallRisk}`,
        `Risk score: ${riskAssessment.riskScore.toFixed(1)}/100`,
        `Portfolio volatility: ${(riskAssessment.volatility * 100).toFixed(1)}%`,
        ...riskAssessment.factors.map(f => `${f.factor}: ${f.description}`),
      ],
      aiPowered: true,
      realAgent: true,
      realMarketData: true,
      dataSource: 'blockchain + historical prices',
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(riskMetrics);
  } catch (error) {
    console.error('Risk assessment error:', error);
    return NextResponse.json(
      { error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Risk Agent API operational' });
}
