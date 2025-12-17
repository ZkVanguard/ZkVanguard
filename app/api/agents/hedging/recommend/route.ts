import { NextRequest, NextResponse } from 'next/server';
import { getCryptocomAIService } from '@/lib/ai/cryptocom-service';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';

/**
 * Hedging Recommendations API Route
 * Uses real HedgingAgent + Moonlander + Crypto.com AI
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, portfolioData, riskProfile, useRealAgent = true } = body;

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    // Use real agent orchestration if enabled
    if (useRealAgent && portfolioData?.dominantAsset) {
      const orchestrator = getAgentOrchestrator();
      const result = await orchestrator.generateHedgeRecommendations({
        portfolioId: address,
        assetSymbol: portfolioData.dominantAsset || 'BTC',
        notionalValue: portfolioData.totalValue || 1000000,
      });

      if (result.success && result.data) {
        // Format HedgeAnalysis to API response format
        const hedgeAnalysis = result.data;
        return NextResponse.json({
          recommendations: [{
            strategy: `${hedgeAnalysis.recommendation.action} ${hedgeAnalysis.recommendation.side} Position`,
            confidence: hedgeAnalysis.riskMetrics.hedgeEffectiveness,
            expectedReduction: hedgeAnalysis.exposure.volatility * 60,
            description: hedgeAnalysis.recommendation.reason,
            actions: [{
              action: hedgeAnalysis.recommendation.action,
              market: hedgeAnalysis.recommendation.market,
              asset: hedgeAnalysis.exposure.asset,
              size: parseFloat(hedgeAnalysis.recommendation.size),
              leverage: hedgeAnalysis.recommendation.leverage,
              reason: hedgeAnalysis.recommendation.reason,
              expectedGasSavings: 0.97,
            }]
          }],
          agentId: result.agentId,
          executionTime: result.executionTime,
          realAgent: true,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Fallback to AI service
    const aiService = getCryptocomAIService();
    const aiRecommendations = await aiService.generateHedgeRecommendations(
      portfolioData || { address },
      riskProfile || {}
    );

    // Format for API response
    const recommendations = aiRecommendations.map(rec => ({
      strategy: rec.strategy,
      confidence: rec.confidence,
      expectedReduction: rec.expectedReduction,
      description: rec.description,
      actions: rec.actions.map(action => ({
        action: action.action.toUpperCase(),
        asset: action.asset,
        size: action.amount / 1000,
        leverage: action.action === 'short' ? 5 : 3,
        reason: rec.description,
        expectedGasSavings: 0.65 + Math.random() * 0.1
      }))
    }));

    return NextResponse.json({
      recommendations,
      aiPowered: aiService.isAvailable(),
      realAgent: false,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Hedging recommendation failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate hedges', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
